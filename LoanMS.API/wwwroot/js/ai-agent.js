/**
 * EFIN Akshiv  —  ai-agent.js
 *
 * Pipeline strictly mirrors the real workflow:
 *   wip → login → underwriting → offer → approved → acceptance → disbursed
 *
 * Stage processors mirror exact manual button actions:
 *   wip          — validates fields, resolves bank, ensures Personal Details & Address entries
 *   login        — doc gate, CPA Docs Check, Income Check (CPA), Bank Details Check,
 *                  ECS/Charge, EFIN-Login 'DONE' — sets all 4 check flags
 *   underwriting — CIBIL gate, EFIN-Underwriting 'Move', Verification, PD Call
 *   offer        — EMI calc, EFIN First Offer, EFIN-Final Offer Check 'Offer accepted'
 *   approved     — EFIN-Approved (Sub Note only — matches SUB_NOTE_ONLY_TASKS)
 *   acceptance   — Customer Confirmation, EFIN-Nach (nach_done=true),
 *                  EFIN-Customer Agreement (customer_agreement_done=true)
 *   disbursed    — 5 EFIN-Disbursed entries matching changeStatus() exactly
 *
 * Column routing follows efin-app.js lists:
 *   SUB_NOTE_ONLY_TASKS  : EFIN-Approved, EFIN-Disbursed, EFIN- Bank Details Check
 *   COMMENT_ONLY_TASKS   : EFIN-Income Check - CPA, EFIN-Charge
 */
