/* reports-tabs.js — Reports Sub-Tab switching + rendering
 * Load order: LAST — after all other JS scripts
 * Exposes: window.switchReportsSubTab, window.initReportsSubTabs
 *          window._renderReportsOtherInfo, window._renderReportsBankEligibility
 *          window._renderReportsOffer, window._escHtml
 * Depends on: window._loadCibilReport, window._cibilFetchLockReset,
 *             window.renderPerfiosReport, window.currentDetail,
 *             window.ROLES, window.currentUser, window.twLoginTeams, window.twUsers
 * DOM IDs: reports-subtab-*, reports-panel-*, reports-other-info-grid,
 *          reports-panel-bank-eligibility, reports-offer-body
 */
/* ── REPORTS SUB-TABS ── */
window.switchReportsSubTab = function switchReportsSubTab(name, el) {
  try {
    var ALL_PANELS = ['cibil','perfios','bank-eligibility','other-info','bank-elig-full','offer'];

    ALL_PANELS.forEach(function(k) {
      var t = document.getElementById('reports-subtab-' + k);
      if (t) { t.style.borderBottomColor = 'transparent'; t.style.color = 'var(--text3)'; t.style.background = ''; t.style.borderRadius = ''; }
      var p = document.getElementById('reports-panel-' + k);
      if (p) p.style.display = 'none';
    });

    if (el) { el.style.borderBottomColor = 'var(--accent)'; el.style.color = 'var(--accent)'; el.style.background = 'rgba(26,79,163,.06)'; el.style.borderRadius = '8px 8px 0 0'; }

    var panel = document.getElementById('reports-panel-' + name);
    if (panel) panel.style.display = 'block';

    if (name === 'cibil') {
      setTimeout(function() {
        try {
          if (typeof window._loadCibilReport === 'function') {
            // Reset fetch lock so re-clicking CIBIL tab always refreshes
            window._cibilFetchLockReset && window._cibilFetchLockReset();
            window._loadCibilReport();
          }
        } catch(e) { console.warn('[CIBIL] load error:', e); }
      }, 100);
    }

    if (name === 'perfios') {
      try {
        var lastData = window._lastPerfiosReport || window._lastPerfiosData || window._pendingPerfiosData;
        var emptyEl = document.getElementById('perfios-report-empty');
        var dataEl  = document.getElementById('perfios-report-data');
        if (lastData) {
          if (emptyEl) emptyEl.style.display = 'none';
          if (dataEl)  dataEl.style.display  = 'block';
          if (typeof window.renderPerfiosReport === 'function') window.renderPerfiosReport(lastData);
        } else {
          if (emptyEl) emptyEl.style.display = '';
          if (dataEl)  dataEl.style.display  = 'none';
        }
      } catch(e) { console.warn('[Reports] Perfios render error:', e); }
    }

    if (name === 'other-info') {
      try {
        var app = window.currentDetail;
        if (app && typeof window._renderReportsOtherInfo === 'function') window._renderReportsOtherInfo(app);
      } catch(e) { console.warn('[Reports] OtherInfo render error:', e); }
    }

    if (name === 'bank-eligibility') {
      try {
        var app = window.currentDetail;
        if (app && typeof window._renderReportsBankEligibility === 'function') window._renderReportsBankEligibility(app);
      } catch(e) { console.warn('[Reports] BankElig render error:', e); }
    }

    if (name === 'offer') {
      try {
        if (typeof window._renderReportsOffer === 'function') window._renderReportsOffer(window.currentDetail || null);
      } catch(e) { console.warn('[Reports] Offer render error:', e); }
    }

  } catch(outerErr) {
    console.error('[Reports] switchReportsSubTab error:', outerErr);
  }
};

window.initReportsSubTabs = function() {
  var cibilTab = document.getElementById('reports-subtab-cibil');
  if (cibilTab) window.switchReportsSubTab('cibil', cibilTab);
};

