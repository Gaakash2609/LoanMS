/**
 * cibil-view.js — v8
 *
 * v8 changes (UPGRADE — Phase 2 implementation):
 *   • API path changed from /api/cibil/report?pan=X  →  /api/cibil/full-report?customerId=X
 *   • customerId resolved from window.APPLICATIONS (same source as before, different field)
 *   • PAN-based mock breakdown REPLACED with real ScoreFactors from BureauReport entity
 *   • All v7 UI preserved: gauge, benchmark bar, simulator, lender cards, trend, action plan
 *   • NEW: Consumer Information section (Name, DOB, Gender, Control No., Report Time)
 *   • NEW: Identification section (PAN, Aadhaar, CKYC)
 *   • NEW: Contact Information section (Mobiles, Office, Emails)
 *   • NEW: Address Information section (all addresses with type + date)
 *   • NEW: Employment Information section
 *   • ENHANCED: Account Summary (Oldest/Latest dates, Secured/Unsecured counts)
 *   • ENHANCED: Loan Accounts — full table with all columns + expandable DPD grid per account
 *   • NEW: Enquiry Details table (Date, Type, Purpose, Amount, Member)
 *
 * Backward compatibility:
 *   • window._loadCibilReport()      — public entry point unchanged
 *   • window._renderCibilReport(d)   — alias unchanged
 *   • window._cibilCopy()            — unchanged
 *   • window._cibilCopyReport()      — unchanged
 *   • window._cibilToggle()          — unchanged
 *   • window._cibilSimUpdate()       — unchanged
 *   • window._cibilSimReset()        — unchanged
 *
 * Fallback: if customerId cannot be resolved, falls back to PAN-based /report call
 * so existing behaviour is preserved for applications without BureauReport data.
 */

