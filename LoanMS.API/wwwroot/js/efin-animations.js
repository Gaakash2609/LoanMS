// ════════════════════════════════════════════════════════════════
//  EFIN — Banking Animations  v1.0
//  100% additive — hooks into existing functions via safe patches.
//  Zero changes to existing logic, validation, or data flow.
// ════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  /* ── Utility ────────────────────────────────────────────────── */
  function _onReady(fn) {
    if (document.readyState !== 'loading') setTimeout(fn, 0);
    else document.addEventListener('DOMContentLoaded', fn);
  }

  // Safe function patcher — only patches once, never breaks original
  function _patch(obj, name, wrapper) {
    if (!obj || typeof obj[name] !== 'function') return;
    if (obj[name].__eaPatched) return;
    var orig = obj[name];
    obj[name] = function () {
      return wrapper.apply(this, [orig.bind(this)].concat(Array.prototype.slice.call(arguments)));
    };
    obj[name].__eaPatched = true;
  }

  // Add class for one animation cycle then remove
  function _animate(el, cls, duration) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth; // reflow
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, duration || 700);
  }

  /* ══════════════════════════════════════════════════════════════
     1. WIZARD STEP — slide-in panel + done-step pulse
  ══════════════════════════════════════════════════════════════ */
  function _animWizardStep() {
    // Slide-in the active step panel
    var active = document.querySelector('#wiz-form .wizard-body.active');
    if (active) _animate(active, 'ea-step-enter', 350);

    // Pulse the most-recently-completed step circle
    var steps = document.querySelectorAll('.wizard-step.done');
    if (steps.length) {
      var last = steps[steps.length - 1];
      var circle = last.querySelector('.step-num');
      if (circle) _animate(circle, 'ea-step-just-done', 600);
    }
  }

  /* ══════════════════════════════════════════════════════════════
     2. INITIAL OFFER — count-up on loan amount + card rise
  ══════════════════════════════════════════════════════════════ */
  function _animOfferReveal() {
    // Card entrance
    var card = document.getElementById('cam-offer-card');
    if (card && card.style.display !== 'none') {
      _animate(card, 'ea-card-rise', 500);
    }

    // Count-up on the max-amount display
    var amtEl = document.getElementById('co-max-display');
    if (!amtEl) return;
    var target = parseInt((amtEl.textContent || '0').replace(/[^\d]/g, '')) || 0;
    if (!target) return;
    var start  = 0;
    var dur    = 750; // ms
    var step   = 16;  // ~60fps
    var steps  = dur / step;
    var inc    = target / steps;
    var cur    = 0;
    var timer  = setInterval(function () {
      cur = Math.min(cur + inc, target);
      amtEl.textContent = '₹ ' + Math.round(cur).toLocaleString('en-IN') + '!';
      if (cur >= target) clearInterval(timer);
    }, step);
  }

  /* ══════════════════════════════════════════════════════════════
     3. DOCUMENT UPLOAD — green flash on doc item
  ══════════════════════════════════════════════════════════════ */
  function _animDocUploaded(itemEl) {
    if (!itemEl) return;
    _animate(itemEl, 'ea-doc-uploaded', 800);
  }

  /* ══════════════════════════════════════════════════════════════
     4. BANK CARDS — staggered fade-in
  ══════════════════════════════════════════════════════════════ */
  function _animBankCards() {
    var cards = document.querySelectorAll('#la-bank-cards > div');
    cards.forEach(function (card) {
      card.classList.remove('ea-bank-card-enter');
      void card.offsetWidth;
      card.classList.add('ea-bank-card-enter');
    });
  }

  /* ══════════════════════════════════════════════════════════════
     5. STATUS BADGE — pulse on change
  ══════════════════════════════════════════════════════════════ */
  function _animStatusBadge(appId) {
    setTimeout(function () {
      // Pulse badge in detail view if open
      var badge = document.querySelector('.status-pill, .app-status-badge, [class*="status-badge"]');
      if (badge) _animate(badge, 'ea-badge-pulse', 550);

      // Pulse row in table
      var rows = document.querySelectorAll('#app-table-body tr');
      rows.forEach(function (row) {
        if (row.textContent.includes(appId)) {
          _animate(row, 'ea-row-status-changed', 900);
        }
      });
    }, 60);
  }

  /* ══════════════════════════════════════════════════════════════
     6. DISBURSEMENT — gold shimmer on status badge
  ══════════════════════════════════════════════════════════════ */
  function _animDisburse(appId) {
    setTimeout(function () {
      var badges = document.querySelectorAll('.status-pill, [class*="status-badge"], .app-status-badge');
      badges.forEach(function (b) {
        if (!b.textContent.toLowerCase().includes('disburs')) return;
        b.classList.add('ea-disbursed-shimmer');
        setTimeout(function () { b.classList.remove('ea-disbursed-shimmer'); }, 3500);
      });
    }, 400);
  }

  /* ══════════════════════════════════════════════════════════════
     7. SUBMIT BUTTON — glow while processing
  ══════════════════════════════════════════════════════════════ */
  function _animSubmitBtn(on) {
    var btn = document.getElementById('wiz-next');
    if (!btn) return;
    if (on) btn.classList.add('ea-btn-processing');
    else    btn.classList.remove('ea-btn-processing');
  }

  /* ══════════════════════════════════════════════════════════════
     HOOK: patch window functions after they are ready
  ══════════════════════════════════════════════════════════════ */
  function _attachHooks() {

    // ── renderWizard → step slide-in + done pulse ────────────
    _patch(window, 'renderWizard', function (orig) {
      var ret = orig.apply(this, Array.prototype.slice.call(arguments, 1));
      setTimeout(_animWizardStep, 30);
      return ret;
    });

    // ── camCalculate → offer amount count-up ─────────────────
    _patch(window, 'camCalculate', function (orig) {
      var ret = orig.apply(this, Array.prototype.slice.call(arguments, 1));
      setTimeout(_animOfferReveal, 80);
      return ret;
    });

    // ── _docMarkUploaded_commit → green flash on doc item ────
    _patch(window, '_docMarkUploaded_commit', function (orig, item, file, name, pw) {
      var ret = orig.call(this, item, file, name, pw);
      _animDocUploaded(item);
      return ret;
    });

    // ── laLoadEligibility → bank card stagger ────────────────
    _patch(window, 'laLoadEligibility', function (orig) {
      var ret = orig.apply(this, Array.prototype.slice.call(arguments, 1));
      setTimeout(_animBankCards, 400); // after cards rendered
      return ret;
    });

    // ── laSaveEligibility → same stagger after save ──────────
    _patch(window, 'laSaveEligibility', function (orig) {
      var ret = orig.apply(this, Array.prototype.slice.call(arguments, 1));
      setTimeout(_animBankCards, 80);
      return ret;
    });

    // ── changeStatus → badge pulse + disbursement shimmer ────
    _patch(window, 'changeStatus', function (orig, id, newStatus, triggerEl) {
      var ret = orig.call(this, id, newStatus, triggerEl);
      _animStatusBadge(id);
      if (newStatus === 'disbursed') _animDisburse(id);
      return ret;
    });

    // ── wizardNav → submit button glow ───────────────────────
    _patch(window, 'wizardNav', function (orig, dir) {
      var { total: wTotal } = (typeof getActiveWizardSteps === 'function')
        ? getActiveWizardSteps() : { total: 9 };
      var isSubmit = (dir === 1 && typeof currentStep !== 'undefined' && currentStep === wTotal);
      if (isSubmit) _animSubmitBtn(true);
      var ret = orig.call(this, dir);
      if (isSubmit) setTimeout(function () { _animSubmitBtn(false); }, 2500);
      return ret;
    });
  }

  /* ══════════════════════════════════════════════════════════════
     BOOT — wait for app to initialise before patching
  ══════════════════════════════════════════════════════════════ */
  _onReady(function () {
    // Delay to ensure all window.* functions are set by app-core.js
    setTimeout(_attachHooks, 600);
  });

})();
