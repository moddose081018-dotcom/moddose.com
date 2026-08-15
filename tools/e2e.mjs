#!/usr/bin/env node
/**
 * Moddose end-to-end checks.
 *
 *   npm run test:e2e
 *
 * Starts the static server on a spare port, drives a real browser through the
 * storefront, and exits non-zero on any failed assertion, console error or
 * failed request.
 *
 * Playwright is resolved from the project if installed, otherwise from a
 * global install via PLAYWRIGHT_MODULE (this repo has no runtime deps and
 * does not vendor a browser).
 */

import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 4271;
const MOCK_PORT = PORT + 1;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
const BASE = `http://localhost:${PORT}`;

const { chromium } = await (async () => {
  try {
    return await import('playwright');
  } catch {
    const fallback = process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright/index.mjs';
    try {
      return await import(fallback);
    } catch {
      console.error(
        'Playwright not found. Install it (`npm i -D playwright`) or set\n' +
        'PLAYWRIGHT_MODULE to a global playwright index.mjs.'
      );
      process.exit(2);
    }
  }
})();

const fails = [];
const noise = [];
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'pass' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
  if (!cond) fails.push(label);
};

const server = spawn(process.execPath, [join(root, 'tools', 'serve.mjs'), String(PORT)], {
  cwd: root,
  stdio: 'ignore'
});
const stop = () => { try { server.kill(); } catch {} };
process.on('exit', stop);

// Wait for the server rather than sleeping a fixed amount.
for (let i = 0; i < 50; i++) {
  try {
    const res = await fetch(BASE + '/');
    if (res.ok) break;
  } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 100));
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
page.on('console', (m) => m.type() === 'error' && noise.push('console: ' + m.text()));
page.on('pageerror', (e) => noise.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => noise.push('request failed: ' + r.url()));

const money = (t) => t.replace(/\s+/g, ' ');

/* ── home ─────────────────────────────────────────────────── */
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
ok('home renders', (await page.title()).includes('Moddose'));
ok('featured products render', (await page.locator('.product-card').count()) >= 5);
ok('shared header injected', await page.locator('.site-header .brand').isVisible());
ok('brand shown on cards', (await page.locator('.product-card .pc-cat').first().innerText()).trim().length > 0,
   (await page.locator('.product-card .pc-cat').first().innerText()).trim());
ok('trademark notice present', (await page.locator('.disclaimer').first().innerText()).includes('property of their respective owners'));
ok('FDA disclaimer present', (await page.locator('.disclaimer').last().innerText()).includes('Food and Drug Administration'));
ok('supply-size table populated', (await page.locator('.compare tbody tr').count()) >= 9);

/* ── add to cart from a card ──────────────────────────────── */
await page.locator('.product-card [data-add]').first().click();
await page.waitForTimeout(350);
ok('drawer opens on add', await page.locator('.drawer.open').isVisible());
ok('cart badge increments', (await page.locator('[data-cart-count]').first().innerText()) === '1');
await page.locator('.drawer-close').click();
await page.waitForTimeout(250);

/* ── product page: subscription pricing and quantity ──────── */
await page.goto(BASE + '/products/mind-lab-pro/', { waitUntil: 'networkidle' });
ok('product page renders', (await page.locator('h1').innerText()).includes('Mind Lab Pro'));
ok('one-time price on ladder', (await page.locator('.buy-option').first().innerText()).includes('$79.50'));
ok('subscription price is 20% off', (await page.locator('.buy-option').nth(1).innerText()).includes('$63.60'));
await page.locator('input[value="subscribe"]').check();
await page.locator('[data-qty="inc"]').click();
ok('quantity stepper works', (await page.locator('[data-qty-val]').innerText()) === '2');
await page.locator('.buy-row [data-add]').click();
await page.waitForTimeout(350);
ok('subscription line flagged in drawer', /Subscribe & save/i.test(await page.locator('.drawer').innerText()));
ok('line total = 2 x 63.60', money(await page.locator('.drawer').innerText()).includes('$127.20'));
await page.locator('.drawer-close').click();

/* ── cart page ────────────────────────────────────────────── */
await page.goto(BASE + '/cart/', { waitUntil: 'networkidle' });
ok('cart lists both lines', (await page.locator('[data-cart-page] .line-item').count()) === 2);
ok('free shipping over threshold', /Free/.test(await page.locator('[data-cart-summary]').innerText()));
await page.reload({ waitUntil: 'networkidle' });
ok('cart survives reload', (await page.locator('[data-cart-page] .line-item').count()) === 2);

/* ── checkout subscription toggle ─────────────────────────── */
// Seed a known all-one-time cart: the toggle's states depend on cart
// composition, so the earlier flow's mixed cart would mask real failures.
await page.goto(BASE + '/checkout/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.setItem('moddose.cart.v1', JSON.stringify([
  { slug: 'alpha-brain', qty: 1, plan: 'onetime' },
  { slug: 'mind-lab-pro', qty: 2, plan: 'onetime' }
])));
await page.reload({ waitUntil: 'networkidle' });

const box = page.locator('[data-sub-toggle]');
ok('subscription box is NOT pre-ticked', !(await box.isChecked()));
ok('recurring terms sit next to the box', /charged the subscription price/i.test(await page.locator('.sub-terms').innerText()));
ok('interval hidden until ticked', await page.locator('[data-sub-interval-wrap]').isHidden());
ok('checkout collects no card details',
   (await page.locator('input[type="password"], input[name*="card" i], input[autocomplete*="cc-" i]').count()) === 0);
