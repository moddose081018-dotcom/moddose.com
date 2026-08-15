# Checkout Worker

Creates Stripe Checkout Sessions for the storefront. The site is static, so this is the
only server-side component — and it exists for one reason: **the secret key and the prices
must live somewhere the browser cannot reach.**

```
POST /checkout   { items: [{slug, qty, plan}], interval }  ->  { url, id }
POST /webhook    Stripe events, signature verified
GET  /health
```

## Why prices are not in the request

The browser sends slugs, quantities and plans. Nothing else. The Worker looks every price up
in `src/catalog.json`, which is generated from `data/products.json` by the site build, and
applies the subscription discount itself.

A cart that asks for `alpha-brain` at `$0.50` is charged `$29.90`, and there is a test that
says so. Any change that starts trusting a client-supplied amount is a bug, however
convenient it looks.

## Deploy

**Run every command from this directory.** Wrangler reads its config from the current
working directory, so running these anywhere else silently targets whatever Worker that
directory's config names — including creating a new one. Deploy first, confirm the name in
the output, and only then set secrets.

macOS / Linux:

```bash
cd path/to/moddose.com/worker
npx wrangler login
npx wrangler deploy
```

Windows PowerShell — note that `&&` is not a statement separator there, so chain with `;`
or use separate lines:

```powershell
cd path\to\moddose.com\worker
npx wrangler login
npx wrangler deploy
```

The deploy output must say `moddose-checkout` and print a `*.workers.dev` URL. **If it names
any other Worker, stop** — you are in the wrong directory, and the next command would attach
your Stripe key to something else.

Then set the secrets. These are prompted for and never written to a file:

```bash
npx wrangler secret put STRIPE_SECRET_KEY       # sk_test_... first, sk_live_... later
npx wrangler secret put STRIPE_WEBHOOK_SECRET   # whsec_... from the webhook endpoint
```

Verify they landed on the right Worker:

```bash
npx wrangler secret list
```

### If a secret went to the wrong Worker

It happens — wrangler will offer to create a Worker that does not exist rather than failing.
Remove the secret from wherever it landed, and roll the key in the Stripe dashboard if it was
a live one:

```bash
npx wrangler secret delete STRIPE_SECRET_KEY --name <wrong-worker>
npx wrangler secret delete STRIPE_WEBHOOK_SECRET --name <wrong-worker>
# or, if that Worker was created by accident and has no deployment:
npx wrangler delete --name <wrong-worker>
```

**Never put a secret key in `wrangler.toml`, in the site, or in a chat window.** If one is
ever pasted somewhere it should not be, roll it in the Stripe dashboard immediately —
rotation is free, a leaked live key is not.

Non-secret settings live in `wrangler.toml` `[vars]`: `SITE_ORIGIN` (the only allowed CORS
origin), `CURRENCY`, `SUBSCRIBE_DISCOUNT`, `FREE_SHIPPING_THRESHOLD`, `SHIPPING_FLAT`,
`AUTOMATIC_TAX`.

## Connect the site to it

Put the deployed URL in `data/site.json`:

```json
"checkout": { "endpoint": "https://moddose-checkout.<subdomain>.workers.dev" }
```

Run `npm run build` from the repo root and commit. The checkout page swaps its
"payment is not connected" notice for a live **Pay with card** button automatically — that
copy is generated from this setting, so the two cannot disagree.

## Webhooks

Add an endpoint in the Stripe dashboard pointing at `https://<worker>/webhook`, subscribed to
`checkout.session.completed`, `invoice.paid`, and `customer.subscription.deleted`. Take the
signing secret it gives you and set it as `STRIPE_WEBHOOK_SECRET`.

`src/index.js` currently logs these events. **Fulfilment is not implemented** — that is where
you record the order, notify whoever picks and packs, and email the customer. Stripe retries
webhooks, so whatever you write there has to be idempotent: the same event ID must not ship
two boxes.

## Subscriptions

A cart containing any subscription line becomes a `mode: subscription` session. One-time lines
in that cart ride along on the first invoice, which is Stripe's behaviour for non-recurring
prices in subscription mode.

The delivery interval the customer picked (30/45/60/90 days) becomes
`recurring: { interval: 'day', interval_count: N }`. Day intervals are used deliberately
rather than translating 30 days to "monthly" — the site says "every 30 days", so that is what
gets billed.

## Testing

```bash
npm test                 # from the repo root, includes the worker's 11 tests
npx wrangler dev         # local worker at http://localhost:8787, using [vars] above
```

For local testing, `wrangler dev` picks up `[vars]` from `wrangler.toml`; override
`SITE_ORIGIN` for the session with `--var SITE_ORIGIN:http://localhost:4173` rather than
adding an environment block to the config.

With `wrangler dev` running, point the site at it and rebuild:

```bash
MODDOSE_CHECKOUT_ENDPOINT=http://localhost:8787 npm run build && npm run serve
```

Use Stripe test keys and card `4242 4242 4242 4242`. Run `npm run build` again afterwards to
restore the committed output.

**None of this has been run against Stripe.** It was written to the API contract and its logic
is unit tested, but no request has ever been made with a real key from this environment. Do a
full test-mode purchase — one-time and subscription — before switching to live keys.

## Using a different payment provider

If the processor turns out not to be Stripe, most of this survives. The split is deliberate:

| File | Provider-specific? |
|---|---|
| `src/lineitems.js` | **No.** Cart validation, server-side pricing, the subscription discount, shipping rules, mixed one-time/recurring handling. Keep as is. |
| `src/stripe.js` | **Yes.** Form encoding, the session call, webhook signature verification. Replace wholesale. |
| `src/index.js` | Mostly not. Routing, CORS, error handling stay; the session payload shape and the webhook event names change. |
| `src/catalog.json` | **No.** Generated from the site build. |
| `assets/js/store.js` (site) | **No.** It posts `{items, interval}` and redirects to whatever URL comes back — that contract fits any hosted-checkout provider. |

The client contract is the part worth protecting: the browser sends slugs, quantities and
plans, and receives a URL to redirect to. Any provider offering hosted checkout fits that
shape. A provider requiring an embedded card form does not, and would drag this site into PCI
scope — treat that as a reason to choose a different provider, not a reason to change the
architecture.

Two things to confirm with a new provider before building against it:

1. **Recurring billing at arbitrary intervals.** The storefront offers 30/45/60/90 days. Some
   providers only support monthly/annual, which would mean changing what the site offers —
   a customer-facing decision, not an implementation detail.
2. **Category acceptance.** Some processors classify supplements and nootropics as high-risk
   or restricted. Get that confirmed in writing for both one-time *and* subscription billing
   before wiring anything, because subscription approval is sometimes separate.

Merchant-of-record providers (Paddle, Lemon Squeezy and similar) handle tax and subscription
management themselves and would replace more of this Worker than a gateway would — possibly
all of it, if their hosted checkout accepts a cart directly.

## Before going live

- [ ] Test-mode purchase completes, one-time and subscription
- [ ] Webhook fires and the signature verifies (`stripe listen --forward-to`)
- [ ] Fulfilment implemented and idempotent
- [ ] `SITE_ORIGIN` set to the real domain, not localhost
- [ ] Tax decision made — `AUTOMATIC_TAX` requires Stripe Tax to be configured
- [ ] Live keys set, and the test keys removed
