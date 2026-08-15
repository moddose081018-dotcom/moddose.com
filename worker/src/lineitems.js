/**
 * Cart -> Stripe line items.
 *
 * Prices come from the server-side catalog, never from the request body.
 * A client that asks for "alpha-brain at $0.50" gets $29.90, because the
 * only thing the browser is trusted to send is a slug, a quantity and a
 * plan.
 */

export const MAX_ITEMS = 20;
export const MAX_QTY = 99;
export const ALLOWED_INTERVALS = [30, 45, 60, 90];

export class CartError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const cents = (dollars) => Math.round(Number(dollars) * 100);

/**
 * Validate and normalise the incoming cart.
 * @param {unknown} body parsed JSON request body
 * @param {Record<string, {name, brand, price, image?}>} catalog
 */
export function normaliseCart(body, catalog) {
  if (!body || typeof body !== 'object') throw new CartError('Malformed request body');

  const items = body.items;
  if (!Array.isArray(items) || items.length === 0) throw new CartError('Cart is empty');
  if (items.length > MAX_ITEMS) throw new CartError('Too many distinct items');

  const interval = body.interval === undefined ? 30 : Number(body.interval);
  if (!ALLOWED_INTERVALS.includes(interval)) {
    throw new CartError(`Unsupported delivery interval: ${body.interval}`);
  }

  const seen = new Set();
  const normalised = items.map((item) => {
    if (!item || typeof item !== 'object') throw new CartError('Malformed cart item');

    const product = catalog[item.slug];
    if (!product) throw new CartError(`Unknown product: ${String(item.slug).slice(0, 60)}`);

    const qty = Number(item.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      throw new CartError(`Invalid quantity for ${item.slug}`);
    }

    const plan = item.plan === 'subscribe' ? 'subscribe' : 'onetime';

    const key = `${item.slug}:${plan}`;
    if (seen.has(key)) throw new CartError(`Duplicate line: ${key}`);
    seen.add(key);

    return { slug: item.slug, qty, plan, product };
  });

  return { items: normalised, interval };
}

/**
 * Unit price in cents. Subscription lines carry the standing discount,
 * applied here rather than trusted from the client.
 */
export function unitAmount(product, plan, subscribeDiscount) {
  const price = plan === 'subscribe' ? product.price * (1 - subscribeDiscount) : product.price;
  return cents(Math.round(price * 100) / 100);
}

/**
 * Build the Checkout Session payload.
 *
 * A cart containing any subscription line becomes a subscription session;
 * one-time lines in that cart are billed once on the first invoice, which
 * is what Stripe does with non-recurring prices in subscription mode.
 */
export function buildSession(cart, config) {
  const { items, interval } = cart;
  const { subscribeDiscount, currency, freeShippingThreshold, shippingFlat, successUrl, cancelUrl, automaticTax } = config;

  const line_items = items.map(({ product, plan, qty, slug }) => {
    const price_data = {
      currency,
      unit_amount: unitAmount(product, plan, subscribeDiscount),
      product_data: {
        name: `${product.brand} ${product.name}`,
        metadata: { slug }
      }
    };
    if (plan === 'subscribe') {
      price_data.recurring = { interval: 'day', interval_count: interval };
    }
    return { quantity: qty, price_data };
  });

  const subtotal = items.reduce(
    (sum, { product, plan, qty }) => sum + unitAmount(product, plan, subscribeDiscount) * qty,
    0
  );

  const hasSubscription = items.some((i) => i.plan === 'subscribe');
  const shippingCents = subtotal >= cents(freeShippingThreshold) ? 0 : cents(shippingFlat);

  const session = {
    mode: hasSubscription ? 'subscription' : 'payment',
    line_items,
    success_url: successUrl,
    cancel_url: cancelUrl,
    shipping_address_collection: { allowed_countries: ['US'] },
    shipping_options: [
      {
        shipping_rate_data: {
          type: 'fixed_amount',
          display_name: shippingCents === 0 ? 'Free shipping' : 'Standard shipping',
          fixed_amount: { amount: shippingCents, currency }
        }
      }
    ],
    metadata: {
      cart: items.map((i) => `${i.slug}:${i.plan}:${i.qty}`).join(','),
      interval: hasSubscription ? String(interval) : ''
    }
  };

  if (automaticTax) session.automatic_tax = { enabled: true };

  return session;
}
