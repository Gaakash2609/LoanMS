// ════════════════════════════════════════════════════════════════════════
//  PRODUCT-SPECIFIC FIRST OFFER MATRICES  — v2
//  Policy & Product page mein har loan product ka alag First Offer Matrix.
//
//  ✅  Personal Loan ka existing CAM_MATRIX UNTOUCHED.
//  ✅  MutationObserver use karta hai — showPage chain pe depend nahi.
//  ✅  Zero impact on existing flows.
// ════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';
// ── Safe localStorage helpers (private to this module) ──
var _lsGet = function(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } };
var _lsSet = function(k,v){ try{ localStorage.setItem(k,v); }catch(e){} };
var _lsRemove = function(k){ try{ localStorage.removeItem(k); }catch(e){} };
;

  var PP_PRODUCTS = [
    { key: 'business_loan',         icon: '🏦', name: 'Business Loan',           desc: 'Self-employed · MSME',           color: '#1a4fa3,#3b82f6' },
    { key: 'loan_against_property', icon: '🏠', name: 'LAP',                     desc: 'Loan Against Property',          color: '#7c3aed,#a78bfa' },
    { key: 'home_loan',             icon: '🏡', name: 'Home Loan',               desc: 'Purchase · Construction',        color: '#059669,#34d399' },
    { key: 'education_loan',        icon: '🎓', name: 'Education Loan',          desc: 'Domestic · Abroad study',        color: '#d97706,#fbbf24' },
    { key: 'new_car_loan',          icon: '🚗', name: 'New Car Loan',            desc: 'New vehicle finance',            color: '#0891b2,#22d3ee' },
    { key: 'used_car_loan',         icon: '🚙', name: 'Used Car Loan',           desc: 'Pre-owned vehicle finance',      color: '#be185d,#f472b6' },
    { key: 'over_draft',            icon: '💳', name: 'Overdraft / Cash Credit', desc: 'Business cash credit · OD / CC', color: '#6d28d9,#c4b5fd' },
    { key: 'insurance',             icon: '🛡️', name: 'Insurance',               desc: 'Life · General · Health',        color: '#b45309,#fcd34d' },
  ];

  var PP_DEFAULTS = {
    business_loan: [
      { label: '20K to 30K',  salaryMin: 20000,  salaryMax: 30000,  rateMin: 18, rateMax: 24, tenureMin: 12, tenureMax: 36,  foir: 0.40 },
      { label: '30K to 50K',  salaryMin: 30000,  salaryMax: 50000,  rateMin: 16, rateMax: 22, tenureMin: 12, tenureMax: 48,  foir: 0.45 },
      { label: '50K to 1L',   salaryMin: 50000,  salaryMax: 100000, rateMin: 14, rateMax: 18, tenureMin: 24, tenureMax: 60,  foir: 0.50 },
      { label: '1L to 2L',    salaryMin: 100000, salaryMax: 200000, rateMin: 13, rateMax: 16, tenureMin: 24, tenureMax: 60,  foir: 0.55 },
      { label: '2L+ >',       salaryMin: 200000, salaryMax: 999999, rateMin: 11, rateMax: 15, tenureMin: 24, tenureMax: 84,  foir: 0.60 },
    ],
    loan_against_property: [
      { label: '25K to 50K',  salaryMin: 25000,  salaryMax: 50000,  rateMin: 10, rateMax: 14, tenureMin: 60,  tenureMax: 120, foir: 0.50 },
      { label: '50K to 1L',   salaryMin: 50000,  salaryMax: 100000, rateMin: 9,  rateMax: 13, tenureMin: 60,  tenureMax: 180, foir: 0.55 },
      { label: '1L to 2L',    salaryMin: 100000, salaryMax: 200000, rateMin: 9,  rateMax: 12, tenureMin: 60,  tenureMax: 180, foir: 0.60 },
      { label: '2L+ >',       salaryMin: 200000, salaryMax: 999999, rateMin: 8,  rateMax: 11, tenureMin: 84,  tenureMax: 240, foir: 0.65 },
    ],
    home_loan: [
      { label: '20K to 35K',  salaryMin: 20000,  salaryMax: 35000,  rateMin: 8.5, rateMax: 10,  tenureMin: 60,  tenureMax: 180, foir: 0.40 },
      { label: '35K to 60K',  salaryMin: 35000,  salaryMax: 60000,  rateMin: 8.5, rateMax: 9.5, tenureMin: 120, tenureMax: 240, foir: 0.45 },
      { label: '60K to 1L',   salaryMin: 60000,  salaryMax: 100000, rateMin: 8.4, rateMax: 9.5, tenureMin: 120, tenureMax: 300, foir: 0.50 },
      { label: '1L+ >',       salaryMin: 100000, salaryMax: 999999, rateMin: 8.3, rateMax: 9,   tenureMin: 120, tenureMax: 300, foir: 0.55 },
    ],
    education_loan: [
      { label: '15K to 25K',  salaryMin: 15000,  salaryMax: 25000,  rateMin: 10, rateMax: 14, tenureMin: 12, tenureMax: 60, foir: 0.35 },
      { label: '25K to 50K',  salaryMin: 25000,  salaryMax: 50000,  rateMin: 9,  rateMax: 12, tenureMin: 12, tenureMax: 84, foir: 0.40 },
      { label: '50K+ >',      salaryMin: 50000,  salaryMax: 999999, rateMin: 8,  rateMax: 11, tenureMin: 12, tenureMax: 84, foir: 0.45 },
    ],
    new_car_loan: [
      { label: '15K to 25K',  salaryMin: 15000,  salaryMax: 25000,  rateMin: 8,   rateMax: 11, tenureMin: 12, tenureMax: 48, foir: 0.40 },
      { label: '25K to 50K',  salaryMin: 25000,  salaryMax: 50000,  rateMin: 7.5, rateMax: 10, tenureMin: 12, tenureMax: 60, foir: 0.50 },
      { label: '50K+ >',      salaryMin: 50000,  salaryMax: 999999, rateMin: 7,   rateMax: 9,  tenureMin: 12, tenureMax: 84, foir: 0.55 },
    ],
    used_car_loan: [
      { label: '15K to 25K',  salaryMin: 15000,  salaryMax: 25000,  rateMin: 12, rateMax: 18, tenureMin: 12, tenureMax: 36, foir: 0.40 },
      { label: '25K to 50K',  salaryMin: 25000,  salaryMax: 50000,  rateMin: 11, rateMax: 16, tenureMin: 12, tenureMax: 48, foir: 0.45 },
      { label: '50K+ >',      salaryMin: 50000,  salaryMax: 999999, rateMin: 10, rateMax: 14, tenureMin: 12, tenureMax: 60, foir: 0.50 },
    ],
    over_draft: [
      { label: '30K to 75K',  salaryMin: 30000,  salaryMax: 75000,  rateMin: 14, rateMax: 18, tenureMin: 12, tenureMax: 24, foir: 0.40 },
      { label: '75K to 1.5L', salaryMin: 75000,  salaryMax: 150000, rateMin: 13, rateMax: 16, tenureMin: 12, tenureMax: 24, foir: 0.45 },
      { label: '1.5L+ >',     salaryMin: 150000, salaryMax: 999999, rateMin: 11, rateMax: 14, tenureMin: 12, tenureMax: 36, foir: 0.50 },
    ],
    insurance: [
      { label: '1L to 3L PA',  salaryMin: 100000,  salaryMax: 300000,  rateMin: 1,   rateMax: 3, tenureMin: 12, tenureMax: 60,  foir: 0.05 },
      { label: '3L to 6L PA',  salaryMin: 300000,  salaryMax: 600000,  rateMin: 1,   rateMax: 2, tenureMin: 12, tenureMax: 120, foir: 0.04 },
      { label: '6L+ PA >',     salaryMin: 600000,  salaryMax: 9999999, rateMin: 0.5, rateMax: 2, tenureMin: 12, tenureMax: 240, foir: 0.03 },
    ],
  };

  var LS_KEY = 'efin_product_cam_v2';
  var _editingRow = {};

  function _initStore() {
    if (window.PRODUCT_CAM_MATRICES) return;
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) {}
    window.PRODUCT_CAM_MATRICES = {};
    PP_PRODUCTS.forEach(function (p) {
      window.PRODUCT_CAM_MATRICES[p.key] =
        (saved && Array.isArray(saved[p.key]) && saved[p.key].length)
          ? saved[p.key]
          : (PP_DEFAULTS[p.key] || []).map(function (r) { return Object.assign({}, r); });
    });
  }

  function _persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(window.PRODUCT_CAM_MATRICES)); } catch (e) {}
  }

  function _e(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function _fmtK(v) {
    if (v == null) return '0';
    var k = v / 1000;
    return (Number.isInteger(k) ? k : k.toFixed(1)) + 'K';
  }
  function _toast(msg, type) {
    if (typeof showToast === 'function') showToast(msg, type || 'success');
  }
  function _inp(id, type, val, w) {
    return '<input type="' + type + '" id="' + id + '" value="' + _e(val) + '"'
      + (type === 'number' ? ' step="any"' : '')
      + ' style="width:' + w + 'px;padding:4px 6px;border:1.5px solid var(--accent);border-radius:5px;font-size:12px;background:var(--surface);color:var(--text)">';
  }

  // ── Render all 8 product cards ────────────────────────────────────────
  window.ppRenderProductMatrixCards = function () {
    _initStore();
    var section = document.getElementById('pp-product-matrices-section');
    if (!section) return;
    var html = '';
    PP_PRODUCTS.forEach(function (p) {
      var cols = (p.color || '#1a4fa3,#3b82f6').split(',');
      html += '<div style="background:var(--surface);border:1.5px solid var(--border);border-radius:16px;margin-bottom:16px">'
        +   '<div style="display:flex;align-items:center;gap:14px;padding:18px 24px;border-bottom:1px solid var(--border);cursor:pointer" onclick="ppToggleProductMatrix(\'' + p.key + '\')">'
        +     '<div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,' + cols[0] + ',' + (cols[1]||cols[0]) + ');display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">' + p.icon + '</div>'
        +     '<div style="flex:1">'
        +       '<div style="font-size:15px;font-weight:800;color:var(--text);margin-bottom:2px">' + _e(p.name) + ' — First Offer Matrix</div>'
        +       '<div style="font-size:12px;color:var(--text3)">' + _e(p.desc) + ' · Edit income bands, rates, tenure &amp; FOIR caps</div>'
        +     '</div>'
        +     '<span style="font-size:10.5px;font-weight:700;padding:3px 10px;border-radius:20px;background:rgba(212,43,43,.1);color:var(--accent2);letter-spacing:.3px">ADMIN ONLY</span>'
        +     '<span id="pp-pmat-chev-' + p.key + '" style="font-size:14px;color:var(--text3);transition:transform .2s;margin-left:8px">▼</span>'
        +   '</div>'
        +   '<div id="pp-pmat-body-' + p.key + '" style="display:none;padding:20px 24px">'
        +     '<div id="pp-pmat-ct-' + p.key + '" style="color:var(--text3);font-size:13px">Loading…</div>'
        +   '</div>'
        + '</div>';
    });
    section.innerHTML = html;
  };

  // ── Toggle open / close — generic "First Offer Matrix" (Personal Loan) card ──
  // The actual editable table (auto-derive rates, premium companies boost, etc.)
  // already exists in full on the Policies & Roles page (#admin-cam-matrix-panel,
  // rendered by camAdminRender()). Rather than duplicating that ~10-function,
  // fully-working editor here under new element IDs — which would create two
  // separate copies of CAM_MATRIX editing UI that could drift out of sync —
  // this links straight to the single existing editor.
  window.ppToggleCam = function (el) {
    var body = document.getElementById('pp-cam-body');
    var chev = document.getElementById('pp-cam-chevron');
    if (!body) return;
    var open = body.style.display !== 'none';
    body.style.display = open ? 'none' : '';
    if (chev) chev.style.transform = open ? '' : 'rotate(180deg)';
    if (!open) {
      var mirror = document.getElementById('pp-cam-mirror');
      if (mirror) {
        mirror.innerHTML =
          '<div style="padding:16px;border:1px solid var(--border);border-radius:12px;background:var(--surface2);font-size:13px;color:var(--text2);line-height:1.5">'
          + '💡 This is the Personal Loan First Offer Matrix — managed on the <strong>Policies &amp; Roles</strong> page so there is one shared editor rather than two separate copies of the same data.'
          + '</div>'
          + '<button class="btn btn-primary" style="margin-top:14px" onclick="showPage(\'access-rights\')">🧮 Open First Offer Matrix Editor</button>';
      }
    }
  };

  // ── Toggle open / close — "InCred RM Emails" card ──
  // The actual RM management table + Add/Edit modal already exist in full on
  // the InCred page's "RM Emails" tab (incred-rm.js: renderRmEmails, openRmModal).
  // Same reasoning as ppToggleCam above — one shared editor, not two.
  window.ppToggleRmCard = function () {
    var body = document.getElementById('pp-rm-body');
    var chev = document.getElementById('pp-rm-chevron');
    if (!body) return;
    var open = body.style.display !== 'none';
    body.style.display = open ? 'none' : '';
    if (chev) chev.style.transform = open ? '' : 'rotate(180deg)';
    if (!open) {
      var content = document.getElementById('pp-rm-content');
      if (content) {
        content.innerHTML =
          '<div style="padding:16px;border:1px solid var(--border);border-radius:12px;background:var(--surface2);font-size:13px;color:var(--text2);line-height:1.5">'
          + '💡 Relationship Manager records are managed on the <strong>InCred</strong> page\'s RM Emails tab so there is one shared list rather than two separate copies.'
          + '</div>'
          + '<button class="btn btn-primary" style="margin-top:14px" onclick="ppOpenIncredRmTab()">👤 Open RM Emails</button>';
      }
      var badge = document.getElementById('pp-rm-count-badge');
      if (badge && Array.isArray(window.RM_EMAILS)) {
        badge.textContent = window.RM_EMAILS.length + ' RM' + (window.RM_EMAILS.length !== 1 ? 's' : '');
      }
    }
  };

  // ── Navigate to the InCred page and switch straight to its RM Emails tab ──
  window.ppOpenIncredRmTab = function () {
    var incredNav = document.querySelector('[data-menu-id="incred"]');
    if (typeof showPage === 'function') showPage('incred', incredNav);
    setTimeout(function () {
      var rmTab = document.querySelector('[data-incred-tab="rm"]');
      if (typeof switchIncredTab === 'function') switchIncredTab('rm', rmTab);
    }, 100);
  };

  // ── Toggle open / close ───────────────────────────────────────────────
  window.ppToggleProductMatrix = function (key) {
    var body = document.getElementById('pp-pmat-body-' + key);
    var chev = document.getElementById('pp-pmat-chev-' + key);
    if (!body) return;
    var open = body.style.display !== 'none';
    body.style.display = open ? 'none' : '';
    if (chev) chev.style.transform = open ? '' : 'rotate(180deg)';
    if (!open) {
      _initStore();
      ppRenderProductMatrix(key);
    }
  };

  // ── Render table for one product ─────────────────────────────────────
  window.ppRenderProductMatrix = function (key) {
    _initStore();
    var ct = document.getElementById('pp-pmat-ct-' + key);
    if (!ct) return;
    var mx  = window.PRODUCT_CAM_MATRICES[key] || [];
    var edt = (_editingRow[key] !== undefined) ? _editingRow[key] : -1;
    var pInfo = null;
    for (var z = 0; z < PP_PRODUCTS.length; z++) { if (PP_PRODUCTS[z].key === key) { pInfo = PP_PRODUCTS[z]; break; } }
    var incLbl = (key === 'insurance') ? 'Annual Inc.' : 'Income Band';

    // Table rows
    var rows = '';
    for (var i = 0; i < mx.length; i++) {
      var r  = mx[i];
      var bg = (i % 2 === 0) ? 'var(--surface2)' : 'var(--surface)';
      if (i === edt) {
        rows += '<tr style="background:rgba(26,79,163,.07);border-bottom:1px solid var(--border)">'
          + '<td style="padding:6px 7px">' + _inp('pme-'+key+'-label',    'text',   r.label,                   90) + '</td>'
          + '<td style="padding:6px 7px">' + _inp('pme-'+key+'-salMin',   'number', r.salaryMin,               75) + '</td>'
          + '<td style="padding:6px 7px">' + _inp('pme-'+key+'-salMax',   'number', r.salaryMax,               75) + '</td>'
          + '<td style="padding:6px 7px">' + _inp('pme-'+key+'-rateMin',  'number', r.rateMin,                 50) + '</td>'
          + '<td style="padding:6px 7px">' + _inp('pme-'+key+'-rateMax',  'number', r.rateMax,                 50) + '</td>'
          + '<td style="padding:6px 7px">' + _inp('pme-'+key+'-tenMin',   'number', r.tenureMin,               50) + '</td>'
          + '<td style="padding:6px 7px">' + _inp('pme-'+key+'-tenMax',   'number', r.tenureMax,               50) + '</td>'
          + '<td style="padding:6px 7px;text-align:right">' + _inp('pme-'+key+'-foir','number', Math.round(r.foir*100), 46) + '</td>'
          + '<td style="padding:6px 7px;text-align:center;white-space:nowrap">'
          +   '<button class="btn btn-success btn-sm" onclick="ppPmatSaveRow(\'' + key + '\',' + i + ')" style="font-size:11px;padding:3px 9px;margin-right:3px">✓ Save</button>'
          +   '<button class="btn btn-ghost btn-sm" onclick="ppPmatCancelEdit(\'' + key + '\')" style="font-size:11px;padding:3px 7px">✕</button>'
          + '</td></tr>';
      } else {
        rows += '<tr style="background:' + bg + ';border-bottom:1px solid var(--border)">'
          + '<td style="padding:8px 10px;font-size:12.5px;font-weight:600;color:var(--text2)">'  + _e(r.label)              + '</td>'
          + '<td style="padding:8px 10px;font-size:12px;color:var(--text2)">₹'                   + _fmtK(r.salaryMin)       + '</td>'
          + '<td style="padding:8px 10px;font-size:12px;color:var(--text2)">₹'                   + _fmtK(r.salaryMax)       + '</td>'
          + '<td style="padding:8px 10px;font-size:12px">'                                        + r.rateMin                + '%</td>'
          + '<td style="padding:8px 10px;font-size:12px">'                                        + r.rateMax                + '%</td>'
          + '<td style="padding:8px 10px;font-size:12px">'                                        + r.tenureMin              + 'm</td>'
          + '<td style="padding:8px 10px;font-size:12px">'                                        + r.tenureMax              + 'm</td>'
          + '<td style="padding:8px 10px;font-size:12px;text-align:right;font-weight:700;color:var(--accent)">' + Math.round(r.foir*100) + '%</td>'
          + '<td style="padding:8px 10px;text-align:center;white-space:nowrap">'
          +   '<button class="btn btn-primary btn-sm" onclick="ppPmatEditRow(\'' + key + '\',' + i + ')" style="font-size:11px;padding:3px 9px;margin-right:3px">✏️ Edit</button>'
          +   '<button class="btn btn-danger btn-sm" onclick="ppPmatDeleteRow(\'' + key + '\',' + i + ')" style="font-size:11px;padding:3px 7px">✕</button>'
          + '</td></tr>';
      }
    }

    // Add Band form helper
    function ni(fld, lbl, typ, ph) {
      return '<div><label style="font-size:10.5px;font-weight:700;color:var(--text3);display:block;margin-bottom:3px">' + lbl + '</label>'
        + '<input type="' + typ + '" id="pmn-' + key + '-' + fld + '" placeholder="' + ph + '" '
        + (typ==='number'?'step="any" ':'')
        + 'style="width:100%;padding:5px 7px;border:1.5px solid var(--border2);border-radius:6px;font-size:12px;background:var(--surface);color:var(--text);box-sizing:border-box"></div>';
    }

    var addForm = '<div style="margin:14px 0;padding:14px;background:var(--surface2);border:1px solid var(--border);border-radius:10px">'
      + '<div style="font-size:11px;font-weight:800;color:var(--accent);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">+ Add New Income Band</div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(105px,1fr));gap:8px;align-items:end">'
      + ni('label',    'Band Label',     'text',   '30K to 50K')
      + ni('salMin',   'Min Income (₹)', 'number', '30000')
      + ni('salMax',   'Max Income (₹)', 'number', '50000')
      + ni('rateMin',  'Rate Min %',     'number', '11')
      + ni('rateMax',  'Rate Max %',     'number', '15')
      + ni('tenMin',   'Ten. Min (M)',   'number', '12')
      + ni('tenMax',   'Ten. Max (M)',   'number', '60')
      + ni('foir',     'FOIR %',         'number', '50')
      + '<div><button class="btn btn-primary" onclick="ppPmatAddRow(\'' + key + '\')" style="width:100%;font-size:12px;padding:7px 10px">+ Add Band</button></div>'
      + '</div></div>';

    ct.innerHTML = '<div style="overflow-x:auto;border-radius:10px;border:1px solid var(--border)">'
      + '<table style="width:100%;border-collapse:collapse;font-size:13px">'
      + '<thead><tr style="background:var(--accent);color:#fff">'
      + '<th style="padding:10px 12px;text-align:left;font-weight:700;white-space:nowrap">' + incLbl + '</th>'
      + '<th style="padding:10px 12px;text-align:left;font-weight:700;white-space:nowrap">Min (₹)</th>'
      + '<th style="padding:10px 12px;text-align:left;font-weight:700;white-space:nowrap">Max (₹)</th>'
      + '<th style="padding:10px 12px;text-align:left;font-weight:700;white-space:nowrap">Rate Min %</th>'
      + '<th style="padding:10px 12px;text-align:left;font-weight:700;white-space:nowrap">Rate Max %</th>'
      + '<th style="padding:10px 12px;text-align:left;font-weight:700;white-space:nowrap">Ten. Min</th>'
      + '<th style="padding:10px 12px;text-align:left;font-weight:700;white-space:nowrap">Ten. Max</th>'
      + '<th style="padding:10px 12px;text-align:right;font-weight:700;white-space:nowrap">FOIR %</th>'
      + '<th style="padding:10px 12px;text-align:center;font-weight:700">Action</th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
      + addForm
      + '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:4px">'
      + '<button class="btn btn-primary" onclick="ppPmatSaveMatrix(\'' + key + '\')">✓ Save Matrix</button>'
      + '<button class="btn btn-ghost" onclick="ppPmatResetMatrix(\'' + key + '\')">↺ Reset to Defaults</button>'
      + '<span id="pp-pmat-saved-' + key + '" style="display:none;font-size:12px;color:var(--success);font-weight:600">✓ Saved</span>'
      + '</div>'
      + '<div style="margin-top:10px;font-size:12px;color:var(--text3)">💡 Changes saved to localStorage. Income bands for <strong>' + _e(pInfo ? pInfo.name : key) + '</strong> First Offer calculator.</div>';
  };

  // ── CRUD helpers ──────────────────────────────────────────────────────
  window.ppPmatEditRow = function (key, i) {
    _editingRow[key] = i;
    ppRenderProductMatrix(key);
    var el = document.getElementById('pme-' + key + '-label');
    if (el) setTimeout(function(){el.focus();}, 50);
  };
  window.ppPmatCancelEdit = function (key) {
    _editingRow[key] = -1;
    ppRenderProductMatrix(key);
  };
  window.ppPmatSaveRow = function (key, i) {
    var g = function(f){ var el=document.getElementById('pme-'+key+'-'+f); return el?el.value:''; };
    var mx = window.PRODUCT_CAM_MATRICES[key];
    if (!mx || !mx[i]) return;
    var sMin = parseFloat(g('salMin'))||0, sMax = parseFloat(g('salMax'))||0;
    mx[i].label     = g('label') || (_fmtK(sMin)+' to '+_fmtK(sMax));
    mx[i].salaryMin = sMin;
    mx[i].salaryMax = sMax;
    mx[i].rateMin   = parseFloat(g('rateMin'))||0;
    mx[i].rateMax   = parseFloat(g('rateMax'))||0;
    mx[i].tenureMin = parseInt(g('tenMin'),10)||0;
    mx[i].tenureMax = parseInt(g('tenMax'),10)||0;
    mx[i].foir      = (parseFloat(g('foir'))||0)/100;
    _editingRow[key] = -1;
    ppRenderProductMatrix(key);
    _toast('✓ Band updated');
  };
  window.ppPmatDeleteRow = function (key, i) {
    var mx = window.PRODUCT_CAM_MATRICES[key];
    if (!mx) return;
    if (mx.length <= 1) { _toast('At least one band required','warn'); return; }
    if (!confirm('Delete this income band?')) return;
    mx.splice(i, 1);
    if (_editingRow[key] === i) _editingRow[key] = -1;
    else if (_editingRow[key] > i) _editingRow[key]--;
    ppRenderProductMatrix(key);
    _toast('Band removed','warn');
  };
  window.ppPmatAddRow = function (key) {
    var g = function(f){ var el=document.getElementById('pmn-'+key+'-'+f); return el?el.value:''; };
    var mx = window.PRODUCT_CAM_MATRICES[key];
    if (!mx) return;
    var sMin=parseFloat(g('salMin'))||0, sMax=parseFloat(g('salMax'))||0;
    var rMin=parseFloat(g('rateMin'))||0, rMax=parseFloat(g('rateMax'))||0;
    var tMin=parseInt(g('tenMin'),10)||0, tMax=parseInt(g('tenMax'),10)||0;
    var foir=parseFloat(g('foir'))||0;
    var lbl=(g('label')||'').trim() || (_fmtK(sMin)+' to '+_fmtK(sMax));
    if (!sMin||!sMax||!rMin||!rMax||!tMin||!tMax||!foir){ _toast('⚠ Fill all fields','warn'); return; }
    mx.push({label:lbl,salaryMin:sMin,salaryMax:sMax,rateMin:rMin,rateMax:rMax,tenureMin:tMin,tenureMax:tMax,foir:foir/100});
    ppRenderProductMatrix(key);
    _toast('✓ Band added');
  };
  window.ppPmatSaveMatrix = function (key) {
    _persist();
    var msg = document.getElementById('pp-pmat-saved-'+key);
    if (msg){ msg.style.display='inline'; setTimeout(function(){ msg.style.display='none'; },2500); }
    _toast('✓ Matrix saved');
  };
  window.ppPmatResetMatrix = function (key) {
    var nm=''; for(var z=0;z<PP_PRODUCTS.length;z++){if(PP_PRODUCTS[z].key===key){nm=PP_PRODUCTS[z].name;break;}}
    if (!confirm('Reset "' + (nm||key) + '" to defaults?')) return;
    window.PRODUCT_CAM_MATRICES[key] = (PP_DEFAULTS[key]||[]).map(function(r){return Object.assign({},r);});
    _editingRow[key] = -1;
    _persist();
    ppRenderProductMatrix(key);
    _toast('↺ Reset to defaults','info');
  };
  window.getProductCamMatrix = function (key) {
    _initStore();
    return window.PRODUCT_CAM_MATRICES[key] || [];
  };

  // ── MutationObserver: watch #page-policy-product 'active' class ───────
  //    Works regardless of how many showPage wrappers exist.
  function _startObserver() {
    var page = document.getElementById('page-policy-product');
    if (!page) { setTimeout(_startObserver, 600); return; }
    var wasActive = page.classList.contains('active');
    if (wasActive) window.ppRenderProductMatrixCards();
    new MutationObserver(function () {
      var isActive = page.classList.contains('active');
      if (isActive && !wasActive) { wasActive = true;  window.ppRenderProductMatrixCards(); }
      if (!isActive)              { wasActive = false; }
    }).observe(page, { attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _startObserver);
  } else {
    _startObserver();
  }

})();
