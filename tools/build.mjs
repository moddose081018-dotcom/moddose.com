#!/usr/bin/env node
/**
 * Moddose site build.
 *
 *   node tools/build.mjs
 *
 * Reads  : data/site.json, data/pricing.json, data/products.json
 * Writes : assets/img/<slug>.svg      product art
 *          assets/js/catalog.js       client catalog (no internal pricing metadata)
 *          products/<slug>/index.html product pages
 *          sitemap.xml, robots.txt
 *          data/shopify-import.csv    platform import with matched prices
 *          + injects shared header/footer/grids into every page with BUILD markers
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { applyPriceMatching, loadPricePoints } from './pricing.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const readJSON = (p) => JSON.parse(read(p));
const write = (p, s) => {
  mkdirSync(dirname(join(root, p)), { recursive: true });
  writeFileSync(join(root, p), s);
};

const site = readJSON('data/site.json');
const pricePoints = loadPricePoints(join(root, 'data', 'pricing.json'));
const source = readJSON('data/products.json');

/* ── 1. price matching ─────────────────────────────────────── */

const photoWarnings = [];

/**
 * Real photography when it exists, generated SVG art when it does not.
 * A `photos` entry pointing at a missing file warns and falls back rather
 * than shipping a broken image.
 */
function resolveMedia(p) {
  const art = `/assets/img/${p.slug}.svg`;
  const photos = (p.photos || []).filter((rel) => {
    const exists = existsSync(join(root, rel.replace(/^\//, '')));
    if (!exists) photoWarnings.push(`${p.slug}: missing ${rel}`);
    return exists;
  });
  return { media: photos.length ? photos : [art], hasPhotos: photos.length > 0, art };
}

const products = applyPriceMatching(source, pricePoints).map((p) => {
  const { media, hasPhotos, art } = resolveMedia(p);
  return {
    ...p,
    media,
    hasPhotos,
    art,
    image: media[0],
    url: `/products/${p.slug}/`
  };
});

const priceReport = products.map((p) => ({
  sku: p.sku,
  source: p.original_price,
  matched: p.price,
  moved: Math.round((p.price - p.original_price) * 100) / 100
}));


const PHOTO_ALT = {
  "alpha-brain": "Alpha BRAIN Onnit",
  "gorilla-mind-energy-focus": "Energy & Focus Gorilla Mind",
  "qualia-day-night-bundle": "Qualia Mind + Qualia Night Neurohacker Collective",
  "mind-lab-pro": "Mind Lab Pro",
  "qualia-mind": "Qualia Mind Neurohacker Collective",
  "thrivous-day-night-stack": "Complete Day & Night Stack Thrivous",
  "qualia-mind-2-bottle": "Qualia Mind Neurohacker Collective",
  "qualia-mind-4-bottle": "Qualia Mind Neurohacker Collective",
  "alpha-brain-black-label": "Alpha BRAIN Black Label Onnit"
};

function photoAlt(p) {
  if (p.hasPhotos && PHOTO_ALT[p.slug]) return PHOTO_ALT[p.slug];
  return `${p.name} — ${p.count}`;
}

/* ── 2. helpers ────────────────────────────────────────────── */

const money = (n) => '$' + n.toFixed(2);
const subPrice = (n) => Math.round(n * (1 - site.subscribeDiscount) * 100) / 100;
const esc = (s = '') =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const CHECK = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13.5 4.5 6.2 11.8 2.5 8.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/* ── 3. product art ────────────────────────────────────────── */

/**
 * Placeholder art shown until real photography exists.
 *
 * Deliberately generic: no brand name and no imitation of a manufacturer's
 * label. These are other companies' products, and drawing an invented label
 * for one would misrepresent what arrives in the box.
 */
function labelBlock(p, base) {
  const font = 'system-ui,-apple-system,Segoe UI,sans-serif';
  return `<rect x="58" y="122" width="44" height="1.6" rx=".8" fill="${base}" opacity=".22"/>
      <rect x="66" y="132" width="28" height="1.6" rx=".8" fill="${base}" opacity=".16"/>
      <text x="80" y="156" text-anchor="middle" font-family="${font}" font-size="7.4" font-weight="600" letter-spacing=".7" fill="${base}" opacity=".75">${esc(p.count.toUpperCase())}</text>
      <text x="80" y="172" text-anchor="middle" font-family="${font}" font-size="6.2" letter-spacing=".9" fill="${base}" opacity=".45">PHOTO PENDING</text>`;
}

function bottleSVG(p) {
  const { base, tint, cap } = p.colors;
  const shape = /sachet|powder/i.test(p.form) ? 'sachet' : 'bottle';
  const bottles = /^Four/i.test(p.form) ? 4 : /^Two/i.test(p.form) ? 2 : 1;
  const block = labelBlock(p, base);

  const one = (x, scale = 1, opacity = 1) => `
    <g transform="translate(${x},0) scale(${scale})" opacity="${opacity}">
      <rect x="52" y="14" width="56" height="26" rx="6" fill="${cap}"/>
      <rect x="44" y="36" width="72" height="16" rx="5" fill="${base}"/>
      <rect x="34" y="48" width="92" height="176" rx="18" fill="${base}"/>
      <rect x="34" y="48" width="92" height="176" rx="18" fill="url(#sheen)"/>
      <rect x="44" y="96" width="72" height="94" rx="9" fill="${tint}"/>
      <rect x="56" y="108" width="48" height="2.4" rx="1.2" fill="${base}" opacity=".3"/>
      ${block}
    </g>`;

  const sachet = `
    <g>
      <path d="M40 26h80a6 6 0 0 1 6 6v186a6 6 0 0 1-6 6H40a6 6 0 0 1-6-6V32a6 6 0 0 1 6-6z" fill="${base}"/>
      <path d="M40 26h80a6 6 0 0 1 6 6v186a6 6 0 0 1-6 6H40a6 6 0 0 1-6-6V32a6 6 0 0 1 6-6z" fill="url(#sheen)"/>
      <rect x="34" y="26" width="92" height="12" fill="${cap}"/>
      <rect x="34" y="212" width="92" height="12" fill="${cap}"/>
      <rect x="44" y="96" width="72" height="94" rx="9" fill="${tint}"/>
      <rect x="56" y="108" width="48" height="2.4" rx="1.2" fill="${base}" opacity=".3"/>
      ${block}
    </g>`;

  let body;
  if (shape === 'sachet') body = sachet;
  else if (bottles === 2) body = one(-26, .86, .55) + one(14);
  else if (bottles === 4) body = one(-44, .74, .35) + one(-24, .82, .45) + one(-4, .9, .7) + one(20);
  else body = one(0);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 240" width="160" height="240" role="img" aria-label="${esc(p.name)} — ${esc(p.count)}">
  <defs>
    <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#fff" stop-opacity=".22"/>
      <stop offset=".38" stop-color="#fff" stop-opacity="0"/>
      <stop offset=".78" stop-color="#000" stop-opacity=".08"/>
    </linearGradient>
  </defs>
  <ellipse cx="80" cy="230" rx="52" ry="7" fill="#14161A" opacity=".07"/>
  ${body}
</svg>`;
}

products.forEach((p) => write(`assets/img/${p.slug}.svg`, bottleSVG(p)));

/* ── 4. client catalog (internal pricing metadata stripped) ── */

const clientCatalog = products.map((p) => ({
  slug: p.slug,
  sku: p.sku,
  name: p.name,
  brand: p.brand,
  subtitle: p.subtitle,
  category: p.category,
  price: p.price,
  compareAt: p.compareAt ?? null,
  count: p.count,
  servings: p.servings,
  image: p.image,
  url: p.url
}));

// The env override lets staging and the e2e suite build against a different
// endpoint without editing tracked config.
const checkoutEndpoint =
  process.env.MODDOSE_CHECKOUT_ENDPOINT || (site.checkout && site.checkout.endpoint) || '';

write(
  'assets/js/config.js',
  '/* Generated by tools/build.mjs — do not edit. Source: data/site.json */\n' +
    'window.MODDOSE_CONFIG = ' +
    JSON.stringify(
      {
        checkoutEndpoint,
        subscribeDiscount: site.subscribeDiscount,
        freeShippingThreshold: site.freeShippingThreshold,
        shippingFlat: (site.checkout && site.checkout.shippingFlat) ?? 5.95
      },
      null,
      2
    ) +
    ';\n'
);

// The Worker prices from its own copy so a tampered cart cannot set prices.
write(
  'worker/src/catalog.json',
  JSON.stringify(
    Object.fromEntries(
      products.map((p) => [p.slug, { brand: p.brand, name: p.name, price: p.price, sku: p.sku }])
    ),
    null,
    2
  ) + '\n'
);

write(
  'assets/js/catalog.js',
  '/* Generated by tools/build.mjs — do not edit. Source: data/products.json */\n' +
    'window.MODDOSE_CATALOG = ' + JSON.stringify(clientCatalog, null, 2) + ';\n'
);

/* ── 5. shared chrome ──────────────────────────────────────── */

function header() {
  return `<div class="announce">Free shipping over ${money(site.freeShippingThreshold)} &nbsp;·&nbsp; <strong>${site.guaranteeDays}-day returns, opened or not</strong></div>
<header class="site-header">
  <div class="wrap">
    <a href="/" class="brand" aria-label="${site.brand} home">
      <svg class="brand-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <rect width="32" height="32" rx="9" fill="#1E4D3B"/>
        <circle cx="16" cy="16" r="8.5" stroke="#FCFAF7" stroke-width="1.6"/>
        <path d="M16 7.5v17" stroke="#FCFAF7" stroke-width="1.6"/>
        <path d="M16 16a8.5 8.5 0 0 0 0-8.5z" fill="#C9832B"/>
      </svg>
      ${site.brand}
    </a>
    <button class="nav-toggle" aria-label="Menu" aria-expanded="false" aria-controls="main-nav"><span></span></button>
    <nav class="main-nav" id="main-nav">
      <a href="/shop/">Shop</a>
      <a href="/shop/#tiers">Supply sizes</a>
      <a href="/about/">Standards</a>
      <a href="/contact/">Contact</a>
    </nav>
    <div class="header-actions">
      <a href="/shop/" class="btn btn-primary btn-sm">Shop</a>
      <button type="button" class="icon-btn" data-cart-open aria-label="Open cart">
        Cart <span class="cart-count" data-cart-count data-empty="true">0</span>
      </button>
    </div>
  </div>
</header>`;
}

function footer() {
  return `<footer class="site-footer">
  <div class="wrap">
    <div class="footer-top">
      <div class="footer-brand">
        <a href="/" class="brand">
          <svg class="brand-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <rect width="32" height="32" rx="9" fill="#F4F1EB"/>
            <circle cx="16" cy="16" r="8.5" stroke="#14161A" stroke-width="1.6"/>
            <path d="M16 7.5v17" stroke="#14161A" stroke-width="1.6"/>
            <path d="M16 16a8.5 8.5 0 0 0 0-8.5z" fill="#C9832B"/>
          </svg>
          ${site.brand}
        </a>
        <p>${site.tagline} We stock only makers who disclose their doses, and we price the same for everyone.</p>
      </div>
      <div class="footer-col">
        <h4>Shop</h4>
        <a href="/shop/">All products</a>
        <a href="/shop/#tiers">Supply sizes</a>
        ${products
          .filter((p) => p.featured)
          .slice(0, 2)
          .map((p) => `<a href="${p.url}">${p.brand} ${p.name}</a>`)
          .join('\n        ')}
      </div>
      <div class="footer-col">
        <h4>Company</h4>
        <a href="/about/">Our standards</a>
        <a href="/contact/">Contact</a>
        <a href="/legal/shipping-returns/">Shipping &amp; returns</a>
      </div>
      <div class="footer-col">
        <h4>Legal</h4>
        <a href="/legal/privacy/">Privacy</a>
        <a href="/legal/terms/">Terms of service</a>
        <a href="/legal/shipping-returns/">Refund policy</a>
      </div>
    </div>
    <p class="disclaimer">${site.brand} is an independent retailer. All product names, brands and trademarks are the property of their respective owners and are used here to identify the genuine products we sell. Use of a brand name does not imply any affiliation with, sponsorship by, or endorsement from its owner. Product formulations, labels and packaging are set by their manufacturers and may change without notice &mdash; the label on the product you receive is the authority.</p>
    <p class="disclaimer"><strong>These statements have not been evaluated by the Food and Drug Administration. These products are not intended to diagnose, treat, cure, or prevent any disease.</strong> Dietary supplements are not a substitute for a varied diet, adequate sleep or medical care. Consult a qualified healthcare professional before starting any supplement, particularly if you are pregnant or breastfeeding, under 18, taking prescription medication, or managing a health condition. Not for sale to anyone under 18.</p>
    <div class="footer-bottom">
      <span>&copy; ${site.year} ${site.brand}. All rights reserved.</span>
      <span>${site.domain}</span>
    </div>
  </div>
</footer>`;
}

/* ── 6. product cards & tier ladder ────────────────────────── */

function card(p) {
  const badge = p.badge
    ? `<span class="badge${p.badge === 'Most popular' ? ' badge-sand' : ''}">${esc(p.badge)}</span>`
    : '';
  return `<article class="product-card" data-category="${esc(p.category)}" style="--pc-tint:${p.colors.tint}">
  ${badge}
  <a class="pc-media${p.hasPhotos ? ' has-photo' : ''}" href="${p.url}" aria-label="${esc(p.name)}">
    <img src="${p.image}" alt="${esc(photoAlt(p))}"${p.hasPhotos ? '' : ' width="160" height="240"'} loading="lazy">
  </a>
  <div class="pc-body">
    <p class="pc-cat">${esc(p.brand)}</p>
    <h3><a href="${p.url}">${esc(p.name)}</a></h3>
    <p class="pc-sub">${esc(p.subtitle)}${p.count && p.count !== p.subtitle ? ' · ' + esc(p.count) : ''}</p>
    <p class="pc-desc">${esc(p.shortDesc)}</p>
    <div class="pc-foot">
      <div>
        <span class="pc-price">${money(p.price)}</span>
        <span class="pc-serv">${money(subPrice(p.price))} on subscription</span>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" data-add="${p.slug}">Add</button>
    </div>
  </div>
</article>`;
}

function grid(list) {
  return `<div class="product-grid">\n${list.map(card).join('\n')}\n</div>`;
}

function tierLadder() {
  const rows = products
    .slice()
    .sort((a, b) => a.price - b.price)
    .map(
      (p) => `<tr>
      <th scope="row"><span class="t-prod"><img class="t-thumb" src="${p.image}" alt="${esc(photoAlt(p))}" width="40" height="40"><span class="t-prod-text"><a href="${p.url}">${esc(p.name)}</a><span class="t-brand">${esc(p.brand)}</span></span></span></th>
      <td style="text-align:left">${esc(p.count)}</td>
      <td style="text-align:left">${esc(p.category)}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums">${money(p.price)}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums">${money(subPrice(p.price))}</td>
    </tr>`
    )
    .join('\n');

  return `<div class="table-scroll">
  <table class="compare">
    <thead>
      <tr>
        <th scope="col">Product</th>
        <th scope="col" style="color:var(--ink-3)">Supply</th>
        <th scope="col" style="color:var(--ink-3)">Category</th>
        <th scope="col" style="text-align:right;color:var(--ink-3)">One-time</th>
        <th scope="col" style="text-align:right">Subscribe</th>
      </tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
</div>`;
}

/* ── 7. product pages ──────────────────────────────────────── */

function pdp(p) {
  const sub = subPrice(p.price);
  const benefits = (p.whyWeStockIt || p.benefits || [])
    .map(
      (b) => `<li>${CHECK}<div><strong>${esc(b.title)}</strong><p>${esc(b.text)}</p></div></li>`
    )
    .join('\n');

  const ingredients = (p.keyIngredients || []).length
    ? `<div class="facts"><table>
${p.keyIngredients
  .map(
    (i) =>
      `<tr><th scope="row">${esc(i.name)}${i.note ? `<span class="note">${esc(i.note)}</span>` : ''}</th><td>${esc(i.amount)}</td></tr>`
  )
  .join('\n')}
</table></div>`
    : `<p class="muted small">We do not reprint ${esc(p.brand)}'s supplement facts panel here, because the label that ships with your bottle is the authority and formulations change. Read the panel on the product itself, or email <a href="mailto:${site.supportEmail}">${site.supportEmail}</a> and we will send a photograph of the current label before you buy.</p>`;

  const faq = (p.faq || [])
    .map(
      (f) => `<details>
      <summary>${esc(f.q)}</summary>
      <div class="acc-body"><p>${esc(f.a)}</p></div>
    </details>`
    )
    .join('\n');

  const related = products.filter((r) => r.slug !== p.slug).slice(0, 4);

  const jsonld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: `${p.brand} ${p.name} — ${p.subtitle}`,
    sku: p.sku,
    category: p.category,
    description: p.shortDesc,
    image: `${site.url}${p.image}`,
    brand: { '@type': 'Brand', name: p.brand },
    offers: {
      '@type': 'Offer',
      url: `${site.url}${p.url}`,
      priceCurrency: 'USD',
      price: p.price.toFixed(2),
      availability: p.inventory > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      seller: { '@type': 'Organization', name: site.brand, url: site.url }
    }
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.brand)} ${esc(p.name)} — ${esc(p.subtitle)} | ${site.brand}</title>
<meta name="description" content="${esc(p.shortDesc)}">
<link rel="canonical" href="${site.url}${p.url}">
<meta property="og:type" content="product">
<meta property="og:title" content="${esc(p.brand)} ${esc(p.name)} — ${esc(p.subtitle)} | ${site.brand}">
<meta property="og:description" content="${esc(p.shortDesc)}">
<meta property="og:url" content="${site.url}${p.url}">
<meta property="og:image" content="${site.url}${p.image}">
<link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/css/site.css">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
</head>
<body data-page="shop">
<a class="skip-link" href="#main">Skip to content</a>
<!-- BUILD:header -->
<!-- /BUILD:header -->

<main id="main">
<div class="wrap">
  <nav class="breadcrumb" aria-label="Breadcrumb">
    <a href="/">Home</a><span>/</span><a href="/shop/">Shop</a><span>/</span>${esc(p.name)}
  </nav>

  <div class="pdp" data-buy-scope>
    <div class="pdp-media" data-gallery>
      <div class="pdp-figure${p.hasPhotos ? ' has-photo' : ''}" style="--pdp-tint:${p.colors.tint}">
        <img src="${p.image}" alt="${esc(photoAlt(p))}"${p.hasPhotos ? '' : ' width="260" height="390"'} data-gallery-main>
      </div>
      ${
        p.media.length > 1
          ? `<div class="pdp-thumbs" role="group" aria-label="${esc(p.name)} images">
        ${p.media
          .map(
            (src, i) =>
              `<button type="button" class="pdp-thumb${i === 0 ? ' is-active' : ''}" data-gallery-thumb="${src}" aria-label="View image ${i + 1} of ${p.media.length}"><img src="${src}" alt="" loading="lazy"></button>`
          )
          .join('\n        ')}
      </div>`
          : ''
      }
      <div class="pdp-figure-notes">
        <span class="chip">${esc(p.count)}</span>
        ${p.servings ? `<span class="chip">${esc(p.servings)} servings</span>` : ''}
        <span class="chip">SKU ${esc(p.sku)}</span>
      </div>
    </div>

    <div class="pdp-info">
      <p class="kicker">${esc(p.brand)}</p>
      <h1>${esc(p.name)}</h1>
      <p class="pdp-sub">${esc(p.subtitle)}${p.form && p.form !== p.subtitle ? ' · ' + esc(p.form) : ''}</p>
      <p class="pdp-tagline">${esc(p.tagline)}</p>
      <div class="pdp-desc">
        ${(p.longDesc || []).map((t) => `<p>${esc(t)}</p>`).join('\n        ')}
      </div>

      <div class="buy-box">
        <label class="buy-option selected">
          <input type="radio" name="plan" value="onetime" checked>
          <div class="bo-main">
            <div class="bo-title"><span>One-time purchase</span><span>${money(p.price)}</span></div>
            <p class="bo-note">${esc(p.count)}. Ships once.</p>
          </div>
        </label>
        <label class="buy-option">
          <input type="radio" name="plan" value="subscribe">
          <div class="bo-main">
            <div class="bo-title">
              <span>Subscribe &amp; save <span class="save-pill">Save ${site.subscribeDiscount * 100}%</span></span>
              <span>${money(sub)}</span>
            </div>
            <p class="bo-note">Delivered on your schedule. Skip, pause or cancel any time from your account.</p>
          </div>
        </label>

        <div class="buy-row">
          <div class="qty">
            <button type="button" data-qty="dec" aria-label="Decrease quantity">&minus;</button>
            <span class="qty-val" data-qty-val aria-live="polite">1</span>
            <button type="button" data-qty="inc" aria-label="Increase quantity">+</button>
          </div>
          <button type="button" class="btn btn-primary btn-block btn-lg" data-add="${p.slug}">Add to cart</button>
        </div>

        <div class="buy-meta">
          <span>${CHECK} Free shipping over ${money(site.freeShippingThreshold)}</span>
          <span>${CHECK} ${site.guaranteeDays}-day returns</span>
          <span>${CHECK} ${p.inventory > 0 ? 'In stock' : 'Backordered'}</span>
        </div>
      </div>

      <h2 class="mb-16" style="font-size:22px">Why we stock it</h2>
      <ul class="benefit-list">${benefits}</ul>

      <h2 class="mt-32 mb-16" style="font-size:22px">Ingredients</h2>
      ${ingredients}

      <h2 class="mt-32 mb-16" style="font-size:22px">How to take it</h2>
      <p class="lede" style="font-size:16px">${esc(p.usage)}</p>
      <p class="muted small mt-8"><strong>Who it's for:</strong> ${esc(p.whoFor)}</p>

      <h2 class="mt-32 mb-16" style="font-size:22px">Questions</h2>
      <div class="accordion">${faq}</div>

      <div class="callout mt-32">
        <p class="small mb-0">These statements have not been evaluated by the Food and Drug Administration. This product is not intended to diagnose, treat, cure, or prevent any disease. Speak to a qualified healthcare professional before use if you are pregnant, breastfeeding, under 18, taking medication or managing a health condition.</p>
      </div>
    </div>
  </div>
</div>

<section class="section section-alt">
  <div class="wrap">
    <div class="section-head"><p class="kicker">Keep looking</p><h2>Other supply sizes</h2></div>
    ${grid(related)}
  </div>
</section>
</main>

<!-- BUILD:footer -->
<!-- /BUILD:footer -->
<script src="/assets/js/config.js"></script>
<script src="/assets/js/catalog.js"></script>
<script src="/assets/js/store.js"></script>
</body>
</html>
`;
}

products.forEach((p) => write(`products/${p.slug}/index.html`, pdp(p)));

/* ── 8. inject shared regions into every page ──────────────── */

const checkoutNotice = checkoutEndpoint
  ? `<div class="notice notice-ok">
  <p><strong>Secure checkout.</strong> Card details are entered on Stripe's own payment page and never touch this site. You will be returned here once the payment completes.</p>
</div>`
  : `<div class="notice">
  <p><strong>Payment is not connected on this store yet.</strong> Card processing has to be handled by a PCI-compliant provider, so this page deliberately does not ask for card details. Set <code>checkout.endpoint</code> in <code>data/site.json</code> to the deployed checkout Worker to switch payments on.</p>
</div>`;

const REGIONS = {
  header: header(),
  'checkout-notice': checkoutNotice,
  'checkout-action': checkoutEndpoint
    ? `<button type="button" class="btn btn-primary btn-block btn-lg" data-stripe-checkout>Pay with card</button>
<p class="small muted mt-8" data-checkout-error role="alert"></p>`
    : `<button type="button" class="btn btn-primary btn-block btn-lg" disabled>Checkout unavailable</button>`,
  footer: footer(),
  'grid-all': grid(products),
  'grid-featured': grid(products.filter((p) => p.featured)),
  tiers: tierLadder()
};

function htmlFiles(dir, acc = []) {
  for (const entry of readdirSync(join(root, dir))) {
    if (entry.startsWith('.') || entry === 'node_modules' || entry === 'tools') continue;
    const rel = join(dir, entry);
    if (statSync(join(root, rel)).isDirectory()) htmlFiles(rel, acc);
    else if (entry.endsWith('.html')) acc.push(rel);
  }
  return acc;
}

let injected = 0;
for (const file of htmlFiles('.')) {
  let html = read(file);
  const before = html;
  for (const [name, content] of Object.entries(REGIONS)) {
    const re = new RegExp(`(<!-- BUILD:${name} -->)[\\s\\S]*?(<!-- /BUILD:${name} -->)`, 'g');
    html = html.replace(re, (_m, open, close) => `${open}\n${content}\n${close}`);
  }
  if (html !== before) {
    write(file, html);
    injected++;
  }
}

/* ── 9. sitemap, robots, favicon ───────────────────────────── */

const staticPages = ['/', '/shop/', '/about/', '/contact/', '/cart/', '/checkout/', '/checkout/success/', '/legal/privacy/', '/legal/terms/', '/legal/shipping-returns/'];
const urls = [...staticPages, ...products.map((p) => p.url)];

write(
  'sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        (u) =>
          `  <url><loc>${site.url}${u}</loc><changefreq>weekly</changefreq><priority>${u === '/' ? '1.0' : u.startsWith('/products/') ? '0.8' : '0.6'}</priority></url>`
      )
      .join('\n') +
    `\n</urlset>\n`
);

write('robots.txt', `User-agent: *\nAllow: /\nDisallow: /checkout/\nDisallow: /cart/\n\nSitemap: ${site.url}/sitemap.xml\n`);

write(
  'assets/img/favicon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="9" fill="#1E4D3B"/><circle cx="16" cy="16" r="8.5" stroke="#FCFAF7" stroke-width="1.6" fill="none"/><path d="M16 7.5v17" stroke="#FCFAF7" stroke-width="1.6"/><path d="M16 16a8.5 8.5 0 0 0 0-8.5z" fill="#C9832B"/></svg>\n`
);

/* ── 10. platform import CSV (matched prices) ──────────────── */

const csvCell = (v = '') => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const csvHeader = [
  'Handle', 'Title', 'Body (HTML)', 'Vendor', 'Product Category', 'Type', 'Tags',
  'Price', 'Compare At Price', 'SKU', 'Barcode', 'Weight',
  'Variant Inventory Tracker', 'Variant Inventory Qty',
  'Option1 Name', 'Option1 Value'
];

const csvRows = products.map((p) => [
  p.slug,
  `${p.name} (${p.count})`,
  `<p>${p.shortDesc}</p>`,
  site.brand,
  'Supplements',
  p.category,
  (p.tags || []).join(','),
  p.price.toFixed(2),
  p.compareAt ? p.compareAt.toFixed(2) : '',
  p.sku,
  '',
  p.weightKg,
  'shopify',
  p.inventory,
  'Supply size',
  p.count
]);

write(
  'data/shopify-import.csv',
  [csvHeader, ...csvRows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n'
);

/* ── 11. report ────────────────────────────────────────────── */

console.log('\nPrice matching (source → approved point)');
console.log('─'.repeat(58));
for (const r of priceReport) {
  const arrow = r.moved === 0 ? ' (unchanged)' : r.moved > 0 ? ` (+${r.moved.toFixed(2)})` : ` (${r.moved.toFixed(2)})`;
  console.log(`  ${r.sku.padEnd(20)} ${money(r.source).padStart(9)} → ${money(r.matched).padStart(9)}${arrow}`);
}

const offLadder = products.filter((p) => !pricePoints.includes(p.price));
if (offLadder.length) {
  console.error('\nERROR: prices off the approved ladder: ' + offLadder.map((p) => p.sku).join(', '));
  process.exit(1);
}

if (photoWarnings.length) {
  console.warn('\nPhoto references that do not resolve (using generated art instead)');
  console.warn('─'.repeat(58));
  photoWarnings.forEach((w) => console.warn('  ' + w));
}

const withPhotos = products.filter((p) => p.hasPhotos).length;

console.log('\nBuilt');
console.log(`  ${withPhotos}/${products.length} products using real photography`);
console.log(`  ${products.length} product pages, ${products.length} SVGs`);
console.log(`  ${injected} pages had shared regions injected`);
console.log('  sitemap.xml, robots.txt, data/shopify-import.csv\n');
