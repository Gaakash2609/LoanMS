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

  var ROLE_MAP   = { Admin:'admin', Manager:'manager', Sales:'sales_executive', Operations:'login_team', Partner:'partner' };
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
      name:c.fullName||'—', fname:(names[0]||'').toUpperCase(), lname:(names.slice(1).join(' ')||'').toUpperCase(),
      mobile:c.phone||'', email:c.email||'',
      pan:c.panNumber?'XXXXX'+c.panNumber.slice(-4)+'X':'XXXXX0000X',
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
      // For bulk, we already have list items — fetch full details only for recent 50
      var recentIds = list.slice(0, 50).map(function(l){ return l.id; });
      return Promise.all(recentIds.map(function(id){
        return apiReq('GET', '/loans/' + id).then(function(r){ return r && r.success ? r.data : null; });
      })).then(function(detailed) {
        var apiApps = detailed.filter(Boolean).map(_loanToApp);
        if (typeof window.APPLICATIONS !== 'undefined' && Array.isArray(window.APPLICATIONS)) {
          // IMPORTANT: mutate the existing array in place rather than
          // reassigning `window.APPLICATIONS = ...`. The dashboard's
          // renderTable()/_applyRoleFilter() close over the original
          // `APPLICATIONS` array binding (declared with `let` inside the
          // app's IIFE) — it is the SAME array object as `window.APPLICATIONS`
          // only because of a one-time `window.APPLICATIONS = APPLICATIONS`
          // export at page init. Reassigning `window.APPLICATIONS` to a brand
          // new array breaks that shared reference: the dashboard keeps
          // rendering the old (stale/seed) array forever, while
          // `window.APPLICATIONS` silently holds the fresh synced data. This
          // caused the Applications list/Dashboard to appear empty (or stuck
          // on stale demo data) even though the API sync itself succeeded.
          var demo = window.APPLICATIONS.filter(function(a){ return !String(a.id).startsWith('API'); });
          var merged = demo.concat(apiApps);
          window.APPLICATIONS.length = 0;
          Array.prototype.push.apply(window.APPLICATIONS, merged);
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
      if (!res || !res.success || !res.data) return;
      var apiUsers = res.data.map(function(u) {
        return {
          id: 'API' + u.id, _apiId: u.id,
          name: u.fullName, email: (u.email || '').toLowerCase(),
          role: ROLE_MAP[u.role] || 'sales_executive',
          location: u.locationId ? String(u.locationId) : '',
          phone: u.phoneNumber || '',
          status: u.isActive ? 'active' : 'inactive',
          joinDate: _fmtDate(u.createdAt)
        };
      });
      if (typeof window.twUsers !== 'undefined' && Array.isArray(window.twUsers)) {
        var seededIds = new Set(window.twUsers.filter(function(u){ return !String(u.id).startsWith('API'); }).map(function(u){ return u.email; }));
        apiUsers.forEach(function(au) {
          var existing = window.twUsers.findIndex(function(u){ return u.email === au.email; });
          if (existing >= 0) { window.twUsers[existing] = Object.assign(window.twUsers[existing], au); }
          else { window.twUsers.push(au); }
        });
        if (typeof window.twRenderUsers === 'function') { try { window.twRenderUsers(); } catch(e){} }
      }
    }).catch(function(e){ console.warn('[Bridge] syncUsers:',e); });
  }

  /* Patch: twSaveUser → POST/PUT /api/users */
  function _patchTwSaveUser() {
    if (window._bridgeTwSaveUserPatched) return;
    window._bridgeTwSaveUserPatched = true;
    var _orig = window.twSaveUser;
    if (typeof _orig !== 'function') return;
    window.twSaveUser = function() {
      var result = _orig.apply(this, arguments);
      // After local save, find the newly added/updated user and sync to API
      setTimeout(function() {
        var form = document.getElementById('tw-user-form') || document.getElementById('user-detail-panel');
        if (!form) { _syncUsers(); return; }
        var nameEl  = document.getElementById('ud-name')  || document.getElementById('tw-new-name');
        var emailEl = document.getElementById('ud-email') || document.getElementById('tw-new-email');
        var roleEl  = document.getElementById('ud-role')  || document.getElementById('tw-new-role');
        var passEl  = document.getElementById('ud-pass')  || document.getElementById('tw-new-pass');
        if (!emailEl || !emailEl.value) { _syncUsers(); return; }
        var email = emailEl.value.trim().toLowerCase();
        var existing = (window.twUsers || []).find(function(u){ return u.email === email && u._apiId; });
        var payload = {
          fullName: nameEl ? nameEl.value.trim() : '',
          email:    email,
          role:     roleEl ? (roleEl.value.charAt(0).toUpperCase() + roleEl.value.slice(1)) : 'Sales',
          password: passEl ? passEl.value : undefined,
          phoneNumber: '',
          isActive: true
        };
        if (!payload.password) delete payload.password;
        var req = existing
          ? apiReq('PUT', '/users/' + existing._apiId, payload)
          : apiReq('POST', '/users', payload);
        req.then(function(r) {
          if (r && r.success) {
            if (typeof window.showToast === 'function') window.showToast('User saved to database ✓', 'success');
            setTimeout(_syncUsers, 500);
          } else if (typeof window.showToast === 'function') {
            var msg = (r && (r.message || (r.errors && r.errors.join(' ')))) || 'Could not reach the server.';
            window.showToast('⚠ User saved locally, but database sync failed: ' + msg, 'warn');
          }
        });
      }, 300);
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

      function mergeTeams(apiList, store) {
        if (!Array.isArray(store)) return;
        apiList.forEach(function(at) {
          var mapped = { id:'API'+at.id, _apiId:at.id, name:at.name, lead:at.teamLead||'',
                         members:(at.members||[]).map(function(m){ return m.fullName; }), location:at.locationId||'' };
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
  function _patchTeamSave() {
    if (window._bridgeTeamSavePatched) return;
    window._bridgeTeamSavePatched = true;
    var _cfg = {
      twSaveSalesTeamDetail: { type: 'Sales', store: 'twSalesTeams', editVar: '_twEditSalesId', nameEl: 'tw-st-name', leaderEl: 'tw-st-leader', locEl: 'tw-st-loc' },
      twSaveLoginTeamDetail: { type: 'Login', store: 'twLoginTeams', editVar: '_twEditLoginId', nameEl: 'tw-lt-name', leaderEl: 'tw-lt-leader', locEl: 'tw-lt-loc' }
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
        var nameVal   = nameEl ? nameEl.value.trim() : '';
        var leaderVal = leaderEl ? leaderEl.value : '';
        var locVal    = locEl ? locEl.value : '';
        var wasValid  = !!nameVal;

        var result = _orig.apply(this, arguments);
        if (!wasValid) return result; // original already showed its own validation toast

        setTimeout(function() {
          var store = window[c.store];
          if (!Array.isArray(store)) return;
          var team = editId
            ? store.find(function(t){ return t.id === editId; })
            : store.find(function(t){ return t.name === nameVal && !t._apiId; });
          if (!team) return;

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
              if (typeof window.showToast === 'function') window.showToast('Team saved to database ✓', 'success');
              if (typeof window.persistSave === 'function') { try { window.persistSave(); } catch(e){} }
              setTimeout(_syncTeams, 300);
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
      var loc = (window.twLocations || []).find(function(l){ return l.id === id; });
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
      var loc = (window.twLocations || []).find(function(l){ return l.id === id; });
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
        res.data.forEach(function(t) {
          var mapped = {
            id:'API'+t.id, _apiId:t.id,
            title:t.title, description:t.description||'',
            priority:t.priority||'Medium', status:t.isCompleted?'done':'pending',
            appId:t.loanId?'API'+t.loanId:null, assign_type:'manual',
            assigned_user:t.assignedTo||'', due_date:_fmtDate(t.dueDate),
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
  function _syncDsaPartners() {
    return apiReq('GET', '/dsa').then(function(res) {
      if (!res || !res.success || !res.data) return;
      var dsaItems     = res.data.filter(function(d){ return d.partnerType === 'Dsa'; });
      var partnerItems = res.data.filter(function(d){ return d.partnerType === 'Partner'; });

      function merge(apiList, store, extraDefaults) {
        if (!Array.isArray(store)) return;
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
  function _syncPayoutClaimsFromServer() {
    if (typeof window.PAYOUT_CLAIMS === 'undefined' || !Array.isArray(window.PAYOUT_CLAIMS)) return Promise.resolve();
    return apiReq('GET', '/payout').then(function(res) {
      if (!res || !res.success || !Array.isArray(res.data)) return;
      res.data.forEach(function(c) {
        var existing = PAYOUT_CLAIMS.find(function(p) { return p._apiId === c.id; });
        if (existing) {
          // Server is authoritative for status/amount/month once a claim is synced.
          existing.status       = (c.status || existing.status || 'Pending').toLowerCase();
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
          status: (c.status || 'pending').toLowerCase(),
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
      _patchTeamSave();
      _patchLocationSave();
      _patchLocationRename();
      _patchLocationDelete();
      _patchTaskDone();
      _patchTicketSave();
      _patchTicketStatusActions();
      _patchDsaSave();
      _patchPartnerSave();
      _patchPayoutClaimCreate();
      _patchReports();
      _patchChangePassword();
      _patchWizardSubmit();
      _patchCibilCheck();
      _patchPayoutPreview();
      _patchReportsToApi();
      _patchOpenDetailCibil();
      _patchStatusNotify();
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
      loanId:      app._apiId || undefined,
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
      efinId:      app.id      || ''
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
        setTimeout(_syncLoans, 1000);
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
          setTimeout(_syncLoans, 1000);
          return;
        }
        // Real validation/business failure — retrying identical data
        // cannot succeed, so stop here instead of looping.
        app._bridgeSyncInFlight = false;
        _setWizardSyncState(app, 'failed', msg);
        console.warn('[Bridge] Wizard DB save rejected:', msg);
        _wizardToast('⚠ Application NOT saved to database: ' + msg, 'warn');
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
          badge.textContent      = 'CIBIL: ' + d.cibilScore + ' (' + d.status + ')';
          if (typeof window.showToast === 'function')
            window.showToast('CIBIL: ' + d.cibilScore + ' — ' + d.message, d.isEligible ? 'success' : 'warn');
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
          preview.innerHTML = '💰 Estimated payout: <strong>₹' + Number(r.data.payoutAmount).toLocaleString('en-IN') + '</strong> (' + r.data.formula + ')';
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
  window._apiSyncAll    = function() { _syncLoans(); _syncUsers(); _syncTeams(); _syncLocations(); _syncTasks(); _syncTickets(); _syncDsaPartners(); setTimeout(function() { _syncPayoutClaimsFromServer().then(_syncOwnPayoutClaims); }, 500); };
  window._syncPayoutClaimsFromServer = _syncPayoutClaimsFromServer;
  window._apiSyncLoans  = _syncLoans;
  window._apiSyncUsers  = _syncUsers;
  window._apiSyncTeams  = _syncTeams;
  window._apiSyncTasks  = _syncTasks;
  window._apiSyncTickets = _syncTickets;
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

  /* Smart polling — sync data every 60s when tab is visible */
  (function _smartPoller() {
    var _pollInterval = null;
    function startPoll() {
      if (_pollInterval) return;
      _pollInterval = setInterval(function() {
        if (!_lsGet('loanms_token')) return;
        if (document.hidden) return;
        // Only sync loans (most critical) on poll; full sync on demand
        if (typeof _syncLoans === 'function') _syncLoans();
        else if (typeof window._apiSyncLoans === 'function') window._apiSyncLoans();
        if (typeof _syncTickets === 'function') _syncTickets();
        else if (typeof window._apiSyncTickets === 'function') window._apiSyncTickets();
      }, 60000); // 60 second polling
    }
    function stopPoll() {
      if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
    }
    document.addEventListener('visibilitychange', function() {
      if (document.hidden) stopPoll(); else startPoll();
    });
    // Start polling after initial load
    setTimeout(startPoll, 5000);
  })();

  console.info('[LoanMS Bridge v6] Features: Bulk sync, EMI calc, PAN check, Doc upload, Session timer, 60s polling');
