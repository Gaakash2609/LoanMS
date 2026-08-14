/**
 * LoanMS API Bridge v6
 * Connects EFIN frontend → ASP.NET Core 8 API
 * All major workflows now backed by real API calls with localStorage fallback
 */
(function () {
  'use strict';
// ── Safe localStorage helpers (private to this module) ──
var _lsGet = function(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } };
var _lsSet = function(k,v){ try{ localStorage.setItem(k,v); }catch(e){} };
var _lsRemove = function(k){ try{ localStorage.removeItem(k); }catch(e){} };
;

  var BASE       = '/api';
  var LS_AUTH    = 'efin_auth';  // React authStore uses 'efin_auth' key
  var LS_SESSION = 'efin_session'; // Legacy display-only cache

  var ROLE_MAP   = {
    Admin: 'admin', Manager: 'manager', Sales: 'sales_executive', Dsa: 'dsa_user',
    Partner: 'partner', LoginTeam: 'login_team', TeamLeader: 'team_leader',
    Accounts: 'accounts', LocationHead: 'location_head',
    OperationManager: 'operation_manager', ProductTeam: 'product_team'
  };
  var STATUS_MAP = { Draft:'wip', Submitted:'login', UnderReview:'underwriting', Approved:'approved', Rejected:'rejected', Disbursed:'disbursed', Closed:'disbursed', Hold:'hold' };
  var STATUS_REV = { wip:'Draft', login:'Submitted', underwriting:'UnderReview', approved:'Approved', rejected:'Rejected', disbursed:'Disbursed', hold:'Hold' };
  var LTYPE_MAP  = { Personal:'personal_loan', Home:'home_loan', Business:'business_loan', Education:'education_loan', Car:'new_car_loan' };
  var MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function _getAuthState() {
    var authStr = _lsGet(LS_AUTH);
    if (!authStr) return {};
    try {
      var parsed = JSON.parse(authStr);
      // Handle Zustand persist middleware format { state: {...}, version: 0 }
      return parsed.state || parsed; // Fall back to flat structure for compatibility
    } catch (e) { 
      return {}; 
    }
  }

  // Backfill loanms_token from the real auth state (efin_auth) on every load.
  // Covers sessions that were created before loanms_token syncing existed,
  // and guards against the two keys ever silently drifting apart again.
  (function _syncLegacyTokenKey() {
    try {
      var at = _getAuthState().accessToken;
      if (at && _lsGet('loanms_token') !== at) _lsSet('loanms_token', at);
    } catch (e) {}
  })();

  function _token()   { return _getAuthState().accessToken; }
  function _refresh() { return _getAuthState().refreshToken; }
  // Also removes efin_session (the display-only cache read by boot.js/efin-app.js
  // to paint the topbar name/avatar on restore). Previously this only cleared the
  // real auth keys (LS_TOKEN/LS_REFRESH/LS_USER) and left efin_session behind.
  // session-preload.js hides the login screen based on efin_session alone, so a
  // token wipe without also clearing efin_session left the dashboard shell
  // visible but never populated — the user's name/avatar reverted to the raw
  // static HTML placeholders ("User Name" / "AG"), which looked like the account
  // had silently switched to a different, blank one. Clearing efin_session here
  // too means that state can no longer persist across a refresh.
  function _clearAuth() {
    _lsRemove(LS_AUTH);
    _lsRemove(LS_SESSION);
    _lsRemove('loanms_token');
  }

  /* ── Core API request with auto token refresh ──
     apiReqRaw() is the SINGLE centralized implementation of the auth flow
     (attach Bearer token → send → on 401 refresh once → retry once). It
     returns the raw Response so callers needing something other than JSON
     (e.g. Expert Export's CSV/blob download) can share this exact same
     auth/refresh/retry path instead of hand-rolling their own with a plain
     fetch(). apiReq() is kept as a thin JSON-parsing wrapper over it so all
     existing callers keep working unchanged. There is intentionally only
     ONE refresh implementation — nothing here starts a second, independent
     refresh cycle.

     _pendingRefresh caches the in-flight /auth/refresh promise so that a
     burst of concurrent requests (e.g. the _syncLoans/_syncUsers/_syncTeams/
     _syncLocations/_syncTasks/_syncTickets/_syncDsaPartners calls fired
     together on every session restore) that all hit a 401 at once share ONE
     refresh call instead of each independently POSTing /auth/refresh with the
     same refresh token. The backend rotates the refresh token on every
     successful refresh (invalidating the old one), so without this dedupe,
     only the first of those concurrent refresh calls could ever succeed —
     every other one would race in with the now-invalidated old refresh token,
     get rejected, and call _clearAuth(), wiping out the fresh token the
     winner had just obtained a moment earlier. */
  var _pendingRefresh = null;
  function _doRefresh(rt) {
    if (_pendingRefresh) return _pendingRefresh;
    _pendingRefresh = fetch(BASE + '/auth/refresh', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ refreshToken: rt }) })
      .then(function(r2){ return r2.json(); })
      .then(function(d2) {
        if (d2 && d2.success) {
          // Update auth state in Zustand persist middleware format
          // Preserve existing state except hasHydrated (managed by Zustand independently)
          var storedStr = _lsGet(LS_AUTH);
          var zustandardAuthState = { state: {}, version: 0 };
          try { 
            var existing = storedStr ? JSON.parse(storedStr) : {};
            zustandardAuthState.state = existing.state || {};
            // Explicitly exclude hasHydrated from persistence
            delete zustandardAuthState.state.hasHydrated;
            zustandardAuthState.version = existing.version !== undefined ? existing.version : 0;
          } catch (e) {}
          
          zustandardAuthState.state.accessToken = d2.data.accessToken;
          zustandardAuthState.state.refreshToken = d2.data.refreshToken;
          _lsSet(LS_AUTH, JSON.stringify(zustandardAuthState));
          // Same loanms_token sync as doLogin — keep it current across refreshes.
          _lsSet('loanms_token', d2.data.accessToken);
          return d2.data.accessToken;
        }
        _clearAuth();
        return null;
      })
      .catch(function(){ _clearAuth(); return null; })
      .finally(function(){ _pendingRefresh = null; });
    return _pendingRefresh;
  }

  function apiReqRaw(method, path, body) {
    var isForm = (typeof FormData !== 'undefined') && (body instanceof FormData);
    var headers = isForm ? {} : { 'Content-Type': 'application/json' };
    var tok = _token();
    if (tok) headers['Authorization'] = 'Bearer ' + tok;
    var fetchBody = isForm ? body : (body ? JSON.stringify(body) : undefined);

    return fetch(BASE + path, { method: method, headers: headers, body: fetchBody })
      .then(function(res) {
        if (res.status !== 401) return res;
        var rt = _refresh();
        if (!rt) { _clearAuth(); return res; } // no refresh token — surface the 401 as-is, no loop
        return _doRefresh(rt).then(function(freshToken) {
          if (!freshToken) return res; // refresh rejected/failed — surface the original 401, no loop
          headers['Authorization'] = 'Bearer ' + freshToken;
          // Exactly one retry with the fresh token. Whatever this returns
          // (even another 401) is handed back as-is — we never recurse
          // back into the refresh branch again, so a bad/expired refresh
          // token can never cause a repeated request loop.
          return fetch(BASE + path, { method: method, headers: headers, body: fetchBody });
        });
      });
  }

  function apiReq(method, path, body) {
    return apiReqRaw(method, path, body)
      .then(function(res){ return res.json(); })
      .catch(function(e){ console.warn('[Bridge] API error:', path, e); return null; });
  }

  function _fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return d.getDate() + ' ' + MO[d.getMonth()] + ' ' + d.getFullYear();
  }

  function _loanToApp(loan) {
    var c = loan.customer || {};
    var names = (c.fullName || '').split(' ');
    var status = STATUS_MAP[loan.status] || 'wip';
    var loanType = LTYPE_MAP[loan.loanType] || 'personal_loan';
    var isDisbursed = status === 'disbursed';
    var isApproved = isDisbursed || status === 'approved';
    var tracking = (loan.statusHistory || []).map(function(h,i){
      return { id:i+1, name:'EFIN — '+(h.toStatus||h.fromStatus||'Update'), current_stage:'Admin',
               current_user:h.changedBy||'System', status:'Complete', comment:h.comment||'', sub_note:' ', date:_fmtDate(h.changedAt) };
    });
    return {
      id: loan.loanNumber || ('EFIN' + String(loan.id).padStart(6,'0')), _apiId:loan.id, loanNumber:loan.loanNumber,
      _customerApiId: c.id,
      name:c.fullName||'—', fname:(names[0]||'').toUpperCase(), lname:(names.slice(1).join(' ')||'').toUpperCase(),
      mobile:c.phone||'', email:c.email||'',
      pan:c.panNumber?'XXXXX'+c.panNumber.slice(-4)+'X':'XXXXX0000X',
      // Productivity audit (P1) — bureau risk grade, already computed and
      // persisted server-side (LoanDto.RiskGrade → BureauReport.RiskGrade),
      // surfaced here purely for display/triage on the Applications table.
      riskGrade: loan.riskGrade || null,
      aadhar:c.aadhaarNumber||'000000000000', dob:c.dateOfBirth?c.dateOfBirth.slice(0,10):'',
      gender:'M', cibil:c.cibilScore||700, city:c.city||'', state:c.state||'',
      street1:c.address||'', street2:'', zip:c.pinCode||'',
      pStreet1:c.address||'', pStreet2:'', pCity:c.city||'', pZip:c.pinCode||'', pState:c.state||'',
      homeType:'OWNED_SELF_SPOUSE',
      empType:c.employmentType==='Self-Employed'?'SELFEMP':'SALARIED',
      compName:c.companyName||'', compType:'plcc', salary:Number(c.monthlyIncome||0), desig:'executive',
      officeEmail:'', officeAddr:'',
      loanType:loanType, amount:Number(loan.requestedAmount||0), loanRate:Number(loan.interestRate||12),
      tenure:String(loan.tenureMonths||24), purpose:(loan.purpose||'personal_use').toLowerCase().replace(/\s+/g,'_'),
      bank:'InCred', status:status,
      sales:loan.createdBy?loan.createdBy.fullName:'System', rm:loan.assignedTo?loan.assignedTo.fullName:'',
      // BUGFIX (linked-users visibility check): loginUser was never mapped
      // here at all, even though the backend has correctly returned it
      // (LoanDto.LoginUser) since the AutoMapper fix earlier — every place
      // that reads app.loginUser (the "Login User" cell on the Team &
      // Assignment panel, claims detection, workload counting) was always
      // reading undefined regardless of what was actually assigned in the
      // database. location is added the same way — LoanDto now exposes it
      // (see MappingProfile.cs) so it round-trips correctly too.
      loginUser: loan.loginUser ? loan.loginUser.fullName : '',
      location: loan.locationName || '',
      // Sales Team / Ops Manager persistence fix — see updateSalesTeam()/
      // updateOpsManager() in efin-app.js for the write side.
      salesTeam: loan.salesTeamName || '',
      opsManagerId: loan.opsManager ? loan.opsManager.fullName : '',
      // Channel Overview display fix — same read-back gap as location: the
      // wizard already correctly saves DsaId/PartnerId on submit, this was
      // just never mapped back for display.
      channelDSA: loan.dsaName || '',
      channelPartner: loan.partnerName || '',
      // Same sync gap — LoanBankLine now round-trips through the backend
      // (see MappingProfile.cs's LoanBankLine→LoanBankLineDto map), just
      // needed reading into the frontend's own field-name convention here
      // (tempAppNo, not the DTO's TempApplicationNumber).
      bankLines: (loan.bankLines || []).map(function(l) {
        return {
          id: l.id,
          bankName: l.bankName || '',
          tempAppNo: l.tempApplicationNumber || '',
          applicationNumber: l.applicationNumber || '',
          approvedLoan: l.approvedLoan || 0,
          remarks: l.remarks || 'IN PROCESS'
        };
      }),
      // Sanction/Approval Details — see approvalFieldSave() in efin-app.js
      // for the write side.
      sanctionStamp: loan.sanctionDetail ? (loan.sanctionDetail.stampDuty || '') : '',
      sanctionGST: loan.sanctionDetail ? loan.sanctionDetail.gst : undefined,
      sanctionInsurance: loan.sanctionDetail ? loan.sanctionDetail.insurance : undefined,
      sanctionPFPct: loan.sanctionDetail ? loan.sanctionDetail.pfPercent : undefined,
      sanctionInsInBundled: loan.sanctionDetail ? !!loan.sanctionDetail.insuranceInBundled : false,
      sanctionPFInBundled: loan.sanctionDetail ? !!loan.sanctionDetail.pfInBundled : false,
      sanctionBundled: loan.sanctionDetail ? !!loan.sanctionDetail.isBundled : false,
      sanctionBT: loan.sanctionDetail ? !!loan.sanctionDetail.isBt : false,
      sanctionFlatRate: loan.sanctionDetail ? loan.sanctionDetail.flatRate : undefined,
      sanctionEMIDate: loan.sanctionDetail ? loan.sanctionDetail.emiDate : undefined,
      // Product-specific fields (Insurance/Property/Vehicle/Education) —
      // parse the JSON blob back into the individual flat fields the rest
      // of the app already expects (app.insXxx/propXxx/carXxx/eduXxx).
      ...(function() {
        if (!loan.productDataJson) return {};
        try { return JSON.parse(loan.productDataJson) || {}; } catch (e) { return {}; }
      })(),
      date:_fmtDate(loan.createdAt), source:'Direct', leadsrc:'reference', channel:'direct',
      r1name:'', r1no:'', r1rel:'', r2name:'', r2no:'', r2rel:'', incred_app_id:'', incred_offer:'',
      document_checked:isApproved, incom_check:isApproved, bank_check:isDisbursed, ecs_return:isDisbursed, final_report:isDisbursed,
      tracking:tracking, _tempAppNo:'APP-'+loan.loanNumber
    };
  }

  function _refreshUI() {
    var fns = ['applySession','updateGreeting','renderPipeline','renderChart','renderLoanTypeChart',
               'updateDashboardStats','renderActivity','renderTable','renderBanksTable',
               'renderIncredPage','updateNotifBadge','updateTasksNavBadge'];
    fns.forEach(function(fn){
      if (typeof window[fn]==='function') { try { window[fn](); } catch(e){ console.warn('[Bridge] '+fn+' error:',e); } }
    });
  }

  /* ══════════════════════════════════════════════════════════
     1. LOANS — Sync from API into APPLICATIONS array
  ══════════════════════════════════════════════════════════ */
  function _syncLoans() {
    // Single request with full details — eliminates N+1 (was 101 requests, now 1)
    return apiReq('GET', '/loans/bulk?pageSize=500').then(function(res) {
      if (!res || !res.success) return;
      var list = (res.data && res.data.items) ? res.data.items : [];
      if (!list.length) return;
      // For bulk, we already have list items — fetch full details for everything
      // the server returned (GetBulk already caps the payload size server-side
      // per role), so no loan silently drops out of the synced view.
      var recentIds = list.map(function(l){ return l.id; });
      return Promise.all(recentIds.map(function(id){
        return apiReq('GET', '/loans/' + id).then(function(r){ return r && r.success ? r.data : null; });
      })).then(function(detailed) {
        // Exclude Draft-status loans — those are wizard autosave drafts
        // (see _syncWizardDrafts below) and are represented there as their
        // own is_draft:true "Continue" row, not as a normal pipeline
        // entry. Without this filter every autosaved draft would appear
        // twice: once here (mapped to status 'wip' via STATUS_MAP, with no
        // Continue action) and once as the real draft row.
        var apiApps = detailed.filter(Boolean).filter(function(l){ return l.status !== 'Draft'; }).map(_loanToApp);
        // IMPORTANT: mutate window.APPLICATIONS IN PLACE (splice/push) — do
        // NOT reassign it (`window.APPLICATIONS = ...`). efin-app.js's
        // renderTable()/_applyRoleFilter() read the closure-scoped
        // `APPLICATIONS` variable, which was only ever pointed at this same
        // array object once (`window.APPLICATIONS = APPLICATIONS`). Handing
        // window.APPLICATIONS a brand-new array here would silently detach
        // it from that closure variable — the API-synced applications would
        // still exist on `window.APPLICATIONS` but never appear in the UI,
        // on this device or any other. Same class of bug as the
        // _pmCanManage payout fix: data present, but not reaching the
        // scope that actually renders it.
        if (typeof window.APPLICATIONS !== 'undefined' && Array.isArray(window.APPLICATIONS)) {
          var arr = window.APPLICATIONS;
          // Dedup by _apiId (the numeric DB id _loanToApp always sets) —
          // NOT by an 'API' id prefix. Loan ids are the real loan number
          // (e.g. "EFIN20261234567"), never 'API'-prefixed like the
          // users/teams/locations/tickets sync paths, so the old prefix
          // check could never match a single loan record. That meant this
          // filter silently did nothing and every _syncLoans() call (login,
          // after wizard submit, after status change, auto-refresh) just
          // appended a second/third/Nth copy of every already-loaded loan
          // instead of replacing it with the fresh copy — duplicate rows
          // that would only get worse as CRUD-triggered reloads are added.
          // Removing by _apiId is a full replace-by-truth for every record
          // the API just returned; any entry with no _apiId (a local-only
          // wizard draft that hasn't reached the server yet) is left alone.
          var freshApiIds = new Set(apiApps.map(function(a){ return a._apiId; }));
          for (var i = arr.length - 1; i >= 0; i--) {
            if (arr[i]._apiId && freshApiIds.has(arr[i]._apiId)) arr.splice(i, 1);
          }
          apiApps.forEach(function(a){ arr.push(a); });
          _refreshUI();
        }
      });
    }).catch(function(e){ console.warn('[Bridge] syncLoans:',e); });
  }

  /* ══════════════════════════════════════════════════════════
     2. USERS — Sync from API into twUsers array
  ══════════════════════════════════════════════════════════ */
  function _syncUsers() {
    return apiReq('GET', '/users').then(function(res) {
      // GET /api/users is Admin-only (403 for every other role). Previously
      // that 403 was silently swallowed by apiReq's catch, leaving twUsers
      // permanently empty for non-Admin logins — which is why the wizard's
      // Location -> Sales Person dropdown always showed "No Sales Person
      // found for this location" for anyone but Admin, even when Sales
      // Person users existed for that location. Fall back to the
      // non-Admin-safe /users/lookup endpoint (id/fullName/role/location
      // only) so every authenticated role gets a populated list.
      if (!res || !res.success || !res.data) return _syncUsersLookupFallback();
      var apiUsers = res.data.map(function(u) {
        var roleKey = ROLE_MAP[u.role] || 'sales_executive';
        var roleLabel = (typeof window.ROLES !== 'undefined' && window.ROLES[roleKey] && window.ROLES[roleKey].label) || u.role || roleKey;
        return {
          id: 'API' + u.id, _apiId: u.id,
          name: u.fullName, email: (u.email || '').toLowerCase(),
          role: roleLabel, roleKey: roleKey,
          mobile: u.phoneNumber || '',
          loc: u.locationName || '', st: u.salesTeam || '', ot: u.opTeam || '',
          locs: u.locationName ? [u.locationName] : [],
          salesTeams: u.salesTeam ? [u.salesTeam] : [],
          opTeams: u.opTeam ? [u.opTeam] : [],
          status: u.isActive ? 'active' : 'inactive',
          joinDate: _fmtDate(u.createdAt),
          // Real, permanent, server-generated Employee Code (MH-{ROLE}-
          // {LOCATION}-{RANDOM4}) — replaces the old, purely-local
          // 'USR-' + array-index display, which was never a real,
          // persistent identifier (see twUsers rendering below).
          uid: u.employeeCode || null
        };
      });
      if (typeof window.twUsers !== 'undefined' && Array.isArray(window.twUsers)) {
        var seededIds = new Set(window.twUsers.filter(function(u){ return !String(u.id).startsWith('API'); }).map(function(u){ return u.email; }));
        // Wholesale replace (was merge/push-only — a user deleted or
        // deactivated server-side via DELETE /api/users/{id}, or on another
        // device, never disappeared here because this only ever added/
        // updated, never removed). Any API-sourced row (has _apiId) whose id
        // no longer appears in the server's response is dropped; a
        // hardcoded seed user (no _apiId) is left alone. Matching rows are
        // updated in place (Object.assign) rather than replaced with a
        // fresh object, same reasoning as _syncTasks.
        var freshUserIds = new Set(apiUsers.map(function(u){ return u._apiId; }));
        for (var ui = window.twUsers.length - 1; ui >= 0; ui--) {
          var urow = window.twUsers[ui];
          if (urow._apiId && !freshUserIds.has(urow._apiId)) window.twUsers.splice(ui, 1);
        }
        apiUsers.forEach(function(au) {
          var existing = window.twUsers.findIndex(function(u){ return u.email === au.email; });
          if (existing >= 0) { window.twUsers[existing] = Object.assign(window.twUsers[existing], au); }
          else { window.twUsers.push(au); }
        });
        if (typeof window.twRenderUsers === 'function') { try { window.twRenderUsers(); } catch(e){} }
      }
    }).catch(function(e){ console.warn('[Bridge] syncUsers:',e); });
  }

  // Minimal, non-Admin-safe replacement for _syncUsers() above — same
  // merge/replace logic, just sourced from /users/lookup (id, fullName,
  // role, locationName only, no email/mobile/isActive/etc.) since that's
  // all any non-Admin role is authorized to see.
  function _syncUsersLookupFallback() {
    return apiReq('GET', '/users/lookup').then(function(res) {
      if (!res || !res.success || !res.data) return;
      var apiUsers = res.data.map(function(u) {
        var roleKey = ROLE_MAP[u.role] || 'sales_executive';
        var roleLabel = (typeof window.ROLES !== 'undefined' && window.ROLES[roleKey] && window.ROLES[roleKey].label) || u.role || roleKey;
        return {
          id: 'API' + u.id, _apiId: u.id,
          name: u.fullName, email: '',
          role: roleLabel, roleKey: roleKey,
          mobile: '',
          loc: u.locationName || '', st: '', ot: '',
          locs: u.locationName ? [u.locationName] : [],
          salesTeams: [], opTeams: [],
          status: 'active', joinDate: '', uid: null
        };
      });
      if (typeof window.twUsers !== 'undefined' && Array.isArray(window.twUsers)) {
        var freshUserIds = new Set(apiUsers.map(function(u){ return u._apiId; }));
        for (var ui = window.twUsers.length - 1; ui >= 0; ui--) {
          var urow = window.twUsers[ui];
          if (urow._apiId && !freshUserIds.has(urow._apiId)) window.twUsers.splice(ui, 1);
        }
        apiUsers.forEach(function(au) {
          var existing = window.twUsers.findIndex(function(u){ return u._apiId === au._apiId; });
          if (existing >= 0) { window.twUsers[existing] = Object.assign(window.twUsers[existing], au); }
          else { window.twUsers.push(au); }
        });
        if (typeof window.twRenderUsers === 'function') { try { window.twRenderUsers(); } catch(e){} }
      }
    }).catch(function(e){ console.warn('[Bridge] syncUsersLookup:',e); });
  }

  // Frontend snake_case role key (ROLES config in efin-app.js) → backend
  // UserRole enum name. Previously only 5 of 11 roles had any mapping at
  // all (and the reverse GET-side map didn't match real enum names either
  // — e.g. 'Operations' isn't a UserRole value, 'Dsa' is), so most roles
  // could never round-trip correctly even once the API call itself worked.
  var ROLE_KEY_TO_ENUM = {
    admin: 'Admin', manager: 'Manager', sales_executive: 'Sales', dsa_user: 'Dsa',
    partner: 'Partner', login_team: 'LoginTeam', team_leader: 'TeamLeader',
    accounts: 'Accounts', location_head: 'LocationHead',
    operation_manager: 'OperationManager', product_team: 'ProductTeam'
  };

  /* Patch: twSaveUser → POST/PUT /api/users */
  function _patchTwSaveUser() {
    if (window._bridgeTwSaveUserPatched) return;
    window._bridgeTwSaveUserPatched = true;
    var _orig = window.twSaveUser;
    if (typeof _orig !== 'function') return;
    window.twSaveUser = function() {
      // Read the form BEFORE calling the original — it clears the edit-id
      // state and closes the modal, and by then the fields aren't reliably
      // readable.
      var nameEl  = document.getElementById('tw-um-name');
      var emailEl = document.getElementById('tw-um-email');
      var mobileEl= document.getElementById('tw-um-mobile');
      var passEl  = document.getElementById('tw-um-password');
      var roleEl  = document.getElementById('tw-um-role');
      var locEl   = document.getElementById('tw-um-loc');
      var stEl    = document.getElementById('tw-um-st');
      var otEl    = document.getElementById('tw-um-ot');
      var editingUser = (typeof window._twEditUserId === 'number' && window.twUsers && window.twUsers[window._twEditUserId])
        ? window.twUsers[window._twEditUserId] : null;

      var result = _orig.apply(this, arguments);

      if (!emailEl || !emailEl.value || !nameEl) { _syncUsers(); return result; }
      var email = emailEl.value.trim().toLowerCase();
      var roleKey = roleEl ? roleEl.value : '';
      var payload = {
        fullName: nameEl.value.trim(),
        email: email,
        role: ROLE_KEY_TO_ENUM[roleKey] || 'Sales',
        phoneNumber: mobileEl ? mobileEl.value.trim() : '',
        locationName: locEl ? locEl.value : '',
        salesTeam: stEl ? stEl.value : '',
        opTeam: otEl ? otEl.value : '',
        isActive: true
      };
      if (passEl && passEl.value) payload.password = passEl.value;

      var existingApiId = editingUser && editingUser._apiId;
      if (!existingApiId) {
        var match = (window.twUsers || []).find(function(u){ return u.email === email && u._apiId; });
        if (match) existingApiId = match._apiId;
      }
      if (!existingApiId && !payload.password) {
        // New user with no password can't be created server-side (Password
        // is required by CreateUserRequestDto) — the local twSaveUser()
        // already validates this and blocks the save before we get here,
        // so this is just a safety net.
        _syncUsers();
        return result;
      }

      var isCreate = !existingApiId;
      var req = existingApiId
        ? apiReq('PUT', '/users/' + existingApiId, payload)
        : apiReq('POST', '/users', payload);
      req.then(function(r) {
        if (r && r.success) {
          if (r.data && r.data.id) {
            if (editingUser) editingUser._apiId = r.data.id;
            // twSaveUser() unshifts new users to index 0 — that's the object
            // we just created, unless the id sequencing scheme means it's
            // no longer there (defensive email check as a fallback).
            else if (isCreate && window.twUsers && window.twUsers[0] && window.twUsers[0].email === email) {
              window.twUsers[0]._apiId = r.data.id;
            }
          }
          if (typeof window.showToast === 'function') window.showToast('User saved to database ✓', 'success');
          setTimeout(_syncUsers, 500);
        } else if (typeof window.showToast === 'function') {
          var msg = (r && (r.message || (r.errors && r.errors.join(' ')))) || 'Could not reach the server.';
          window.showToast('⚠ User saved locally, but database sync failed: ' + msg, 'warn');
        }
      });
      return result;
    };
  }

  /* ══════════════════════════════════════════════════════════
     twSaveUserDetail — the OTHER "Edit User" panel (Users page's inline
     tw-user-detail card, distinct from the tw-user-modal popup twSaveUser()
     already handles above). Was entirely unpatched — 100% local-only, same
     "looks saved, isn't" class of bug as the Team-members issue found
     alongside this one. Reuses the SAME PUT /api/users/{id} endpoint (and
     therefore the same server-side TeamMember auto-mapping already built
     for Create/Update) rather than adding a second save path. NOTE — this
     panel lets an admin add MULTIPLE Location/Sales-Team/Ops-Team tags, but
     the backend's User.SalesTeam/OpTeam model (and the Create User modal)
     only support ONE of each — this patch follows the SAME convention this
     panel's own original code already used locally (u.loc=_twUdLocs[0],
     u.st=_twUdSales[0], u.ot=_twUdOps[0] — first tag treated as the
     primary one) rather than guessing at true multi-team support, which
     isn't represented anywhere in the current data model.
  ══════════════════════════════════════════════════════════ */
  function _patchTwSaveUserDetail() {
    if (window._bridgeTwSaveUserDetailPatched) return;
    window._bridgeTwSaveUserDetailPatched = true;
    var _orig = window.twSaveUserDetail;
    if (typeof _orig !== 'function') return;
    // BUGFIX (confirmed real bug — "select Location Head, save, it becomes
    // Sales Person"): twSaveUserDetail() in efin-app.js now already sends
    // the authoritative PUT /users/{id} (with the CORRECT role mapped from
    // the panel's actual <select> option values, e.g. "Location Head") plus
    // the Locations/Teams syncs, all in one place. This patch used to fire
    // a SECOND, competing PUT /users/{id} right after it, built from
    // ROLE_KEY_TO_ENUM — a snake_case-keyed map (location_head, etc.) that
    // was never going to match this panel's label-valued <select> ("Location
    // Head", with a space and capitals). That lookup always missed and
    // silently fell back to 'Sales', so this second call clobbered whatever
    // correct role the first call had just saved — the user would pick
    // "Location Head", watch it save, and see "Sales Person" stick instead.
    // Just delegate to the (now-authoritative) original; no second save.
    window.twSaveUserDetail = function() {
      var result = _orig.apply(this, arguments);
      // Original already PUTs the full, correct payload (role/name/locations/
      // teams) straight to the server — just pull the canonical post-save
      // state back down afterward, same as every other save path here.
      setTimeout(_syncUsers, 700);
      return result;
    };
  }

  /* ══════════════════════════════════════════════════════════
     3. TEAMS — Sync from API into twSalesTeams / twLoginTeams
  ══════════════════════════════════════════════════════════ */
  function _syncTeams() {
    return apiReq('GET', '/teams').then(function(res) {
      if (!res || !res.success || !res.data) return;
      var salesTeams = res.data.filter(function(t){ return t.type === 'Sales'; });
      var loginTeams = res.data.filter(function(t){ return t.type === 'Login'; });

      // Wholesale replace (was merge/push-only — a team no longer returned by
      // the server, or edited on another device, never disappeared/updated
      // here because this only ever added/updated, never removed). Any row
      // whose _apiId no longer appears in this type's server response is
      // dropped; a row with no _apiId yet (a draft not yet POSTed) is left
      // alone — same grace-window as _syncLoans/_syncTasks.
      function mergeTeams(apiList, store) {
        if (!Array.isArray(store)) return;
        var freshTeamIds = new Set(apiList.map(function(at){ return at.id; }));
        for (var tmi = store.length - 1; tmi >= 0; tmi--) {
          var trow = store[tmi];
          if (trow._apiId && !freshTeamIds.has(trow._apiId)) store.splice(tmi, 1);
        }
        apiList.forEach(function(at) {
          // BUGFIX (Team Leader field mismatch — confirmed via prior
          // forensic analysis): every render/edit function in efin-app.js
          // (twRenderSalesTeams, twRenderLoginTeams, twEditSalesTeam,
          // twEditLoginTeam, twTeamMenu, etc.) reads t.leader — this mapping
          // was writing t.lead instead, so a server-synced team's leader
          // name never showed up anywhere in the UI (displayed as "—") even
          // though the backend had it correctly. Confirmed no other code
          // anywhere reads the (wrong) .lead field, so this rename is safe.
          // BUGFIX (confirmed real gap — Sales/Login Teams page always
          // showing "Archived"): this mapping never set `active` at all,
          // so every server-synced team's t.active was undefined
          // (falsy) — twRenderSalesTeams/twRenderLoginTeams's
          // `t.active ? 'Active' : 'Archived'` check therefore showed
          // "Archived" for literally every team, regardless of its real
          // status. Team has no backend IsActive column at all (confirmed
          // by inspection — Team.cs / BaseEntity.cs), so there is no real
          // archived-status to sync from the server; per the explicit
          // requirement that a team must be Active by default unless an
          // Admin explicitly archives it, this defaults freshly-synced
          // teams to active:true. Object.assign below only overwrites
          // keys present in this object, so an EXISTING local row that a
          // user already archived this session (via twArchiveTeam, a
          // local-only action — no backend persistence exists for it
          // either) is not clobbered back to active on the next sync,
          // since `existing >= 0` rows keep whatever `active` they
          // already had unless explicitly changed again locally.
          //
          // location now carries the resolved Location NAME (at.locationName)
          // instead of the raw, unresolved numeric LocationId — see
          // TeamsController.GetAll's new LocationName projection. Team's
          // Location is a single FK, not many-to-many (confirmed by
          // inspection — no Team↔Location junction table exists, unlike
          // the genuinely many-to-many User↔Location/UserLocations), so
          // this shows the one assigned Location's name instead of a bare id.
          var mapped = { id:'API'+at.id, _apiId:at.id, name:at.name, leader:at.teamLead||'',
                         members:(at.members||[]).map(function(m){ return m.fullName; }),
                         location:at.locationName||'',
                         // BUGFIX (confirmed real gap — Archive/Active
                         // status not persistent): Teams.IsActive now
                         // exists server-side (see TeamsController.cs) —
                         // this is the real source of truth going forward,
                         // replacing the earlier temporary "default new
                         // rows to Active" workaround. Present on every
                         // sync now (new AND existing rows), so Object.assign
                         // below correctly overwrites with whatever the
                         // database actually says, including after a
                         // refresh/logout/new-device.
                         active: at.isActive !== false };
          var existing = store.findIndex(function(t){ return t._apiId === at.id; });
          if (existing >= 0) store[existing] = Object.assign(store[existing], mapped);
          else store.push(mapped);
        });
      }
      if (typeof window.twSalesTeams !== 'undefined') mergeTeams(salesTeams, window.twSalesTeams);
      if (typeof window.twLoginTeams !== 'undefined') mergeTeams(loginTeams, window.twLoginTeams);
      if (typeof window.twRenderSalesTeams === 'function') { try { window.twRenderSalesTeams(); } catch(e){} }
      if (typeof window.twRenderLoginTeams === 'function') { try { window.twRenderLoginTeams(); } catch(e){} }
    }).catch(function(e){ console.warn('[Bridge] syncTeams:',e); });
  }

  /* Patch: twSaveSalesTeamDetail / twSaveLoginTeamDetail → POST/PUT /api/teams
     twSaveSalesTeamDetail()/twSaveLoginTeamDetail() take NO arguments — they
     read the pending edit id off the module-level _twEditSalesId/_twEditLoginId
     and the form fields directly. The previous version of this patch expected
     a `teamId` argument that never arrives (always undefined), so its lookup
     never matched any team and NOTHING was ever sent to the backend — new or
     edited teams stayed local-only forever despite the misleading comment. */
  /* Patch: twArchiveTeam → PATCH /api/teams/{id}/status
     Confirmed real gap (Archive/Active status not persistent): the raw
     function only ever toggled t.active in local memory — nothing reached
     the server, so the status reverted to Active on every refresh/logout/
     new device. */
  function _patchTeamArchive() {
    if (window._bridgeTeamArchivePatched) return;
    window._bridgeTeamArchivePatched = true;
    var _orig = window.twArchiveTeam;
    if (typeof _orig !== 'function') return;
    window.twArchiveTeam = function(type, id) {
      var arr = (type === 'sales') ? window.twSalesTeams : window.twLoginTeams;
      var t = (arr || []).find(function(row) { return String(row.id) === String(id); });
      var result = _orig.apply(this, arguments); // flips t.active locally, renders, shows toast
      if (t && t._apiId && typeof window.apiReq === 'function') {
        window.apiReq('PATCH', '/teams/' + t._apiId + '/status', { isActive: t.active }).then(function(r) {
          if (!r || !r.success) {
            if (typeof window.showToast === 'function') window.showToast('⚠ Status changed locally, but database sync failed', 'warn');
          }
        }).catch(function() {
          if (typeof window.showToast === 'function') window.showToast('⚠ Status changed locally, but database sync failed', 'warn');
        });
      }
      return result;
    };
  }

  function _patchTeamSave() {
    if (window._bridgeTeamSavePatched) return;
    window._bridgeTeamSavePatched = true;
    var _cfg = {
      twSaveSalesTeamDetail: { type: 'Sales', store: 'twSalesTeams', editVar: '_twEditSalesId', nameEl: 'tw-st-name', leaderEl: 'tw-st-leader', locEl: 'tw-st-loc', activeEl: 'tw-st-active' },
      twSaveLoginTeamDetail: { type: 'Login', store: 'twLoginTeams', editVar: '_twEditLoginId', nameEl: 'tw-lt-name', leaderEl: 'tw-lt-leader', locEl: 'tw-lt-loc', activeEl: 'tw-lt-active' }
    };
    Object.keys(_cfg).forEach(function(fnName) {
      var _orig = window[fnName];
      if (typeof _orig !== 'function') return;
      var c = _cfg[fnName];
      window[fnName] = function() {
        // Capture the pending edit id + form values BEFORE the original
        // handler runs, since it resets the edit id to null and may hide
        // the form once it's done (same pattern as _patchDsaSave/_patchPartnerSave).
        var editId    = (typeof window[c.editVar] !== 'undefined') ? window[c.editVar] : null;
        var nameEl    = document.getElementById(c.nameEl);
        var leaderEl  = document.getElementById(c.leaderEl);
        var locEl     = document.getElementById(c.locEl);
        var activeEl  = document.getElementById(c.activeEl);
        var nameVal   = nameEl ? nameEl.value.trim() : '';
        var leaderVal = leaderEl ? leaderEl.value : '';
        var locVal    = locEl ? locEl.value : '';
        // BUGFIX (confirmed real gap — project-wide persistence audit):
        // the Edit-Team modal's Active/Archived dropdown was read into
        // local t.active by the raw twSaveSalesTeamDetail/
        // twSaveLoginTeamDetail functions, but this payload never included
        // it — so the change showed "Team saved to database ✓" while the
        // real status was untouched, and the setTimeout(_syncTeams, 300)
        // right below silently reverted the visual change back to
        // whatever the database actually had. Reuses the same
        // PATCH /teams/{id}/status endpoint twArchiveTeam already calls.
        var activeVal = activeEl ? activeEl.value === 'true' : null;
        var wasValid  = !!nameVal;

        // BUGFIX (Members not persisting — confirmed): "Save Team" showed
        // "Team saved to database ✓" and DID successfully save Name/
        // Location/Leader, but Members were never included in that PUT/POST
        // payload at all (TeamCreateDto has no Members field) — the "+ Add
        // Member" flow inside the team-detail view only ever mutated a DOM
        // element, then twSaveSalesTeamDetail()/twSaveLoginTeamDetail()
        // (the ORIGINAL, unpatched functions) read that DOM back into
        // team.members and stopped there. Nothing about member changes ever
        // reached the server — hence "looks saved, isn't". Fixed by
        // reconciling against the server using the SAME existing
        // POST/DELETE .../members endpoints TeamsController already
        // exposes (used elsewhere for the manual Add/Remove Member flow) —
        // no new endpoint, no new architecture. Old member list captured
        // here, BEFORE _orig overwrites team.members with the new one.
        var store = window[c.store];
        var oldMemberNames = [];
        if (editId && Array.isArray(store)) {
          var existingTeam = store.find(function(t){ return String(t.id) === String(editId); });
          if (existingTeam && Array.isArray(existingTeam.members)) oldMemberNames = existingTeam.members.slice();
        }

        var result = _orig.apply(this, arguments);
        if (!wasValid) return result; // original already showed its own validation toast

        setTimeout(function() {
          if (!Array.isArray(store)) return;
          var team = editId
            // Same type-agnostic comparison as _twFindTeamById in
            // efin-app.js (see that helper's comment for the full reasoning) —
            // editId is always a string after the Actions-button fix, but a
            // locally-created (not yet synced) team's id is still a plain
            // number, so a normalized String() comparison is required here
            // too, not a strict ===.
            ? store.find(function(t){ return String(t.id) === String(editId); })
            : store.find(function(t){ return t.name === nameVal && !t._apiId; });
          if (!team) return;
          var newMemberNames = Array.isArray(team.members) ? team.members.slice() : [];

          var locRec    = (window.twLocations || []).find(function(l){ return l.name === locVal; });
          var leaderRec = (window.twUsers || []).find(function(u){ return u.name === leaderVal; });
          var payload = {
            name: nameVal,
            type: c.type,
            locationId: locRec ? locRec._apiId : null,
            teamLeadUserId: leaderRec ? leaderRec._apiId : null
          };

          var apiId = team._apiId;
          var req = apiId ? apiReq('PUT', '/teams/' + apiId, payload) : apiReq('POST', '/teams', payload);
          req.then(function(r) {
            if (r && r.success) {
              if (!apiId && r.data && r.data.id) team._apiId = r.data.id;
              var finalApiId = team._apiId;
              // Status is a separate, dedicated endpoint (same one
              // twArchiveTeam uses) rather than part of the main payload
              // above — the main Update() endpoint doesn't accept
              // IsActive at all, by design (see TeamsController.SetStatus's
              // own doc-comment on why this stays a minimal, separate call).
              var statusReq = (finalApiId && activeVal !== null)
                ? apiReq('PATCH', '/teams/' + finalApiId + '/status', { isActive: activeVal })
                : Promise.resolve({ success: true });
              statusReq.then(function(sr) {
                var statusFailed = activeVal !== null && (!sr || !sr.success);
                _reconcileTeamMembers(finalApiId, oldMemberNames, newMemberNames).then(function(memberIssues) {
                  var issues = [memberIssues, statusFailed ? 'status not saved' : null].filter(Boolean).join(', ');
                  if (typeof window.showToast === 'function') {
                    window.showToast(issues
                      ? 'Team saved to database ✓ (' + issues + ')'
                      : 'Team saved to database ✓', issues ? 'warn' : 'success');
                  }
                  if (typeof window.persistSave === 'function') { try { window.persistSave(); } catch(e){} }
                  setTimeout(_syncTeams, 300);
                });
              });
            } else if (typeof window.showToast === 'function') {
              var msg = (r && (r.message || (r.errors && r.errors.join(' ')))) || 'Could not reach the server.';
              window.showToast('⚠ Team saved locally, but database sync failed: ' + msg, 'warn');
            }
          });
        }, 200);
        return result;
      };
    });
  }

  // Diff oldMemberNames → newMemberNames and push the difference to the
  // server via the SAME POST/DELETE .../members endpoints the manual
  // "Add Member" flow already uses (TeamsController.AddMember/RemoveMember)
  // — reused, not duplicated. Names are resolved to user ids via twUsers
  // (the same lookup _patchTeamSave already does for the team leader).
  // Best-effort: one member failing to resolve/save doesn't block the
  // others or the team save itself, matching the non-fatal pattern already
  // used for User→Team auto-mapping — returns a short note (or null) for
  // the caller to optionally surface, same convention as that fix's
  // mappingNote pattern.
  function _reconcileTeamMembers(teamApiId, oldNames, newNames) {
    if (!teamApiId) return Promise.resolve('members not saved — team is not yet synced to the server');
    var users = window.twUsers || [];
    var toAdd    = newNames.filter(function(n){ return oldNames.indexOf(n) === -1; });
    var toRemove = oldNames.filter(function(n){ return newNames.indexOf(n) === -1; });
    if (!toAdd.length && !toRemove.length) return Promise.resolve(null);

    var failures = [];
    var ops = [];
    toAdd.forEach(function(name) {
      var u = users.find(function(x){ return x.name === name; });
      if (!u || !u._apiId) { failures.push(name); return; }
      ops.push(apiReq('POST', '/teams/' + teamApiId + '/members', { userId: u._apiId }).catch(function(){ failures.push(name); }));
    });
    toRemove.forEach(function(name) {
      var u = users.find(function(x){ return x.name === name; });
      if (!u || !u._apiId) return; // nothing to remove server-side if we can't resolve who it was
      ops.push(apiReq('DELETE', '/teams/' + teamApiId + '/members/' + u._apiId).catch(function(){ failures.push(name); }));
    });
    return Promise.all(ops).then(function() {
      return failures.length ? (failures.length + ' member(s) could not be saved — resync and retry from the team page') : null;
    });
  }

  /* ══════════════════════════════════════════════════════════
     4. LOCATIONS — Sync from API into twLocations
  ══════════════════════════════════════════════════════════ */
  function _syncLocations() {
    return apiReq('GET', '/locations').then(function(res) {
      if (!res || !res.success || !res.data) return;
      if (typeof window.twLocations !== 'undefined' && Array.isArray(window.twLocations)) {
        res.data.forEach(function(loc) {
          var mapped = { id:'API'+loc.id, _apiId:loc.id, name:loc.name, city:loc.city||'', state:loc.state||'', pin:loc.pinCode||'' };
          var existing = window.twLocations.findIndex(function(l){ return l._apiId === loc.id; });
          if (existing >= 0) window.twLocations[existing] = Object.assign(window.twLocations[existing], mapped);
          else window.twLocations.push(mapped);
        });
        if (typeof window.twRenderLocations === 'function') { try { window.twRenderLocations(); } catch(e){} }
      }
    }).catch(function(e){ console.warn('[Bridge] syncLocations:',e); });
  }

  /* Patch: twSaveLocation → POST /api/locations (create only — twSaveLocation()
     takes no arguments; there is no separate "edit" form for locations, only
     add/rename/delete). The previous version expected a `locId` argument that
     never arrives, so its lookup never matched the new location and nothing
     was ever sent to the backend. */
  function _patchLocationSave() {
    if (window._bridgeLocSavePatched) return;
    window._bridgeLocSavePatched = true;
    var _orig = window.twSaveLocation;
    if (typeof _orig !== 'function') return;
    window.twSaveLocation = function() {
      // Capture the name BEFORE the original runs — it clears the input
      // field itself as part of closing the modal.
      var nameEl  = document.getElementById('tw-loc-name');
      var nameVal = nameEl ? nameEl.value.trim() : '';
      var result  = _orig.apply(this, arguments);
      if (!nameVal) return result; // original already showed its own validation toast

      setTimeout(function() {
        var loc = (window.twLocations || []).find(function(l){ return l.name === nameVal && !l._apiId; });
        if (!loc) return;
        var payload = { name: loc.name, city: loc.city || '', state: loc.state || '', pinCode: loc.pin || '' };
        apiReq('POST', '/locations', payload).then(function(r) {
          if (r && r.success) {
            if (r.data && r.data.id) loc._apiId = r.data.id;
            if (typeof window.showToast === 'function') window.showToast('Location saved to database ✓', 'success');
            if (typeof window.persistSave === 'function') { try { window.persistSave(); } catch(e){} }
            setTimeout(_syncLocations, 300);
          } else if (typeof window.showToast === 'function') {
            var msg = (r && (r.message || (r.errors && r.errors.join(' ')))) || 'Could not reach the server.';
            window.showToast('⚠ Location saved locally, but database sync failed: ' + msg, 'warn');
          }
        });
      }, 200);
      return result;
    };
  }

  /* Patch: twRenameLocation → PUT /api/locations/{id} (only for locations
     that already have a real backend id — a rename on a still-local-only
     location just updates the name that _patchLocationSave's create call
     will pick up). */
  function _patchLocationRename() {
    if (window._bridgeLocRenamePatched) return;
    window._bridgeLocRenamePatched = true;
    var _orig = window.twRenameLocation;
    if (typeof _orig !== 'function') return;
    window.twRenameLocation = function(id) {
      var loc = (window.twLocations || []).find(function(l){ return String(l.id) === String(id); });
      var apiId = loc && loc._apiId;
      var result = _orig.apply(this, arguments);
      if (!apiId || !loc) return result;
      setTimeout(function() {
        apiReq('PUT', '/locations/' + apiId, { name: loc.name, city: loc.city || '', state: loc.state || '', pinCode: loc.pin || '' }).then(function(r) {
          if (r && r.success) {
            if (typeof window.showToast === 'function') window.showToast('Location renamed in database ✓', 'success');
            setTimeout(_syncLocations, 300);
          } else if (typeof window.showToast === 'function') {
            var msg = (r && (r.message || (r.errors && r.errors.join(' ')))) || 'Could not reach the server.';
            window.showToast('⚠ Location renamed locally, but database sync failed: ' + msg, 'warn');
          }
        });
      }, 100);
      return result;
    };
  }

  /* Patch: twDeleteLocation → DELETE /api/locations/{id} */
  function _patchLocationDelete() {
    if (window._bridgeLocDeletePatched) return;
    window._bridgeLocDeletePatched = true;
    var _orig = window.twDeleteLocation;
    if (typeof _orig !== 'function') return;
    window.twDeleteLocation = function(id) {
      var loc = (window.twLocations || []).find(function(l){ return String(l.id) === String(id); });
      var apiId = loc && loc._apiId;
      var result = _orig.apply(this, arguments);
      if (!apiId) return result;
      setTimeout(function() {
        apiReq('DELETE', '/locations/' + apiId).then(function(r) {
          if (!r || r.success === false) {
            var msg = (r && (r.message || (r.errors && r.errors.join(' ')))) || 'Could not reach the server.';
            if (typeof window.showToast === 'function') window.showToast('⚠ Location deleted locally, but database delete failed: ' + msg, 'warn');
          }
        });
      }, 100);
      return result;
    };
  }


  /* ══════════════════════════════════════════════════════════
     5. TASKS — Sync from API into TASK_STORE
  ══════════════════════════════════════════════════════════ */
  function _syncTasks() {
    return apiReq('GET', '/tasks').then(function(res) {
      if (!res || !res.success || !res.data) return;
      if (typeof window.TASK_STORE !== 'undefined' && Array.isArray(window.TASK_STORE)) {
        // Wholesale replace (was merge/push-only — a task deleted server-side
        // via DELETE /api/tasks/{id}, or on another device, never disappeared
        // here because this only ever added/updated, never removed). Any row
        // whose _apiId no longer appears in the server's response is dropped;
        // a row with no _apiId yet (a draft not yet POSTed) is left alone —
        // same grace-window as _syncLoans. Matching rows are updated in place
        // (Object.assign) rather than replaced with a fresh object, so
        // client-only fields the API doesn't send back (completed_user/
        // completion_date/completion_remark, _agentCreated — set directly on
        // the TASK_STORE object elsewhere in efin-app.js) survive the sync.
        var freshTaskIds = new Set(res.data.map(function(t){ return t.id; }));
        for (var ti = window.TASK_STORE.length - 1; ti >= 0; ti--) {
          var trow = window.TASK_STORE[ti];
          if (trow._apiId && !freshTaskIds.has(trow._apiId)) window.TASK_STORE.splice(ti, 1);
        }
        res.data.forEach(function(t) {
          var mapped = {
            id:'API'+t.id, _apiId:t.id,
            title:t.title, description:t.description||'',
            priority:t.priority||'Medium', status:t.isCompleted?'done':'pending',
            appId:t.loanId?'API'+t.loanId:null, assign_type:'manual',
            assigned_user:t.assignedTo||'', due_date:_fmtDate(t.dueDate),
            // Raw ISO date kept alongside the display-formatted due_date
            // above (which is NOT sortable/comparable — "15 Mar 2026") so
            // the overdue-reminder badge/toast (_refreshTaskNavBadge in
            // efin-app.js) can reliably tell if a task is actually overdue.
            due_date_raw:t.dueDate||null,
            created_date:_fmtDate(t.createdAt)
          };
          var existing = window.TASK_STORE.findIndex(function(ts){ return ts._apiId === t.id; });
          if (existing >= 0) window.TASK_STORE[existing] = Object.assign(window.TASK_STORE[existing], mapped);
          else window.TASK_STORE.push(mapped);
        });
        if (typeof window.renderTasksPage === 'function') { try { window.renderTasksPage(); } catch(e){} }
        if (typeof window.updateTasksNavBadge === 'function') { try { window.updateTasksNavBadge(); } catch(e){} }
      }
    }).catch(function(e){ console.warn('[Bridge] syncTasks:',e); });
  }

  /* Patch: efinMarkTaskDone → PATCH /api/tasks/{id}/complete */
  function _patchTaskDone() {
    if (window._bridgeTaskDonePatched) return;
    window._bridgeTaskDonePatched = true;
    var _orig = window.efinMarkTaskDone;
    if (typeof _orig !== 'function') return;
    window.efinMarkTaskDone = function(taskId) {
      var result = _orig.apply(this, arguments);
      var task = (window.TASK_STORE || []).find(function(t){ return Number(t.id) === Number(taskId) || t._apiId === taskId; });
      if (task && task._apiId) {
        apiReq('PATCH', '/tasks/' + task._apiId + '/complete').then(function(r) {
          if (r && r.success) setTimeout(_syncTasks, 200);
        });
      }
      return result;
    };
  }

  /* ══════════════════════════════════════════════════════════
     5b. DSA / PARTNERS — Sync from API into twDSAList / twPartnerList
     Backend: DsaController → DsaPartner table, split by PartnerType
     ('Dsa' / 'Partner', sent as strings — Newtonsoft's default enum
     binder accepts member names without a StringEnumConverter, same
     convention already used for User.role above).
     Phase 2: backend DsaDto now carries PAN, office address/state/
     pin/addrType, IsActive, Category (Partner individual/company
     sub-type) and MappedDsaId (Partner→DSA mapping). All of these
     now round-trip through the API instead of staying local-only.
     REMAINING GAP: linkedPartners on the DSA side is still computed
     client-side (derived from twPartnerList.mappedDsaId) rather than
     coming from the API — that's fine, it's a view, not stored data.
     Uploaded documents are handled separately via _syncDsaDocs /
     _uploadStagedDsaDocs below.
  ══════════════════════════════════════════════════════════ */
  function _dsaToLocal(d) {
    return {
      id: 'API' + d.id, _apiId: d.id,
      name: d.name, code: d.code || '', mobile: d.phone || '', email: d.email || '',
      pan: d.pan || '',
      officeCity: d.city || '', officeAddr: d.officeAddress || '',
      officeState: d.officeState || '', officePin: d.officePin || '',
      officeAddrType: d.officeAddressType || '',
      status: d.isActive === false ? 'inactive' : 'active',
      type: d.category || 'individual',
      mappedDsaId: d.mappedDsaId ? ('API' + d.mappedDsaId) : ''
    };
  }
  /* ══════════════════════════════════════════════════════════
     4b. OBLIGATIONS — Running Loan / Bank Line (FOIR tab)
     Backend: ObligationsController (LoanObligation table via
     GET /api/loans/{loanId}/obligations, POST/PUT/DELETE /api/obligations).
     Previously OBLIGATIONS (efin-app.js) was a plain in-memory object
     persisted only to localStorage — never visible on another device.
     window.OBLIGATIONS is keyed by the frontend appId (e.g. "EFIN000123");
     the backend needs the numeric Loan id, which lives on the matching
     APPLICATIONS entry as app._apiId (set by _syncLoans/_loanToApp). If a
     loan hasn't been synced to the backend yet (no _apiId), obligation
     writes stay local-only until the loan itself is — same "saved locally,
     sync will retry" fallback used elsewhere in this file.
  ══════════════════════════════════════════════════════════ */
  function _oblToLocal(o) {
    return {
      id: o.id, _apiId: o.id,
      loan_type: o.loanType,
      financer_name: o.financerName || '',
      sanction_amt: Number(o.sanctionAmount || 0),
      loan_emi: Number(o.loanEmi || 0),
      amount_out: Number(o.amountOutstanding || 0),
      loan_closure_date: o.loanClosureDate ? String(o.loanClosureDate).slice(0, 10) : '',
      loan_acc_no: o.loanAccountNumber || '',
      select_bt: !!o.selectBT
    };
  }
  function _oblToPayload(app, obl) {
    return {
      loanApplicationId: app._apiId,
      loanType: obl.loan_type,
      financerName: obl.financer_name || '',
      sanctionAmount: obl.sanction_amt || 0,
      loanEmi: obl.loan_emi || 0,
      amountOutstanding: obl.amount_out || 0,
      loanClosureDate: obl.loan_closure_date || null,
      loanAccountNumber: obl.loan_acc_no || '',
      selectBT: !!obl.select_bt
    };
  }

  /* Pull the authoritative obligation list for one application from the
     server and replace window.OBLIGATIONS[appId] wholesale (server is the
     single source of truth here, same approach as _syncRmEmails). No-op if
     the loan hasn't been synced to the backend yet. */
  function _syncObligations(appId) {
    var app = (window.APPLICATIONS || []).find(function(a) { return a.id === appId; });
    if (!app || !app._apiId) return Promise.resolve();
    return apiReq('GET', '/loans/' + app._apiId + '/obligations').then(function(res) {
      if (!res || !res.success || !res.data) return;
      if (typeof window.OBLIGATIONS === 'undefined') return;
      window.OBLIGATIONS[appId] = res.data.map(_oblToLocal);
      if (typeof window.renderObligationsTab === 'function') {
        try { window.renderObligationsTab(appId); } catch (e) {}
      }
    }).catch(function(e) { console.warn('[Bridge] syncObligations:', e); });
  }

  /* Auto-sync the Obligations tab whenever an application's detail view opens
     — mirrors _patchOpenDetailCibil below. */
  function _patchOpenDetailObligations() {
    if (window._bridgeOdOblPatched) return;
    window._bridgeOdOblPatched = true;
    var _orig = window.openDetail;
    if (typeof _orig !== 'function') return;
    window.openDetail = function(id) {
      var result = _orig.apply(this, arguments);
      setTimeout(function() { _syncObligations(id); }, 250);
      return result;
    };
  }

  /* Patch: saveObligation → POST /api/obligations (add). Original function
     already does the local push + toast + re-render — left untouched so the
     UI behaves identically offline; this just fires the API call after. */
  function _patchObligationSave() {
    if (window._bridgeOblSavePatched) return;
    window._bridgeOblSavePatched = true;
    var _orig = window.saveObligation;
    if (typeof _orig !== 'function') return;
    window.saveObligation = function() {
      var appIdEl = document.getElementById('obl-app-id');
      var appId = appIdEl ? appIdEl.value : null;
      var app = (window.APPLICATIONS || []).find(function(a) { return a.id === appId; });
      var result = _orig.apply(this, arguments);
      if (app && app._apiId) {
        var obls = (window.OBLIGATIONS && window.OBLIGATIONS[appId]) || [];
        var justAdded = obls[obls.length - 1];
        if (justAdded) {
          apiReq('POST', '/obligations', _oblToPayload(app, justAdded)).then(function(r) {
            if (r && r.success) {
              setTimeout(function() { _syncObligations(appId); }, 300);
            } else if (typeof window.showToast === 'function') {
              window.showToast('Obligation saved locally, but database sync failed — will retry on next refresh', 'warn');
            }
          });
        }
      }
      return result;
    };
  }

  /* Patch: deleteObligation → DELETE /api/obligations/{id}. */
  function _patchObligationDelete() {
    if (window._bridgeOblDeletePatched) return;
    window._bridgeOblDeletePatched = true;
    var _orig = window.deleteObligation;
    if (typeof _orig !== 'function') return;
    window.deleteObligation = function(appId, oblId) {
      var app = (window.APPLICATIONS || []).find(function(a) { return a.id === appId; });
      var obl = ((window.OBLIGATIONS && window.OBLIGATIONS[appId]) || []).find(function(o) { return o.id === oblId; });
      var apiId = obl && obl._apiId;
      var result = _orig.apply(this, arguments);
      if (app && app._apiId && apiId) {
        apiReq('DELETE', '/obligations/' + apiId).then(function(r) {
          if (!r || !r.success) {
            if (typeof window.showToast === 'function') {
              window.showToast('Obligation removed locally, but database sync failed — will retry on next refresh', 'warn');
            }
          }
        });
      }
      return result;
    };
  }

  /* Patch: oblField (inline edit) / toggleBT → PUT /api/obligations/{id},
     debounced 500ms so rapid keystrokes/toggles don't fire a request each. */
  var _oblFieldSyncTimers = {};
  function _syncObligationField(appId, oblId) {
    var app = (window.APPLICATIONS || []).find(function(a) { return a.id === appId; });
    var obl = ((window.OBLIGATIONS && window.OBLIGATIONS[appId]) || []).find(function(o) { return o.id === oblId; });
    if (!app || !app._apiId || !obl || !obl._apiId) return; // not backend-linked yet
    var key = appId + ':' + oblId;
    clearTimeout(_oblFieldSyncTimers[key]);
    _oblFieldSyncTimers[key] = setTimeout(function() {
      apiReq('PUT', '/obligations/' + obl._apiId, _oblToPayload(app, obl)).then(function(r) {
        if (!r || !r.success) {
          if (typeof window.showToast === 'function') {
            window.showToast('Obligation update saved locally, but database sync failed', 'warn');
          }
        }
      });
    }, 500);
  }
  function _patchObligationFieldEdit() {
    if (window._bridgeOblFieldPatched) return;
    window._bridgeOblFieldPatched = true;
    var _origField = window.oblField;
    if (typeof _origField === 'function') {
      window.oblField = function(appId, oblId, field, value) {
        var result = _origField.apply(this, arguments);
        _syncObligationField(appId, oblId);
        return result;
      };
    }
    var _origBT = window.toggleBT;
    if (typeof _origBT === 'function') {
      window.toggleBT = function(appId, oblId, val) {
        var result = _origBT.apply(this, arguments);
        _syncObligationField(appId, oblId);
        return result;
      };
    }
  }

  function _syncDsaPartners() {
    return apiReq('GET', '/dsa').then(function(res) {
      if (!res || !res.success || !res.data) return;
      var dsaItems     = res.data.filter(function(d){ return d.partnerType === 'Dsa'; });
      var partnerItems = res.data.filter(function(d){ return d.partnerType === 'Partner'; });

      // Wholesale replace (was merge/push-only — a DSA/Partner deleted
      // server-side via DELETE /api/dsa/{id}, or on another device, never
      // disappeared here because this only ever added/updated, never
      // removed). Any row whose _apiId no longer appears in this type's
      // server response is dropped; a row with no _apiId yet (a draft not
      // yet POSTed) is left alone — same grace-window as _syncLoans/
      // _syncTasks. Matching rows are updated in place (via the existing
      // Object.assign onto a copy of the current row) rather than replaced
      // with a bare fresh object, so twDSAList's client-only linkedPartners
      // array (computed elsewhere from twPartnerList.mappedDsaId — see the
      // note above _dsaToLocal) survives the sync instead of resetting to
      // empty/undefined on every boot/refresh/poll.
      function merge(apiList, store, extraDefaults) {
        if (!Array.isArray(store)) return;
        var freshDsaIds = new Set(apiList.map(function(d){ return d.id; }));
        for (var dmi = store.length - 1; dmi >= 0; dmi--) {
          var drow = store[dmi];
          if (drow._apiId && !freshDsaIds.has(drow._apiId)) store.splice(dmi, 1);
        }
        apiList.forEach(function(d) {
          var mapped = _dsaToLocal(d);
          var existing = store.findIndex(function(x){ return x._apiId === d.id; });
          if (existing >= 0) store[existing] = Object.assign({}, store[existing], mapped);
          else store.push(Object.assign({}, extraDefaults, mapped));
        });
      }
      if (typeof window.twDSAList !== 'undefined')     merge(dsaItems,     window.twDSAList,     { linkedPartners:[] });
      if (typeof window.twPartnerList !== 'undefined') merge(partnerItems, window.twPartnerList, {});
      if (typeof window.dsaRender === 'function') { try { window.dsaRender(''); } catch(e){} }
      if (typeof window.pmRender  === 'function') { try { window.pmRender('');  } catch(e){} }
      if (typeof window.dsaStatsRefresh === 'function') { try { window.dsaStatsRefresh(); } catch(e){} }
      if (typeof window.pmStatsRefresh  === 'function') { try { window.pmStatsRefresh();  } catch(e){} }
    }).catch(function(e){ console.warn('[Bridge] syncDsaPartners:', e); });
  }

  /* InCred RM Emails — GET /api/incred/rm → window.RM_EMAILS (efin-app.js).
     Previously RM_EMAILS was a frontend-only in-memory array with no backend
     at all, so it reset on refresh and never appeared on another tab/device.
     This mirrors _syncDsaPartners()'s read/merge approach, but since
     RM_EMAILS is a flat array (not keyed by _apiId like twDSAList), the
     database is treated as the single source of truth and the array is
     replaced wholesale on each sync rather than merged field-by-field. */
  function _rmToLocal(r) {
    return {
      id: r.id,
      name: r.name,
      location: r.location || '',
      email: r.email,
      contact_no: r.contactNo || ''
    };
  }
  function _syncRmEmails() {
    return apiReq('GET', '/incred/rm').then(function(res) {
      if (!res || !res.success || !res.data) return;
      var mapped = res.data.map(_rmToLocal);
      if (Array.isArray(window.RM_EMAILS)) {
        window.RM_EMAILS.length = 0;
        Array.prototype.push.apply(window.RM_EMAILS, mapped);
      } else {
        window.RM_EMAILS = mapped;
      }
      if (typeof window.renderRmEmails === 'function')  { try { window.renderRmEmails();  } catch(e){} }
      if (typeof window.populateRmSelect === 'function') { try { window.populateRmSelect(); } catch(e){} }
    }).catch(function(e){ console.warn('[Bridge] syncRmEmails:', e); });
  }

  /* Banks master — GET/POST/PUT/DELETE /api/banks → window.BANKS_STORE
     (efin-app.js). Previously BANKS_STORE was a frontend-only in-memory
     array (var BANKS_STORE = [...]) with no backend at all, so any bank
     added/removed on one device/tab never appeared anywhere else and reset
     to the hardcoded seed list on every refresh. Now backed by the Banks
     table (BanksController). Same approach as _syncRmEmails: BANKS_STORE is
     a flat array (no _apiId keying like twDSAList), so the database is
     treated as the single source of truth and the array is replaced
     wholesale on each sync rather than merged field-by-field. */
  function _bankToLocal(b) {
    return {
      id: b.id,
      name: b.bankName,
      ifsc: b.ifscPrefix || '',
      empCode: b.empCode || '—',
      location: b.location || '—',
      bankLocation: b.location || '—',
      rm: b.rmName || '—',
      rmMobile: b.rmMobile || '—',
      email: b.email || '—',
      remarks: b.remarks || '—',
      isActive: b.isActive !== false
    };
  }
  function _syncBanks() {
    return apiReq('GET', '/banks').then(function(res) {
      if (!res || !res.success || !res.data) return;
      var mapped = res.data.map(_bankToLocal);
      if (Array.isArray(window.BANKS_STORE)) {
        window.BANKS_STORE.length = 0;
        Array.prototype.push.apply(window.BANKS_STORE, mapped);
      } else {
        window.BANKS_STORE = mapped;
      }
      try {
        var mx = window.BANKS_STORE.reduce(function(m, b) { return Math.max(m, b.id || 0); }, 0);
        if (typeof window.bankNextId !== 'undefined') { window.bankNextId = mx + 1; }
      } catch (_) {}
      if (typeof window.renderBanksTable === 'function') { try { window.renderBanksTable(); } catch (e) {} }
      if (typeof window.populateRmSelect === 'function') { try { window.populateRmSelect(); } catch (e) {} }
    }).catch(function(e) { console.warn('[Bridge] syncBanks:', e); });
  }

  /* Rejection Reasons (Policy & Product page) — GET/POST/PUT/DELETE
     /api/rejectionreasons → window._PP_REASONS (rejection-reasons.js).
     Previously '_pp_rejection_reasons' was localStorage-only, so one admin's
     Add/Edit/Delete/Reorder never appeared for any other user/device. Same
     approach as _syncBanks: database is the source of truth, replaced
     wholesale on each sync. */
  function _syncRejectionReasons() {
    return apiReq('GET', '/rejectionreasons').then(function(res) {
      if (!res || !res.success || !res.data) return;
      var mapped = res.data.map(function(r) { return { id: r.key, _dbId: r.id, label: r.label }; });
      window._PP_REASONS = mapped;
      if (typeof window._ppSyncSelect === 'function') { try { window._ppSyncSelect(); } catch (e) {} }
      if (typeof window.ppRenderRejectionContent === 'function') { try { window.ppRenderRejectionContent(); } catch (e) {} }
    }).catch(function(e) { console.warn('[Bridge] syncRejectionReasons:', e); });
  }
  window._apiSyncRejectionReasons = _syncRejectionReasons;

  // 🟡 DSA/Partner Export (item #11) — GET /api/dsa/export returns a CSV
  // file directly (not JSON), so this uses fetch()+blob download rather
  // than the JSON-oriented apiReq() helper, same pattern as the
  // Applications export button already uses.
  window.dsaExportCsv = function () {
    var tok = null;
    try { tok = localStorage.getItem('loanms_token'); } catch (e) {}
    fetch('/api/dsa/export', { headers: tok ? { 'Authorization': 'Bearer ' + tok } : {} })
      .then(function (res) {
        if (!res.ok) throw new Error('Export failed (HTTP ' + res.status + ')');
        return res.blob();
      })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'dsa_partners_export.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        if (typeof window.showToast === 'function') window.showToast('DSA/Partner list exported ✓', 'success');
      })
      .catch(function (e) {
        if (typeof window.showToast === 'function') window.showToast('⚠ Export failed: ' + e.message, 'error');
      });
  };

  /* ══════════════════════════════════════════════════════════
     NOTIFICATIONS — topbar bell, fully server-backed
     ══════════════════════════════════════════════════════════
     Previously NOTIF_STORE (efin-app.js) was a pure in-memory array — every
     item was added client-side via pushNotif() and never touched the server
     at all, even though GET/POST /api/notifications and PUT .../read already
     existed and correctly persist to AppNotifications. That meant a
     notification was only ever visible in the one browser tab/session that
     generated it: gone on refresh, invisible on another device, and — for
     the one path that DID already POST to the server (notifyManagement(),
     payout claim submissions) — never read back by anyone at all, so even
     that data was functionally invisible despite being safely in Postgres.
     This section makes NOTIF_STORE a synced cache of the server's data,
     the same "wholesale replace" pattern as every other _syncX() here. */

  function _notificationToLocal(n) {
    return {
      id: n.id, _apiId: n.id,
      icon: n.icon || '🔔',
      text: n.message || n.type,
      time: n.createdAt,
      read: !!n.isRead
    };
  }

  function _syncNotifications() {
    return apiReq('GET', '/notifications').then(function(res) {
      if (!res || !res.success || !res.data || typeof window.NOTIF_STORE === 'undefined') return;
      var mapped = res.data.map(_notificationToLocal);
      window.NOTIF_STORE.length = 0;
      Array.prototype.push.apply(window.NOTIF_STORE, mapped);
      if (typeof window.updateNotifBadge === 'function') { try { window.updateNotifBadge(); } catch (e) {} }
    }).catch(function(e) { console.warn('[Bridge] syncNotifications:', e); });
  }
  window._apiSyncNotifications = _syncNotifications;

  // Patch pushNotif() → also POST /api/notifications, so every event that
  // already generates a topbar-bell item locally (new application created,
  // moved to Assign Lender, rejected, disbursed, approved — see the
  // pushNotif() call sites in efin-app.js) is saved server-side too, not
  // just added to the in-memory array. Re-syncs from the server on success
  // so the locally-optimistic entry gets replaced by the real, database-id-
  // backed row (needed for mark-as-read to have a real id to target).
  function _patchPushNotif() {
    if (window._bridgePushNotifPatched) return;
    window._bridgePushNotifPatched = true;
    var _orig = window.pushNotif;
    if (typeof _orig !== 'function') return;
    window.pushNotif = function(icon, text) {
      var result = _orig.apply(this, arguments);
      apiReq('POST', '/notifications', { type: 'event', icon: icon, message: text, targetRole: null })
        .then(function(r) { if (r && r.success) _syncNotifications(); })
        .catch(function(e) { console.warn('[Bridge] pushNotif save failed:', e); });
      return result;
    };
  }

  // Patch toggleNotifPanel() → the ORIGINAL function's own side effect of
  // opening the panel is "mark everything currently shown as read"
  // (NOTIF_STORE.forEach(n => n.read = true) right after rendering) — this
  // patch detects that this call is actually opening the panel (as opposed
  // to closing an already-open one) and pushes PUT .../read for whichever
  // items were unread going in.
  function _patchNotifPanelOpen() {
    if (window._bridgeNotifPanelPatched) return;
    window._bridgeNotifPanelPatched = true;
    var _orig = window.toggleNotifPanel;
    if (typeof _orig !== 'function') return;
    window.toggleNotifPanel = function() {
      var wasOpen = !!document.getElementById('notif-panel');
      var unreadApiIds = (window.NOTIF_STORE || [])
        .filter(function(n) { return !n.read && n._apiId; })
        .map(function(n) { return n._apiId; });
      var result = _orig.apply(this, arguments);
      if (!wasOpen) {
        unreadApiIds.forEach(function(apiId) {
          apiReq('PUT', '/notifications/' + apiId + '/read').catch(function() {});
        });
      }
      return result;
    };
  }

  // Patch markNotifRead / markAllNotifsRead — defensive, in case either is
  // ever called from somewhere other than the panel-open flow above.
  function _patchNotifReadFns() {
    if (window._bridgeNotifReadFnsPatched) return;
    window._bridgeNotifReadFnsPatched = true;
    var _origOne = window.markNotifRead;
    var _origAll = window.markAllNotifsRead;
    if (typeof _origOne === 'function') {
      window.markNotifRead = function(id) {
        var n = (window.NOTIF_STORE || []).find(function(x) { return x.id === id; });
        var result = _origOne.apply(this, arguments);
        if (n && n._apiId) apiReq('PUT', '/notifications/' + n._apiId + '/read').catch(function() {});
        return result;
      };
    }
    if (typeof _origAll === 'function') {
      window.markAllNotifsRead = function() {
        var unreadApiIds = (window.NOTIF_STORE || [])
          .filter(function(n) { return !n.read && n._apiId; })
          .map(function(n) { return n._apiId; });
        var result = _origAll.apply(this, arguments);
        unreadApiIds.forEach(function(apiId) {
          apiReq('PUT', '/notifications/' + apiId + '/read').catch(function() {});
        });
        return result;
      };
    }
  }

  /* ══════════════════════════════════════════════════════════
     LENDER CONFIGURATION — Analytic Banks / Companies / Categories
     (window.LA_DB — used by the Lender Configuration screen AND Wizard
     Step 9's bank-eligibility matching). Previously entirely browser-memory
     — every rule/company/category/line an admin configured vanished on the
     next page refresh. Now backed by the Banks table's new eligibility
     columns + AnalyticCompanies/AnalyticCategories/BankEligibilityLines
     (GET /api/banks already includes each bank's Lines — see
     BanksController.GetAll; GET /api/lenderconfig/companies|categories).
     Same "wholesale replace on sync" convention as _syncBanks/_syncTeams. */
  function _analyticBankToLocal(b) {
    var empTypes = [], compTypes = [], loanTypes = [], servicePins = [], homeTypes = [];
    try { empTypes = JSON.parse(b.empTypesJson || '[]'); } catch (e) {}
    try { compTypes = JSON.parse(b.compTypesJson || '[]'); } catch (e) {}
    try { loanTypes = JSON.parse(b.loanTypesJson || '[]'); } catch (e) {}
    try { servicePins = JSON.parse(b.serviceablePinsJson || '[]'); } catch (e) {}
    try { homeTypes = JSON.parse(b.homeTypesJson || '[]'); } catch (e) {}
    var productRules = {};
    (b.productRules || []).forEach(function(r) {
      var et = [], ct = [], ht = [];
      try { et = JSON.parse(r.empTypesJson || '[]'); } catch (e) {}
      try { ct = JSON.parse(r.compTypesJson || '[]'); } catch (e) {}
      try { ht = JSON.parse(r.homeTypesJson || '[]'); } catch (e) {}
      productRules[r.productKey] = {
        minCibil: r.minCibil, acceptNTC: !!r.acceptNtc, maxLoanAmt: r.maxLoanAmt,
        minTenure: r.minTenure, maxTenure: r.maxTenure, foirLimit: r.foirLimit,
        pfRequired: !!r.pfRequired, minAge: r.minAge, maxAge: r.maxAge,
        minExpMonths: r.minExpMonths, empTypes: et, compTypes: ct, homeTypes: ht
      };
    });
    return {
      id: b.id, _apiId: b.id, name: b.bankName,
      isIncred: !!b.isIncred, isElite: !!b.isElite,
      loanTypes: loanTypes.length ? loanTypes : null,
      serviceablePins: servicePins,
      productRules: productRules,
      lines: (b.lines || []).map(function(l) {
        return { id: l.id, _apiId: l.id, companyId: l.companyId, categoryId: l.categoryId, pinCode: l.pinCode || '', pf: !!l.pf };
      }),
      rules: {
        minCibil: b.minCibil, acceptNTC: !!b.acceptNtc, maxLoanAmt: b.maxLoanAmt,
        minTenure: b.minTenure, maxTenure: b.maxTenure, foirLimit: b.foirLimit,
        pfRequired: !!b.pfRequired, minAge: b.minAge, maxAge: b.maxAge,
        minExpMonths: b.minExpMonths, empTypes: empTypes, compTypes: compTypes,
        homeTypes: homeTypes, acceptedCategories: []
      }
    };
  }

  function _syncAnalyticBanks() {
    return apiReq('GET', '/banks').then(function(res) {
      if (!res || !res.success || !res.data || typeof window.LA_DB === 'undefined') return;
      var mapped = res.data.map(_analyticBankToLocal);
      LA_DB.banks = mapped;
      try {
        var mx = mapped.reduce(function(m, b) { return Math.max(m, b.id || 0); }, 0);
        LA_DB.nextId.bank = mx + 1;
        var mxLine = mapped.reduce(function(m, b) { return Math.max(m, (b.lines || []).reduce(function(m2, l) { return Math.max(m2, l.id || 0); }, 0)); }, 0);
        LA_DB.nextId.line = mxLine + 1;
      } catch (e) {}
      if (typeof window.laRenderBanks === 'function') { try { window.laRenderBanks(); } catch (e) {} }
      if (typeof window.laLoadEligibility === 'function') { try { window.laLoadEligibility(); } catch (e) {} }
    }).catch(function(e) { console.warn('[Bridge] syncAnalyticBanks:', e); });
  }
  window._apiSyncAnalyticBanks = _syncAnalyticBanks;

  function _syncAnalyticCompanies() {
    return apiReq('GET', '/lenderconfig/companies').then(function(res) {
      if (!res || !res.success || !res.data || typeof window.LA_DB === 'undefined') return;
      var mapped = res.data.map(function(c) {
        var empTypes = []; try { empTypes = JSON.parse(c.empTypesJson || '[]'); } catch (e) {}
        return { id: c.id, _apiId: c.id, name: c.name, compType: c.compType || '', empTypes: empTypes };
      });
      LA_DB.companies = mapped;
      try {
        var mx = mapped.reduce(function(m, c) { return Math.max(m, c.id || 0); }, 0);
        LA_DB.nextId.company = mx + 1;
      } catch (e) {}
      if (typeof window.laRenderCompanies === 'function') { try { window.laRenderCompanies(); } catch (e) {} }
      if (typeof window.laPopulateCompanySelect === 'function') { try { window.laPopulateCompanySelect(); } catch (e) {} }
      if (typeof window.laPopulateWizardCompanySelect === 'function') { try { window.laPopulateWizardCompanySelect(); } catch (e) {} }
    }).catch(function(e) { console.warn('[Bridge] syncAnalyticCompanies:', e); });
  }
  window._apiSyncAnalyticCompanies = _syncAnalyticCompanies;

  function _syncAnalyticCategories() {
    return apiReq('GET', '/lenderconfig/categories').then(function(res) {
      if (!res || !res.success || !res.data || typeof window.LA_DB === 'undefined') return;
      var mapped = res.data.map(function(c) { return { id: c.id, _apiId: c.id, name: c.name, salary: c.salary, bankId: null }; });
      LA_DB.categories = mapped;
      try {
        var mx = mapped.reduce(function(m, c) { return Math.max(m, c.id || 0); }, 0);
        LA_DB.nextId.category = mx + 1;
      } catch (e) {}
      if (typeof window.laRenderCategories === 'function') { try { window.laRenderCategories(); } catch (e) {} }
    }).catch(function(e) { console.warn('[Bridge] syncAnalyticCategories:', e); });
  }
  window._apiSyncAnalyticCategories = _syncAnalyticCategories;

  // ── Bank rules payload shape shared by add/edit patches below ──────────────
  function _bankRulesPayload(bank) {
    var r = bank.rules || {};
    return {
      isIncred: !!bank.isIncred, isElite: !!bank.isElite,
      minCibil: r.minCibil, acceptNtc: !!r.acceptNTC, maxLoanAmt: r.maxLoanAmt,
      minTenure: r.minTenure, maxTenure: r.maxTenure, foirLimit: r.foirLimit,
      pfRequired: !!r.pfRequired, minAge: r.minAge, maxAge: r.maxAge,
      minExpMonths: r.minExpMonths, empTypes: r.empTypes || [], compTypes: r.compTypes || []
    };
  }

  // ── Patch: laConfirmAddBank → POST /api/banks (with rule fields) ───────────
  function _patchLaConfirmAddBank() {
    if (window._bridgeLaAddBankPatched) return;
    window._bridgeLaAddBankPatched = true;
    var _orig = window.laConfirmAddBank;
    if (typeof _orig !== 'function') return;
    window.laConfirmAddBank = function(ov) {
      var beforeLen = (window.LA_DB && LA_DB.banks) ? LA_DB.banks.length : 0;
      var result = _orig.apply(this, arguments);
      if (!window.LA_DB || LA_DB.banks.length <= beforeLen) return result;
      var bank = LA_DB.banks[LA_DB.banks.length - 1];
      var payload = Object.assign({ bankName: bank.name }, _bankRulesPayload(bank));
      apiReq('POST', '/banks', payload).then(function(r) {
        if (r && r.success && r.data) { bank.id = r.data.id; bank._apiId = r.data.id; }
        else if (typeof window.showToast === 'function') window.showToast('⚠ Bank added locally, but database save failed.', 'warn');
      });
      return result;
    };
  }

  // ── Patch: laDeleteBank → DELETE /api/banks/{id} ────────────────────────────
  function _patchLaDeleteBank() {
    if (window._bridgeLaDeleteBankPatched) return;
    window._bridgeLaDeleteBankPatched = true;
    var _orig = window.laDeleteBank;
    if (typeof _orig !== 'function') return;
    window.laDeleteBank = function(id) {
      var bank = window.LA_DB && LA_DB.banks.find(function(b) { return b.id === id; });
      var apiId = bank && bank._apiId;
      var result = _orig.apply(this, arguments);
      if (!apiId) return result;
      apiReq('DELETE', '/banks/' + apiId).then(function(r) {
        if (!r || r.success === false) { if (typeof window.showToast === 'function') window.showToast('⚠ Bank deleted locally, but database delete failed.', 'warn'); }
      });
      return result;
    };
  }

  // ── Patch: laSaveBankDetails → PUT /api/banks/{id} (name/InCred/Elite/rules) ─
  function _patchLaSaveBankDetails() {
    if (window._bridgeLaSaveBankDetailsPatched) return;
    window._bridgeLaSaveBankDetailsPatched = true;
    var _orig = window.laSaveBankDetails;
    if (typeof _orig !== 'function') return;
    window.laSaveBankDetails = function() {
      var result = _orig.apply(this, arguments);
      var bank = window.LA_DB && LA_DB.banks.find(function(b) { return b.id === LA_DB.currentBankId; });
      var apiId = bank && bank._apiId;
      if (!apiId) return result;
      var payload = Object.assign({ bankName: bank.name }, _bankRulesPayload(bank));
      apiReq('PUT', '/banks/' + apiId, payload).then(function(r) {
        if (!r || r.success === false) { if (typeof window.showToast === 'function') window.showToast('⚠ Bank saved locally, but database save failed.', 'warn'); }
      });
      return result;
    };
  }

  // ── Patches: bank rule quick-toggles (Bank Rules / CIBIL Rules / PIN /
  // Employment Types tabs all mutate bank.rules in place then call
  // laRenderBanks() — none of them go through laSaveBankDetails, so each
  // needs its own save trigger). Rather than hunting down every individual
  // toggle handler, this listens for the bank-detail panel's own explicit
  // "save rules" affordance if present, and otherwise the line/company/
  // category patches below cover the data that actually needs a foreign key
  // (rules-only edits without a laSaveBankDetails click are covered the next
  // time laSaveBankDetails or laConfirmAddBank runs for that bank).

  // ── Patch: laSaveNewLine / laSaveMultipleLines → POST /api/lenderconfig/lines
  function _patchLaLineAdds() {
    if (window._bridgeLaLineAddPatched) return;
    window._bridgeLaLineAddPatched = true;
    var _origSingle = window.laSaveNewLine;
    var _origMulti = window.laSaveMultipleLines;
    if (typeof _origSingle === 'function') {
      window.laSaveNewLine = function() {
        var bank = window.LA_DB && LA_DB.banks.find(function(b) { return b.id === LA_DB.currentBankId; });
        var beforeLen = bank ? bank.lines.length : 0;
        var result = _origSingle.apply(this, arguments);
        if (!bank || bank.lines.length <= beforeLen || !bank._apiId) return result;
        var line = bank.lines[bank.lines.length - 1];
        _postLine(bank, line);
        return result;
      };
    }
    if (typeof _origMulti === 'function') {
      window.laSaveMultipleLines = function(ov) {
        var bank = window.LA_DB && LA_DB.banks.find(function(b) { return b.id === LA_DB.currentBankId; });
        var beforeLen = bank ? bank.lines.length : 0;
        var result = _origMulti.apply(this, arguments);
        if (!bank || !bank._apiId) return result;
        bank.lines.slice(beforeLen).forEach(function(line) { _postLine(bank, line); });
        return result;
      };
    }
    function _postLine(bank, line) {
      var company = LA_DB.companies.find(function(c) { return c.id === line.companyId; });
      var category = LA_DB.categories.find(function(c) { return c.id === line.categoryId; });
      if (!company || !company._apiId || !category || !category._apiId) return; // local-only company/category not yet synced to DB — line save deferred to the next full sync
      apiReq('POST', '/lenderconfig/lines', {
        bankId: bank._apiId, companyId: company._apiId, categoryId: category._apiId,
        pinCode: line.pinCode || '', pf: !!line.pf
      }).then(function(r) {
        if (r && r.success && r.data) { line.id = r.data.id; line._apiId = r.data.id; }
        else if (typeof window.showToast === 'function') window.showToast('⚠ Line added locally, but database save failed.', 'warn');
      });
    }
  }

  // ── Patch: laDeleteLine → DELETE /api/lenderconfig/lines/{id} ──────────────
  function _patchLaDeleteLine() {
    if (window._bridgeLaDeleteLinePatched) return;
    window._bridgeLaDeleteLinePatched = true;
    var _orig = window.laDeleteLine;
    if (typeof _orig !== 'function') return;
    window.laDeleteLine = function(lineId) {
      var bank = window.LA_DB && LA_DB.banks.find(function(b) { return b.id === LA_DB.currentBankId; });
      var line = bank && bank.lines.find(function(l) { return l.id === lineId; });
      var apiId = line && line._apiId;
      var result = _orig.apply(this, arguments);
      if (!apiId) return result;
      apiReq('DELETE', '/lenderconfig/lines/' + apiId).then(function(r) {
        if (!r || r.success === false) { if (typeof window.showToast === 'function') window.showToast('⚠ Line deleted locally, but database delete failed.', 'warn'); }
      });
      return result;
    };
  }

  // ── Patch: laConfirmAddCompany → POST /api/lenderconfig/companies ──────────
  function _patchLaConfirmAddCompany() {
    if (window._bridgeLaAddCompanyPatched) return;
    window._bridgeLaAddCompanyPatched = true;
    var _orig = window.laConfirmAddCompany;
    if (typeof _orig !== 'function') return;
    window.laConfirmAddCompany = function(ov) {
      var beforeLen = (window.LA_DB && LA_DB.companies) ? LA_DB.companies.length : 0;
      var result = _orig.apply(this, arguments);
      if (!window.LA_DB || LA_DB.companies.length <= beforeLen) return result;
      var company = LA_DB.companies[LA_DB.companies.length - 1];
      apiReq('POST', '/lenderconfig/companies', { name: company.name, compType: company.compType || null, empTypes: company.empTypes || [] })
        .then(function(r) {
          if (r && r.success && r.data) { company.id = r.data.id; company._apiId = r.data.id; }
          else if (typeof window.showToast === 'function') window.showToast('⚠ Company added locally, but database save failed.', 'warn');
        });
      return result;
    };
  }

  // ── Patch: laUpdateCompany → PUT /api/lenderconfig/companies/{id} ──────────
  function _patchLaUpdateCompany() {
    if (window._bridgeLaUpdateCompanyPatched) return;
    window._bridgeLaUpdateCompanyPatched = true;
    var _orig = window.laUpdateCompany;
    if (typeof _orig !== 'function') return;
    window.laUpdateCompany = function(id, field, val) {
      var result = _orig.apply(this, arguments);
      var company = window.LA_DB && LA_DB.companies.find(function(c) { return c.id === id; });
      if (!company || !company._apiId) return result;
      apiReq('PUT', '/lenderconfig/companies/' + company._apiId, { name: company.name, compType: company.compType || null, empTypes: company.empTypes || [] })
        .then(function(r) { if (!r || r.success === false) { if (typeof window.showToast === 'function') window.showToast('⚠ Company saved locally, but database save failed.', 'warn'); } });
      return result;
    };
  }

  // ── Patch: laDeleteCompany → DELETE /api/lenderconfig/companies/{id} ───────
  function _patchLaDeleteCompany() {
    if (window._bridgeLaDeleteCompanyPatched) return;
    window._bridgeLaDeleteCompanyPatched = true;
    var _orig = window.laDeleteCompany;
    if (typeof _orig !== 'function') return;
    window.laDeleteCompany = function(id) {
      var company = window.LA_DB && LA_DB.companies.find(function(c) { return c.id === id; });
      var apiId = company && company._apiId;
      var result = _orig.apply(this, arguments);
      if (!apiId) return result;
      apiReq('DELETE', '/lenderconfig/companies/' + apiId).then(function(r) {
        if (!r || r.success === false) { if (typeof window.showToast === 'function') window.showToast('⚠ Company deleted locally, but database delete failed.', 'warn'); }
      });
      return result;
    };
  }

  // ── Patch: laConfirmAddCategory / laUpdateCategory / laDeleteCategory ──────
  function _patchLaCategoryFns() {
    if (window._bridgeLaCategoryPatched) return;
    window._bridgeLaCategoryPatched = true;
    var _origAdd = window.laConfirmAddCategory;
    var _origUpd = window.laUpdateCategory;
    var _origDel = window.laDeleteCategory;
    if (typeof _origAdd === 'function') {
      window.laConfirmAddCategory = function(ov) {
        var beforeLen = (window.LA_DB && LA_DB.categories) ? LA_DB.categories.length : 0;
        var result = _origAdd.apply(this, arguments);
        if (!window.LA_DB || LA_DB.categories.length <= beforeLen) return result;
        var category = LA_DB.categories[LA_DB.categories.length - 1];
        apiReq('POST', '/lenderconfig/categories', { name: category.name, salary: category.salary || 0 }).then(function(r) {
          if (r && r.success && r.data) { category.id = r.data.id; category._apiId = r.data.id; }
          else if (typeof window.showToast === 'function') window.showToast('⚠ Category added locally, but database save failed.', 'warn');
        });
        return result;
      };
    }
    if (typeof _origUpd === 'function') {
      window.laUpdateCategory = function(id, field, val) {
        var result = _origUpd.apply(this, arguments);
        var category = window.LA_DB && LA_DB.categories.find(function(c) { return c.id === id; });
        if (!category || !category._apiId) return result;
        apiReq('PUT', '/lenderconfig/categories/' + category._apiId, { name: category.name, salary: category.salary || 0 })
          .then(function(r) { if (!r || r.success === false) { if (typeof window.showToast === 'function') window.showToast('⚠ Category saved locally, but database save failed.', 'warn'); } });
        return result;
      };
    }
    if (typeof _origDel === 'function') {
      window.laDeleteCategory = function(id) {
        var category = window.LA_DB && LA_DB.categories.find(function(c) { return c.id === id; });
        var apiId = category && category._apiId;
        var result = _origDel.apply(this, arguments);
        if (!apiId) return result;
        apiReq('DELETE', '/lenderconfig/categories/' + apiId).then(function(r) {
          if (!r || r.success === false) { if (typeof window.showToast === 'function') window.showToast('⚠ Category deleted locally, but database delete failed.', 'warn'); }
        });
        return result;
      };
    }
  }

  /* Email Templates (Settings → Templates) — GET/PUT/DELETE /api/emailtemplates
     → window._EMAIL_TPL_OVERRIDES (efin-app.js reads this to override its
     built-in STG_TPL_DEFAULTS per key). Previously 'efin_email_templates_v1'
     was localStorage-only — an admin's customization never applied anywhere
     else, including for server-triggered auto-sends. */
  function _syncEmailTemplates() {
    return apiReq('GET', '/emailtemplates').then(function(res) {
      if (!res || !res.success || !res.data) return;
      var map = {};
      res.data.forEach(function(t) { map[t.templateKey] = { subject: t.subject, body: t.body }; });
      window._EMAIL_TPL_OVERRIDES = map;
      if (typeof window.stgRenderAllTemplates === 'function') { try { window.stgRenderAllTemplates(); } catch (e) {} }
    }).catch(function(e) { console.warn('[Bridge] syncEmailTemplates:', e); });
  }
  window._apiSyncEmailTemplates = _syncEmailTemplates;

  /* Product Offer Matrix (Policy & Product page) — GET/PUT /api/productoffermatrix
     → window.PRODUCT_CAM_MATRICES (merged over the built-in PP_DEFAULTS).
     Previously 'efin_product_cam_v2' was localStorage-only. */
  function _syncProductOfferMatrix() {
    return apiReq('GET', '/productoffermatrix').then(function(res) {
      if (!res || !res.success || !res.data) return;
      if (!window.PRODUCT_CAM_MATRICES) window.PRODUCT_CAM_MATRICES = {};
      // Wholesale replace + delete-detection (same pattern as _syncTasks/
      // _syncUsers/_syncTeams/_syncDsaPartners). Previously this only ever
      // overwrote window.PRODUCT_CAM_MATRICES[p.productKey] for keys present
      // in the response — if a product offer matrix row was deleted
      // server-side (or on another device), the stale locally-cached matrix
      // for that key was never removed and lingered forever as a "ghost"
      // entry, out of sync with the DB (the actual source of truth).
      // The 8 product keys are fixed/enum-driven (PP_PRODUCTS in
      // product-offer-matrix.js) — there's no concept of a user creating a
      // brand-new, not-yet-synced productKey the way TASK_STORE rows can be
      // local-only drafts — so a key missing from the server response falls
      // back to its built-in default matrix (via window._ppResetToDefault,
      // exposed by product-offer-matrix.js) rather than being left as
      // whatever was last synced. If that helper isn't available yet
      // (product-offer-matrix.js not loaded), the stale key is dropped
      // instead so it can't survive as a ghost either way.
      var freshKeys = {};
      res.data.forEach(function(p) { freshKeys[p.productKey] = true; });
      Object.keys(window.PRODUCT_CAM_MATRICES).forEach(function(existingKey) {
        if (freshKeys[existingKey]) return;
        if (typeof window._ppResetToDefault === 'function') {
          window.PRODUCT_CAM_MATRICES[existingKey] = window._ppResetToDefault(existingKey);
        } else {
          delete window.PRODUCT_CAM_MATRICES[existingKey];
        }
      });
      res.data.forEach(function(p) {
        try { window.PRODUCT_CAM_MATRICES[p.productKey] = JSON.parse(p.matrixJson); }
        catch (e) { console.warn('[Bridge] bad matrixJson for', p.productKey, e); }
      });
      if (typeof window.ppRenderProductMatrix === 'function') { try { window.ppRenderProductMatrix(); } catch (e) {} }
    }).catch(function(e) { console.warn('[Bridge] syncProductOfferMatrix:', e); });
  }
  window._apiSyncProductOfferMatrix = _syncProductOfferMatrix;

  /* Lender Email Thread (per application) — GET/POST /api/lenderemailthreads.
     Fetched on demand (when a specific application's timeline/thread view
     opens), not part of the global boot sync — mirrors how Obligations are
     fetched per-application rather than all at once. */
  window._apiFetchLenderEmailThread = function(loanApplicationId) {
    return apiReq('GET', '/lenderemailthreads/' + loanApplicationId);
  };
  window._apiAppendLenderEmailThread = function(entry) {
    return apiReq('POST', '/lenderemailthreads', entry);
  };

  /* AI Agent (Akshiv) run history (per application) — GET/POST/PUT
     /api/aiagentruns. Fetched/written on demand, same reasoning as the
     Lender Email Thread above. */
  window._apiFetchAiAgentRuns = function(loanApplicationId) {
    return apiReq('GET', '/aiagentruns/' + loanApplicationId);
  };
  window._apiStartAiAgentRun = function(loanApplicationId, runId) {
    return apiReq('POST', '/aiagentruns', { loanApplicationId: loanApplicationId, runId: runId });
  };
  window._apiUpdateAiAgentRun = function(id, patch) {
    return apiReq('PUT', '/aiagentruns/' + id, patch);
  };

  /* Report Targets — GET/POST/PUT/DELETE /api/report-targets →
     window.RPT_TARGETS (efin-app.js). Previously RPT_TARGETS was a
     hardcoded frontend-only object (const RPT_TARGETS = {...}) persisted
     only to the browser's localStorage, so any edit made from the Target
     Editor on one device/tab never appeared on another and reset to the
     hardcoded seed months on a fresh browser profile. Now backed by the
     ReportTargets table (ReportTargetsController). Same approach as
     _syncBanks: the database is the single source of truth and the object
     is replaced wholesale on each sync rather than merged key-by-key. Only
     organization-wide rows (UserId/TeamId both null) are applied — the
     Reports & Analytics page has no per-user/team target view today, so
     any future per-user/team rows are simply not surfaced here yet. */
  function _reportTargetToLocal(rt) {
    return {
      _id: rt.id,
      month: rt.targetMonth,
      disbAmt: rt.disbAmt || 0,
      loginCount: rt.loginCount || 0,
      disbCount: rt.disbCount || 0
    };
  }
  function _syncReportTargets() {
    return apiReq('GET', '/report-targets').then(function(res) {
      if (!res || !res.success || !res.data) return;
      if (typeof window.RPT_TARGETS === 'undefined') return;
      var orgWide = res.data.filter(function(rt) { return rt.userId == null && rt.teamId == null; });
      Object.keys(window.RPT_TARGETS).forEach(function(k) { delete window.RPT_TARGETS[k]; });
      orgWide.forEach(function(rt) {
        var mapped = _reportTargetToLocal(rt);
        window.RPT_TARGETS[mapped.month] = {
          disbAmt: mapped.disbAmt,
          loginCount: mapped.loginCount,
          disbCount: mapped.disbCount,
          _id: mapped._id
        };
      });
      if (typeof window.renderReports === 'function') { try { window.renderReports(); } catch (e) {} }
      // Only re-render the Target Editor rows if that panel is currently open,
      // same guard the panel's own toggle uses (see toggleTargetEditor()).
      var editorBody = document.getElementById('rpt-target-editor-body');
      if (editorBody && editorBody.style.display !== 'none' && typeof window.renderTargetEditorRows === 'function') {
        try { window.renderTargetEditorRows(); } catch (e) {}
      }
    }).catch(function(e) { console.warn('[Bridge] syncReportTargets:', e); });
  }

  /* Assignment Audit Log — GET /api/assignment-audit → window.ASSIGNMENT_AUDIT_LOG
     (efin-app.js). Previously ASSIGNMENT_AUDIT_LOG was a frontend-only
     in-memory array (`let ASSIGNMENT_AUDIT_LOG = []`), persisted only to the
     browser's localStorage, so the auto/manual assignment history recorded
     on one device/tab never appeared on another. Now backed by the
     AssignmentAuditLogs table (AssignmentAuditController). Same approach as
     _syncReportTargets/_syncBanks: the database is the single source of
     truth and the array is replaced wholesale on each sync rather than
     merged entry-by-entry — this is a read-only history view, there is
     nothing to merge. The actual POST-on-push (writing new entries) happens
     inline in efin-app.js right where ASSIGNMENT_AUDIT_LOG.push(entry) is
     called, not here — this function only ever pulls. */
  function _assignmentAuditToLocal(a) {
    return {
      id: 'AAL-' + a.id, _id: a.id,
      appId: a.loanFrontendId, _apiLoanId: a.loanApplicationId,
      location: a.location || '', loanType: a.loanType || '',
      salesPerson: a.salesPerson || '', salesTeam: a.salesTeam || '',
      candidates: (function () { try { return a.candidatesJson ? JSON.parse(a.candidatesJson) : []; } catch (_) { return []; } })(),
      assignedUser: a.assignedToUserName || null,
      method: a.method || 'unassigned',
      tieBreak: !!a.tieBreak,
      previousUser: a.previousUserName || null,
      decidedBy: a.assignedByName || 'System',
      timestamp: a.assignedAt
    };
  }
  function _syncAssignmentAuditLog(loanId) {
    var path = '/assignment-audit' + (loanId ? ('?loanId=' + encodeURIComponent(loanId)) : '');
    return apiReq('GET', path).then(function(res) {
      if (!res || !res.success || !res.data) return;
      var mapped = res.data.map(_assignmentAuditToLocal);
      var target = (typeof window.ASSIGNMENT_AUDIT_LOG !== 'undefined') ? window.ASSIGNMENT_AUDIT_LOG : (window.ASSIGNMENT_AUDIT_LOG = []);
      if (loanId) {
        // Scoped refresh (e.g. opening one application's history) — replace
        // only that application's entries, leave everything else untouched.
        for (var i = target.length - 1; i >= 0; i--) {
          if (target[i].appId === loanId) target.splice(i, 1);
        }
        Array.prototype.push.apply(target, mapped);
      } else {
        target.length = 0;
        Array.prototype.push.apply(target, mapped);
      }
    }).catch(function(e) { console.warn('[Bridge] syncAssignmentAuditLog:', e); });
  }

  /* Upload any staged (in-memory File objects) DSA/Partner documents to
     /api/dsa/{id}/documents once the record has a real backend id. Staged
     docs live in window._dsaDocs / window._pmDocs (see efin-app.js
     dsaDocUpload/pmDocUpload) keyed by docKey (+ '_back' for two-sided
     docs). Silently skips anything already uploaded or not a real File. */
  function _uploadStagedDsaDocs(apiId, docsMap) {
    if (!apiId || !docsMap) return;
    var keys = Object.keys(docsMap);
    keys.forEach(function(k) {
      var file = docsMap[k];
      if (!file || typeof File === 'undefined' || !(file instanceof File)) return;
      var fd = new FormData();
      fd.append('file', file, file.name);
      fd.append('documentType', k);
      apiReq('POST', '/dsa/' + apiId + '/documents', fd).then(function(r) {
        if (r && r.success) delete docsMap[k]; // uploaded — stop re-sending on next save
      }).catch(function(e){ console.warn('[Bridge] dsaDocUpload:', k, e); });
    });
  }

  /* Patch: dsaSave → POST/PUT /api/dsa (PartnerType: Dsa) */
  function _patchDsaSave() {
    if (window._bridgeDsaSavePatched) return;
    window._bridgeDsaSavePatched = true;
    var _orig = window.dsaSave;
    if (typeof _orig !== 'function') return;
    window.dsaSave = function() {
      // _dsaEditId is a top-level `let` in efin-app.js — not on window, but
      // shared global lexical scope since both load as classic (non-module)
      // scripts, api-bridge.js after efin-app.js. Capture it before the
      // original save handler resets it to null.
      var editId = (typeof _dsaEditId !== 'undefined') ? _dsaEditId : null;
      var nameEl = document.getElementById('dsa-f-name');
      var wasValid = nameEl && nameEl.value.trim() && document.getElementById('dsa-f-mobile') && document.getElementById('dsa-f-mobile').value.trim().length === 10;
      var result = _orig.apply(this, arguments);
      if (!wasValid) return result; // original would have shown a validation toast and returned early
      setTimeout(function() {
        var record = (window.twDSAList || []).find(function(d) {
          return editId ? d.id === editId : (d.name === nameEl.value.trim() && !d._apiId);
        });
        var payload = {
          name:  nameEl.value.trim(),
          code:  (document.getElementById('dsa-f-code')  || {}).value || '',
          email: (document.getElementById('dsa-f-email') || {}).value || '',
          phone: (document.getElementById('dsa-f-mobile')|| {}).value || '',
          city:  (document.getElementById('dsa-f-office-city') || {}).value || '',
          pan:               (document.getElementById('dsa-f-pan')              || {}).value || '',
          officeAddress:     (document.getElementById('dsa-f-office-addr')      || {}).value || '',
          officeState:       (document.getElementById('dsa-f-office-state')     || {}).value || '',
          officePin:         (document.getElementById('dsa-f-office-pin')       || {}).value || '',
          officeAddressType: (document.getElementById('dsa-f-office-addr-type')|| {}).value || '',
          isActive: (document.getElementById('dsa-f-status') || {}).value !== 'inactive',
          partnerType: 'Dsa'
        };
        var apiId = record && record._apiId;
        var req = apiId ? apiReq('PUT', '/dsa/' + apiId, payload) : apiReq('POST', '/dsa', payload);
        req.then(function(r) {
          if (r && r.success) {
            if (record && !apiId && r.data && r.data.id) record._apiId = r.data.id;
            var savedId = apiId || (r.data && r.data.id);
            if (savedId && typeof window._dsaDocs !== 'undefined') _uploadStagedDsaDocs(savedId, window._dsaDocs);
            if (typeof window.showToast === 'function') window.showToast('DSA saved to database ✓', 'success');
            setTimeout(_syncDsaPartners, 300);
          } else if (typeof window.showToast === 'function') {
            window.showToast('DSA saved locally, but database sync failed — will retry on next refresh', 'warn');
          }
        });
      }, 200);
      return result;
    };
  }

  /* Patch: pmSave → POST/PUT /api/dsa (PartnerType: Partner) */
  function _patchPartnerSave() {
    if (window._bridgePartnerSavePatched) return;
    window._bridgePartnerSavePatched = true;
    var _orig = window.pmSave;
    if (typeof _orig !== 'function') return;
    window.pmSave = function() {
      var editId = (typeof _pmEditId !== 'undefined') ? _pmEditId : null;
      var nameEl = document.getElementById('pm-f-name');
      var wasValid = nameEl && nameEl.value.trim() && document.getElementById('pm-f-mobile') && document.getElementById('pm-f-mobile').value.trim().length === 10;
      var result = _orig.apply(this, arguments);
      if (!wasValid) return result;
      setTimeout(function() {
        var record = (window.twPartnerList || []).find(function(p) {
          return editId ? p.id === editId : (p.name === nameEl.value.trim() && !p._apiId);
        });
        var payload = {
          name:  nameEl.value.trim(),
          code:  (document.getElementById('pm-f-code')  || {}).value || '',
          email: (document.getElementById('pm-f-email') || {}).value || '',
          phone: (document.getElementById('pm-f-mobile')|| {}).value || '',
          category: (document.getElementById('pm-f-type')   || {}).value || '',
          isActive: (document.getElementById('pm-f-status') || {}).value !== 'inactive',
          partnerType: 'Partner'
        };
        // mappedDsaId in the DOM/local list is the DSA's local id (e.g. 'API3' or
        // a not-yet-synced 'DSA172...'); the backend needs the numeric DsaPartner
        // id, so resolve it against twDSAList before sending.
        var mappedDsaLocalId = (document.getElementById('pm-f-dsa-id') || {}).value || '';
        if (mappedDsaLocalId) {
          var mappedDsaRecord = (window.twDSAList || []).find(function(x){ return x.id === mappedDsaLocalId; });
          if (mappedDsaRecord && mappedDsaRecord._apiId) payload.mappedDsaId = mappedDsaRecord._apiId;
        }
        var apiId = record && record._apiId;
        var req = apiId ? apiReq('PUT', '/dsa/' + apiId, payload) : apiReq('POST', '/dsa', payload);
        req.then(function(r) {
          if (r && r.success) {
            if (record && !apiId && r.data && r.data.id) record._apiId = r.data.id;
            var savedId = apiId || (r.data && r.data.id);
            if (savedId && typeof window._pmDocs !== 'undefined') _uploadStagedDsaDocs(savedId, window._pmDocs);
            if (typeof window.showToast === 'function') window.showToast('Partner saved to database ✓', 'success');
            setTimeout(_syncDsaPartners, 300);
          } else if (typeof window.showToast === 'function') {
            window.showToast('Partner saved locally, but database sync failed — will retry on next refresh', 'warn');
          }
        });
      }, 200);
      return result;
    };
  }

  /* ══════════════════════════════════════════════════════════
     5c. PAYOUT CLAIMS — submit the CURRENT user's own claims
     Backend: PayoutController.Submit (PayoutClaim table).
     SCOPE (confirmed with product owner): only the logged-in
     user's own auto-created claims are submitted, and only for
     loans that already exist in the backend (real _apiId). Claims
     auto-created locally for OTHER claimants (sales/dsa/partner/
     login users other than the current one) and claims tied to
     local-only demo loans stay local-only by design:
       • the API enforces ClaimedByUserId = the caller's own id,
         so one user can never submit a claim on another's behalf;
       • a demo loan has no row in the Loans table for the API to
         attach a claim to.
     The server recalculates ClaimAmount itself from the configured
     PayoutRule (ignores whatever the client sends unless the
     caller is Admin/Manager) — so the locally-shown amount is
     only an estimate until this sync confirms/replaces it.
  ══════════════════════════════════════════════════════════ */
  /* Pull claims FROM the database into the local PAYOUT_CLAIMS cache, so that:
     - F5 / Ctrl+F5 / browser close-reopen always show the server's copy of
       claim status/amount (server is the source of truth), and
     - claims created server-side for OTHER eligible claimants on the same
       loan (e.g. the DSA/Partner linked-user claim generated automatically
       alongside the current user's own claim — see Phase 3 multi-claimant
       logic in WizardController) become visible wherever the API scope
       (myOnly / role-based self-scoping, enforced server-side) allows it. */
  // Local (efin UI) status strings ↔ backend PayoutClaim.Status enum values.
  // Local code (PM_STATUS_META, filters, badges) uses lowercase-underscore
  // keys ('pending','approved','paid','rejected','on_hold'); the backend
  // uses ('Pending','Verified','Paid','Rejected','OnHold'). A plain
  // .toLowerCase() turns 'OnHold' into 'onhold', which none of the local
  // UI code recognizes — centralized here so pull-sync and push-sync agree.
  var _PM_STATUS_API_TO_LOCAL = { Pending:'pending', Verified:'approved', Paid:'paid', Rejected:'rejected', OnHold:'on_hold' };
  var _PM_STATUS_LOCAL_TO_API = { pending:'Pending', approved:'Verified', paid:'Paid', rejected:'Rejected', on_hold:'OnHold' };
  function _pmStatusToLocal(s) { return _PM_STATUS_API_TO_LOCAL[s] || String(s || 'pending').toLowerCase(); }
  function _pmStatusToApi(s)   { return _PM_STATUS_LOCAL_TO_API[s] || 'Pending'; }

  function _syncPayoutClaimsFromServer() {
    if (typeof window.PAYOUT_CLAIMS === 'undefined' || !Array.isArray(window.PAYOUT_CLAIMS)) return Promise.resolve();
    return apiReq('GET', '/payout').then(function(res) {
      if (!res || !res.success || !Array.isArray(res.data)) return;
      res.data.forEach(function(c) {
        var existing = PAYOUT_CLAIMS.find(function(p) { return p._apiId === c.id; });
        if (existing) {
          // Server is authoritative for status/amount/month once a claim is synced.
          existing.status       = c.status ? _pmStatusToLocal(c.status) : (existing.status || 'pending');
          existing.claimAmount  = typeof c.claimAmount === 'number' ? c.claimAmount : existing.claimAmount;
          existing.payoutAmount = typeof c.claimAmount === 'number' ? c.claimAmount : existing.payoutAmount;
          existing.claimMonth   = c.month || existing.claimMonth;
          existing.userType     = (c.claimType || existing.userType || '').toLowerCase();
          existing.vendorRemark = c.notes || existing.vendorRemark;
          return;
        }
        // A backend claim not yet mirrored locally — add it so it's visible
        // (e.g. after a fresh browser session, or a multi-claimant claim
        // created for a different claimant than the one currently logged in).
        PAYOUT_CLAIMS.push({
          id: 'API' + c.id, _apiId: c.id,
          partner: c.claimedBy || '',
          loanApac: c.loanNumber || '',
          loanRefId: c.loanNumber || '',
          customerName: c.customerName || '',
          claimMonth: c.month || '',
          claimAmount: c.claimAmount || 0,
          payoutAmount: c.claimAmount || 0,
          userType: (c.claimType || '').toLowerCase(),
          status: _pmStatusToLocal(c.status),
          vendorRemark: c.notes || '',
          createdAt: c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-IN') : '',
          isAuto: true,
          _fromServer: true
        });
      });
      if (typeof window.persistSave === 'function') { try { window.persistSave(); } catch(e){} }
      if (typeof window.renderPayoutPage === 'function') { try { window.renderPayoutPage(); } catch(e){} }
      if (typeof window.renderPayoutMgmt === 'function') { try { window.renderPayoutMgmt(); } catch(e){} }
    }).catch(function(e){ console.warn('[Bridge] syncPayoutClaimsFromServer:', e); });
  }

  function _syncOwnPayoutClaims() {
    if (typeof window.PAYOUT_CLAIMS === 'undefined' || !Array.isArray(window.PAYOUT_CLAIMS)) return;
    if (!window.currentUser || !window.currentUser.name) return;
    var myName = window.currentUser.name;
    var apps = window.APPLICATIONS || [];

    var pending = window.PAYOUT_CLAIMS.filter(function(c) {
      return c.partner === myName && !c._apiId && !c._apiSyncFailed;
    });
    if (!pending.length) return;

    pending.forEach(function(claim) {
      var app = apps.find(function(a){ return a.id === claim.loanApac || a.id === claim.loanRefId; });
      if (!app || !app._apiId) return; // local-only demo loan — nothing to attach the claim to yet

      apiReq('POST', '/payout', {
        loanId: app._apiId,
        claimAmount: claim.claimAmount || 0,
        month: claim.claimMonth || undefined,
        notes: claim.vendorRemark || '',
        // Hint only — the server derives/validates the real ClaimType from the
        // caller's own authenticated role and ignores this for non-Admin/Manager.
        claimType: claim.userType ? claim.userType.charAt(0).toUpperCase() + claim.userType.slice(1) : undefined
      }).then(function(r) {
        if (r && r.success && r.data) {
          claim._apiId = r.data.id;
          if (typeof r.data.claimAmount === 'number') claim.claimAmount = r.data.claimAmount;
          if (typeof window.persistSave === 'function') { try { window.persistSave(); } catch(e){} }
          if (typeof window.showToast === 'function') window.showToast('Payout claim submitted to database ✓', 'success');
          if (typeof window.renderPayoutPage === 'function') { try { window.renderPayoutPage(); } catch(e){} }
          if (typeof window.renderPayoutMgmt === 'function') { try { window.renderPayoutMgmt(); } catch(e){} }
        } else {
          // A duplicate-claim rejection means the loan already has a claim for
          // this user in this capacity — most likely the backend already
          // auto-created it (Phase 3 multi-claimant generation at submission
          // time). Reconcile from the server instead of treating it as a
          // failure so the local record still ends up linked to its real row.
          var msg = (r && r.message) || '';
          if (/already exists/i.test(msg)) {
            _syncPayoutClaimsFromServer();
          } else {
            // Don't retry a claim the server is actively rejecting (e.g. no
            // PayoutRule configured for this loan type) on every sync cycle.
            claim._apiSyncFailed = true;
          }
          console.warn('[Bridge] payout claim submit rejected:', msg);
        }
      }).catch(function(e){ console.warn('[Bridge] payout claim submit error:', e); });
    });
  }

  /* Patch: initPayoutFromDisbursed / autoCreatePayoutClaim → try syncing
     right after local claims are (re)computed, in addition to the
     regular post-loan-sync call below. */
  function _patchPayoutClaimCreate() {
    if (window._bridgePayoutClaimCreatePatched) return;
    window._bridgePayoutClaimCreatePatched = true;
    ['initPayoutFromDisbursed', 'autoCreatePayoutClaim'].forEach(function(fnName) {
      var _orig = window[fnName];
      if (typeof _orig !== 'function') return;
      window[fnName] = function() {
        var result = _orig.apply(this, arguments);
        setTimeout(_syncOwnPayoutClaims, 400);
        return result;
      };
    });
  }

  /* Push Management status changes (approve/reject/mark-paid/hold) to the
     server via the existing PayoutController.UpdateStatus endpoint.
     Previously quickMgmtAction/saveClaimStatus/bulkMgmtAction only mutated
     PAYOUT_CLAIMS in memory + localStorage, so a decision made by Accounts/
     Admin on one device was invisible on any other device/session — the
     next _syncPayoutClaimsFromServer() pull would just overwrite it back
     with the server's still-Pending copy. Snapshot-and-diff (rather than
     reading each function's own claimId argument/closure var) so the same
     wrapper works for all three call shapes unchanged. Same optimistic-
     with-rollback pattern as _patchTicketStatusActions. Claims with no
     _apiId (not yet synced — e.g. local-only demo loan) are left as-is,
     same scope rule as _syncOwnPayoutClaims above. */
  function _patchPayoutClaimStatusActions() {
    if (window._bridgePayoutStatusPatched) return;
    window._bridgePayoutStatusPatched = true;

    function pushStatus(claim, prevStatus) {
      if (!claim || !claim._apiId || claim.status === prevStatus) return;
      apiReq('PATCH', '/payout/' + claim._apiId + '/status', { status: _pmStatusToApi(claim.status) })
        .then(function(res) {
          if (!res || !res.success) {
            claim.status = prevStatus; // revert the optimistic local change
            if (typeof window.persistSave === 'function') { try { window.persistSave(); } catch(e){} }
            if (typeof window.renderPayoutMgmt === 'function') { try { window.renderPayoutMgmt(); } catch(e){} }
            if (typeof window.renderPayoutPage === 'function') { try { window.renderPayoutPage(); } catch(e){} }
            var msg = (res && (res.message || (res.errors && res.errors[0]))) || 'Could not update claim on the server — reverted.';
            if (typeof window.showToast === 'function') window.showToast(msg, 'error');
          } else if (typeof window.showToast === 'function') {
            window.showToast('Saved to database ✓', 'success');
          }
        })
        .catch(function() {
          claim.status = prevStatus;
          if (typeof window.persistSave === 'function') { try { window.persistSave(); } catch(e){} }
          if (typeof window.renderPayoutMgmt === 'function') { try { window.renderPayoutMgmt(); } catch(e){} }
          if (typeof window.showToast === 'function') window.showToast('Network error — claim status reverted.', 'error');
        });
    }

    ['quickMgmtAction', 'saveClaimStatus', 'bulkMgmtAction'].forEach(function(fnName) {
      var _orig = window[fnName];
      if (typeof _orig !== 'function') return;
      window[fnName] = function() {
        var list = window.PAYOUT_CLAIMS || [];
        var before = list.map(function(c) { return { id: c.id, status: c.status }; });
        var result = _orig.apply(this, arguments);
        before.forEach(function(b) {
          var c = list.find(function(x) { return x.id === b.id; });
          if (c && c.status !== b.status) pushStatus(c, b.status);
        });
        return result;
      };
    });
  }

  /* ══════════════════════════════════════════════════════════
     6. TICKETS — Sync from API into TK_STORE
  ══════════════════════════════════════════════════════════ */
  // Backend Status values are "Open" / "Closed" / "Resolved" / "In Progress"
  // (see TicketsController). The frontend badges/filters/labels
  // (TK_STATUS_BADGE etc. in efin-app.js) key off lowercase-underscore
  // strings ('open' / 'closed' / 'resolved' / 'in_progress'). Without this
  // mapping, a ticket closed or reopened via the API would sync back with a
  // status the UI doesn't recognize and silently fall back to a default
  // badge/filter bucket.
  function _tkNormalizeStatus(s) {
    return String(s || 'Open').trim().toLowerCase().replace(/\s+/g, '_');
  }

  function _syncTickets() {
    return apiReq('GET', '/tickets').then(function(res) {
      if (!res || !res.success || !res.data) return;
      if (typeof window.TK_STORE !== 'undefined' && Array.isArray(window.TK_STORE)) {
        res.data.forEach(function(t) {
          var mapped = {
            id:'API'+t.id, _apiId:t.id,
            subject:t.title, desc:t.description||'',
            priority:(t.priority||'medium').toLowerCase(), status:_tkNormalizeStatus(t.status),
            loan:t.loanId?'API'+t.loanId:null,
            customer:t.createdBy||'', assigned:t.assignedTo||'',
            assignedToUserId:t.assignedToUserId||null,
            date:_fmtDate(t.createdAt)
          };
          var existing = window.TK_STORE.findIndex(function(tk){ return tk._apiId === t.id; });
          if (existing >= 0) window.TK_STORE[existing] = Object.assign(window.TK_STORE[existing], mapped);
          else window.TK_STORE.push(mapped);
        });
        if (typeof window.twTickets !== 'undefined' && Array.isArray(window.twTickets)) {
          window.TK_STORE.forEach(function(t) {
            var tw = window.twTickets.find(function(x){ return x.id === t.id; });
            var twMapped = { id:t.id, loan:t.loan, team:(tw&&tw.team)||'General Support', customer:t.customer, assigned:t.assigned, status:t.status, date:t.date };
            if (tw) Object.assign(tw, twMapped); else window.twTickets.push(twMapped);
          });
          if (typeof window.twUpdateCounts === 'function') { try { window.twUpdateCounts(); } catch(e){} }
        }
        if (typeof window.tkRenderTable === 'function') { try { window.tkRenderTable(); } catch(e){} }
      }
    }).catch(function(e){ console.warn('[Bridge] syncTickets:',e); });
  }

  /* Patch: tkSaveTicket → POST/PUT /api/tickets
     Phase 4A fix — the previous version read tk-subject/tk-desc/tk-loan
     AFTER a 200ms delay, but the original tkSaveTicket() already clears
     those same fields synchronously as its last step. So subjectEl.value
     was always '' by the time this ran, the `if (!subjectEl.value.trim())
     return;` guard fired every time, and the POST to /api/tickets never
     actually happened — every ticket silently stayed localStorage-only
     despite the UI showing a "created" toast. Fix: capture every field
     (and the resolved loanId/assignedToUserId) BEFORE calling _orig, the
     same pattern already used by dsaSave/pmSave in this file. */
  function _patchTicketSave() {
    if (window._bridgeTicketSavePatched) return;
    window._bridgeTicketSavePatched = true;
    var _orig = window.tkSaveTicket;
    if (typeof _orig !== 'function') return;
    window.tkSaveTicket = function() {
      var subjectEl  = document.getElementById('tk-subject');
      var descEl     = document.getElementById('tk-desc');
      var priorityEl = document.getElementById('tk-priority');
      var loanEl     = document.getElementById('tk-loan');
      var assignEl   = document.getElementById('tk-assigned');

      var subject = subjectEl ? subjectEl.value.trim() : '';
      var wasValid = !!subject; // tkSaveTicket itself requires a non-empty subject

      var loanId = null;
      if (loanEl && loanEl.value) {
        var app = (window.APPLICATIONS || []).find(function(a){ return a.id === loanEl.value; });
        if (app && app._apiId) loanId = app._apiId;
      }
      var assignedToUserId = null;
      if (assignEl && assignEl.value) {
        var assignee = (window.twUsers || []).find(function(u){ return u.name === assignEl.value && u._apiId; });
        if (assignee) assignedToUserId = assignee._apiId;
      }

      var result = _orig.apply(this, arguments);
      if (!wasValid) return result; // original already showed a validation toast and returned early

      setTimeout(function() {
        // tkSaveTicket() does TK_STORE.unshift(ticket), so the row we just
        // created is the newest one still lacking an _apiId.
        var record = (window.TK_STORE || []).find(function(t) {
          return !t._apiId && t.subject === subject;
        });
        apiReq('POST', '/tickets', {
          title:            subject,
          description:      descEl ? descEl.value.trim() : '',
          priority:         priorityEl ? priorityEl.value : 'medium',
          loanId:           loanId,
          assignedToUserId: assignedToUserId
        }).then(function(r) {
          if (r && r.success && r.data && r.data.id) {
            if (record) record._apiId = r.data.id;
            if (typeof window.showToast === 'function') window.showToast('Ticket saved to database ✓', 'success');
            if (typeof window.persistSave === 'function') { try { window.persistSave(); } catch(_) {} }
            setTimeout(_syncTickets, 300);
          } else if (typeof window.showToast === 'function') {
            window.showToast('Ticket saved locally, but database sync failed — will retry on next refresh', 'warn');
          }
        }).catch(function() {
          if (typeof window.showToast === 'function') {
            window.showToast('Ticket saved locally, but database sync failed — will retry on next refresh', 'warn');
          }
        });
      }, 200);
      return result;
    };
  }

  /* Phase 4B — Close/Reopen/Resolve → real PATCH/PUT calls.
     Previously these three only mutated TK_STORE/twTickets in memory (and
     tkClose even deleted the row outright) with no server call at all, so
     the status "persisted" only in localStorage and reverted on the next
     API sync / another browser. Same capture-before-call pattern as
     _patchTicketSave: read what's needed, call _orig for instant UI
     feedback, then persist — rolling the local state back and toasting an
     error if the server rejects it (wrong role, already-closed race, etc).
     window._bridgeTicketStatusPatched flags to efin-app.js that these are
     wired, so its own fallback "(local only)" toast doesn't double up. */
  function _patchTicketStatusActions() {
    if (window._bridgeTicketStatusPatched) return;
    window._bridgeTicketStatusPatched = true;

    function wrap(fnName, apply) {
      var _orig = window[fnName];
      if (typeof _orig !== 'function') return;
      window[fnName] = function(id, btnEl) {
        var t = (window.TK_STORE || []).find(function(x){ return x.id === id; });
        var prevStatus = t ? t.status : null;
        var prevTwStatus = null;
        var tw = t ? (window.twTickets || []).find(function(x){ return x.id === id; }) : null;
        if (tw) prevTwStatus = tw.status;

        var result = _orig.apply(this, arguments);
        if (!t || !t._apiId) return result; // not synced yet — local-only, nothing to call
        if (t.status === prevStatus) return result; // tkClose/tkReopen's confirm() was cancelled — nothing changed, don't call the API

        if (btnEl) btnEl.disabled = true;
        apply(t._apiId).then(function(res) {
          if (btnEl) btnEl.disabled = false;
          if (res && res.success) {
            if (typeof window.showToast === 'function') window.showToast('Saved to database ✓', 'success');
            setTimeout(_syncTickets, 300);
          } else {
            // Roll back the optimistic local change and re-render.
            if (t) t.status = prevStatus;
            if (tw) tw.status = prevTwStatus;
            if (typeof window.twUpdateCounts === 'function') { try { window.twUpdateCounts(); } catch(e){} }
            if (typeof window.tkRenderTable === 'function') { try { window.tkRenderTable(); } catch(e){} }
            if (typeof window.persistSave === 'function') { try { window.persistSave(); } catch(e){} }
            var msg = (res && res.errors && res.errors[0]) || 'Could not update ticket — reverted.';
            if (typeof window.showToast === 'function') window.showToast(msg, 'error');
          }
        }).catch(function() {
          if (btnEl) btnEl.disabled = false;
          if (t) t.status = prevStatus;
          if (tw) tw.status = prevTwStatus;
          if (typeof window.twUpdateCounts === 'function') { try { window.twUpdateCounts(); } catch(e){} }
          if (typeof window.tkRenderTable === 'function') { try { window.tkRenderTable(); } catch(e){} }
          if (typeof window.persistSave === 'function') { try { window.persistSave(); } catch(e){} }
          if (typeof window.showToast === 'function') window.showToast('Network error — ticket status reverted.', 'error');
        });
        return result;
      };
    }

    wrap('tkClose',   function(apiId){ return apiReq('PATCH', '/tickets/'+apiId+'/close'); });
    wrap('tkReopen',  function(apiId){ return apiReq('PATCH', '/tickets/'+apiId+'/reopen'); });
    wrap('tkResolve', function(apiId){ return apiReq('PUT', '/tickets/'+apiId, { status: 'Resolved' }); });
  }

  /* Phase 4B — Ticket comments/notes/activity. */
  window._tkFetchComments = function(apiTicketId) {
    return apiReq('GET', '/tickets/'+apiTicketId+'/comments').then(function(res) {
      return (res && res.success && res.data) ? res.data : [];
    });
  };
  window._tkPostComment = function(apiTicketId, content) {
    return apiReq('POST', '/tickets/'+apiTicketId+'/comments', { content: content }).then(function(res) {
      return !!(res && res.success);
    });
  };

  /* Phase 4B — safe one-time migration of pre-4B localStorage ticket data.
     Data-safety rule: never silently delete a locally-held ticket that
     never made it to the server. On first run after upgrade, read the OLD
     ticket localStorage keys directly (persistLoad/persistSave no longer
     touch them), find entries with no _apiId (i.e. created before the
     Phase 4A create-sync existed, or created while offline), and POST each
     one to /api/tickets. Only clear the legacy key once every entry in it
     is confirmed synced; otherwise leave it in place and warn so the data
     is never silently lost. */
  function tkMigrateLegacyLocalTickets() {
    if (window._bridgeTicketMigrationDone) return;
    window._bridgeTicketMigrationDone = true;
    try {
      var raw = localStorage.getItem('efin_v22_ticket_store');
      var legacy = raw ? JSON.parse(raw) : null;
      if (!Array.isArray(legacy) || !legacy.length) { if (raw) localStorage.removeItem('efin_v22_ticket_store'); return; }

      var unsynced = legacy.filter(function(t) { return t && !t._apiId; });
      if (!unsynced.length) { localStorage.removeItem('efin_v22_ticket_store'); return; }

      console.info('[Bridge] Migrating '+unsynced.length+' pre-Phase-4B local-only ticket(s) to the server…');
      Promise.all(unsynced.map(function(t) {
        return apiReq('POST', '/tickets', {
          title: t.subject || '(untitled ticket)',
          description: t.desc || '',
          priority: t.priority || 'medium'
        }).then(function(r){ return !!(r && r.success); }).catch(function(){ return false; });
      })).then(function(results) {
        var allOk = results.every(Boolean);
        if (allOk) {
          localStorage.removeItem('efin_v22_ticket_store');
          if (typeof window.showToast === 'function') window.showToast(unsynced.length+' local ticket(s) migrated to the database ✓', 'success');
          setTimeout(_syncTickets, 300);
        } else {
          // Leave the legacy key in place — do NOT delete unsynced data —
          // and report clearly instead of pretending it succeeded.
          console.warn('[Bridge] Ticket migration incomplete — some local tickets could not be synced and were left in localStorage (key: efin_v22_ticket_store) for retry.');
          if (typeof window.showToast === 'function') window.showToast('Some local tickets could not be migrated to the database — will retry next load', 'warn');
        }
      });
    } catch (e) {
      console.warn('[Bridge] Ticket migration check failed:', e);
    }
  }

  /* ══════════════════════════════════════════════════════════
     7. REPORTS — Fetch from API instead of calculating locally
  ══════════════════════════════════════════════════════════ */
  function _patchReports() {
    if (window._bridgeReportsPatched) return;
    window._bridgeReportsPatched = true;
    var _orig = window.renderReports;
    if (typeof _orig !== 'function') return;
    window.renderReports = function() {
      // Call original (shows local data immediately)
      _orig.apply(this, arguments);
      // Then enrich with real API data
      Promise.all([
        apiReq('GET', '/reports/pipeline'),
        apiReq('GET', '/reports/performance'),
        apiReq('GET', '/reports/disbursement')
      ]).then(function(results) {
        var pipeline = results[0], perf = results[1], disb = results[2];
        // Inject API report data into DOM if available
        if (pipeline && pipeline.success && pipeline.data) {
          var totalEl = document.getElementById('rpt-total-apps');
          if (totalEl) totalEl.textContent = pipeline.data.total || totalEl.textContent;
        }
        if (perf && perf.success && perf.data) {
          var convEl = document.getElementById('rpt-conversion-rate');
          if (convEl) convEl.textContent = (perf.data.conversionRate || 0).toFixed(1) + '%';
        }
        if (disb && disb.success && disb.data) {
          var disbEl = document.getElementById('rpt-total-disbursed');
          if (disbEl) disbEl.textContent = '₹' + Number(disb.data.totalDisbursed || 0).toLocaleString('en-IN');
        }
      }).catch(function(e){ console.warn('[Bridge] reports API:', e); });
    };
  }

  /* ══════════════════════════════════════════════════════════
     8. CHANGE PASSWORD — Route to /api/users/change-password
     ------------------------------------------------------------
     Historically this attached a SECOND, independent click listener
     to the same "Update Password" button that efin-app.js's
     cpSavePassword() is wired to (onclick="cpSavePassword()"), which
     matched here via the [onclick*="cpSave"] selector. Both handlers
     fired on every click: this one made the real backend call, while
     cpSavePassword() separately wrote a password hash straight into
     localStorage and showed its own "success" toast unconditionally
     — so a backend failure could still be reported to the user as a
     success. cpSavePassword() in efin-app.js is now the single,
     backend-driven source of truth for this flow (it calls
     /api/users/change-password itself and only reports success after
     the backend confirms it), so this duplicate listener has been
     removed. Left as a no-op stub so the DOMContentLoaded call site
     below doesn't need to change and nothing else that references
     window._bridgeCpPatched breaks.
  ══════════════════════════════════════════════════════════ */
  function _patchChangePassword() {
    window._bridgeCpPatched = true;
  }

  /* ══════════════════════════════════════════════════════════
     9. STATUS CHANGES → API (approve / reject / disburse / status)
  ══════════════════════════════════════════════════════════ */
  /* Reports whether a backend-write attempt actually has a chance of
     reaching the server. If the fallback (offline/local-only) login was
     used, there is no real JWT — every write silently 401s. Surfacing
     that up front means the user finds out immediately instead of the
     UI quietly diverging from the database. */
  function _isOfflineSession() {
    return !_token();
  }

  function _statusActionLabel(newStatus) {
    if (newStatus === 'approved')  return 'Approval';
    if (newStatus === 'rejected')  return 'Rejection';
    if (newStatus === 'disbursed') return 'Disbursement';
    return 'Status change';
  }

  function _patchStatusChange() {
    if (window._bridgeStatusPatched) return;
    window._bridgeStatusPatched = true;
    var _orig = window.confirmStatusChange;
    if (typeof _orig !== 'function') return;
    window.confirmStatusChange = function(id, newStatus) {
      var app = (window.APPLICATIONS||[]).find(function(a){ return a.id===id; });
      if (app && app._apiId) {
        var label = _statusActionLabel(newStatus);

        if (_isOfflineSession()) {
          // No real session token (e.g. logged in via offline fallback while
          // the backend was unreachable) — a write call cannot succeed. Warn
          // clearly instead of pretending it was saved.
          _wizardToast('⚠ ' + label + ' NOT saved — you are in offline mode (no server session). Please sign in again once the server is reachable.', 'warn');
        } else {
          var apiStatus = STATUS_REV[newStatus];
          var req;
          if (newStatus==='approved')       req = apiReq('PATCH','/loans/'+app._apiId+'/approve',{approvedAmount:app.amount,comment:'Approved via EFIN'});
          else if (newStatus==='rejected')  req = apiReq('PATCH','/loans/'+app._apiId+'/reject',{reason:'Rejected via EFIN'});
          else if (newStatus==='disbursed') req = apiReq('PATCH','/loans/'+app._apiId+'/disburse');
          else if (apiStatus)               req = apiReq('PATCH','/loans/'+app._apiId+'/status',{newStatus:apiStatus,comment:apiStatus+' via EFIN'});

          if (req) {
            req.then(function(r) {
              if (!r || r.success === false) {
                var msg = (r && (r.message || (r.errors && r.errors.join(' ')))) || 'Could not reach the server.';
                app._dbSyncFailed  = true;
                app._dbSyncMessage = msg;
                console.warn('[Bridge] ' + label + ' NOT saved to database:', msg);
                _wizardToast('⚠ ' + label + ' NOT saved to database: ' + msg, 'warn');
              } else {
                app._dbSyncFailed  = false;
                app._dbSyncMessage = '';
                // Database is the source of truth for the resulting state
                // (status, tracking history, computed fields) — reload
                // from GET /api/loans rather than trusting the local
                // optimistic update to have gotten everything right.
                _syncLoans();
              }
            });
          }
        }
      }
      return _orig.apply(this, arguments);
    };
  }

  /* ══════════════════════════════════════════════════════════
     LOGIN
  ══════════════════════════════════════════════════════════ */
  window.doLogin = function doLogin() {
    var emailEl = document.getElementById('login-user');
    var passEl  = document.getElementById('login-password');
    var errEl   = document.getElementById('login-error');
    var btn     = document.querySelector('.login-btn');
    var email   = emailEl ? emailEl.value.trim().toLowerCase() : '';
    var password= passEl  ? passEl.value : '';

    if (!email || !password) {
      if (errEl) { errEl.textContent = '✕ Enter email and password.'; errEl.style.display='block'; }
      return;
    }
    if (btn) { btn.disabled=true; btn.textContent='Signing in…'; }

    fetch(BASE+'/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:email,password:password}) })
      .then(function(r){ return r.json(); })
      .then(function(data) {
        if (btn) { btn.disabled=false; btn.textContent='Sign In →'; }
        if (!data || !data.success) {
          // API is the only source of truth for auth — no local/offline
          // fallback. Surface the server's actual error and stop; never
          // grant a session from anything stored client-side.
          var msg = (data && (data.message || (data.errors && data.errors.join(' ')))) || 'Invalid email or password.';
          if (errEl) { errEl.textContent = '✕ ' + msg; errEl.style.display = 'block'; }
          if (passEl) { passEl.value = ''; }
          // Mirror the failure into the local lockout counter used only for
          // the instant "Xm Ys remaining" countdown display — the actual
          // 5-attempts/15-minute lock is enforced server-side
          // (AuthController.Login, backed by the LoginAttempts table), so
          // this can never be bypassed by clearing localStorage or using a
          // different browser; it just avoids a round trip to show the
          // countdown on subsequent tries within the same tab.
          try {
            var lockState = JSON.parse(localStorage.getItem('efin_login_lock') || 'null') || { count: 0, ts: 0 };
            lockState = { count: (lockState.count || 0) + 1, ts: Date.now() };
            localStorage.setItem('efin_login_lock', JSON.stringify(lockState));
          } catch (_) {}
          return;
        }
        // Save auth state in Zustand persist middleware format
        // Zustand wraps persisted state in { state: {...}, version: 0 }
        // NOTE: hasHydrated is NOT persisted — Zustand manages it independently
        // on each load. It must always start false so ProtectedRoute waits for rehydration.
        var zustandardAuthState = {
          state: {
            accessToken: data.data.accessToken,
            refreshToken: data.data.refreshToken,
            user: data.data.user,
            isAuthenticated: true
          },
          version: 0
        };
        _lsSet(LS_AUTH, JSON.stringify(zustandardAuthState));
        // Keep the legacy loanms_token key in sync with the real access
        // token. efin_auth (above) is the actual source of truth, but many
        // parts of the app (Settings pages, Expert Export access-check,
        // session-restore gates) read loanms_token specifically — without
        // this, that token key stayed empty forever after a real login,
        // silently 401'ing all of those features even for a logged-in user.
        _lsSet('loanms_token', data.data.accessToken);
        try { localStorage.removeItem('efin_login_lock'); } catch (_) {}
        var u = data.data.user;
        var efinRole = ROLE_MAP[u.role] || 'sales_executive';
        var userEmail = u.email.toLowerCase();

        if (typeof window.USER_ACCOUNTS !== 'undefined') {
          var existing = window.USER_ACCOUNTS.filter(function(x){ return x.email===userEmail; });
          if (existing.length===0) window.USER_ACCOUNTS.push({ email:userEmail, name:u.fullName, role:efinRole, _hash:'bridge_auth' });
          else { existing[0].name=u.fullName; existing[0].role=efinRole; existing[0]._hash='bridge_auth'; }
        }

        _lsSet('efin_session', JSON.stringify({ name:u.fullName, role:efinRole, email:userEmail, loginTs:Date.now(), _apiId:u.id }));
        window.currentUser = { name:u.fullName, role:efinRole, email:userEmail };
        if (errEl) errEl.style.display='none';
        var ls = document.getElementById('login-screen');
        if (ls) ls.style.display='none';
        _refreshUI();
        setTimeout(function(){
          if (typeof window.showToast==='function') window.showToast('Welcome back, '+u.fullName+'! 👋','success');
        }, 200);
        // Sync all data from API
        setTimeout(function() {
          _syncLoans();
          _syncUsers();
          _syncTeams();
          _syncLocations();
          _syncTasks();
          _syncTickets();
          _syncDsaPartners();
          _syncRmEmails();
          _syncBanks();
          _syncReportTargets();
          _syncAssignmentAuditLog();
          _syncRejectionReasons();
          _syncEmailTemplates();
          _syncProductOfferMatrix();
          // Wizard drafts (DB-backed, WizardController.ListDrafts) — one-shot
          // pull on login, same as every other entity above. Populates the
          // Applications → Drafts list from the server so a draft started on
          // another device is visible/resumable here too.
          _syncWizardDrafts();
          // Roles & permissions (ROLES / roleMenuVisibility) — previously
          // only synced when the Settings → Access tab was opened, so a
          // permission change made by one admin didn't apply anywhere else
          // until that tab happened to be visited. Now part of the regular
          // boot sync, same as every other entity above. Re-run
          // applySession() once the pull resolves so the sidebar (already
          // built once, above, from defaults) picks up whatever the server
          // actually has — otherwise a fresh login still shows the stale
          // pre-sync nav until the next full page reload.
          if (typeof window.stgSyncPermissionsFromServer === 'function') {
            window.stgSyncPermissionsFromServer().then(function() {
              if (typeof window.applySession === 'function') window.applySession();
            });
          }
          // Profile (PhoneNumber/PhotoData, DB-backed) — one-shot pull on
          // login, same as every other entity above. Function itself is
          // defined in user-profile.js and exposed on window.
          if (typeof window._pullProfileFromServer === 'function') window._pullProfileFromServer();
          setTimeout(function() { _syncPayoutClaimsFromServer().then(_syncOwnPayoutClaims); }, 1500); // after loans have _apiId populated
          setTimeout(tkMigrateLegacyLocalTickets, 1000);
        }, 800);
      })
      .catch(function(err) {
        // Network error (backend unreachable). No local/offline fallback —
        // the API is the only source of truth for auth, so we surface the
        // failure instead of silently granting a client-side-only session.
        console.warn('[Bridge] API unreachable, login cannot proceed:', err);
        if (btn) { btn.disabled=false; btn.textContent='Sign In →'; }
        if (errEl) { errEl.textContent = '✕ Could not reach the server. Please check your connection and try again.'; errEl.style.display = 'block'; }
      });
  };

  window._apiLogout = function() {
    var tok = _token();
    if (tok) fetch(BASE+'/auth/logout',{method:'POST',headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'}}).catch(function(){});
    _clearAuth(); _lsRemove('efin_session'); location.reload();
  };

  /* ══════════════════════════════════════════════════════════
     DOMContentLoaded — apply all patches, validate token, sync
  ══════════════════════════════════════════════════════════ */
  document.addEventListener('DOMContentLoaded', function() {
    var fro = document.getElementById('efin-first-run-overlay');
    if (fro) fro.remove();

    // Apply all workflow patches after all JS has loaded
    setTimeout(function() {
      _patchStatusChange();
      _patchTwSaveUser();
      _patchTwSaveUserDetail();
      _patchTeamSave();
      _patchTeamArchive();
      _patchLocationSave();
      _patchLocationRename();
      _patchLocationDelete();
      _patchTaskDone();
      _patchTicketSave();
      _patchTicketStatusActions();
      _patchDsaSave();
      _patchPartnerSave();
      _patchLaConfirmAddBank();
      _patchLaDeleteBank();
      _patchLaSaveBankDetails();
      _patchLaLineAdds();
      _patchLaDeleteLine();
      _patchLaConfirmAddCompany();
      _patchLaUpdateCompany();
      _patchLaDeleteCompany();
      _patchLaCategoryFns();
      _patchPushNotif();
      _patchNotifPanelOpen();
      _patchNotifReadFns();
      _patchPayoutClaimCreate();
      _patchPayoutClaimStatusActions();
      _patchReports();
      _patchChangePassword();
      _patchWizardSubmit();
      _patchCibilCheck();
      _patchPayoutPreview();
      _patchReportsToApi();
      _patchOpenDetailCibil();
      _patchOpenDetailPerfios();
      _patchStatusNotify();
      _patchOpenDetailObligations();
      _patchObligationSave();
      _patchObligationDelete();
      _patchObligationFieldEdit();
    }, 2500);

    // If already logged in, validate token and sync all data
    var tok  = _token();
    var sess = _lsGet('efin_session');
    if (tok && sess) {
      apiReq('GET', '/auth/me').then(function(r) {
        if (r && r.success) {
          // ── Repopulate currentUser + refresh profile UI on session restore ──
          // Previously this branch only re-synced data lists and never set
          // window.currentUser or called applySession()/updateGreeting(), so
          // after a page refresh (as opposed to a fresh login) the topbar
          // avatar, profile dropdown name, and dashboard greeting stayed on
          // their static HTML placeholders ("User Name" / default "AG" / a
          // hardcoded "Admin" greeting fallback) even though the session was
          // perfectly valid. /auth/me only returns Id/Email/Role (no display
          // name), so the display name comes from the locally stored
          // efin_session (saved at login time); role/email are refreshed
          // from the server response since those are the authoritative copy.
          try {
            var s = JSON.parse(sess);
            var efinRole = ROLE_MAP[r.data.role] || s.role || 'sales_executive';
            var email    = (r.data.email || s.email || '').toLowerCase();
            // Fallback when the cached snapshot has no name: derive from the
            // email's local part rather than a literal 'Admin' string, which
            // previously displayed the word "Admin" for ANY logged-in user
            // (not just admins) whenever s.name was missing/empty — the same
            // class of stale/wrong-placeholder bug this restore path exists
            // to fix. Mirrors the fallback already used in applySession().
            var _displayName = s.name || (email ? email.split('@')[0] : 'User');
            window.currentUser = { name: _displayName, role: efinRole, email: email };
            if (typeof window.applySession === 'function') window.applySession();
            if (typeof window.updateGreeting === 'function') window.updateGreeting();
          } catch (e) {
            console.warn('[Bridge] Session-restore UI refresh failed:', e);
          }
          setTimeout(function() {
            _syncLoans();
            _syncUsers();
            _syncTeams();
            _syncLocations();
            _syncTasks();
            _syncTickets();
            _syncDsaPartners();
            _syncRmEmails();
            _syncBanks();
            _syncReportTargets();
            _syncAssignmentAuditLog();
            _syncRejectionReasons();
            _syncEmailTemplates();
            _syncProductOfferMatrix();
            // See the matching comment in the login-success sync block above.
            _syncWizardDrafts();
            if (typeof window.stgSyncPermissionsFromServer === 'function') {
              window.stgSyncPermissionsFromServer().then(function() {
                if (typeof window.applySession === 'function') window.applySession();
              });
            }
            if (typeof window._pullProfileFromServer === 'function') window._pullProfileFromServer();
            setTimeout(function() { _syncPayoutClaimsFromServer().then(_syncOwnPayoutClaims); }, 1500);
            setTimeout(tkMigrateLegacyLocalTickets, 1400);
          }, 1200);
        } else {
          // Invalid/expired JWT — clear the auth tokens AND the locally
          // cached session display data (name/role/email), so no stale
          // per-user info is left behind after a failed restore. (Manual
          // logout via window._apiLogout already did this; automatic
          // invalidation during session-restore previously did not.)
          _clearAuth();
          _lsRemove('efin_session');
          if (typeof window.applySession === 'function') { try { window.currentUser = null; window.applySession(); } catch (e) {} }
          // Also undo the optimistic client-side restore's visual state:
          // session-preload.js/boot.js already added 'has-session' (which
          // hides #login-screen via CSS) and rendered the dashboard from the
          // locally cached snapshot before this async /auth/me check came
          // back. Without removing 'has-session' and re-showing the login
          // screen here, an invalid/expired session left the user staring
          // at a fully rendered (but now unauthenticated) dashboard with no
          // indication they were logged out. Mirrors doLogout()'s same two
          // steps (remove has-session, reload) for a consistent logged-out
          // state, without altering any auth/business logic.
          document.documentElement.classList.remove('has-session');
          // Also clear the stale route hash — mirrors doLogout()'s
          // `location.hash = ''`. Without this, the reload below lands back
          // on e.g. '/#login-teams' with no session: the URL still shows a
          // restorable-looking route while the login screen renders, which
          // looks like "refresh logged me out but kept my page open" rather
          // than a clean, obvious logout.
          location.hash = '';
          location.reload();
        }
      });
    }
  });



  /* ══════════════════════════════════════════════════════════
     WIZARD SUBMIT → API (saves to DB, not just localStorage)

     Reliability notes (see fix history):
     - The exact application created by THIS submit call is captured
       synchronously (by diffing APPLICATIONS before/after the original
       submitWizard() call), never by blindly reading APPLICATIONS[0]
       later. This removes the dependency on array position and makes
       the 500ms async delay before the network call harmless, since we
       already hold a direct object reference by then.
     - Each captured application gets a one-time in-memory sync token
       (_bridgeSyncToken) and an in-flight guard (_bridgeSyncInFlight)
       so a given application can never be POSTed twice concurrently.
     - Transient failures (network errors / no response) are retried
       with backoff up to WIZARD_MAX_ATTEMPTS; definitive backend
       failures (validation errors, "already submitted", etc.) are
       NOT retried since retrying identical data cannot succeed.
     - "Success" is only ever reported to the user once the backend
       has confirmed persistence (r.success === true). A transient or
       exhausted-retry failure is always surfaced as "pending sync" /
       "not saved to server" — never silently swallowed, never shown
       as a false success.
  ══════════════════════════════════════════════════════════ */
  var WIZARD_MAX_ATTEMPTS  = 4;                    // 1 initial attempt + 3 retries
  var WIZARD_RETRY_DELAYS  = [3000, 8000, 20000];  // backoff (ms) before retries 1,2,3

  function _wizardToast(msg, type) {
    if (typeof window.showToast === 'function') {
      try { window.showToast(msg, type); } catch(e) {}
    }
  }

  function _buildWizardPayload(app) {
    return {
      // If a prior attempt for THIS submission already got a loanId back
      // from the server (see _apiId below), resend it so the backend's
      // existing "resume by LoanId" path is used instead of creating a
      // second loan. On a brand-new application this is undefined/omitted.
      // app._draftLoanId (see the wizard-draft autosave block below) covers
      // the other case: this application started life as an autosaved
      // Draft-status loan in the database (WizardController.SaveDraft) —
      // sending that same id here makes Submit() resume/complete THAT
      // record instead of leaving it behind as an orphaned Draft while a
      // brand-new Submitted loan is created alongside it.
      loanId:      app._apiId || app._draftLoanId || undefined,
      fullName:    app.name  || '',
      mobile:      app.mobile || '',
      email:       app.email  || '',
      pan:         app.pan    || '',
      aadhar:      app.aadhar || '',
      dob:         app.dob    || '',
      gender:      app.gender || '',
      cibil:       app.cibil  || 0,
      city:        app.city   || '',
      state:       app.state  || '',
      street1:     app.street1 || '',
      zip:         app.zip    || '',
      homeType:    app.homeType || '',
      empType:     app.empType || 'SALARIED',
      compName:    app.compName || '',
      compType:    app.compType || '',
      salary:      app.salary  || 0,
      desig:       app.desig   || '',
      officeEmail: app.officeEmail || '',
      loanType:    app.loanType || 'personal_loan',
      amount:      app.amount  || 0,
      loanRate:    app.loanRate || 12,
      tenure:      parseInt(app.tenure) || 24,
      purpose:     app.purpose || '',
      r1Name:      app.r1name  || '',
      r1Mobile:    app.r1no    || '',
      r1Relation:  app.r1rel   || '',
      r2Name:      app.r2name  || '',
      r2Mobile:    app.r2no    || '',
      r2Relation:  app.r2rel   || '',
      salesPerson: app.sales   || '',
      source:      app.source  || 'Direct',
      channel:     app.channel || 'walk-in',
      lenderName:  app.bank    || '',
      efinId:      app.id      || '',
      // BUGFIX (wizard bug sweep): these three were never sent on final
      // Submit — only _buildWizardDraftPayload (autosave) resolved them.
      // Usually harmless because WizardController.Submit()'s ApplyMapping
      // only overwrites a field when the incoming dto actually supplies a
      // value (so a value already saved by an earlier autosave survives),
      // but a session where DSA/Partner/Location was picked/changed on the
      // very last step — with no autosave cycle in between — would submit
      // with that mapping silently missing. Same resolution helpers
      // (_stripApiPrefixId / _resolveLocationIdByName) already used by the
      // draft payload just above, applied here too, reading the same
      // app.dsaId/app.partnerId/app.location fields submitWizard() sets on
      // the application object (see newApp construction, efin-app.js).
      dsaId:       _stripApiPrefixId(app.dsaId),
      partnerId:   _stripApiPrefixId(app.partnerId),
      locationId:  _resolveLocationIdByName(app.location),
      // Product-specific fields (Insurance/Property/Vehicle/Education) —
      // confirmed real gap, never sent at all before. Only include keys
      // that are actually set, so this stays empty (and ApplyMapping's
      // Count>0 check skips it) for loan types that don't use any of these.
      productData: (function() {
        var keys = ['insType','insInsurer','insPremium','insPayFreq','insNomineeName','insNomineeRel',
          'insNomineeDob','insExistingCov','insExistingPol','insExistingNo',
          'propType','propOwnership','propUnderConstruct','propBuilder','propCity','propValue',
          'carMake','carModel','carYear','carPrice','carKm','carDealer',
          'eduInstitution','eduCourse','eduDuration','eduAdmissionStatus','eduStudyLocation','eduCoApplicant',
          // Confirmed real gap (second pass) — Permanent Address, Co-Applicant,
          // Reference addresses, Business-loan fields, Insurance health-fields,
          // Employment office-address, and a few remaining Personal fields. No
          // dedicated column exists for any of these, same reasoning as the
          // fields above — reusing this same flexible blob rather than adding
          // 6+ separate migrations for what's fundamentally the same kind of gap.
          'mname','mname2','empcode','leadsrc',
          'pstreet1','pstreet2','pcity','pstate','pzip','phometype','sameAddr',
          'coappName','coappPan','coappAadhar','coappMobile',
          'coapplicantEmail','coapplicantMobile','coapplicantPan','coapplicantRel',
          'r1addr1','r1addr2','r1city','r1pin','r2addr1','r2addr2','r2city','r2pin',
          'bizName','bizType','bizVintage','gst','turnover','netProfit','itrFiled',
          'heightCm','weightKg','smoker','occHazard','sumAssured','policyTerm',
          'officeaddrL1','officeaddrL2','officeaddrPin',
          'street2','phone','preexisting','preexistingDesc',
          'officeaddrL1Self','officeaddrL2Self','officeaddrPinSelf',
          'isCustomCompany','companyNameId','comptypeSelf','profBody','coapplicant','nomineeId',
          'dsaPartnerLinkedId'];
        var out = {};
        keys.forEach(function(k) { if (app[k] !== undefined && app[k] !== null && app[k] !== '') out[k] = app[k]; });
        return out;
      })()
    };
  }

  /* Marks the application's backend-sync state. Kept as plain fields on
     the app object (distinct from the business `status` field) so any
     UI can read them without us touching rendering code. */
  function _setWizardSyncState(app, state, message) {
    app._dbSyncPending = (state === 'pending');
    app._dbSynced       = (state === 'synced');
    app._dbSyncFailed   = (state === 'failed');
    app._dbSyncMessage  = message || '';
  }

  function _attemptWizardBackendSubmit(app, token, attempt) {
    // Guard: a different code path already finished this exact submission.
    if (app._bridgeSyncToken !== token) return;
    if (app._dbSynced) return;

    var payload = _buildWizardPayload(app);

    apiReq('POST', '/wizard/submit', payload).then(function(r) {
      // If something else already completed this token in the meantime
      // (shouldn't happen given the in-flight guard, but stay defensive).
      if (app._bridgeSyncToken !== token) return;

      if (r && r.success) {
        // ── Confirmed backend persistence ──
        app._apiId     = r.data.loanId;
        app.id         = r.data.loanNumber || ('EFIN' + String(r.data.loanId).padStart(6, '0'));
        app.loanNumber = r.data.loanNumber;
        app.monthlyEmi = r.data.monthlyEmi;
        app._bridgeSyncInFlight = false;
        _setWizardSyncState(app, 'synced');
        _wizardToast('Application ' + r.data.loanNumber + ' saved to database ✓', 'success');
        if (typeof window.persistSave === 'function') window.persistSave();
        _syncLoans();
        return;
      }

      if (r && r.success === false) {
        // Definitive backend response. A message telling us this exact
        // loan was already submitted means an earlier attempt actually
        // succeeded server-side (we just never saw that response) — that
        // is a success, not a failure, so don't report it as one.
        var msg = (r.message || (r.errors && r.errors.join(' ')) || 'Backend rejected the application.');
        if (app._apiId && /already been submitted|already submitted/i.test(msg)) {
          app._bridgeSyncInFlight = false;
          _setWizardSyncState(app, 'synced');
          _wizardToast('Application already saved to database ✓', 'success');
          if (typeof window.persistSave === 'function') window.persistSave();
          _syncLoans();
          return;
        }
        // Real validation/business failure — retrying identical data
        // cannot succeed, so stop here instead of looping. This app was
        // never actually persisted to the database, so remove it from the
        // visible list instead of leaving a "phantom" application that only
        // ever existed in this browser's local state — this mismatch (looked
        // saved on this device, never existed on any other device) was the
        // root cause of the cross-device sync confusion.
        app._bridgeSyncInFlight = false;
        _setWizardSyncState(app, 'failed', msg);
        console.warn('[Bridge] Wizard DB save rejected:', msg);
        _wizardToast('⚠ Application NOT saved — ' + msg + ' Please correct and resubmit.', 'error');
        if (window.APPLICATIONS) {
          var _failIdx = APPLICATIONS.indexOf(app);
          if (_failIdx !== -1) APPLICATIONS.splice(_failIdx, 1);
        }
        if (typeof window.persistSave === 'function') window.persistSave();
        if (typeof updateDashboardStats === 'function') updateDashboardStats();
        if (typeof renderTable === 'function') renderTable();
        return;
      }

      // ── r === null: transport/network failure — unknown server state ──
      if (attempt < WIZARD_MAX_ATTEMPTS) {
        _setWizardSyncState(app, 'pending', 'Retrying backend sync (attempt ' + (attempt + 1) + ' of ' + WIZARD_MAX_ATTEMPTS + ')…');
        var delay = WIZARD_RETRY_DELAYS[Math.min(attempt - 1, WIZARD_RETRY_DELAYS.length - 1)];
        setTimeout(function () {
          _attemptWizardBackendSubmit(app, token, attempt + 1);
        }, delay);
      } else {
        app._bridgeSyncInFlight = false;
        _setWizardSyncState(app, 'failed', 'Could not reach the server after multiple attempts.');
        console.warn('[Bridge] Wizard DB save failed after ' + WIZARD_MAX_ATTEMPTS + ' attempts:', app.id);
        _wizardToast('⚠ Application saved locally only — backend sync failed after retries. It will remain marked as pending until sync succeeds.', 'warn');
      }
    });
  }

  /* Allows a manual, safe re-trigger of the sync for an application that
     ended up in a failed/pending state (e.g. wired to a "Retry sync" UI
     action in the future). Re-uses the same in-flight guard so it can
     never race with an attempt already underway. */
  window._bridgeRetryWizardSync = function(app) {
    if (!app || app._bridgeSyncInFlight || app._dbSynced) return;
    app._bridgeSyncInFlight = true;
    _setWizardSyncState(app, 'pending', 'Retrying backend sync…');
    _attemptWizardBackendSubmit(app, app._bridgeSyncToken, 1);
  };

  function _patchWizardSubmit() {
    if (window._bridgeWizardPatched) return;
    window._bridgeWizardPatched = true;
    var _origSubmit = window.submitWizard;
    if (typeof _origSubmit !== 'function') return;

    window.submitWizard = function() {
      // Snapshot identities present BEFORE the original submit runs, so we
      // can tell exactly which application (if any) it created — instead
      // of assuming it always lands at APPLICATIONS[0].
      var beforeIds = (window.APPLICATIONS || []).map(function(a) { return a && a.id; });

      // Run original first (UI + localStorage as fallback). This call is
      // synchronous up to and including the APPLICATIONS.unshift(newApp),
      // so the moment it returns we can safely read the array.
      var result = _origSubmit.apply(this, arguments);

      try {
        var apps = window.APPLICATIONS;
        var app = apps && apps[0];

        // Nothing new was created (e.g. client-side validation blocked
        // the submit) — the first item is unchanged from before the call.
        // Do NOT treat a pre-existing application as "just submitted".
        if (!app || beforeIds.indexOf(app.id) !== -1) return result;

        // Already a backend-persisted application (defensive check —
        // covers both the historical 'API...' id convention and the
        // _apiId flag this bridge itself sets after a successful sync).
        if (app._apiId || String(app.id).indexOf('API') === 0) return result;

        // Assign a one-time token identifying *this* submit operation so
        // retries/guards always refer to the exact same application,
        // never to "whatever is currently at index 0".
        var token = app.id + '_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        app._bridgeSyncToken    = token;
        app._bridgeSyncInFlight = true;
        _setWizardSyncState(app, 'pending', 'Saving to database…');

        // Fire the actual network submit slightly after the original
        // handler settles (preserves prior timing behavior), using the
        // captured object reference directly — no re-lookup by index, so
        // the delay can never cause the wrong application to be selected.
        setTimeout(function() {
          try {
            _attemptWizardBackendSubmit(app, token, 1);
          } catch (e) {
            app._bridgeSyncInFlight = false;
            _setWizardSyncState(app, 'failed', 'Unexpected error while syncing.');
            console.error('[Bridge] Wizard API submit error:', e);
          }
        }, 500);
      } catch (e) {
        console.error('[Bridge] Wizard API submit setup error:', e);
      }

      return result;
    };
  }

  /* ══════════════════════════════════════════════════════════
     WIZARD DRAFT — DB-BACKED AUTOSAVE (PUSH) + CROSS-DEVICE
     DRAFT LIST/RESUME (PULL)

     Backend (untouched, already live): WizardController.cs —
       POST /api/wizard/draft         (SaveDraft)
       GET  /api/wizard/draft/{id}    (GetDraft — full field resume)
       GET  /api/wizard/drafts        (ListDrafts — summary list)

     Push side: efin-app.js's wizardAutoSaveDraft() snapshots the wizard's
     DOM fields (id starting "w-") straight onto the in-memory draft object
     (draft['w-fname'], draft['w-mobile'], etc — see _snapshotIntoDraft) and
     then calls window._pushWizardDraft(draft), defined here. This debounces
     the actual network call so rapid Next/Previous navigation or repeated
     autosave hooks (file upload, etc.) firing close together only produce
     one POST, not one per call.

     Pull side: window._syncWizardDrafts(), wired into the same boot-sync
     call sites as every other _syncX() function (login success, session
     restore, _apiSyncAll), populates APPLICATIONS with an is_draft:true
     summary row per server draft. Those rows don't carry the full wizard
     field set yet (ListDrafts intentionally only returns id/step/type/
     label/timestamps) — window._fetchWizardDraftFields(loanId), called by
     resumeDraftFromList() in efin-app.js when a row is still summary-only,
     fetches the full WizardSubmitDto via GetDraft and maps it back onto
     the same w-* keys _restoreDraftIntoWizard() already knows how to
     replay into the form.
  ══════════════════════════════════════════════════════════ */

  // ── Push: draft object (efin-app.js shape) → WizardSubmitDto ──
  // Strips the local "API<n>" id convention (see _dsaToLocal/_syncLocations
  // above) back down to the raw numeric backend id. Returns undefined
  // (never throws) when the value is missing/unrecognised, so an
  // unresolved DSA/Partner/Location can never block the rest of the
  // autosave from going through.
  function _stripApiPrefixId(raw) {
    if (!raw) return undefined;
    var m = /^API(\d+)$/.exec(String(raw));
    return m ? parseInt(m[1], 10) : undefined;
  }

  // w-location's <select> value is the location NAME, not an id (see
  // wPopulateLocations) — resolve it against the already-synced
  // window.twLocations list (_apiId set by _syncLocations above).
  function _resolveLocationIdByName(name) {
    if (!name || typeof window.twLocations === 'undefined' || !Array.isArray(window.twLocations)) return undefined;
    var loc = window.twLocations.find(function(l) { return l.name === name; });
    return (loc && loc._apiId) ? loc._apiId : undefined;
  }

  function _buildWizardDraftPayload(draft) {
    var num = function(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; };
    var int = function(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; };
    return {
      // Set once a prior autosave for THIS draft got a loanId back (see
      // _pushWizardDraftNow below) — makes every later call UPDATE the
      // same Draft-status Loan row instead of creating a new one.
      loanId:      draft._apiId || draft.LoanId || undefined,
      step:        draft.wizardStep || 1,
      fullName:    draft.name || ((draft['w-fname'] || '') + ' ' + (draft['w-lname'] || '')).trim(),
      mobile:      draft['w-mobile'] || draft.mobile || '',
      email:       draft['w-email'] || '',
      pan:         draft['w-pan']   || draft.pan || '',
      aadhar:      draft['w-aadhar'] || '',
      dob:         draft['w-dob'] || '',
      gender:      draft['w-gender'] || '',
      fatherName:  draft['w-father'] || '',
      cibil:       int(draft['w-cibil']),
      city:        draft['w-city'] || '',
      state:       draft['w-state'] || '',
      street1:     draft['w-street1'] || '',
      zip:         draft['w-zip'] || '',
      homeType:    draft['w-hometype'] || '',
      empType:     draft['w-emptype'] || '',
      compName:    draft['w-compname'] || '',
      compType:    draft['w-comptype'] || '',
      salary:      num(draft['w-salary']),
      obligations: num(draft['w-obligations']),
      desig:       draft['w-desig'] || '',
      officeEmail: draft['w-empcode'] || '',
      loanType:    draft.loanType || draft['w-loantype'] || 'personal_loan',
      amount:      num(draft.loanamt || draft['w-loanamt']),
      loanRate:    num(draft['w-loanrate']) || 12,
      tenure:      int(draft['w-tenure']) || 24,
      // BUGFIX (Wizard forensic audit): Step 9's bank-eligibility selection
      // (window.LA_DB.wizardSelectedBanks) was previously only ever sent to
      // the server via the FINAL Submit path (_buildWizardPayload, through
      // newApp.bank → lenderName) — this draft-autosave payload never
      // included it at all. If a user selected bank(s) at Step 9 and then
      // clicked Previous instead of submitting (or simply navigated away),
      // that selection lived ONLY in this browser tab's in-memory LA_DB
      // state — nothing about it reached PostgreSQL, so resuming the draft
      // later (even in the SAME browser, let alone another device) would
      // show no bank selected at all, with zero trace it ever happened.
      // Reuses the exact same LenderName field the Submit path already
      // populates correctly — no new backend field needed.
      lenderName:  (function() {
        try {
          var selected = (window.LA_DB && window.LA_DB.wizardSelectedBanks) || [];
          var names = selected.map(function(bid) {
            var b = (window.LA_DB.banks || []).find(function(x) { return x.id === bid; });
            return b && b.name;
          }).filter(Boolean);
          return names.join(', ');
        } catch (e) { return undefined; }
      })(),
      purpose:     draft['w-purpose'] || '',
      r1Name:      draft['w-r1name'] || '',
      r1Mobile:    draft['w-r1no'] || '',
      r1Relation:  draft['w-r1rel'] || '',
      r2Name:      draft['w-r2name'] || '',
      r2Mobile:    draft['w-r2no'] || '',
      r2Relation:  draft['w-r2rel'] || '',
      salesPerson: draft['w-sales'] || '',
      source:      draft['w-channel'] || '',
      channel:     draft['w-channel'] || '',
      dsaId:       _stripApiPrefixId(draft['w-dsa-name-val']),
      partnerId:   _stripApiPrefixId(draft['w-partner-name-val']),
      locationId:  _resolveLocationIdByName(draft['w-location']),
      // Product-specific fields — verified against the actual DOM ids in
      // index.html before wiring (not guessed): unlike most wizard fields,
      // these aren't consistently "w-<camelCaseField>", e.g. w-builder not
      // w-prop-builder, w-nominee-name not w-ins-nominee-name.
      productData: (function() {
        var idMap = {
          insType: 'w-ins-type', insInsurer: 'w-ins-insurer', insPremium: 'w-ins-premium',
          insPayFreq: 'w-ins-payment-freq', insNomineeName: 'w-nominee-name',
          insNomineeRel: 'w-nominee-relation', insNomineeDob: 'w-nominee-dob',
          insExistingCov: 'w-existing-coverage', insExistingPol: 'w-existing-policy',
          insExistingNo: 'w-existing-policy-no',
          propType: 'w-prop-type', propOwnership: 'w-ownership',
          propUnderConstruct: 'w-under-construction', propBuilder: 'w-builder',
          propCity: 'w-prop-city', propValue: 'w-prop-value',
          carMake: 'w-car-make', carModel: 'w-car-model', carYear: 'w-car-year',
          carPrice: 'w-car-price', carKm: 'w-car-km', carDealer: 'w-dealer',
          eduInstitution: 'w-institution', eduCourse: 'w-course',
          eduDuration: 'w-course-duration', eduAdmissionStatus: 'w-admission-status',
          eduStudyLocation: 'w-study-location',
          mname: 'w-mname', mname2: 'w-mname2', empcode: 'w-empcode', leadsrc: 'w-leadsrc',
          pstreet1: 'w-pstreet1', pstreet2: 'w-pstreet2', pcity: 'w-pcity', pstate: 'w-pstate',
          pzip: 'w-pzip', phometype: 'w-phometype', sameAddr: 'w-same-addr',
          coappName: 'w-coapp-name', coappPan: 'w-coapp-pan', coappAadhar: 'w-coapp-aadhar', coappMobile: 'w-coapp-mobile',
          coapplicantEmail: 'w-coapplicant-email', coapplicantMobile: 'w-coapplicant-mobile',
          coapplicantPan: 'w-coapplicant-pan', coapplicantRel: 'w-coapplicant-rel',
          r1addr1: 'w-r1addr1', r1addr2: 'w-r1addr2', r1city: 'w-r1city', r1pin: 'w-r1pin',
          r2addr1: 'w-r2addr1', r2addr2: 'w-r2addr2', r2city: 'w-r2city', r2pin: 'w-r2pin',
          bizName: 'w-biz-name', bizType: 'w-biz-type', bizVintage: 'w-biz-vintage',
          gst: 'w-gst', turnover: 'w-turnover', netProfit: 'w-net-profit', itrFiled: 'w-itr-filed',
          heightCm: 'w-height-cm', weightKg: 'w-weight-kg', smoker: 'w-smoker', occHazard: 'w-occ-hazard',
          sumAssured: 'w-sum-assured', policyTerm: 'w-policy-term',
          officeaddrL1: 'w-officeaddr-l1', officeaddrL2: 'w-officeaddr-l2', officeaddrPin: 'w-officeaddr-pin',
          street2: 'w-street2', phone: 'w-phone', preexisting: 'w-preexisting', preexistingDesc: 'w-preexisting-desc',
          officeaddrL1Self: 'w-officeaddr-l1-self', officeaddrL2Self: 'w-officeaddr-l2-self', officeaddrPinSelf: 'w-officeaddr-pin-self',
          isCustomCompany: 'w-is-custom-company', companyNameId: 'w-company-name-id', comptypeSelf: 'w-comptype-self',
          profBody: 'w-prof-body', coapplicant: 'w-coapplicant', nomineeId: 'w-nominee-id',
          dsaPartnerLinkedId: 'w-dsa-partner-linked-val'
        };
        var out = {};
        Object.keys(idMap).forEach(function(k) {
          var v = draft[idMap[k]];
          if (v !== undefined && v !== null && v !== '') out[k] = v;
        });
        return out;
      })()
    };
  }

  var _draftPushTimer = null;
  var WIZARD_DRAFT_DEBOUNCE_MS = 1800;

  function _pushWizardDraftNow(draft) {
    if (!draft) return;
    var payload;
    try { payload = _buildWizardDraftPayload(draft); }
    catch (e) { console.warn('[Bridge] Draft autosave: payload build failed:', e); return; }

    apiReq('POST', '/wizard/draft', payload).then(function(r) {
      if (!r) {
        // Network failure — surface nothing to the user, the next autosave
        // cycle (next Next/Previous, next field-blur hook) will just try
        // again with whatever the wizard state is by then.
        console.warn('[Bridge] Draft autosave: no response, will retry next cycle.');
        return;
      }
      if (r.success === false) {
        console.warn('[Bridge] Draft autosave rejected:', r.message || (r.errors && r.errors.join(' ')));
        return;
      }
      // r.success === true covers BOTH a real save AND the backend's
      // intentional "Nothing to save yet." no-op (empty mobile/fullName —
      // see SaveDraft) — the latter comes back with loanId 0, so only
      // adopt a real, positive id.
      var data = r.data;
      if (data && data.loanId) {
        draft._apiId = data.loanId;
        draft.LoanId = data.loanId;
        if (typeof window.persistSave === 'function') window.persistSave();
      }
    }).catch(function(e) {
      console.warn('[Bridge] Draft autosave error:', e);
    });
  }

  // Debounced entry point — called by efin-app.js's wizardAutoSaveDraft()
  // right after it snapshots the DOM fields onto the draft object.
  function _pushWizardDraft(draft) {
    if (!draft) return;
    if (_draftPushTimer) clearTimeout(_draftPushTimer);
    _draftPushTimer = setTimeout(function() {
      _draftPushTimer = null;
      _pushWizardDraftNow(draft);
    }, WIZARD_DRAFT_DEBOUNCE_MS);
  }
  window._pushWizardDraft = _pushWizardDraft;

  // ── Pull: GetDraft's WizardSubmitDto → the same w-* keys
  //    _snapshotIntoDraft()/_restoreDraftIntoWizard() already use ──
  function _draftDtoToFields(dto) {
    var names = (dto.fullName || '').split(' ');
    return {
      'w-fname':       names[0] || '',
      'w-lname':       names.slice(1).join(' ') || '',
      'w-mobile':      dto.mobile || '',
      'w-email':       dto.email || '',
      'w-pan':         dto.pan || '',
      'w-aadhar':      dto.aadhar || '',
      'w-dob':         dto.dob || '',
      'w-gender':      dto.gender || '',
      'w-father':      dto.fatherName || '',
      'w-cibil':       dto.cibil || '',
      'w-city':        dto.city || '',
      'w-state':       dto.state || '',
      'w-street1':     dto.street1 || '',
      'w-zip':         dto.zip || '',
      'w-hometype':    dto.homeType || '',
      'w-emptype':     dto.empType || '',
      'w-compname':    dto.compName || '',
      'w-comptype':    dto.compType || '',
      'w-salary':      dto.salary || '',
      'w-obligations': dto.obligations || '',
      'w-desig':       dto.desig || '',
      'w-loantype':    dto.loanType || 'personal_loan',
      'w-loanamt':     dto.amount || '',
      'w-loanrate':    dto.loanRate || '',
      'w-tenure':      dto.tenure || '',
      'w-purpose':     dto.purpose || '',
      'w-r1name':      dto.r1Name || '',
      'w-r1no':        dto.r1Mobile || '',
      'w-r1rel':       dto.r1Relation || '',
      'w-r2name':      dto.r2Name || '',
      'w-r2no':        dto.r2Mobile || '',
      'w-r2rel':       dto.r2Relation || '',
      // BUGFIX (confirmed real gap — draft resume losing Location/DSA/
      // Partner/Sales Person): the backend GetDraft response already
      // included dsaId/partnerId/locationId (and now dsaName/partnerName/
      // locationName/salesPerson, added alongside this fix) — this mapping
      // function just never read any of them back into the wizard's actual
      // field ids. w-location/w-dsa-name-val/w-partner-name-val/w-sales
      // hold display NAMES (see wsddCreate's hiddenId pattern and
      // _stripApiPrefixId's name→id resolution elsewhere in this file),
      // which is why the *Name fields are used here, not the raw ids.
      'w-location':         dto.locationName || '',
      'w-dsa-name-val':     dto.dsaName || '',
      'w-partner-name-val': dto.partnerName || '',
      'w-sales':            dto.salesPerson || '',
      'w-channel':          dto.channel || ''
    };
  }  // Fetches the full draft (GET /api/wizard/draft/{loanId}) and returns an
  // object ready to Object.assign() onto a local draft row — the w-* field
  // keys plus the same summary fields _snapshotIntoDraft() maintains
  // (name/mobile/pan/loanamt/wizardStep/loanType). Returns null on any
  // failure so the caller can fall back to whatever it already had.
  window._fetchWizardDraftFields = function(loanId) {
    if (!loanId) return Promise.resolve(null);
    return apiReq('GET', '/wizard/draft/' + loanId).then(function(r) {
      if (!r || !r.success || !r.data) return null;
      var dto = r.data;
      var fields = _draftDtoToFields(dto);
      fields._apiId     = dto.loanId;
      fields.LoanId     = dto.loanId;
      fields.wizardStep = dto.step || 1;
      fields.loanType   = dto.loanType || 'personal_loan';
      fields.name       = dto.fullName || '(Draft)';
      fields.mobile      = dto.mobile || '';
      fields.pan          = dto.pan || '';
      fields.loanamt    = dto.amount || '';
      // Step 9 bank-selection round-trip (see Loan.SelectedLenderNames) —
      // consumed by _restoreDraftIntoWizard (efin-app.js).
      fields._selectedLenderNames = dto.lenderName || '';
      // BUGFIX (confirmed real gap — draft resume losing Insurance/
      // Property/Vehicle/Education fields): dto.productData is now
      // returned by GetDraft (see WizardController.cs) — spread it onto
      // the individual w-* keys the same way _loanToApp() already does
      // for a fully-submitted application, so a resumed draft's
      // product-specific fields restore the same way.
      if (dto.productData && typeof dto.productData === 'object') {
        var pdMap = {
          insType: 'w-ins-type', insInsurer: 'w-ins-insurer', insPremium: 'w-ins-premium',
          insPayFreq: 'w-ins-payment-freq', insNomineeName: 'w-nominee-name',
          insNomineeRel: 'w-nominee-relation', insNomineeDob: 'w-nominee-dob',
          insExistingCov: 'w-existing-coverage', insExistingPol: 'w-existing-policy',
          insExistingNo: 'w-existing-policy-no',
          propType: 'w-prop-type', propOwnership: 'w-ownership',
          propUnderConstruct: 'w-under-construction', propBuilder: 'w-builder',
          propCity: 'w-prop-city', propValue: 'w-prop-value',
          carMake: 'w-car-make', carModel: 'w-car-model', carYear: 'w-car-year',
          carPrice: 'w-car-price', carKm: 'w-car-km', carDealer: 'w-dealer',
          eduInstitution: 'w-institution', eduCourse: 'w-course',
          eduDuration: 'w-course-duration', eduAdmissionStatus: 'w-admission-status',
          eduStudyLocation: 'w-study-location',
          mname: 'w-mname', mname2: 'w-mname2', empcode: 'w-empcode', leadsrc: 'w-leadsrc',
          pstreet1: 'w-pstreet1', pstreet2: 'w-pstreet2', pcity: 'w-pcity', pstate: 'w-pstate',
          pzip: 'w-pzip', phometype: 'w-phometype', sameAddr: 'w-same-addr',
          coappName: 'w-coapp-name', coappPan: 'w-coapp-pan', coappAadhar: 'w-coapp-aadhar', coappMobile: 'w-coapp-mobile',
          coapplicantEmail: 'w-coapplicant-email', coapplicantMobile: 'w-coapplicant-mobile',
          coapplicantPan: 'w-coapplicant-pan', coapplicantRel: 'w-coapplicant-rel',
          r1addr1: 'w-r1addr1', r1addr2: 'w-r1addr2', r1city: 'w-r1city', r1pin: 'w-r1pin',
          r2addr1: 'w-r2addr1', r2addr2: 'w-r2addr2', r2city: 'w-r2city', r2pin: 'w-r2pin',
          bizName: 'w-biz-name', bizType: 'w-biz-type', bizVintage: 'w-biz-vintage',
          gst: 'w-gst', turnover: 'w-turnover', netProfit: 'w-net-profit', itrFiled: 'w-itr-filed',
          heightCm: 'w-height-cm', weightKg: 'w-weight-kg', smoker: 'w-smoker', occHazard: 'w-occ-hazard',
          sumAssured: 'w-sum-assured', policyTerm: 'w-policy-term',
          officeaddrL1: 'w-officeaddr-l1', officeaddrL2: 'w-officeaddr-l2', officeaddrPin: 'w-officeaddr-pin',
          street2: 'w-street2', phone: 'w-phone', preexisting: 'w-preexisting', preexistingDesc: 'w-preexisting-desc',
          officeaddrL1Self: 'w-officeaddr-l1-self', officeaddrL2Self: 'w-officeaddr-l2-self', officeaddrPinSelf: 'w-officeaddr-pin-self',
          isCustomCompany: 'w-is-custom-company', companyNameId: 'w-company-name-id', comptypeSelf: 'w-comptype-self',
          profBody: 'w-prof-body', coapplicant: 'w-coapplicant', nomineeId: 'w-nominee-id',
          dsaPartnerLinkedId: 'w-dsa-partner-linked-val'
        };
        Object.keys(pdMap).forEach(function(k) {
          if (dto.productData[k] !== undefined && dto.productData[k] !== null) {
            fields[pdMap[k]] = dto.productData[k];
          }
        });
      }
      return fields;
    }).catch(function(e) { console.warn('[Bridge] fetchWizardDraftFields:', e); return null; });
  };

  function _wizardDraftOwner() {
    return (window.currentUser && (window.currentUser.email || window.currentUser.name)) || 'anon';
  }

  // GET /api/wizard/drafts → APPLICATIONS[] summary rows (is_draft:true).
  // Same replace-by-truth pattern as _syncLoans/_syncDsaPartners: any
  // server-tracked draft row (has _apiId) whose loanId no longer comes
  // back (submitted/deleted/expired-visibility) is removed; a local-only
  // draft that hasn't been pushed yet (no _apiId) is always left alone.
  function _syncWizardDrafts() {
    return apiReq('GET', '/wizard/drafts').then(function(res) {
      if (!res || !res.success) return;
      var list = res.data || [];
      if (typeof window.APPLICATIONS === 'undefined' || !Array.isArray(window.APPLICATIONS)) return;
      var arr = window.APPLICATIONS;
      var owner = _wizardDraftOwner();
      var freshLoanIds = new Set(list.map(function(d) { return d.loanId; }));

      for (var i = arr.length - 1; i >= 0; i--) {
        var row = arr[i];
        if (row.is_draft && row._apiId && !freshLoanIds.has(row._apiId)) arr.splice(i, 1);
      }

      list.forEach(function(d) {
        var existing = arr.find(function(a) { return a.is_draft && a._apiId === d.loanId; });
        if (existing) {
          // Server is the source of truth for these summary/list-row
          // fields — but never touch the w-* field snapshot (if any is
          // already loaded locally), only the bits the table row shows.
          existing.wizardStep  = d.step || existing.wizardStep;
          existing.loanType    = d.loanType || existing.loanType;
          existing.name        = d.label || existing.name;
          existing.date        = _fmtDate(d.updatedAt || d.createdAt) || existing.date;
          // Keep draft_owner in sync with the server's real-owner field too
          // (falls back to whatever was already there if the server
          // response is from an older backend that omits it) — otherwise a
          // row created locally under the wrong owner before this fix could
          // linger with a stale value across syncs.
          if (d.createdByUserEmail) existing.draft_owner = d.createdByUserEmail;
        } else {
          // draft_owner must reflect who this draft actually BELONGS to, not
          // who is currently looking at the list — Admin/Manager get every
          // user's drafts back from the server (isInternal, backend-side,
          // untouched), so blindly stamping the viewer's own identity here
          // made findMyDraft() (efin-app.js) match a foreign draft against
          // an Admin's own "my draft" lookup and silently overwrite it.
          // Prefer the real owner the backend now sends; fall back to the
          // viewer only for backward-compat with an older server response
          // that doesn't include it yet.
          var realOwner = d.createdByUserEmail || owner;
          arr.unshift({
            id: 'DRAFT-API' + d.loanId, _apiId: d.loanId, is_draft: true, status: 'draft',
            draft_owner: realOwner, wizardStep: d.step || 1, loanType: d.loanType || 'personal_loan',
            name: d.label || '(Draft)', sales: '', date: _fmtDate(d.updatedAt || d.createdAt),
            tracking: [],
            // Full wizard field data (w-* keys) hasn't been fetched yet —
            // resumeDraftFromList() checks this flag and calls
            // window._fetchWizardDraftFields() before opening the wizard.
            _serverOnly: true
          });
        }
      });
      _refreshUI();
    }).catch(function(e) { console.warn('[Bridge] syncWizardDrafts:', e); });
  }
  window._syncWizardDrafts = _syncWizardDrafts;

  /* ══════════════════════════════════════════════════════════
     CIBIL AUTO-CHECK on PAN entry (KYC step)
  ══════════════════════════════════════════════════════════ */
  function _patchCibilCheck() {
    if (window._bridgeCibilPatched) return;
    window._bridgeCibilPatched = true;

    // Hook into PAN field changes in wizard
    document.addEventListener('input', function(e) {
      var el = e.target;
      if (!el) return;
      var isWizardPan = el.id === 'w-pan' || el.id === 'kyc-pan' ||
                        (el.name === 'pan' && el.closest('#wizard-container'));
      if (!isWizardPan) return;
      var pan = el.value.trim().toUpperCase();
      if (pan.length !== 10) return;

      // Debounce
      clearTimeout(el._cibilTimer);
      el._cibilTimer = setTimeout(function() {
        apiReq('GET', '/cibil/check?pan=' + encodeURIComponent(pan)).then(function(r) {
          if (!r || !r.success) return;
          var d = r.data;
          // Auto-fill CIBIL score
          var cibilEl = document.getElementById('w-cibil') || document.getElementById('kyc-cibil');
          if (cibilEl && d.cibilScore) cibilEl.value = d.cibilScore;
          // Show badge
          var badgeColor = d.isEligible ? 'var(--success)' : 'var(--danger)';
          var badge = el.parentNode && el.parentNode.querySelector('._cibil-badge');
          if (!badge) {
            badge = document.createElement('span');
            badge.className = '_cibil-badge';
            badge.style.cssText = 'font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;margin-left:8px;';
            if (el.parentNode) el.parentNode.appendChild(badge);
          }
          badge.style.background = badgeColor + '22';
          badge.style.color      = badgeColor;
          // BUGFIX (approved improvement — CIBIL mock/demo warning):
          // /cibil/check always calls the backend's mock-score generator
          // (_getMockCibilScore — confirmed, no real-vs-mock branch exists
          // in that specific endpoint) — this badge/toast is therefore
          // ALWAYS a demo value, unlike cibil-view.js's report-viewer
          // (which correctly has both a real, BureauReports-backed path
          // and a mock-fallback path). Never touches the real FullReport
          // flow — that's a completely separate endpoint/file.
          badge.textContent      = '⚠️ Demo CIBIL: ' + d.cibilScore + ' (' + d.status + ')';
          badge.title            = 'Estimated / Demo Data — Not Verified CIBIL Score';
          if (typeof window.showToast === 'function')
            window.showToast('⚠️ Demo CIBIL (not verified): ' + d.cibilScore + ' — ' + d.message, d.isEligible ? 'success' : 'warn');
        });
      }, 800);
    }, true);
  }

  /* ══════════════════════════════════════════════════════════
     PAYOUT AUTO-CALCULATE on wizard loan amount/type change
  ══════════════════════════════════════════════════════════ */
  function _patchPayoutPreview() {
    if (window._bridgePayoutPreviewPatched) return;
    window._bridgePayoutPreviewPatched = true;

    function _showPayoutPreview() {
      var ltEl  = document.getElementById('w-loantype');
      var amtEl = document.getElementById('w-amount');
      if (!ltEl || !amtEl || !amtEl.value) return;
      var lt  = ltEl.value;
      var amt = parseFloat(amtEl.value.replace(/,/g, '')) || 0;
      if (!lt || amt <= 0) return;

      apiReq('GET', '/payout-rules/calculate?loanType=' + encodeURIComponent(lt) + '&amount=' + amt)
        .then(function(r) {
          if (!r || !r.success || !r.data.payoutAmount) return;
          var preview = document.getElementById('_payout-preview');
          if (!preview) {
            preview = document.createElement('div');
            preview.id = '_payout-preview';
            preview.style.cssText = 'font-size:12px;color:var(--text2);margin-top:6px;padding:6px 10px;background:var(--surface2);border-radius:6px;border:1px solid var(--border);';
            var parent = amtEl.closest('.form-group') || amtEl.parentNode;
            if (parent) parent.appendChild(preview);
          }
          preview.innerHTML = '💰 Estimated payout: <strong>₹' + Number(r.data.payoutAmount).toLocaleString('en-IN') + '</strong> (' + (window.escapeHtml ? window.escapeHtml(r.data.formula) : r.data.formula) + ')';
        });
    }

    ['w-loantype','w-amount'].forEach(function(id) {
      document.addEventListener('change', function(e) {
        if (e.target && e.target.id === id) setTimeout(_showPayoutPreview, 100);
      });
      document.addEventListener('input', function(e) {
        if (e.target && e.target.id === id) {
          clearTimeout(window._payoutPreviewTimer);
          window._payoutPreviewTimer = setTimeout(_showPayoutPreview, 600);
        }
      });
    });
  }

  /* ══════════════════════════════════════════════════════════
     REPORTS — switch to API endpoints for accurate data
  ══════════════════════════════════════════════════════════ */
  function _patchReportsToApi() {
    if (window._bridgeReportsApiPatched) return;
    window._bridgeReportsApiPatched = true;

    // Intercept showPage('reports') to pre-fetch summary stats
    var _origSP = window.showPage;
    if (typeof _origSP !== 'function') return;
    window.showPage = function(name, navEl) {
      var result = _origSP.apply(this, arguments);
      if (name === 'reports') {
        // Fetch real report summary from API
        apiReq('GET', '/reports/summary').then(function(r) {
          if (!r || !r.success) return;
          var d = r.data;
          // Update stat cards if they exist on reports page
          var setEl = function(id, val) { var e = document.getElementById(id); if(e) e.textContent = val; };
          setEl('rpt-total-apps',    d.loans && d.loans.total ? d.loans.total.toLocaleString() : '');
          setEl('rpt-total-disb',    d.loans && d.loans.disbursed ? d.loans.disbursed.toLocaleString() : '');
          setEl('rpt-total-amount',  d.loans && d.loans.totalReq ? '₹'+Number(d.loans.totalReq).toLocaleString('en-IN') : '');
          setEl('rpt-open-tasks',    d.openTasks || '');
          setEl('rpt-open-tickets',  d.openTickets || '');
        });
        // Fetch monthly trends
        apiReq('GET', '/reports/monthly?months=6').then(function(r) {
          if (!r || !r.success || !r.data) return;
          window._apiMonthlyReport = r.data;
          if (typeof window.renderReports === 'function') window.renderReports();
        });
      }
      return result;
    };
  }




  /* ══════════════════════════════════════════════════════════
     ADDITIONAL API INTEGRATIONS
  ══════════════════════════════════════════════════════════ */

  /* Auto-refresh CIBIL tab when app-detail opens */
  function _patchOpenDetailCibil() {
    if (window._bridgeOdCibilPatched) return;
    window._bridgeOdCibilPatched = true;
    var _orig = window.openDetail;
    if (typeof _orig !== 'function') return;
    window.openDetail = function(id) {
      var result = _orig.apply(this, arguments);
      // Reset CIBIL panel so it shows "Fetch" button for new app
      setTimeout(function() {
        var container = document.getElementById('cibil-report-container');
        if (container && !container.querySelector('button')) {
          container.innerHTML = '<div style="text-align:center;padding:48px 24px;color:var(--text3)">' +
            '<div style="font-size:40px;margin-bottom:12px">📊</div>' +
            '<div style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:6px">CIBIL Credit Report</div>' +
            '<div style="font-size:13px;margin-bottom:20px">Click below to fetch the credit report for this applicant.</div>' +
            '<button class="btn btn-primary" onclick="window._loadCibilReport&&_loadCibilReport()">🔍 Fetch CIBIL Report</button>' +
            '</div>';
        }
      }, 200);
      return result;
    };
  }

  /* Load any previously-saved Perfios report when app-detail opens — see
     PerfiosController/perfios-renderer.js's save-side for the full "why".
     Best-effort, matching _patchOpenDetailCibil's own pattern — a fetch
     failure here just leaves the Perfios tab in its normal empty state. */
  function _patchOpenDetailPerfios() {
    if (window._bridgeOdPerfiosPatched) return;
    window._bridgeOdPerfiosPatched = true;
    var _orig = window.openDetail;
    if (typeof _orig !== 'function') return;
    window.openDetail = function(id) {
      var result = _orig.apply(this, arguments);
      setTimeout(function() {
        var app = window.currentDetail;
        if (!app || !app._apiId || typeof apiReq !== 'function') return;
        apiReq('GET', '/loans/' + app._apiId + '/perfios-report').then(function(r) {
          if (!r || !r.success || !r.data) return;
          var d = r.data;
          var restored = {
            abb: d.averageBankBalance, span: d.span, totalTxns: d.totalTransactions,
            hasSalary: d.hasSalary, valid: d.isValid,
            firstDate: d.firstTransactionDate, lastDate: d.lastTransactionDate,
            manualReviewRequired: d.manualReviewRequired, staledays: d.staleDays,
            perFileData: [{ fileName: d.fileName }]
          };
          window._lastPerfiosData = restored;
          if (typeof window.renderPerfiosReport === 'function') window.renderPerfiosReport(restored);
        }).catch(function() {});
      }, 250);
      return result;
    };
  }

  /* Notification API — POST /api/notifications (webhook to Slack/Teams/email) */
  window.apiSendNotification = function(type, payload) {
    // Fires webhook configured in Settings → Webhooks
    var webhookUrl = _lsGet('efin_webhook_url');
    if (!webhookUrl) return;
    try {
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: type, data: payload, timestamp: new Date().toISOString() })
      }).catch(function() {});
    } catch(e) {}
  };

  /* Status change notification hook */
  function _patchStatusNotify() {
    if (window._bridgeStatusNotifyPatched) return;
    window._bridgeStatusNotifyPatched = true;
    var _orig = window.changeStatus;
    if (typeof _orig !== 'function') return;
    window.changeStatus = function(id, newStatus, triggerEl) {
      var result = _orig.apply(this, arguments);
      var app = (window.APPLICATIONS || []).find(function(a) { return a.id === id; });
      if (app) {
        window.apiSendNotification('status_change', {
          appId: app.id, applicant: app.name, loanType: app.loanType,
          amount: app.amount, oldStatus: app.status, newStatus: newStatus,
          changedBy: window.currentUser && currentUser.name
        });
      }
      return result;
    };
  }

  /* DSA commission auto-calculate on disburse */


  // Expose sync functions for manual refresh
  window._apiSyncAll    = function() { _syncLoans(); _syncUsers(); _syncTeams(); _syncLocations(); _syncTasks(); _syncTickets(); _syncDsaPartners(); _syncRmEmails(); _syncBanks(); _syncAnalyticBanks(); _syncAnalyticCompanies(); _syncAnalyticCategories(); _syncReportTargets(); _syncAssignmentAuditLog(); _syncRejectionReasons(); _syncEmailTemplates(); _syncProductOfferMatrix(); _syncWizardDrafts(); _syncNotifications(); _syncCamMatrix(); _syncIcCommentTemplates(); if (typeof window.stgSyncPermissionsFromServer === 'function') window.stgSyncPermissionsFromServer(); if (typeof window._pullProfileFromServer === 'function') window._pullProfileFromServer(); setTimeout(function() { _syncPayoutClaimsFromServer().then(_syncOwnPayoutClaims); }, 500); };

  /* Load InCred comment templates from the server — see _ictSaveToServer
     in efin-app.js for the write side. Same generic Admin-only Settings
     endpoint as CAM_MATRIX. */
  function _syncIcCommentTemplates() {
    var tok = _lsGet('loanms_token');
    var headers = tok ? { 'Authorization': 'Bearer ' + tok } : {};
    fetch('/api/settings/efin_incred_comment_templates', { headers: headers })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(res) {
        var raw = res && res.data ? res.data.value : null;
        if (!raw) return;
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && typeof window !== 'undefined') {
          window.IC_COMMENT_TEMPLATES = parsed;
          if (typeof window.ictRender === 'function') window.ictRender();
        }
      }).catch(function() { /* not Admin, or not saved yet — keep local defaults */ });
  }

  /* Load CAM_MATRIX (global salary-band config) from the server — see
     camAdminSave() in efin-app.js for the write side. Same Admin-only
     generic Settings endpoint as Roles & Permissions/Menu Access Control. */
  function _syncCamMatrix() {
    var tok = _lsGet('loanms_token');
    var headers = tok ? { 'Authorization': 'Bearer ' + tok } : {};
    fetch('/api/settings/efin_cam_matrix', { headers: headers })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(res) {
        var raw = res && res.data ? res.data.value : null;
        if (!raw) return;
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && typeof window !== 'undefined') {
          window.CAM_MATRIX = parsed;
          if (typeof window.camAdminRender === 'function') window.camAdminRender();
        }
      }).catch(function() { /* not Admin, or not saved yet — keep local defaults */ });
  }
  window._syncPayoutClaimsFromServer = _syncPayoutClaimsFromServer;
  window._apiSyncLoans  = _syncLoans;
  window._apiSyncUsers  = _syncUsers;
  window._apiSyncTeams  = _syncTeams;
  window._apiSyncTasks  = _syncTasks;
  window._apiSyncTickets = _syncTickets;
  window._apiSyncRmEmails = _syncRmEmails;
  window._apiSyncBanks = _syncBanks;
  window._apiSyncReportTargets = _syncReportTargets;
  window._apiSyncAssignmentAuditLog = _syncAssignmentAuditLog;
  window._apiSyncObligations = _syncObligations;
  window.apiReq = apiReq;
  window.apiReqRaw = apiReqRaw;

  console.info('[LoanMS Bridge v6] Ready — API-backed workflows: Loans, Users, Teams, Locations, Tasks, Tickets, Reports, Status Changes, Password Change');
})();


  /* ══════════════════════════════════════════════════════════
     EXTRA SPEED FEATURES
  ══════════════════════════════════════════════════════════ */

  /* Live EMI calculator using backend API */
  window.apiCalculateEmi = function(amount, rate, tenure, callback) {
    apiReq('GET', '/loans/calculate-emi?amount='+amount+'&rate='+rate+'&tenure='+tenure)
      .then(function(r) {
        if (r && r.success && typeof callback === 'function') callback(r.data);
      });
  };

  /* PAN duplicate check using backend DB (not just localStorage) */
  window.apiCheckPan = function(pan, excludeId, callback) {
    if (!pan || pan.length !== 10) { if(typeof callback==='function') callback(false); return; }
    apiReq('GET', '/customers/check-pan?pan='+encodeURIComponent(pan)+(excludeId?'&excludeId='+excludeId:''))
      .then(function(r) {
        if (r && r.success && typeof callback === 'function') callback(r.data.exists, r.data);
      });
  };

  /* Customer search for wizard autofill */
  window.apiSearchCustomer = function(query, callback) {
    if (!query || query.length < 3) return;
    apiReq('GET', '/customers/search?q='+encodeURIComponent(query))
      .then(function(r) {
        if (r && r.success && typeof callback === 'function') callback(r.data);
      });
  };

  /* Document upload */
  window.apiUploadDocument = function(loanApiId, file, documentType, callback) {
    var formData = new FormData();
    formData.append('file', file);
    formData.append('documentType', documentType || 'General');
    var tok = _lsGet('loanms_token');
    var headers = tok ? { 'Authorization': 'Bearer ' + tok } : {};
    fetch('/api/loans/' + loanApiId + '/documents', { method: 'POST', headers: headers, body: formData })
      .then(function(r){ return r.json(); })
      .then(function(r) {
        if (typeof callback === 'function') callback(r && r.success, r && r.data);
        if (r && r.success && typeof window.showToast === 'function')
          window.showToast('Document uploaded to server ✓', 'success');
      }).catch(function(e) { console.warn('[Bridge] doc upload:', e); });
  };

  /* Smart polling — sync data every 60s when tab is visible.
     Previously this loop only synced Loans + Tickets, so any tab left
     open on a second device never picked up changes made anywhere else
     until that tab did a full page reload/re-login (the only other place
     most of these _syncX functions were called — see doLogin and the
     DOMContentLoaded session-restore block above, same list as
     window._apiSyncAll). That is the general cause behind "saves feel
     slow / sometimes never show on another device, across every screen":
     most entities were simply not part of the recurring sync, only the
     one-time login/refresh sync. This now mirrors _apiSyncAll's full list
     so an already-open tab picks up cross-device changes in ANY module
     within one polling cycle, not just Loans/Tickets/Users/RM Emails. */
  function _pollTick() {
    if (!_lsGet('loanms_token')) return;
    if (document.hidden) return;
    // Each sync function below is a plain identifier in this same closure
    // (defined earlier in this file), so it's referenced directly rather
    // than via a name string — a string-keyed window[...] lookup would
    // only find functions explicitly attached to window and silently miss
    // these closure-local ones, which is not the case for all of them.
    if (typeof _syncLoans === 'function') _syncLoans();
    else if (typeof window._apiSyncLoans === 'function') window._apiSyncLoans();
    if (typeof _syncUsers === 'function') _syncUsers();
    else if (typeof window._apiSyncUsers === 'function') window._apiSyncUsers();
    if (typeof _syncTeams === 'function') _syncTeams();
    else if (typeof window._apiSyncTeams === 'function') window._apiSyncTeams();
    if (typeof _syncLocations === 'function') _syncLocations();
    else if (typeof window._apiSyncLocations === 'function') window._apiSyncLocations();
    if (typeof _syncTasks === 'function') _syncTasks();
    else if (typeof window._apiSyncTasks === 'function') window._apiSyncTasks();
    if (typeof _syncTickets === 'function') _syncTickets();
    else if (typeof window._apiSyncTickets === 'function') window._apiSyncTickets();
    if (typeof _syncDsaPartners === 'function') _syncDsaPartners();
    else if (typeof window._apiSyncDsaPartners === 'function') window._apiSyncDsaPartners();
    if (typeof _syncRmEmails === 'function') _syncRmEmails();
    else if (typeof window._apiSyncRmEmails === 'function') window._apiSyncRmEmails();
    if (typeof _syncBanks === 'function') _syncBanks();
    else if (typeof window._apiSyncBanks === 'function') window._apiSyncBanks();
    if (typeof _syncReportTargets === 'function') _syncReportTargets();
    else if (typeof window._apiSyncReportTargets === 'function') window._apiSyncReportTargets();
    if (typeof _syncAssignmentAuditLog === 'function') _syncAssignmentAuditLog();
    else if (typeof window._apiSyncAssignmentAuditLog === 'function') window._apiSyncAssignmentAuditLog();
    if (typeof _syncRejectionReasons === 'function') _syncRejectionReasons();
    else if (typeof window._apiSyncRejectionReasons === 'function') window._apiSyncRejectionReasons();
    if (typeof _syncEmailTemplates === 'function') _syncEmailTemplates();
    else if (typeof window._apiSyncEmailTemplates === 'function') window._apiSyncEmailTemplates();
    if (typeof _syncProductOfferMatrix === 'function') _syncProductOfferMatrix();
    else if (typeof window._apiSyncProductOfferMatrix === 'function') window._apiSyncProductOfferMatrix();
    if (typeof _syncNotifications === 'function') _syncNotifications();
    else if (typeof window._apiSyncNotifications === 'function') window._apiSyncNotifications();
  }
  (function _smartPoller() {
    var _pollInterval = null;
    function startPoll() {
      if (_pollInterval) return;
      _pollInterval = setInterval(_pollTick, 60000); // 60 second polling
    }
    function stopPoll() {
      if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
    }
    document.addEventListener('visibilitychange', function() {
      if (document.hidden) { stopPoll(); return; }
      startPoll();
      // Tab regaining focus (e.g. switching back from device 2's other
      // apps, or coming back to an already-open tab) previously had to
      // wait up to 60s for the next poll tick before showing anything
      // changed elsewhere. Fire one sync immediately on refocus instead.
      _pollTick();
    });
    // Start polling after initial load
    setTimeout(startPoll, 5000);
  })();

  /* Instant refresh when opening the pages that showed this staleness —
     All Users and InCred RM Emails — so the admin never has to wait for
     the 60s poll just because they navigated there right after someone
     else's change. Same wrapping pattern already used for 'reports'
     above (_patchReportsToApi). */
  (function _patchInstantRefreshOnOpen() {
    if (window._bridgeInstantRefreshPatched) return;
    window._bridgeInstantRefreshPatched = true;
    var _origSP = window.showPage;
    if (typeof _origSP !== 'function') return;
    window.showPage = function(name, navEl) {
      var result = _origSP.apply(this, arguments);
      if (name === 'users-mgmt' && typeof _syncUsers === 'function') _syncUsers();
      if (name === 'incred' && typeof _syncRmEmails === 'function') _syncRmEmails();
      return result;
    };
  })();

  console.info('[LoanMS Bridge v6] Features: Bulk sync, EMI calc, PAN check, Doc upload, Session timer, 60s polling');
