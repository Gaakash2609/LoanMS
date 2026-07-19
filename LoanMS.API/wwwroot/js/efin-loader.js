/**
 * EFIN — Unified Loading System
 * Single API for every loading state in the application.
 *
 * Usage:
 *   eLoader.show('Saving…')          — full-page overlay
 *   eLoader.hide()                    — hide full-page overlay
 *   eLoader.topbar.start()            — thin top progress bar
 *   eLoader.topbar.done()             — complete + fade top bar
 *   eLoader.section(el, 'Loading…')  — inline section loader
 *   eLoader.overlay(el, 'Processing')— overlay on a panel/card
 *   eLoader.button(btn)               — button loading state
 *   eLoader.buttonDone(btn, label)    — restore button
 *   eLoader.skeleton(el, rows)        — skeleton rows in table
 */

(function() {
  'use strict';

  // ── Build the global loader DOM once ──────────────────────────
  function _buildGlobalLoader() {
    if (document.getElementById('efin-global-loader')) return;
    var el = document.createElement('div');
    el.id = 'efin-global-loader';
    el.style.display = 'none';
    el.innerHTML = [
      '<div class="egl-logo">',
        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none">',
          '<path d="M12 2L20 7V17L12 22L4 17V7L12 2Z" stroke="white" stroke-width="1.8" stroke-linejoin="round"/>',
          '<path d="M12 6L16 8.5V13.5L12 16L8 13.5V8.5L12 6Z" fill="rgba(255,255,255,.25)" stroke="white" stroke-width="1.2" stroke-linejoin="round"/>',
        '</svg>',
      '</div>',
      '<div class="egl-msg" id="efin-gl-msg">Loading…</div>',
      '<div class="egl-track"><div class="egl-fill"></div></div>',
      '<div class="egl-dots">',
        '<div class="egl-dot"></div>',
        '<div class="egl-dot"></div>',
        '<div class="egl-dot"></div>',
      '</div>',
    ].join('');
    document.body.appendChild(el);
  }

  // ── Build top bar DOM once ─────────────────────────────────────
  function _buildTopbar() {
    if (document.getElementById('efin-topbar')) return;
    var el = document.createElement('div');
    el.id = 'efin-topbar';
    el.innerHTML = '<div id="efin-topbar-fill"></div>';
    document.body.appendChild(el);
  }

  // ── Section loader HTML ────────────────────────────────────────
  function _sectionHTML(msg) {
    return [
      '<div class="efin-section-loader">',
        '<div class="esl-track"><div class="esl-fill"></div></div>',
        '<div class="esl-dots">',
          '<div class="esl-dot"></div>',
          '<div class="esl-dot"></div>',
          '<div class="esl-dot"></div>',
        '</div>',
        msg ? '<div class="esl-label">' + msg + '</div>' : '',
      '</div>',
    ].join('');
  }

  // ── Overlay loader HTML ────────────────────────────────────────
  function _overlayHTML(msg) {
    return [
      '<div class="efin-overlay-loader">',
        '<div class="eol-track"><div class="eol-fill"></div></div>',
        '<div class="eol-dots">',
          '<div class="eol-dot"></div>',
          '<div class="eol-dot"></div>',
          '<div class="eol-dot"></div>',
        '</div>',
        msg ? '<div class="eol-label">' + msg + '</div>' : '',
      '</div>',
    ].join('');
  }

  // ── Skeleton rows HTML ─────────────────────────────────────────
  function _skeletonHTML(rows, cols) {
    var html = '';
    var widths = [30, 50, 20, 40, 25, 35];
    for (var r = 0; r < (rows || 5); r++) {
      html += '<tr class="efin-skeleton-row-tr">';
      for (var c = 0; c < (cols || 6); c++) {
        var w = widths[(r + c) % widths.length] + Math.floor(Math.random() * 20);
        html += '<td style="padding:10px 12px">' +
          '<div class="efin-skeleton efin-skeleton-cell" style="width:' + w + '%;height:13px;"></div>' +
        '</td>';
      }
      html += '</tr>';
    }
    return html;
  }

  // ── Public API ─────────────────────────────────────────────────
  window.eLoader = {

    // Full-page overlay
    show: function(msg) {
      _buildGlobalLoader();
      var el = document.getElementById('efin-global-loader');
      var msgEl = document.getElementById('efin-gl-msg');
      if (msgEl) msgEl.textContent = msg || 'Loading…';
      el.classList.remove('hiding');
      el.style.display = 'flex';
    },
    hide: function() {
      var el = document.getElementById('efin-global-loader');
      if (!el || el.style.display === 'none') return;
      el.classList.add('hiding');
      setTimeout(function() {
        el.style.display = 'none';
        el.classList.remove('hiding');
      }, 230);
    },

    // Top progress bar
    topbar: {
      start: function() {
        _buildTopbar();
        var bar = document.getElementById('efin-topbar');
        var fill = document.getElementById('efin-topbar-fill');
        if (!bar) return;
        fill.style.animation = 'none';
        fill.style.width = '0%';
        fill.style.opacity = '1';
        bar.classList.add('active');
        void fill.offsetWidth; // reflow
        fill.style.animation = '';
      },
      done: function() {
        var bar = document.getElementById('efin-topbar');
        var fill = document.getElementById('efin-topbar-fill');
        if (!bar) return;
        fill.style.animation = 'none';
        fill.style.width = '100%';
        fill.style.opacity = '1';
        setTimeout(function() {
          fill.style.transition = 'opacity .3s';
          fill.style.opacity = '0';
          setTimeout(function() {
            bar.classList.remove('active');
            fill.style.width = '0%';
            fill.style.opacity = '1';
            fill.style.transition = '';
          }, 320);
        }, 120);
      },
    },

    // Inline section loader (replaces element content)
    section: function(el, msg) {
      if (!el) return;
      el._eloaderPrev = el.innerHTML;
      el.innerHTML = _sectionHTML(msg);
    },
    sectionDone: function(el) {
      if (!el) return;
      if (el._eloaderPrev !== undefined) {
        el.innerHTML = el._eloaderPrev;
        delete el._eloaderPrev;
      }
    },

    // Overlay on a panel/card (appended as child)
    overlay: function(el, msg) {
      if (!el) return;
      eLoader.overlayRemove(el);
      var ov = document.createElement('div');
      ov.innerHTML = _overlayHTML(msg);
      var inner = ov.firstElementChild;
      inner.setAttribute('data-eloader-ov', '1');
      el.style.position = el.style.position || 'relative';
      el.appendChild(inner);
    },
    overlayRemove: function(el) {
      if (!el) return;
      var existing = el.querySelector('[data-eloader-ov]');
      if (existing) existing.remove();
    },

    // Button loading state
    button: function(btn, loadingText) {
      if (!btn) return;
      btn._eloaderLabel = btn.textContent;
      btn.disabled = true;
      btn.textContent = loadingText || 'Processing…';
      btn.classList.add('efin-btn-loading');
    },
    buttonDone: function(btn, label) {
      if (!btn) return;
      btn.disabled = false;
      btn.textContent = label || btn._eloaderLabel || btn.textContent;
      btn.classList.remove('efin-btn-loading');
    },

    // Skeleton table rows
    skeleton: function(tbodyEl, rows, cols) {
      if (!tbodyEl) return;
      tbodyEl._eloaderPrev = tbodyEl.innerHTML;
      tbodyEl.innerHTML = _skeletonHTML(rows, cols);
    },
    skeletonDone: function(tbodyEl) {
      if (!tbodyEl) return;
      if (tbodyEl._eloaderPrev !== undefined) {
        tbodyEl.innerHTML = tbodyEl._eloaderPrev;
        delete tbodyEl._eloaderPrev;
      }
    },
  };

  // ── Init DOM on load ───────────────────────────────────────────
  function _init() {
    _buildGlobalLoader();
    _buildTopbar();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

})();
