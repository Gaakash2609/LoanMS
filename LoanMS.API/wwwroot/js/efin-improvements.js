/* ═══════════════════════════════════════════════════════════════════
   EFIN v22 — JavaScript Improvements Module  (bug-fixed build)
   Place this <script> tag at the END of <body>, after all existing scripts.
   ═══════════════════════════════════════════════════════════════════

   BUGS FIXED vs previous build
   ─────────────────────────────
   FIX 1  : tkOpenFromDetail → openRaiseTicketFromApp (fn didn't exist)
   FIX 2  : twRenderUserTable → twRenderUsers (fn didn't exist)
   FIX 3  : wGoToStep → wizardNav() with forward-validation guard (fn didn't exist)
   FIX 4  : wNextStep → wizardNav() bridge trigger (fn didn't exist)
   FIX 5  : changeStatus double-patched in two separate listeners with no shared guard
             → merged into one guarded wrapper (persist + stamp + badge in single fn)
   FIX 6  : saveEditDetail double-patched in two separate listeners
             → merged into one guarded wrapper (PAN check + diff + persist in single fn)
   FIX 7  : renderWizard patched twice at same setTimeout depth → race condition
             → merged locked-step CSS and Step6→9 bridge into one guarded wrapper
   FIX 8  : showPage patched twice (800ms + 850ms) → possible race condition
             → merged team-badges + scroll-to-top + task-badge into one guarded wrapper
   FIX 9  : efinMarkTaskDone used strict === to match task.id, fragile if stored as string
             → uses Number() coercion for safe comparison
   FIX 10 : camCalculate wrapper called _origCalc.apply(this, ...) inside setTimeout,
             `this` was wrong context (window) → use direct call _origCalc()
   FIX 11 : _injectResendButtons matched by row index i which breaks after filtering
             → match by data-email attribute instead
   FIX 12 : SLA badge injected as extra <td> (broke table column alignment)
             → injected inside existing status cell instead
   FIX 13 : more-actions outside-click: menu.closest() could return null if menu
             was removed before click fires → added null guard
   FIX 14 : _efinEditSnapshot._efinDiffApplied flag set on DOM node, not reset between
             modal opens, so diff never appended on second open
             → moved flag onto the snapshot object, reset on every modal open
*/

