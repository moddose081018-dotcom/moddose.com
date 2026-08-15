# moddose.com

Static storefront for **Moddose** — precision-dosed cognitive support supplements.

No framework, no build dependencies, no npm install. Plain HTML/CSS/JS plus a small
Node build script that generates product pages and enforces the pricing rules.

```
npm run check     # run the pricing tests, then build
npm run build     # regenerate everything derived from data/
npm run serve     # preview at http://localhost:4173
npm test          # pricing rule unit tests
```

---

## Layout

```
data/
  site.json            brand, contact, shipping threshold, subscription discount
  products.json        the catalog — source of truth for everything
  pricing.json         the approved price points
  shopify-import.csv   generated: platform import with matched prices
tools/
  pricing.mjs          price matching rule
  pricing.test.mjs     unit tests for the rule
  build.mjs            the build
  serve.mjs            local preview server
assets/
  css/site.css         the whole design system, hand-written
  js/store.js          cart, drawer, filters, page wiring — hand-written
  js/catalog.js        generated: client-side catalog
  img/*.svg            generated: product art
products/<slug>/       generated: one page per product
index.html shop/ cart/ checkout/ about/ contact/ legal/*
```

**Generated files must not be hand-edited** — `assets/js/catalog.js`, `assets/img/*.svg`,
`products/*/index.html`, `sitemap.xml`, `robots.txt`, `data/shopify-import.csv`, and anything
between `<!-- BUILD:x -->` markers. Edit `data/products.json` or `tools/build.mjs` and rebuild.

## Shared page chrome

Header, footer, product grids and the supply-size table live in `tools/build.mjs` and are
injected into any page containing the matching markers:

```html
<!-- BUILD:header -->  <!-- /BUILD:header -->
<!-- BUILD:footer -->  <!-- /BUILD:footer -->
<!-- BUILD:grid-all -->  <!-- BUILD:grid-featured -->  <!-- BUILD:tiers -->
```

Change the header once, run `npm run build`, and all 18 pages update. Everything outside
the markers is hand-authored and safe to edit.

---

## Price matching

Every product price must land on an approved price point. The ladder lives in
`data/pricing.json`:

```
29.90  49.80  68.70  79.50  99.50  109.00  169.00  198.00
248.00  249.00  318.00  395.00  445.00  790.00  890.00
```

At build time each product's source price (`amazon_price` in `data/products.json`) is snapped
to the closest point. Ties round **up**; anything below the floor becomes $29.90 and anything
above the ceiling becomes $890.00. The untouched source price is kept as `original_price` in
the build-time data only — it is **not** emitted into `assets/js/catalog.js`, so it never
reaches the browser or view-source.

`npm run build` prints the mapping and **fails the build** if any price ends up off the ladder:

```
NTRP-ALPHA-30CT     $29.98 →  $29.90 (-0.08)
NTRP-ALPHA-BLACK   $122.50 → $109.00 (-13.50)
NTRP-QUALIA-MIND   $198.00 → $198.00 (unchanged)
```

To change a price, change `amazon_price` (or add a price point) and rebuild — never edit a
generated page.

### On "compare at" prices

The catalog supports a `compareAt` field and the cart already renders the strikethrough, but
**every product ships with it empty on purpose.** A crossed-out price is a factual claim that
the item was previously sold at that price, or that it is the manufacturer's list price.
Generating one by inflating the sale price (e.g. "always 50% higher") is deceptive pricing
under the FTC's Guides Against Deceptive Pricing, the EU Omnibus Directive and equivalent
rules elsewhere, and it is one of the most commonly enforced e-commerce violations.

If you have genuine prior or list prices, put them in `compareAt` per product and they will
display everywhere immediately. The only discount currently shown is Subscribe & Save, which
is real and ongoing.

---

## Adding or changing a product

Add an object to `data/products.json` and run `npm run build`. Required fields:

| field | notes |
|---|---|
| `slug` | URL segment; becomes `/products/<slug>/` |
| `sku`, `tier` | shown on the page and exported to the CSV |
| `name`, `subtitle`, `category`, `tags` | `category` also drives the shop filter chips |
| `amazon_price` | source price; snapped to the ladder at build time |
| `count`, `servings`, `servingSize`, `form` | `form` picks the art: bottle, sachet, or 2/4-bottle |
| `colors` | `{ base, tint, cap }` — used for the SVG and the card background |
| `tagline`, `shortDesc`, `longDesc[]`, `benefits[]`, `usage`, `whoFor`, `faq[]` | page copy |
| `keyIngredients[]` | **optional** — see below |
| `inventory`, `weightKg` | CSV export and stock badge |

A new `category` value needs a matching filter chip added to `shop/index.html`.

### Supplement facts

`keyIngredients` is deliberately empty for every SKU. When it is empty the product page says
the panel is on the label and offers to email the certificate of analysis; when populated it
renders a facts table. **Fill these in from the actual product labels** — do not paraphrase
them from marketing copy, because a wrong number on an ingredient panel is a labelling problem,
not a copy problem.

---

## Before this store trades

Blocking:

1. **Payment provider.** `/checkout/` deliberately collects no card details and says so.
   Wire Stripe Checkout, Shopify Buy Buttons or similar: point the drawer's Checkout button
   (`assets/js/store.js`, `renderDrawer`) at the provider's hosted session and remove the
   notice from `checkout/index.html`. Never build a card form into this static site.
   When the cart contains subscription lines, the session must be created in the provider's
   recurring mode using the interval from `Cart.interval()` — a subscription checkbox that
   creates a one-off charge is worse than no checkbox at all.
