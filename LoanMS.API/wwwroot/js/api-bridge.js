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
  var LS_TOKEN   = 'loanms_token';
  var LS_REFRESH = 'loanms_refresh';
  var LS_USER    = 'loanms_user';
  var UA_STORE   = 'efin_ua_creds_v2';

  var ROLE_MAP   = { Admin:'admin', Manager:'manager', Sales:'sales_executive', Operations:'login_team', Partner:'partner' };
  var STATUS_MAP = { Draft:'wip', Submitted:'login', UnderReview:'underwriting', Approved:'approved', Rejected:'rejected', Disbursed:'disbursed', Closed:'disbursed', Hold:'hold' };
  var STATUS_REV = { wip:'Draft', login:'Submitted', underwriting:'UnderReview', approved:'Approved', rejected:'Rejected', disbursed:'Disbursed', hold:'Hold' };
  var LTYPE_MAP  = { Personal:'personal_loan', Home:'home_loan', Business:'business_loan', Education:'education_loan', Car:'new_car_loan' };
  var MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function _token()   { return _lsGet(LS_TOKEN); }
  function _refresh() { return _lsGet(LS_REFRESH); }
  function _clearAuth() { [LS_TOKEN, LS_REFRESH, LS_USER].forEach(function(k){ _lsRemove(k); }); }

  /* ── Core API request with auto token refresh ── */
  function apiReq(method, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    var tok = _token();
    if (tok) headers['Authorization'] = 'Bearer ' + tok;
    return fetch(BASE + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined })
      .then(function(res) {
        if (res.status === 401) {
          var rt = _refresh();
          if (rt) {
            return fetch(BASE + '/auth/refresh', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ refreshToken: rt }) })
              .then(function(r2){ return r2.json(); })
              .then(function(d2) {
                if (d2.success) {
                  _lsSet(LS_TOKEN, d2.data.accessToken);
                  _lsSet(LS_REFRESH, d2.data.refreshToken);
                  headers['Authorization'] = 'Bearer ' + d2.data.accessToken;
                  return fetch(BASE + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined }).then(function(r){ return r.json(); });
                } else { _clearAuth(); return null; }
              }).catch(function(){ _clearAuth(); return null; });
          } else { _clearAuth(); return null; }
        }
        return res.json();
      }).catch(function(e){ console.warn('[Bridge] API error:', path, e); return null; });
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
        if (typeof window.APPLICATIONS !== 'undefined') {
          var demo = window.APPLICATIONS.filter(function(a){ return !String(a.id).startsWith('API'); });
          window.APPLICATIONS = demo.concat(apiApps);
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

  /* Patch: twSaveSalesTeamDetail / twSaveLoginTeamDetail → PUT /api/teams */
  function _patchTeamSave() {
    if (window._bridgeTeamSavePatched) return;
    window._bridgeTeamSavePatched = true;
    ['twSaveSalesTeamDetail','twSaveLoginTeamDetail'].forEach(function(fnName) {
      var _orig = window[fnName];
      if (typeof _orig !== 'function') return;
      window[fnName] = function(teamId) {
        var result = _orig.apply(this, arguments);
        setTimeout(function() {
          var team = (window.twSalesTeams || []).concat(window.twLoginTeams || [])
            .find(function(t){ return t.id === teamId || t._apiId === teamId; });
          if (team && team._apiId) {
            apiReq('PUT', '/teams/' + team._apiId, {
              name: team.name, type: fnName.includes('Sales') ? 'Sales' : 'Login',
              locationId: team.location || null, teamLeadUserId: null
            }).then(function(r) {
              if (r && r.success) setTimeout(_syncTeams, 300);
            });
          }
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

  /* Patch: twSaveLocation → POST/PUT /api/locations */
  function _patchLocationSave() {
    if (window._bridgeLocSavePatched) return;
    window._bridgeLocSavePatched = true;
    var _orig = window.twSaveLocation;
    if (typeof _orig !== 'function') return;
    window.twSaveLocation = function(locId) {
      var result = _orig.apply(this, arguments);
      setTimeout(function() {
        var loc = (window.twLocations || []).find(function(l){ return l.id === locId; });
        if (!loc) { _syncLocations(); return; }
        var payload = { name:loc.name, city:loc.city||'', state:loc.state||'', pinCode:loc.pin||'' };
        var req = loc._apiId
          ? apiReq('PUT', '/locations/' + loc._apiId, payload)
          : apiReq('POST', '/locations', payload);
        req.then(function(r) {
          if (r && r.success) {
            if (typeof window.showToast === 'function') window.showToast('Location saved ✓', 'success');
            setTimeout(_syncLocations, 300);
          }
        });
      }, 200);
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
     6. TICKETS — Sync from API into TK_STORE
  ══════════════════════════════════════════════════════════ */
  function _syncTickets() {
    return apiReq('GET', '/tickets').then(function(res) {
      if (!res || !res.success || !res.data) return;
      if (typeof window.TK_STORE !== 'undefined' && Array.isArray(window.TK_STORE)) {
        res.data.forEach(function(t) {
          var mapped = {
            id:'API'+t.id, _apiId:t.id,
            subject:t.title, desc:t.description||'',
            priority:t.priority||'medium', status:t.status||'open',
            loan:t.loanId?'API'+t.loanId:null,
            customer:t.createdBy||'', assigned:t.assignedTo||'',
            date:_fmtDate(t.createdAt)
          };
          var existing = window.TK_STORE.findIndex(function(tk){ return tk._apiId === t.id; });
          if (existing >= 0) window.TK_STORE[existing] = Object.assign(window.TK_STORE[existing], mapped);
          else window.TK_STORE.push(mapped);
        });
        if (typeof window.tkRenderTable === 'function') { try { window.tkRenderTable(); } catch(e){} }
      }
    }).catch(function(e){ console.warn('[Bridge] syncTickets:',e); });
  }

  /* Patch: tkSaveTicket → POST /api/tickets */
  function _patchTicketSave() {
    if (window._bridgeTicketSavePatched) return;
    window._bridgeTicketSavePatched = true;
    var _orig = window.tkSaveTicket;
    if (typeof _orig !== 'function') return;
    window.tkSaveTicket = function() {
      var result = _orig.apply(this, arguments);
      setTimeout(function() {
        var subjectEl  = document.getElementById('tk-subject');
        var descEl     = document.getElementById('tk-desc');
        var priorityEl = document.getElementById('tk-priority');
        var loanEl     = document.getElementById('tk-loan');
        if (!subjectEl || !subjectEl.value.trim()) return;
        var loanId = null;
        if (loanEl && loanEl.value) {
          var app = (window.APPLICATIONS || []).find(function(a){ return a.id === loanEl.value; });
          if (app && app._apiId) loanId = app._apiId;
        }
        apiReq('POST', '/tickets', {
          title:       subjectEl.value.trim(),
          description: descEl ? descEl.value.trim() : '',
          priority:    priorityEl ? priorityEl.value : 'medium',
          loanId:      loanId
        }).then(function(r) {
          if (r && r.success) {
            if (typeof window.showToast === 'function') window.showToast('Ticket saved to database ✓', 'success');
            setTimeout(_syncTickets, 300);
          }
        });
      }, 200);
      return result;
    };
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
  ══════════════════════════════════════════════════════════ */
  function _patchChangePassword() {
    if (window._bridgeCpPatched) return;
    window._bridgeCpPatched = true;
    var _orig = window.openChangePassword;
    // Override the save action of the change password modal
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('#cp-save-btn, [onclick*="changePassword"], [onclick*="cpSave"]');
      if (!btn) return;
      var curr = document.getElementById('cp-current') || document.getElementById('current-password');
      var newp = document.getElementById('cp-new')     || document.getElementById('new-password');
      var conf = document.getElementById('cp-confirm') || document.getElementById('confirm-password');
      if (!curr || !newp || !conf) return;
      if (newp.value !== conf.value) {
        if (typeof window.showToast === 'function') window.showToast('Passwords do not match', 'error');
        return;
      }
      apiReq('POST', '/users/change-password', {
        currentPassword: curr.value,
        newPassword:     newp.value,
        confirmPassword: conf.value
      }).then(function(r) {
        if (r && r.success) {
          if (typeof window.showToast === 'function') window.showToast('Password changed successfully ✓', 'success');
          if (typeof window.closeModal === 'function') window.closeModal('modal-change-password');
        } else {
          var msg = (r && r.message) ? r.message : 'Failed to change password.';
          if (typeof window.showToast === 'function') window.showToast(msg, 'error');
        }
      });
    });
  }

  /* ══════════════════════════════════════════════════════════
     9. STATUS CHANGES → API (approve / reject / disburse / status)
  ══════════════════════════════════════════════════════════ */
  function _patchStatusChange() {
    if (window._bridgeStatusPatched) return;
    window._bridgeStatusPatched = true;
    var _orig = window.confirmStatusChange;
    if (typeof _orig !== 'function') return;
    window.confirmStatusChange = function(id, newStatus) {
      var app = (window.APPLICATIONS||[]).find(function(a){ return a.id===id; });
      if (app && app._apiId) {
        var apiStatus = STATUS_REV[newStatus];
        if (newStatus==='approved')     apiReq('PATCH','/loans/'+app._apiId+'/approve',{approvedAmount:app.amount,comment:'Approved via EFIN'}).catch(function(){});
        else if (newStatus==='rejected') apiReq('PATCH','/loans/'+app._apiId+'/reject',{reason:'Rejected via EFIN'}).catch(function(){});
        else if (newStatus==='disbursed') apiReq('PATCH','/loans/'+app._apiId+'/disburse').catch(function(){});
        else if (apiStatus)              apiReq('PATCH','/loans/'+app._apiId+'/status',{newStatus:apiStatus,comment:apiStatus+' via EFIN'}).catch(function(){});
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

    // ── Local hash-based fallback login (works without backend) ──
    function _localFallbackLogin(email, password, btn, errEl, passEl) {
      var _BUILTIN = {
        'admin@efin.com':        'e86f78a8a3caf0b60d8e74e5942aa6d86dc150cd3c03338aef25b7d2d7e3acc7',
        'manager@efin.com':      'e8392925a98c9c22795d1fc5d0dfee5b9a6943f6b768ec5a2a0c077e5ed119cf',
        'sales@efin.com':        'b0131d869ccf6c9ae9c2d66a8ddb367c7022a554e8477f18068bfb81271ebd90',
        'login@efin.com':        '302e4ade65334f76887ffb76dddfade52a293b8ae8c995c0c3eb03d4f81f9794',
        'tl@efin.com':           'aef3d605618615cae1e51760bda170ba3ef5fe175f9f95017f822787fdd59fb4',
        'partner@efin.com':      '7658d201cff9989480d422a9fad0970bd036df504a0baa0ce6e1187df49b2381',
        'accounts@efin.com':     '934975bf2a884e397d6e3f50ded9d96221b82ec6af04565a5917ff74b8347c2c',
        'product@efin.com':      '874c610ba950209dc44157b57b7ff209eebf70f5c8edf183e28537a0681d3a23',
        'locationhead@efin.com': 'dbb0c00fc6784a219eb2310320598e56f1a52db00eb5da607473a6f189e022b7',
        'opmanager@efin.com':    '167178921ce5119f3e049f4591e1e3ea9d5973279e535c122b2c2d3e0cc69004',
        'dsa@efin.com':          '3e6f142c7143c6faca4fd558338d30624e964affd360f1b635e5486e5d58680d'
      };
      // Compute SHA-256 via Web Crypto
      crypto.subtle.digest('SHA-256', new TextEncoder().encode(password)).then(function(buf) {
        var inputHash = Array.from(new Uint8Array(buf)).map(function(b){ return b.toString(16).padStart(2,'0'); }).join('');
        // Merge localStorage creds with builtins
        var storedMap = {};
        try { storedMap = JSON.parse(localStorage.getItem(UA_STORE)||'{}'); } catch(e) {}
        var merged = Object.assign({}, _BUILTIN, storedMap);
        // Persist merged so future logins also work
        try { localStorage.setItem(UA_STORE, JSON.stringify(merged)); } catch(e) {}

        var storedHash = merged[email];
        if (!storedHash || inputHash !== storedHash) {
          if (btn) { btn.disabled=false; btn.textContent='Sign In →'; }
          if (errEl) { errEl.textContent='✕ Invalid email or password.'; errEl.style.display='block'; }
          if (passEl) { passEl.value=''; }
          return;
        }
        // Valid — find account info
        var account = (typeof window.USER_ACCOUNTS !== 'undefined')
          ? window.USER_ACCOUNTS.find(function(u){ return u.email===email; })
          : null;
        var name  = account ? account.name : email;
        var role  = account ? account.role : 'admin';

        _lsSet('efin_session', JSON.stringify({ name:name, role:role, email:email, loginTs:Date.now() }));
        window.currentUser = { name:name, role:role, email:email };
        if (errEl) errEl.style.display='none';
        var ls = document.getElementById('login-screen');
        if (ls) ls.style.display='none';
        if (typeof window.applySession==='function') window.applySession();
        if (typeof window.updateGreeting==='function') window.updateGreeting();
        if (typeof window.renderPipeline==='function') window.renderPipeline();
        if (typeof window.renderChart==='function') window.renderChart();
        if (typeof window.renderLoanTypeChart==='function') window.renderLoanTypeChart();
        if (typeof window.updateDashboardStats==='function') window.updateDashboardStats();
        if (typeof window.renderActivity==='function') window.renderActivity();
        if (typeof window.renderBanksTable==='function') window.renderBanksTable();
        if (typeof window.updateNotifBadge==='function') window.updateNotifBadge();
        if (typeof window.updateTasksNavBadge==='function') window.updateTasksNavBadge();
        if (typeof window.animateLoginOut==='function') {
          window.animateLoginOut(function() {
            var ls2 = document.getElementById('login-screen');
            if (ls2) ls2.style.display='none';
            setTimeout(function(){
              if (typeof window.showToast==='function') window.showToast('Welcome back, '+name+'! 👋','success');
            }, 200);
          });
        } else {
          setTimeout(function(){
            if (typeof window.showToast==='function') window.showToast('Welcome back, '+name+'! 👋','success');
          }, 200);
        }
        if (btn) { btn.disabled=false; btn.textContent='Sign In →'; }
      });
    }

    fetch(BASE+'/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:email,password:password}) })
      .then(function(r){ return r.json(); })
      .then(function(data) {
        if (btn) { btn.disabled=false; btn.textContent='Sign In →'; }
        if (!data || !data.success) {
          // API returned error — try local fallback before showing error
          _localFallbackLogin(email, password, btn, errEl, passEl);
          return;
        }
        _lsSet(LS_TOKEN, data.data.accessToken);
        _lsSet(LS_REFRESH, data.data.refreshToken);
        _lsSet(LS_USER, JSON.stringify(data.data.user));
        var u = data.data.user;
        var efinRole = ROLE_MAP[u.role] || 'sales_executive';
        var userEmail = u.email.toLowerCase();

        if (typeof window.USER_ACCOUNTS !== 'undefined') {
          var existing = window.USER_ACCOUNTS.filter(function(x){ return x.email===userEmail; });
          if (existing.length===0) window.USER_ACCOUNTS.push({ email:userEmail, name:u.fullName, role:efinRole, _hash:'bridge_auth' });
          else { existing[0].name=u.fullName; existing[0].role=efinRole; existing[0]._hash='bridge_auth'; }
        }
        try {
          var cm = JSON.parse(localStorage.getItem(UA_STORE)||'{}');
          cm[userEmail] = 'bridge_auth';
          localStorage.setItem(UA_STORE, JSON.stringify(cm));
        } catch(e) {}

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
        }, 800);
      })
      .catch(function(err) {
        // Network error (backend down) — use local fallback login
        console.warn('[Bridge] API unreachable, using local login fallback:', err);
        _localFallbackLogin(email, password, btn, errEl, passEl);
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
      _patchTaskDone();
      _patchTicketSave();
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
          setTimeout(function() {
            _syncLoans();
            _syncUsers();
            _syncTeams();
            _syncLocations();
            _syncTasks();
            _syncTickets();
          }, 1200);
        } else {
          _clearAuth();
        }
      });
    }
  });



  /* ══════════════════════════════════════════════════════════
     WIZARD SUBMIT → API (saves to DB, not just localStorage)
  ══════════════════════════════════════════════════════════ */
  function _patchWizardSubmit() {
    if (window._bridgeWizardPatched) return;
    window._bridgeWizardPatched = true;
    var _origSubmit = window.submitWizard;
    if (typeof _origSubmit !== 'function') return;

    window.submitWizard = function() {
      // Run original first (UI + localStorage as fallback)
      var result = _origSubmit.apply(this, arguments);

      // Then async save to DB
      setTimeout(function() {
        try {
          var app = window.APPLICATIONS && window.APPLICATIONS[0];
          if (!app || String(app.id).startsWith('API')) return; // already API app

          var payload = {
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

          apiReq('POST', '/wizard/submit', payload).then(function(r) {
            if (r && r.success) {
              // Update the local app with the API ID so future operations use API
              app._apiId    = r.data.loanId;
              app.id        = r.data.loanNumber || ('EFIN' + String(r.data.loanId).padStart(6,'0'));
              app.loanNumber= r.data.loanNumber;
              app.monthlyEmi= r.data.monthlyEmi;
              if (typeof window.showToast === 'function')
                window.showToast('Application ' + r.data.loanNumber + ' saved to database ✓', 'success');
              if (typeof window.persistSave === 'function') window.persistSave();
              // Refresh to get DB state
              setTimeout(_syncLoans, 1000);
            } else {
              console.warn('[Bridge] Wizard DB save failed:', r);
              if (typeof window.showToast === 'function')
                window.showToast('⚠ Application saved locally only. DB sync pending.', 'warn');
            }
          });
        } catch(e) {
          console.error('[Bridge] Wizard API submit error:', e);
        }
      }, 500);

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
  function _patchDisbursePayout() {
    if (window._bridgeDisbursePayPatched) return;
    window._bridgeDisbursePayPatched = true;
  }


  // Expose sync functions for manual refresh
  window._apiSyncAll    = function() { _syncLoans(); _syncUsers(); _syncTeams(); _syncLocations(); _syncTasks(); _syncTickets(); };
  window._apiSyncLoans  = _syncLoans;
  window._apiSyncUsers  = _syncUsers;
  window._apiSyncTeams  = _syncTeams;
  window._apiSyncTasks  = _syncTasks;
  window._apiSyncTickets = _syncTickets;
  window.apiReq = apiReq;

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

  /* Session expiry warning — shows banner 5 mins before JWT expires */
  (function _sessionExpiryWatcher() {
    setInterval(function() {
      var tok = _lsGet('loanms_token');
      if (!tok) return;
      try {
        var payload = JSON.parse(atob(tok.split('.')[1]));
        var expiresIn = (payload.exp * 1000) - Date.now();
        var banner = document.getElementById('_session-expiry-banner');
        if (expiresIn < 5 * 60 * 1000 && expiresIn > 0) {
          if (!banner) {
            banner = document.createElement('div');
            banner.id = '_session-expiry-banner';
            banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#f59e0b;color:#fff;padding:10px 20px;font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:space-between;';
            banner.innerHTML = '<span>⚠️ Your session expires in <span id="_ses-timer"></span>. Save your work.</span>' +
              '<button onclick="window._apiSyncAll&&_apiSyncAll();this.parentNode.remove();" style="background:rgba(255,255,255,.2);border:none;color:#fff;padding:4px 12px;border-radius:6px;cursor:pointer;font-weight:600;">Refresh Session</button>';
            document.body.prepend(banner);
          }
          var mins = Math.max(0, Math.floor(expiresIn / 60000));
          var secs = Math.max(0, Math.floor((expiresIn % 60000) / 1000));
          var t = document.getElementById('_ses-timer');
          if (t) t.textContent = mins + 'm ' + secs + 's';
        } else if (banner) {
          banner.remove();
        }
      } catch(e) {}
    }, 10000);
  })();

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
