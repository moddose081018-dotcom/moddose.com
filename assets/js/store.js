/* ==========================================================================
   Moddose storefront — cart, drawer, and page wiring.
   Depends on assets/js/catalog.js (window.MODDOSE_CATALOG), which is
   generated from data/products.json by tools/build.mjs.
   ========================================================================== */
(function () {
  'use strict';

  var CONFIG = {
    storageKey: 'moddose.cart.v1',
    subscribeDiscount: 0.20,
    freeShippingThreshold: 50,
    shippingFlat: 5.95,
    currency: 'USD'
  };

  var INTERVAL_KEY = 'moddose.interval.v1';
  var DEFAULT_INTERVAL = '30';

  var CATALOG = window.MODDOSE_CATALOG || [];
  var bySlug = {};
  CATALOG.forEach(function (p) { bySlug[p.slug] = p; });

  /* ── helpers ──────────────────────────────────────────────── */

  function money(n) {
    return '$' + (Math.round(n * 100) / 100).toFixed(2);
  }

  function subPrice(price) {
    return Math.round(price * (1 - CONFIG.subscribeDiscount) * 100) / 100;
  }

  function unitPrice(product, plan) {
    return plan === 'subscribe' ? subPrice(product.price) : product.price;
  }

  function read() {
    try {
      var raw = localStorage.getItem(CONFIG.storageKey);
      var items = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(items)) return [];
      return items.filter(function (i) {
        return i && bySlug[i.slug] && Number(i.qty) > 0;
      }).map(function (i) {
        return {
          slug: i.slug,
          qty: Math.min(99, Math.max(1, parseInt(i.qty, 10) || 1)),
          plan: i.plan === 'subscribe' ? 'subscribe' : 'onetime'
        };
      });
    } catch (e) {
      return [];
    }
  }

  function write(items) {
    try {
      localStorage.setItem(CONFIG.storageKey, JSON.stringify(items));
    } catch (e) { /* private mode — cart stays in memory for this page */ }
    state = items;
    emit();
  }

  var state = read();

  function emit() {
    document.dispatchEvent(new CustomEvent('moddose:cartchange', { detail: { items: state } }));
  }

  /* ── cart API ─────────────────────────────────────────────── */

  var Cart = {
    items: function () { return state.slice(); },

    count: function () {
      return state.reduce(function (n, i) { return n + i.qty; }, 0);
    },

    subtotal: function () {
      return state.reduce(function (sum, i) {
        var p = bySlug[i.slug];
        return sum + unitPrice(p, i.plan) * i.qty;
      }, 0);
    },

    savings: function () {
      return state.reduce(function (sum, i) {
        var p = bySlug[i.slug];
        var listSaving = (p.compareAt ? p.compareAt - p.price : 0) * i.qty;
        var subSaving = i.plan === 'subscribe' ? (p.price - subPrice(p.price)) * i.qty : 0;
        return sum + listSaving + subSaving;
      }, 0);
    },

    shipping: function () {
      if (state.length === 0) return 0;
      return Cart.subtotal() >= CONFIG.freeShippingThreshold ? 0 : CONFIG.shippingFlat;
    },

    total: function () { return Cart.subtotal() + Cart.shipping(); },

    add: function (slug, qty, plan) {
      if (!bySlug[slug]) return;
      qty = Math.max(1, parseInt(qty, 10) || 1);
      plan = plan === 'subscribe' ? 'subscribe' : 'onetime';
      var items = read();
      var existing = items.filter(function (i) { return i.slug === slug && i.plan === plan; })[0];
      if (existing) {
        existing.qty = Math.min(99, existing.qty + qty);
      } else {
        items.push({ slug: slug, qty: qty, plan: plan });
      }
      write(items);
    },

    setQty: function (slug, plan, qty) {
      var items = read().map(function (i) {
        if (i.slug === slug && i.plan === plan) i.qty = qty;
        return i;
      }).filter(function (i) { return i.qty > 0; });
      write(items);
    },

    remove: function (slug, plan) {
      write(read().filter(function (i) { return !(i.slug === slug && i.plan === plan); }));
    },

    /** Switch every line to one plan, merging lines that collapse together. */
    setAllPlans: function (plan) {
      plan = plan === 'subscribe' ? 'subscribe' : 'onetime';
      var merged = [];
      read().forEach(function (i) {
        var existing = merged.filter(function (m) { return m.slug === i.slug; })[0];
        if (existing) existing.qty = Math.min(99, existing.qty + i.qty);
        else merged.push({ slug: i.slug, qty: i.qty, plan: plan });
      });
      write(merged);
    },

    /** 'empty' | 'subscribe' | 'onetime' | 'mixed' */
    planState: function () {
      if (state.length === 0) return 'empty';
      var subs = state.filter(function (i) { return i.plan === 'subscribe'; }).length;
      if (subs === state.length) return 'subscribe';
      if (subs === 0) return 'onetime';
      return 'mixed';
    },

    /** What the order would save if every line switched to subscription. */
    subscriptionSaving: function () {
      return state.reduce(function (sum, i) {
        var p = bySlug[i.slug];
        return sum + (p.price - subPrice(p.price)) * i.qty;
      }, 0);
    },

    interval: function () {
      try { return localStorage.getItem(INTERVAL_KEY) || DEFAULT_INTERVAL; }
      catch (e) { return DEFAULT_INTERVAL; }
    },

    setInterval: function (days) {
      try { localStorage.setItem(INTERVAL_KEY, days); } catch (e) { /* private mode */ }
      emit();
    },

    clear: function () { write([]); }
  };

  /* ── toast ────────────────────────────────────────────────── */

  var toastEl, toastTimer;
  function toast(message) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      toastEl.setAttribute('role', 'status');
      toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2600);
  }

  /* ── line item markup ─────────────────────────────────────── */

  function lineItemHTML(item) {
    var p = bySlug[item.slug];
    var unit = unitPrice(p, item.plan);
    var was = item.plan === 'subscribe' ? '<s>' + money(p.price * item.qty) + '</s>' : '';
    return '' +
      '<div class="line-item" data-slug="' + p.slug + '" data-plan="' + item.plan + '">' +
        '<a class="li-media" href="/products/' + p.slug + '/"><img src="' + p.image + '" alt="" width="64" height="86" loading="lazy"></a>' +
        '<div class="li-main">' +
          '<a class="li-name" href="/products/' + p.slug + '/">' + p.name + '</a>' +
          '<div class="li-sub">' + p.subtitle + '</div>' +
          (item.plan === 'subscribe' ? '<span class="li-plan">Subscribe &amp; save</span>' : '') +
          '<div class="li-controls">' +
            '<div class="li-qty">' +
              '<button type="button" data-act="dec" aria-label="Decrease quantity of ' + p.name + '">&minus;</button>' +
              '<span class="qty-val">' + item.qty + '</span>' +
              '<button type="button" data-act="inc" aria-label="Increase quantity of ' + p.name + '">+</button>' +
            '</div>' +
            '<button type="button" class="li-remove" data-act="remove">Remove</button>' +
          '</div>' +
        '</div>' +
        '<div class="li-price">' + money(unit * item.qty) + was + '</div>' +
      '</div>';
  }

  function bindLineItems(root) {
    root.querySelectorAll('.line-item').forEach(function (el) {
      var slug = el.dataset.slug;
      var plan = el.dataset.plan;
      var current = state.filter(function (i) { return i.slug === slug && i.plan === plan; })[0];
      if (!current) return;
      el.querySelectorAll('[data-act]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var act = btn.dataset.act;
          if (act === 'inc') Cart.setQty(slug, plan, current.qty + 1);
          if (act === 'dec') Cart.setQty(slug, plan, current.qty - 1);
          if (act === 'remove') Cart.remove(slug, plan);
        });
      });
    });
  }

  /* ── drawer ───────────────────────────────────────────────── */

  var drawer, backdrop, lastFocus;

  function buildDrawer() {
    backdrop = document.createElement('div');
    backdrop.className = 'drawer-backdrop';
    backdrop.addEventListener('click', closeDrawer);

    drawer = document.createElement('aside');
    drawer.className = 'drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-label', 'Your cart');
    drawer.hidden = false;
    drawer.innerHTML =
      '<div class="drawer-head">' +
        '<h2>Your cart</h2>' +
        '<button type="button" class="drawer-close" aria-label="Close cart">&times;</button>' +
      '</div>' +
      '<div class="drawer-body"></div>' +
      '<div class="drawer-foot"></div>';

    document.body.appendChild(backdrop);
    document.body.appendChild(drawer);
    drawer.querySelector('.drawer-close').addEventListener('click', closeDrawer);
  }

  function renderDrawer() {
    if (!drawer) return;
    var body = drawer.querySelector('.drawer-body');
    var foot = drawer.querySelector('.drawer-foot');

    if (state.length === 0) {
      body.innerHTML =
        '<div class="empty-state">' +
          '<h3>Your cart is empty</h3>' +
          '<p>Precision-dosed basics, third-party tested, shipped monthly if you want them to be.</p>' +
          '<a href="/shop/" class="btn btn-primary">Shop all products</a>' +
        '</div>';
      foot.innerHTML = '';
      return;
    }

    body.innerHTML = state.map(lineItemHTML).join('');
    bindLineItems(body);

    var sub = Cart.subtotal();
    var remaining = CONFIG.freeShippingThreshold - sub;
    var pct = Math.min(100, (sub / CONFIG.freeShippingThreshold) * 100);
    var saved = Cart.savings();

    foot.innerHTML =
      '<div class="ship-bar">' +
        '<p>' + (remaining > 0
          ? 'You are ' + money(remaining) + ' from free shipping.'
          : 'Free shipping unlocked.') + '</p>' +
        '<div class="track"><div class="fill" style="width:' + pct + '%"></div></div>' +
      '</div>' +
      (saved > 0 ? '<div class="sum-row"><span>You save</span><span>&minus;' + money(saved) + '</span></div>' : '') +
      '<div class="sum-row total"><span>Subtotal</span><span>' + money(sub) + '</span></div>' +
      '<a href="/checkout/" class="btn btn-primary btn-block btn-lg mt-16">Checkout</a>' +
      '<a href="/cart/" class="btn btn-ghost btn-block mt-8">View cart</a>';
  }

  function openDrawer() {
    if (!drawer) return;
    lastFocus = document.activeElement;
    renderDrawer();
    backdrop.classList.add('open');
    drawer.classList.add('open');
    document.body.classList.add('no-scroll');
    drawer.querySelector('.drawer-close').focus();
    document.addEventListener('keydown', onDrawerKey);
  }

  function closeDrawer() {
    if (!drawer) return;
    backdrop.classList.remove('open');
    drawer.classList.remove('open');
    document.body.classList.remove('no-scroll');
    document.removeEventListener('keydown', onDrawerKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function onDrawerKey(e) {
    if (e.key === 'Escape') { closeDrawer(); return; }
    if (e.key !== 'Tab') return;
    var focusables = drawer.querySelectorAll('a[href], button:not([disabled]), input, select, textarea');
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* ── header ───────────────────────────────────────────────── */

  function syncHeader() {
    var n = Cart.count();
    document.querySelectorAll('[data-cart-count]').forEach(function (el) {
      el.textContent = n;
      el.dataset.empty = n === 0 ? 'true' : 'false';
    });
  }

  function wireHeader() {
    document.querySelectorAll('[data-cart-open]').forEach(function (btn) {
      btn.addEventListener('click', function (e) { e.preventDefault(); openDrawer(); });
    });
    var toggle = document.querySelector('.nav-toggle');
    var nav = document.querySelector('.main-nav');
    if (toggle && nav) {
      toggle.addEventListener('click', function () {
        var open = nav.classList.toggle('open');
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }
  }

  /* ── add-to-cart buttons ──────────────────────────────────── */

  function wireAddButtons() {
    document.querySelectorAll('[data-add]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var slug = btn.dataset.add;
        var product = bySlug[slug];
        if (!product) return;
        var scope = btn.closest('[data-buy-scope]');
        var qty = 1;
        var plan = 'onetime';
        if (scope) {
          var qtyEl = scope.querySelector('[data-qty-val]');
          if (qtyEl) qty = parseInt(qtyEl.textContent, 10) || 1;
          var checked = scope.querySelector('input[name="plan"]:checked');
          if (checked) plan = checked.value;
        }
        Cart.add(slug, qty, plan);
        toast(product.name + ' added to cart');
        openDrawer();
      });
    });
  }

  /* ── PDP buy box ──────────────────────────────────────────── */

  function wireBuyBox() {
    var scope = document.querySelector('[data-buy-scope]');
    if (!scope) return;

    scope.querySelectorAll('input[name="plan"]').forEach(function (input) {
      input.addEventListener('change', function () {
        scope.querySelectorAll('.buy-option').forEach(function (opt) {
          opt.classList.toggle('selected', opt.contains(input) && input.checked);
        });
      });
      if (input.checked) {
        var wrap = input.closest('.buy-option');
        if (wrap) wrap.classList.add('selected');
      }
    });

    var val = scope.querySelector('[data-qty-val]');
    scope.querySelectorAll('[data-qty]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var n = parseInt(val.textContent, 10) || 1;
        n = btn.dataset.qty === 'inc' ? Math.min(99, n + 1) : Math.max(1, n - 1);
        val.textContent = n;
      });
    });
  }


  /* ── shop category filter ─────────────────────────────────── */

  function wireFilters() {
    var bar = document.querySelector('[data-filter-bar]');
    var target = document.querySelector('[data-filter-target]');
    if (!bar || !target) return;
    var emptyNote = document.querySelector('[data-filter-empty]');

    bar.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-filter]');
      if (!btn) return;
      var want = btn.dataset.filter;

      bar.querySelectorAll('[data-filter]').forEach(function (b) {
        b.classList.toggle('is-active', b === btn);
      });

      var shown = 0;
      target.querySelectorAll('.product-card').forEach(function (card) {
        var cat = (card.querySelector('.pc-cat') || {}).textContent || '';
        var match = want === 'all' || cat.trim() === want;
        card.hidden = !match;
        if (match) shown++;
      });
      if (emptyNote) emptyNote.hidden = shown > 0;
    });
  }

  /* ── cart page ────────────────────────────────────────────── */

  function renderCartPage() {
    var host = document.querySelector('[data-cart-page]');
    if (!host) return;
    var summary = document.querySelector('[data-cart-summary]');

    if (state.length === 0) {
      host.innerHTML =
        '<div class="empty-state">' +
          '<h3>Your cart is empty</h3>' +
          '<p>Start with the Daily Stack, or browse everything we make.</p>' +
          '<a href="/shop/" class="btn btn-primary">Shop all products</a>' +
        '</div>';
      if (summary) summary.innerHTML = '<p class="muted small">Add something to see your total.</p>';
      return;
    }

    host.innerHTML = state.map(lineItemHTML).join('');
    bindLineItems(host);

    if (summary) {
      var saved = Cart.savings();
      var ship = Cart.shipping();
      summary.innerHTML =
        (saved > 0 ? '<div class="sum-row"><span>You save</span><span>&minus;' + money(saved) + '</span></div>' : '') +
        '<div class="sum-row"><span>Subtotal</span><span>' + money(Cart.subtotal()) + '</span></div>' +
        '<div class="sum-row"><span>Shipping</span><span>' + (ship === 0 ? 'Free' : money(ship)) + '</span></div>' +
        '<div class="sum-row"><span>Tax</span><span class="muted">Calculated at checkout</span></div>' +
        '<div class="sum-row total"><span>Total</span><span>' + money(Cart.total()) + '</span></div>' +
        '<a href="/checkout/" class="btn btn-primary btn-block btn-lg mt-16">Checkout</a>' +
        '<a href="/shop/" class="btn btn-ghost btn-block mt-8">Keep shopping</a>';
    }
  }

  /* ── checkout page ────────────────────────────────────────── */

  function renderCheckoutPage() {
    var host = document.querySelector('[data-checkout-items]');
    if (!host) return;
    var summary = document.querySelector('[data-checkout-summary]');

    if (state.length === 0) {
      host.innerHTML =
        '<div class="empty-state">' +
          '<h3>Nothing to check out</h3>' +
          '<p>Your cart is empty.</p>' +
          '<a href="/shop/" class="btn btn-primary">Shop all products</a>' +
        '</div>';
      if (summary) summary.innerHTML = '';
      return;
    }

    host.innerHTML = state.map(lineItemHTML).join('');
    bindLineItems(host);

    if (summary) {
      var ship = Cart.shipping();
      var saved = Cart.savings();
      var recurring = state
        .filter(function (i) { return i.plan === 'subscribe'; })
        .reduce(function (sum, i) { return sum + unitPrice(bySlug[i.slug], 'subscribe') * i.qty; }, 0);

      summary.innerHTML =
        (saved > 0 ? '<div class="sum-row"><span>Subscription saving</span><span>&minus;' + money(saved) + '</span></div>' : '') +
        '<div class="sum-row"><span>Subtotal</span><span>' + money(Cart.subtotal()) + '</span></div>' +
        '<div class="sum-row"><span>Shipping</span><span>' + (ship === 0 ? 'Free' : money(ship)) + '</span></div>' +
        '<div class="sum-row total"><span>Total today</span><span>' + money(Cart.total()) + '</span></div>' +
        (recurring > 0
          ? '<p class="small muted mt-8">Then ' + money(recurring) + ' every ' + Cart.interval() +
            ' days until you cancel. Skip or cancel any time.</p>'
          : '');
    }

    syncSubscriptionBox();
  }

  /* ── checkout subscription toggle ─────────────────────────── */

  function syncSubscriptionBox() {
    var box = document.querySelector('[data-sub-toggle]');
    if (!box) return;
    var wrap = document.querySelector('[data-sub-interval-wrap]');
    var saving = document.querySelector('[data-sub-saving]');
    var plan = Cart.planState();

    box.checked = plan === 'subscribe';
    box.indeterminate = plan === 'mixed';
    box.disabled = plan === 'empty';

    var panel = box.closest('.sub-toggle');
    if (panel) panel.classList.toggle('is-on', plan === 'subscribe' || plan === 'mixed');
    if (wrap) wrap.hidden = plan === 'onetime' || plan === 'empty';

    if (saving) {
      var amount = Cart.subscriptionSaving();
      saving.textContent = plan === 'subscribe'
        ? 'You are saving ' + money(Cart.savings()) + ' on this order.'
        : amount > 0
          ? 'Saves ' + money(amount) + ' on this order and every one after it.'
          : '';
    }
  }

  function wireSubscriptionToggle() {
    var box = document.querySelector('[data-sub-toggle]');
    if (!box) return;

    box.addEventListener('change', function () {
      Cart.setAllPlans(box.checked ? 'subscribe' : 'onetime');
      toast(box.checked ? 'Order set to Subscribe & Save' : 'Switched to a one-time order');
    });

    var select = document.querySelector('[data-sub-interval]');
    if (select) {
      select.value = Cart.interval();
      select.addEventListener('change', function () { Cart.setInterval(select.value); });
    }

    syncSubscriptionBox();
  }

  /* ── notify / signup forms ────────────────────────────────── */

  function wireForms() {
    document.querySelectorAll('form[data-signup]').forEach(function (form) {
      form.addEventListener('submit', function (e) {
        // No endpoint is configured yet — see README for wiring instructions.
        if (!form.getAttribute('action')) {
          e.preventDefault();
          var input = form.querySelector('input[type="email"]');
          var note = form.parentElement.querySelector('[data-form-note]');
          if (input && input.value) {
            if (note) note.textContent = 'Thanks — but heads up: no email service is connected yet, so this address was not stored. Wire an endpoint before launch.';
            input.value = '';
          }
        }
      });
    });
  }

  /* ── boot ─────────────────────────────────────────────────── */

  function boot() {
    buildDrawer();
    wireHeader();
    wireAddButtons();
    wireBuyBox();
    syncHeader();
    renderCartPage();
    renderCheckoutPage();
    wireForms();
    wireFilters();
    wireSubscriptionToggle();

    document.addEventListener('moddose:cartchange', function () {
      syncHeader();
      renderDrawer();
      renderCartPage();
      renderCheckoutPage();
    });

    // Keep tabs in sync.
    window.addEventListener('storage', function (e) {
      if (e.key === CONFIG.storageKey) { state = read(); emit(); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.Moddose = { cart: Cart, money: money, openCart: openDrawer, toast: toast, config: CONFIG };
})();