/* ── Render Other Info grid inside Reports tab ── */
function _renderReportsOtherInfo(app) {
  var grid = document.getElementById('reports-other-info-grid');
  if (!grid || !app) return;

  // Only ADMIN can edit
  var isAdmin = window.currentUser && window.currentUser.role === 'admin';
  var twLoginTeams  = window.twLoginTeams  || [];
  var twSalesTeams  = window.twSalesTeams  || [];
  var twLocations   = window.twLocations   || [];
  var twUsers       = window.twUsers       || [];
  var SEL_STYLE     = 'background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:6px 10px;font-size:12px;color:var(--text);font-family:var(--font-body);width:100%';

  var loginTeam = twLoginTeams.find(function(t) {
    return t.location === app.location && (t.members||[]).includes(app.loginUser);
  });

  // ── SALES PERSON dropdown ──
  // Show all sales/partner/team-leader users; if location set, filter to that location
  var salesPersonOpts = twUsers
    .filter(function(u) {
      var r = (u.role || '').toLowerCase();
      var isSales = r.includes('sales') || r === 'partner' || r.includes('team leader') || r.includes('team_leader');
      var locOk   = !app.location || (u.locs || []).includes(app.location);
      return isSales && locOk;
    })
    .map(function(u) {
      return '<option value="' + u.name + '"' + (u.name === app.sales ? ' selected' : '') + '>' + u.name + ' (' + u.role + ')</option>';
    }).join('');
  // If current sales value not in list, add it as an option so it stays visible
  var salesInList = twUsers.some(function(u) { return u.name === app.sales; });
  if (app.sales && !salesInList) {
    salesPersonOpts = '<option value="' + app.sales + '" selected>' + app.sales + '</option>' + salesPersonOpts;
  }
  var salesPersonCell = isAdmin
    ? '<select onchange="updateTeamField(\'' + app.id + '\',\'sales\',this.value)" style="' + SEL_STYLE + '">' +
        '<option value="">— Select Sales Person —</option>' + salesPersonOpts +
      '</select>'
    : (app.sales || '—');

  // ── SALES TEAM dropdown ──
  var salesTeamOpts = twSalesTeams
    .filter(function(t) { return !app.location || t.location === app.location; })
    .map(function(t) {
      return '<option value="' + t.name + '"' + (t.name === app.salesTeam ? ' selected' : '') + '>' + t.name + '</option>';
    }).join('');
  var salesTeamCell = isAdmin
    ? '<select onchange="updateTeamField(\'' + app.id + '\',\'salesTeam\',this.value)" style="' + SEL_STYLE + '">' +
        '<option value="">— Select Sales Team —</option>' + salesTeamOpts +
      '</select>'
    : (app.salesTeam || '—');

  // ── LOCATION dropdown ──
  var locationOpts = twLocations
    .map(function(l) {
      return '<option value="' + l.name + '"' + (l.name === app.location ? ' selected' : '') + '>' + l.name + '</option>';
    }).join('');
  var locationCell = isAdmin
    ? '<select onchange="updateTeamField(\'' + app.id + '\',\'location\',this.value)" style="' + SEL_STYLE + '">' +
        '<option value="">— Select Location —</option>' + locationOpts +
      '</select>'
    : (app.location || '—');

  // ── LOGIN USER dropdown ──
  var loginUserOpts = twUsers
    .filter(function(u) {
      var r = (u.role || '').toLowerCase();
      var eligible = r.includes('login') || r.includes('operation') || r === 'admin';
      var locOk    = !app.location || (u.locs || []).length === 0 || (u.locs || []).includes(app.location);
      return eligible && locOk;
    })
    .map(function(u) {
      return '<option value="' + u.name + '"' + (u.name === app.loginUser ? ' selected' : '') + '>' + u.name + ' (' + u.role + ')</option>';
    }).join('');
  var loginUserCell = isAdmin
    ? '<select onchange="updateLoginUser(\'' + app.id + '\',this.value)" style="' + SEL_STYLE + '">' +
        '<option value="">— Select Login User —</option>' + loginUserOpts +
      '</select>'
    : (app.loginUser || '—');

  // ── OPERATIONS MANAGER dropdown ──
  // Source: leaders of login/operation teams at this location
  var opsManagerOpts = twLoginTeams
    .filter(function(t) { return !app.location || t.location === app.location; })
    .map(function(t) { return t.leader; })
    .filter(function(v, i, a) { return v && a.indexOf(v) === i; })
    .map(function(name) {
      return '<option value="' + name + '"' + (name === app.opsManagerId ? ' selected' : '') + '>' + name + '</option>';
    }).join('');
  var opsManagerCell = isAdmin
    ? '<select onchange="updateTeamField(\'' + app.id + '\',\'opsManagerId\',this.value)" style="' + SEL_STYLE + '">' +
        '<option value="">— Select Operations Manager —</option>' + opsManagerOpts +
      '</select>'
    : (app.opsManagerId || '—');

  // ── LOGIN TEAM dropdown ──
  // Admin selects a team → loginUser auto-set to first member of that team
  var currentLoginTeamName = loginTeam ? loginTeam.name : '';
  var loginTeamOpts = twLoginTeams
    .filter(function(t) { return !app.location || t.location === app.location; })
    .map(function(t) {
      return '<option value="' + t.name + '"' + (t.name === currentLoginTeamName ? ' selected' : '') + '>' + t.name + (t.leader ? ' (' + t.leader + ')' : '') + '</option>';
    }).join('');
  var loginTeamCell = isAdmin
    ? '<select onchange="updateLoginTeam(\'' + app.id + '\',this.value)" style="' + SEL_STYLE + '">' +
        '<option value="">— Select Login Team —</option>' + loginTeamOpts +
      '</select>'
    : (currentLoginTeamName || '—');

  var rows = [
    { section: 'Team & Assignment' },
    { label: 'Sales Person',       value: salesPersonCell,  raw: isAdmin },
    { label: 'Sales Team',         value: salesTeamCell,    raw: isAdmin },
    { label: 'Location',           value: locationCell,     raw: isAdmin },
    { label: 'Login User',         value: loginUserCell,    raw: true },
    { label: 'Operations Manager', value: opsManagerCell,   raw: isAdmin },
    { label: 'Login Team',         value: loginTeamCell,    raw: isAdmin },
  ];

  // Add rejection info if rejected
  if (app.status === 'rejected') {
    rows.push({ section: 'Rejection' });
    rows.push({ label: 'Rejection Reason', value: badge(app.rejection_reason || 'Not specified', '#dc2626'), raw: true });
    rows.push({ label: 'Rejected At', value: fmtDt(app.rejectedAt) });
    rows.push({ label: 'Pre-Rejection Status', value: app.preRejectedStatus || '—' });
  }

  grid.innerHTML = rows.map(function(r) {
    if (r.section) {
      return '<div style="grid-column:1/-1;margin:10px 0 4px;padding-bottom:6px;border-bottom:1.5px solid var(--border);font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.8px;color:var(--accent);display:flex;align-items:center;gap:6px">' +
        (r.section === 'Application Info' ? '📋' : r.section === 'Team & Assignment' ? '👥' : r.section === 'Processing Details' ? '⚙️' : r.section === 'Rejection' ? '❌' : 'ℹ️') +
        ' ' + r.section + '</div>';
    }
    return '<div class="form-group" style="margin-bottom:14px">' +
      '<label style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);margin-bottom:6px;display:block">' + r.label + '</label>' +
      '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:13px;color:var(--text);min-height:38px;display:flex;align-items:center">' +
        (r.raw ? r.value : _escHtml(r.value)) +
      '</div>' +
    '</div>';
  }).join('');
}

