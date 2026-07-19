/* ═══════════════════════════════════════════════════════════════════
   EFIN Auto-Refresh Module
   Event-driven soft-refresh after every state mutation.
   The wizard page (page-new-application) is NEVER touched.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── 1. Wizard guard ── */
  function _isWizardActive() {
    var pg = document.getElementById('page-new-application');
    return pg && pg.classList.contains('active');
  }

  /* ── 2. Detect current visible page ID ── */
  function _activePage() {
    var active = document.querySelector('.page.active');
    return active ? active.id.replace('page-', '') : null;
  }

  /* ── 3. Core soft-refresh ── */
  function _efinSoftRefresh(hint) {
    // NEVER touch the wizard — guard is absolute
    if (_isWizardActive()) return;

    var page = _activePage();

    // Always keep aggregates live
    if (typeof window.updateDashboardStats === 'function') window.updateDashboardStats();
    if (typeof window.renderPipeline      === 'function') window.renderPipeline();

    if (page === 'dashboard') {
      if (typeof window.renderActivity === 'function') window.renderActivity();
      return;
    }

    if (page === 'applications') {
      if (typeof window.renderTable === 'function') window.renderTable();
      return;
    }

    if (page === 'app-detail') {
      var app = window.currentDetail;
      if (!app) return;
      var rd  = window.ROLES && window.currentUser && window.ROLES[window.currentUser.role];
      if (!rd) return;

      // Re-render action bar via the authoritative builder
      var actBar = document.getElementById('detail-actions');
      if (actBar && typeof window.buildDetailActionBar === 'function') {
        actBar.innerHTML = window.buildDetailActionBar(app, rd);
      }

      // Re-render tracking/timeline section
      if (typeof window.renderTrackingSection === 'function') {
        window.renderTrackingSection(app);
      }

      // Re-render bank body if Lender Details tab is open and not in edit mode
      var bankPanel = document.getElementById('lender-panel-banks');
      if (bankPanel && bankPanel.style.display !== 'none' && !window._bankEditMode) {
        if (typeof window.renderBankBody === 'function') window.renderBankBody(app);
      }

      // Keep the application table in sync in the background
      if (typeof window.renderTable === 'function') window.renderTable();
      return;
    }

    // All other pages: just keep table + activity fresh
    if (typeof window.renderTable    === 'function') window.renderTable();
    if (typeof window.renderActivity === 'function') window.renderActivity();
  }

  window._efinSoftRefresh = _efinSoftRefresh;

  /* ── 4. Hook into persistSave — fires after every mutation that saves ── */
  (function patchPersistSave() {
    var _orig = window.persistSave;
    if (typeof _orig !== 'function' || _orig._arPatched) return;
    window.persistSave = function () {
      var r = _orig.apply(this, arguments);
      // Debounce: coalesce rapid back-to-back calls (e.g. changeStatus + addTracking)
      clearTimeout(window._arDebounce);
      window._arDebounce = setTimeout(function () {
        _efinSoftRefresh('persistSave');
      }, 120);
      return r;
    };
    window.persistSave._arPatched = true;
  })();

  /* ── 5. Hook into addTrackingEntry — covers timeline posts that skip persistSave ── */
  (function patchAddTrackingEntry() {
    var _orig = window.addTrackingEntry;
    if (typeof _orig !== 'function' || _orig._arPatched) return;
    window.addTrackingEntry = function (app, name, stage, comment, subnote) {
      var r = _orig.apply(this, arguments);
      // Only refresh the detail view; wizard guard is inside _efinSoftRefresh
      clearTimeout(window._arTrackDebounce);
      window._arTrackDebounce = setTimeout(function () {
        if (!_isWizardActive() && _activePage() === 'app-detail') {
          var rd = window.ROLES && window.currentUser && window.ROLES[window.currentUser.role];
          if (window.currentDetail && rd) {
            var actBar = document.getElementById('detail-actions');
            if (actBar && typeof window.buildDetailActionBar === 'function') {
              actBar.innerHTML = window.buildDetailActionBar(window.currentDetail, rd);
            }
            if (typeof window.renderTrackingSection === 'function') {
              window.renderTrackingSection(window.currentDetail);
            }
          }
        }
      }, 80);
      return r;
    };
    window.addTrackingEntry._arPatched = true;
  })();

  /* ── 6. Hook into changeStatus — catches status changes that may not call persistSave ── */
  (function patchChangeStatus() {
    var _orig = window.changeStatus;
    if (typeof _orig !== 'function' || _orig._arPatched) return;
    window.changeStatus = function (id, newStatus, triggerEl) {
      var r = _orig.apply(this, arguments);
      clearTimeout(window._arStatusDebounce);
      window._arStatusDebounce = setTimeout(function () {
        _efinSoftRefresh('changeStatus');
      }, 150);
      return r;
    };
    window.changeStatus._arPatched = true;
  })();

})();