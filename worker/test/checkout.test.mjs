import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseCart, buildSession, unitAmount, CartError } from '../src/lineitems.js';
import { formEncode, verifyWebhook } from '../src/stripe.js';

const catalog = {
  'alpha-brain': { brand: 'Onnit', name: 'Alpha BRAIN', price: 29.90 },
  'mind-lab-pro': { brand: 'Mind Lab Pro', name: 'Mind Lab Pro', price: 79.50 }
};

const config = {
  subscribeDiscount: 0.2,
  currency: 'usd',
  freeShippingThreshold: 50,
  shippingFlat: 5.95,
  successUrl: 'https://moddose.com/checkout/success/',
  cancelUrl: 'https://moddose.com/cart/',
  automaticTax: false
};

const cart = (items, interval) => normaliseCart({ items, interval }, catalog);

test('prices come from the catalog, never the request', () => {
  const c = cart([{ slug: 'alpha-brain', qty: 1, plan: 'onetime', price: 0.5, unit_amount: 1 }]);
  const s = buildSession(c, config);
  assert.equal(s.line_items[0].price_data.unit_amount, 2990);
});

test('subscription lines carry the 20% discount', () => {
  assert.equal(unitAmount(catalog['mind-lab-pro'], 'subscribe', 0.2), 6360);
  assert.equal(unitAmount(catalog['mind-lab-pro'], 'onetime', 0.2), 7950);
});

test('a cart with any subscription line becomes a subscription session', () => {
  const s = buildSession(cart([
    { slug: 'alpha-brain', qty: 1, plan: 'onetime' },
    { slug: 'mind-lab-pro', qty: 2, plan: 'subscribe' }
  ]), config);

  assert.equal(s.mode, 'subscription');
  assert.equal(s.line_items[0].price_data.recurring, undefined, 'one-time line stays one-off');
  assert.deepEqual(s.line_items[1].price_data.recurring, { interval: 'day', interval_count: 30 });
});

test('an all-one-time cart is a payment session', () => {
  const s = buildSession(cart([{ slug: 'alpha-brain', qty: 1, plan: 'onetime' }]), config);
  assert.equal(s.mode, 'payment');
});

test('the chosen interval reaches Stripe', () => {
  const s = buildSession(cart([{ slug: 'mind-lab-pro', qty: 1, plan: 'subscribe' }], 90), config);
  assert.equal(s.line_items[0].price_data.recurring.interval_count, 90);
  assert.equal(s.metadata.interval, '90');
});

test('shipping matches the published policy', () => {
  const under = buildSession(cart([{ slug: 'alpha-brain', qty: 1, plan: 'onetime' }]), config);
  assert.equal(under.shipping_options[0].shipping_rate_data.fixed_amount.amount, 595);

  const over = buildSession(cart([{ slug: 'mind-lab-pro', qty: 1, plan: 'onetime' }]), config);
  assert.equal(over.shipping_options[0].shipping_rate_data.fixed_amount.amount, 0);
  assert.equal(over.shipping_options[0].shipping_rate_data.display_name, 'Free shipping');
});

test('free shipping is judged on the discounted subtotal', () => {
  // 79.50 -> 63.60 on subscription, still over the $50 threshold
  const s = buildSession(cart([{ slug: 'mind-lab-pro', qty: 1, plan: 'subscribe' }]), config);
  assert.equal(s.shipping_options[0].shipping_rate_data.fixed_amount.amount, 0);
});

test('rejects hostile carts', () => {
  assert.throws(() => cart([{ slug: 'does-not-exist', qty: 1 }]), CartError);
  assert.throws(() => cart([{ slug: 'alpha-brain', qty: 0 }]), CartError);
  assert.throws(() => cart([{ slug: 'alpha-brain', qty: -3 }]), CartError);
  assert.throws(() => cart([{ slug: 'alpha-brain', qty: 1.5 }]), CartError);
  assert.throws(() => cart([{ slug: 'alpha-brain', qty: 1000 }]), CartError);
  assert.throws(() => cart([]), CartError);
  assert.throws(() => normaliseCart(null, catalog), CartError);
  assert.throws(() => cart([{ slug: 'alpha-brain', qty: 1, plan: 'onetime' }], 7), CartError, 'unsupported interval');
  assert.throws(() => cart([
    { slug: 'alpha-brain', qty: 1, plan: 'onetime' },
    { slug: 'alpha-brain', qty: 1, plan: 'onetime' }
  ]), CartError, 'duplicate line');
});

test('an unknown plan value falls back to one-time, never to a discount', () => {
  const s = buildSession(cart([{ slug: 'alpha-brain', qty: 1, plan: 'free-please' }]), config);
  assert.equal(s.line_items[0].price_data.unit_amount, 2990);
  assert.equal(s.mode, 'payment');
});

test('form encoding uses Stripe bracket notation', () => {
  const encoded = formEncode({ mode: 'payment', line_items: [{ quantity: 2, price_data: { currency: 'usd' } }] });
  assert.ok(encoded.includes('mode=payment'));
  assert.ok(encoded.includes('line_items%5B0%5D%5Bquantity%5D=2'));
  assert.ok(encoded.includes('line_items%5B0%5D%5Bprice_data%5D%5Bcurrency%5D=usd'));
});

test('webhook verification rejects a bad signature and stale timestamps', async () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
  const t = 1_760_000_000;

  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${body}`));
  const sig = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');

  const event = await verifyWebhook(body, `t=${t},v1=${sig}`, secret, 300, t + 10);
  assert.equal(event.id, 'evt_1');

  await assert.rejects(() => verifyWebhook(body, `t=${t},v1=${'0'.repeat(64)}`, secret, 300, t + 10), /mismatch/);
  await assert.rejects(() => verifyWebhook(body, `t=${t},v1=${sig}`, secret, 300, t + 100000), /tolerance/);
  await assert.rejects(() => verifyWebhook(body, '', secret), /Missing/);
});