/* ── Render Bank Eligibility inside Reports tab ── */
function _renderReportsBankEligibility(app) {
  var container = document.getElementById('reports-panel-bank-eligibility');
  if (!container || !app) return;

  var rd = window.ROLES && window.currentUser ? window.ROLES[window.currentUser.role] : null;
  var canCheck = rd && (rd.canCreateApp || (window.currentUser && window.currentUser.role === 'admin'));

  var banks = app.lastEligibleBanks || [];
  var hasbanks = banks.length > 0;

  // "Check Eligibility" first time, "Re-check / Change Banks" if already selected
  var btnLabel = hasbanks ? '🔄 Re-check / Change Banks' : '🔍 Check Eligibility';
  var checkBtn = canCheck
    ? '<button class="btn btn-primary btn-sm" onclick="if(typeof openDetailEligibilityWizard===\'function\')openDetailEligibilityWizard()" style="font-size:12px">' + btnLabel + '</button>'
    : '';

  var banksHtml = hasbanks
    ? banks.map(function(b) {
        return '<div style="display:flex;align-items:center;gap:12px;background:' + (b.isIncred?'rgba(245,158,11,.08)':'rgba(26,79,163,.06)') + ';border:1.5px solid ' + (b.isIncred?'rgba(245,158,11,.35)':'rgba(26,79,163,.2)') + ';border-radius:12px;padding:14px 18px;min-width:150px">' +
          '<div style="width:42px;height:42px;border-radius:10px;background:' + (b.isIncred?'rgba(245,158,11,.18)':'rgba(26,79,163,.14)') + ';display:flex;align-items:center;justify-content:center;font-weight:800;font-size:17px;color:' + (b.isIncred?'#f59e0b':'var(--accent)') + '">' + ((b.bankName||'B')[0]) + '</div>' +
          '<div>' +
            '<div style="font-size:14px;font-weight:700;color:var(--text)">' + _escHtml(b.bankName) + '</div>' +
            (b.isIncred ? '<div style="font-size:10.5px;color:#f59e0b;font-weight:600;margin-top:3px">● InCred</div>' : '') +
            (b.isElite  ? '<div style="font-size:10.5px;color:var(--accent2);font-weight:600;margin-top:3px">● Mudrahub</div>' : '') +
          '</div>' +
        '</div>';
      }).join('')
    : '<div style="color:var(--text3);font-size:13px;padding:12px 0">No banks selected yet. Click "Check Eligibility" to run the wizard.</div>';

  container.innerHTML =
    '<div style="padding:4px 0">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:10px">' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<span style="font-size:20px">🏦</span>' +
          '<div style="font-family:var(--font-head);font-size:15px;font-weight:700;color:var(--accent)">Bank Eligibility</div>' +
          (hasbanks ? '<span style="font-size:11px;background:rgba(26,79,163,.1);color:var(--accent);padding:2px 10px;border-radius:20px;font-weight:600">' + banks.length + ' bank' + (banks.length > 1 ? 's' : '') + ' selected</span>' : '') +
        '</div>' +
        checkBtn +
      '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;min-height:50px">' + banksHtml + '</div>' +
    '</div>';
}

