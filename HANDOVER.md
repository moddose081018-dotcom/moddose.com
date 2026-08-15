# Handover

For the next agent or developer picking this up. Read this before changing anything;
several things that look like oversights are deliberate, and a few are load-bearing.

**Repository:** `moddose081018-dotcom/moddose.com` (public)
**Live:** deploys on every push to `main`, but has no working public URL yet — see
[Deployment](#deployment).
**Stack:** static HTML/CSS/JS plus a Node build script. No runtime dependencies, no
framework, no npm install needed to build.

---

## 1. What this is

An independent online retailer selling other companies' nootropic supplements — Onnit,
Neurohacker Collective, Mind Lab Pro, Gorilla Mind, Thrivous. Nine SKUs, from a $29.90
30-count bottle to a $790 four-bottle supply.

Moddose manufactures nothing. That single fact constrains most of the copy on the site, and
it is the easiest thing for a new agent to accidentally undo. See
[Claims and positioning](#4-claims-and-positioning).

## 2. Getting oriented

```bash
npm run build      # regenerate everything derived from data/
npm test           # pricing rule unit tests (7)
npm run test:e2e   # browser checks against a real storefront (30)
npm run check      # all three, in order
npm run serve      # preview at http://localhost:4173
```

`npm run test:e2e` needs Playwright. If it is not installed in the project it falls back to
`PLAYWRIGHT_MODULE`, and `CHROMIUM_PATH` overrides the browser binary:

```bash
CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e
```

### Layout

```
data/products.json      source of truth for the catalog
data/pricing.json       the approved price ladder
data/site.json          brand, contact, shipping threshold, subscription discount
tools/pricing.mjs       price matching rule          tools/pricing.test.mjs
tools/build.mjs         the build                    tools/e2e.mjs
tools/serve.mjs         local preview server
assets/css/site.css     the whole design system — hand-written
assets/js/store.js      cart, drawer, gallery, filters — hand-written
assets/js/catalog.js    GENERATED
assets/img/*.svg        GENERATED placeholder art
assets/img/photos/      real photography goes here (README.md has the spec)
products/<slug>/        GENERATED — one page per product
index.html shop/ cart/ checkout/ about/ contact/ legal/{privacy,terms,shipping-returns}/
```

**Never hand-edit generated files.** `assets/js/catalog.js`, `assets/img/*.svg`,
`products/*/index.html`, `sitemap.xml`, `robots.txt`, `data/shopify-import.csv`, and anything
between `<!-- BUILD:x -->` markers. CI fails the deploy if a rebuild produces a diff against
what is committed, so a hand-edit is caught but only after you have pushed it.

### Shared chrome

Header, footer, product grids and the supply-size table are rendered by `tools/build.mjs` and
injected into any page containing the matching marker pair:

```html
<!-- BUILD:header -->   <!-- /BUILD:header -->
<!-- BUILD:footer -->   <!-- /BUILD:footer -->
<!-- BUILD:grid-all --> <!-- BUILD:grid-featured --> <!-- BUILD:tiers -->
```

Change the header once, rebuild, and all 27 pages update. Everything outside the markers is
hand-authored and safe to edit.

---

## 3. The price matching rule

This came from the owner as an explicit specification. Treat it as a hard invariant.

Every product price must land on an approved point from `data/pricing.json`:

```
29.90  49.80  68.70  79.50  99.50  109.00  169.00  198.00
248.00  249.00  318.00  395.00  445.00  790.00  890.00
```

At build time each product's `amazon_price` is snapped to the closest point. **Ties round up.**
Below the floor clamps to $29.90, above the ceiling clamps to $890.00. The untouched source
price is preserved as `original_price` in build data and is deliberately **stripped from
`assets/js/catalog.js`**, so it never reaches the browser or view-source. Do not add it back.

`npm run build` prints the mapping and exits non-zero if any price lands off the ladder.
`tools/pricing.test.mjs` covers every worked example the owner supplied, plus the tie and
clamp edges and the near-degenerate $248/$249 band.

To change a price, change `amazon_price` or add a ladder point. Never edit a generated page.

---

## 4. Claims and positioning

The riskiest part of this codebase is the copy, not the code. Supplement retail is regulated,
and several of these constraints exist because the alternative is unlawful rather than merely
tacky. **Every one of these was a deliberate decision. Do not quietly reverse them.**

### 4.1 Moddose does not manufacture or test anything

Formulation, testing and labelling belong to the manufacturer. The site therefore must not say
or imply that Moddose tests lots, holds certificates of analysis, or sets doses. What it does
say is that it will *request* a maker's COA on the customer's behalf and report back —
including when a manufacturer refuses.

An earlier draft of this site was own-brand and did claim third-party lot testing. If you find
leftover copy in that voice, it is a bug.

### 4.2 Brand names are used under nominative fair use

Selling genuine branded goods lets you name the brands. What keeps that lawful is the
trademark notice in the footer of every page and section 2 of the terms: brands identify
genuine products, with no implied affiliation, sponsorship or endorsement. Do not remove
either, and do not use brand logos or manufacturer marketing imagery without written
permission from the brand.

### 4.3 No fabricated reference prices

`compareAt` is supported by the catalog and rendered by the cart, and is **empty on every
product on purpose**. A struck-through price is a factual claim that the item sold at that
price. Generating one from a formula (the owner originally asked for "compare-at = +50%") is
deceptive pricing under the FTC's Guides Against Deceptive Pricing and the EU Omnibus
Directive. Populate it only from genuine prior or manufacturer list prices.

### 4.4 No drug claims, and no prescription-equivalence

The SKUs originally arrived mapped to modafinil pill tiers ("10-pill Modalert equivalent").
That framing was dropped and must not return: presenting a supplement as equivalent to,
or a substitute for, a prescription medicine makes it an unapproved new drug in the eyes of
the FDA. Tiers are labelled by what is in the box — 30 capsules, 2 bottles.

Copy stays in structure/function language. The FDA disclaimer appears in the footer of every
page and again on every product page.

### 4.5 No invented supplement facts

`keyIngredients` is empty for every SKU, and for a reseller that is probably the permanent
answer. Product pages defer to the manufacturer's physical label as the authority, because
makers reformulate without telling retailers. If you ever populate it, copy from a physical
label of stock actually held.

### 4.6 No fabricated reviews

There is no reviews section. An empty one looks worse than none, and inventing testimonials is
fraud. Add it when there are verified reviews to show.

### 4.7 Checkout never handles card data

`/checkout/` collects no card details in either state — unconnected or live. Payment happens
on Stripe's hosted page. Building a card form into this static site would drag it into PCI
scope for no benefit, and `tools/e2e.mjs` asserts the absence of card inputs both ways.

Prices are never sent from the browser. `worker/src/lineitems.js` prices every cart from its
own catalog, and a test asserts that a cart asking for a $0.50 Alpha BRAIN is charged $29.90.

### 4.8 The subscription checkbox

`/checkout/` has a tick box that converts the whole order to Subscribe & Save. Three properties
are load-bearing under ROSCA and the FTC negative-option rule:

1. **Never pre-ticked.**
2. **Recurring terms adjacent to the box** — amount, frequency, start, how to cancel — not
   behind a link.
3. **Both numbers shown** — charged today, and what recurs.

`tools/e2e.mjs` asserts all three. If you change the checkout, keep those tests passing.

---

## 5. Deployment

GitHub Actions (`.github/workflows/pages.yml`) runs the pricing tests, rebuilds, fails if the
rebuild differs from what is committed, then deploys to GitHub Pages. Pages **Source is set to
"GitHub Actions"**, not "deploy from a branch" — do not change that, the workflow owns the
deploy.

### The site must be served from a domain root

Pages link with root-relative paths — 585 of them. On
`moddose081018-dotcom.github.io/moddose.com/` every asset and link resolves above the subpath
and 404s, so that URL renders as unstyled text with broken navigation. **It is not a usable
preview.** Use `npm run serve` locally, or a custom domain. If a working subpath preview is
ever needed, add a base-path option to the build rather than converting 585 links to relative.

### Current state: no custom domain

`moddose.com` was mid-transfer to Cloudflare as of this handover and served nothing. The
Cloudflare zone exists and was pre-populated with imported records from a previous host
(A records at 35.213.177.94, an SPF referencing `sgp57.siteground.asia`, a `*.moddose.com`
wildcard). Treat all of those as stale until the transfer completes and they can be verified.

When it lands:

1. Point the apex at GitHub Pages — `CNAME @ -> moddose081018-dotcom.github.io` (Cloudflare
   flattens apex CNAMEs) or GitHub's four A records `185.199.108-111.153`. Remove the stale
   records. Keep everything **DNS only / grey cloud** until GitHub has issued the certificate;
   a proxied record breaks the ACME challenge and "Enforce HTTPS" never unlocks.
2. Set the custom domain in Settings → Pages. With the Actions source GitHub reads the domain
   from repository settings and **ignores the `CNAME` file** — the file is kept in sync anyway
   so the two never disagree.
3. Tick Enforce HTTPS once the certificate issues.
4. **Test email afterwards.** The imported SPF begins `v=spf1 +a +mx …` and `+a` authorises
   whatever the apex A record points at, so repointing the apex silently changes what SPF
   authorises. Send a test message and check the result.

---

## 6. Before this store can trade

Blocking, in rough priority order:

1. **Payment — built, never run against Stripe.** `worker/` holds a Cloudflare Worker that
   creates Checkout Sessions; the site is wired to it and switches itself on when
   `checkout.endpoint` is set in `data/site.json`. Deployment, secrets and a pre-launch
   checklist are in `worker/README.md`. The logic is unit tested (11 tests) and the client
   flow is e2e tested against a mock, but **no request has ever been made with a real Stripe
   key from this environment.** Do a full test-mode purchase, one-time and subscription,
   before going live. Two invariants: the client never sends prices, and no card input ever
   appears on this site.
2. **Email endpoint.** Signup forms have no `action` and say so on submit (`wireForms`). Add
   `action="<endpoint>" method="post"` and the fallback disables itself.
3. **Legal placeholders.** `[LEGAL ENTITY NAME]`, `[REGISTERED ADDRESS]`, `[JURISDICTION]` in
   `legal/privacy/` and `legal/terms/`. Both are a reasonable draft, not legal advice — have a
   lawyer in the operating jurisdiction review them.
4. **Verify the factual promises.** The copy asserts free shipping over $50, a flat $5.95
   below, same-day dispatch before 2pm, 60-day returns on opened product with free return
   labels, sealed manufacturer packaging, and one-business-day support replies. Each is
   enforceable. Make them true or change the copy.
5. **Supplier relationships.** The catalog assumes genuine stock in sealed manufacturer
   packaging. Confirm authorised reseller arrangements with each brand — that also unlocks
   legitimate product photography via their reseller media kits.
6. **Product photography.** The pipeline is done (`assets/img/photos/README.md`): add a
   `photos` array to a product, rebuild, and cards and the gallery pick it up, with the
   generated art as fallback. Amazon listing images are not licensed for this.

Worth doing: analytics if wanted — the privacy policy currently states there is none, so
update that page in the same commit.

---

## 7. Environment notes

Things that cost time to rediscover, from the session that built this:

- **Egress is heavily restricted.** The agent sandbox proxy 403s almost every host — including
  `github.io`, `moddose.com`, and public DNS-over-HTTPS resolvers. You cannot fetch the
  deployed site to verify it, and you cannot look up DNS. npm and the GitHub API do work.
- **No browser control.** There are no browser-automation tools in the remote session. Anything
  requiring a dashboard (Cloudflare, GitHub settings) has to be done by the user or a separate
  browser agent.
- **The GitHub App cannot create repositories** (403) and **cannot enable Pages** — first-time
  Pages enablement needs repo-owner rights in the web UI, and `actions/configure-pages` with
  `enablement: true` fails with "Resource not accessible by integration". It can push
  workflows, so CI changes are fine.
- **Force-pushes are blocked** by the sandbox classifier, as is reading git credentials.
- Playwright is available globally at `/opt/node22/lib/node_modules/playwright` with a browser
  at `/opt/pw-browsers/chromium`.

## 8. Conventions

- Work on `main`; it is the deploy branch. Branch and PR for anything substantial.
- Run `npm run check` before pushing — CI runs the same gates and a stale generated file fails
  the deploy.
- Commit messages: imperative subject, then *why* rather than a file list. Several decisions in
  this repo are only explicable from their commit messages.
- When the owner asks for something that conflicts with section 4, build the rest, say plainly
  which part you did not do and why, and offer the compliant version. That has happened twice
  already and both times the compliant version was accepted.