2. **Email endpoint.** Signup forms have no `action` and say so on submit
   (`wireForms` in `store.js`). Add `action="<endpoint>" method="post"` and the fallback is
   skipped automatically.
3. **Legal placeholders.** `[LEGAL ENTITY NAME]`, `[REGISTERED ADDRESS]` and `[JURISDICTION]`
   appear in `legal/privacy/` and `legal/terms/`. Both documents are a reasonable starting
   draft, not legal advice — have a lawyer in your jurisdiction review them.
4. **Verify every factual claim.** The copy asserts third-party lot testing, accredited-lab
   certificates of analysis available on request, same-day dispatch before 2pm, free shipping
   over $50, and 60-day returns on opened product. Each is a promise a customer can hold you
   to and a regulator can test. Make them true or change the copy.

Worth doing:

- **Real product photography.** The plumbing is done: drop files in `assets/img/photos/`
  and add a `photos` array to the product in `data/products.json` (spec and shot list in
  `assets/img/photos/README.md`). Products with photos use them, products without fall back
  to the generated SVG art, and a path that does not resolve warns at build time instead of
  shipping a broken image. More than one photo turns the product page into a gallery.

  Before shooting, settle what the products actually are. The storefront currently names
  them generically ("Focus Starter", "Universal Brain Formula") while the SKUs map to
  third-party branded products. Photography forces that to resolve one way or the other:
  either sell as a curated reseller, using each item's real brand name and manufacturer
  images you have permission to use — or sell under Moddose branding, which means
  Moddose-labelled product to photograph. A generic name over a photo of someone else's
  branded bottle is the one combination that does not work.
- Customer reviews. There is no review section, because inventing testimonials is fraud and
  an empty one looks worse than none. Add it once you have verified reviews to show.
- Analytics, if you want it — the privacy policy currently states there is none, so update
  that page in the same commit.

## Subscriptions

Two places set the plan, and they share one cart:

- **Product page** — a per-line one-time/subscribe radio in the buy box.
- **Checkout** — a single tick box that switches the whole order to Subscribe & Save and
  reveals a delivery-interval selector (30/45/60/90 days, stored under
  `moddose.interval.v1`).

The box reflects cart state rather than owning it: all lines subscribed shows it ticked, a
mixed cart shows it indeterminate, an empty cart disables it. Unticking converts every line
back to one-time and merges any lines that collapse together.

Three properties of that checkbox are deliberate and should survive future edits, because
they are what keeps a recurring charge lawful in the US under ROSCA and the FTC's negative
option rule (and the equivalents elsewhere):

1. **It is never pre-ticked.** A subscription the customer did not affirmatively choose is
   the single most enforced dark pattern in e-commerce.
2. **The recurring terms sit next to the box**, not behind a link: what is charged, how
   often, when it starts, and how to cancel.
3. **The summary shows both numbers** — what is charged today and what recurs after it.

## Claims policy

Supplement copy is regulated. Everything on the site sticks to structure/function language,
the FDA disclaimer appears in the footer of every page and again on each product page, and
nothing is described as treating, preventing or substituting for any medication or condition —
including any implication of equivalence to a prescription drug. Keep new copy inside those
lines; it is the difference between a supplement and an unapproved new drug.

## Deployment

GitHub Actions deploys every push to `main` (`.github/workflows/pages.yml`). Pages is
configured with **Source: GitHub Actions**, not "deploy from a branch".

**The site must be served from a domain root, not a subpath.** Pages are linked with
root-relative paths (`/assets/...`, `/shop/`), so
`moddose081018-dotcom.github.io/moddose.com/` renders unstyled with broken navigation.
That URL is not a usable preview — use a custom domain, or `npm run serve` locally.

### Current state: no custom domain

`moddose.com` is mid-transfer to Cloudflare and is not yet serving anything. Until the
transfer completes there is no working public preview — the github.io subpath URL cannot
serve this site correctly (see above). Use `npm run serve` for an accurate local view.

The Cloudflare zone was pre-populated on creation with records imported from the previous
host (A records at 35.213.177.94, an SPF referencing `sgp57.siteground.asia`, and a
`*.moddose.com` wildcard). Treat those as stale until the transfer lands and they can be
verified.

### When the transfer completes

1. Point the apex at GitHub Pages, either `CNAME @ -> moddose081018-dotcom.github.io`
   (Cloudflare flattens apex CNAMEs) or GitHub's four A records: 185.199.108.153,
   185.199.109.153, 185.199.110.153, 185.199.111.153. Remove the stale A records.
   Keep everything **DNS only** (grey cloud) until GitHub has issued the certificate —
   proxied records break the certificate challenge.
2. Set the custom domain to `moddose.com` in Settings -> Pages. With the GitHub Actions
   source, GitHub reads the domain from repository settings; the `CNAME` file here is
   kept in sync so the two never disagree.
3. Tick **Enforce HTTPS** once the certificate is issued.
4. **Check email afterwards.** If the imported SPF record is kept, it begins
   `v=spf1 +a +mx ...` and the `+a` mechanism authorises whatever the apex A record points
   at — so repointing the apex changes what SPF authorises. Send a test message and check
   the SPF result rather than assuming.

Note that the `*.moddose.com` wildcard catches any subdomain without an explicit record,
so a staging subdomain would need its own record rather than relying on it.