/* ── Safe HTML escape ── */
function _escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Render Initial Offer inside Reports tab ── */
function _renderReportsOffer(app) {
  var body = document.getElementById('reports-offer-body');
  if (!body) return;

  // Priority: 1) app._offerData (saved from wizard CAM)  2) window._wizOfferData (current session)  3) app basic fields
  var od = (app && app._offerData) || window._wizOfferData || null;

  var amount   = (od && od.amount)   || (app && app.amount)   || 0;
  var tenure   = (od && od.tenure)   || (app && app.tenure)   || 0;
  var loanRate = (od && od.loanRate) || (app && app.loanRate) || 0;
  var rateMin  = (od && od.rateMin)  || loanRate || 0;
  var rateMax  = (od && od.rateMax)  || loanRate || 0;
  var emi      = (od && od.emi)      || 0;
  var maxAmt   = (od && od.maxAmt)   || amount   || 0;
  var plans    = (od && od.plans)    || [];
  var empBonus = (od && od.empBonus) || '';
  var appName  = (app && (app.name || app.fname)) || (od && od.appName) || 'Applicant';

  if (!amount && !maxAmt) {
    body.innerHTML = '<div style="color:var(--text3);font-size:13px;text-align:center;padding:32px 0">No offer generated yet for this application.</div>';
    return;
  }

  var fmt = function(n) { return '₹' + Number(n||0).toLocaleString('en-IN'); };
  var roiLine = (rateMin && rateMax && rateMin !== rateMax)
    ? rateMin.toFixed(2) + '% – ' + rateMax.toFixed(2) + '% p.a.'
    : (loanRate ? loanRate.toFixed(2) + '% p.a.' : '—');

  // EMI plan cards
  var plansHtml = '';
  if (plans.length) {
    plansHtml = '<div style="margin-top:14px"><div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">EMI Plans</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:10px">' +
      plans.slice(0,4).map(function(p, i) {
        var isFirst = i === 0;
        return '<div style="flex:1;min-width:130px;padding:12px 14px;border-radius:10px;background:' + (isFirst?'rgba(26,79,163,.08)':'var(--surface2)') + ';border:1.5px solid ' + (isFirst?'var(--accent)':'var(--border)') + '">' +
          '<div style="font-size:9px;font-weight:700;text-transform:uppercase;color:var(--text3);margin-bottom:4px">Option ' + (i+1) + '</div>' +
          '<div style="font-size:14px;font-weight:800;color:var(--text)">' + fmt(p.emi) + '<span style="font-size:10px;font-weight:500">/mo</span></div>' +
          '<div style="font-size:11px;color:var(--text3);margin-top:3px">' + p.tenure + ' Months</div>' +
          '<div style="font-size:10px;color:var(--accent);font-weight:600;margin-top:2px">Max ' + fmt(p.loanAmt) + '</div>' +
        '</div>';
      }).join('') +
      '</div></div>';
  }

  // Employer bonus
  var bonusHtml = empBonus
    ? '<div style="margin-top:14px;padding:10px 14px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3);border-radius:8px;font-size:12px;color:#92400e">⭐ ' + _escHtml(empBonus) + '</div>'
    : '';

  body.innerHTML =
    // Hero card
    '<div style="background:linear-gradient(135deg,#0f3278,#1a4fa3);border-radius:14px;padding:22px 24px;margin-bottom:16px;color:#fff">' +
      '<div style="font-size:10px;font-weight:700;letter-spacing:1px;opacity:.7;margin-bottom:6px">OFFER CONFIRMED &amp; READY</div>' +
      '<div style="font-size:30px;font-weight:800;margin-bottom:4px">' + fmt(maxAmt || amount) + '</div>' +
      '<div style="font-size:13px;font-weight:500;opacity:.85">Congratulations, <strong>' + _escHtml(appName) + '</strong>!</div>' +
      '<div style="font-size:11px;opacity:.7;margin-top:3px">Your offer based on information available with us.</div>' +
    '</div>' +

    // Stats row
    '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:4px">' +
      '<div style="flex:1;min-width:100px;padding:12px 14px;background:var(--surface2);border-radius:10px;border:1px solid var(--border);text-align:center">' +
        '<div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Loan Amount</div>' +
        '<div style="font-size:15px;font-weight:700;color:#15803d">' + fmt(amount) + '</div>' +
      '</div>' +
      '<div style="flex:1;min-width:100px;padding:12px 14px;background:var(--surface2);border-radius:10px;border:1px solid var(--border);text-align:center">' +
        '<div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Tenure</div>' +
        '<div style="font-size:15px;font-weight:700;color:var(--accent)">' + (tenure||'—') + ' Months</div>' +
      '</div>' +
      '<div style="flex:1;min-width:100px;padding:12px 14px;background:var(--surface2);border-radius:10px;border:1px solid var(--border);text-align:center">' +
        '<div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Monthly EMI</div>' +
        '<div style="font-size:15px;font-weight:700;color:var(--text)">' + (emi ? fmt(emi) : '—') + '</div>' +
      '</div>' +
      '<div style="flex:1;min-width:100px;padding:12px 14px;background:var(--surface2);border-radius:10px;border:1px solid var(--border);text-align:center">' +
        '<div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">ROI (Reducing)</div>' +
        '<div style="font-size:13px;font-weight:700;color:var(--accent2)">' + roiLine + '</div>' +
      '</div>' +
    '</div>' +

    plansHtml +
    bonusHtml +

    '<div style="margin-top:14px;padding:10px 14px;background:var(--surface2);border-radius:8px;font-size:11px;color:var(--text3)">📌 <strong>Note:</strong> Upon evaluation of your credit data, the final loan amount is subject to adjustment. This offer is indicative and based on the information provided.</div>';
}

/* ── Expose all render functions globally so switchReportsSubTab can call them ── */
window._renderReportsOtherInfo     = _renderReportsOtherInfo;
window._renderReportsBankEligibility = _renderReportsBankEligibility;
window._renderReportsOffer         = _renderReportsOffer;
