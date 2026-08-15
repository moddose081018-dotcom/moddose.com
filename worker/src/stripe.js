/**
 * Minimal Stripe client for a Worker runtime.
 *
 * No SDK: Stripe's REST API takes form-encoded bodies, and the SDK's
 * Node dependencies do not belong in an edge runtime. Webhook signatures
 * are verified with WebCrypto.
 */

const API = 'https://api.stripe.com/v1';

/** Stripe's bracket notation for nested objects and arrays. */
export function formEncode(value, prefix = '', out = []) {
  if (value === undefined || value === null) return out;

  if (Array.isArray(value)) {
    value.forEach((v, i) => formEncode(v, `${prefix}[${i}]`, out));
  } else if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      formEncode(v, prefix ? `${prefix}[${k}]` : k, out);
    }
  } else {
    out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`);
  }
  return out;
}

export async function createCheckoutSession(session, secretKey) {
  const res = await fetch(`${API}/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formEncode(session).join('&')
  });

  const payload = await res.json();
  if (!res.ok) {
    const message = payload?.error?.message || `Stripe returned ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    err.stripeCode = payload?.error?.code;
    throw err;
  }
  return payload;
}

/** Constant-time comparison, so a signature check cannot be timed. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify a Stripe webhook signature (the `Stripe-Signature` header).
 * Returns the parsed event, or throws.
 */
export async function verifyWebhook(rawBody, header, secret, toleranceSeconds = 300, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!header) throw new Error('Missing Stripe-Signature header');

  const parts = Object.fromEntries(
    header.split(',').map((kv) => {
      const i = kv.indexOf('=');
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    })
  );

  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp)) throw new Error('Malformed signature header');
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) throw new Error('Signature timestamp outside tolerance');

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');

  // v1 may appear more than once during a secret rotation.
  const provided = header
    .split(',')
    .filter((kv) => kv.trim().startsWith('v1='))
    .map((kv) => kv.split('=')[1].trim());

  if (!provided.some((sig) => timingSafeEqual(sig, expected))) {
    throw new Error('Signature mismatch');
  }

  return JSON.parse(rawBody);
}