(function () {
  'use strict';
// ── Safe localStorage helpers (private to this module) ──
var _lsGet = function(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } };
var _lsSet = function(k,v){ try{ localStorage.setItem(k,v); }catch(e){} };
var _lsRemove = function(k){ try{ localStorage.removeItem(k); }catch(e){} };
;

  /* ──────────────────────────────────────────────────────────────────
     UTILITY HELPERS
  ─────────────────────────────────────────────────────────────────── */

  function daysSince(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d)) return null;
    return Math.floor((Date.now() - d) / 86400000);
  }

  function slaClass(days) {
    if (days === null) return '';
    if (days <= 2)  return 'sla-ok';
    if (days <= 6)  return 'sla-warn';
    return 'sla-over';
  }

  function slaLabel(days) {
    if (days === null) return '';
    if (days === 0) return 'Today';
    if (days === 1) return '1 day';
    return days + 'd';
  }

  function debounce(fn, ms) {
    let t;
    return function () {
      const ctx  = this;
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  function safeJSON(str, fallback) {
    try { return JSON.parse(str); } catch (e) { return fallback; }
  }

  /* ──────────────────────────────────────────────────────────────────
     1. LOCALSTORAGE PERSISTENCE LAYER
  ─────────────────────────────────────────────────────────────────── */

  var STORE_KEYS = {
    apps:         'efin_v22_applications',
    tasks:        'efin_v22_tasks',
    users:        'efin_v22_users',
    locations:    'efin_v22_locations',
    salesTeams:   'efin_v22_sales_teams',
    loginTeams:   'efin_v22_login_teams',
    payoutClaims: 'efin_v22_payout_claims',
    partners:     'efin_v22_partners',
    dsaList:      'efin_v22_dsa_list',
    tickets:      'efin_v22_tickets',
  };

  function persistSave() {
    try {
      if (window.APPLICATIONS)  localStorage.setItem(STORE_KEYS.apps,         JSON.stringify(APPLICATIONS));
      if (window.TASK_STORE)    localStorage.setItem(STORE_KEYS.tasks,        JSON.stringify(TASK_STORE));
      if (window.twUsers)       localStorage.setItem(STORE_KEYS.users,        JSON.stringify(twUsers));
      if (window.twLocations)   localStorage.setItem(STORE_KEYS.locations,    JSON.stringify(twLocations));
      if (window.twSalesTeams)  localStorage.setItem(STORE_KEYS.salesTeams,   JSON.stringify(twSalesTeams));
      if (window.twLoginTeams)  localStorage.setItem(STORE_KEYS.loginTeams,   JSON.stringify(twLoginTeams));
      if (window.PAYOUT_CLAIMS) localStorage.setItem(STORE_KEYS.payoutClaims, JSON.stringify(PAYOUT_CLAIMS));
      if (window.twPartnerList) localStorage.setItem(STORE_KEYS.partners,     JSON.stringify(twPartnerList));
      if (window.twDSAList)     localStorage.setItem(STORE_KEYS.dsaList,      JSON.stringify(twDSAList));
      if (window.twTickets)     localStorage.setItem(STORE_KEYS.tickets,      JSON.stringify(twTickets));
    } catch (e) {
      // Storage quota exceeded — attempt to save only critical data
      try {
        if (window.APPLICATIONS) localStorage.setItem(STORE_KEYS.apps, JSON.stringify(APPLICATIONS));
        if (window.PAYOUT_CLAIMS) localStorage.setItem(STORE_KEYS.payoutClaims, JSON.stringify(PAYOUT_CLAIMS));
      } catch(e2) {
        if (typeof showToast === 'function') {
          showToast('⚠ Storage quota full. Export your data and clear saved data in Settings.', 'warn');
        }
      }
    }
    // Warn when approaching 80% of 5MB limit
    try {
      var _used = JSON.stringify(localStorage).length;
      if (_used > 4 * 1024 * 1024) { // 4MB
        console.warn('[EFIN] localStorage usage: ' + (_used / 1024 / 1024).toFixed(1) + 'MB — approaching limit');
        if (_used > 4.5 * 1024 * 1024 && typeof showToast === 'function') {
          showToast('⚠ Storage nearly full (' + (_used/1024/1024).toFixed(1) + 'MB). Consider exporting and clearing old data.', 'warn');
        }
      }
    } catch(_) {}
  }

  function persistLoad() {
    var loaded = false;

    // Applications
    var savedApps = safeJSON(_lsGet(STORE_KEYS.apps), null);
    if (savedApps && Array.isArray(savedApps) && savedApps.length && window.APPLICATIONS) {
      var seededIds = new Set(APPLICATIONS.map(function (a) { return a.id; }));
      var newApps   = savedApps.filter(function (a) { return !seededIds.has(a.id); });
      if (newApps.length) { newApps.forEach(function (a) { APPLICATIONS.push(a); }); loaded = true; }
    }

    // Tasks
    var savedTasks = safeJSON(_lsGet(STORE_KEYS.tasks), null);
    if (savedTasks && Array.isArray(savedTasks) && window.TASK_STORE) {
      var existIds = new Set(TASK_STORE.map(function (t) { return t.id; }));
      savedTasks.filter(function (t) { return !existIds.has(t.id); }).forEach(function (t) { TASK_STORE.push(t); });
    }

    // Users
    var savedUsers = safeJSON(_lsGet(STORE_KEYS.users), null);
    if (savedUsers && Array.isArray(savedUsers) && window.twUsers) {
      var existEmails = new Set(twUsers.map(function (u) { return u.email; }));
      savedUsers.filter(function (u) { return !existEmails.has(u.email); }).forEach(function (u) { twUsers.push(u); });
    }

    // Sales Teams
    var savedST = safeJSON(_lsGet(STORE_KEYS.salesTeams), null);
    if (savedST && Array.isArray(savedST) && savedST.length && window.twSalesTeams) {
      var stIds = new Set(twSalesTeams.map(function(t){ return t.id; }));
      savedST.filter(function(t){ return !stIds.has(t.id); }).forEach(function(t){ twSalesTeams.push(t); });
      // Overwrite seed entries that were edited
      savedST.forEach(function(saved){
        var idx = twSalesTeams.findIndex(function(t){ return t.id === saved.id; });
        if (idx >= 0) twSalesTeams[idx] = saved;
      });
      loaded = true;
    }

    // Login Teams
    var savedLT = safeJSON(_lsGet(STORE_KEYS.loginTeams), null);
    if (savedLT && Array.isArray(savedLT) && savedLT.length && window.twLoginTeams) {
      var ltIds = new Set(twLoginTeams.map(function(t){ return t.id; }));
      savedLT.filter(function(t){ return !ltIds.has(t.id); }).forEach(function(t){ twLoginTeams.push(t); });
      savedLT.forEach(function(saved){
        var idx = twLoginTeams.findIndex(function(t){ return t.id === saved.id; });
        if (idx >= 0) twLoginTeams[idx] = saved;
      });
      loaded = true;
    }

    // Payout Claims
    var savedClaims = safeJSON(_lsGet(STORE_KEYS.payoutClaims), null);
    if (savedClaims && Array.isArray(savedClaims) && window.PAYOUT_CLAIMS) {
      var claimIds = new Set(PAYOUT_CLAIMS.map(function(c){ return c.id; }));
      savedClaims.filter(function(c){ return !claimIds.has(c.id); }).forEach(function(c){ PAYOUT_CLAIMS.push(c); });
    }

    // Partners
    var savedPartners = safeJSON(_lsGet(STORE_KEYS.partners), null);
    if (savedPartners && Array.isArray(savedPartners) && window.twPartnerList) {
      var pIds = new Set(twPartnerList.map(function(p){ return p.id; }));
      savedPartners.filter(function(p){ return !pIds.has(p.id); }).forEach(function(p){ twPartnerList.push(p); });
      savedPartners.forEach(function(saved){
        var idx = twPartnerList.findIndex(function(p){ return p.id === saved.id; });
        if (idx >= 0) twPartnerList[idx] = saved;
      });
    }

    // DSA List
    var savedDSA = safeJSON(_lsGet(STORE_KEYS.dsaList), null);
    if (savedDSA && Array.isArray(savedDSA) && window.twDSAList) {
      var dIds = new Set(twDSAList.map(function(d){ return d.id; }));
      savedDSA.filter(function(d){ return !dIds.has(d.id); }).forEach(function(d){ twDSAList.push(d); });
      savedDSA.forEach(function(saved){
        var idx = twDSAList.findIndex(function(d){ return d.id === saved.id; });
        if (idx >= 0) twDSAList[idx] = saved;
      });
    }

    // Tickets
    var savedTickets = safeJSON(_lsGet(STORE_KEYS.tickets), null);
    if (savedTickets && Array.isArray(savedTickets) && window.twTickets) {
      var tIds = new Set(twTickets.map(function(t){ return t.id; }));
      savedTickets.filter(function(t){ return !tIds.has(t.id); }).forEach(function(t){ twTickets.push(t); });
    }

    return loaded;
  }

  function _showStorageBanner() {
    var dash = document.getElementById('page-dashboard');
    if (!dash) return;
    if (dash.querySelector('.storage-banner')) return;
    var banner = document.createElement('div');
    banner.className = 'storage-banner';
    var appCount = window.APPLICATIONS
      ? APPLICATIONS.filter(function(a) { return !a.id.startsWith('H') && !a.is_draft; }).length
      : 0;
    banner.innerHTML =
      '<span style="font-size:16px">💾</span>' +
      '<span>Session data restored from last visit — ' + appCount + ' applications loaded.</span>' +
      '<button class="storage-banner-btn" onclick="efinClearStorage()">Clear Saved Data</button>';
    dash.insertBefore(banner, dash.firstChild);
  }

  window.efinClearStorage = function () {
    Object.keys(STORE_KEYS).forEach(function (k) { _lsRemove(STORE_KEYS[k]); });
    var banner = document.querySelector('.storage-banner');
    if (banner) banner.remove();
    if (typeof showToast === 'function') showToast('Saved data cleared. Reload to reset to defaults.', 'info');
  };

  /* ──────────────────────────────────────────────────────────────────
     2. APPLICATION TABLE — SLA badge inside status cell
        FIX 12: inject inside existing <td> not as extra <td>
  ─────────────────────────────────────────────────────────────────── */

  function _getAppSlaBadge(app) {
    var days = daysSince(app.statusChangedAt || app.date);
    var terminal = ['disbursed', 'rejected', 'cancelled', 'ni'];
    if (terminal.indexOf(app.status) === -1 && days !== null) {
      return '<span class="sla-badge ' + slaClass(days) + '" title="Days in current status">⏱ ' + slaLabel(days) + '</span>';
    }
    return '';
  }

  function _injectSlaBadges() {
    var rows = document.querySelectorAll('#app-table-body tr');
    rows.forEach(function (row) {
      var appIdEl = row.querySelector('.app-id');
      if (!appIdEl || !window.APPLICATIONS) return;
      var appId = appIdEl.textContent.trim();
      var app   = APPLICATIONS.find(function (a) { return a.id === appId; });
      if (!app) return;
      // FIX 12: insert badge inside the existing status <td> (5th column), not as new <td>
      var statusCell = row.querySelector('td:nth-child(5)');
      if (statusCell && !statusCell.querySelector('.sla-badge')) {
        var badge = _getAppSlaBadge(app);
        if (badge) statusCell.insertAdjacentHTML('beforeend', '&nbsp;' + badge);
      }
    });
  }

  /* ──────────────────────────────────────────────────────────────────
     3. DETAIL ACTION BAR — consolidated builder
        FIX 1: tkOpenFromDetail → openRaiseTicketFromApp
        FIX 13: null-guard on more-actions outside-click closest()
  ─────────────────────────────────────────────────────────────────── */

  window.buildDetailActionBar = function (app, rd) {
    if (!app) return '';
    var isFinal = ['disbursed', 'rejected', 'ni', 'cancelled'].indexOf(app.status) !== -1;
    var statusLabel = (window.STATUSES && STATUSES[app.status]) || app.status;

    var html = '<div class="detail-action-primary">';

    // Status badge
    html += '<span class="badge badge-' + app.status + '" style="font-size:13px;padding:6px 14px">' + statusLabel + '</span>';

    // ── FINAL-STAGE APPLICATION LOCK: Disbursed / Rejected / Cancelled / Hold ──
    // Once the application reaches one of these stages, only admin may see or
    // perform ANY action on it (re-open, un-hold, workflow buttons, edit,
    // raise ticket, hold/reject, etc.). Every other stage is unaffected and
    // falls through to the existing role/permission logic below unchanged.
    var isAdmin  = window.currentUser && currentUser.role === 'admin';
    var isLocked = (typeof window.isAppFinalLocked === 'function') && window.isAppFinalLocked(app);
    if (isLocked && !isAdmin) {
      html += '<span style="font-size:12px;color:var(--text3);padding:6px 12px;background:var(--surface2);' +
        'border:1px solid var(--border2);border-radius:8px;display:inline-flex;align-items:center;gap:5px">' +
        '🔒 Locked — application is ' + statusLabel + '; only Admin can modify</span>';
      html += '</div>';
      return html;
    }

    // ── REJECTED: show only Re-open (all roles except partner / dsa_user) ──
    if (app.status === 'rejected') {
      var canSeeReopen = window.currentUser && ['partner','dsa_user'].indexOf(currentUser.role) === -1;
      if (canSeeReopen) {
        var createdAt = app.login_date_time
          ? new Date(app.login_date_time)
          : new Date((app.date || '').replace(/(\d{2}) (\w+) (\d{4})/, '$2 $1 $3'));
        var daysElapsed  = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
        var daysLeft     = Math.max(0, Math.ceil(45 - daysElapsed));
        if (daysElapsed <= 45) {
          html += '<button class="btn btn-primary btn-sm" onclick="reopenApp(\'' + app.id + '\')" ' +
            'style="background:linear-gradient(135deg,#7c3aed,#4f46e5);border:none" ' +
            'title="' + daysLeft + ' day' + (daysLeft === 1 ? '' : 's') + ' remaining to re-open">' +
            '🔄 Re-open <span style="font-size:11px;opacity:.85;margin-left:4px">(' + daysLeft + 'd left)</span>' +
            '</button>';
        } else {
          html += '<span style="font-size:12px;color:var(--text3);padding:6px 12px;background:var(--surface2);' +
            'border:1px solid var(--border2);border-radius:8px;display:inline-flex;align-items:center;gap:5px">' +
            '🔒 Re-open window expired</span>';
        }
      }
      html += '</div>';
      return html; // no More Actions dropdown for rejected
    }

    // Hold duration pill + Un-hold button
    if (app.status === 'hold') {
      if (app.hold_start_time) {
        var hDays = daysSince(app.hold_start_time);
        if (hDays !== null) {
          html += '<span class="hold-duration-pill">\u23F8 On hold ' + slaLabel(hDays) + '</span>';
        }
      }
      // Un-hold button — visible to all except partner / dsa_user
      var canSeeUnhold = window.currentUser && ['partner','dsa_user'].indexOf(currentUser.role) === -1;
      if (canSeeUnhold) {
        html += '<button class="btn btn-warn btn-sm" onclick="unholdApp(\'' + app.id + '\')" ' +
          'style="background:linear-gradient(135deg,#e67e00,#f59e0b);border:none;color:#fff">' +
          '\u25B6 Un-hold</button>';
      }
    }

    // Primary workflow button
    if (typeof window.buildWorkflowActionButtons === 'function') {
      html += buildWorkflowActionButtons(app, rd);
    }

    // Disburse locked tooltip when pre-conditions not met
    if (app.status === 'approved') {
      var nachDone = !!app.nach_done;
      var agmtDone = !!app.customer_agreement_done;
      if (!nachDone || !agmtDone) {
        var missing = [];
        if (!nachDone) missing.push('✗ NACH not completed');
        if (!agmtDone) missing.push('✗ Customer Agreement pending');
        html += '<button class="btn-disburse-locked" disabled ' +
          'data-tip="' + missing.join('&#10;') + '&#10;&#10;Complete these in Lender Details tab.">' +
          '💰 Disburse</button>';
      }
    }

    // Edit Details
    if (typeof window.canEditAppDetail === 'function' && canEditAppDetail(app)) {
      html += '<button class="btn btn-ghost btn-sm" onclick="openEditDetailModal(\'' + app.id + '\')" ' +
        'title="Edit application details — changes logged to timeline">✏️ Edit Details</button>';
    }

    // FIX 1: was tkOpenFromDetail (didn't exist) → openRaiseTicketFromApp
    if (!isFinal) {
      html += '<button class="btn btn-ghost btn-sm raise-ticket-btn" ' +
        'onclick="openRaiseTicketFromApp(\'' + app.id + '\')" ' +
        'title="Raise a helpdesk ticket for this application">🎫 Raise Ticket</button>';
    }

    html += '</div>';

    // More Actions dropdown
    var canHold   = !!(rd && rd.canHoldApp   && !isFinal && app.status !== 'hold');
    var canResume = !!(rd && rd.canHoldApp   && app.status === 'hold');
    var canReject = !!(rd && rd.canRejectApp && ['disbursed','rejected'].indexOf(app.status) === -1);

    if (canHold || canResume || canReject) {
      html += '<div class="detail-action-danger-zone">' +
        '<div class="more-actions-wrap" id="more-actions-wrap-' + app.id + '">' +
          '<button class="more-actions-btn" onclick="toggleMoreActions(\'' + app.id + '\')">' +
            '⋯ More ' +
            '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">' +
              '<polyline points="6 9 12 15 18 9"/></svg>' +
          '</button>' +
          '<div class="more-actions-menu" id="more-actions-menu-' + app.id + '">' +
            '<div class="more-actions-label">Application Actions</div>' +
            (canResume ? '<div class="more-actions-item warn" onclick="closeMoreActions(\'' + app.id + '\');unholdApp(\'' + app.id + '\')">&#9654; Un-hold Application</div>' : '') +
            (canHold   ? '<div class="more-actions-item warn" onclick="closeMoreActions(\'' + app.id + '\');holdApp(\'' + app.id + '\')">⏸ Put on Hold</div>' : '') +
            (canReject ? '<div class="more-actions-item danger" onclick="closeMoreActions(\'' + app.id + '\');rejectApp(\'' + app.id + '\')">✕ Reject Application</div>' : '') +
          '</div>' +
        '</div>' +
      '</div>';
    }

    return html;
  };

  window.toggleMoreActions = function (appId) {
    var menu = document.getElementById('more-actions-menu-' + appId);
    if (!menu) return;
    menu.classList.toggle('open');
    if (menu.classList.contains('open')) {
      setTimeout(function () {
        document.addEventListener('click', function closeOutside(e) {
          // FIX 13: null-guard before .contains() — wrap element may be gone
          var wrap = document.getElementById('more-actions-wrap-' + appId);
          if (!wrap || !wrap.contains(e.target)) {
            if (menu) menu.classList.remove('open');
            document.removeEventListener('click', closeOutside);
          }
        });
      }, 0);
    }
  };

  window.closeMoreActions = function (appId) {
    var menu = document.getElementById('more-actions-menu-' + appId);
    if (menu) menu.classList.remove('open');
  };

  /* ──────────────────────────────────────────────────────────────────
     4. DISBURSE CHECKLIST in Lender Details tab
  ─────────────────────────────────────────────────────────────────── */

  function _renderDisburseChecklist(app) {
    if (!app) return;
    var lenderPanel = document.getElementById('lender-panel-banks');
    if (!lenderPanel) return;
    var cl = lenderPanel.querySelector('.disburse-checklist');
    if (!cl) {
      cl = document.createElement('div');
      cl.className = 'disburse-checklist';
      lenderPanel.appendChild(cl);
    }

    var rows = [
      {
        key:    'nach',
        label:  'NACH / eMandate Setup',
        done:   !!app.nach_done,
        icon:   '🏦',
        desc:   'Register NACH mandate for auto-debit of EMIs',
        btnLabel: 'Mark NACH Done',
        onclick: "openTrackWizard('" + app.id + "','task','EFIN-Nach')",
      },
      {
        key:    'agreement',
        label:  'Customer Agreement Signed',
        done:   !!app.customer_agreement_done,
        icon:   '📝',
        desc:   'Loan agreement signed by customer',
        btnLabel: 'Record Agreement',
        onclick: "openTrackWizard('" + app.id + "','task','EFIN-Customer Agreement')",
      },
      {
        key:    'docs',
        label:  'Document Check Complete',
        done:   !!app.document_checked,
        icon:   '📄',
        desc:   'All KYC and income documents verified',
        btnLabel: 'Complete Doc Check',
        onclick: "openTrackWizard('" + app.id + "','direct_doc')",
      },
    ];

    var allDone = rows.every(function(r) { return r.done; });
    var pendingCount = rows.filter(function(r) { return !r.done; }).length;

    var titleHtml =
      '<div class="disburse-checklist-title">' +
        '<span>🔒 Disbursement Pre-Conditions</span>' +
        '<span style="font-size:10px;font-weight:600;color:' +
          (allDone ? 'var(--success)' : 'var(--warn)') + ';background:' +
          (allDone ? 'rgba(26,115,64,.1)' : 'rgba(230,126,0,.1)') +
          ';padding:2px 9px;border-radius:99px;text-transform:none;letter-spacing:0">' +
          (allDone ? '✓ All Clear' : pendingCount + ' Pending') +
        '</span>' +
      '</div>';

    var rowsHtml = rows.map(function(r) {
      var actionHtml = r.done
        ? '<span class="disburse-action-btn done-btn">✓ Done</span>'
        : '<button class="disburse-action-btn pending-btn" onclick="' + r.onclick + '">▶ ' + r.btnLabel + '</button>';

      return '<div class="disburse-check-row">' +
        '<span class="disburse-check-icon ' + (r.done ? 'done' : 'pending') + '">' +
          (r.done ? '✓' : r.icon) +
        '</span>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:600;font-size:13px;color:var(--text)">' + r.label + '</div>' +
          '<div style="font-size:11px;color:var(--text3);margin-top:1px">' + r.desc + '</div>' +
        '</div>' +
        actionHtml +
      '</div>';
    }).join('');

    cl.innerHTML = titleHtml + rowsHtml;
  }

  /* ──────────────────────────────────────────────────────────────────
     5. CROSS-APPLICATION TASK DASHBOARD
  ─────────────────────────────────────────────────────────────────── */

  var TASK_FILTER_OPTIONS = [
    { key: 'all',   label: 'All Tasks' },
    { key: 'open',  label: 'Open' },
    { key: 'draft', label: 'Draft' },
    { key: 'done',  label: 'Completed' },
    { key: 'mine',  label: 'Assigned to Me' },
  ];

  var _taskPageFilter = 'all';

  window.renderTasksPage = function () {
    var page = document.getElementById('page-tasks-page');
    if (!page) return;
    var tasks   = window.TASK_STORE || [];
    var user    = window.currentUser;
    var uname   = (user && user.name) || '';
    // Visibility: a task is only visible to the user the loan application is assigned to.
    var visible = tasks.filter(function (t) {
      var app = window.APPLICATIONS && APPLICATIONS.find(function (a) { return a.id === t.appId; });
      return !!app && (app.sales || '') === uname;
    });
    var filtered = visible;
    if (_taskPageFilter === 'mine') {
      filtered = visible.filter(function (t) { return t.assign_user === uname; });
    } else if (_taskPageFilter !== 'all') {
      filtered = visible.filter(function (t) { return t.status === _taskPageFilter; });
    }
    var pendingCount = visible.filter(function (t) { return t.status !== 'done' && t.status !== 'cancelled'; }).length;

    page.innerHTML =
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<div>' +
          '<div style="font-family:var(--font-head);font-size:24px;font-weight:800;margin-bottom:4px">' +
            'Tasks' +
            (pendingCount ? '<span style="font-size:15px;background:rgba(212,43,43,.1);color:var(--danger);padding:3px 10px;border-radius:20px;vertical-align:middle;margin-left:8px">' + pendingCount + ' pending</span>' : '') +
          '</div>' +
          '<div style="font-size:13px;color:var(--text3)">All tasks across applications — assigned to your team.</div>' +
        '</div>' +
        '<input type="text" placeholder="Search tasks…" id="task-page-search" oninput="efinTaskSearch(this.value)" ' +
          'style="padding:8px 14px;border:1.5px solid var(--border2);border-radius:10px;font-family:var(--font-body);font-size:13px;background:var(--surface);color:var(--text);outline:none;width:200px">' +
      '</div>' +
      '<div class="task-filter-bar">' +
        TASK_FILTER_OPTIONS.map(function (f) {
          var cnt = _countTasksFor(visible, f.key, user);
          return '<button class="task-filter-chip' + (_taskPageFilter === f.key ? ' active' : '') + '" onclick="efinSetTaskFilter(\'' + f.key + '\')">' +
            f.label +
            (f.key !== 'all' ? '<span style="margin-left:4px;opacity:.7">(' + cnt + ')</span>' : '') +
          '</button>';
        }).join('') +
      '</div>' +
      (filtered.length === 0
        ? '<div style="text-align:center;padding:60px;color:var(--text3)">' +
            '<div style="font-size:40px;margin-bottom:14px">✅</div>' +
            '<div style="font-size:15px;font-weight:600;color:var(--text2)">No tasks found</div>' +
            '<div style="font-size:13px;margin-top:6px">Adjust your filter or assign tasks from application detail views.</div>' +
          '</div>'
        : '<div class="task-board" id="task-board-grid">' +
            filtered.map(function (t) { return _renderTaskCard(t); }).join('') +
          '</div>');
  };

  function _countTasksFor(tasks, key, user) {
    if (key === 'all')  return tasks.length;
    if (key === 'mine') return tasks.filter(function (t) { return t.assign_user === (user && user.name); }).length;
    return tasks.filter(function (t) { return t.status === key; }).length;
  }

  function _renderTaskCard(task) {
    var app       = window.APPLICATIONS && APPLICATIONS.find(function (a) { return a.id === task.appId; });
    var appName   = app ? app.name : '—';
    var appStatus = app ? ((window.STATUSES && STATUSES[app.status]) || app.status) : '—';
    var typeLabel = (window.TASK_TYPES && TASK_TYPES[task.assign_type]) || task.assign_type || 'Task';
    var priority  = task.assign_type === 'disbures' ? 'high' : task.assign_type === 'pd' ? 'medium' : 'low';
    var safeId    = JSON.stringify(task.id); // number or string, safe either way

    return '<div class="task-card priority-' + priority + '" id="efin-task-card-' + task.id + '">' +
      '<div class="task-card-header">' +
        '<div style="flex:1">' +
          '<div class="task-card-app-id" onclick="openDetail(\'' + (task.appId || '') + '\')" style="cursor:pointer;display:inline-block;margin-bottom:4px">' + (task.appId || '—') + '</div>' +
          '<div class="task-card-type">' + typeLabel + '</div>' +
        '</div>' +
        '<span class="task-status-pill ' + (task.status || 'draft') + '">' + (task.status || 'draft') + '</span>' +
      '</div>' +
      '<div class="task-card-meta">' +
        '<span>👤 ' + (task.assign_user || 'Unassigned') + '</span>' +
        (task.date_assigned ? '<span>📅 ' + task.date_assigned + '</span>' : '') +
        (appStatus !== '—' ? '<span style="color:var(--text3)">· ' + appName + '</span>' : '') +
      '</div>' +
      (task.remarks ? '<div class="task-card-remark">' + task.remarks + '</div>' : '') +
      '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">' +
        '<button class="btn btn-ghost btn-sm" onclick="openDetail(\'' + (task.appId || '') + '\')" style="font-size:11px">Open Application →</button>' +
        (task.status !== 'done'
          ? '<button class="btn btn-sm" onclick="efinMarkTaskDone(' + safeId + ')" ' +
              'style="font-size:11px;background:rgba(26,115,64,.09);color:var(--success);border:1px solid rgba(26,115,64,.2);border-radius:8px;cursor:pointer">✓ Mark Done</button>'
          : '') +
      '</div>' +
    '</div>';
  }

  window.efinSetTaskFilter = function (key) {
    _taskPageFilter = key;
    renderTasksPage();
  };

  window.efinTaskSearch = function (q) {
    var grid = document.getElementById('task-board-grid');
    if (!grid) return;
    var lower = q.toLowerCase().trim();
    grid.querySelectorAll('.task-card').forEach(function (card) {
      card.style.display = (!lower || card.textContent.toLowerCase().indexOf(lower) !== -1) ? '' : 'none';
    });
  };

  // FIX 9: use Number() coercion so === works whether taskId arrives as number or string
  window.efinMarkTaskDone = function (taskId) {
    var numId = Number(taskId);
    var task = window.TASK_STORE && TASK_STORE.find(function (t) { return Number(t.id) === numId; });
    if (!task) return;
    task.status          = 'done';
    task.completion_date = new Date().toLocaleDateString('en-IN');
    task.completed_user  = window.currentUser && currentUser.name;
    persistSave();
    _refreshTaskNavBadge();
    renderTasksPage();
    if (typeof showToast === 'function') showToast('Task marked as done ✓', 'success');
  };

  function _refreshTaskNavBadge() {
    var badge = document.getElementById('tasks-nav-badge');
    if (!badge || !window.TASK_STORE) return;
    var pending = TASK_STORE.filter(function (t) { return t.status !== 'done' && t.status !== 'cancelled'; }).length;
    badge.textContent = pending || '';
    badge.style.display = pending ? '' : 'none';
  }

  /* ──────────────────────────────────────────────────────────────────
     6. TEAM OVERVIEW — workload badges
  ─────────────────────────────────────────────────────────────────── */

  function _injectTeamWorkloadBadges() {
    if (!window.APPLICATIONS || !window.twUsers) return;
    var activeStatuses = ['wip','login','underwriting','offer','approved'];
    var countByName = {};
    APPLICATIONS.filter(function (a) { return activeStatuses.indexOf(a.status) !== -1; }).forEach(function (a) {
      if (a.sales) countByName[a.sales] = (countByName[a.sales] || 0) + 1;
    });
    var page = document.getElementById('page-team-overview');
    if (!page) return;
    page.querySelectorAll('[data-tw-user-email]').forEach(function (card) {
      var email = card.getAttribute('data-tw-user-email');
      var user  = twUsers.find(function (u) { return u.email === email; });
      if (!user || card.querySelector('.tw-workload-badge')) return;
      var cnt   = countByName[user.name] || 0;
      var cls   = cnt === 0 ? 'low' : cnt <= 5 ? 'medium' : 'high';
      var badge = document.createElement('span');
      badge.className = 'tw-workload-badge ' + cls;
      badge.innerHTML = '📋 ' + cnt + ' active';
      card.style.position = 'relative';
      card.appendChild(badge);
    });
  }

  /* ──────────────────────────────────────────────────────────────────
     7. PAN DUPLICATE CHECK — shared helper
  ─────────────────────────────────────────────────────────────────── */

  window.efinCheckPanDuplicate = function (panValue, excludeId) {
    if (!panValue || !window.APPLICATIONS) return null;
    var pan    = panValue.toUpperCase().trim();
    var cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 45);
    return APPLICATIONS.find(function (a) {
      return a.id !== excludeId &&
             a.pan && a.pan.toUpperCase() === pan &&
             new Date(a.login_date || a.date) >= cutoff;
    }) || null;
  };

  /* ──────────────────────────────────────────────────────────────────
     8. PERMISSIONS — staged changes with unsaved banner
  ─────────────────────────────────────────────────────────────────── */

  var _permsHaveUnsavedChanges = false;

  function _showPermsUnsavedBanner() {
    _permsHaveUnsavedChanges = true;
    var banner = document.getElementById('perms-unsaved-banner');
    if (banner) { banner.classList.add('visible'); return; }
    var grid = document.getElementById('master-toggle-grid');
    if (!grid) return;
    banner = document.createElement('div');
    banner.id = 'perms-unsaved-banner';
    banner.className = 'perms-unsaved-banner visible';
    banner.innerHTML =
      '<span>⚠️</span>' +
      '<span style="flex:1">You have unsaved permission changes. Click <strong>Apply Changes</strong> to make them active.</span>' +
      '<button class="btn btn-sm" onclick="applyMasterToggles()" style="background:var(--warn);color:#fff;border:none;border-radius:8px;padding:6px 14px;font-weight:700;cursor:pointer">Apply Changes</button>' +
      '<button onclick="efinDiscardPermChanges()" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:16px;margin-left:4px" title="Discard">✕</button>';
    grid.insertAdjacentElement('beforebegin', banner);
  }

  window.efinDiscardPermChanges = function () {
    var banner = document.getElementById('perms-unsaved-banner');
    if (banner) banner.remove();
    _permsHaveUnsavedChanges = false;
    if (typeof renderAccessRights === 'function') renderAccessRights();
    if (typeof showToast === 'function') showToast('Permission changes discarded.', 'info');
  };

  /* ──────────────────────────────────────────────────────────────────
     9. INLINE DELETE CONFIRM (replaces browser confirm())
  ─────────────────────────────────────────────────────────────────── */

  window.efinConfirmMlDelete = function (key, idx) {
    var cf = document.querySelector('.inline-confirm');
    if (cf) cf.remove();
    var list = window.MASTER_LISTS && MASTER_LISTS[key];
    if (!list || !list.items[idx]) return;
    var item = list.items[idx];
    list.items.splice(idx, 1);
    if (key === 'location' && window.twLocations) {
      window.twLocations = twLocations.filter(function (l) { return l.name !== item.value; });
      if (typeof wPopulateLocations === 'function') wPopulateLocations();
    }
    if (typeof mlPopulateSelect === 'function' && list.wizardId) mlPopulateSelect(key, list.wizardId);
    if (typeof mlRenderTabs    === 'function') mlRenderTabs();
    if (typeof showToast       === 'function') showToast('"' + item.label + '" removed', 'info');
  };

  /* ──────────────────────────────────────────────────────────────────
     10. AUTO-ASSIGN TASKS to Login Team on submission
  ─────────────────────────────────────────────────────────────────── */

  function _efinAssignAutoTasks() {
    if (!window.TASK_STORE || !window.APPLICATIONS || !window.twUsers) return;
    var newApp = APPLICATIONS[0];
    if (!newApp) return;
    var appLocation = newApp.location;
    var loginTeamMember = twUsers.find(function (u) {
      return u.role === 'Login Team' && Array.isArray(u.locations) && u.locations.indexOf(appLocation) !== -1;
    }) || twUsers.find(function (u) { return u.role === 'Login Team'; });
    if (!loginTeamMember) return;
    TASK_STORE.filter(function (t) { return t.appId === newApp.id && t.assign_user === 'System (Auto)'; })
      .forEach(function (t) { t.assign_user = loginTeamMember.name; t.status = 'open'; });
    persistSave();
    _refreshTaskNavBadge();
  }

  /* ──────────────────────────────────────────────────────────────────
     11. WIZARD — lock step indicators visual state
  ─────────────────────────────────────────────────────────────────── */

  function _efinUpdateStepLockState() {
    var steps   = document.querySelectorAll('.wizard-step');
    var current = window.currentStep || 1;
    steps.forEach(function (step, i) {
      var stepNum = i + 1;
      if (stepNum > current && !step.classList.contains('done')) {
        step.classList.add('locked');
      } else {
        step.classList.remove('locked');
      }
    });
  }

  /* ──────────────────────────────────────────────────────────────────
     12. CAM ↔ LOAN ANALYTIC bridge (Step 6 → Step 9)
  ─────────────────────────────────────────────────────────────────── */

  function _efinBridgeStep6ToStep9() {
    var salaryEl = document.getElementById('w-salary');
    var laEl     = document.getElementById('la-elig-salary');
    if (salaryEl && laEl && !laEl.value && salaryEl.value) {
      laEl.value = salaryEl.value;
    }
    var compField = document.getElementById('w-company') || document.getElementById('w-compname');
    var laCompSel = document.getElementById('la-elig-company');
    if (compField && laCompSel && compField.value) {
      var target = compField.value.toLowerCase();
      Array.from(laCompSel.options).forEach(function (opt) {
        if (opt.text.toLowerCase().indexOf(target) !== -1) laCompSel.value = opt.value;
      });
    }
    if (laEl && laEl.value && typeof window.laLoadEligibility === 'function') laLoadEligibility();
  }

  /* ──────────────────────────────────────────────────────────────────
     13. KYC → WIZARD FIELD AUTO-FILL
  ─────────────────────────────────────────────────────────────────── */

  function _efinKycFillWizard() {
    var KYC = window.KYC;
    if (!KYC) return;
    var panData    = KYC.pan    && KYC.pan.data;
    var aadharData = KYC.aadhar && KYC.aadhar.data;
    function fillIfEmpty(id, val) {
      var el = document.getElementById(id);
      if (el && !el.value && val) el.value = val;
    }
    if (panData) {
      var fullName = [panData.firstName, panData.middleName, panData.lastName].filter(Boolean).join(' ');
      fillIfEmpty('w-name',  fullName);
      fillIfEmpty('w-pan',   panData.panNumber || panData.pan);
      fillIfEmpty('w-dob',   panData.dateOfBirth || panData.dob);
      fillIfEmpty('w-fname', panData.fatherName);
    }
    if (aadharData) {
      fillIfEmpty('w-aadhar', aadharData.aadharNumber || aadharData.aadhaar);
      fillIfEmpty('w-gender', aadharData.gender);
      fillIfEmpty('w-addr1',  aadharData.houseNo   || aadharData.street1);
      fillIfEmpty('w-addr2',  aadharData.locality  || aadharData.street2);
      fillIfEmpty('w-city',   aadharData.city);
      fillIfEmpty('w-zip',    aadharData.pinCode   || aadharData.pin);
    }
    if (typeof showToast === 'function') showToast('KYC data auto-filled into wizard fields ✓', 'success');
  }

  /* ══════════════════════════════════════════════════════════════════
     ALL DOMContentLoaded PATCHES — single listener, ordered by timing
     This eliminates race conditions from multiple listeners at the
     same setTimeout depth.
  ═══════════════════════════════════════════════════════════════════ */

  document.addEventListener('DOMContentLoaded', function () {

    /* ── 600ms: persistence load + mutating function patches ── */
    setTimeout(function () {

      // Load saved data
      var loaded = persistLoad();
      if (loaded) {
        _showStorageBanner();
        if (typeof updateDashboardStats === 'function') updateDashboardStats();
        if (typeof renderTable         === 'function') renderTable();
      }

      // FIX 5: changeStatus — single guarded wrapper combining persist + stamp + badge
      if (!window._efinCsPatched) {
        window._efinCsPatched = true;
        var _csOrig = window.changeStatus;
        if (typeof _csOrig === 'function') {
          window.changeStatus = function (id, newStatus, el) {
            var app = window.APPLICATIONS && APPLICATIONS.find(function (a) { return a.id === id; });
            if (app) app.statusChangedAt = new Date().toISOString();
            var result = _csOrig.apply(this, arguments);
            persistSave();
            _refreshTaskNavBadge();
            return result;
          };
        }
      }

      // submitWizard persist
      if (!window._efinSwPatched) {
        window._efinSwPatched = true;
        var _swOrig = window.submitWizard;
        if (typeof _swOrig === 'function') {
          window.submitWizard = function () {
            var result = _swOrig.apply(this, arguments);
            setTimeout(persistSave, 300);
            return result;
          };
        }
      }

      // twSaveUser persist
      if (!window._efinTwSavePatched) {
        window._efinTwSavePatched = true;
        var _twSaveOrig = window.twSaveUser;
        if (typeof _twSaveOrig === 'function') {
          window.twSaveUser = function () {
            var result = _twSaveOrig.apply(this, arguments);
            setTimeout(persistSave, 100);
            return result;
          };
        }
      }

    }, 600);

    /* ── 700ms: task auto-assign + nav badge ── */
    setTimeout(function () {
      _refreshTaskNavBadge();

      if (!window._efinPstPatched) {
        window._efinPstPatched = true;
        var _pstOrig = window._postSubmitProductTasks;
        if (typeof _pstOrig === 'function') {
          window._postSubmitProductTasks = function () {
            _pstOrig.apply(this, arguments);
            _efinAssignAutoTasks();
          };
        }
      }
    }, 700);

    /* ── 800ms: renderTable SLA badge injection ── */
    setTimeout(function () {
      if (!window._efinRtSlaPatched) {
        window._efinRtSlaPatched = true;
        var _rtOrig = window.renderTable;
        if (typeof _rtOrig === 'function') {
          window.renderTable = function (filter) {
            _rtOrig.apply(this, arguments);
            _injectSlaBadges();
            // Remove redundant "Open" ghost buttons (FIX 18)
            document.querySelectorAll('#app-table-body td:last-child button.btn-ghost').forEach(function (btn) {
              if (btn.textContent.trim() === 'Open') btn.remove();
            });
          };
        }
      }
    }, 800);

    /* ── 850ms: all other function patches (single block eliminates races) ── */
    setTimeout(function () {

      // FIX 8: merged showPage patches (team badges + scroll-to-top + task badge refresh)
      if (!window._efinSpPatched) {
        window._efinSpPatched = true;
        var _spOrig = window.showPage;
        if (typeof _spOrig === 'function') {
          window.showPage = function (name, navEl) {
            var result = _spOrig.apply(this, arguments);
            // scroll to top on every navigation
            var main = document.getElementById('main') || document.querySelector('.main');
            if (main) main.scrollTop = 0;
            // team overview workload badges
            if (name === 'team-overview') setTimeout(_injectTeamWorkloadBadges, 200);
            // refresh task nav badge
            if (name === 'tasks-page')    setTimeout(_refreshTaskNavBadge, 100);
            return result;
          };
        }
      }

      // openDetail: rebuild action bar + scroll + disburse checklist
      if (!window._efinOdPatched) {
        window._efinOdPatched = true;
        var _odOrig = window.openDetail;
        if (typeof _odOrig === 'function') {
          window.openDetail = function (id) {
            _odOrig.apply(this, arguments);
            var app = window.APPLICATIONS && APPLICATIONS.find(function (a) { return a.id === id; });
            var rd  = window.ROLES && window.currentUser && ROLES[currentUser.role];
            if (app && rd) {
              var actBar = document.getElementById('detail-actions');
              if (actBar) actBar.innerHTML = buildDetailActionBar(app, rd);
            }
            // Guard: ensure EFIN/Lead ID always visible in header
            if (app) {
              var _tEl = document.getElementById('detail-title');
              if (_tEl && !_tEl.textContent.trim()) {
                _tEl.textContent = app.id || app._tempAppNo || '—';
              }
              var _sEl = document.getElementById('detail-sub');
              if (_sEl && !_sEl.textContent.trim()) {
                _sEl.textContent = (typeof loanTypeLabel === 'function' ? loanTypeLabel(app.loanType) : app.loanType) + ' — ' + (app.name || '');
              }
            }
            var main = document.getElementById('main') || document.querySelector('.main');
            if (main) main.scrollTop = 0;
            _renderDisburseChecklist(app);
          };
        }
      }

      // FIX 7: merged renderWizard patches (locked-step CSS + step6→9 bridge)
      if (!window._efinRwPatched) {
        window._efinRwPatched = true;
        var _rwOrig = window.renderWizard;
        if (typeof _rwOrig === 'function') {
          window.renderWizard = function () {
            var result = _rwOrig.apply(this, arguments);
            // locked step state (patch 11)
            setTimeout(_efinUpdateStepLockState, 50);
            // step 6→9 bridge (patch 13)
            if (window.currentStep === 9) setTimeout(_efinBridgeStep6ToStep9, 100);
            return result;
          };
        }
      }

      // FIX 3: wizardNav forward-validation guard (replaces non-existent wGoToStep)
      if (!window._efinWizNavPatched) {
        window._efinWizNavPatched = true;
        var _wnOrig = window.wizardNav;
        if (typeof _wnOrig === 'function') {
          window.wizardNav = function (dir) {
            // Only intercept forward movement
            if (dir === 1 && typeof validateStep === 'function') {
              var cs = window.currentStep || 1;
              if (!validateStep(cs)) {
                if (typeof showToast === 'function')
                  showToast('Please complete all required fields before proceeding.', 'warn');
                return;
              }
            }
            return _wnOrig.apply(this, arguments);
          };
        }
      }

      // FIX 6: merged saveEditDetail patches (PAN check + diff changelog + persist)
      if (!window._efinSedPatched) {
        window._efinSedPatched = true;
        var _sedOrig = window.saveEditDetail;
        if (typeof _sedOrig === 'function') {
          window.saveEditDetail = function () {
            // PAN duplicate check
            var panInput = document.getElementById('ed-pan');
            if (panInput && panInput.value) {
              var appId = window.currentDetail && currentDetail.id;
              var dup   = window.efinCheckPanDuplicate(panInput.value, appId);
              if (dup) {
                var daysAgo = Math.floor((Date.now() - new Date(dup.login_date || dup.date)) / 86400000);
                if (typeof showToast === 'function')
                  showToast('PAN ' + panInput.value.toUpperCase() + ' already in application ' + dup.id + ' (' + daysAgo + 'd ago). 45-day lock applies.', 'error');
                return;
              }
            }
            // Build field-level diff and append to notes
            var changes = [];
            var snap    = window._efinEditSnapshot || {};
            var LABELS  = window._efinEditFieldLabels || {};
            Object.keys(LABELS).forEach(function (fId) {
              var el = document.getElementById(fId);
              if (!el) return;
              var before = snap[fId] || '';
              var after  = el.value || '';
              if (before !== after && after !== '') changes.push(LABELS[fId] + ': ' + (before || '(empty)') + ' → ' + after);
            });
            if (changes.length && !snap._diffApplied) {
              snap._diffApplied = true;
              var noteEl = document.getElementById('ed-note') || document.getElementById('edit-note');
              if (noteEl) {
                var existing = noteEl.value ? noteEl.value + '\n\n' : '';
                noteEl.value = existing + '[Changes]\n' + changes.join('\n');
              }
            }
            var result = _sedOrig.apply(this, arguments);
            persistSave();
            return result;
          };
        }
      }

      // openEditDetailModal: snapshot + reset diff flag (FIX 14)
      if (!window._efinOemPatched) {
        window._efinOemPatched = true;
        var _oemOrig = window.openEditDetailModal;
        if (typeof _oemOrig === 'function') {
          window.openEditDetailModal = function (id) {
            _oemOrig.apply(this, arguments);
            setTimeout(function () {
              var snap = {};
              var LABELS = window._efinEditFieldLabels || {};
              Object.keys(LABELS).forEach(function (fId) {
                var el = document.getElementById(fId);
                if (el) snap[fId] = el.value || '';
              });
              snap._diffApplied = false; // FIX 14: reset on every open
              window._efinEditSnapshot = snap;
            }, 80);
          };
        }
      }

      // holdApp: pending task warning guard
      if (!window._efinHoldPatched) {
        window._efinHoldPatched = true;
        var _holdOrig = window.holdApp;
        if (typeof _holdOrig === 'function') {
          window.holdApp = function (id) {
            var pending = (window.TASK_STORE || []).filter(function (t) { return t.appId === id && t.status !== 'done'; });
            if (pending.length && typeof showToast === 'function')
              showToast('⚠️ ' + pending.length + ' open task(s) on this application. Consider completing them before placing on hold.', 'warn');
            return _holdOrig.apply(this, arguments);
          };
        }
      }

      // toggleSinglePerm + toggleMasterRole: show unsaved banner
      if (!window._efinPermPatched) {
        window._efinPermPatched = true;
        var _tspOrig = window.toggleSinglePerm;
        var _tmrOrig = window.toggleMasterRole;
        if (typeof _tspOrig === 'function') {
          window.toggleSinglePerm = function () {
            _tspOrig.apply(this, arguments);
            _showPermsUnsavedBanner();
          };
        }
        if (typeof _tmrOrig === 'function') {
          window.toggleMasterRole = function () {
            _tmrOrig.apply(this, arguments);
            _showPermsUnsavedBanner();
          };
        }
      }

      // applyMasterToggles: clear unsaved banner + persist
      if (!window._efinAmtPatched) {
        window._efinAmtPatched = true;
        var _amtOrig = window.applyMasterToggles;
        if (typeof _amtOrig === 'function') {
          window.applyMasterToggles = function () {
            var result = _amtOrig.apply(this, arguments);
            _permsHaveUnsavedChanges = false;
            var banner = document.getElementById('perms-unsaved-banner');
            if (banner) banner.remove();
            if (typeof showToast === 'function') showToast('Permissions applied and active for this session ✓', 'success');
            persistSave();
            return result;
          };
        }
      }

      // FIX 2: twRenderUsers (was incorrectly named twRenderUserTable)
      if (!window._efinRutPatched) {
        window._efinRutPatched = true;
        var _ruOrig = window.twRenderUsers;
        if (typeof _ruOrig === 'function') {
          window.twRenderUsers = function () {
            var result = _ruOrig.apply(this, arguments);
            _injectResendButtons();
            return result;
          };
        }
      }

      // mlDeleteItem: inline confirm (replaces browser confirm())
      if (!window._efinMldPatched) {
        window._efinMldPatched = true;
        var _mldOrig = window.mlDeleteItem;
        if (typeof _mldOrig === 'function') {
          window.mlDeleteItem = function (key, idx) {
            var list = window.MASTER_LISTS && MASTER_LISTS[key];
            if (!list || !list.items[idx]) return;
            var item = list.items[idx];
            var inUse = window.APPLICATIONS && APPLICATIONS.some(function (a) {
              if (key === 'location')     return a.location === item.value;
              if (key === 'sales_person') return a.sales    === item.value;
              if (key === 'home_type')    return a.homeType === item.value;
              if (key === 'designation')  return a.desig    === item.value;
              if (key === 'company_type') return a.compType === item.value;
              return false;
            });
            if (inUse) {
              if (typeof showToast === 'function') showToast('Cannot delete "' + item.label + '" — it is used by existing applications.', 'error');
              return;
            }
            var grid    = document.getElementById('ml-items-grid');
            var itemEls = grid && grid.querySelectorAll('div[onmouseover]');
            var target  = itemEls && itemEls[idx];
            if (target) {
              var existing = grid.querySelector('.inline-confirm');
              if (existing) existing.remove();
              var cf = document.createElement('div');
              cf.className = 'inline-confirm';
              cf.innerHTML =
                '<span class="inline-confirm-text">Delete "<strong>' + item.label + '</strong>"?</span>' +
                '<div class="inline-confirm-actions">' +
                  '<button class="btn btn-ghost btn-sm" onclick="this.closest(\'.inline-confirm\').remove()">Cancel</button>' +
                  '<button class="btn btn-sm" style="background:var(--accent2);color:#fff;border:none;border-radius:8px;padding:6px 14px;font-weight:700;cursor:pointer" ' +
                    'onclick="efinConfirmMlDelete(\'' + key + '\',' + idx + ')">Delete</button>' +
                '</div>';
              target.insertAdjacentElement('afterend', cf);
            } else {
              _mldOrig.apply(this, arguments);
            }
          };
        }
      }

      // KYC apply-to-wizard button watcher
      var step2 = document.getElementById('wstep-2');
      if (step2 && !step2._efinKycWatcher) {
        step2._efinKycWatcher = true;
        step2.addEventListener('click', function (e) {
          var btn = e.target.closest && e.target.closest('button');
          if (btn && (btn.textContent.indexOf('Apply') !== -1 || btn.textContent.indexOf('Wizard') !== -1)) {
            setTimeout(_efinKycFillWizard, 200);
          }
        });
      }

      // KYC apply function patch
      if (!window._efinKycPatched) {
        window._efinKycPatched = true;
        var kycApplyFnName = window.kycApplyToWizard ? 'kycApplyToWizard' : (window.kycApply ? 'kycApply' : null);
        if (kycApplyFnName) {
          var _kycApplyOrig = window[kycApplyFnName];
          window[kycApplyFnName] = function () {
            var result = _kycApplyOrig.apply(this, arguments);
            _efinKycFillWizard();
            return result;
          };
        }
      }

      // FIX 10: camCalculate — _origCalc called directly, not via .apply(this,...) inside setTimeout
      if (!window._efinCalcPatched) {
        window._efinCalcPatched = true;
        var _calcOrig = window.camCalculate;
        if (typeof _calcOrig === 'function') {
          window.camCalculate = function () {
            var btn = document.querySelector('.coh-btn-recalc');
            if (btn) { btn.disabled = true; btn.querySelector('.btn-icon') ? btn.querySelector('.btn-icon').textContent = '⏳' : (btn.textContent = '⏳ Calculating…'); btn.classList.add('btn-loading'); btn.style.opacity = '.7'; }
            // FIX 10: use direct call, not .apply(this, arguments) inside setTimeout callback
            setTimeout(function () {
              _calcOrig();
              if (btn) { if(btn.querySelector('.btn-icon')) btn.querySelector('.btn-icon').textContent = '↺'; btn.disabled = false; btn.classList.remove('btn-loading'); btn.style.opacity = ''; }
            }, 0);
          };
        }
      }

      // coApplySelectedPlan: apply immediately — no confirmation step
      if (!window._efinCamPatched) {
        window._efinCamPatched = true;
        var _camOrig = window.coApplySelectedPlan;
        if (typeof _camOrig === 'function') {
          window.coApplySelectedPlan = function () {
            // Remove any stale confirm card that may exist from a previous version
            var stale = document.querySelector('.coh-actions .cam-apply-confirm');
            if (stale) stale.remove();
            // Apply the plan directly — no intermediate confirmation dialog
            _camOrig();
          };
        }
      }

      // twFireWebhook: debounce + loading state
      if (!window._efinWhPatched) {
        window._efinWhPatched = true;
        var _whOrig = window.twFireWebhook;
        if (typeof _whOrig === 'function') {
          window.twFireWebhook = debounce(function () {
            var btn = document.querySelector('[onclick*="twFireWebhook"]');
            var origHtml = btn ? btn.innerHTML : '';
            if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Firing…'; }
            var self = this;
            var args = arguments;
            _whOrig.apply(self, args);
            if (btn) {
              setTimeout(function () { btn.disabled = false; btn.innerHTML = origHtml; }, 2500);
            }
          }, 400);
        }
      }

    }, 850);

  }); // end DOMContentLoaded

  /* ──────────────────────────────────────────────────────────────────
     FIX 11: _injectResendButtons — match by data-email, not row index
  ─────────────────────────────────────────────────────────────────── */

  function _injectResendButtons() {
    var tbody = document.getElementById('tw-user-table');
    if (!tbody || !window.twUsers) return;
    tbody.querySelectorAll('tr').forEach(function (row) {
      var actCell = row.querySelector('td:last-child');
      if (!actCell || actCell.querySelector('.btn-resend-invite')) return;
      // FIX 11: derive user index from email displayed in the row, not positional index
      var emailCell = row.querySelector('td:nth-child(2)');
      var emailText = emailCell ? emailCell.textContent.trim() : '';
      var userIdx   = twUsers.findIndex(function (u) { return u.email === emailText; });
      if (userIdx === -1) return;
      var btn = document.createElement('button');
      btn.className = 'btn-resend-invite';
      btn.title     = 'Resend invitation / view credentials';
      btn.innerHTML = '✉ Resend';
      (function (idx) {
        btn.onclick = function () {
          if (typeof openInvitationModal === 'function') openInvitationModal(idx);
        };
      })(userIdx);
      actCell.insertBefore(btn, actCell.firstChild);
    });
  }

  /* ──────────────────────────────────────────────────────────────────
     EDIT FIELD LABELS — exposed so saveEditDetail patch can find them
  ─────────────────────────────────────────────────────────────────── */

  /* ── Password reveal helpers for Uploaded During Application rows ── */

  // Toggle the password reveal panel for a doc row.
  // Loads the saved password from app.uploadedDocs[wi] into the input on first open.
  window.efinToggleDocPassword = function(rowId, appId, wi) {
    const panel  = document.getElementById(rowId);
    const btn    = document.getElementById(rowId + '-btn');
    const inp    = document.getElementById(rowId + '-inp');
    if (!panel) return;

    const isOpen = panel.style.display === 'flex';

    if (!isOpen) {
      // Populate the input with the stored password (looked up from app.uploadedDocs)
      if (inp && (!inp.value || inp.value === '')) {
        var pw = '';
        // Primary source: app.uploadedDocs[wi].pdfPassword
        var app = window.APPLICATIONS && APPLICATIONS.find(function(a) { return a.id === appId; });
        if (app && app.uploadedDocs && app.uploadedDocs[wi]) {
          pw = app.uploadedDocs[wi].pdfPassword || '';
        }
        // Secondary source: _BFP_STORE (in case uploadedDocs was not yet synced)
        if (!pw && app && app.uploadedDocs && app.uploadedDocs[wi] && app.uploadedDocs[wi].storeKey) {
          var stored = window._BFP_STORE && window._BFP_STORE[app.uploadedDocs[wi].storeKey];
          if (stored && stored.pdfPassword) pw = stored.pdfPassword;
        }
        inp.value = pw || '(password not available in this session)';
        inp.type  = 'password';   // start masked
      }
      panel.style.display = 'flex';
      if (btn) { btn.style.background = 'rgba(217,119,6,.15)'; btn.style.borderColor = '#d97706'; }
    } else {
      panel.style.display = 'none';
      if (btn) { btn.style.background = 'rgba(217,119,6,.06)'; btn.style.borderColor = 'rgba(217,119,6,.4)'; }
      // Re-mask when closed
      if (inp) inp.type = 'password';
    }
  };

  // Toggle password field visibility (show plain text / re-mask)
  window.efinToggleDocPasswordVisibility = function(inpId, eyeBtn) {
    var inp = document.getElementById(inpId);
    if (!inp) return;
    if (inp.type === 'password') {
      inp.type = 'text';
      eyeBtn.textContent = '🙈';
      eyeBtn.title = 'Hide password';
    } else {
      inp.type = 'password';
      eyeBtn.textContent = '👁';
      eyeBtn.title = 'Show password';
    }
  };

  // Copy the password to clipboard and show a brief confirmation
  window.efinCopyDocPassword = function(inpId, copyBtn) {
    var inp = document.getElementById(inpId);
    if (!inp || !inp.value) return;
    var pw  = inp.value;
    if (pw === '(password not available in this session)') {
      if (typeof showToast === 'function') showToast('Password not available — please re-upload the document', 'warn');
      return;
    }
    var stsId = inpId.replace('-inp', '-cpsts');
    var sts   = document.getElementById(stsId);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(pw).then(function() {
        if (sts) { sts.textContent = '✓ Copied!'; setTimeout(function(){ sts.textContent = ''; }, 2200); }
        if (copyBtn) {
          var orig = copyBtn.textContent;
          copyBtn.textContent = '✅ Copied';
          copyBtn.style.color = 'var(--success)';
          copyBtn.style.borderColor = 'var(--success)';
          setTimeout(function() {
            copyBtn.textContent = orig;
            copyBtn.style.color = '';
            copyBtn.style.borderColor = '';
          }, 2200);
        }
        if (typeof showToast === 'function') showToast('🔐 Password copied to clipboard', 'success');
      }).catch(function() {
        // Fallback for browsers that block clipboard API
        try {
          var ta = document.createElement('textarea');
          ta.value = pw; ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.focus(); ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          if (sts) { sts.textContent = '✓ Copied!'; setTimeout(function(){ sts.textContent = ''; }, 2200); }
          if (typeof showToast === 'function') showToast('🔐 Password copied to clipboard', 'success');
        } catch(e2) {
          if (typeof showToast === 'function') showToast('Could not copy — please select and copy manually', 'warn');
        }
      });
    } else {
      // execCommand fallback
      try {
        var ta = document.createElement('textarea');
        ta.value = pw; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        if (sts) { sts.textContent = '✓ Copied!'; setTimeout(function(){ sts.textContent = ''; }, 2200); }
        if (typeof showToast === 'function') showToast('🔐 Password copied to clipboard', 'success');
      } catch(e) {
        if (typeof showToast === 'function') showToast('Could not copy — please select and copy manually', 'warn');
      }
    }
  };

  /* ── Wizard-doc preview helper ──────────────────────────────────── */
  window.efinWizDocPreview = function (idx, appId) {
    var app = window.APPLICATIONS && APPLICATIONS.find(function(a) { return a.id === appId; });
    if (!app || !app.uploadedDocs || !app.uploadedDocs[idx]) return;
    var doc = app.uploadedDocs[idx];

    // Always sync latest dataUrl from _BFP_STORE (FileReader may have finished
    // after the doc object was originally captured, so _BFP_STORE has the
    // most up-to-date dataUrl while doc.dataUrl may still be empty).
    if (!window._BFP_STORE) window._BFP_STORE = {};
    var stored = doc.storeKey ? window._BFP_STORE[doc.storeKey] : null;
    if (stored && stored.dataUrl && !doc.dataUrl) {
      doc.dataUrl = stored.dataUrl;   // patch the app doc entry too
    }

    // Ensure _BFP_STORE entry exists with the freshest data available
    // FIX: always carry pdfPassword and isPasswordProtected from app.uploadedDocs
    //      so the preview modal can use the stored password.
    if (doc.storeKey && !stored) {
      window._BFP_STORE[doc.storeKey] = {
        name                : doc.fileName,
        mimetype            : doc.mimetype,
        url                 : doc.objUrl  || doc.dataUrl || '',
        dataUrl             : doc.dataUrl || '',
        isImage             : doc.isImage,
        isPdf               : doc.isPdf,
        pdfPassword         : doc.pdfPassword         || null,
        isPasswordProtected : doc.isPasswordProtected || false,
      };
    } else if (doc.storeKey && stored) {
      // Keep _BFP_STORE fresh — merge any newer dataUrl and password from app.uploadedDocs
      if (doc.dataUrl  && !stored.dataUrl)  stored.dataUrl  = doc.dataUrl;
      if (doc.pdfPassword && !stored.pdfPassword) {
        stored.pdfPassword         = doc.pdfPassword;
        stored.isPasswordProtected = true;
      }
    }

    if (typeof openPreviewModal === 'function' && doc.storeKey) {
      openPreviewModal(doc.storeKey);
      return;
    }

    // Fallback: open in new tab using the best available URL
    var url = doc.dataUrl || doc.objUrl || '';
    if (!url) { if (typeof showToast === 'function') showToast('File preview not available — re-upload to refresh', 'warn'); return; }
    if (doc.isPdf && doc.pdfPassword && typeof pdfjsLib !== 'undefined') {
      // FIX: password-protected PDF — can't use a plain iframe in a new tab.
      // Use pdf.js canvas renderer instead (same as openPreviewModal).
      if (typeof openPreviewModal === 'function' && doc.storeKey) {
        openPreviewModal(doc.storeKey);
      } else {
        if (typeof showToast === 'function') showToast('🔐 Password-protected PDF — preview loaded in document viewer', 'info');
      }
      return;
    }
    var w = window.open('', '_blank');
    if (w) {
      if (doc.isPdf) {
        w.document.write('<html><body style="margin:0"><iframe src="' + url + '" style="width:100%;height:100vh;border:none"></iframe></body></html>');
      } else {
        w.document.write('<html><body style="margin:0;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh"><img src="' + url + '" style="max-width:100%;max-height:100vh;object-fit:contain"></body></html>');
      }
    }
  };

  /* ── Wizard-doc download helper ─────────────────────────────────── */
  window.efinWizDocDownload = function(idx, appId) {
    var app = window.APPLICATIONS && APPLICATIONS.find(function(a) { return a.id === appId; });
    if (!app || !app.uploadedDocs || !app.uploadedDocs[idx]) {
      if (typeof showToast === 'function') showToast('Document not available — please re-upload', 'warn');
      return;
    }
    var doc = app.uploadedDocs[idx];

    // Sync latest dataUrl from _BFP_STORE
    var stored = doc.storeKey && window._BFP_STORE ? window._BFP_STORE[doc.storeKey] : null;
    if (stored && stored.dataUrl && !doc.dataUrl) doc.dataUrl = stored.dataUrl;
    if (stored && stored.url    && !doc.objUrl)  doc.objUrl  = stored.url;

    var url = doc.dataUrl || doc.objUrl || '';
    if (!url) {
      if (typeof showToast === 'function') showToast('File not available in this session — please re-upload the document to download', 'warn');
      return;
    }
    // Trigger download
    var a = document.createElement('a');
    a.href = url;
    a.download = doc.fileName || (doc.docName + (doc.isPdf ? '.pdf' : ''));
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (doc.isPasswordProtected && typeof showToast === 'function') {
      showToast('🔐 File downloaded — use the saved password to open it', 'info');
    }
  };

  window._efinEditFieldLabels = {
    'ed-name':   'Applicant Name',
    'ed-mobile': 'Mobile',
    'ed-email':  'Email',
    'ed-pan':    'PAN',
    'ed-aadhar': 'Aadhaar',
    'ed-amount': 'Loan Amount',
    'ed-bank':   'Bank / NBFC',
    'ed-rate':   'Interest Rate',
    'ed-tenure': 'Tenure',
    'ed-sales':  'Sales Person',
    'ed-cibil':  'CIBIL Score',
  };
  window._efinEditSnapshot = {};

  /* ──────────────────────────────────────────────────────────────────
     PERIODIC BADGE REFRESH (every 60 s)
  ─────────────────────────────────────────────────────────────────── */

  setInterval(function () {
    _refreshTaskNavBadge();
    if (typeof updateDashboardStats === 'function') updateDashboardStats();
  }, 60000);


  /* ══════════════════════════════════════════════════════════════════
     ACCESS GATE — Sales / Team Lead / Manager
     ─────────────────────────────────────────────────────────────────
     Design:
       Affected roles  : sales_executive | team_leader | manager
       All tabs        : ALWAYS visible (Documents, Lender, Timeline,
                         Tasks, Obligations, etc. — never hidden)

       DEFAULT (locked):
         • No action buttons (Hold, Reject, Disburse, Underwriting…)
         • No Edit Details button
         • No Raise Ticket button
         • Status badge only in action bar + amber info banner
         • Tabs: ALL visible
         • 5 core tabs (Overview, Personal, Address, Employment,
           References): visible but every field is READ-ONLY
         • All other tabs: visible but all controls READ-ONLY

       UNLOCK condition A — App assigned to user:
         app.sales === currentUser.name
         → Full role permissions restored (action buttons, edit, etc.)
         → All fields in all permitted tabs become editable per ROLES

       UNLOCK condition B — Task assigned to user:
         An open/draft task of type 'eav' OR name containing
         "Application Verification" is assigned to currentUser.name
         → Action buttons restored per role permissions
         → Only the 5 core tabs (Overview/Personal/Address/Employment/
           References) become editable; all other tabs stay read-only
         → User can complete the task from the Tasks tab (visible)

       Re-evaluated live on: openDetail, saveTask, completeTask,
                             switchTab, efinMarkTaskDone
  ══════════════════════════════════════════════════════════════════ */

  var EFIN_GATED_ROLES = ['sales_executive', 'team_leader', 'manager'];

  /* ── Lock-state helpers ──────────────────────────────────────── */

  /** true  → user has NO access (fully locked)
      false → user owns the app OR has a relevant task → use normal flow */
  window.efinIsAppLocked = function (app) {
    if (!app || !window.currentUser) return false;
    if (EFIN_GATED_ROLES.indexOf(currentUser.role) === -1) return false;

    // Condition A: app formally assigned to this user
    if ((app.sales || '').trim().toLowerCase() ===
        (currentUser.name || '').trim().toLowerCase()) return false;

    // Condition B: open/draft EAV or "Application Verification" task
    var tasks = (window.TASK_STORE || []).filter(function (t) {
      if (t.appId !== app.id) return false;
      if (t.status === 'done' || t.status === 'cancelled') return false;
      var myName   = (currentUser.name || '').trim().toLowerCase();
      var assigned = (t.user_name || '').trim().toLowerCase() === myName;
      var isEav    = t.assign_type === 'eav';
      var nameHit  = (t.name || '').toLowerCase().indexOf('application verification') !== -1;
      return assigned && (isEav || nameHit);
    });
    if (tasks.length > 0) return false;

    return true; // fully locked
  };

  /** true  → app is assigned to this user (full unlock) */
  window.efinIsAppOwner = function (app) {
    if (!app || !window.currentUser) return false;
    if (EFIN_GATED_ROLES.indexOf(currentUser.role) === -1) return false;
    return (app.sales || '').trim().toLowerCase() ===
           (currentUser.name || '').trim().toLowerCase();
  };

  /** true  → user has a relevant task but app is NOT assigned to them
      (partial unlock: only 5 tabs editable, actions restored) */
  window.efinHasTaskUnlock = function (app) {
    if (!app || !window.currentUser) return false;
    if (EFIN_GATED_ROLES.indexOf(currentUser.role) === -1) return false;
    if (window.efinIsAppOwner(app)) return false; // full owner — not task-unlock
    var tasks = (window.TASK_STORE || []).filter(function (t) {
      if (t.appId !== app.id) return false;
      if (t.status === 'done' || t.status === 'cancelled') return false;
      var myName   = (currentUser.name || '').trim().toLowerCase();
      var assigned = (t.user_name || '').trim().toLowerCase() === myName;
      var isEav    = t.assign_type === 'eav';
      var nameHit  = (t.name || '').toLowerCase().indexOf('application verification') !== -1;
      return assigned && (isEav || nameHit);
    });
    return tasks.length > 0;
  };

  /* ── Lock banner (shown in action bar when locked) ────────────── */
  function _renderGateLockBanner() {
    var role  = window.ROLES && window.currentUser && ROLES[currentUser.role];
    var label = role ? role.label : (currentUser ? currentUser.role : '');
    return '<div id="efin-app-lock-banner" style="display:flex;align-items:flex-start;' +
      'gap:12px;padding:12px 18px;background:rgba(230,126,0,.07);' +
      'border:1.5px solid rgba(230,126,0,.3);border-radius:12px;font-size:12.5px;' +
      'color:#7a4a00;line-height:1.55;max-width:680px;">' +
      '<span style="font-size:20px;flex-shrink:0;margin-top:1px">🔒</span>' +
      '<div>' +
        '<div style="font-weight:700;margin-bottom:3px">' +
          'View-only — ' + label +
        '</div>' +
        '<div style="color:#8a5800;">Action buttons and edits are available once this ' +
        'application is assigned to your name, or an ' +
        '<strong>Application Verification</strong> task is created for you.</div>' +
        '<div style="margin-top:5px;font-size:11.5px;color:#a36000;">' +
          'You may read all tabs. Editable sections when a task is assigned: ' +
          '<strong>Overview · Personal · Address · Employment · References</strong>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* Task-unlock info banner (replaces action buttons bar — actions are restored via role) */
  function _renderGateTaskBanner() {
    var role  = window.ROLES && window.currentUser && ROLES[currentUser.role];
    var label = role ? role.label : (currentUser ? currentUser.role : '');
    return '<div id="efin-app-task-banner" style="display:flex;align-items:flex-start;' +
      'gap:12px;padding:12px 18px;background:rgba(26,115,64,.06);' +
      'border:1.5px solid rgba(26,115,64,.28);border-radius:12px;font-size:12.5px;' +
      'color:#14532d;line-height:1.55;max-width:680px;">' +
      '<span style="font-size:20px;flex-shrink:0;margin-top:1px">✅</span>' +
      '<div>' +
        '<div style="font-weight:700;margin-bottom:3px">Task access — ' + label + '</div>' +
        '<div style="color:#166534;">An Application Verification task has been assigned to you. ' +
        'You can now make changes in: ' +
        '<strong>Overview · Personal · Address · Employment · References</strong></div>' +
      '</div>' +
    '</div>';
  }

  /* ── Read-only enforcement ────────────────────────────────────── */

  /** Disable all interactive controls in a tab content element */
  function _disableTabControls(tabEl) {
    if (!tabEl) return;
    tabEl.querySelectorAll('input, select, textarea').forEach(function (el) {
      el.disabled = true;
      el.style.cursor = 'not-allowed';
      el.style.opacity = '0.72';
    });
    tabEl.querySelectorAll('button').forEach(function (btn) {
      // Keep navigation / back buttons working
      if (btn.closest('.tracking-actions') ||
          btn.closest('.card-head') ||
          btn.classList.contains('btn-ghost') && (btn.textContent || '').trim() === '← Back') return;
      btn.disabled = true;
      btn.style.cursor = 'not-allowed';
      btn.style.opacity = '0.55';
      btn.style.pointerEvents = 'none';
    });
  }

  /** Make ALL tab content areas read-only (called in full-lock state) */
  function _makeAllTabsReadOnly() {
    var ALL_TABS = [
      'tab-overview','tab-personal','tab-address','tab-employment','tab-references',
      'tab-documents','tab-lender-details','tab-tracking-tab','tab-tasks-tab','tab-obligations-tab'
    ];
    ALL_TABS.forEach(function (id) {
      _disableTabControls(document.getElementById(id));
    });
  }

  /** Make only the non-core tabs read-only (called in task-unlock state) */
  function _makeNonCoreTabsReadOnly() {
    var NON_CORE = [
      'tab-documents','tab-lender-details','tab-tracking-tab',
      'tab-tasks-tab','tab-obligations-tab'
    ];
    NON_CORE.forEach(function (id) {
      _disableTabControls(document.getElementById(id));
    });
  }

  /* ── Tab visibility — all tabs always shown ───────────────────── */
  function _showAllTabs() {
    // Restore tab visibility that role config already granted — use applyTabVisibility
    var rd = window.ROLES && window.currentUser && ROLES[currentUser.role];
    if (rd && typeof applyTabVisibility === 'function') applyTabVisibility(rd);
  }

  /* ── Action bar rendering ─────────────────────────────────────── */

  /** Fully locked: status badge + lock banner, no buttons */
  function _renderActionBarLocked(app) {
    var actBar = document.getElementById('detail-actions');
    if (!actBar) return;
    var statusLabel = (window.STATUSES && STATUSES[app.status]) || app.status;
    actBar.innerHTML =
      '<span class="badge badge-' + app.status + '" ' +
        'style="font-size:13px;padding:6px 14px">' + statusLabel + '</span>' +
      _renderGateLockBanner();
  }

  /** Task-unlocked: status badge + task banner + role action buttons restored */
  function _renderActionBarTaskUnlock(app) {
    var actBar = document.getElementById('detail-actions');
    if (!actBar) return;
    var rd = window.ROLES && window.currentUser && ROLES[currentUser.role];
    if (!rd) return;

    // Always go through buildDetailActionBar — it handles rejected, re-open, More Actions, etc.
    var baseHtml = (typeof window.buildDetailActionBar === 'function')
      ? window.buildDetailActionBar(app, rd)
      : (function () {
          var statusLabel = (window.STATUSES && STATUSES[app.status]) || app.status;
          var h = '<span class="badge badge-' + app.status + '" style="font-size:13px;padding:6px 14px">' + statusLabel + '</span>';
          if (typeof buildWorkflowActionButtons === 'function') h += buildWorkflowActionButtons(app, rd);
          if (rd.canHoldApp && ['disbursed','rejected','ni','cancelled'].indexOf(app.status) === -1)
            h += '<button class="btn btn-warn btn-sm" onclick="holdApp(\'' + app.id + '\')">Hold</button>';
          if (rd.canRejectApp && ['disbursed','rejected'].indexOf(app.status) === -1)
            h += '<button class="btn btn-danger btn-sm" onclick="rejectApp(\'' + app.id + '\')">Reject</button>';
          return h;
        })();

    // Append the task-unlock banner to whatever buildDetailActionBar produced
    actBar.innerHTML = baseHtml + _renderGateTaskBanner();
  }

  /* ── Main gate enforcer ───────────────────────────────────────── */
  function _efinEnforceAccessGate(app) {
    if (!app || !window.currentUser) return;
    if (EFIN_GATED_ROLES.indexOf(currentUser.role) === -1) return;

    var locked     = window.efinIsAppLocked(app);
    var taskUnlock = window.efinHasTaskUnlock(app);

    if (locked) {
      // ── FULLY LOCKED ──
      _renderActionBarLocked(app);
      _showAllTabs(); // all tabs visible per role, but all read-only
      setTimeout(_makeAllTabsReadOnly, 80);

    } else if (taskUnlock) {
      // ── TASK UNLOCK: actions restored, only core 5 tabs editable ──
      _renderActionBarTaskUnlock(app);
      _showAllTabs();
      // Non-core tabs stay read-only
      setTimeout(_makeNonCoreTabsReadOnly, 80);

    }
    // else: app owner — no gate applied, full normal rendering
  }

  /* ── Tab switch guard ─────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () {
      var _origST = window.switchTab;
      if (typeof _origST === 'function' && !window._efinStGatePatched) {
        window._efinStGatePatched = true;
        window.switchTab = function (tabName, el) {
          var result = _origST.apply(this, arguments);
          var app = window.currentDetail;
          if (!app || EFIN_GATED_ROLES.indexOf(currentUser.role) === -1) return result;

          var locked     = window.efinIsAppLocked(app);
          var taskUnlock = window.efinHasTaskUnlock(app);
          var CORE_TABS  = ['overview','personal','address','employment','references'];
          var isCore     = CORE_TABS.indexOf(tabName) !== -1;

          if (locked) {
            // All tabs read-only
            setTimeout(function () { _disableTabControls(document.getElementById('tab-' + tabName)); }, 60);
          } else if (taskUnlock && !isCore) {
            // Non-core tab: read-only even when task-unlocked
            setTimeout(function () { _disableTabControls(document.getElementById('tab-' + tabName)); }, 60);
          }
          return result;
        };
      }
    }, 950);
  });

  /* ── openDetail outermost wrapper (runs after all other patches) ── */
  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () {
      if (!window._efinGateOdPatched) {
        window._efinGateOdPatched = true;
        var _gateOdOrig = window.openDetail;
        if (typeof _gateOdOrig === 'function') {
          window.openDetail = function (id) {
            var result = _gateOdOrig.apply(this, arguments);
            var app = window.APPLICATIONS &&
              APPLICATIONS.find(function (a) { return a.id === id; });
            if (app) _efinEnforceAccessGate(app);
            return result;
          };
        }
      }
    }, 1050);
  });

  /* ── Re-evaluate on task save / complete ──────────────────────── */
  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () {

      // saveTask: a new task may unlock the current view
      var _origSaveTask = window.saveTask;
      if (typeof _origSaveTask === 'function' && !window._efinGateSaveTaskPatched) {
        window._efinGateSaveTaskPatched = true;
        window.saveTask = function () {
          var result = _origSaveTask.apply(this, arguments);
          if (window.currentDetail) {
            setTimeout(function () { _efinEnforceAccessGate(window.currentDetail); }, 150);
          }
          return result;
        };
      }

      // completeTask: finishing a task may re-lock
      var _origCompleteTask = window.completeTask;
      if (typeof _origCompleteTask === 'function' && !window._efinGateCmpTaskPatched) {
        window._efinGateCmpTaskPatched = true;
        window.completeTask = function () {
          var result = _origCompleteTask.apply(this, arguments);
          if (window.currentDetail) {
            setTimeout(function () {
              if (typeof openDetail === 'function') openDetail(window.currentDetail.id);
            }, 200);
          }
          return result;
        };
      }

      // efinMarkTaskDone (improvements patch task board): same re-lock logic
      var _origMarkDone = window.efinMarkTaskDone;
      if (typeof _origMarkDone === 'function' && !window._efinGateMarkDonePatched) {
        window._efinGateMarkDonePatched = true;
        window.efinMarkTaskDone = function (taskId) {
          var result = _origMarkDone.apply(this, arguments);
          if (window.currentDetail) {
            setTimeout(function () {
              if (typeof openDetail === 'function') openDetail(window.currentDetail.id);
            }, 250);
          }
          return result;
        };
      }

    }, 1000);
  });

  

})();