(function () {
  'use strict';
// ── Safe localStorage helpers (private to this module) ──
var _lsGet = function(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } };
var _lsSet = function(k,v){ try{ localStorage.setItem(k,v); }catch(e){} };
var _lsRemove = function(k){ try{ localStorage.removeItem(k); }catch(e){} };
;

  function onReady(cb) {
    if (window.APPLICATIONS && window.addTrackingEntry && window.changeStatus) { cb(); return; }
    var t = setInterval(function () {
      if (window.APPLICATIONS && window.addTrackingEntry && window.changeStatus) { clearInterval(t); cb(); }
    }, 100);
  }

  // ── Constants ─────────────────────────────────────────────────────────────
  const AGENT_USER  = 'Akshiv';
  const AGENT_STORE = 'efin_ai_agent_v3';
  const CFG_STORE   = 'efin_ai_agent_cfg_v3';

  // Real pipeline — wip→login→underwriting→offer→approved→acceptance→disbursed
  const PIPELINE = ['wip','login','underwriting','offer','approved','acceptance','disbursed'];

  const DEFAULT_CFG = {
    enabled: false, autoOnSubmit: true,
    fallbackUserId: 'USR-0007', fallbackUserName: 'Login Officer',
    requireDocGate: true, loanNo_prefix: 'E-LAN', claudeDocReview: true,
    // Agent only auto-processes up to & including this stage. Stages after this
    // (offer, approved, acceptance, disbursed) need a real human action or a real
    // lender-email reply — the agent will NOT auto-fill them with placeholder data.
    autoUpToStage: 'login',
  };

  let _cfg = Object.assign({}, DEFAULT_CFG);
  function _loadCfg() { try { var r=localStorage.getItem(CFG_STORE); if(r) _cfg=Object.assign({},DEFAULT_CFG,JSON.parse(r)); } catch(e){} }
  function _saveCfg() { try { localStorage.setItem(CFG_STORE,JSON.stringify(_cfg)); } catch(e){} }

  let _runs = {};
  function _loadRuns() { try { var r=localStorage.getItem(AGENT_STORE); _runs=r?JSON.parse(r):{} } catch(e){_runs={};} }
  function _saveRuns() { try { localStorage.setItem(AGENT_STORE,JSON.stringify(_runs)); } catch(e){} }
  function _startRun(id) {
    if(!_runs[id]) _runs[id]=[];
    var run={runId:'RUN-'+Date.now(),startedAt:new Date().toISOString(),finishedAt:null,steps:[],status:'running',error:null};
    _runs[id].unshift(run); if(_runs[id].length>20) _runs[id]=_runs[id].slice(0,20);
    _saveRuns(); return run;
  }
  function _logStep(run,stage,action,result,detail){ run.steps.push({ts:new Date().toISOString(),stage,action,result,detail:detail||''}); _saveRuns(); }
  function _finishRun(run,status,error){ run.finishedAt=new Date().toISOString(); run.status=status; run.error=error||null; _saveRuns(); }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function _ts() {
    var n=new Date();
    return n.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})+' '+n.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
  }
  function _inrFmt(v) { return '\u20b9'+Number(v).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function _dateFmt(dateStr) {
    if(!dateStr) return new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'2-digit',year:'numeric'}).replace(/\//g,'-');
    var d=new Date(dateStr); if(isNaN(d)) return dateStr;
    return ('0'+d.getDate()).slice(-2)+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+d.getFullYear();
  }

  // Post tracking entry attributed to Akshiv.
  // subNoteOnly=true  → matches SUB_NOTE_ONLY_TASKS  (EFIN-Approved, EFIN-Disbursed, EFIN- Bank Details Check)
  //                     data routes to sub_note column; comment shows '—'
  // subNoteOnly=false → matches COMMENT_ONLY_TASKS  (EFIN-Income Check - CPA, EFIN-Charge)
  //                     data routes to comment column; sub_note blank
  function _aiTrack(app,name,stage,comment,subnote,subNoteOnly) {
    if(!app.tracking) app.tracking=[];
    app.tracking.push({id:app.tracking.length+1,name,current_stage:stage,current_user:AGENT_USER,
      status:'Complete',comment:comment||'',sub_note:subnote||'',date:_ts(),_ai:true,_subNoteOnly:!!subNoteOnly});
  }

  function _save() {
    if(typeof persistSave==='function') persistSave();
    if(typeof renderTable==='function') renderTable();
    if(typeof renderPipeline==='function') renderPipeline();
    if(typeof updateDashboardStats==='function') updateDashboardStats();
  }

  function _createTask(app, taskName, note, priority, assignTo) {
    if(!window.TASK_STORE) window.TASK_STORE=[];
    var users=window.twUsers||[];
    var fb=assignTo
      ?(users.find(function(u){return u.name===assignTo;})||users.find(function(u){return u.uid===_cfg.fallbackUserId;})||users[0]||{})
      :(users.find(function(u){return u.uid===_cfg.fallbackUserId;})||users[0]||{});
    var task={id:Date.now()*1000+Math.floor(Math.random()*1000),appId:app.id,assign_type:'ai_agent_task',name:taskName,
      user_name:AGENT_USER,remarks:note||'',assign_user:assignTo||fb.name||_cfg.fallbackUserName,
      date_assigned:_ts(),status:'draft',completed_user:null,completion_date:null,completion_remark:null,
      _agentCreated:true,priority:priority||'high'};
    window.TASK_STORE.push(task);
    return task;
  }

  // ── WIZARD DATA READER ────────────────────────────────────────────────────
  function _getWizardData(app) {
    var declaredSalary=parseFloat(app.salary)||0;
    var pseResult=(window.PSE&&window.PSE.analysisResult)?window.PSE.analysisResult:null;
    var slipRows=[];
    if(pseResult&&pseResult.slips) {
      pseResult.slips.forEach(function(s,i){
        if(s.net>0||s.gross>0) slipRows.push({net:s.net||0,gross:s.gross||0,month:s.label||('Slip '+(i+1)),date:_dateFmt(''),file:s.file||null});
      });
    }
    var uploadedDocs=app.uploadedDocs||[];
    var pseSlipDocs=uploadedDocs.filter(function(d){return d.storeKey&&d.storeKey.startsWith('docitem-pse-slip-');});
    var salarySlipDocs=uploadedDocs.filter(function(d){
      var n=(d.docName||d.fileName||'').toLowerCase();
      return /salary.?slip|payslip|pay.?roll/i.test(n)&&!(d.storeKey&&d.storeKey.startsWith('docitem-pse-slip-'));
    });
    var salaryLines=[];
    if(slipRows.length>0) {
      slipRows.forEach(function(r){salaryLines.push(r.date+'   '+r.net+'   '+r.month);});
    }
    // Note: if only slip *files* exist without extracted net amounts, we do NOT
    // fabricate salary lines from the declared salary — handled as a mismatch later.
    var panName=(window.KYC&&window.KYC.pan&&window.KYC.pan.data&&window.KYC.pan.data.full_name)||'';
    var bankStmtDoc=uploadedDocs.find(function(d){return /bank.?stat|account.?stat|passbook/i.test((d.docName||d.fileName||''));});
    return {
      declaredSalary,pseResult,slipRows,salaryLines,
      allSlipDocs:pseSlipDocs.concat(salarySlipDocs),pseSlipDocs,salarySlipDocs,
      panName,aadhaarName:(window.KYC&&window.KYC.aadhar&&window.KYC.aadhar.data&&window.KYC.aadhar.data.full_name)||'',
      bankName:app.verifiedBankName||'',holderName:app.verifiedHolder||app.name||'',
      accNo:app.verifiedAccNo||'',ifscCode:app.verifiedIFSC||'',bankStmtDoc,
      empType:(app.empType||'SALARIED').toUpperCase(),
    };
  }

  // -- DYNAMIC DATE-BASED INCOME VALIDATION ----------------------------------
  // Determines the THREE required salary-slip months from the current date, then
  // for each required month matches the slip's Net Salary against a Bank Statement
  // salary credit that falls inside that month's credit window (20th of the salary
  // month -> 15th of the following month). Reuses the existing salary-credit
  // sources (Perfios Salary + NEFT/RTGS) and the existing EXACT amount match rule.
  // Completes only when all 3 slips are present, each has a matching credit inside
  // its own window, and every amount matches. No assumptions, no dummy matches.
  var _INC_MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var _INC_MON_FULL = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];

  // The 3 required months (oldest -> newest), rolling automatically from today.
  // Before the 15th -> previous 3 completed months (newest = current month - 2).
  // On/after the 15th -> window shifts forward by one (newest = current month - 1).
  function _incRequiredMonths(today) {
    var now = today || new Date();
    var y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    var recentBack = (d < 15) ? 2 : 1;
    var out = [];
    for (var k = 2; k >= 0; k--) {
      var dt = new Date(y, m - recentBack - k, 1);
      out.push({ y: dt.getFullYear(), m: dt.getMonth() });
    }
    return out;
  }
  function _incMonLabel(mo) { return _INC_MON[mo.m] + ' ' + mo.y; }

  // Parse a slip label like "Apr 2026" into {y,m}; null if no real month/year.
  function _incParseSlipMonth(label) {
    if (!label) return null;
    var s = String(label).trim(), mm = -1;
    for (var i = 0; i < 12; i++) { if (new RegExp('\\b' + _INC_MON[i], 'i').test(s)) { mm = i; break; } }
    var ym = s.match(/(20\d{2})/);
    if (mm < 0 || !ym) return null;
    return { y: parseInt(ym[1], 10), m: mm };
  }

  // Normalise a bank transaction date to a Date (handles Date object or string).
  function _incTxnDate(t) {
    var d = t && t.date;
    if (!d) return null;
    var p = (d instanceof Date) ? d : new Date(d);
    return isNaN(p.getTime()) ? null : p;
  }

  function _crossVerifySalary(app,wiz) {
    var result={pass:false,avgNet:0,variance:0,issue:'',comment:'',salaryLines:wiz.salaryLines,mismatch:false};

    // 1) Required salary-slip months, derived dynamically from the current date.
    var required=_incRequiredMonths();
    var reqLabels=required.map(_incMonLabel);

    // 2) Bank Statement (Perfios) must be present to validate salary credits.
    var perf=window._lastPerfiosReport||window._lastPerfiosData||window._pendingPerfiosData||null;
    if(!perf) {
      result.issue='Bank Statement not uploaded/verified \u2014 cannot validate salary credits for '+reqLabels.join(', ')+'.';
      result.comment='Income verification failed';
      return result;
    }

    // 3) Salary-credit candidates from the Bank Statement -- reuse the existing
    //    salary-identification logic (Perfios Salary + NEFT/RTGS), credits only.
    var isCredit=function(t){var ty=String(t&&t.type||'').toUpperCase();return ty===''||ty==='CR'||ty==='CREDIT'||ty.indexOf('CR')===0;};
    var creditTxns=(perf.salary||[]).concat(perf.neft||perf.neftTxns||[]).filter(isCredit);

    // 4) Index uploaded slips by their detected month -> Net Salary amount.
    var slipByKey={};
    (wiz.slipRows||[]).forEach(function(r){
      var pm=_incParseSlipMonth(r.month);
      if(pm&&(Number(r.net)||0)>0) slipByKey[pm.y+'-'+pm.m]=Math.round(Number(r.net));
    });

    // 5) For each required month: slip present? matching credit inside its window?
    var usedTxn=[], lines=[], nets=[];
    var missingSlips=[], amountMismatch=[], noCreditFound=[];
    for(var i=0;i<required.length;i++) {
      var mo=required[i], key=mo.y+'-'+mo.m, label=_incMonLabel(mo);
      var nextMon=_INC_MON[(mo.m+1)%12];
      var net=slipByKey[key];

      if(net===undefined) {
        missingSlips.push(label);
        lines.push(label+'  :  slip not found');
        continue;
      }
      nets.push(net);

      // Credit window: 20th of the salary month -> 15th of the following month.
      var winStart=new Date(mo.y,mo.m,20,0,0,0);
      var winEnd=new Date(mo.y,mo.m+1,15,23,59,59);

      var matchIdx=-1, anyInWindow=false;
      for(var j=0;j<creditTxns.length;j++) {
        if(usedTxn.indexOf(j)>=0) continue;
        var dt=_incTxnDate(creditTxns[j]);
        if(!dt||dt<winStart||dt>winEnd) continue;
        anyInWindow=true;
        if(Math.round(Number(creditTxns[j].amount)||0)===net) { matchIdx=j; break; }
      }

      if(matchIdx<0) {
        if(anyInWindow) {
          amountMismatch.push(label);
          lines.push(label+'  :  Net \u20b9'+net.toLocaleString('en-IN')+'  \u2192  amount not matched in window (20 '+_INC_MON[mo.m]+' \u2013 15 '+nextMon+')');
        } else {
          noCreditFound.push(label);
          lines.push(label+'  :  Net \u20b9'+net.toLocaleString('en-IN')+'  \u2192  no credit in window (20 '+_INC_MON[mo.m]+' \u2013 15 '+nextMon+')');
        }
        continue;
      }

      usedTxn.push(matchIdx);
      var matchedDate = _incTxnDate(creditTxns[matchIdx]);
      var dateStr = matchedDate
        ? String(matchedDate.getDate()).padStart(2,'0')+'/'+String(matchedDate.getMonth()+1).padStart(2,'0')+'/'+matchedDate.getFullYear()
        : '—';
      lines.push(dateStr+'--'+net+'   '+_INC_MON_FULL[mo.m]);
    }

    // One short line per problem category (not one full sentence per month) —
    // keeps the blocked-task reason and timeline note readable even when
    // several months are affected. Full per-month detail is still in 'lines'
    // (used for the SALARY DETAILS block on the app when income passes).
    var problems=[];
    if(missingSlips.length)   problems.push('Salary slip(s) missing: '+missingSlips.join(', ')+'.');
    if(amountMismatch.length) problems.push('Salary credit amount mismatch: '+amountMismatch.join(', ')+'.');
    if(noCreditFound.length)  problems.push('No salary credit found: '+noCreditFound.join(', ')+'.');

    var detail='SALARY DATE\n'+lines.join('\n');

    // 6) Complete ONLY when all 3 required slips matched inside their windows.
    if(problems.length) {
      result.mismatch=true;
      result.issue=problems.join(' ');
      result.comment='Income verification failed';
      return result;
    }

    result.pass=true;
    result.avgNet=nets.length?Math.round(nets.reduce(function(a,b){return a+b;},0)/nets.length):0;
    result.comment=detail+'\n\nCOMMENT :- SALARY MATCH WITH ACCOUNT STATEMENT AND SALARY SLIP';
    return result;
  }

  function _extractBankDetails(app,wiz) {
    // Pull ONLY real data from the uploaded Perfios bank statement (Account Details).
    var perf = window._lastPerfiosReport || window._lastPerfiosData || window._pendingPerfiosData || null;
    var acc  = (perf && perf.accountInfo) ? perf.accountInfo
             : (perf && perf.perFileData && perf.perFileData[0] && perf.perFileData[0].accountInfo) ? perf.perFileData[0].accountInfo
             : null;
    var bankName   = wiz.bankName   || (acc && acc.bank)      || '';
    var holderName = wiz.holderName || (acc && acc.name)      || '';
    var accNo      = wiz.accNo      || (acc && acc.accountNo) || '';
    var ifscCode   = wiz.ifscCode   || (acc && acc.ifsc)      || '';

    // No real bank-statement data → do NOT fabricate. Signal the caller to skip.
    var hasReal = !!(acc || (bankName && accNo));
    if (!hasReal) {
      return { skip:true, reason:'No bank statement / Account Details found. Upload & verify the bank statement (Perfios) first.' };
    }

    var out = {
      bankName: bankName || '\u2014',
      holderName: holderName || app.name || '\u2014',
      accNo: accNo || '\u2014',
      ifscCode: ifscCode || '\u2014',
      branch: (acc && acc.branch) || '',
      accountType: (acc && acc.accountType) || '',
      verdict: 'OKAY TO PROCESS',
    };
    if(wiz.panName&&out.holderName&&out.holderName!=='\u2014') {
      var panNorm=wiz.panName.trim().toLowerCase(), holdNorm=out.holderName.trim().toLowerCase();
      var matched=holdNorm.includes(panNorm.split(' ')[0])||panNorm.includes(holdNorm.split(' ')[0]);
      if(!matched) out.verdict='NAME MISMATCH \u2014 VERIFY';
    }
    return out;
  }

  function _extractEcsData(app) {
    var ecsEntries=(app.tracking||[]).filter(function(t){return t.name==='EFIN-Charge'&&t.comment&&/ecs return seen/i.test(t.comment);});
    if(ecsEntries.length>0) return {hasEcs:true,comment:ecsEntries[0].comment};
    return {hasEcs:false,comment:'Ecs return- Nil'};
  }

  function _getAppDocs(app) {
    return (app.uploadedDocs||[]).map(function(d){
      var name=(d.docName||d.fileName||'').toLowerCase();
      return Object.assign({},d,{nameLower:name,
        isPayslip:/salary.?slip|payslip|pay.?roll/i.test(name),
        isBankStmt:/bank.?stat|account.?stat|passbook/i.test(name),
        isPan:/pan.?card|\bpan\b/i.test(name),
        isAadhaar:/aadh?ar|uid/i.test(name),
        isItr:/itr|income.?tax/i.test(name),
        isAppt:/appointment|offer.?letter|employment/i.test(name),
        isForm16:/form.?16/i.test(name),
      });
    });
  }

  // Document gate — mirrors the login_team's manual checks
  function _checkDocs(app) {
    if(!_cfg.requireDocGate) return {pass:true,missing:[]};
    var docs=_getAppDocs(app);
    var empType=(app.empType||'SALARIED').toUpperCase();
    var missing=[];
    var hasPan=docs.some(function(d){return d.isPan;})||!!(app.kycDocs&&app.kycDocs.panFile)||!!app.pan;
    var hasAadhar=docs.some(function(d){return d.isAadhaar;})||!!(app.kycDocs&&app.kycDocs.aadharFile)||!!app.aadhar;
    var hasBank=docs.some(function(d){return d.isBankStmt;});
    if(!hasPan)    missing.push('PAN Card');
    if(!hasAadhar) missing.push('Aadhaar Card');
    if(!hasBank)   missing.push('Bank Statement (last 6 months)');
    if(empType==='SALARIED'||empType==='SALARIED_BTB') {
      var pse=(app.uploadedDocs||[]).filter(function(d){return d.storeKey&&d.storeKey.startsWith('docitem-pse-slip-');});
      if(pse.length+docs.filter(function(d){return d.isPayslip;}).length===0) missing.push('Salary Slips (last 3 months)');
    } else {
      if(!docs.some(function(d){return d.isItr;})) missing.push('ITR / P&L / Balance Sheet');
    }
    return {pass:missing.length===0,missing};
  }

  // ── CLAUDE DOCUMENT ANALYSIS ──────────────────────────────────────────────
  var DOC_SYS='You are a loan document verification specialist for EFIN Financial Services, India. Analyse the document text and return ONLY valid JSON — no markdown.\n{"documentType":"salary_slip|bank_statement|pan_card|aadhaar|itr|unknown","isValid":true,"confidence":"high|medium|low","monthDetected":null,"netSalary":null,"grossSalary":null,"bankName":null,"accountNumber":null,"holderName":null,"ifscCode":null,"issues":[],"summary":""}';
  async function _claudeAnalyse(text,type,appId) {
    if(!text||text.trim().length<50) return null;
    try {
      var resp=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:600,system:DOC_SYS,
          messages:[{role:'user',content:'App:'+appId+'\nExpected:'+type+'\n\nContent:\n'+text.substring(0,3000)}]})});
      var data=await resp.json();
      var txt=(data.content||[]).map(function(b){return b.text||'';}).join('').trim().replace(/^```[a-z]*\n?/,'').replace(/\n?```$/,'').trim();
      return JSON.parse(txt);
    } catch(e){return null;}
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  STAGE PROCESSORS
  //  Each processor mirrors exactly the sequence of manual button actions
  //  that a login_team member would perform at that stage.
  // ══════════════════════════════════════════════════════════════════════════
  // A real, positive lender/customer reply must exist before Akshiv can complete
  // offer-acceptance and the stages after it. Only the actual logged bank reply
  // (logBankReply → app.lender_last_reply) counts — never assumptions or auto-fill.
  function _hasApprovalReply(app) {
    var r = app && app.lender_last_reply;
    var d = r && r.decisionType;
    var lenderReplyOk = d === 'full_approval' || d === 'conditional_approval' || d === 'disbursed';
    // User manually filled in approval details via "Approve with Details"
    // (laSaveSanctionToApp sets app.sanctionLoanAmt whenever that flow is
    // completed) — this alone also satisfies the gate, same as a real
    // lender reply.
    var manualDetailsOk = !!(app && app.sanctionLoanAmt > 0);
    return lenderReplyOk || manualDetailsOk;
  }

  // Property verification (FI Report) gate for the Approval stage.
  // Reads the FI selections recorded by the manual FI flow (app.fi_resi / app.fi_office;
  // app.final_report is set when the FI report is posted). Must be Positive to proceed:
  //   • Negative          → stage stays incomplete (physical re-verification needed)
  //   • Pending / missing  → progression blocked with a clear reason
  //   • Waived is treated as an explicit, resolved business decision (accepted).
  function _checkFiReport(app) {
    var resi = app && app.fi_resi, office = app && app.fi_office;
    if(!app || (!app.final_report && !resi && !office)) {
      return {ok:false, reason:'Property verification (FI Report) has not been completed yet \u2014 it must be Positive before the Approval stage.'};
    }
    var ok = function(v){ return v === 'Positive' || v === 'Waived'; };
    var neg = [];
    if(resi === 'Negative')  neg.push('Residence');
    if(office === 'Negative') neg.push('Office');
    if(neg.length) {
      return {ok:false, reason:'Property verification (FI Report) is Negative for '+neg.join(' & ')+' \u2014 Approval cannot proceed; physical re-verification required.'};
    }
    var pend = [];
    if(!ok(resi))   pend.push('Residence ('+(resi||'not recorded')+')');
    if(!ok(office)) pend.push('Office ('+(office||'not recorded')+')');
    if(pend.length) {
      return {ok:false, reason:'Property verification (FI Report) is not Positive yet \u2014 pending: '+pend.join(', ')+'. Approval cannot proceed until it is Positive.'};
    }
    return {ok:true};
  }

  var STAGE_PROCESSORS = {

    // ── WIP ──────────────────────────────────────────────────────────────────
    // Validates minimum fields set by submitWizard.
    // Resolves app.bank from eligibleBankNames if not yet set.
    // Posts Personal Details + Current Address entries only if not already present
    // (submitWizard already posts them for new apps; this covers apps run manually).
    // nextStatus → 'login'
    async wip(app,run) {
      _logStep(run,'wip','Personal details validation','processing','');
      var missing=[];
      if(!app.name||!app.mobile)           missing.push('name / mobile');
      if(!app.pan)                          missing.push('PAN');
      if(!app.loanType)                     missing.push('loan type');
      if(!app.amount||app.amount<10000)     missing.push('loan amount \u2265 \u20b910,000');
      var hasBank=(app.bank&&app.bank!=='\u2014'&&app.bank!=='')||(app.eligibleBankNames&&app.eligibleBankNames.length>0)||(app.eligibleBanks&&app.eligibleBanks.length>0);
      if(!hasBank) missing.push('lender / bank assignment');
      if(missing.length) {
        _createTask(app,'WIP \u2014 Incomplete Details','Missing: '+missing.join(', '),'high',
          app.sales||(window.currentUser&&currentUser.name)||_cfg.fallbackUserName);
        return {success:false,blocked:true,blockReason:'Incomplete details: '+missing.join(', ')};
      }
      // Resolve bank name
      if(!app.bank||app.bank==='\u2014'||app.bank==='') {
        if(app.eligibleBankNames&&app.eligibleBankNames.length>0) {
          app.bank=app.eligibleBankNames[0]; if(typeof persistSave==='function') persistSave();
        } else if(app.eligibleBanks&&app.eligibleBanks.length>0) {
          var allBanks=[].concat(window.BANKS_STORE||[],(window.LA_DB&&window.LA_DB.banks)||[]);
          var found=allBanks.find(function(b){return b.id===app.eligibleBanks[0];});
          if(found){app.bank=found.name; if(typeof persistSave==='function') persistSave();}
        }
      }
      // Post entries only if missing (submitWizard already posts them for fresh apps)
      var hasPersonal=(app.tracking||[]).some(function(t){return t.name==='EFIN\u2014Personal Details Task completed';});
      var hasAddress=(app.tracking||[]).some(function(t){return t.name==='EFIN\u2014Current Address';});
      if(!hasPersonal) _aiTrack(app,'EFIN\u2014Personal Details Task completed','Admin','Personal Details Verified',' ');
      if(!hasAddress)  _aiTrack(app,'EFIN\u2014Current Address','Admin',(app.city?app.city+', '+app.state:'Address on file'),' ');
      return {success:true,comment:'Personal details verified',nextStatus:'login'};
    },

    // ── LOGIN ─────────────────────────────────────────────────────────────────
    // Full sequence mirrors what login_team does with the 4 check buttons:
    //
    //  1. Document gate (blocks with task if missing)
    //  2. EFIN-CPA DOCS Check  →  document_checked = true
    //     (mode='direct_doc', entry name 'EFIN-CPA DOCS Check' as posted by login_team)
    //  3. EFIN-Income Check - CPA  →  incom_check = true
    //     COMMENT_ONLY_TASKS → subNoteOnly=false (comment column)
    //  4. EFIN- Bank Details Check  →  bank_check = true
    //     SUB_NOTE_ONLY_TASKS → subNoteOnly=true (sub_note column)
    //  5. EFIN-Charge  →  ecs_return = true
    //     COMMENT_ONLY_TASKS → subNoteOnly=false (comment column)
    //  6. EFIN-Login 'DONE'  (formal login sign-off by login_team)
    //     Dept: 'Login Dep'
    //
    // nextStatus → 'login' (stays at Assign Lender — agent hands off here per autoUpToStage)
    async login(app,run) {
      _logStep(run,'login','Document checks & login','processing','');

      // 1. Document gate
      var docCheck=_checkDocs(app);
      if(!docCheck.pass) {
        docCheck.missing.forEach(function(m){
          _createTask(app,'Document Required \u2014 '+m,'Application '+app.id+' blocked at Login: '+m+' not uploaded.','high',
            app.sales||_cfg.fallbackUserName);
        });
        var shortMissing=docCheck.missing.map(function(m){return m.replace(/\s*\([^)]*\)/g,'').trim();});
        _aiTrack(app,'EFIN-Akshiv \u2014 Login Blocked','System Comments',
          'Documents Missing',
          shortMissing.join(', ')+' Missing');
        return {success:false,blocked:true,blockReason:'Documents missing: '+docCheck.missing.join('; ')};
      }

      var wiz=_getWizardData(app);
      var empType=(app.empType||'SALARIED').toUpperCase();

      // 2. CPA DOCS CHECK
      app.document_checked=true;
      _aiTrack(app,'EFIN-CPA DOCS Check','Login Dep','Documents check completed',' ');

      // 3. INCOME CHECK (COMMENT_ONLY → subNoteOnly=false)
      if(!app.incom_check) {
        if(empType==='SALARIED'||empType==='SALARIED_BTB') {
          var xv=_crossVerifySalary(app,wiz);
          if(!xv.pass) {
            _aiTrack(app,'EFIN-Income Check - CPA','Login Dep',xv.comment,'',false);
            _createTask(app,'Salary Verification Failed \u2014 '+app.id,
              xv.issue+'\nDeclared: \u20b9'+wiz.declaredSalary+' | Slips: '+wiz.allSlipDocs.length+'/3',
              'high',app.sales||_cfg.fallbackUserName);
            return {success:false,blocked:true,blockReason:xv.issue};
          }
          // Claude slip-by-slip cross-check (optional)
          if(_cfg.claudeDocReview&&window.PSE&&window.PSE.slipTexts) {
            for(var i=0;i<3;i++) {
              var txt=(window.PSE.slipTexts[i]||'').trim();
              if(txt.length>100) {
                var analysis=await _claudeAnalyse(txt,'salary_slip',app.id);
                if(analysis&&analysis.netSalary&&xv.avgNet>0) {
                  var diff=Math.abs(analysis.netSalary-xv.avgNet)/xv.avgNet;
                  if(diff>0.25) {
                    var mmc='Salary mismatch.';
                    _aiTrack(app,'EFIN-Income Check - CPA','Login Dep',mmc,'',false);
                    _createTask(app,'Salary Slip Mismatch \u2014 Slip '+(i+1),
                      'Claude detected net \u20b9'+analysis.netSalary+' on slip '+(i+1)+', declared \u20b9'+xv.avgNet,
                      'high',app.sales||_cfg.fallbackUserName);
                    return {success:false,blocked:true,blockReason:'Salary slip mismatch on slip '+(i+1)};
                  }
                  _logStep(run,'login','Claude slip '+(i+1)+' check','valid',(analysis.monthDetected||'?')+'|net \u20b9'+analysis.netSalary);
                }
              }
            }
          }
          app.incom_check=true;
          _aiTrack(app,'EFIN-Income Check - CPA','Login Dep',xv.comment,'',false);
        } else {
          // Self-employed / Professional
          var docs=_getAppDocs(app);
          if(!docs.some(function(d){return d.isItr;})) {
            _aiTrack(app,'EFIN-Income Check - CPA','Login Dep',
              'ITR / financials missing.','',false);
            _createTask(app,'ITR / Financials Required \u2014 '+app.id,'ITR or P&L not uploaded.',
              'high',app.sales||_cfg.fallbackUserName);
            return {success:false,blocked:true,blockReason:'ITR / financials not uploaded'};
          }
          var netInc=parseFloat(app.bizNetProfit||app.salary)||0;
          app.incom_check=true;
          _aiTrack(app,'EFIN-Income Check - CPA','Login Dep',
            'BUSINESS INCOME  :-\n\nNet Profit  :- '+_inrFmt(netInc)
            +'\nBusiness Vintage  :- '+(app.bizVintage||'\u2014')+' years'
            +'\nGST  :- '+(app.bizGst||'N/A')
            +'\n\nCOMMENT  :- INCOME VERIFIED \u2013 ITR AVAILABLE','',false);
        }
      }

      // 4. BANK DETAILS CHECK (SUB_NOTE_ONLY → subNoteOnly=true)
      var bank=_extractBankDetails(app,wiz);
      if(bank.skip) {
        // No real bank statement / Account Details — do NOT post dummy bank details.
        _aiTrack(app,'EFIN- Bank Details Check','Login Dep','',
          'Bank statement missing.',true);
        _createTask(app,'Bank Statement Required \u2014 '+app.id, bank.reason,
          'high',app.sales||_cfg.fallbackUserName);
        return {success:false,blocked:true,blockReason:bank.reason};
      }
      if(_cfg.claudeDocReview&&wiz.bankStmtDoc&&wiz.bankStmtDoc.dataUrl) {
        try {
          var ba=await _claudeAnalyse(wiz.bankStmtDoc.dataUrl.substring(0,800),'bank_statement',app.id);
          if(ba){
            if(ba.bankName&&ba.bankName!=='null')     bank.bankName=ba.bankName;
            if(ba.holderName&&ba.holderName!=='null') bank.holderName=ba.holderName;
            if(ba.accountNumber)                       bank.accNo=ba.accountNumber;
            if(ba.ifscCode&&ba.ifscCode!=='null')     bank.ifscCode=ba.ifscCode;
            _logStep(run,'login','Claude bank analysis','done',bank.bankName+'|'+bank.accNo);
          }
        } catch(e){}
      }
      var bankSubNote='BANK DETAILS  :-\n\n'
        +'BANK NAME  :- '+bank.bankName+'\n'
        +'ACCOUNT HOLDER NAME  :- '+bank.holderName+'\n'
        +'ACCOUNT NUMBER  :- '+bank.accNo+'\n'
        +'IFSC CODE  :- '+bank.ifscCode+'\n\n'
        +'COMMENT  :- '+bank.verdict;
      app.bank_check=true; app.bankVerified=true;
      app.verifiedBankName=bank.bankName; app.verifiedHolder=bank.holderName;
      app.verifiedAccNo=bank.accNo; app.verifiedIFSC=bank.ifscCode;
      _aiTrack(app,'EFIN- Bank Details Check','Login Dep','',bankSubNote,true);
      if(bank.verdict.includes('MISMATCH')) {
        _createTask(app,'Bank Account Name Mismatch \u2014 '+app.id,
          'Account holder: '+bank.holderName+' vs PAN name: '+wiz.panName+'. Verify.',
          'medium',app.sales||_cfg.fallbackUserName);
      }

      // 5. ECS / CHARGE (COMMENT_ONLY → subNoteOnly=false)
      var ecs=_extractEcsData(app);
      app.ecs_return=true;
      _aiTrack(app,'EFIN-Charge','Login Dep',ecs.comment,'',false);
      if(ecs.hasEcs) _createTask(app,'ECS Returns Found \u2014 '+app.id,'ECS entries detected. Verify.','medium',app.sales||_cfg.fallbackUserName);

      // 6. EFIN-Login 'DONE' — formal login sign-off (Login Dep, comment 'DONE')
      _aiTrack(app,'EFIN-Login','Login Dep','DONE',' ');

      // BUGFIX (Akshiv auto-advancing past Assign Lender): this processor used
      // to return nextStatus:'underwriting', which silently pushed the app
      // straight into Underwriting the moment Assign-Lender checks finished —
      // even though the agent is only meant to stop *at* Assign Lender and
      // hand off for a manual move to Underwriting. Status now stays 'login'
      // (Assign Lender) so the outer loop's autoUpToStage halt reflects the
      // application's real, visible status.
      return {success:true,comment:'All login checks complete',nextStatus:'login'};
    },

    // ── UNDERWRITING ──────────────────────────────────────────────────────────
    // Mirrors doUnderwriting() + changeStatus('underwriting') auto-entries:
    //   • EFIN-Underwriting 'Move'  (Login Dep or Admin dept)
    //   • EFIN-Verification  'Application under review'  (System Comments)
    //   • EFIN-PD Call  'Credit team will contact you shortly.'  (System Comments)
    // Deduplication guards: skips entries already present (prevents double-posting
    // if agent runs on an app where manual Underwriting button was already clicked).
    // CIBIL < 600 → block + task → manual credit review.
    // nextStatus → 'offer'
    async underwriting(app,run) {
      _logStep(run,'underwriting','Underwriting','processing','');
      var cibil=parseInt(app.cibil)||0;
      if(cibil>0&&cibil<600) {
        _createTask(app,'Low CIBIL \u2014 Manual Credit Review',
          'CIBIL '+cibil+' below 600 for '+app.id+'. Credit team review needed.','high',
          (window.currentUser&&currentUser.name)||_cfg.fallbackUserName);
        return {success:false,blocked:true,blockReason:'CIBIL '+cibil+' below 600 — manual review required'};
      }
      var alreadyUW=(app.tracking||[]).some(function(t){return t.name==='EFIN-Underwriting'&&t.comment==='Move';});
      if(!alreadyUW) _aiTrack(app,'EFIN-Underwriting','Admin','Move',' ');
      var alreadyVerif=(app.tracking||[]).some(function(t){return t.name==='EFIN-Verification';});
      var alreadyPd=(app.tracking||[]).some(function(t){return t.name==='EFIN-PD Call'&&/credit/i.test(t.comment);});
      if(!alreadyVerif) _aiTrack(app,'EFIN-Verification','System Comments','CIBIL '+(cibil||'N/A')+' \u2014 Application under review',' ');
      if(!alreadyPd)    _aiTrack(app,'EFIN-PD Call','System Comments','Credit evaluation complete by Akshiv',' ');
      return {success:true,comment:'Underwriting cleared | CIBIL '+(cibil||'N/A'),nextStatus:'offer'};
    },

    // ── OFFER ─────────────────────────────────────────────────────────────────
    // Mirrors openLenderApprovalModal → confirmLenderApproval():
    //   1. Calculates EMI (reducing balance method)
    //   2. Persists sanction fields on app (used by confirmDisburse pre-fill)
    //   3. Posts EFIN — First Offer with amount/rate/tenure/EMI
    //   4. Posts EFIN-Final Offer Check 'Offer accepted'
    //      → statusMap: 'EFIN-Final Offer Check' → app.status = 'offer'
    //      Agent sets app.status = 'approved' in nextStatus (skipping the 'offer'
    //      holding state since Approved button is always next step)
    //   5. Fires lewSendLenderEmail for 'offer' stage
    // nextStatus → 'approved'
    async offer(app,run) {
      _logStep(run,'offer','Generate offer','processing','');
      // Generate + send the First Offer once (idempotent — never duplicated on a re-run).
      if(!app.ai_offer) {
        var amount=parseFloat(app.amount)||0, rate=parseFloat(app.loanRate)||15, months=parseInt(app.tenure)||36;
        var m=rate/12/100;
        var emi=m?Math.round(amount*m*Math.pow(1+m,months)/(Math.pow(1+m,months)-1)):Math.round(amount/months);
        // Persist sanction fields so disburse modal pre-fills correctly
        app.sanctionLoanAmt=amount; app.sanctionROI=rate;
        app.sanctionTenureMo=months; app.sanctionTenureYr=Math.round(months/12);
        app.sanctionEMI=emi;
        app.ai_offer={amount,rate,months,emi,generatedAt:new Date().toISOString()};
        _aiTrack(app,'EFIN \u2014 First Offer','Admin',
          'Offer: \u20b9'+amount.toLocaleString('en-IN')+' @ '+rate+'% for '+months+'mo',
          'EMI: \u20b9'+emi.toLocaleString('en-IN')+'/mo \u2014 Akshiv');
        if(typeof window.lewSendLenderEmail==='function')
          window.lewSendLenderEmail(app,'offer',{isManual:false,triggeredBy:AGENT_USER});
      }
      // Offer ACCEPTANCE requires a REAL customer/lender approval reply — never auto-filled.
      if(!_hasApprovalReply(app)) {
        return {success:false,blocked:true,
          blockReason:'Offer sent \u2014 awaiting a real customer/lender acceptance reply. Akshiv will not auto-mark \u201cOffer accepted\u201d without one (log the bank reply to proceed).'};
      }
      // EFIN-Final Offer Check → statusMap entry → offer accepted (only with a real reply)
      _aiTrack(app,'EFIN-Final Offer Check','Admin','Offer accepted',' ');
      return {success:true,comment:'Offer \u20b9'+((app.ai_offer&&app.ai_offer.emi)||0).toLocaleString('en-IN')+'/mo',nextStatus:'approved'};
    },

    // ── APPROVED ──────────────────────────────────────────────────────────────
    // Mirrors the 'Approved' button at offer stage:
    //   openTrackWizard(appId, 'task', 'EFIN-Approved')
    //   → submitTracking() → statusMap: 'EFIN-Approved' → app.status = 'approved'
    //
    // EFIN-Approved is in SUB_NOTE_ONLY_TASKS list in efin-app.js:
    //   ['EFIN-Approved','EFIN-Deviation','EFIN- SKIP Deviation','EFIN-Approved Deviation','EFIN-Disbursed','EFIN- Bank Details Check']
    // So subNoteOnly=true → data routes to sub_note column; comment shows '—'.
    // nextStatus → 'acceptance'
    async approved(app,run) {
      _logStep(run,'approved','Approve','processing','');
      // Approval is real data — never auto-approve without a verified lender reply.
      if(!_hasApprovalReply(app)) {
        return {success:false,blocked:true,
          blockReason:'Approval needs a real lender approval reply on file \u2014 Akshiv will not auto-approve without it.'};
      }
      // Property verification (FI Report) must be Positive before Approval can complete.
      var fi = _checkFiReport(app);
      if(!fi.ok) {
        return {success:false,blocked:true, blockReason:fi.reason};
      }
      _aiTrack(app,'EFIN-Approved','Admin','','Approved by Akshiv',true);
      if(typeof window.lewSendLenderEmail==='function')
        window.lewSendLenderEmail(app,'approved',{isManual:false,triggeredBy:AGENT_USER});
      return {success:true,comment:'Approved',nextStatus:'acceptance'};
    },

    // ── ACCEPTANCE ────────────────────────────────────────────────────────────
    // Three sequential manual actions that unlock the Disburse button:
    //
    //   Step 1: EFIN-Customer Confirmation
    //     → statusMap: 'EFIN-Customer Confirmation' → app.status = 'acceptance'
    //     (This is the task that moves status from 'approved' to 'acceptance')
    //
    //   Step 2: EFIN-Nach  (task wizard, task type 'EFIN-Nach')
    //     → sets app.nach_done = true  [required gate for Disburse button]
    //     Only shown at status='acceptance', role != partner
    //
    //   Step 3: EFIN-Customer Agreement  (task wizard, type 'EFIN-Customer Agreement')
    //     → sets app.customer_agreement_done = true  [required gate for Disburse]
    //     Only shown at status='acceptance' && !customer_agreement_done
    //
    // Both nach_done AND customer_agreement_done must be true for Disburse to unlock.
    // nextStatus → 'disbursed'
    async acceptance(app,run) {
      _logStep(run,'acceptance','Acceptance','processing','');
      // Acceptance is completed ONLY after real Customer Acceptance + NACH + Customer
      // Agreement — never inferred from a lender approval, never auto-filled by Akshiv.
      // Signals (all set by real user actions elsewhere in the app):
      //   • Customer Acceptance → a real 'EFIN-Customer Confirmation' timeline entry (not agent-posted)
      //   • NACH               → app.nach_done  (set when the EFIN-Nach task is completed)
      //   • Customer Agreement → app.customer_agreement_done  (set by the EFIN-Customer Agreement task)
      var missing = [];
      var hasCustomerAcceptance = (app.tracking||[]).some(function(t){
        return t && t.name === 'EFIN-Customer Confirmation' && !t._ai;
      });
      if(!hasCustomerAcceptance)       missing.push('Customer Acceptance (Customer Confirmation not recorded)');
      if(!app.nach_done)               missing.push('NACH not completed');
      if(!app.customer_agreement_done) missing.push('Customer Agreement not completed');
      if(missing.length) {
        return {success:false,blocked:true,
          blockReason:'Acceptance cannot be completed \u2014 '+missing.join('; ')+'. Customer Acceptance, NACH and Customer Agreement are all mandatory and must be recorded by real action (not lender approval).'};
      }
      // All three confirmed by real action → acceptance complete.
      if(typeof window.lewSendLenderEmail==='function')
        window.lewSendLenderEmail(app,'acceptance',{isManual:false,triggeredBy:AGENT_USER});
      return {success:true,comment:'Acceptance complete',nextStatus:'disbursed'};
    },

    // ── DISBURSED ─────────────────────────────────────────────────────────────
    // Mirrors confirmDisburse() inside openDisburseModal().
    // Gate: nach_done=true AND customer_agreement_done=true (belt-and-suspenders).
    //
    // Replicates the 5 EFIN-Disbursed entries that changeStatus('disbursed') auto-posts:
    //   1. EFIN-Disbursed  Admin      comment=' '  subNote='Loan amt and tenor update'  (subNoteOnly=true)
    //   2. EFIN-Disbursed  Admin      comment=' '  subNote=loanNo                       (subNoteOnly=true)
    //   3. EFIN-Disbursed  System Comments  comment='OK to Process'    subNote=' '
    //   4. EFIN-Disbursed  System Comments  comment='Disbursement Done' subNote=' '
    //   5. EFIN-Disbursed  System Comments  comment='Work Flow Completed'  subNote=' '
    //
    // EFIN-Disbursed is in SUB_NOTE_ONLY_TASKS, so entries 1+2 use subNoteOnly=true.
    // Entries 3-5 have actual comment values and blank sub_note.
    async disbursed(app,run) {
      _logStep(run,'disbursed','Disbursement','processing','');
      if(!app.nach_done||!app.customer_agreement_done) {
        var miss=[];
        if(!app.nach_done) miss.push('NACH');
        if(!app.customer_agreement_done) miss.push('Customer Agreement');
        return {success:false,blocked:true,blockReason:'Cannot disburse — '+miss.join(' and ')+' not finalised'};
      }
      // Disbursement reference must come from a real, validated lender reply
      // (decisionType 'disbursed' with a genuine UTR/reference number) — the
      // lender-email-workflow already asks the RM for exactly this and
      // already parses it from real replies. Never fabricate a number here.
      var reply=app.lender_last_reply;
      var utr=reply&&reply.decisionType==='disbursed'?reply.disbursementUTR:null;
      if(!utr) {
        return {success:false,blocked:true,blockReason:'Cannot disburse — awaiting lender RM email confirmation with UTR / NEFT reference number. Akshiv will not fabricate a disbursement reference.'};
      }
      var loanNo=utr;
      app.loan_number=loanNo;
      _aiTrack(app,'EFIN-Disbursed','Admin',' ','Loan amt and tenor update',true);
      _aiTrack(app,'EFIN-Disbursed','Admin',' ',loanNo,true);
      _aiTrack(app,'EFIN-Disbursed','System Comments','OK to Process',' ');
      _aiTrack(app,'EFIN-Disbursed','System Comments','Disbursement Done',' ');
      _aiTrack(app,'EFIN-Disbursed','System Comments','Work Flow Completed \u2014 Akshiv',' ');
      if(typeof window.lewSendLenderEmail==='function')
        window.lewSendLenderEmail(app,'disbursed',{isManual:false,triggeredBy:AGENT_USER});
      return {success:true,comment:'Disbursed '+loanNo,nextStatus:'disbursed'};
    },
  };

  // ── FALLBACK ALLOCATION ───────────────────────────────────────────────────
  function _allocate(app,stage,reason,run) {
    var assignTo=(window.currentUser&&currentUser.name)||_cfg.fallbackUserName;
    _createTask(app,'Akshiv Blocked \u2014 '+stage+' (manual action needed)',reason,'high',assignTo);
    var shortReason=String(reason||'').replace(/\s*\([^)]*\)/g,'').trim();
    if(shortReason.length>80) shortReason=shortReason.substring(0,77)+'\u2026';
    _aiTrack(app,'EFIN-Akshiv \u2014 Blocked at '+stage,'System Comments',
      'Manual Review Required',shortReason);
    _logStep(run,stage,'Allocated to '+assignTo,'blocked',reason);
    if(typeof showToast==='function') showToast('\uD83E\uDD16 Agent blocked at '+stage+' \u2014 task for '+assignTo,'warn');
  }

  // ── MAIN RUN ─────────────────────────────────────────────────────────────
  async function runAgent(appId) {
    var app=window.APPLICATIONS&&APPLICATIONS.find(function(a){return a.id===appId;});
    if(!app) return;
    if(['rejected','hold','cancelled','ni','disbursed'].includes(app.status)) {
      if(typeof showToast==='function') showToast('Akshiv: cannot run on '+app.status,'warn'); return;
    }
    var run=_startRun(appId);
    _aiTrack(app,'EFIN-Akshiv \u2014 Run Started','System Comments',
      'Started: '+app.status,'Cross Verification Running');
    if(typeof showToast==='function') showToast('\uD83E\uDD16 Akshiv running for '+appId+'\u2026','info');

    var idx=PIPELINE.indexOf(app.status); if(idx<0) idx=0;
    while(idx<PIPELINE.length) {
      var stage=PIPELINE[idx], proc=STAGE_PROCESSORS[stage];
      if(!proc){idx++;continue;}
      var result;
      try{result=await proc(app,run);}
      catch(err){result={success:false,blocked:true,blockReason:'Error: '+(err.message||err)};}
      _save();
      if(result.success) {
        if(result.nextStatus&&result.nextStatus!==app.status) app.status=result.nextStatus;
        _save();
        if(typeof refreshDetailTimeline==='function'&&window.currentDetail&&currentDetail.id===appId) refreshDetailTimeline(appId);
        if(app.status==='disbursed') {
          _aiTrack(app,'EFIN-Akshiv \u2014 Pipeline Complete','System Comments','Fully processed','Loan: '+(app.loan_number||''));
          _finishRun(run,'completed'); _save();
          if(typeof showToast==='function') showToast('\uD83C\uDF89 '+appId+' disbursed by Akshiv!','success');
          if(typeof showCelebration==='function') setTimeout(function(){showCelebration({icon:'\uD83E\uDD16',title:'Akshiv: Disbursed!',amount:'\u20b9'+Number(app.amount).toLocaleString('en-IN'),amountColor:'#0047AB',appId,sub:app.name+'\u2019s application fully processed.',btnText:'View \u2192',btnColor:'#0047AB',btnShadow:'rgba(0,71,171,.4)',confetti:true,confettiCount:120});},400);
          break;
        }
        // ── Stop after the configured stage. Later stages (offer→disbursed) require
        //    a real human decision or a real lender-email reply — never auto-filled. ──
        if(stage===(_cfg.autoUpToStage||'login')) {
          var handTo=app.loginUser||app.sales||_cfg.fallbackUserName;
          _aiTrack(app,'EFIN-Akshiv \u2014 Handover','System Comments',
            'Completed up to '+stage+'. Manual action required.',
            'Assigned to '+handTo+' for next steps.');
          _createTask(app,'Manual Next Steps \u2014 '+app.id,
            'Akshiv completed checks up to '+stage+'. Proceed with Offer/Approval/Disbursement manually or via lender-email reply.',
            'high',handTo);
          _finishRun(run,'completed'); _save();
          if(typeof showToast==='function') showToast('\uD83E\uDD16 Akshiv done up to '+stage+' \u2014 handed to '+handTo,'info');
          break;
        }
        idx++;
      } else {
        _allocate(app,stage,result.blockReason||'Blocked',run);
        _finishRun(run,'blocked',result.blockReason); _save(); break;
      }
    }
    if(typeof refreshDetailTimeline==='function'&&window.currentDetail&&currentDetail.id===appId) refreshDetailTimeline(appId);
    if(typeof renderTasksPage==='function') renderTasksPage();
    return run;
  }

  // ── AUTO-MODE ON SUBMIT ───────────────────────────────────────────────────
  function _hookSubmit() {
    if(window._agentSubmitHooked) return;
    var _orig=window.submitWizard; if(!_orig) return;
    window._agentSubmitHooked=true;
    window.submitWizard=function(){
      _orig.apply(this,arguments);
      if(!_cfg.autoOnSubmit) return;
      setTimeout(function(){
        var newest=window.APPLICATIONS&&APPLICATIONS[0];
        if(!newest||newest.status!=='wip') return;
        _aiTrack(newest,'EFIN-Akshiv \u2014 Auto-Mode Triggered','System Comments',
          'Akshiv started automatically on submission','Wizard data captured');
        runAgent(newest.id);
      },1800);
    };
  }

  // ── SETTINGS ─────────────────────────────────────────────────────────────
  function _tog(id,label,desc,chk){
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#F9FAFB;border:1px solid #e5e7eb;border-radius:10px">'
      +'<div><div style="font-size:13px;font-weight:600;color:#1f2937">'+label+'</div><div style="font-size:11.5px;color:#6b7280;margin-top:1px">'+desc+'</div></div>'
      +'<label style="position:relative;display:inline-block;width:44px;height:24px;cursor:pointer;flex-shrink:0;margin-left:12px">'
      +'<input type="checkbox" id="'+id+'" '+(chk?'checked':'')+' style="opacity:0;width:0;height:0" '
      +'onchange="(function(el){var t=el.closest(\'label\').querySelector(\'span\'),k=t.querySelector(\'span\');t.style.background=el.checked?\'#0047AB\':\'#d1d5db\';k.style.left=el.checked?\'22px\':\'2px\';})(this)">'
      +'<span style="position:absolute;cursor:pointer;inset:0;background:'+(chk?'#0047AB':'#d1d5db')+';border-radius:24px;transition:.25s">'
      +'<span style="position:absolute;height:20px;width:20px;left:'+(chk?'22px':'2px')+';bottom:2px;background:#fff;border-radius:50%;transition:.25s;box-shadow:0 1px 3px rgba(0,0,0,.2)"></span>'
      +'</span></label></div>';
  }

  function openAgentSettings(){
    document.getElementById('agent-settings-modal')&&document.getElementById('agent-settings-modal').remove();
    var users=window.twUsers||[];
    var opts=users.map(function(u){return '<option value="'+u.uid+'" '+(u.uid===_cfg.fallbackUserId?'selected':'')+'>'+u.name+' ('+u.role+')</option>';}).join('');
    var m=document.createElement('div'); m.id='agent-settings-modal';
    m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    m.innerHTML='<div style="background:#fff;border-radius:18px;width:100%;max-width:540px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.3)">'
      +'<div style="background:linear-gradient(135deg,#0047AB,#002970);padding:22px 24px;display:flex;align-items:center;justify-content:space-between">'
      +'<div><div style="font-size:18px;font-weight:700;color:#fff">\uD83E\uDD16 Akshiv Settings</div>'
      +'<div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:2px">Wizard-integrated document verification &amp; pipeline automation</div></div>'
      +'<button onclick="document.getElementById(\'agent-settings-modal\').remove()" style="background:rgba(255,255,255,.15);border:none;color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:18px">\u2715</button></div>'
      +'<div style="padding:24px;display:flex;flex-direction:column;gap:14px">'
      +_tog('agent-enabled','Enable Akshiv','Activates manual Run and auto-mode on submit',_cfg.enabled)
      +_tog('agent-auto-submit','Auto-mode on submission','Agent starts 1.8s after application is created',_cfg.autoOnSubmit)
      +_tog('agent-doc-gate','Hard document gate','Blocks login stage if PAN, Aadhaar, bank stmt, or slips missing',_cfg.requireDocGate)
      +_tog('agent-claude-docs','Claude document analysis','Claude reads slip and bank statement for deep verification',_cfg.claudeDocReview)
      +'<div><label style="font-size:12px;font-weight:700;color:#374151;display:block;margin-bottom:6px">Fallback user <span style="color:#9ca3af;font-weight:400">(for CIBIL / manual decisions)</span></label>'
      +'<select id="agent-fallback-user" style="width:100%;padding:10px 14px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:14px;outline:none">'+opts+'</select></div>'
      +'<div style="background:#F0F8FF;border:1px solid rgba(0,71,171,.15);border-radius:10px;padding:12px 14px;font-size:12px;color:#0047AB">'
      +'\uD83D\uDD12 <strong>Task routing:</strong> missing docs &amp; salary issues \u2192 sales rep. CIBIL / manual decisions \u2192 logged-in user.</div>'
      +'<div style="display:flex;justify-content:flex-end;gap:10px">'
      +'<button onclick="document.getElementById(\'agent-settings-modal\').remove()" style="padding:10px 20px;border:1.5px solid #e5e7eb;border-radius:8px;background:#fff;cursor:pointer;font-size:13px;font-weight:600;color:#6b7280">Cancel</button>'
      +'<button onclick="window._agentSaveSettings()" style="padding:10px 24px;background:linear-gradient(135deg,#0047AB,#0062CC);border:none;border-radius:8px;color:#fff;cursor:pointer;font-size:13px;font-weight:700">Save</button>'
      +'</div></div></div>';
    document.body.appendChild(m);
  }

  window._agentSaveSettings=function(){
    var users=window.twUsers||[];
    var uid=document.getElementById('agent-fallback-user')&&document.getElementById('agent-fallback-user').value;
    var user=users.find(function(u){return u.uid===uid;});
    _cfg.enabled        =!!(document.getElementById('agent-enabled')&&document.getElementById('agent-enabled').checked);
    _cfg.autoOnSubmit   =!!(document.getElementById('agent-auto-submit')&&document.getElementById('agent-auto-submit').checked);
    _cfg.requireDocGate =!!(document.getElementById('agent-doc-gate')&&document.getElementById('agent-doc-gate').checked);
    _cfg.claudeDocReview=!!(document.getElementById('agent-claude-docs')&&document.getElementById('agent-claude-docs').checked);
    _cfg.fallbackUserId  =uid||_cfg.fallbackUserId;
    _cfg.fallbackUserName=user?user.name:_cfg.fallbackUserName;
    _saveCfg();
    document.getElementById('agent-settings-modal')&&document.getElementById('agent-settings-modal').remove();
    if(typeof showToast==='function') showToast('\uD83E\uDD16 Agent saved | Auto:'+(_cfg.autoOnSubmit?'ON':'OFF')+' | Doc gate:'+(_cfg.requireDocGate?'ON':'OFF'),'success');
  };

  // ── RUN MODAL ─────────────────────────────────────────────────────────────
  function openRunModal(appId){
    var app=window.APPLICATIONS&&APPLICATIONS.find(function(a){return a.id===appId;});
    if(!app) return;
    document.getElementById('agent-run-modal')&&document.getElementById('agent-run-modal').remove();
    var docs=_getAppDocs(app);
    var pse=(app.uploadedDocs||[]).filter(function(d){return d.storeKey&&d.storeKey.startsWith('docitem-pse-slip-');});
    var slipCnt=pse.length+docs.filter(function(d){return d.isPayslip;}).length;
    var docList=docs.length>0
      ?docs.slice(0,5).map(function(d){return '<span style="background:#E8F4FD;color:#0047AB;border-radius:6px;padding:2px 7px;font-size:11px;margin:2px 1px 0 0;display:inline-block">'+(d.docName||d.fileName)+'</span>';}).join('')
      :'<span style="color:#ef4444;font-size:12px">\u26a0 No documents uploaded</span>';
    var slipBadge=slipCnt>=3
      ?'<span style="background:#E8F5EE;color:#1a6b4a;border-radius:6px;padding:2px 8px;font-size:11px">\u2713 '+slipCnt+' salary slips</span>'
      :'<span style="background:#FFF3E8;color:#c05000;border-radius:6px;padding:2px 8px;font-size:11px">\u26a0 '+slipCnt+'/3 salary slips</span>';
    var hasPse=window.PSE&&window.PSE.analysisResult;
    var pseBadge=hasPse?'<span style="background:#E8F5EE;color:#1a6b4a;border-radius:6px;padding:2px 8px;font-size:11px">\u2713 PSE salary data available</span>':'';
    var startIdx=PIPELINE.indexOf(app.status); if(startIdx<0) startIdx=0;
    var stagesAhead=PIPELINE.slice(startIdx).map(function(s){return '<span style="background:#f3f4f6;color:#374151;border-radius:6px;padding:2px 8px;font-size:11px;margin:0 2px">'+s+'</span>';}).join(' \u2192 ');
    var m=document.createElement('div'); m.id='agent-run-modal';
    m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    m.innerHTML='<div style="background:#fff;border-radius:18px;width:100%;max-width:520px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.3)">'
      +'<div style="background:linear-gradient(135deg,#0047AB,#002970);padding:20px 24px;display:flex;align-items:center;justify-content:space-between">'
      +'<div><div style="font-size:17px;font-weight:700;color:#fff">\uD83E\uDD16 Run Akshiv</div>'
      +'<div style="font-size:12px;color:rgba(255,255,255,.6);margin-top:2px">'+appId+' \u00b7 '+app.name+' \u00b7 '+app.status+'</div></div>'
      +'<button onclick="document.getElementById(\'agent-run-modal\').remove()" style="background:rgba(255,255,255,.15);border:none;color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:18px">\u2715</button></div>'
      +'<div style="padding:22px;display:flex;flex-direction:column;gap:14px">'
      +'<div style="background:#F9FAFB;border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px">'
      +'<div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Documents ('+docs.length+')</div>'
      +'<div>'+docList+'</div><div style="margin-top:6px">'+slipBadge+' '+pseBadge+'</div></div>'
      +'<div style="background:#F9FAFB;border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px">'
      +'<div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Pipeline from current stage</div>'
      +'<div>'+stagesAhead+'</div></div>'
      +'<div style="background:#F0F8FF;border:1px solid rgba(0,71,171,.15);border-radius:10px;padding:12px 14px;font-size:12.5px;color:#0047AB">'
      +'\uD83D\uDD12 Each stage posts the exact tracking entries the manual buttons produce.</div>'
      +'<div style="display:flex;justify-content:flex-end;gap:10px">'
      +'<button onclick="document.getElementById(\'agent-run-modal\').remove()" style="padding:10px 20px;border:1.5px solid #e5e7eb;border-radius:8px;background:#fff;cursor:pointer;font-size:13px;font-weight:600;color:#6b7280">Cancel</button>'
      +'<button onclick="window._agentStartRun(\''+appId+'\')" id="agent-start-btn" style="padding:10px 24px;background:linear-gradient(135deg,#0047AB,#0062CC);border:none;border-radius:8px;color:#fff;cursor:pointer;font-size:13px;font-weight:700">\uD83E\uDD16 Start</button>'
      +'</div></div></div>';
    document.body.appendChild(m);
  }

  window._agentStartRun=async function(appId){
    var btn=document.getElementById('agent-start-btn');
    if(btn){btn.textContent='\u23f3 Processing\u2026';btn.disabled=true;btn.style.opacity='0.7';}
    document.getElementById('agent-run-modal')&&document.getElementById('agent-run-modal').remove();
    await runAgent(appId);
  };

  // ── HISTORY ───────────────────────────────────────────────────────────────
  function openHistory(appId){
    var runs=_runs[appId]||[];
    document.getElementById('agent-history-modal')&&document.getElementById('agent-history-modal').remove();
    var rows=runs.length===0?'<div style="text-align:center;padding:32px;color:#9ca3af">No runs yet</div>'
      :runs.map(function(r){
        var col=r.status==='completed'?'#1a6b4a':r.status==='blocked'?'#c05000':'#0047AB';
        var bg=r.status==='completed'?'#E8F5EE':r.status==='blocked'?'#FFF3E8':'#E8F4FD';
        var steps=(r.steps||[]).map(function(s){
          return '<div style="display:flex;gap:8px;padding:4px 0;border-bottom:1px solid #f3f4f6;font-size:12px">'
            +'<span style="color:#9ca3af;min-width:80px">'+new Date(s.ts).toLocaleTimeString('en-IN')+'</span>'
            +'<span style="font-weight:600;min-width:90px;color:#374151">'+s.stage+'</span>'
            +'<span style="color:#6b7280;flex:1">'+s.action+'</span>'
            +'<span style="font-weight:600;color:'+((['success','valid','done'].includes(s.result))?'#1a6b4a':(['allocated','blocked','failed'].includes(s.result))?'#c05000':'#0047AB')+'">'+(s.result)+'</span></div>';
        }).join('');
        return '<div style="border:1px solid #e5e7eb;border-radius:10px;margin-bottom:10px;overflow:hidden">'
          +'<div style="padding:10px 14px;background:#f9fafb;display:flex;align-items:center;justify-content:space-between;cursor:pointer" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\'none\'?\'block\':\'none\'">'
          +'<span style="font-size:12px;font-weight:700;color:#374151">'+r.runId+' <span style="color:#9ca3af;font-weight:400">'+new Date(r.startedAt).toLocaleString('en-IN')+'</span></span>'
          +'<span style="padding:2px 9px;border-radius:100px;font-size:11px;font-weight:700;background:'+bg+';color:'+col+'">'+r.status+'</span></div>'
          +'<div style="display:none;padding:10px 14px">'+(r.error?'<div style="background:#fff5f5;border:1px solid #fca5a5;border-radius:6px;padding:8px;font-size:12px;color:#dc2626;margin-bottom:8px">'+r.error+'</div>':'')
          +steps+'</div></div>';
      }).join('');
    var m=document.createElement('div'); m.id='agent-history-modal';
    m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
    m.innerHTML='<div style="background:#fff;border-radius:18px;width:100%;max-width:580px;max-height:86vh;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.3);display:flex;flex-direction:column">'
      +'<div style="background:linear-gradient(135deg,#0047AB,#002970);padding:20px 24px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">'
      +'<div style="font-size:16px;font-weight:700;color:#fff">\uD83E\uDD16 Run History \u00b7 '+appId+'</div>'
      +'<button onclick="document.getElementById(\'agent-history-modal\').remove()" style="background:rgba(255,255,255,.15);border:none;color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:18px">\u2715</button></div>'
      +'<div style="overflow-y:auto;padding:16px;flex:1">'+rows+'</div></div>';
    document.body.appendChild(m);
  }

  // ── INJECT AGENT BAR ──────────────────────────────────────────────────────
  function _injectBar(app){
    if(!app||['rejected','cancelled','ni','disbursed'].includes(app.status)) return;
    document.getElementById('agent-action-bar')&&document.getElementById('agent-action-bar').remove();
    var c=document.getElementById('tracking-section')||document.getElementById('tab-tracking-tab');
    if(!c) return;
    var lr=(_runs[app.id]||[])[0];
    var docs=_getAppDocs(app);
    var pse=(app.uploadedDocs||[]).filter(function(d){return d.storeKey&&d.storeKey.startsWith('docitem-pse-slip-');});
    var slipCnt=pse.length+docs.filter(function(d){return d.isPayslip;}).length;
    var rBadge=lr?'<span style="padding:2px 7px;border-radius:100px;font-size:10px;font-weight:700;background:rgba(255,255,255,.15);color:#fff">'+lr.status+'</span>':'';
    var dBadge=docs.length>0?'<span style="background:rgba(255,255,255,.15);color:#fff;border-radius:100px;padding:2px 7px;font-size:10px;font-weight:600">'+docs.length+' doc(s)</span>':'<span style="background:rgba(255,100,100,.3);color:#ffd0d0;border-radius:100px;padding:2px 7px;font-size:10px;font-weight:600">\u26a0 No docs</span>';
    var sBadge=(app.empType||'').toUpperCase()==='SALARIED'?(slipCnt>=3?'<span style="background:rgba(255,255,255,.15);color:#fff;border-radius:100px;padding:2px 7px;font-size:10px;font-weight:600">\u2713 '+slipCnt+' slips</span>':'<span style="background:rgba(255,200,100,.25);color:#ffe0a0;border-radius:100px;padding:2px 7px;font-size:10px;font-weight:600">\u26a0 '+slipCnt+'/3 slips</span>'):'';
    var eBadge=_cfg.enabled?'<span style="background:rgba(100,255,160,.25);color:#90ffb8;border-radius:100px;padding:2px 7px;font-size:10px;font-weight:700">\u25cf On</span>':'<span style="background:rgba(255,255,255,.1);color:rgba(255,255,255,.5);border-radius:100px;padding:2px 7px;font-size:10px;font-weight:600">\u25cb Off</span>';
    var bar=document.createElement('div'); bar.id='agent-action-bar';
    bar.style.cssText='display:flex;align-items:center;gap:6px;padding:6px 12px;margin-bottom:12px;background:#0047AB;border-radius:8px;overflow:hidden;white-space:nowrap';
    var sep='<span style="color:rgba(255,255,255,.25);font-size:11px;margin:0 2px">|</span>';
    bar.innerHTML='<span style="font-size:11px;font-weight:800;color:#fff;letter-spacing:.5px;flex-shrink:0">\uD83E\uDD16 Akshiv</span>'
      +sep+eBadge+rBadge+dBadge+sBadge
      +'<div style="display:flex;gap:5px;margin-left:auto;flex-shrink:0">'
      +'<button onclick="window.agentRun(\''+app.id+'\')" style="background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.3);border-radius:6px;padding:4px 11px;font-size:11.5px;font-weight:700;color:#fff;cursor:pointer;line-height:1.4">\u25b6 Run</button>'
      +'<button onclick="window.agentHistory(\''+app.id+'\')" style="background:transparent;border:1px solid rgba(255,255,255,.25);border-radius:6px;padding:4px 10px;font-size:11.5px;font-weight:600;color:rgba(255,255,255,.85);cursor:pointer;line-height:1.4">History</button>'
      +'<button onclick="window.agentSettings()" style="background:transparent;border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:4px 8px;font-size:11.5px;font-weight:600;color:rgba(255,255,255,.7);cursor:pointer;line-height:1.4">\u2699</button>'
      +'</div>';
    c.insertBefore(bar,c.firstChild);
  }

  function _hookRenderTracking(){
    if(window._agentTrackingHooked) return;
    var _orig=window.renderTrackingSection; if(!_orig) return;
    window._agentTrackingHooked=true;
    window.renderTrackingSection=function(app){
      try{_orig.call(this,app);}catch(e){console.warn('[agent] renderTrackingSection:',e);}
      setTimeout(function(){_injectBar(app);},60);
    };
  }

  // ── PUBLIC API ────────────────────────────────────────────────────────────
  window.agentRun      = openRunModal;
  window.agentSettings = openAgentSettings;
  window.agentHistory  = openHistory;
  window.runAgentDirect= runAgent;
  window.AGENT_CFG     = _cfg;

  onReady(function(){
    _loadCfg(); _loadRuns();
    _hookRenderTracking();
    _hookSubmit();
    if(!window.TASK_STORE) window.TASK_STORE=[];
    console.info('[Akshiv] Ready | Auto:',_cfg.autoOnSubmit,'| Doc gate:',_cfg.requireDocGate);
  });

})();