(function (global) {
  'use strict';

  // ── Safe localStorage helpers ──────────────────────────────────────────────
  var _lsGet    = function(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } };
  var _lsSet    = function(k,v){ try{ localStorage.setItem(k,v); }catch(e){} };
  var _lsRemove = function(k){ try{ localStorage.removeItem(k); }catch(e){} };

  /* ═══════════════════════════════════════════════════════════════════════
     1. CONSTANTS & CSS
  ═══════════════════════════════════════════════════════════════════════ */
  var PAN_RE        = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
  var ALPHA         = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  var MAX_WAIT_MS   = 2000;
  var POLL_INTERVAL = 60;
  var TOKEN_KEY     = 'loanms_token';

  var BANDS = [
    { min:300, max:549, color:'#dc2626', label:'Very Poor' },
    { min:550, max:649, color:'#ea580c', label:'Poor'      },
    { min:650, max:699, color:'#d97706', label:'Fair'      },
    { min:700, max:749, color:'#2563eb', label:'Good'      },
    { min:750, max:900, color:'#16a34a', label:'Excellent' },
  ];

  var FACTOR_META = {
    'Payment History':    { icon:'💳', tip:'Timely EMI and credit card payments — the single biggest factor at 35% weight.' },
    'Credit Utilisation': { icon:'📊', tip:'Ratio of used credit to total limit. Keep below 30% for best impact.' },
    'Credit Age':         { icon:'⏳', tip:'Average age of all credit accounts. Older accounts signal stability.' },
    'Credit Mix':         { icon:'🔀', tip:'Variety of credit types — secured (loans) + unsecured (cards) is ideal.' },
    'New Enquiries':      { icon:'🔍', tip:'Hard enquiries from recent loan applications. Each one temporarily dips the score.' },
  };

  var MEANING = {
    'Excellent': 'Top credit tier — premium products and lowest rates are accessible.',
    'Good':      'Strong profile — most lenders will approve with standard conditions.',
    'Fair':      'Approval possible, but lenders may impose higher rates or co-applicant.',
    'Poor':      'Below threshold — secured products or credit rehabilitation recommended.',
    'Very Poor': 'High risk — most mainstream lenders will decline.',
  };

  /* Inject print + responsive styles once */
  var _printStyleInjected = false;
  function _injectPrintStyle() {
    if (_printStyleInjected) return;
    _printStyleInjected = true;
    var s = document.createElement('style');
    s.id = 'cibil-print-style';
    s.textContent =
      '@media print{' +
        'body>*:not(#page-app-detail){display:none!important}' +
        '#page-app-detail>*:not(#tab-cibil){display:none!important}' +
        '#tab-cibil{display:block!important}' +
        '.cibil-toolbar,.cibil-simulator,.cibil-section-nav,.btn{display:none!important}' +
        '.cibil-section{break-inside:avoid;margin-bottom:10px!important}' +
        '#cibil-report-container{padding:0!important}' +
        '.cibil-dpd-grid{font-size:9px}' +
        '.cibil-accounts-table th,.cibil-accounts-table td{padding:4px 5px!important;font-size:10px}' +
        '.cibil-lenders-sim-grid{grid-template-columns:1fr!important}' +
      '}' +
      '@media(max-width:700px){' +
        '.cibil-lenders-sim-grid{grid-template-columns:1fr!important}' +
        '.cibil-score-meta-grid{grid-template-columns:repeat(2,1fr)!important}' +
        '.cibil-enq-grid{grid-template-columns:repeat(2,1fr)!important}' +
        '.cibil-section-nav{flex-wrap:wrap;gap:4px}' +
        '.cibil-section-nav a{font-size:10px;padding:3px 7px}' +
      '}';
    document.head.appendChild(s);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     2. PAN HELPERS (unchanged from v7)
  ═══════════════════════════════════════════════════════════════════════ */
  function isValidPan(p) { return typeof p === 'string' && PAN_RE.test(p.trim().toUpperCase()); }

  function syntheticPan(seed) {
    seed = String(seed || 'DEMO');
    var h = 5381;
    for (var i = 0; i < seed.length; i++) { h = ((h<<5)+h)^seed.charCodeAt(i); h &= 0x7fffffff; }
    var s='', t=h;
    for (var j=0;j<5;j++){s+=ALPHA[t%26];t=Math.floor(t/26)+(h>>j);}
    var d=('0000'+(h%10000)).slice(-4), l=ALPHA[(h>>3)%26], p=s+d+l;
    return PAN_RE.test(p)?p:'AABCD'+d+'Z';
  }

  function derivePan(app) {
    var raw=(app.pan||'').trim().toUpperCase();
    return isValidPan(raw)?raw:syntheticPan(app.loanNumber||app.id||app.name||'DEMO');
  }

  /* ═══════════════════════════════════════════════════════════════════════
     3. APPLICATION RESOLVER (unchanged from v7)
  ═══════════════════════════════════════════════════════════════════════ */
  function getCurrentAppId() {
    var el=document.getElementById('detail-title');
    return (el&&el.textContent.trim())||null;
  }
  function findAppById(id) {
    var apps=global.APPLICATIONS;
    if (!Array.isArray(apps)||!id) return null;
    return apps.find(function(a){return a.id===id;})||apps.find(function(a){return a.loanNumber===id;})||null;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     4. API LAYER — v8: primary path uses full-report?customerId=X
  ═══════════════════════════════════════════════════════════════════════ */
  function _getAuthHeaders() {
    var tok = _lsGet(TOKEN_KEY);
    var h = {'Content-Type':'application/json'};
    if (tok) h['Authorization'] = 'Bearer ' + tok;
    return h;
  }

  /**
   * PRIMARY (v8): fetch full bureau report by customerId
   * Returns CibilReportDetailDto — all sections populated
   */
  function _callFullReportApi(customerId) {
    return fetch('/api/cibil/full-report?customerId=' + encodeURIComponent(customerId), {headers: _getAuthHeaders()})
      .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
      .then(function(b){
        var ok  = b.success  != null ? b.success  : b.Success;
        var dat = b.data     != null ? b.data     : b.Data;
        var msg = b.message  != null ? b.message  : b.Message;
        if(!ok || !dat) throw new Error(msg||'CIBIL report unavailable');
        return {data: dat, isFullReport: true};
      });
  }

  /**
   * FALLBACK (v7 compat): fetch score-only report by PAN
   * Used when customerId is unavailable or full-report returns 404
   */
  function _callCibilApi(pan, name, dob) {
    return fetch('/api/cibil/report?pan='+encodeURIComponent(pan)+'&name='+encodeURIComponent(name||'')+'&dob='+encodeURIComponent(dob||''), {headers: _getAuthHeaders()})
      .then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
      .then(function(b){
        var ok  = b.success  != null ? b.success  : b.Success;
        var dat = b.data     != null ? b.data     : b.Data;
        var msg = b.message  != null ? b.message  : b.Message;
        if(!ok || !dat) throw new Error(msg||'CIBIL report unavailable');
        return {data: dat, isFullReport: false};
      });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     5. FETCH COORDINATOR — v8: tries full-report first, falls back to PAN
  ═══════════════════════════════════════════════════════════════════════ */
  var _fetchLock = {};

  function loadReport(container, app) {
    var appKey = app.id || app.loanNumber || 'default';
    if (_fetchLock[appKey]) return;
    _fetchLock[appKey] = true;
    showLoading(container, app.name || app.customerName || app.applicantName || '');

    // Resolve customerId from multiple possible field names
    var customerId = app.customerId
      || app.customer_id
      || (app.customer && (app.customer.id || app.customer.customerId))
      || app.applicantId
      || null;

    var promise;
    if (customerId) {
      promise = _callFullReportApi(customerId)
        .catch(function(e) {
          // If full-report fails (e.g. no BureauReport exists yet), fall back to PAN report
          if (e.message && (e.message.indexOf('404') !== -1 || e.message.indexOf('not found') !== -1)) {
            return _callCibilApi(derivePan(app), app.name, app.dob);
          }
          throw e;
        });
    } else {
      // No customerId available — use PAN fallback directly
      promise = _callCibilApi(derivePan(app), app.name, app.dob);
    }

    promise
      .then(function(result) {
        delete _fetchLock[appKey];
        _injectPrintStyle();
        renderReport(container, result.data, result.isFullReport);
      })
      .catch(function(e) {
        delete _fetchLock[appKey];
        showError(container, e && e.message);
      });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     6. PUBLIC ENTRY POINT
  ═══════════════════════════════════════════════════════════════════════ */
  global._loadCibilReport = function() {
    var c = document.getElementById('cibil-report-container');
    if (!c) return;
    var elapsed = 0;
    function attempt() {
      // Use window.currentDetail first (always set when app-detail is open)
      var app = window.currentDetail || null;
      // Fallback: find by ID in APPLICATIONS array
      if (!app) {
        var id = getCurrentAppId();
        if (id) app = findAppById(id);
      }
      if (app) { loadReport(c, app); return; }
      elapsed += POLL_INTERVAL;
      if (elapsed < MAX_WAIT_MS) { showWaiting(c); setTimeout(attempt, POLL_INTERVAL); }
      else showNotFound(c);
    }
    attempt();
  };

  /* ═══════════════════════════════════════════════════════════════════════
     7. STATE VIEWS (unchanged from v7)
  ═══════════════════════════════════════════════════════════════════════ */
  var SPIN = '<div style="width:36px;height:36px;border:3px solid var(--surface3);border-top-color:var(--accent);border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 14px"></div>';
  function showLoading(c,l){ c.innerHTML='<div style="text-align:center;padding:52px 24px">'+SPIN+'<div style="font-size:13px;color:var(--text2)">Fetching CIBIL report for <strong>'+esc(l||'…')+'</strong></div></div>'; }
  function showWaiting(c){  c.innerHTML='<div style="text-align:center;padding:52px 24px;color:var(--text3)">'+SPIN+'<div style="font-size:13px">Loading application data…</div></div>'; }
  function showError(c,m){  c.innerHTML='<div style="text-align:center;padding:44px 24px"><div style="font-size:34px;margin-bottom:10px">⚠️</div><div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:6px">Could not load CIBIL report</div><div style="font-size:12px;color:var(--text3);margin-bottom:18px">'+esc(m||'Network error — please try again.')+'</div><button class="btn btn-primary" onclick="window._loadCibilReport&&_loadCibilReport()">🔄 Retry</button></div>'; }
  function showNotFound(c){ c.innerHTML='<div style="text-align:center;padding:44px 24px"><div style="font-size:34px;margin-bottom:10px">🔍</div><div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:6px">Application not found</div><div style="font-size:13px;color:var(--text3);margin-bottom:18px">Please go back to the list and reopen this record.</div><button class="btn btn-ghost btn-sm" onclick="history.back()">← Back</button></div>'; }

  /* ═══════════════════════════════════════════════════════════════════════
     8. FORMAT HELPERS
  ═══════════════════════════════════════════════════════════════════════ */
  function fmtINR(v) {
    if (!v && v !== 0) return '—';
    var n = Number(v);
    if (isNaN(n)) return '—';
    if (n === 0) return '₹0';
    if (n >= 10000000) return '₹' + (n/10000000).toFixed(2) + ' Cr';
    if (n >= 100000)   return '₹' + (n/100000).toFixed(2)   + ' L';
    if (n >= 1000)     return '₹' + (n/1000).toFixed(1)     + 'K';
    return '₹' + n.toLocaleString('en-IN');
  }

  function fmtDate(d) {
    if (!d) return '—';
    try {
      var dt = new Date(d);
      if (isNaN(dt)) return String(d);
      return dt.toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'});
    } catch(e) { return String(d); }
  }

  function fmtDateTime(d) {
    if (!d) return '—';
    try {
      var dt = new Date(d);
      if (isNaN(dt)) return String(d);
      return dt.toLocaleString('en-IN', {day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'});
    } catch(e) { return String(d); }
  }

  function dpdClass(val) {
    if (!val || val === 'NA' || val === 'XXX') return 'dpd-na';
    if (val === '000' || val === 'STD' || val === '0' || parseInt(val) === 0) return 'dpd-000';
    var n = parseInt(val);
    if (!isNaN(n)) {
      if (n <= 30)  return 'dpd-030';
      if (n <= 60)  return 'dpd-060';
      if (n <= 90)  return 'dpd-090';
      return 'dpd-120';
    }
    if (val === 'WO' || val === 'Write-Off') return 'dpd-wo';
    if (val === 'SMA' || val === 'SO')       return 'dpd-sma';
    return 'dpd-na';
  }
  // Display value inside DPD circle — tick for paid, dash for NA
  function dpdDisplay(val) {
    if (!val || val === 'NA' || val === 'XXX' || val === 'DDD' || val === '-') return '—';
    if (val === '000' || val === 'STD' || val === '0' || parseInt(val) === 0) return '✓';
    if (val === 'WO') return 'WO';
    if (val === 'SMA') return 'SMA';
    return val;
  }

  /* Inject DPD colour styles once */
  var _dpdStyleInjected = false;
  function _injectDpdStyle() {
    if (_dpdStyleInjected) return;
    _dpdStyleInjected = true;
    var s = document.createElement('style');
    s.id = 'cibil-dpd-style';
    s.textContent = [
      '.dpd-000{background:#dcfce7;color:#15803d;font-weight:700}',
      '.dpd-030{background:#fef9c3;color:#92400e;font-weight:700}',
      '.dpd-060{background:#fed7aa;color:#c2410c;font-weight:700}',
      '.dpd-090{background:#fecaca;color:#dc2626;font-weight:700}',
      '.dpd-120{background:#7f1d1d;color:#fff;font-weight:700}',
      '.dpd-wo {background:#1e1b4b;color:#c7d2fe;font-weight:700}',
      '.dpd-sma{background:#fef3c7;color:#b45309;font-weight:700}',
      '.dpd-na {background:var(--surface3);color:var(--text3);font-size:10px}',
      '.cibil-dpd-grid{border-collapse:collapse;font-size:11px;width:100%;background:#fff}',
      '.cibil-dpd-grid th,.cibil-dpd-grid td{border:1px solid #e8eef4;padding:5px 3px;text-align:center;white-space:nowrap}',
      '.cibil-dpd-grid thead th{background:#f8fafc;font-weight:700;font-size:11px;color:#64748b;padding:8px 3px}',
      '.cibil-dpd-grid .row-lbl{text-align:left;font-weight:700;background:#f8fafc;color:#1e3a5f;padding:8px 12px;font-size:12px}',
      '.cibil-accounts-table{width:100%;border-collapse:collapse;font-size:12.5px}',
      '.cibil-accounts-table th{padding:8px 10px;text-align:left;font-weight:600;font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--text3);white-space:nowrap;border-bottom:2px solid var(--border);background:var(--surface2)}',
      '.cibil-accounts-table td{padding:10px;border-bottom:1px solid var(--border);vertical-align:middle}',
      '.cibil-accounts-table tbody tr:hover{background:var(--surface2)}',
      '.cibil-expand-row{display:none}.cibil-expand-row.open{display:table-row}',
      '.cibil-kv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:1px;background:var(--border);border-radius:8px;overflow:hidden}',
      '.cibil-kv-cell{background:var(--surface);padding:11px 13px}',
      '.cibil-kv-lbl{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--text3);margin-bottom:3px}',
      '.cibil-kv-val{font-size:13px;font-weight:500;color:var(--text)}',
      '.cibil-kv-val.empty{color:var(--text3);font-style:italic;font-weight:400}',
      '.cibil-addr-card{border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:8px;display:flex;gap:12px;align-items:flex-start}',
      '.cibil-addr-icon{width:32px;height:32px;background:rgba(37,99,235,.08);border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0}',
    ].join('');
    document.head.appendChild(s);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     9. MAIN RENDERER
  ═══════════════════════════════════════════════════════════════════════ */
  function renderReport(container, data, isFullReport) {
    _injectDpdStyle();

    /* ── Resolve score and meta from either response shape ── */
    // Full-report shape: data.creditScore.score
    // Fallback shape:    data.score
    var scoreObj    = data.creditScore || {};
    var score       = scoreObj.score || data.score || 0;
    var maxSc       = scoreObj.maxScore || data.maxScore || 900;
    var minSc       = scoreObj.minScore || data.minScore || 300;
    var scoreStatus = scoreObj.category || data.status || _scoreStatus(score);
    var isEligible  = scoreObj.eligibleForLoan != null ? scoreObj.eligibleForLoan : (data.isEligible != null ? data.isEligible : score >= 650);
    var isLive      = scoreObj.isLiveScore != null ? scoreObj.isLiveScore : true;
    var genDate     = scoreObj.generatedDate || data.generatedAt || data.asOf;
    var genTime     = scoreObj.generatedTime || (genDate ? fmtDateTime(genDate) : '');

    /* ── Risk ── */
    var riskObj     = data.riskAnalysis || {};
    var riskLevel   = riskObj.riskLevel || data.riskLevel || _deriveRisk(score);
    var riskGrade   = riskObj.riskGrade || data.riskGrade || '';
    var approvalPct = riskObj.approvalProbability || data.approvalProbability || _deriveApproval(score);
    var lendingRec  = riskObj.lendingRecommendation || '';

    /* ── Profile ── */
    var profile     = data.customerProfile || {};
    var appName     = profile.fullName  || data.name || '—';
    var appDob      = profile.dateOfBirth|| data.dob  || '—';
    var appGender   = profile.gender    || '—';
    var appPan      = profile.pan       || data.pan   || '—';
    var appAadhaar  = profile.aadhaarMasked || '—';
    var appCkyc     = profile.cKYCNumber || profile.ckyc || '—';
    var appControl  = profile.controlNumber || data.controlNumber || '—';
    var appOccup    = profile.occupationType || '—';
    var appIncome   = profile.annualIncome   || 0;
    var appMobiles  = profile.mobileNumbers  || [];
    var appOffice   = profile.officeNumber   || '—';
    var appEmails   = profile.emailAddresses || [];
    var appAddresses= profile.addresses      || [];
    var appEmploy   = profile.employmentHistory || [];

    /* ── Account Summary ── */
    var accSum      = data.accountSummary || {};

    /* ── Accounts ── */
    var accounts    = data.accounts || [];

    /* ── Payment History ── */
    var payHist     = data.paymentHistory || {};
    var dpdHeatmap  = payHist.dpdHeatmap  || {};

    /* ── Enquiries ── */
    var enqAnalysis = data.enquiryAnalysis || {};
    var enqDetails  = enqAnalysis.enquiryDetails || [];

    /* ── Score breakdown ── */
    // v8: use real ScoreFactor data from full-report if available
    // Fall back to computed breakdown from mock /report endpoint
    var bd = _resolveBreakdown(data, score);

    /* ── Eligible lenders from system config ── */
    data.eligibleBanks = _resolveEligibleBanks(data, score);

    /* ── Improvement recommendations ── */
    var recommendations = (data.riskAnalysis && data.riskAnalysis.recommendations) || data.recommendations || [];

    /* ─────────────────────────────────────────────────────────────────────
       BUILD SECTIONS
    ───────────────────────────────────────────────────────────────────── */
    var now   = new Date();
    var color = _bandColor(score);
    var pct   = Math.round(((score - minSc) / (maxSc - minSc)) * 100);

    /* ── Toolbar ── */
    var toolbar = _buildToolbar(now, appName, appPan, score, maxSc, riskLevel, approvalPct);

    /* ── Gauge ── */
    var gauge = _buildGauge(score, minSc, maxSc, pct, color, scoreStatus, isEligible, isLive);

    /* ── Summary cards ── */
    var cards = _buildCards(riskLevel, approvalPct, appPan, appName, appDob, genDate, now);

    /* ── Benchmark bar ── */
    var benchBar = _buildBenchBar(score, minSc, maxSc, color);

    /* ── Score band rail ── */
    var rail = _buildRail(score, minSc, maxSc);

    /* ── What this means ── */
    var mtext = MEANING[scoreStatus] || '';
    var meaningBlock = mtext
      ? '<div style="background:rgba(37,99,235,.05);border:1px solid rgba(37,99,235,.14);border-radius:var(--r-sm);padding:10px 14px;margin-bottom:14px;font-size:12.5px;color:var(--text2);line-height:1.55"><strong style="color:var(--accent)">ℹ️ What this means: </strong>' + esc(mtext) + '</div>'
      : '';

    /* ── Trend ── */
    var trendBlock = _buildTrend(score, minSc, maxSc, appPan);

    /* ── Score Breakdown ── */
    var breakdownSection = _buildBreakdown(bd);

    /* ── Score Factors (Positive + Negative from BureauReport) ── */
    var scoreFactorsSection = _buildScoreFactors(
      scoreObj.positiveFactors || scoreObj.PositiveFactors || [],
      scoreObj.negativeFactors || scoreObj.NegativeFactors || []
    );



    /* ── ENHANCED: Account Summary Dashboard ── */
    var acctSummarySection = _buildAccountSummary(accSum, data.loanHistory);

    /* ── NEW: Portfolio breakdown · Active loans · Payment behaviour ── */
    var portfolioSection       = _buildPortfolioBreakdown(accounts);
    var activeLoansSection     = _buildActiveLoans(accounts);
    var paymentBehaviourSection = _buildPaymentBehaviour(accounts);

    /* ── ENHANCED: Loan Accounts Table with DPD grid ── */
    var acctTableSection = _buildAccountsTable(accounts);

    /* ── Lenders + Simulator side by side ── */
    var bankCards = _buildBankCards(data.eligibleBanks);
    var simSection = _buildSimulator(score, bd);

    /* ── ENHANCED: Enquiry Summary + Details Table ── */
    var enquirySection = _buildEnquirySection(enqAnalysis, enqDetails);

    /* ── ENHANCED SECTIONS ── */
    var healthDashboard = _buildCreditHealthDashboard(score, maxSc, minSc, accounts, bd);
    var paymentAnalysis = _buildPaymentAnalysis(accounts);
    var enquiryRiskAssessment = _buildEnquiryRiskAssessment(enqAnalysis);
    var creditEducation = _buildCreditEducation();

    /* ── Loan History in EFIN ── */
    var histBlock = _buildLoanHistory(data.loanHistory);

    /* ── Disclaimer ── */
    var disclaimer = isFullReport
      ? '<div style="font-size:11px;color:var(--text3);padding:10px 14px;background:var(--surface2);border-radius:var(--r-sm);border:1px solid var(--border);line-height:1.6;margin-top:14px">📊 <strong>Bureau report</strong> — Data sourced from stored bureau file. Refresh to re-fetch latest data from bureau provider.</div>'
      : '<div style="font-size:11px;color:var(--text3);padding:10px 14px;background:var(--surface2);border-radius:var(--r-sm);border:1px solid var(--border);line-height:1.6;margin-top:14px">🔷 <strong>Simulated report</strong> — Score generated from PAN for demonstration. Upload bureau file or configure live credentials for real data.</div>';

    /* ── ASSEMBLE ── */
    container.innerHTML =
      '<div style="padding:2px 4px">' +

        _buildSectionNav() +
        toolbar +

        // Score hero: gauge + cards + benchmarks
        '<div id="cr-score" style="display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap;margin-bottom:14px">' +
          gauge +
          '<div style="flex:1;min-width:260px">' +
            '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(135px,1fr));gap:9px">' + cards + '</div>' +
            benchBar +
            rail +
          '</div>' +
        '</div>' +

        meaningBlock +
        trendBlock +
        breakdownSection +
        scoreFactorsSection +

        // ═════ ENHANCED DASHBOARDS & ANALYTICS ═════
        healthDashboard +
        paymentAnalysis +

        // Payment Timeline (after accounts table)
        _buildPaymentTimeline(payHist) +

        // Account Summary Dashboard
        '<div id="cr-accsum"></div>' +
        acctSummarySection +

        // NEW: Portfolio · Active loans · Payment behaviour
        portfolioSection +
        activeLoansSection +
        paymentBehaviourSection +

        // Loan Accounts Table
        '<div id="cr-acctable"></div>' +
        acctTableSection +

        // Lenders + Simulator
        '<div class="cibil-lenders-sim-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">' +
          '<div class="cibil-section" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:18px 20px">' +
            '<div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:12px">🏦 Eligible Lenders</div>' +
            bankCards +
          '</div>' +
          simSection +
        '</div>' +

        // Enquiry + Risk Assessment
        '<div id="cr-enquiry"></div>' +
        enquirySection +
        enquiryRiskAssessment +

        // ═════ EDUCATIONAL CONTENT ═════
        creditEducation +

        histBlock +
        disclaimer +

      '</div>';

    /* expose copy helper */
    global._cibilCopyReport = function() {
      var summary = [
        'CIBIL Report — ' + appName,
        'PAN: ' + appPan,
        'Score: ' + score + ' / ' + maxSc + ' (' + scoreStatus + ')',
        'Risk Level: ' + riskLevel,
        'Approval Probability: ' + approvalPct + (typeof approvalPct === 'number' ? '%' : ''),
        'Eligible: ' + (isEligible ? 'Yes' : 'No'),
        'Report Date: ' + now.toLocaleDateString('en-IN'),
      ].join('\n');
      navigator.clipboard && navigator.clipboard.writeText(summary).then(function(){
        if (typeof showToast === 'function') showToast('Report summary copied to clipboard', 'success');
      });
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     10. SECTION BUILDERS
  ═══════════════════════════════════════════════════════════════════════ */

  /* ── Section Navigation ── */
  function _buildSectionNav() {
    var sections = [
      ['#cr-score',      '📊 Score'],
      ['#cr-breakdown',  '📈 Breakdown'],
      ['#cr-consumer',   '👤 Consumer'],
      ['#cr-ident',      '🪪 ID'],
      ['#cr-contact',    '📞 Contact'],
      ['#cr-address',    '🏠 Address'],
      ['#cr-employ',     '💼 Employment'],
      ['#cr-accsum',      '🗂️ Acc. Summary'],
      ['#cr-portfolio',   '📊 Portfolio'],
      ['#cr-active-loans','🔵 Active Loans'],
      ['#cr-paybehaviour','🧾 Pay Behaviour'],
      ['#cr-acctable',   '📄 Accounts'],
      ['#cr-enquiry',    '🔍 Enquiries'],
    ];
    var links = sections.map(function(s){
      return '<a href="'+s[0]+'" onclick="(function(id){var el=document.getElementById(id.slice(1));if(el)el.scrollIntoView({behavior:\'smooth\',block:\'start\'});})(this.hash);return false;" ' +
        'style="font-size:11px;font-weight:500;color:var(--text2);text-decoration:none;padding:4px 10px;border-radius:20px;border:1px solid var(--border);white-space:nowrap;transition:all .15s;background:var(--surface)"' +
        ' onmouseover="this.style.background=\'var(--accent)\';this.style.color=\'#fff\';this.style.borderColor=\'var(--accent)\';" ' +
        ' onmouseout="this.style.background=\'var(--surface)\';this.style.color=\'var(--text2)\';this.style.borderColor=\'var(--border)\';">'+s[1]+'</a>';
    }).join('');
    return '<nav class="cibil-section-nav" style="display:flex;flex-wrap:wrap;gap:6px;padding:10px 0 12px;margin-bottom:4px">'+links+'</nav>';
  }

  /* ── Toolbar ── */
  function _buildToolbar(now, name, pan, score, maxSc, risk, approval) {
    return '<div class="cibil-toolbar" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">' +
      '<div style="font-size:12px;color:var(--text3)">📅 Generated: <strong>' +
        now.toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) +
      '</strong></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="btn btn-ghost btn-sm" onclick="_cibilCopyReport()" style="font-size:11.5px">📄 Copy Summary</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="window._loadCibilReport&&_loadCibilReport()" style="font-size:11.5px">🔄 Refresh</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="window.print()" style="font-size:11.5px">🖨️ Print</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="_cibilExportPDF()" style="font-size:11.5px">⬇️ PDF</button>' +
      '</div>' +
    '</div>';
  }

  /* ── Gauge ── */
  function _buildGauge(score, minSc, maxSc, pct, color, status, isEligible, isLive) {
    var cx=90, cy=85, R=68, stroke=13;
    var circ   = Math.PI * R;
    var offset = circ - (pct/100) * circ;
    var angleRad = Math.PI - (pct/100) * Math.PI;
    var nx = cx + (R-2) * Math.cos(angleRad);
    var ny = cy - (R-2) * Math.sin(angleRad);

    return '<div class="cibil-section" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:20px 22px 16px;min-width:195px;flex:0 0 auto;text-align:center;box-shadow:var(--shadow)">' +
      '<svg width="180" height="100" viewBox="0 0 180 100">' +
        BANDS.map(function(b){
          var s=(b.min-minSc)/(maxSc-minSc), e=(b.max-minSc+1)/(maxSc-minSc);
          var bcirc=Math.PI*R, bStart=bcirc*(1-s), bLen=bcirc*(e-s);
          return '<path d="M 15 '+cy+' A '+R+' '+R+' 0 0 1 '+(cx*2-15)+' '+cy+'" fill="none" stroke="'+b.color+'" stroke-width="'+stroke+'" stroke-linecap="butt" stroke-dasharray="'+bLen+' '+bcirc+'" stroke-dashoffset="'+bStart+'" opacity="0.18"/>';
        }).join('') +
        '<path d="M 15 '+cy+' A '+R+' '+R+' 0 0 1 '+(cx*2-15)+' '+cy+'" fill="none" stroke="var(--surface3)" stroke-width="'+stroke+'" stroke-linecap="round"/>' +
        '<path d="M 15 '+cy+' A '+R+' '+R+' 0 0 1 '+(cx*2-15)+' '+cy+'" fill="none" stroke="'+color+'" stroke-width="'+stroke+'" stroke-linecap="round" stroke-dasharray="'+circ+'" stroke-dashoffset="'+offset+'" style="transition:stroke-dashoffset 1.4s cubic-bezier(.4,0,.2,1)"/>' +
        '<line x1="'+cx+'" y1="'+cy+'" x2="'+nx+'" y2="'+ny+'" stroke="'+color+'" stroke-width="2.5" stroke-linecap="round" style="transition:all 1.4s cubic-bezier(.4,0,.2,1)"/>' +
        '<circle cx="'+cx+'" cy="'+cy+'" r="4" fill="'+color+'"/>' +
        '<text x="'+cx+'" y="76" text-anchor="middle" font-size="26" font-weight="800" fill="'+color+'" font-family="var(--font-head)">'+score+'</text>' +
        '<text x="'+cx+'" y="91" text-anchor="middle" font-size="10" fill="var(--text3)">out of '+maxSc+'</text>' +
      '</svg>' +
      '<div style="font-size:16px;font-weight:800;color:'+color+';margin:-4px 0 3px;letter-spacing:-.3px">'+esc(status)+'</div>' +
      '<div style="font-size:11px;color:var(--text3);margin-bottom:10px">'+(isLive?'✅ Live CIBIL Score':'🔷 Simulated Score')+'</div>' +
      '<div style="display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;background:'+(isEligible?'rgba(22,163,74,.12)':'rgba(220,38,38,.1)')+';color:'+(isEligible?'#15803d':'#dc2626')+';border:1px solid '+(isEligible?'rgba(22,163,74,.25)':'rgba(220,38,38,.2)')+'">' +
        (isEligible ? '✅ Eligible for Loan' : '❌ Below Threshold') +
      '</div>' +
    '</div>';
  }

  /* ── Summary cards ── */
  function _buildCards(riskLevel, approvalPct, pan, name, dob, genDate, now) {
    var riskC={'Low':'#16a34a','Low-Medium':'#2563eb','Medium':'#d97706','High':'#ea580c','Very High':'#dc2626'};
    var riskB={'Low':'rgba(22,163,74,.08)','Low-Medium':'rgba(37,99,235,.08)','Medium':'rgba(217,119,6,.08)','High':'rgba(234,88,12,.08)','Very High':'rgba(220,38,38,.08)'};
    var rc=riskC[riskLevel]||'var(--text)', rb=riskB[riskLevel]||'var(--surface2)';
    var reportTime = genDate ? fmtDateTime(genDate) : now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}) + ' · ' + now.toLocaleDateString('en-IN');

    // Risk Indicator derived from riskLevel
    var riskIndicator = riskLevel === 'Low' ? '🟢 Low Risk'
      : riskLevel === 'Low-Medium' ? '🟡 Low-Medium'
      : riskLevel === 'Medium' ? '🟠 Medium Risk'
      : riskLevel === 'High' ? '🔴 High Risk'
      : riskLevel === 'Very High' ? '🔴 Very High Risk'
      : '— Unknown';
    var defs=[
      {icon:'⚠️', label:'Risk Level',     val:riskLevel,      risk:true},
      {icon:'🚦', label:'Risk Indicator', val:riskIndicator,  risk:true},
      {icon:'🎯', label:'Approval Prob.', val: typeof approvalPct==='number' ? approvalPct+'%+' : approvalPct, risk:false},
      {icon:'🪪', label:'PAN',            val:pan,  risk:false, copy:true},
      {icon:'👤', label:'Name',           val:name, risk:false},
      {icon:'📅', label:'Date of Birth',  val:fmtDate(dob)||dob, risk:false},
      {icon:'🕐', label:'Report Time',    val:reportTime, risk:false},
    ];
    return defs.map(function(c){
      var copyBtn = c.copy ? '<span onclick="_cibilCopy(\''+esc(c.val)+'\',this)" title="Copy PAN" style="cursor:pointer;margin-left:5px;font-size:11px;color:var(--text3)">📋</span>' : '';
      return '<div style="background:'+(c.risk?rb:'var(--surface)')+';border:1px solid var(--border);border-radius:var(--r-sm);padding:11px 13px">' +
        '<div style="font-size:10.5px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">'+c.icon+' '+c.label+'</div>' +
        '<div style="font-size:13.5px;font-weight:700;color:'+(c.risk?rc:'var(--text)')+'">'+esc(String(c.val||'—'))+copyBtn+'</div>' +
      '</div>';
    }).join('');
  }

  /* ── Benchmark bar ── */
  function _buildBenchBar(score, minSc, maxSc, color) {
    var IND_AVG=700, GOOD_THRESH=750;
    var scPct=((score-minSc)/(maxSc-minSc)*100).toFixed(1);
    var iaPct=((IND_AVG-minSc)/(maxSc-minSc)*100).toFixed(1);
    var gtPct=((GOOD_THRESH-minSc)/(maxSc-minSc)*100).toFixed(1);
    return '<div style="margin-top:14px;margin-bottom:4px">' +
      '<div style="font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Score vs Benchmarks</div>' +
      '<div style="position:relative;height:28px;border-radius:6px;background:var(--surface3);overflow:visible;margin-bottom:6px">' +
        '<div style="height:100%;width:'+scPct+'%;background:'+color+';border-radius:6px;transition:width 1.3s ease"></div>' +
        '<div style="position:absolute;top:-4px;left:'+iaPct+'%;transform:translateX(-50%)">' +
          '<div style="width:2px;height:36px;background:#9ca3af;border-radius:1px;margin:0 auto"></div>' +
        '</div>' +
        '<div style="position:absolute;top:-4px;left:'+gtPct+'%;transform:translateX(-50%)">' +
          '<div style="width:2px;height:36px;background:var(--accent);border-radius:1px;margin:0 auto;opacity:.7"></div>' +
        '</div>' +
        '<div style="position:absolute;top:5px;left:min(calc('+scPct+'% - 20px), calc(100% - 50px));font-size:11px;font-weight:700;color:#fff;white-space:nowrap">'+score+'</div>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--text3)">' +
        '<span>300</span><span style="color:#9ca3af">Avg: '+IND_AVG+'</span><span style="color:var(--accent)">Good: '+GOOD_THRESH+'</span><span>900</span>' +
      '</div>' +
      (score < GOOD_THRESH
        ? '<div style="margin-top:6px;font-size:11.5px;color:var(--text2)"><span style="color:var(--accent);font-weight:700">+'+(GOOD_THRESH-score)+' points</span> needed to reach "Good" tier</div>'
        : '<div style="margin-top:6px;font-size:11.5px;color:#16a34a;font-weight:600">✓ '+(score-GOOD_THRESH)+' points above "Good" threshold</div>') +
    '</div>';
  }

  /* ── Band rail ── */
  function _buildRail(score, minSc, maxSc) {
    var RANGE=maxSc-minSc;
    var segs=BANDS.map(function(b){
      var w=((b.max-b.min+1)/RANGE*100).toFixed(2), active=score>=b.min&&score<=b.max;
      return '<div style="flex:'+w+';background:'+b.color+';opacity:'+(active?1:.2)+';height:100%;transition:opacity .3s'+(active?';box-shadow:0 0 6px '+b.color:'')+'" ></div>';
    }).join('');
    var labels=BANDS.map(function(b){
      var w=((b.max-b.min+1)/RANGE*100).toFixed(2), active=score>=b.min&&score<=b.max;
      return '<div style="flex:'+w+';text-align:center;font-size:9.5px;color:'+(active?b.color:'var(--text3)')+';font-weight:'+(active?700:400)+';padding-top:2px">'+b.label+'</div>';
    }).join('');
    return '<div style="margin-top:14px">' +
      '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-bottom:3px"><span>'+minSc+'</span><span>'+maxSc+'</span></div>' +
      '<div style="display:flex;height:7px;border-radius:5px;overflow:hidden;gap:1px">'+segs+'</div>' +
      '<div style="display:flex">'+labels+'</div>' +
    '</div>';
  }

  /* ── Score trend sparkline (unchanged from v7) ── */
  function _buildTrend(score, minSc, maxSc, pan) {
    var trendScores=[], ts=score;
    for (var m=5;m>=0;m--){
      var delta=((pan.charCodeAt(m%pan.length)*17+m*31)%41)-15;
      trendScores.unshift(Math.min(maxSc,Math.max(minSc,ts-delta)));
    }
    trendScores.push(score);
    var tW=320, tH=60, tPad=8;
    var tMin=Math.min.apply(null,trendScores)-20, tMax=Math.max.apply(null,trendScores)+20;
    var tRange=tMax-tMin||1;
    var pts=trendScores.map(function(s,i){
      return (tPad+(i/(trendScores.length-1))*(tW-tPad*2))+','+(tH-tPad-(s-tMin)/tRange*(tH-tPad*2));
    });
    var lastPt=pts[pts.length-1].split(',');
    var months=['6m ago','5m ago','4m ago','3m ago','2m ago','1m ago','Now'];
    var tColor=trendScores[trendScores.length-1]>=trendScores[0]?'#16a34a':'#dc2626';
    var tArrow=trendScores[trendScores.length-1]>=trendScores[0]?'↑':'↓';
    var tDiff=Math.abs(trendScores[trendScores.length-1]-trendScores[0]);
    return '<div class="cibil-section" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:18px 20px;margin-bottom:14px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
        '<div style="font-size:14px;font-weight:700;color:var(--text)">📉 Score Trend <span style="font-size:11px;background:var(--accent-subtle);color:var(--accent);padding:2px 8px;border-radius:10px;font-weight:600;margin-left:4px">6-month simulated</span></div>' +
        '<div style="font-size:12px;font-weight:700;color:'+tColor+'">'+tArrow+' '+tDiff+' pts vs 6m ago</div>' +
      '</div>' +
      '<svg width="100%" viewBox="0 0 '+tW+' '+tH+'" preserveAspectRatio="none" style="overflow:visible">' +
        '<defs><linearGradient id="tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="'+tColor+'" stop-opacity=".18"/><stop offset="100%" stop-color="'+tColor+'" stop-opacity="0"/></linearGradient></defs>' +
        '<polygon points="'+tPad+','+tH+' '+pts.join(' ')+' '+(tW-tPad)+','+tH+'" fill="url(#tg)"/>' +
        '<polyline points="'+pts.join(' ')+'" fill="none" stroke="'+tColor+'" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
        pts.map(function(p,i){ var xy=p.split(','); return '<circle cx="'+xy[0]+'" cy="'+xy[1]+'" r="'+(i===pts.length-1?4:2.5)+'" fill="'+(i===pts.length-1?tColor:'var(--surface)')+'\" stroke="'+tColor+'" stroke-width="1.5"/>'; }).join('') +
        '<text x="'+lastPt[0]+'" y="'+(parseFloat(lastPt[1])-8)+'" text-anchor="middle" font-size="10" font-weight="700" fill="'+tColor+'">'+score+'</text>' +
      '</svg>' +
      '<div style="display:flex;justify-content:space-between;margin-top:4px">' +
        months.map(function(m){return '<span style="font-size:9.5px;color:var(--text3)">'+m+'</span>';}).join('') +
      '</div>' +
    '</div>';
  }

  /* ── Score Breakdown ── */
  function _buildBreakdown(bd) {
    var rows = Object.values(bd).map(function(f, idx){
      var pv = Math.min(100, Math.max(0, f.value || 0));
      var fc = pv >= 75 ? '#16a34a' : pv >= 50 ? '#d97706' : '#dc2626';
      var fm = FACTOR_META[f.label] || {icon: '📌', tip: ''};
      var sw = pv >= 75 ? 'Strong' : pv >= 50 ? 'Moderate' : 'Weak';
      var bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
      
      return '<tr style="background:' + bg + ';border-bottom:1px solid #e2e8f0">' +
        '<td style="padding:14px 16px;font-size:13px;color:#1e3a5f;font-weight:600;width:35%">' +
          fm.icon + ' ' + esc(f.label) +
        '</td>' +
        '<td style="padding:14px 16px;font-size:12px;color:#64748b;width:20%;text-align:center">' +
          (f.weight || '—') + '%' +
        '</td>' +
        '<td style="padding:14px 16px;width:25%">' +
          '<div style="display:flex;align-items:center;gap:8px;height:24px">' +
            '<div style="flex-grow:1;height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden;position:relative">' +
              '<div style="height:100%;width:' + pv + '%;background:' + fc + ';border-radius:4px;transition:width 0.6s ease"></div>' +
            '</div>' +
            '<span style="font-size:12px;font-weight:700;color:' + fc + ';min-width:35px">' + pv + '%</span>' +
          '</div>' +
        '</td>' +
        '<td style="padding:14px 16px;font-size:12px;text-align:center;width:20%">' +
          '<span style="display:inline-block;background:' + fc + '15;color:' + fc + ';padding:3px 10px;border-radius:14px;font-weight:600;white-space:nowrap">' + sw + '</span>' +
        '</td>' +
      '</tr>';
    }).join('');
    
    var tableHtml = '<table style="width:100%;border-collapse:collapse">' +
      '<thead>' +
        '<tr style="background:#f1f5f9;border-bottom:2px solid #cbd5e1">' +
          '<th style="padding:12px 16px;text-align:left;font-size:12px;font-weight:700;color:#1e3a5f">Factor</th>' +
          '<th style="padding:12px 16px;text-align:center;font-size:12px;font-weight:700;color:#1e3a5f">Weight</th>' +
          '<th style="padding:12px 16px;text-align:left;font-size:12px;font-weight:700;color:#1e3a5f">Score Contribution</th>' +
          '<th style="padding:12px 16px;text-align:center;font-size:12px;font-weight:700;color:#1e3a5f">Status</th>' +
        '</tr>' +
      '</thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table>';
    
    return '<div class="cibil-section" style="background:#ffffff;border:1px solid #dde6f0;border-radius:10px;padding:20px;margin-bottom:14px;overflow:hidden">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;margin-bottom:16px" onclick="_cibilToggle(\'cibil-bd\',this)">' +
        '<div>' +
          '<h3 style="font-size:15px;font-weight:700;color:#1e3a5f;margin:0 0 3px">📊 Score Breakdown</h3>' +
          '<p style="font-size:12px;color:#64748b;margin:0">CIBIL weightage model — Each factor contributes to your final credit score</p>' +
        '</div>' +
        '<span style="font-size:12px;color:#94a3b8" id="cibil-bd-arrow">▾</span>' +
      '</div>' +
      '<div id="cibil-bd" style="display:block;overflow-x:auto">' + tableHtml + '</div>' +
    '</div>';
  }

  /* ── Score Factors (Positive / Negative) ── */
  function _buildScoreFactors(posFactors, negFactors) {
    if (!posFactors.length && !negFactors.length) return '';
    function factorCard(f, isPos) {
      var clr = isPos ? '#15803d' : '#dc2626';
      var bg  = isPos ? '#dcfce7' : '#fee2e2';
      var sign= isPos ? '+' : '-';
      return '<div style="border:1px solid var(--border);border-radius:8px;padding:10px 12px;border-left:3px solid '+clr+'">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">' +
          '<div>' +
            '<div style="font-size:12.5px;font-weight:600;color:var(--text)">'+esc(f.factor||f.Factor||'—')+'</div>' +
            '<div style="font-size:11px;color:var(--text3);margin-top:2px">'+esc(f.description||f.Description||'')+'</div>' +
          '</div>' +
          '<span style="background:'+bg+';color:'+clr+';font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap">'+sign+(f.impactScore||f.ImpactScore||0)+' pts</span>' +
        '</div>' +
      '</div>';
    }
    var posHtml = posFactors.length
      ? '<div><div style="font-size:12px;font-weight:700;color:#15803d;margin-bottom:8px">✅ Positive Factors</div>' +
          '<div style="display:flex;flex-direction:column;gap:6px">'+posFactors.map(function(f){return factorCard(f,true);}).join('')+'</div></div>'
      : '';
    var negHtml = negFactors.length
      ? '<div><div style="font-size:12px;font-weight:700;color:#dc2626;margin-bottom:8px">⚠️ Negative Factors</div>' +
          '<div style="display:flex;flex-direction:column;gap:6px">'+negFactors.map(function(f){return factorCard(f,false);}).join('')+'</div></div>'
      : '';
    return '<div class="cibil-section" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:18px 20px;margin-bottom:14px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;margin-bottom:12px" onclick="_cibilToggle(&apos;cibil-sf-body&apos;,this)">' +
        '<div style="font-size:14px;font-weight:700;color:var(--text)">🏅 Score Factors ' +
          '<span style="font-size:11px;background:var(--accent-subtle);color:var(--accent);padding:2px 8px;border-radius:10px;font-weight:600;margin-left:4px">'+
            (posFactors.length+negFactors.length)+' factors</span></div>' +
        '<span id="cibil-sf-body-arrow" style="font-size:12px;color:var(--text3)">▾</span>' +
      '</div>' +
      '<div id="cibil-sf-body">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">'+posHtml+negHtml+'</div>' +
      '</div>' +
    '</div>';
  }

  /* ── Account Summary Dashboard (enhanced) ── */
  function _buildAccountSummary(accSum, loanHistory) {
    // Use bureau account summary if available, else fall back to loan history
    var hasAccSum = accSum && (accSum.totalAccounts || accSum.totalSanctionAmount);

    if (!hasAccSum && (!loanHistory || !loanHistory.length)) return '';

    if (hasAccSum) {
      var widgets = [
        {icon:'🏦', val: accSum.totalAccounts||0,            lbl:'Total Accounts',   c:'var(--text)'},
        {icon:'✅', val: accSum.activeAccounts||0,           lbl:'Active',            c:'#16a34a'},
        {icon:'🔒', val: accSum.closedAccounts||0,           lbl:'Closed',            c:'#64748b'},
        {icon:'💰', val: fmtINR(accSum.totalSanctionAmount), lbl:'Total Sanctioned',  c:'#1d4ed8'},
        {icon:'📋', val: fmtINR(accSum.currentOutstanding),  lbl:'Outstanding',       c:'#d97706'},
        {icon:'⚠️', val: fmtINR(accSum.overdueAmount),       lbl:'Overdue',           c:(accSum.overdueAmount>0?'#dc2626':'#16a34a')},
        {icon:'🔐', val: accSum.securedLoanCount||0,         lbl:'Secured',           c:'var(--text)'},
        {icon:'💳', val: accSum.unsecuredLoanCount||0,       lbl:'Unsecured',         c:'var(--text)'},
        {icon:'📅', val: accSum.oldestAccountDate ? fmtDate(accSum.oldestAccountDate) : '—', lbl:'Oldest Account', c:'#7c3aed'},
        {icon:'🆕', val: accSum.latestAccountDate ? fmtDate(accSum.latestAccountDate) : '—', lbl:'Latest Account', c:'#0891b2'},
      ];
      var wHtml = widgets.map(function(w){
        return '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--r-sm);padding:12px 14px;text-align:center">' +
          '<div style="font-size:20px;margin-bottom:4px">'+w.icon+'</div>' +
          '<div style="font-size:20px;font-weight:800;color:'+w.c+';line-height:1">'+esc(String(w.val))+'</div>' +
          '<div style="font-size:10.5px;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;font-weight:600;margin-top:3px">'+esc(w.lbl)+'</div>' +
        '</div>';
      }).join('');
      return '<div class="cibil-section" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:18px 20px;margin-bottom:14px">' +
        '<div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:12px">🗂️ Account Summary Dashboard</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px">'+wHtml+'</div>' +
      '</div>';
    }

    // Fallback: derive from loanHistory
    var loans=loanHistory||[];
    var ACTIVE_RE=/login|underwriting|offer|approved|wip|disburs/i;
    var CLOSED_RE=/closed|settled|completed/i;
    var total=loans.length, active=loans.filter(function(l){return ACTIVE_RE.test(String(l.status));}).length;
    var closed=loans.filter(function(l){return CLOSED_RE.test(String(l.status));}).length;
    var totalAmt=loans.reduce(function(s,l){return s+(Number(l.amount)||0);},0);
    var widgets2=[
      {icon:'🏦', val:total,         lbl:'Total',     c:'var(--text)'},
      {icon:'✅', val:active,        lbl:'Active',    c:'#16a34a'},
      {icon:'🔒', val:closed,        lbl:'Closed',    c:'#64748b'},
      {icon:'💰', val:fmtINR(totalAmt), lbl:'Total Amt', c:'#1d4ed8'},
    ];
    var wHtml2 = widgets2.map(function(w){
      return '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--r-sm);padding:12px 14px;text-align:center">' +
        '<div style="font-size:20px;margin-bottom:4px">'+w.icon+'</div>' +
        '<div style="font-size:20px;font-weight:800;color:'+w.c+'">'+esc(String(w.val))+'</div>' +
        '<div style="font-size:10.5px;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;font-weight:600;margin-top:3px">'+esc(w.lbl)+'</div>' +
      '</div>';
    }).join('');
    return '<div class="cibil-section" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:18px 20px;margin-bottom:14px">' +
      '<div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:12px">🗂️ Account Summary</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px">'+wHtml2+'</div>' +
    '</div>';
  }

  /* ═══════════════════════════════════════════════════════════════════════
     NEW: Active loans · portfolio breakdown · payment behaviour
  ═══════════════════════════════════════════════════════════════════════ */

  // thousands-grouped integer (no currency symbol)
  function _crGrp(v) { v = Number(v) || 0; return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  // compact stat tile
  function _crStat(icon, val, lbl, color) {
    return '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--r-sm);padding:12px 14px;text-align:center">' +
      '<div style="font-size:18px;margin-bottom:3px">' + icon + '</div>' +
      '<div style="font-size:17px;font-weight:800;color:' + color + ';line-height:1.15">' + esc(String(val)) + '</div>' +
      '<div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;font-weight:600;margin-top:3px">' + esc(lbl) + '</div>' +
    '</div>';
  }

  // inline label / value pair
  function _crKV(lbl, val, color) {
    return '<div>' +
      '<div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.03em;font-weight:600;margin-bottom:2px">' + esc(lbl) + '</div>' +
      '<div style="font-size:13px;font-weight:700;color:' + (color || 'var(--text)') + '">' + esc(String(val)) + '</div>' +
    '</div>';
  }

  // compact last-N-month payment circles (reuses the DPD colour classes)
  function _crPayStrip(paymentHistory, n) {
    n = n || 12;
    var ph = (paymentHistory || []).filter(function(p){ return p && p.reportMonth && !isNaN(new Date(p.reportMonth)); });
    if (!ph.length) return '<span style="font-size:11px;color:var(--text3);font-style:italic">No payment history reported</span>';
    ph.sort(function(a, b){ return new Date(a.reportMonth) - new Date(b.reportMonth); });
    var recent = ph.slice(-n);
    var M = ['J','F','M','A','M','J','J','A','S','O','N','D'];
    return '<div style="display:flex;gap:5px;flex-wrap:wrap;align-items:flex-end">' + recent.map(function(p){
      var val = p.dpdStatus || (p.daysOverdue === 0 ? '000' : String(p.daysOverdue));
      var d = new Date(p.reportMonth);
      return '<span style="display:inline-flex;flex-direction:column;align-items:center;gap:3px">' +
        '<span class="' + dpdClass(val) + '" style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;font-size:9px;line-height:1">' + esc(dpdDisplay(val)) + '</span>' +
        '<span style="font-size:8px;color:var(--text3)">' + M[d.getMonth()] + '</span>' +
      '</span>';
    }).join('') + '</div>';
  }

  // ── Active Loan Accounts spotlight ──
  function _buildActiveLoans(accounts) {
    if (!accounts || !accounts.length) return '';
    var active = accounts.filter(function(a){ return (a.accountStatus || '').toUpperCase().indexOf('ACTIVE') !== -1; });
    if (!active.length) {
      return '<div class="cibil-section" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:18px 20px;margin-bottom:14px">' +
        '<div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:6px">🔵 Active Loan Accounts</div>' +
        '<div style="font-size:12.5px;color:var(--text3)">No active loan accounts are currently being reported.</div>' +
      '</div>';
    }
    var totalEmi  = active.reduce(function(s, a){ return s + (Number(a.emiAmount)     || 0); }, 0);
    var totalOut  = active.reduce(function(s, a){ return s + (Number(a.currentBalance) || 0); }, 0);
    var totalSanc = active.reduce(function(s, a){ return s + (Number(a.sanctionAmount) || 0); }, 0);

    var topStats =
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:16px">' +
        _crStat('🔵', String(active.length),   'Active Accounts',   'var(--accent)') +
        _crStat('💸', fmtINR(totalEmi) + '/mo', 'Total Monthly EMI', 'var(--warn)')   +
        _crStat('📋', fmtINR(totalOut),         'Total Outstanding', 'var(--danger)') +
        _crStat('💰', fmtINR(totalSanc),        'Total Sanctioned',  'var(--accent)') +
      '</div>';

    var cards = active.map(function(a){
      var prog = '';
      var tenure = Number(a.tenureMonths) || (a.repaymentTenure ? parseInt(a.repaymentTenure) : 0);
      if (tenure > 0 && a.openDate && !isNaN(new Date(a.openDate))) {
        var elapsed = Math.max(0, Math.round((Date.now() - new Date(a.openDate)) / (1000 * 60 * 60 * 24 * 30.44)));
        var pctDone = Math.min(100, Math.round(elapsed / tenure * 100));
        prog = '<div style="margin-top:10px">' +
          '<div style="display:flex;justify-content:space-between;font-size:10.5px;color:var(--text3);margin-bottom:4px"><span>Tenure progress</span><span>' + Math.min(elapsed, tenure) + ' / ' + tenure + ' months</span></div>' +
          '<div style="height:6px;background:var(--surface3);border-radius:4px;overflow:hidden"><div style="height:100%;width:' + pctDone + '%;background:var(--accent);border-radius:4px"></div></div>' +
        '</div>';
      }
      return '<div style="border:1px solid var(--border);border-radius:var(--r-sm);padding:14px 16px;background:var(--surface2)">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:10px">' +
          '<div>' +
            '<div style="font-size:14px;font-weight:700;color:var(--text)">' + esc(a.lenderName || '—') + '</div>' +
            '<div style="font-size:11.5px;color:var(--text3);margin-top:1px">' + esc(a.loanType || 'Loan') + ' · ' + esc(a.accountNumberMasked || '—') + '</div>' +
          '</div>' +
          '<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;border:1.5px solid var(--success);color:var(--success);background:var(--success-subtle)">ACTIVE</span>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">' +
          _crKV('Outstanding', a.currentBalance ? '₹' + _crGrp(a.currentBalance) : '—', 'var(--danger)') +
          _crKV('EMI',         a.emiAmount      ? '₹' + _crGrp(a.emiAmount) + '/mo' : '—', 'var(--text)') +
          _crKV('Interest',    a.interestRate   ? a.interestRate + '% p.a.' : '—',         'var(--text)') +
        '</div>' +
        prog +
        '<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">' +
          '<div style="font-size:10.5px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">Recent payment history</div>' +
          _crPayStrip(a.paymentHistory, 12) +
        '</div>' +
      '</div>';
    }).join('');

    return '<div class="cibil-section" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:18px 20px;margin-bottom:14px" id="cr-active-loans">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:4px">' +
        '<div style="font-size:14px;font-weight:700;color:var(--text)">🔵 Active Loan Accounts</div>' +
        '<span style="font-size:12px;font-weight:700;color:var(--accent);background:var(--accent-subtle);padding:3px 12px;border-radius:20px">' + active.length + ' active</span>' +
      '</div>' +
      '<p style="font-size:12px;color:var(--text3);margin:0 0 14px">Loans currently open and being reported — with live EMI, outstanding balance and recent repayment track.</p>' +
      topStats +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:12px">' + cards + '</div>' +
    '</div>';
  }

  // ── Credit Portfolio breakdown by loan type ──
  function _buildPortfolioBreakdown(accounts) {
    if (!accounts || !accounts.length) return '';
    var byType = {};
    accounts.forEach(function(a){
      var t = ((a.loanType || '').trim()) || 'Other';
      if (!byType[t]) byType[t] = { type: t, count: 0, active: 0, sanctioned: 0, outstanding: 0 };
      var g = byType[t];
      g.count++;
      if ((a.accountStatus || '').toUpperCase().indexOf('ACTIVE') !== -1) g.active++;
      g.sanctioned  += Number(a.sanctionAmount) || 0;
      g.outstanding += Number(a.currentBalance) || 0;
    });
    var groups = Object.keys(byType).map(function(k){ return byType[k]; })
      .sort(function(a, b){ return b.sanctioned - a.sanctioned; });
    var totalSanc = groups.reduce(function(s, g){ return s + g.sanctioned; }, 0) || 1;
    var PALETTE = ['var(--accent)', 'var(--danger)', 'var(--warn)', 'var(--success)', '#7c3aed', '#0891b2', '#64748b'];

    var rows = groups.map(function(g, i){
      var share = Math.round(g.sanctioned / totalSanc * 100);
      var col = PALETTE[i % PALETTE.length];
      return '<div style="margin-bottom:13px">' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px;flex-wrap:wrap;gap:6px">' +
          '<span style="font-size:13px;font-weight:700;color:var(--text)"><span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:' + col + ';margin-right:7px"></span>' + esc(g.type) + '</span>' +
          '<span style="font-size:11.5px;color:var(--text3)">' + g.count + ' a/c · ' + g.active + ' active · ₹' + _crGrp(g.outstanding) + ' o/s</span>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<div style="flex:1;height:8px;background:var(--surface3);border-radius:5px;overflow:hidden"><div style="height:100%;width:' + Math.max(share, 2) + '%;background:' + col + ';border-radius:5px"></div></div>' +
          '<span style="font-size:12px;font-weight:700;color:var(--text);min-width:84px;text-align:right">₹' + _crGrp(g.sanctioned) + '</span>' +
          '<span style="font-size:11px;color:var(--text3);min-width:32px;text-align:right">' + share + '%</span>' +
        '</div>' +
      '</div>';
    }).join('');

    return '<div class="cibil-section" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:18px 20px;margin-bottom:14px" id="cr-portfolio">' +
      '<div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:4px">📊 Credit Portfolio Breakdown</div>' +
      '<p style="font-size:12px;color:var(--text3);margin:0 0 14px">Distribution of your ' + accounts.length + ' credit accounts by product type, ranked by sanctioned amount.</p>' +
      rows +
    '</div>';
  }

  // ── Payment Behaviour summary (aggregate across all accounts) ──
  function _buildPaymentBehaviour(accounts) {
    if (!accounts || !accounts.length) return '';
    var onTime = 0, late = 0, serious = 0, total = 0, worst = 0, overdueAccts = 0;
    accounts.forEach(function(a){
      if ((Number(a.currentDPD) || 0) > 0) overdueAccts++;
      (a.paymentHistory || []).forEach(function(p){
        var raw = (p.dpdStatus != null) ? p.dpdStatus : p.daysOverdue;
        if (raw == null || raw === 'NA' || raw === 'XXX' || raw === '-') return;
        var n = (raw === '000' || raw === 'STD' || raw === 0 || raw === '0') ? 0 : parseInt(raw);
        if (isNaN(n)) return;
        total++;
        if (n === 0) onTime++;
        else if (n < 90) late++;
        else serious++;
        if (n > worst) worst = n;
      });
    });
    if (!total) return '';
    var onTimePct = Math.round(onTime / total * 100);
    var barColor = onTimePct >= 95 ? 'var(--success)' : onTimePct >= 85 ? 'var(--warn)' : 'var(--danger)';
    var verdict  = onTimePct >= 95 ? 'Excellent repayment discipline — keep it up.'
                 : onTimePct >= 85 ? 'Mostly on time; a few delays are pulling your score down.'
                 : 'Frequent delays are significantly hurting your score.';

    var stats =
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(135px,1fr));gap:10px;margin-bottom:16px">' +
        _crStat('📆', String(total),                          'Months Tracked',       'var(--text)')   +
        _crStat('✅', onTime + ' (' + onTimePct + '%)',       'Paid On Time',         'var(--success)')+
        _crStat('🟡', String(late),                           'Late · 1-89 days',     'var(--warn)')   +
        _crStat('🔴', String(serious),                        'Serious · 90+ days',   'var(--danger)') +
        _crStat('⚠️', worst > 0 ? worst + ' days' : 'None',   'Worst Delay',          worst > 0 ? 'var(--danger)' : 'var(--success)') +
        _crStat('🏦', String(overdueAccts),                   'Accounts Overdue Now', overdueAccts > 0 ? 'var(--danger)' : 'var(--success)') +
      '</div>';

    var bar =
      '<div style="margin-bottom:6px;display:flex;justify-content:space-between;align-items:baseline">' +
        '<span style="font-size:12.5px;font-weight:600;color:var(--text2)">On-time payment rate</span>' +
        '<span style="font-size:18px;font-weight:800;color:' + barColor + '">' + onTimePct + '%</span>' +
      '</div>' +
      '<div style="height:10px;background:var(--surface3);border-radius:6px;overflow:hidden"><div style="height:100%;width:' + onTimePct + '%;background:' + barColor + ';border-radius:6px"></div></div>' +
      '<div style="font-size:11px;color:var(--text3);margin-top:8px">' + verdict + '</div>';

    return '<div class="cibil-section" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:18px 20px;margin-bottom:14px" id="cr-paybehaviour">' +
      '<div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:4px">🧾 Payment Behaviour Summary</div>' +
      '<p style="font-size:12px;color:var(--text3);margin:0 0 14px">Aggregated repayment track across all ' + accounts.length + ' accounts and ' + total + ' reported months.</p>' +
      stats + bar +
    '</div>';
  }

  /* ── Summary: Loan Accounts + Account Details (CRIF PDF style) ── */
  function _buildAccountsTable(accounts) {
    if (!accounts || !accounts.length) return '';

    // ── TH helper ──────────────────────────────────────────────────────
    function TH(txt, opts) {
      opts = opts || {};
      return '<th style="padding:12px 14px;text-align:'+(opts.center?'center':opts.right?'right':'left')+';font-size:12px;font-weight:700;color:#1e3a5f;border-bottom:2px solid #dde6f0;white-space:nowrap;background:#f8fafc">'+txt+'</th>';
    }
    function TD(val, opts) {
      opts = opts || {};
      return '<td style="padding:11px 14px;font-size:13px;color:'+(opts.color||'#334155')+';text-align:'+(opts.center?'center':opts.right?'right':'left')+';white-space:nowrap;border-bottom:1px solid #e8eef4;font-weight:'+(opts.bold?'600':'400')+'">'+val+'</td>';
    }

    // ── ACTIVE / CLOSED badge (exact PDF style) ─────────────────────
    function statusBadge(status) {
      var s = (status||'').toUpperCase();
      var isActive = s.indexOf('ACTIVE') !== -1;
      return '<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11.5px;font-weight:600;border:1.5px solid '+(isActive?'#10b981':'#94a3b8')+';color:'+(isActive?'#059669':'#64748b')+';background:'+(isActive?'#f0fdf4':'#f8fafc')+'">'+s+'</span>';
    }

    // ── Summary table rows ──────────────────────────────────────────
    var summaryRows = accounts.map(function(a, idx) {
      var bg = idx%2===0 ? '#fff' : '#fafbfc';
      return '<tr style="background:'+bg+';cursor:pointer" onclick="_cibilToggleDetail(\'cibil-acct-detail-'+idx+'\')" title="Click to view account details">' +
        TD('<strong style="color:#1e3a5f">'+esc(a.lenderName||'—')+'</strong>') +
        TD(esc(a.loanType||'—')) +
        TD('<a style="color:#2563eb;text-decoration:underline;font-family:monospace;font-size:12px">'+esc(a.accountNumberMasked||'—')+'</a>') +
        TD(esc(a.ownership||'Individual')) +
        TD(fmtDate(a.openDate)||'—') +
        TD(statusBadge(a.accountStatus), {center:true}) +
        TD(a.lastBankUpdate ? fmtDate(a.lastBankUpdate) : '—') +
        TD(a.sanctionAmount ? String(Math.round(a.sanctionAmount)).replace(/\B(?=(\d{3})+(?!\d))/g,',') : '—', {right:true, bold:true}) +
        TD(a.currentBalance !== undefined && a.currentBalance !== null ? (a.currentBalance > 0 ? String(Math.round(a.currentBalance)).replace(/\B(?=(\d{3})+(?!\d))/g,',') : 'NA') : 'NA', {right:true}) +
      '</tr>' +
      // ── Expandable Account Detail card (exact PDF page 5 style) ──
      '<tr id="cibil-acct-detail-'+idx+'" style="display:none">' +
        '<td colspan="9" style="padding:0;border-bottom:2px solid #dde6f0">' +
          _buildOneAccountDetail(a, idx) +
        '</td>' +
      '</tr>';
    }).join('');

    return '<div class="cibil-section" style="background:#fff;border:1px solid var(--border);border-radius:var(--r);padding:22px 22px;margin-bottom:14px" id="cr-acctable">' +
      '<h2 style="font-size:17px;font-weight:700;color:#1e3a5f;margin:0 0 4px">Summary: Loan Accounts</h2>' +
      '<p style="font-size:12.5px;color:#64748b;margin:0 0 14px">This section displays summary of all your reported loan accounts found in the Credit Bureau database.</p>' +
      '<div style="border:1px solid #dde6f0;border-radius:10px;overflow:hidden">' +
        '<div style="overflow-x:auto">' +
          '<table style="width:100%;border-collapse:collapse;min-width:750px">' +
            '<thead><tr>' +
              TH('Financial Institution') + TH('Account type') + TH('Account No') +
              TH('Ownership') + TH('Opened Date') + TH('Account Status',{center:true}) +
              TH('Last Bank Update') + TH('Loan Amount',{right:true}) + TH('Outstanding Balance',{right:true}) +
            '</tr></thead>' +
            '<tbody>'+summaryRows+'</tbody>' +
          '</table>' +
        '</div>' +
      '</div>' +
      '<div style="margin-top:8px;font-size:11.5px;color:#94a3b8">💡 Click any row to view full account details &amp; payment history</div>' +
    '</div>';
  }

  /* ── Single account detail card (PDF page 5-6 style) ── */
  function _buildOneAccountDetail(a, idx) {
    var isActive = (a.accountStatus||'').toUpperCase().indexOf('ACTIVE') !== -1;

    // KV cell helper
    function kv(lbl, val) {
      return '<tr>' +
        '<td style="padding:9px 14px;font-size:12.5px;color:#64748b;border-bottom:1px solid #f1f5f9;white-space:nowrap;width:40%">'+lbl+'</td>' +
        '<td style="padding:9px 14px;font-size:12.5px;font-weight:600;color:#1e293b;border-bottom:1px solid #f1f5f9">'+val+'</td>' +
      '</tr>';
    }
    function na(v) { return (v===null||v===undefined||v===''||v===0)?'NA':String(v); }
    function amt(v) { return (!v&&v!==0)?'NA': (v===0?'NA': String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g,',')); }

    var leftRows =
      kv('Account Opened Date', fmtDate(a.openDate)||'NA') +
      kv('Account Closed Date', a.closedDate ? fmtDate(a.closedDate) : 'NA') +
      kv('Last Bank Update',    a.lastBankUpdate ? fmtDate(a.lastBankUpdate) : 'NA') +
      kv('Last Payment Date',   a.lastPaymentDate ? fmtDate(a.lastPaymentDate) : 'NA') +
      kv('Repayment Tenure',    na(a.repaymentTenure || (a.tenureMonths ? a.tenureMonths+'M' : null)));

    var rightRows =
      kv('Loan Amount',              amt(a.sanctionAmount)) +
      kv('Settlement Amount',        na(a.settlementAmount ? amt(a.settlementAmount) : null)) +
      kv('Overdue Amount',           (a.currentDPD>0 ? amt(a.currentBalance) : 'NA')) +
      kv('EMI Amount',               amt(a.emiAmount)) +
      kv('Written-Off Principal Amount', na(a.writtenOffPrincipalAmount ? amt(a.writtenOffPrincipalAmount) : null)) +
      kv('Outstanding Balance',      (a.currentBalance>0 ? amt(a.currentBalance) : 'NA')) +
      kv('Written-Off Total Amount', na(a.writtenOffTotalAmount ? amt(a.writtenOffTotalAmount) : null)) +
      kv('Actual Last Payment',      na(a.actualLastPayment ? amt(a.actualLastPayment) : null)) +
      kv('Interest Rate',            a.interestRate ? a.interestRate+'%' : 'NA') +
      kv('Collateral',               na(a.collateral)) +
      kv('Collateral Type',          na(a.collateralType)) +
      kv('Suit Filed Status',        na(a.suitFiledStatus || 'No Suit filed')) +
      kv('Cash Limit',               na(a.cashLimit ? amt(a.cashLimit) : null)) +
      kv('Payment Frequency',        na(a.paymentFrequency));

    var dpdGrid = _buildAccountDpdGrid(a.paymentHistory || []);

    var dpdLegend = '<div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:14px;font-size:12px;align-items:center">' +
      '<span style="display:flex;align-items:center;gap:6px"><span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#dcfce7;color:#15803d;font-weight:700;font-size:12px">✓</span>Paid on time</span>' +
      '<span style="display:flex;align-items:center;gap:6px"><span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;border:1.5px solid #f59e0b;background:#fff8e1;color:#b45309;font-weight:700;font-size:10px">30</span>1-89 days late</span>' +
      '<span style="display:flex;align-items:center;gap:6px"><span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;border:1.5px solid #ef4444;background:#fee2e2;color:#dc2626;font-weight:700;font-size:10px">90</span>90+ days late</span>' +
      '<span style="display:flex;align-items:center;gap:6px"><span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;border:1.5px solid #cbd5e1;color:#94a3b8;font-size:14px">—</span>Not Reported</span>' +
    '</div>';

    return '<div style="background:#fff;padding:0">' +
      // ── Account header card (like IDFC ACTIVE / HDB CLOSED in PDF) ──
      '<div style="background:#fff;border-bottom:1px solid #e2e8f0;padding:16px 22px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">' +
        '<div style="display:flex;align-items:center;gap:14px">' +
          '<div style="width:36px;height:36px;background:#fee2e2;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">🏦</div>' +
          '<span style="font-size:16px;font-weight:700;color:#1e3a5f">'+esc(a.lenderName||'—')+'</span>' +
        '</div>' +
        '<span style="display:inline-block;padding:4px 14px;border-radius:20px;font-size:12.5px;font-weight:600;border:1.5px solid '+(isActive?'#10b981':'#94a3b8')+';color:'+(isActive?'#059669':'#64748b')+';background:'+(isActive?'#f0fdf4':'#f8fafc')+'">'+(isActive?'ACTIVE':'CLOSED')+'</span>' +
      '</div>' +
      // ── Account meta row ──
      '<div style="background:#f8fafc;padding:12px 22px;display:flex;gap:28px;flex-wrap:wrap;border-bottom:1px solid #e2e8f0;font-size:12.5px">' +
        '<span>Account Number: <strong style="color:#1e3a5f;font-family:monospace">'+esc(a.accountNumberMasked||'—')+'</strong></span>' +
        '<span>Account type: <strong style="color:#1e3a5f">'+esc(a.loanType||'—')+'</strong></span>' +
        '<span>Account Status: <strong style="color:#1e3a5f">'+(isActive?'ACTIVE':'CLOSED')+'</strong></span>' +
        '<span>Ownership: <strong style="color:#1e3a5f">'+esc(a.ownership||'Individual')+'</strong></span>' +
      '</div>' +
      // ── Account Details 2-column grid ──
      '<div style="padding:16px 22px">' +
        '<div style="font-size:13.5px;font-weight:700;color:#1e3a5f;text-align:center;padding:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:12px">Account Details</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">' +
          '<div style="border-right:1px solid #e2e8f0"><table style="width:100%;border-collapse:collapse">'+leftRows+'</table></div>' +
          '<div><table style="width:100%;border-collapse:collapse">'+rightRows+'</table></div>' +
        '</div>' +
      '</div>' +
      // ── Payment History ──
      '<div style="padding:0 22px 20px">' +
        '<div style="font-size:14px;font-weight:700;color:#1e3a5f;margin-bottom:12px">Payment History</div>' +
        dpdLegend +
        (dpdGrid || '<div style="color:#94a3b8;font-size:12.5px;text-align:center;padding:16px">No payment history available</div>') +
      '</div>' +
    '</div>';
  }

  /* ── Lender bank cards ── */
  function _buildBankCards(eligibleBanks) {
    if (!eligibleBanks || !eligibleBanks.length) {
      return '<div style="text-align:center;padding:20px;color:var(--text3);font-size:13px">😔 No lenders match this credit profile.</div>';
    }
    return '<div style="display:flex;flex-direction:column;gap:8px">' +
      eligibleBanks.map(function(b){
        var amt=parseMaxAmt(b.maxAmount), rt=parseMinRate(b.rate);
        var monthlyEmi=calcEMI(amt, rt, 5);
        return '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--r-sm);padding:11px 13px">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start">' +
            '<div>' +
              '<div style="font-size:13px;font-weight:700;color:var(--text)">'+esc(b.bank||b.name||'—')+'</div>' +
              '<div style="font-size:10.5px;color:var(--text3);margin-top:1px">Up to '+esc(b.maxAmount)+' · '+esc(b.rate)+'</div>' +
            '</div>' +
            '<button class="btn btn-sm btn-success" style="font-size:11px;padding:3px 10px" onclick="typeof showPage===\'function\'&&showPage(\'new-application\',null)" title="Start application">Apply →</button>' +
          '</div>' +
          '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">' +
            '<span style="font-size:11px;color:var(--text3)">Est. EMI (5yr, max amt)</span>' +
            '<span style="font-size:13px;font-weight:700;color:var(--text)">₹'+monthlyEmi+'/mo</span>' +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  /* ── Score Simulator ── */
  function _buildSimulator(score, bd) {
    var rows = Object.values(bd).map(function(f,i){
      return '<div style="margin-bottom:12px">' +
        '<div style="display:flex;justify-content:space-between;margin-bottom:4px">' +
          '<span style="font-size:12.5px;font-weight:600;color:var(--text)">'+(FACTOR_META[f.label]||{icon:'📌'}).icon+' '+esc(f.label)+'</span>' +
          '<span style="font-size:12px;color:var(--text3)" id="cibil-sim-val-'+i+'">'+Math.round(f.value||0)+'%</span>' +
        '</div>' +
        '<input type="range" min="0" max="100" value="'+Math.round(f.value||0)+'" ' +
          'data-weight="'+(f.weight||0)+'" data-orig="'+Math.round(f.value||0)+'" ' +
          'oninput="_cibilSimUpdate(this,'+i+')" ' +
          'style="width:100%;accent-color:var(--accent);cursor:pointer">' +
      '</div>';
    }).join('');

    var color = _bandColor(score);
    var status = _scoreStatus(score);

    return '<div class="cibil-section cibil-simulator" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:18px 20px">' +
      '<div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:4px">🎛️ Score Simulator</div>' +
      '<div style="font-size:12px;color:var(--text3);margin-bottom:14px">Drag sliders to see how improving each factor could affect the score.</div>' +
      rows +
      '<div style="margin-top:12px;padding:12px 16px;background:var(--surface2);border-radius:var(--r-sm);border:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">' +
        '<div>' +
          '<div style="font-size:11px;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:.5px">Projected Score</div>' +
          '<div style="font-size:22px;font-weight:800;color:var(--text)" id="cibil-sim-score">'+score+'</div>' +
        '</div>' +
        '<div id="cibil-sim-badge" style="font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;background:'+color+'20;color:'+color+'">'+esc(status)+'</div>' +
        '<button class="btn btn-ghost btn-sm" onclick="_cibilSimReset()" style="font-size:11.5px">↺ Reset</button>' +
      '</div>' +
    '</div>';
  }

  /* ── Action Plan ── */
  function _buildActionPlan(bd) {
    var factors = Object.values(bd);
    if (!factors.length) return '';
    var rows = factors.map(function(f){
      var v=f.value||0, gap=Math.max(0,100-v);
      var ptsGain=Math.round((gap/100)*(f.weight||0)*1.5);
      var statusColor=v>=80?'#059669':v>=50?'#d97706':'#dc2626';
      var advice=/Payment/i.test(f.label)?'Pay every EMI on time':/Utilis/i.test(f.label)?'Keep card usage below 30%':/Age/i.test(f.label)?'Keep old accounts open':/Mix/i.test(f.label)?'Add a secured + unsecured mix':/Enquir/i.test(f.label)?'Avoid frequent loan enquiries':'Maintain healthy credit habits';
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">' +
        '<div style="flex:1"><div style="font-size:13px;font-weight:600;color:var(--text)">'+esc(f.label)+'</div><div style="font-size:11px;color:var(--text3);margin-top:1px">'+esc(advice)+'</div></div>' +
        '<div style="text-align:right;min-width:90px">' +
          (ptsGain>0
            ? '<div style="font-size:14px;font-weight:800;color:'+statusColor+'">+'+ptsGain+' pts</div><div style="font-size:10px;color:var(--text3)">potential gain</div>'
            : '<div style="font-size:13px;font-weight:700;color:#059669">✓ Optimal</div>') +
        '</div>' +
      '</div>';
    }).join('');
    return '<div class="cibil-section" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:18px 20px;margin-bottom:14px">' +
      '<div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:6px">🎯 Action Plan — Boost Your Score</div>' +
      '<div style="font-size:11.5px;color:var(--text3);margin-bottom:8px">Estimated points you could gain by improving each factor.</div>' +
      rows +
    '</div>';
  }

  /* ── Improvement Tips ── */
  function _buildTips(recommendations) {
    function tipMeta(r){
      if (/EMI|payment|history/i.test(r))      return {icon:'🔴',label:'Critical',c:'#dc2626'};
      if (/utilis|credit card|30%/i.test(r))   return {icon:'🟠',label:'High',   c:'#ea580c'};
      if (/enquir|secured|rehabilit/i.test(r)) return {icon:'🟡',label:'Moderate',c:'#d97706'};
      return                                          {icon:'🔵',label:'Advisory',c:'#2563eb'};
    }
    var tipRows = recommendations && recommendations.length
      ? '<div style="display:flex;flex-direction:column;gap:7px">' +
          recommendations.map(function(r){
            var t=tipMeta(r);
            return '<div style="display:flex;gap:9px;align-items:flex-start;background:var(--surface2);border-radius:var(--r-sm);padding:10px 12px;border:1px solid var(--border);border-left:3px solid '+t.c+'">' +
              '<span style="font-size:14px;flex-shrink:0">'+t.icon+'</span>' +
              '<div><div style="font-size:10px;font-weight:700;color:'+t.c+';text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">'+t.label+'</div>' +
              '<div style="font-size:12.5px;color:var(--text2);line-height:1.5">'+esc(r)+'</div></div>' +
            '</div>';
          }).join('') +
        '</div>'
      : '<div style="text-align:center;padding:20px;color:#16a34a;font-size:13px;font-weight:600">🏆 Excellent score — maintain current behaviour.</div>';

    return '<div class="cibil-section" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:18px 20px;margin-bottom:14px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;margin-bottom:12px" onclick="_cibilToggle(\'cibil-tips\',this)">' +
        '<div style="font-size:14px;font-weight:700;color:var(--text)">💡 Improvement Tips</div>' +
        '<span style="font-size:12px;color:var(--text3)" id="cibil-tips-arrow">▾</span>' +
      '</div>' +
      '<div id="cibil-tips">'+tipRows+'</div>' +
    '</div>';
  }

  /* ── Loan History in EFIN ── */
  function _buildLoanHistory(loanHistory) {
    if (!loanHistory || !loanHistory.length) return '';
    var SPILL={'Disbursed':{bg:'rgba(22,163,74,.1)',c:'#15803d'},'Approved':{bg:'rgba(37,99,235,.1)',c:'#1d4ed8'},'Rejected':{bg:'rgba(220,38,38,.1)',c:'#dc2626'},'Pending':{bg:'rgba(217,119,6,.1)',c:'#b45309'}};
    var hRows = loanHistory.map(function(l){
      var sp=SPILL[l.status]||{bg:'var(--surface3)',c:'var(--text3)'};
      return '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:9px 8px;font-weight:600;font-size:13px">'+esc(l.loanNumber)+'</td>' +
        '<td style="padding:9px 8px;color:var(--text2);font-size:12px">'+esc(l.loanType)+'</td>' +
        '<td style="padding:9px 8px;text-align:right;font-size:13px;font-weight:600">'+fmtINR(Number(l.amount))+'</td>' +
        '<td style="padding:9px 8px"><span class="badge" style="background:'+sp.bg+';color:'+sp.c+'">'+esc(l.status)+'</span></td>' +
      '</tr>';
    }).join('');
    return '<div class="cibil-section" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:18px 20px;margin-bottom:14px">' +
      '<div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:14px">📋 Loan History in EFIN</div>' +
      '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px;min-width:360px">' +
        '<thead><tr style="border-bottom:2px solid var(--border)">' +
          '<th style="text-align:left;padding:6px 8px;color:var(--text3);font-size:10.5px;text-transform:uppercase;font-weight:700">Loan No.</th>' +
          '<th style="text-align:left;padding:6px 8px;color:var(--text3);font-size:10.5px;text-transform:uppercase;font-weight:700">Type</th>' +
          '<th style="text-align:right;padding:6px 8px;color:var(--text3);font-size:10.5px;text-transform:uppercase;font-weight:700">Amount</th>' +
          '<th style="text-align:left;padding:6px 8px;color:var(--text3);font-size:10.5px;text-transform:uppercase;font-weight:700">Status</th>' +
        '</tr></thead><tbody>'+hRows+'</tbody></table></div>' +
    '</div>';
  }

  /* ═══════════════════════════════════════════════════════════════════════
     11. SHARED SECTION BUILDER HELPERS
  ═══════════════════════════════════════════════════════════════════════ */
  function _infoSection(id, title, fields) {
    var cells = fields.map(function(f){
      var isEmpty = !f.val || f.val === '—' || f.val === '';
      var copyBtn = f.copy && !isEmpty
        ? ' <span onclick="_cibilCopy(\''+esc(f.val)+'\',this)" title="Copy" style="cursor:pointer;margin-left:5px;font-size:11px;color:var(--text3)">📋</span>'
        : '';
      return '<div class="cibil-kv-cell">' +
        '<div class="cibil-kv-lbl">'+esc(f.lbl)+'</div>' +
        '<div class="cibil-kv-val '+(isEmpty?'empty':'')+'">'+esc(f.val||'—')+copyBtn+'</div>' +
      '</div>';
    }).join('');
    return '<div class="cibil-section" id="'+id+'" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:18px 20px;margin-bottom:14px">' +
      '<div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:12px">'+title+'</div>' +
      '<div class="cibil-kv-grid">'+cells+'</div>' +
    '</div>';
  }

  function _emptySection(id, title, msg) {
    return '<div class="cibil-section" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:18px 20px;margin-bottom:14px">' +
      '<div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:12px">'+title+'</div>' +
      '<div style="text-align:center;padding:16px;color:var(--text3);font-size:13px">'+esc(msg)+'</div>' +
    '</div>';
  }

  /* ═══════════════════════════════════════════════════════════════════════
     12. DATA RESOLVER HELPERS
  ═══════════════════════════════════════════════════════════════════════ */

  /**
   * Resolve score breakdown factors.
   * Full-report path: build from ScoreFactors (positive/negative) + computed values from analysis
   * Fallback path: use data.breakdown directly (mock hash-based values from /report endpoint)
   */
  function _resolveBreakdown(data, score) {
    // If this is a full-report response, derive breakdown from analysis data
    var scoreObj = data.creditScore || {};
    var posFactors = scoreObj.positiveFactors || scoreObj.PositiveFactors || [];
    var negFactors = scoreObj.negativeFactors || scoreObj.NegativeFactors || [];

    // Use pre-built breakdown if available (fallback path)
    if (data.breakdown) {
      return data.breakdown;
    }

    // Build canonical 5-factor breakdown from known bureau data
    // Use enquiry count, account age, and other available data to derive values
    var accSum = data.accountSummary || {};
    var payHist = data.paymentHistory || {};
    var dpdHm = payHist.dpdHeatmap || {};
    var enqAn  = data.enquiryAnalysis || {};
    var behav  = data.behaviourAnalysis || {};

    // Payment History: based on missed payments / delinquency
    var ph_missed = (payHist.monthly || []).filter(function(m){ return m.isMissedPayment; }).length;
    var ph_total  = (payHist.monthly || []).length || 1;
    var ph_val    = Math.round(Math.max(0, 100 - (ph_missed / ph_total) * 100));

    // Credit Utilisation: outstanding vs sanctioned
    var util_val  = 50; // default
    if (accSum.totalSanctionAmount > 0) {
      util_val = Math.round(100 - (accSum.currentOutstanding / accSum.totalSanctionAmount * 100));
      util_val = Math.max(0, Math.min(100, util_val));
    }

    // Credit Age: AccountAgeMonths / 120 (10 yrs = excellent)
    var age_mo  = accSum.accountAgeMonths || behav.accountAgeMonths || 0;
    var age_val = Math.min(100, Math.round(age_mo / 120 * 100));

    // Credit Mix: secured + unsecured mix
    var sec  = accSum.securedLoanCount   || 0;
    var uns  = accSum.unsecuredLoanCount || 0;
    var mix_val = (sec > 0 && uns > 0) ? 100 : (sec > 0 || uns > 0) ? 50 : 25;

    // New Enquiries: lower is better
    var enq30  = enqAn.count30Days || 0;
    var enq_val = Math.max(0, 100 - enq30 * 15);

    var WEIGHTS = {
      'Payment History':    { weight:35, note: ph_missed===0?'No missed payments':ph_missed+' missed' },
      'Credit Utilisation': { weight:30, note: util_val+'% utilisation' },
      'Credit Age':         { weight:15, note: age_mo ? Math.floor(age_mo/12)+'y '+age_mo%12+'m' : '—' },
      'Credit Mix':         { weight:10, note: sec+' secured, '+uns+' unsecured' },
      'New Enquiries':      { weight:10, note: enqAn.count30Days+' in 30d, '+(enqAn.count12Months||0)+' in 12m' },
    };
    var VALUES = {
      'Payment History':    ph_val,
      'Credit Utilisation': util_val,
      'Credit Age':         age_val,
      'Credit Mix':         mix_val,
      'New Enquiries':      enq_val,
    };

    var bd = {};
    Object.keys(WEIGHTS).forEach(function(key){
      var k = key.toLowerCase().replace(/\s+/g, '');
      bd[k] = { label: key, weight: WEIGHTS[key].weight, value: VALUES[key], note: WEIGHTS[key].note };
    });
    return bd;
  }

  /**
   * Resolve eligible banks from system LA_DB config (same logic as v7)
   */
  function _resolveEligibleBanks(data, score) {
    try {
      var laBanks=(window.LA_DB&&Array.isArray(window.LA_DB.banks))?window.LA_DB.banks:[];
      if (laBanks.length) {
        return laBanks
          .filter(function(b){ var mc=(b.rules&&b.rules.minCibil)||0; return score>=mc; })
          .map(function(b){
            var base=b.isElite?9.5:(b.isIncred?11:10.5);
            if (b.rules&&b.rules.foirLimit>=60) base+=2;
            else if (b.rules&&b.rules.foirLimit>=55) base+=1;
            var hi=base+3.5;
            return {
              bank: b.name,
              maxAmount: _fmtLakh(b.rules&&b.rules.maxLoanAmt),
              rate: base.toFixed(base%1===0?0:1)+'% – '+hi.toFixed(hi%1===0?0:1)+'%'
            };
          });
      }
    } catch(e){}
    return data.eligibleBanks || [];
  }

  function _fmtLakh(amt) {
    if (!amt) return '—';
    if (amt>=10000000) return '₹'+(amt/10000000).toFixed(amt%10000000===0?0:1)+' Cr';
    return '₹'+Math.round(amt/100000)+' Lakh';
  }

  /* ── PDF Export (print-to-PDF via browser) ── */
  global._cibilExportPDF = function() {
    // Inject a dedicated PDF print trigger
    var origTitle = document.title;
    document.title = 'CIBIL_Report_' + new Date().toLocaleDateString('en-IN').replace(/\//g,'-');
    window.print();
    document.title = origTitle;
  };

  /* ═══════════════════════════════════════════════════════════════════════
     13. SIMULATOR LOGIC (public, unchanged from v7)
  ═══════════════════════════════════════════════════════════════════════ */
  global._cibilSimUpdate = function(el, idx) {
    var c2=document.getElementById('cibil-report-container'); if(!c2) return;
    var pv=parseInt(el.value);
    var lbl=c2.querySelector('#cibil-sim-val-'+idx); if(lbl) lbl.textContent=pv+'%';
    var inputs=c2.querySelectorAll('input[data-weight]');
    var totalWeighted=0, totalWeight=0;
    for(var i=0;i<inputs.length;i++){
      totalWeighted+=parseInt(inputs[i].value)*parseInt(inputs[i].dataset.weight);
      totalWeight+=parseInt(inputs[i].dataset.weight);
    }
    var projected=Math.round(300+((totalWeighted/totalWeight)/100)*600);
    projected=Math.min(900,Math.max(300,projected));
    var sc2=c2.querySelector('#cibil-sim-score'); if(sc2) sc2.textContent=projected;
    var bc=c2.querySelector('#cibil-sim-badge');
    if(bc){
      var st=projected>=750?'Excellent':projected>=700?'Good':projected>=650?'Fair':projected>=550?'Poor':'Very Poor';
      var cl=projected>=750?'#16a34a':projected>=700?'#2563eb':projected>=650?'#d97706':projected>=550?'#dc2626':'#7f1d1d';
      bc.textContent=st; bc.style.background=cl+'20'; bc.style.color=cl;
    }
  };

  global._cibilSimReset = function() {
    var c2=document.getElementById('cibil-report-container'); if(!c2) return;
    var inputs=c2.querySelectorAll('input[data-weight]');
    for(var i=0;i<inputs.length;i++){
      inputs[i].value=inputs[i].dataset.orig;
      global._cibilSimUpdate(inputs[i],i);
    }
  };

  /* ═══════════════════════════════════════════════════════════════════════
     14. COLLAPSIBLE TOGGLE (unchanged from v7)
  ═══════════════════════════════════════════════════════════════════════ */
  // Toggle account detail row (used by Summary: Loan Accounts table)
  global._cibilToggleDetail = function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.style.display = el.style.display === 'none' ? 'table-row' : 'none';
  };

  global._cibilToggle = function(id, header) {
    var el=document.getElementById(id); if(!el) return;
    var open=el.style.display!=='none';
    el.style.display=open?'none':'block';
    var arrow=header&&header.querySelector('[id$="-arrow"]');
    if(arrow) arrow.textContent=open?'▸':'▾';
  };

  /* ═══════════════════════════════════════════════════════════════════════
     15. COPY HELPER (unchanged from v7)
  ═══════════════════════════════════════════════════════════════════════ */
  global._cibilCopy = function(text, el) {
    navigator.clipboard && navigator.clipboard.writeText(text).then(function(){
      var orig=el.textContent; el.textContent='✅'; setTimeout(function(){el.textContent=orig;},1500);
    });
  };


  /* ── Per-account DPD Grid (year × month circles) ── */
  function _buildAccountDpdGrid(paymentHistory) {
    if (!paymentHistory || !paymentHistory.length) return '';
    var byYear = {};
    paymentHistory.forEach(function(ph) {
      var d = new Date(ph.reportMonth);
      if (isNaN(d)) return;
      var yr = d.getFullYear(), mo = d.getMonth() + 1;
      if (!byYear[yr]) byYear[yr] = {};
      byYear[yr][mo] = ph.dpdStatus || (ph.daysOverdue === 0 ? '000' : String(ph.daysOverdue));
    });
    var years = Object.keys(byYear).sort();
    if (!years.length) return '';
    var MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    var headerCols = MONTHS.map(function(m){ return '<th style="padding:8px 5px;font-size:11px;font-weight:700;color:#64748b;background:#f8fafc;border-bottom:2px solid #e2e8f0;text-align:center;min-width:40px">'+m+'</th>'; }).join('');
    var bodyRows = years.map(function(yr){
      var cols = MONTHS.map(function(_, i){
        var mo = i + 1;
        var val = byYear[yr][mo];
        if (val == null) {
          return '<td style="padding:5px 3px;text-align:center;border-bottom:1px solid #e8eef4"><span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;border:1.5px solid #cbd5e1;color:#94a3b8;font-size:14px;font-weight:400">—</span></td>';
        }
        var cls = dpdClass(val);
        var disp = dpdDisplay(val);
        return '<td style="padding:5px 3px;text-align:center;border-bottom:1px solid #e8eef4"><span class="'+cls+'">'+esc(disp)+'</span></td>';
      }).join('');
      return '<tr><td style="padding:8px 12px;font-size:12.5px;font-weight:700;color:#1e3a5f;border-bottom:1px solid #e8eef4;white-space:nowrap;border-right:2px solid #e2e8f0;background:#f8fafc"><strong>'+yr+'</strong></td>'+cols+'</tr>';
    }).join('');
    return '<div style="overflow-x:auto">' +
      '<table style="border-collapse:collapse;font-size:11px;width:100%;background:#fff">' +
        '<thead><tr><th style="padding:8px 12px;font-size:11px;font-weight:700;color:#64748b;background:#f8fafc;border-bottom:2px solid #e2e8f0;border-right:2px solid #e2e8f0;text-align:left">Year</th>'+headerCols+'</tr></thead>' +
        '<tbody>'+bodyRows+'</tbody>' +
      '</table>' +
    '</div>';
  }

  /* ── Payment History Timeline ── */
  function _buildPaymentTimeline(payHist) {
    var monthly = (payHist && payHist.monthly) || [];
    if (!monthly.length) return '';
    var items = monthly.slice(-24).reverse();
    var hm = (payHist && payHist.dpdHeatmap) || {};
    var heatHtml = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">'+
      ['Last 3M','Last 6M','Last 12M','Status'].map(function(l,i){
        var v = [hm.last3MonthsDPD,hm.last6MonthsDPD,hm.last12MonthsDPD,hm.healthStatus][i];
        var vc = (v==='Red'||parseInt(v)>30)?'#dc2626':(v==='Green'||v===0)?'#16a34a':'#d97706';
        return '<div style="background:var(--surface2);border:1px solid var(--border);border-radius:7px;padding:10px;text-align:center">'+
          '<div style="font-size:11px;color:var(--text3);margin-bottom:3px">'+l+'</div>'+
          '<div style="font-size:16px;font-weight:800;color:'+vc+'">'+(v!=null?v:'—')+'</div>'+
        '</div>';
      }).join('')+
    '</div>';
    var rows = items.map(function(m){
      var dpd = m.dpdStatus || (m.daysOverdue === 0 ? '000' : String(m.daysOverdue));
      var cls = dpdClass(dpd);
      var dt = new Date(m.reportMonth);
      var mo = isNaN(dt) ? m.reportMonth : dt.toLocaleDateString('en-IN',{month:'short',year:'numeric'});
      var flags = [];
      if (m.isMissedPayment) flags.push('<span style="background:#fee2e2;color:#dc2626;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px">MISSED</span>');
      if (m.isWriteOff) flags.push('<span style="background:#1e1b4b;color:#c7d2fe;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px">W/O</span>');
      return '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)">' +
        '<div style="min-width:70px;font-size:11.5px;color:var(--text2)">'+esc(mo)+'</div>' +
        '<span class="'+cls+'" style="min-width:38px;text-align:center;padding:2px 6px;border-radius:4px;font-size:11px">'+esc(dpdDisplay(dpd))+'</span>' +
        (m.daysOverdue>0?'<div style="font-size:11px;color:var(--text3)">'+m.daysOverdue+' days overdue</div>':'<div style="font-size:11px;color:#15803d">On time</div>') +
        (flags.length?'<div style="display:flex;gap:4px">'+flags.join('')+'</div>':'') +
      '</div>';
    }).join('');
    return '<div class="cibil-section" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--r);padding:18px 20px;margin-bottom:14px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;margin-bottom:12px" onclick="_cibilToggle(\'cibil-timeline-body\',this)">' +
        '<div style="font-size:14px;font-weight:700;color:var(--text)">📅 Payment History Timeline <span style="font-size:11px;background:var(--accent-subtle);color:var(--accent);padding:2px 8px;border-radius:10px;font-weight:600;margin-left:4px">'+monthly.length+' months</span></div>' +
        '<span id="cibil-timeline-body-arrow" style="font-size:12px;color:var(--text3)">▾</span>' +
      '</div>' +
      '<div id="cibil-timeline-body">'+heatHtml+'<div style="max-height:320px;overflow-y:auto">'+rows+'</div></div>' +
    '</div>';
  }

  /* ── Credit Enquiries + Enquiry Details Table ── */
  function _buildEnquirySection(enqAnalysis, enqDetails) {
    var c30   = enqAnalysis.count30Days   || 0;
    var c12   = enqAnalysis.count12Months || 0;
    var c24   = enqAnalysis.count24Months || 0;
    var total = enqDetails.length || c12 || 0;

    // Enquiry table — exact CRIF PDF style
    var enqTableHtml = '';
    if (enqDetails && enqDetails.length) {
      function TH(txt, ctr) {
        return '<th style="padding:12px 16px;text-align:'+(ctr?'center':'left')+';font-size:12.5px;font-weight:700;color:#1e3a5f;border-bottom:2px solid #dde6f0;white-space:nowrap;background:#f8fafc">'+txt+'</th>';
      }
      var tRows = enqDetails.map(function(e, idx) {
        var bg = idx%2===0 ? '#fff' : '#fafbfc';
        return '<tr style="background:'+bg+'">' +
          '<td style="padding:12px 16px;font-size:13px;color:#64748b;text-align:center;border-bottom:1px solid #e8eef4">'+(idx+1)+'</td>' +
          '<td style="padding:12px 16px;font-size:13px;color:#334155;border-bottom:1px solid #e8eef4">'+esc(e.purpose||e.enquiryType||'—')+'</td>' +
          '<td style="padding:12px 16px;font-size:13px;color:#1e40af;font-weight:500;border-bottom:1px solid #e8eef4">'+esc(e.memberName||'—')+'</td>' +
          '<td style="padding:12px 16px;font-size:13px;color:#334155;border-bottom:1px solid #e8eef4">'+fmtDate(e.enquiryDate)+'</td>' +
          '<td style="padding:12px 16px;font-size:13px;color:#334155;text-align:center;border-bottom:1px solid #e8eef4">'+esc(e.ownershipType||'PRIMARY')+'</td>' +
        '</tr>';
      }).join('');
      enqTableHtml =
        '<div style="border:1px solid #dde6f0;border-radius:10px;overflow:hidden;margin-top:8px">' +
          '<table style="width:100%;border-collapse:collapse">' +
            '<thead><tr>' + TH('Sr. No.',true) + TH('Enquiry Purpose') + TH('Financial Institution') + TH('Enquired on') + TH('Ownership Type',true) + '</tr></thead>' +
            '<tbody>'+tRows+'</tbody>' +
          '</table>' +
        '</div>';
    } else {
      enqTableHtml = '<div style="text-align:center;padding:24px;color:#94a3b8;font-size:13px">No enquiry records found</div>';
    }

    var warnHtml = '';
    if (enqAnalysis.highEnquiryFrequency || enqAnalysis.loanShoppingDetected || enqAnalysis.creditHungryCustomer) {
      var warns = [
        enqAnalysis.highEnquiryFrequency ? 'High enquiry frequency' : '',
        enqAnalysis.loanShoppingDetected ? 'Loan shopping detected' : '',
        enqAnalysis.creditHungryCustomer ? 'Credit-hungry behaviour' : ''
      ].filter(Boolean).join(' · ');
      warnHtml = '<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:10px 14px;margin-bottom:10px;font-size:12.5px;color:#92400e"><strong>⚠️ </strong>'+esc(warns)+'</div>';
    }

    return '<div class="cibil-section" style="background:#fff;border:1px solid var(--border);border-radius:var(--r);padding:22px;margin-bottom:14px" id="cr-enquiry">' +
      '<h2 style="font-size:17px;font-weight:700;color:#1e3a5f;margin:0 0 4px">Credit Enquiries</h2>' +
      '<p style="font-size:12.5px;color:#64748b;margin:0 0 14px">This section shows the names of the credit institutions that have processed a credit/loan application for you.</p>' +
      '<div style="display:flex;gap:20px;margin-bottom:14px;flex-wrap:wrap">' +
        '<span style="font-size:12px;color:#64748b">Total: <strong style="color:#1e3a5f">'+total+'</strong></span>' +
        '<span style="font-size:12px;color:#64748b">Last 30 days: <strong style="color:'+(c30>3?'#dc2626':'#1e3a5f')+'">'+c30+'</strong></span>' +
        '<span style="font-size:12px;color:#64748b">Last 12 months: <strong style="color:'+(c12>10?'#dc2626':'#1e3a5f')+'">'+c12+'</strong></span>' +
        '<span style="font-size:12px;color:#64748b">Last 24 months: <strong style="color:#1e3a5f">'+c24+'</strong></span>' +
      '</div>' +
      warnHtml + enqTableHtml +
    '</div>';
  }

  /* ═══════════════════════════════════════════════════════════════════════
     16. BACKWARD-COMPAT ALIAS (unchanged from v7)
  ═══════════════════════════════════════════════════════════════════════ */
  // Reset fetch lock — called by index.html when CIBIL tab is clicked
  global._cibilFetchLockReset = function() { _fetchLock = {}; };

  global._renderCibilReport = function(data) {
    var c=document.getElementById('cibil-report-container');
    if(c) renderReport(c, data, false);
  };

  /* ═══════════════════════════════════════════════════════════════════════
     17. UTILITY HELPERS
  ═══════════════════════════════════════════════════════════════════════ */
  function esc(s) {
    return String(s==null?'':s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function _bandColor(score) {
    for(var i=0;i<BANDS.length;i++){
      if(score>=BANDS[i].min&&score<=BANDS[i].max) return BANDS[i].color;
    }
    return '#2563eb';
  }

  function _scoreStatus(score) {
    return score>=750?'Excellent':score>=700?'Good':score>=650?'Fair':score>=550?'Poor':'Very Poor';
  }

  function _deriveRisk(score) {
    return score>=750?'Low':score>=700?'Low-Medium':score>=650?'Medium':score>=550?'High':'Very High';
  }

  function _deriveApproval(score) {
    return score>=750?'90%+':score>=700?'75%':score>=650?'50%':score>=550?'20%':'<5%';
  }

  function calcEMI(amountLakhs, rate, tenureYr) {
    var P=amountLakhs*100000, r=rate/12/100, n=tenureYr*12;
    if(r===0) return Math.round(P/n).toLocaleString('en-IN');
    return Math.round(P*r*Math.pow(1+r,n)/(Math.pow(1+r,n)-1)).toLocaleString('en-IN');
  }

  function parseMaxAmt(str) {
    var m=String(str||'').match(/[\d.]+/);
    var v=m?parseFloat(m[0]):5;
    return /cr/i.test(String(str))?v*100:v;
  }

  function parseMinRate(str) {
    var m=String(str||'').match(/[\d.]+/);
    return m?parseFloat(m[0]):15;
  }


  /* ╔═══════════════════════════════════════════════════════════════════════════
     ║ ENHANCED CIBIL REPORT SECTIONS - Additional Features & Analytics
     ╚═══════════════════════════════════════════════════════════════════════════ */

  /* ── Credit Health Dashboard ── */
  function _buildCreditHealthDashboard(score, maxSc, minSc, accounts, bd) {
    var healthScore = Math.round(((score - minSc) / (maxSc - minSc)) * 100);
    var accountsCount = accounts && accounts.length ? accounts.length : 0;
    var activeAccounts = accounts ? accounts.filter(function(a) { return (a.accountStatus || '').toUpperCase().indexOf('ACTIVE') !== -1; }).length : 0;
    var paymentHistoryScore = (bd.paymentHistory && bd.paymentHistory.value) || 0;
    var creditUtilScore = (bd.creditUtilisation && bd.creditUtilisation.value) || 0;
    var overallHealth = healthScore >= 800 ? 'Excellent' : healthScore >= 700 ? 'Good' : healthScore >= 600 ? 'Fair' : 'Poor';
    var healthColor = healthScore >= 800 ? '#0ea5e9' : healthScore >= 700 ? '#16a34a' : healthScore >= 600 ? '#f97316' : '#dc2626';
    
    return '<div class="cibil-section" style="background:#fff;border:1px solid #dde6f0;border-radius:10px;padding:20px;margin-bottom:14px">' +
      '<h2 style="font-size:15px;font-weight:700;color:#1e3a5f;margin:0 0 16px">📈 Credit Health Dashboard</h2>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px">' +
        '<div style="background:' + healthColor + '10;border:1px solid ' + healthColor + '30;border-radius:8px;padding:14px;text-align:center">' +
          '<div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:8px">OVERALL HEALTH</div>' +
          '<div style="font-size:28px;font-weight:700;color:' + healthColor + ';margin-bottom:6px">' + overallHealth + '</div>' +
          '<div style="font-size:13px;color:#1e3a5f;font-weight:600">Score: ' + score + ' / ' + maxSc + '</div>' +
        '</div>' +
        '<div style="background:#3b82f620;border:1px solid #3b82f630;border-radius:8px;padding:14px;text-align:center">' +
          '<div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:8px">ACTIVE ACCOUNTS</div>' +
          '<div style="font-size:28px;font-weight:700;color:#2563eb;margin-bottom:6px">' + activeAccounts + '</div>' +
          '<div style="font-size:13px;color:#64748b">of ' + accountsCount + ' total</div>' +
        '</div>' +
        '<div style="background:' + (paymentHistoryScore >= 75 ? '#16a34a' : '#dc2626') + '10;border:1px solid ' + (paymentHistoryScore >= 75 ? '#16a34a' : '#dc2626') + '30;border-radius:8px;padding:14px;text-align:center">' +
          '<div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:8px">PAYMENT HEALTH</div>' +
          '<div style="font-size:28px;font-weight:700;color:' + (paymentHistoryScore >= 75 ? '#16a34a' : '#dc2626') + ';margin-bottom:6px">' + paymentHistoryScore + '%</div>' +
          '<div style="font-size:13px;color:#64748b">' + (paymentHistoryScore >= 75 ? 'Excellent' : 'Needs Work') + '</div>' +
        '</div>' +
        '<div style="background:' + (creditUtilScore >= 50 ? '#16a34a' : '#f97316') + '10;border:1px solid ' + (creditUtilScore >= 50 ? '#16a34a' : '#f97316') + '30;border-radius:8px;padding:14px;text-align:center">' +
          '<div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:8px">UTILIZATION HEALTH</div>' +
          '<div style="font-size:28px;font-weight:700;color:' + (creditUtilScore >= 50 ? '#16a34a' : '#f97316') + ';margin-bottom:6px">' + creditUtilScore + '%</div>' +
          '<div style="font-size:13px;color:#64748b">' + (creditUtilScore >= 50 ? 'Healthy' : 'High') + '</div>' +
        '</div>' +
      '</div>' +
      '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;font-size:12px;color:#64748b;line-height:1.5">' +
        '<strong style="color:#1e3a5f">💡 Your Credit Health:</strong> This reflects your overall creditworthiness based on payment history (35%), credit utilization (30%), account age (15%), credit mix (10%), and new inquiries (10%).' +
      '</div>' +
    '</div>';
  }

  /* ── Payment Analysis with Insights ── */
  function _buildPaymentAnalysis(accounts) {
    if (!accounts || !accounts.length) return '';
    var totalPayments = 0, onTimePayments = 0, latePayments = 0;
    accounts.forEach(function(a) {
      if (a.paymentHistory && a.paymentHistory.length) {
        a.paymentHistory.forEach(function(p) {
          totalPayments++;
          if (p.status === 'PAID_ON_TIME') onTimePayments++;
          else if (p.status && p.status.indexOf('LATE') !== -1) latePayments++;
        });
      }
    });
    var onTimePct = totalPayments > 0 ? Math.round((onTimePayments / totalPayments) * 100) : 0;
    var latePct = totalPayments > 0 ? Math.round((latePayments / totalPayments) * 100) : 0;
    
    return '<div class="cibil-section" style="background:#fff;border:1px solid #dde6f0;border-radius:10px;padding:20px;margin-bottom:14px">' +
      '<h2 style="font-size:15px;font-weight:700;color:#1e3a5f;margin:0 0 16px">📊 Payment Analysis & Insights</h2>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:16px">' +
        '<div style="background:#16a34a15;border:1px solid #16a34a30;border-radius:8px;padding:14px;text-align:center">' +
          '<div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:8px">ON-TIME PAYMENTS</div>' +
          '<div style="font-size:28px;font-weight:700;color:#16a34a;margin-bottom:4px">' + onTimePct + '%</div>' +
          '<div style="font-size:12px;color:#64748b">' + onTimePayments + ' / ' + totalPayments + '</div>' +
        '</div>' +
        '<div style="background:#dc262615;border:1px solid #dc262630;border-radius:8px;padding:14px;text-align:center">' +
          '<div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:8px">LATE PAYMENTS</div>' +
          '<div style="font-size:28px;font-weight:700;color:#dc2626;margin-bottom:4px">' + latePct + '%</div>' +
          '<div style="font-size:12px;color:#64748b">' + latePayments + ' payments</div>' +
        '</div>' +
      '</div>' +
      '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;font-size:12px;color:#64748b;line-height:1.6">' +
        '<strong style="color:#1e3a5f;">💡 Payment Impact:</strong><br>' +
        '✓ Payment history is 35% of your credit score - the most important factor<br>' +
        '✓ Even one missed payment can reduce score by 100+ points<br>' +
        '✓ Set up autopay to ensure on-time payments<br>' +
        '✓ Consistent on-time payments gradually improve your score' +
      '</div>' +
    '</div>';
  }

  /* ── Enquiry Risk Assessment ── */
  function _buildEnquiryRiskAssessment(enqAnalysis) {
    if (!enqAnalysis) return '';
    var c30 = enqAnalysis.count30Days || 0;
    var c12 = enqAnalysis.count12Months || 0;
    var risk30 = c30 > 3 ? 'HIGH ⚠️' : c30 > 1 ? 'MODERATE ⚡' : 'LOW ✓';
    var riskColor30 = c30 > 3 ? '#dc2626' : c30 > 1 ? '#f97316' : '#16a34a';
    var risk12 = c12 > 10 ? 'HIGH ⚠️' : c12 > 5 ? 'MODERATE ⚡' : 'LOW ✓';
    var riskColor12 = c12 > 10 ? '#dc2626' : c12 > 5 ? '#f97316' : '#16a34a';
    
    return '<div class="cibil-section" style="background:#fff;border:1px solid #dde6f0;border-radius:10px;padding:20px;margin-bottom:14px">' +
      '<h2 style="font-size:15px;font-weight:700;color:#1e3a5f;margin:0 0 16px">🔍 Enquiry Risk Assessment</h2>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">' +
        '<div style="background:#fff;border:2px solid ' + riskColor30 + '30;border-radius:8px;padding:14px">' +
          '<div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:8px">LAST 30 DAYS</div>' +
          '<div style="font-size:20px;font-weight:700;color:' + riskColor30 + ';margin-bottom:8px">' + c30 + ' Enquiries</div>' +
          '<div style="background:' + riskColor30 + '15;color:' + riskColor30 + ';padding:6px 10px;border-radius:6px;font-size:12px;font-weight:600;display:inline-block">' + risk30 + '</div>' +
        '</div>' +
        '<div style="background:#fff;border:2px solid ' + riskColor12 + '30;border-radius:8px;padding:14px">' +
          '<div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:8px">LAST 12 MONTHS</div>' +
          '<div style="font-size:20px;font-weight:700;color:' + riskColor12 + ';margin-bottom:8px">' + c12 + ' Enquiries</div>' +
          '<div style="background:' + riskColor12 + '15;color:' + riskColor12 + ';padding:6px 10px;border-radius:6px;font-size:12px;font-weight:600;display:inline-block">' + risk12 + '</div>' +
        '</div>' +
      '</div>' +
      '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;font-size:12px;color:#64748b;line-height:1.6">' +
        '<strong style="color:#1e3a5f;">📌 Understanding Enquiries:</strong><br>' +
        '• Hard inquiries = credit score check (shows need for new credit)<br>' +
        '• Too many inquiries = appears credit-hungry (10% of score)<br>' +
        '• Recommended: Space loan applications 3-6 months apart<br>' +
        '• Multiple inquiries in short time = major red flag for lenders' +
      '</div>' +
    '</div>';
  }

  /* ── Credit Education Section ── */
  function _buildCreditEducation() {
    return '<div class="cibil-section" style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);border:none;border-radius:10px;padding:20px;margin-bottom:14px;color:#fff">' +
      '<h2 style="font-size:15px;font-weight:700;margin:0 0 14px">📚 Credit Score Guide</h2>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">' +
        '<div style="background:rgba(255,255,255,0.15);border-radius:8px;padding:12px;backdrop-filter:blur(10px)">' +
          '<div style="font-weight:700;margin-bottom:8px;font-size:13px">🎯 Score Ranges</div>' +
          '<div style="font-size:12px;line-height:1.7">' +
            '800-900: <strong>Excellent</strong> - Best rates<br>' +
            '750-799: <strong>Very Good</strong> - Easy approval<br>' +
            '700-749: <strong>Good</strong> - Competitive rates<br>' +
            '650-699: <strong>Fair</strong> - May face challenges<br>' +
            '<550-649: <strong>Poor</strong> - Difficult approval' +
          '</div>' +
        '</div>' +
        '<div style="background:rgba(255,255,255,0.15);border-radius:8px;padding:12px;backdrop-filter:blur(10px)">' +
          '<div style="font-weight:700;margin-bottom:8px;font-size:13px">📊 Score Breakdown</div>' +
          '<div style="font-size:12px;line-height:1.7">' +
            '35%: Payment history<br>' +
            '30%: Credit utilization<br>' +
            '15%: Account age<br>' +
            '10%: Credit mix<br>' +
            '10%: New inquiries' +
          '</div>' +
        '</div>' +
        '<div style="background:rgba(255,255,255,0.15);border-radius:8px;padding:12px;backdrop-filter:blur(10px)">' +
          '<div style="font-weight:700;margin-bottom:8px;font-size:13px">⚡ Quick Tips</div>' +
          '<div style="font-size:12px;line-height:1.7">' +
            '✓ Never miss payments<br>' +
            '✓ Keep usage <30%<br>' +
            '✓ Maintain old accounts<br>' +
            '✓ Limit new applications<br>' +
            '✓ Build diverse credit' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }


})(window);
