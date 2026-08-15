/**
 * Moddose checkout endpoint.
 *
 *   POST /checkout  { items: [{slug, qty, plan}], interval }  -> { url }
 *   POST /webhook   Stripe events (signature verified)
 *   GET  /health
 *
 * Secrets (wrangler secret put):
 *   STRIPE_SECRET_KEY       sk_live_... / sk_test_...
 *   STRIPE_WEBHOOK_SECRET   whsec_...
 *
 * Vars (wrangler.toml):
 *   SITE_ORIGIN             https://moddose.com   — the only allowed CORS origin
 *   AUTOMATIC_TAX           "true" to enable Stripe Tax
 */

import catalog from './catalog.json';
import { normaliseCart, buildSession, CartError } from './lineitems.js';
import { createCheckoutSession, verifyWebhook } from './stripe.js';

const json = (body, status, origin) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin,
      'Cache-Control': 'no-store'
    }
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = env.SITE_ORIGIN || '';
    const requestOrigin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    if (url.pathname === '/health') {
      return json({ ok: true, products: Object.keys(catalog).length }, 200, origin);
    }

    if (url.pathname === '/checkout' && request.method === 'POST') {
      // Browsers send Origin on cross-origin POSTs; anything else is not our storefront.
      if (origin && requestOrigin && requestOrigin !== origin) {
        return json({ error: 'Origin not allowed' }, 403, origin);
      }

      if (!env.STRIPE_SECRET_KEY) {
        return json({ error: 'Checkout is not configured' }, 503, origin);
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Malformed request body' }, 400, origin);
      }

      try {
        const cart = normaliseCart(body, catalog);
        const session = buildSession(cart, {
          subscribeDiscount: Number(env.SUBSCRIBE_DISCOUNT ?? 0.2),
          currency: env.CURRENCY || 'usd',
          freeShippingThreshold: Number(env.FREE_SHIPPING_THRESHOLD ?? 50),
          shippingFlat: Number(env.SHIPPING_FLAT ?? 5.95),
          successUrl: `${origin}/checkout/success/?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${origin}/cart/`,
          automaticTax: env.AUTOMATIC_TAX === 'true'
        });

        const created = await createCheckoutSession(session, env.STRIPE_SECRET_KEY);
        return json({ url: created.url, id: created.id }, 200, origin);
      } catch (err) {
        if (err instanceof CartError) return json({ error: err.message }, err.status, origin);
        // Stripe's message can name internal configuration; log it, do not return it.
        console.error('checkout failed', err.stripeCode || '', err.message);
        return json({ error: 'Could not start checkout. Please try again.' }, 502, origin);
      }
    }

    if (url.pathname === '/webhook' && request.method === 'POST') {
      if (!env.STRIPE_WEBHOOK_SECRET) return new Response('Webhook not configured', { status: 503 });

      const raw = await request.text();
      let event;
      try {
        event = await verifyWebhook(raw, request.headers.get('Stripe-Signature'), env.STRIPE_WEBHOOK_SECRET);
      } catch (err) {
        console.error('webhook rejected:', err.message);
        return new Response('Invalid signature', { status: 400 });
      }

      switch (event.type) {
        case 'checkout.session.completed':
          // Fulfilment goes here: record the order, notify the warehouse, email
          // the customer. Keep it idempotent — Stripe retries.
          console.log('order paid', event.data.object.id, event.data.object.metadata?.cart);
          break;
        case 'invoice.paid':
          console.log('subscription renewed', event.data.object.subscription);
          break;
        case 'customer.subscription.deleted':
          console.log('subscription cancelled', event.data.object.id);
          break;
        default:
          break;
      }

      return new Response('ok', { status: 200 });
    }

    return json({ error: 'Not found' }, 404, origin);
  }
};