ok('checkout states payment is not connected', (await page.locator('.notice').innerText()).includes('not connected'));

const before = await page.locator('[data-checkout-summary]').innerText();
await box.check();
await page.waitForTimeout(350);
const after = await page.locator('[data-checkout-summary]').innerText();
ok('ticking changes the total', before !== after);
ok('interval selector appears', await page.locator('[data-sub-interval]').isVisible());
ok('recurring amount disclosed', /every \d+ days/.test(after));
ok('subscription total is 20% off one-time', after.includes('$151.12'), money(after));
await box.uncheck();
await page.waitForTimeout(300);
ok('unticking reverts the total', (await page.locator('[data-checkout-summary]').innerText()) === before);

await page.evaluate(() => localStorage.removeItem('moddose.cart.v1'));
await page.reload({ waitUntil: 'networkidle' });
ok('box disabled on an empty cart', await box.isDisabled());

// Mixed carts must not claim the whole order is a subscription.
await page.evaluate(() => localStorage.setItem('moddose.cart.v1', JSON.stringify([
  { slug: 'alpha-brain', qty: 1, plan: 'onetime' },
  { slug: 'mind-lab-pro', qty: 1, plan: 'subscribe' }
])));
await page.reload({ waitUntil: 'networkidle' });
ok('mixed cart shows indeterminate', await box.evaluate((el) => el.indeterminate));
await page.evaluate(() => localStorage.removeItem('moddose.cart.v1'));

/* ── shop filter ──────────────────────────────────────────── */
await page.goto(BASE + '/shop/', { waitUntil: 'networkidle' });
const total = await page.locator('.product-card:visible').count();
ok('shop lists the full catalog', total === 9, total + ' products');
await page.locator('[data-filter="Bulk Bundle"]').click();
await page.waitForTimeout(250);
ok('category filter narrows the grid', (await page.locator('.product-card:visible').count()) === 2);

/* ── payments off: the page must say so and offer nothing ─── */
await page.goto(BASE + '/checkout/', { waitUntil: 'networkidle' });
ok('unconfigured checkout says payment is not connected',
   (await page.locator('.notice').innerText()).includes('not connected'));
ok('unconfigured checkout button is disabled',
   await page.locator('button:has-text("Checkout unavailable")').isDisabled());

/* ── payments on: rebuild against a mock endpoint ─────────── */
let captured = null;
const mock = createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders); res.end(); return;
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    captured = { url: req.url, body: JSON.parse(body || '{}') };
    res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
    res.end(JSON.stringify({ url: BASE + '/checkout/success/', id: 'cs_test_123' }));
  });
});
await new Promise((r) => mock.listen(MOCK_PORT, r));

try {
  execFileSync(process.execPath, [join(root, 'tools', 'build.mjs')], {
    cwd: root,
    env: { ...process.env, MODDOSE_CHECKOUT_ENDPOINT: `http://localhost:${MOCK_PORT}` },
    stdio: 'ignore'
  });

  await page.goto(BASE + '/checkout/', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('moddose.cart.v1', JSON.stringify([
    { slug: 'alpha-brain', qty: 1, plan: 'onetime' },
    { slug: 'mind-lab-pro', qty: 2, plan: 'subscribe' }
  ])));
  await page.reload({ waitUntil: 'networkidle' });

  ok('configured checkout drops the not-connected notice',
     !(await page.locator('.notice').innerText()).includes('not connected'));
  ok('configured checkout still collects no card details',
     (await page.locator('input[type="password"], input[name*="card" i], input[autocomplete*="cc-" i]').count()) === 0);

  await page.locator('[data-stripe-checkout]').click();
  await page.waitForURL('**/checkout/success/**', { timeout: 5000 });

  ok('posts to the /checkout route', captured && captured.url === '/checkout', captured && captured.url);
  ok('sends only slug, qty and plan',
     captured && captured.body.items.every((i) => Object.keys(i).sort().join(',') === 'plan,qty,slug'),
     JSON.stringify(captured && captured.body.items));
  ok('sends no prices', !JSON.stringify(captured.body).match(/price|amount|total/i));
  ok('sends the chosen interval', captured.body.interval === 30, String(captured.body.interval));
  ok('redirects to the URL the server returned', page.url().includes('/checkout/success/'));
  ok('success page clears the cart',
     (await page.evaluate(() => localStorage.getItem('moddose.cart.v1'))) === '[]');
  ok('cart badge resets after purchase',
     (await page.locator('[data-cart-count]').first().innerText()) === '0');
} finally {
  mock.close();
  // Restore the tracked build so CI's no-diff gate stays honest.
  execFileSync(process.execPath, [join(root, 'tools', 'build.mjs')], { cwd: root, stdio: 'ignore' });
}

/* ── mobile ───────────────────────────────────────────────── */
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok('no horizontal overflow on mobile', overflow <= 1, overflow + 'px');
await page.locator('.nav-toggle').click();
await page.waitForTimeout(250);
ok('mobile nav opens', await page.locator('.main-nav.open').isVisible());

await browser.close();
stop();

if (noise.length) {
  console.log('\nBrowser noise:');
  noise.forEach((n) => console.log('  ' + n));
}
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(', ')}` : '\nAll e2e checks passed.');
process.exit(fails.length || noise.length ? 1 : 0);
