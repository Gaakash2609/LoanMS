/* perfios-renderer.js — Perfios Report Renderer + postMessage listener
 * Load order: LAST of all — after perfios-bank-bridge.js, after reports-tabs.js
 * Exposes: window.renderPerfiosReport, window.pfv9ConfirmAttachment,
 *          window.pfrTab, window._perfiosBankDoc, window._pendingPerfiosData,
 *          window._lastPerfiosData, window._lastPerfiosReport
 * Depends on: window.pfv9Close, window.switchTab, window.switchReportsSubTab,
 *             window._docUpdateProgress, window.showToast, window._BFP_STORE
 * DOM IDs: perfios-report-empty, perfios-report-data,
 *          pfv9-footer, pfv9-footer-info, pfr-*, detail-docs
 */
/* ── PERFIOS REPORT LISTENER & RENDERER (inline) ── */
(function() {

  function fmt(n) {
    if (n === undefined || n === null || n === '') return '—';
    return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function makeTableRows(arr, cols) {
    if (!arr || !arr.length) return '<tr><td colspan="' + cols + '" style="text-align:center;padding:12px;color:var(--text3)">None detected</td></tr>';
    return arr.map(function(t) {
      return '<tr style="border-bottom:1px solid var(--border)">' +
        cols.map(function(c) {
          var val = t[c.key] !== undefined ? t[c.key] : '—';
          var style = 'padding:8px 10px;' + (c.right ? 'text-align:right;' : '') + (c.style || '');
          if (c.key === 'type') {
            var color = val === 'CR' ? 'color:#16a34a;font-weight:700' : 'color:#dc2626;font-weight:700';
            return '<td style="' + style + color + '">' + val + '</td>';
          }
          if (c.key === 'amount') val = '₹ ' + fmt(val);
          if (c.key === 'balance') val = '₹ ' + fmt(val);
          return '<td style="' + style + '">' + (val || '—') + '</td>';
        }).join('') +
      '</tr>';
    }).join('');
  }

  // ══ Keyword helper functions (mirrored from perfios/js/perfios.js) ══
  function _pfr_getSalaryKeyword(desc) {
    var SALARY_PATTERNS = [/\bSAL\b/i,/\bSALARY\b/i,/\bPAYROLL\b/i,/\bINCOME\b/i,/\bWAGES\b/i,/\bSTIPEND\b/i,/\bREMUNERATION\b/i,/\bMONTHLY\s*PAY\b/i,/\bPAY\s*CREDIT\b/i,/\bHR\s*SALARY\b/i];
    for (var i=0; i<SALARY_PATTERNS.length; i++) { var m = desc.match(SALARY_PATTERNS[i]); if (m) return m[0].toUpperCase(); }
    return 'SALARY';
  }
  function _pfr_getACHSubType(desc) {
    var P=[{re:/\bNACH\s*DR\b/i,s:'NACH Debit'},{re:/\bNACH\s*CR\b/i,s:'NACH Credit'},{re:/\bNACH\b/i,s:'NACH'},{re:/\bACH\s*DR\b/i,s:'ACH Debit'},{re:/\bACH\s*CR\b/i,s:'ACH Credit'},{re:/\bACH\b/i,s:'ACH Generic'},{re:/\bDIRECT\s*DEBIT\b/i,s:'Direct Debit'},{re:/\bDIRECT\s*CREDIT\b/i,s:'Direct Credit'},{re:/\bMANDATE\b/i,s:'ACH Mandate'},{re:/\bAUTO\s*PAY\b/i,s:'Auto Pay'},{re:/\bAUTO\s*DEBIT\b/i,s:'Auto Debit'},{re:/\bSTANDING\s*INST/i,s:'Standing Instruction'},{re:/\bSI\s*DEBIT\b/i,s:'SI Debit'},{re:/\bSWEEP\b/i,s:'Sweep'},{re:/\bRECURRING\b/i,s:'Recurring Debit'}];
    for (var i=0;i<P.length;i++){if(P[i].re.test(desc))return P[i].s;} return 'ACH';
  }
  function _pfr_getACHKw(desc){var P=[/\bNACH\b/i,/\bACH\b/i,/\bMANDATE\b/i,/\bAUTO\s*PAY\b/i,/\bDIRECT\s*DEBIT\b/i,/\bSTANDING\s*INST/i];for(var i=0;i<P.length;i++){var m=desc.match(P[i]);if(m)return m[0].toUpperCase();}return '';}
  function _pfr_getECSSubType(desc){var P=[{re:/\bECS\s*RETURN\b|\bECS\s*BOUNCE\b/i,s:'ECS Return/Bounce'},{re:/\bECS\s*REJ/i,s:'ECS Rejected'},{re:/\bECS\s*DR\b|\bECS\s*DEBIT\b/i,s:'ECS Debit'},{re:/\bECS\s*CR\b|\bECS\s*CREDIT\b/i,s:'ECS Credit'},{re:/\bECS\s*EMI\b/i,s:'ECS EMI'},{re:/\bECS\s*MANDATE\b/i,s:'ECS Mandate'},{re:/\bECS\b/i,s:'ECS Generic'}];for(var i=0;i<P.length;i++){if(P[i].re.test(desc))return P[i].s;}return 'ECS';}
  function _pfr_getECSKw(desc){var m=desc.match(/\bECS\b/i);return m?m[0].toUpperCase():'';}
  function _pfr_getNEFTSubType(desc){var P=[{re:/RTGS[\s\-\/]*RETURN/i,s:'RTGS Return'},{re:/RTGS[\s\-\/]*REJECT/i,s:'RTGS Rejected'},{re:/RTGS[\s\-\/]*INWARD/i,s:'RTGS Inward'},{re:/RTGS[\s\-\/]*OUTWARD/i,s:'RTGS Outward'},{re:/RTGS[\s\-\/]*CR/i,s:'RTGS Credit'},{re:/RTGS[\s\-\/]*DR/i,s:'RTGS Debit'},{re:/\bRTGS\b/i,s:'RTGS Generic'},{re:/NEFT[\s\-\/]*RETURN/i,s:'NEFT Return'},{re:/NEFT[\s\-\/]*REJECT/i,s:'NEFT Rejected'},{re:/NEFT[\s\-\/]*INWARD/i,s:'NEFT Inward'},{re:/NEFT[\s\-\/]*OUTWARD/i,s:'NEFT Outward'},{re:/NEFT[\s\-\/]*CR/i,s:'NEFT Credit'},{re:/NEFT[\s\-\/]*DR/i,s:'NEFT Debit'},{re:/\bNEFT\b/i,s:'NEFT Generic'},{re:/INTERBANK/i,s:'Interbank Transfer'}];for(var i=0;i<P.length;i++){if(P[i].re.test(desc))return P[i].s;}return 'NEFT/RTGS';}
  function _pfr_getNEFTKw(desc){var m=desc.match(/\b(NEFT|RTGS)\b/i);return m?m[0].toUpperCase():'';}
  function _pfr_getUPISubType(desc){var P=[{re:/\bPHONEPE\b/i,s:'PhonePe (UPI)'},{re:/\bGPAY\b|\bGOOGLE\s*PAY\b/i,s:'Google Pay (UPI)'},{re:/\bPAYTM\b/i,s:'Paytm (UPI)'},{re:/\bBHIM\b/i,s:'BHIM UPI'},{re:/\bAMAZON\s*PAY\b/i,s:'Amazon Pay (UPI)'},{re:/\bIMPS[\s\/\-]*CR\b/i,s:'IMPS Credit'},{re:/\bIMPS[\s\/\-]*DR\b/i,s:'IMPS Debit'},{re:/\bIMPS\b/i,s:'IMPS Generic'},{re:/\bUPI[\s\/\-]*CR\b/i,s:'UPI Credit'},{re:/\bUPI[\s\/\-]*DR\b/i,s:'UPI Debit'},{re:/\bUPI[\s\/\-]*REFUND\b/i,s:'UPI Refund'},{re:/\bUPI[\s\/\-]*REVERSAL\b/i,s:'UPI Reversal'},{re:/\bP2P\b/i,s:'UPI P2P'},{re:/\bP2M\b/i,s:'UPI P2M'},{re:/\bUPI\b/i,s:'UPI Generic'}];for(var i=0;i<P.length;i++){if(P[i].re.test(desc))return P[i].s;}return 'UPI/IMPS';}
  function _pfr_getUPIKw(desc){var m=desc.match(/\b(UPI|IMPS|BHIM|GPAY|PAYTM|PHONPE|P2P|P2M)\b/i);return m?m[0].toUpperCase():'';}
  function _pfr_getChequeSubType(desc){var P=[{re:/\bCHQ\s*RETURN\b|\bCHEQUE\s*RETURN\b/i,s:'Cheque Return (Bounce)'},{re:/\bCHQ\s*BOUNCE\b|\bCHEQUE\s*BOUNCE\b/i,s:'Cheque Bounce'},{re:/\bCHQ\s*DISHON/i,s:'Cheque Dishonoured'},{re:/\bCTS\b/i,s:'CTS Clearing'},{re:/\bINWARD\s*CLG\b/i,s:'Inward Clearing'},{re:/\bOUTWARD\s*CLG\b/i,s:'Outward Clearing'},{re:/\bDEMAND\s*DRAFT\b|\bDD\b/i,s:'Demand Draft'},{re:/\bPDC\b/i,s:'Post-Dated Cheque'},{re:/\bCHQ\b|\bCHEQUE\b/i,s:'Cheque Generic'}];for(var i=0;i<P.length;i++){if(P[i].re.test(desc))return P[i].s;}return 'Cheque';}
  function _pfr_getBounceSubType(desc){var P=[{re:/\bTECHNICAL\s*RETURN\b/i,s:'Inward Bounce (Technical)'},{re:/\bINWARD\s*RETURN\b|\bINWARD\s*BOUNCE\b/i,s:'Inward Bounce'},{re:/\bOUTWARD\s*RETURN\b|\bOUTWARD\s*BOUNCE\b/i,s:'Outward Bounce'},{re:/\bECS\s*RETURN\b|\bNACH\s*RETURN\b|\bACH\s*RETURN\b/i,s:'ECS/ACH Return'},{re:/\bNEFT\s*RETURN\b|\bRTGS\s*RETURN\b/i,s:'NEFT/RTGS Return'},{re:/\bCHQ\s*RETURN\b|\bCHEQUE\s*RETURN\b/i,s:'Cheque Return'},{re:/\bDISHONOURED\b/i,s:'Dishonoured'},{re:/\bREJECTED?\b/i,s:'Rejected'},{re:/\bBOUNCE\b/i,s:'Bounce'}];for(var i=0;i<P.length;i++){if(P[i].re.test(desc))return P[i].s;}return 'Return';}
  function _pfr_isBounceInward(desc){var P=[{re:/\bTECHNICAL\s*RETURN\b/i,v:true},{re:/\bINWARD\s*(RETURN|BOUNCE)\b/i,v:true},{re:/\bOUTWARD\s*(RETURN|BOUNCE)\b/i,v:false}];for(var i=0;i<P.length;i++){if(P[i].re.test(desc))return P[i].v;}return null;}

  function renderPerfiosReport(data) {
    if (!data) return;

    var salary    = data.salary   || [];
    var ach       = data.ach      || data.achTxns   || [];
    var ecs       = data.ecs      || data.ecsTxns   || [];
    var neft      = data.neft     || data.neftTxns  || [];
    var upi       = data.upi      || data.upiTxns   || [];
    var cheque    = data.cheque   || data.chequeTxns|| [];
    var bounces   = data.bounces  || data.bounceTxns|| [];
    var overdrafts= data.overdraftEvents || [];
    var txns90    = data.txns90   || data.transactions || [];
    var targetArr = data.targetRows || [];
    var abbData   = data.abbData   || {};
    var monthOrder= data.monthOrder|| [];
    var validChecks = data.validChecks || [];
    var accountInfo = data.accountInfo || {};
    var perFileData = data.perFileData || [];
    var processLog  = data.processLog  || [];

    function fmt(n) { if (n===null||n===undefined||n==='') return '—'; return Number(n).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}); }
    function fmtDate(d) {
      if (!d) return '—';
      if (typeof d === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(d)) return d;
      var dd = new Date(d);
      if (isNaN(dd.getTime())) return String(d);
      return String(dd.getDate()).padStart(2,'0')+'/'+String(dd.getMonth()+1).padStart(2,'0')+'/'+dd.getFullYear();
    }
    function fmtMo(d) { try { return new Date(d).toLocaleString('en-IN',{month:'short',year:'2-digit'}); } catch(e){return '';} }
    function th(label) { return '<th style="padding:7px 10px;text-align:left;background:var(--surface2);font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:var(--text3)">'+label+'</th>'; }
    function td(val,right,color) { return '<td style="padding:7px 10px;border-bottom:1px solid var(--border);'+(right?'text-align:right;font-family:monospace;':'')+(color?'color:'+color+';font-weight:700;':'')+'">'+(val||val===0?val:'—')+'</td>'; }
    function crdr(t) { return t==='CR'?'<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;background:rgba(22,163,74,.1);color:#16a34a;border:1px solid rgba(22,163,74,.2)">CR</span>':'<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;background:rgba(220,38,38,.08);color:#dc2626;border:1px solid rgba(220,38,38,.2)">DR</span>'; }
    function tag(text,color) { return '<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;background:'+color+'22;color:'+color+';border:1px solid '+color+'33;white-space:nowrap">'+text+'</span>'; }
    function summCard(label,val,color) { return '<div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 14px"><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px">'+label+'</div><div style="font-size:15px;font-weight:700;color:'+(color||'var(--text)')+'">'+val+'</div></div>'; }
    function noRows(cols,msg) { return '<tr><td colspan="'+cols+'" style="padding:24px;text-align:center;color:var(--text3)">'+msg+'</td></tr>'; }
    function panelWrap(title,content) { return '<div class="card" style="margin-bottom:0"><div class="card-head"><div class="card-title">'+title+'</div></div>'+content+'</div>'; }
    function tblWrap(html) { return '<div style="overflow-x:auto">'+html+'</div>'; }
    function summGrid(items) { return '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-bottom:14px">'+items+'</div>'; }

    // Show data section
    var empty = document.getElementById('perfios-report-empty');
    var dataEl = document.getElementById('perfios-report-data');
    if (empty) empty.style.display = 'none';
    if (dataEl) dataEl.style.display = 'block';

    // ── Account Source Info Bar ──
    var srcBar = document.getElementById('pfr-source-bar');
    if (!srcBar && dataEl) {
      srcBar = document.createElement('div');
      srcBar.id = 'pfr-source-bar';
      srcBar.style.cssText = 'display:flex;align-items:center;gap:10px;padding:9px 14px;margin-bottom:14px;background:linear-gradient(135deg,#eff6ff,#e8f2ff);border:1px solid #bfdbfe;border-radius:10px;flex-wrap:wrap;';
      dataEl.insertAdjacentElement('afterbegin', srcBar);
    }
    if (srcBar) {
      var acInfo = accountInfo || {};
      var fetchedAt = new Date().toLocaleDateString('en-IN')+' '+new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
      srcBar.innerHTML =
        '<div style="width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,#1d4ed8,#1a4fa3);display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0">🏦</div>'+
        '<div style="flex:1;min-width:0">'+
          '<div style="font-size:12px;font-weight:700;color:#1e3a8a">'+(acInfo.bank||'Bank Statement')+(acInfo.accountNo?' · A/C: '+acInfo.accountNo:'')+(acInfo.name?' · '+acInfo.name:'')+'</div>'+
          '<div style="font-size:11px;color:#3b82f6;margin-top:1px">Perfios analysis · '+(data.firstDate&&data.lastDate?data.firstDate+' → '+data.lastDate+' · ':'')+' Fetched: '+fetchedAt+'</div>'+
        '</div>'+
        (data.valid===true
          ? '<span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:20px;background:linear-gradient(135deg,#059669,#10b981);color:#fff;letter-spacing:.5px;flex-shrink:0">✓ VERIFIED</span>'
          : '<span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:20px;background:linear-gradient(135deg,#dc2626,#ef4444);color:#fff;letter-spacing:.5px;flex-shrink:0">✗ VALIDATION FAILED</span>');
    }

    // ── Summary Cards ──
    var cards = document.getElementById('pfr-summary-cards');
    if (cards) {
      cards.innerHTML =
        summCard('First Transaction', data.firstDate||'—') +
        summCard('Last Transaction', data.lastDate||'—') +
        summCard('Span', (data.span||0)+' days', (data.span||0)>=90?'#16a34a':'#dc2626') +
        summCard('Staleness', (data.staledays||0)+' day(s)', (data.staledays||0)<=7?'#16a34a':'#dc2626') +
        summCard('Transactions', txns90.length, 'var(--accent)') +
        summCard('ABB', '₹ '+fmt(data.abb||0), '#16a34a') +
        summCard('Salary Txns', salary.length, salary.length>0?'#16a34a':'#dc2626') +
        summCard('ACH/NACH', ach.length) +
        summCard('ECS', ecs.length) +
        summCard('NEFT/RTGS', neft.length) +
        summCard('UPI/IMPS', upi.length, 'var(--accent)') +
        summCard('Cheque/CTS', cheque.length) +
        summCard('Bounces', bounces.length, bounces.length>0?'#dc2626':'#16a34a');
    }

    // ── 📋 Transactions ──
    var tc = document.getElementById('pfr-txn-count');
    var tb = document.getElementById('pfr-txn-body');
    if (tc) tc.textContent = txns90.length+' rows';
    if (tb) {
      tb.innerHTML = txns90.length ? txns90.map(function(t,i){
        return '<tr style="background:'+(t.type==='CR'?'rgba(22,163,74,0.02)':'rgba(220,38,38,0.02)')+'">'
          +td(i+1)
          +td(fmtDate(t.date))
          +'<td style="padding:7px 10px;border-bottom:1px solid var(--border);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="'+(t.desc||'')+'">'+((t.desc||t.narration)||'—')+'</td>'
          +'<td style="padding:7px 10px;border-bottom:1px solid var(--border)">'+crdr(t.type)+'</td>'
          +td('₹ '+fmt(t.amount),true,t.type==='CR'?'#16a34a':'#dc2626')
          +td('₹ '+fmt(t.balance),true)
          +td(t.category||t.subType||'—')
          +'</tr>';
      }).join('') : noRows(7,'No transactions in the last 90 days');
    }

    // ── 🏦 ABB / Perfios ──
    var abbH = document.getElementById('pfr-abb-head');
    var abbB = document.getElementById('pfr-abb-body');
    if (abbH && abbB && monthOrder.length) {
      abbH.innerHTML = '<tr>'+th('Date ↓ / Month →')+monthOrder.map(function(mk){return th(abbData[mk].label);}).join('')+'</tr>';
      var TARGET_DAYS=[2,4,10,17,25]; var rows='';
      TARGET_DAYS.forEach(function(day){
        rows+='<tr>'+td(day);
        monthOrder.forEach(function(mk){rows+=td(abbData[mk].dates[day]!==undefined?'₹ '+fmt(abbData[mk].dates[day]):'-',true);});
        rows+='</tr>';
      });
      var abbVal=0;
      if(monthOrder.length){
        var avgs=monthOrder.map(function(mk){var v=Object.values(abbData[mk].dates);return v.length?v.reduce(function(a,b){return a+b;},0)/v.length:0;});
        abbVal=avgs.reduce(function(a,b){return a+b;},0)/Math.max(1,avgs.length);
      }
      rows+='<tr style="background:var(--accent);color:#fff;font-weight:700"><td style="padding:12px 14px;line-height:1.5;white-space:nowrap;vertical-align:middle;font-size:13px" colspan="'+(monthOrder.length+1)+'">🏦 Average Bank Balance (ABB): ₹ '+fmt(abbVal)+'</td></tr>';
      abbB.innerHTML=rows;

      // ── Period-wise ABB summary cards (3/6/9/12 months) ──
      // Reuses the SAME avgs array computed just above — no new calculation
      // logic, only a trailing-window slice + average of the existing
      // per-month values. The table rows and abbVal (overall ABB) above are
      // completely unchanged. Periods with no available data are omitted
      // rather than shown as zero (per "show only available periods").
      var abbSumEl = document.getElementById('pfr-abb-summary');
      if (!abbSumEl) {
        var abbPanel = document.getElementById('pfr-panel-abb');
        if (abbPanel) {
          abbSumEl = document.createElement('div'); abbSumEl.id = 'pfr-abb-summary';
          var abbFirstCard = abbPanel.querySelector('.card');
          if (abbFirstCard) abbPanel.insertBefore(abbSumEl, abbFirstCard);
        }
      }
      if (abbSumEl) {
        var periodDefs = [[3,'3 Months ABB'],[6,'6 Months ABB'],[9,'9 Months ABB'],[12,'12 Months ABB']];
        var periodCards = periodDefs.map(function(p){
          var n = p[0];
          var recentAvgs = avgs.slice(-n);
          if (!recentAvgs.length) return '';
          var periodVal = recentAvgs.reduce(function(a,b){return a+b;},0) / recentAvgs.length;
          return summCard(p[1], '₹ ' + fmt(periodVal));
        }).join('');
        abbSumEl.innerHTML = periodCards ? summGrid(periodCards) : '';
      }
    } else if (abbH && abbB) {
      abbH.innerHTML=''; abbB.innerHTML=noRows(2,'No ABB data available');
      var abbSumElEmpty = document.getElementById('pfr-abb-summary');
      if (abbSumElEmpty) abbSumElEmpty.innerHTML = '';
    }

    // ── 🎯 Target Dates ──
    var tgc=document.getElementById('pfr-target-count'); var tgb=document.getElementById('pfr-target-body');
    if(tgc)tgc.textContent=targetArr.length+' rows';
    if(tgb)tgb.innerHTML=targetArr.length?targetArr.map(function(r){
      return '<tr>'+td(fmtDate(r.targetDate))+td(fmtDate(r.actualDate))+td(r.fallback?'Carry-fwd':'Exact')+td(r.txn?(r.txn.desc||''):'Opening Balance')+'<td style="padding:7px 10px;border-bottom:1px solid var(--border)">'+(r.txn?crdr(r.txn.type):'—')+'</td>'+td(r.txn?'₹ '+fmt(r.txn.amount):'—',true)+td('₹ '+fmt(r.eodBalance),true)+'</tr>';
    }).join(''):noRows(7,'No target date rows');

    // ── 💰 Salary ──
    var salCrTxns=salary.filter(function(t){return t.type==='CR';});
    var salTotal=salCrTxns.reduce(function(s,t){return s+t.amount;},0);
    var salAvg=salCrTxns.length?salTotal/salCrTxns.length:0;
    var salMonths=new Set(salary.map(function(t){try{var d=new Date(t.date);return d.getMonth()+'-'+d.getFullYear();}catch(e){return t.date;}})).size;
    var sc=document.getElementById('pfr-salary-count'); var sb=document.getElementById('pfr-salary-body');
    if(sc)sc.textContent=salary.length+' txns';
    var salSumEl=document.getElementById('pfr-salary-summary');
    if(!salSumEl){
      var salPanel=document.getElementById('pfr-panel-salary');
      if(salPanel){
        salSumEl=document.createElement('div'); salSumEl.id='pfr-salary-summary';
        var firstChild=salPanel.querySelector('.card');
        if(firstChild)salPanel.insertBefore(salSumEl,firstChild);
      }
    }
    if(salSumEl){
      salSumEl.innerHTML=summGrid(
        summCard('Salary Present',salary.length>0?'✓ YES':'✗ NOT FOUND',salary.length>0?'#16a34a':'#dc2626')+
        summCard('Txns Found',salary.length,'#16a34a')+
        summCard('Total Credited','₹ '+fmt(salTotal),'#16a34a')+
        summCard('Avg / Month','₹ '+fmt(salAvg))+
        summCard('Months w/ Salary',salMonths,'#16a34a')
      );
    }
    if(sb)sb.innerHTML=salary.length?salary.map(function(t,i){
      var kw=_pfr_getSalaryKeyword(t.desc||t.narration||'');
      return '<tr style="background:rgba(34,197,94,0.03)">'
        +td(i+1)+td(fmtDate(t.date))
        +'<td style="padding:7px 10px;border-bottom:1px solid var(--border);max-width:280px;overflow:hidden;text-overflow:ellipsis" title="'+(t.desc||'')+'">'+((t.desc||t.narration)||'—')+'</td>'
        +'<td style="padding:7px 10px;border-bottom:1px solid var(--border)">'+crdr(t.type)+'</td>'
        +td('₹ '+fmt(t.amount),true,'#16a34a')
        +td('₹ '+fmt(t.balance),true)
        +'<td style="padding:7px 10px;border-bottom:1px solid var(--border)">'+tag(kw,'#16a34a')+'</td>'
        +td(fmtMo(t.date))
        +'</tr>';
    }).join(''):noRows(8,'No salary transactions detected.');

    // helper to render ACH/ECS/NEFT/UPI/Cheque panels with summary
    function renderPaymentSection(txns,panelId,summaryId,countId,tbodyId,config){
      var crT=txns.filter(function(t){return t.type==='CR';}), drT=txns.filter(function(t){return t.type==='DR';});
      var totalCr=crT.reduce(function(s,t){return s+t.amount;},0), totalDr=drT.reduce(function(s,t){return s+t.amount;},0);
      var months=new Set(txns.map(function(t){try{var d=new Date(t.date);return d.getMonth()+'-'+d.getFullYear();}catch(e){return t.date;}})).size;
      var el=document.getElementById(countId); if(el)el.textContent=txns.length+' txns';
      // summary
      var sumEl=document.getElementById(summaryId);
      if(!sumEl){
        var panel=document.getElementById(panelId);
        if(panel){sumEl=document.createElement('div');sumEl.id=summaryId;var fc=panel.querySelector('.card');if(fc)panel.insertBefore(sumEl,fc);}
      }
      if(sumEl){
        sumEl.innerHTML=summGrid(
          summCard(config.label+' Present',txns.length>0?'✓ YES':'✗ NONE',txns.length>0?config.color:'var(--text3)')+
          summCard('Total Txns',txns.length,config.color)+
          summCard('Credits ('+crT.length+')','₹ '+fmt(totalCr),'#16a34a')+
          summCard('Debits ('+drT.length+')','₹ '+fmt(totalDr),'#dc2626')+
          summCard('Months w/ '+config.label,months,'#f59e0b')
          +(config.extra?config.extra(txns):'')
        );
      }
      // rows
      var tbody=document.getElementById(tbodyId);
      if(tbody){
        tbody.innerHTML=txns.length?txns.map(function(t,i){
          var sub=config.getSubType(t.rawDesc||t.desc||t.narration||'');
          var kw=config.getKw(t.rawDesc||t.desc||t.narration||'');
          var isBad=config.isBad&&config.isBad(sub);
          return '<tr style="background:'+(isBad?'rgba(239,68,68,0.04)':(t.type==='CR'?'rgba(22,163,74,0.02)':'rgba(59,130,246,0.02)'))+'">'+
            td(i+1)+td(fmtDate(t.date))+
            '<td style="padding:7px 10px;border-bottom:1px solid var(--border);max-width:280px;overflow:hidden;text-overflow:ellipsis" title="'+(t.desc||t.narration||'')+'">'+((t.desc||t.narration)||'—')+'</td>'+
            '<td style="padding:7px 10px;border-bottom:1px solid var(--border)">'+crdr(t.type)+'</td>'+
            td('₹ '+fmt(t.amount),true,t.type==='CR'?'#16a34a':'#dc2626')+
            td('₹ '+fmt(t.balance),true)+
            '<td style="padding:7px 10px;border-bottom:1px solid var(--border)">'+tag(sub,isBad?'#dc2626':config.color)+'</td>'+
            td(kw)+
            td(fmtMo(t.date))+
            '</tr>';
        }).join(''):noRows(9,config.emptyMsg);
      }
    }

    renderPaymentSection(ach,'pfr-panel-ach','pfr-ach-summary','pfr-ach-count','pfr-ach-body',{
      label:'ACH/NACH',color:'#a855f7',
      getSubType:_pfr_getACHSubType,getKw:_pfr_getACHKw,
      isBad:function(s){return /return|bounce|reject/i.test(s);},
      emptyMsg:'No ACH / NACH transactions detected.'
    });
    renderPaymentSection(ecs,'pfr-panel-ecs','pfr-ecs-summary','pfr-ecs-count','pfr-ecs-body',{
      label:'ECS',color:'#14b8a6',
      getSubType:_pfr_getECSSubType,getKw:_pfr_getECSKw,
      isBad:function(s){return /return|bounce|reject/i.test(s);},
      emptyMsg:'No ECS transactions detected.'
    });
    renderPaymentSection(neft,'pfr-panel-neft','pfr-neft-summary','pfr-neft-count','pfr-neft-body',{
      label:'NEFT/RTGS',color:'#f59e0b',
      getSubType:_pfr_getNEFTSubType,getKw:_pfr_getNEFTKw,
      isBad:function(s){return /return|reject/i.test(s);},
      extra:function(txns){
        var neftC=txns.filter(function(t){return /\bNEFT\b/i.test(t.rawDesc||t.desc||'');}).length;
        var rtgsC=txns.filter(function(t){return /\bRTGS\b/i.test(t.rawDesc||t.desc||'');}).length;
        return summCard('NEFT Txns',neftC,'#f59e0b')+summCard('RTGS Txns',rtgsC,'#f97316');
      },
      emptyMsg:'No NEFT / RTGS transactions detected.'
    });
    renderPaymentSection(upi,'pfr-panel-upi','pfr-upi-summary','pfr-upi-count','pfr-upi-body',{
      label:'UPI/IMPS',color:'#6366f1',
      getSubType:_pfr_getUPISubType,getKw:_pfr_getUPIKw,
      isBad:function(s){return /return|reversal/i.test(s);},
      extra:function(txns){
        var impsC=txns.filter(function(t){return /\bIMPS\b/i.test(t.rawDesc||t.desc||'');}).length;
        return summCard('IMPS Txns',impsC,'#ec4899');
      },
      emptyMsg:'No UPI or IMPS transactions detected.'
    });
    renderPaymentSection(cheque,'pfr-panel-cheque','pfr-cheque-summary','pfr-cheque-count','pfr-cheque-body',{
      label:'Cheque/CTS',color:'#eab308',
      getSubType:_pfr_getChequeSubType,getKw:function(d){var m=d.match(/\b(CHQ|CHEQUE|CTS|PDC|DD)\b/i);return m?m[0].toUpperCase():'';},
      isBad:function(s){return /return|bounce|dishon/i.test(s);},
      emptyMsg:'No Cheque / CTS transactions detected.'
    });

    // ── ⚠️ Bounces ──
    var bnc=document.getElementById('pfr-bounce-count'); var bnb=document.getElementById('pfr-bounce-body');
    if(bnc)bnc.textContent=bounces.length+' events';
    var bouncePanel=document.getElementById('pfr-panel-bounce');
    var bnSumEl=document.getElementById('pfr-bounce-summary');
    if(!bnSumEl&&bouncePanel){bnSumEl=document.createElement('div');bnSumEl.id='pfr-bounce-summary';var bnCard=bouncePanel.querySelector('.card');if(bnCard)bouncePanel.insertBefore(bnSumEl,bnCard);}
    if(bnSumEl){
      var inwardNT=bounces.filter(function(t){var s=_pfr_getBounceSubType(t.rawDesc||t.desc||'');return _pfr_isBounceInward(t.rawDesc||t.desc||'')===true&&!/technical/i.test(s);}).length;
      var inwardT=bounces.filter(function(t){return /technical/i.test(_pfr_getBounceSubType(t.rawDesc||t.desc||''));}).length;
      var outward=bounces.filter(function(t){return _pfr_isBounceInward(t.rawDesc||t.desc||'')===false;}).length;
      bnSumEl.innerHTML=summGrid(
        summCard('Total Bounces',bounces.length,bounces.length>0?'#dc2626':'#16a34a')+
        summCard('Inward (Non-Tech)',inwardNT,'#f59e0b')+
        summCard('Inward (Technical)',inwardT,'#f59e0b')+
        summCard('Outward',outward,'#dc2626')+
        summCard('Overdrafts',overdrafts.length,overdrafts.length>0?'#dc2626':'#16a34a')
      );
    }
    if(bnb){
      bnb.innerHTML=bounces.length?bounces.map(function(t,i){
        var sub=_pfr_getBounceSubType(t.rawDesc||t.desc||t.narration||'');
        return '<tr style="background:rgba(239,68,68,0.04)">'
          +td(i+1)+td(fmtDate(t.date))
          +'<td style="padding:7px 10px;border-bottom:1px solid var(--border);max-width:280px;overflow:hidden;text-overflow:ellipsis">'+((t.desc||t.narration)||'—')+'</td>'
          +'<td style="padding:7px 10px;border-bottom:1px solid var(--border)">'+crdr(t.type)+'</td>'
          +td('₹ '+fmt(t.amount),true,'#dc2626')
          +td('₹ '+fmt(t.balance),true)
          +'<td style="padding:7px 10px;border-bottom:1px solid var(--border)">'+tag(sub,'#dc2626')+'</td>'
          +td(fmtMo(t.date))
          +'</tr>';
      }).join(''):'<tr><td colspan="8" style="padding:24px;text-align:center;color:#16a34a;font-weight:600">✅ No bounce or return transactions detected.</td></tr>';
    }

    // ── 📊 FinOne ──
    var foh=document.getElementById('pfr-finone-head'); var fob=document.getElementById('pfr-finone-body');
    if(foh&&fob&&monthOrder.length){
      var fo_fields=['creditAmt','debitAmt','creditNos','debitNos','minBal','maxBal','avgBal'];
      var fo_labels=['Total Credits (₹)','Total Debits (₹)','Credit Count','Debit Count','Min Balance (₹)','Max Balance (₹)','Avg Balance (₹)'];
      foh.innerHTML='<tr>'+th('Metric')+monthOrder.map(function(mk){return th(abbData[mk].label);}).join('')+th('TOTAL')+'</tr>';
      var fo_rows='';
      fo_labels.forEach(function(lbl,li){
        fo_rows+='<tr>'+td(lbl);
        var total=0;
        monthOrder.forEach(function(mk){var v=abbData[mk][fo_fields[li]]||0;total+=v;fo_rows+=td('₹ '+fmt(v),true);});
        fo_rows+=td('₹ '+fmt(total),true,'var(--accent)')+'</tr>';
      });
      fob.innerHTML=fo_rows;
    }

    // ── 📈 Analysis ──
    var anh=document.getElementById('pfr-analysis-head'); var anb=document.getElementById('pfr-analysis-body');
    if(anh&&anb&&monthOrder.length){
      anh.innerHTML='<tr>'+th('Metric')+monthOrder.map(function(mk){return th(abbData[mk].label);}).join('')+'</tr>';
      var an_rows=[
        ['Credits (₹)',function(mk){return '₹ '+fmt(abbData[mk].credits||abbData[mk].creditAmt||0);}],
        ['Credit Count',function(mk){return abbData[mk].creditCount||abbData[mk].creditNos||0;}],
        ['Debits (₹)',function(mk){return '₹ '+fmt(abbData[mk].debitTotal||abbData[mk].debitAmt||0);}],
        ['Debit Count',function(mk){return abbData[mk].debitCount||abbData[mk].debitNos||0;}],
        ['Min Balance (₹)',function(mk){return '₹ '+fmt(abbData[mk].minBal||0);}],
        ['Max Balance (₹)',function(mk){return '₹ '+fmt(abbData[mk].maxBal||0);}],
        ['Avg Balance (₹)',function(mk){return '₹ '+fmt(abbData[mk].avgBal||0);}],
      ];
      anb.innerHTML=an_rows.map(function(row){
        return '<tr>'+td(row[0])+monthOrder.map(function(mk){return td(row[1](mk),true);}).join('')+'</tr>';
      }).join('');
    }

    // ── 🔍 Breakup ──
    var cats={};
    txns90.forEach(function(t){
      var c=t.category||'Other'; var isInc=t.type==='CR';
      var mo;try{var dObj=new Date(t.date);mo=dObj.getFullYear()+'-'+String(dObj.getMonth()+1).padStart(2,'0');}catch(e){mo=typeof t.date==='string'?t.date.slice(0,7):'?';}
      if(!cats[c])cats[c]={income:{},expense:{}};
      var bucket=isInc?cats[c].income:cats[c].expense;
      bucket[mo]=(bucket[mo]||0)+t.amount;
    });
    var months=monthOrder.length?monthOrder:[...new Set(txns90.map(function(t){try{var d=new Date(t.date);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');}catch(e){return typeof t.date==='string'?t.date.slice(0,7):'?';}}))].sort();
    function makeBreakupRows(type){
      if(!months.length)return noRows(3,'No data');
      return Object.keys(cats).map(function(cat){
        var total=0; var row='<tr>'+td(cat);
        months.forEach(function(m){var v=(cats[cat][type]||{})[m]||0;total+=v;row+=td(v>0?'₹ '+fmt(v):'-',true);});
        row+=td('₹ '+fmt(total),true,'var(--accent)')+'</tr>';
        return {row:row,total:total};
      }).filter(function(r){return r.total>0;}).map(function(r){return r.row;}).join('');
    }
    var breakupHdr='<thead><tr>'+th('Category')+months.map(function(m){return th(m);}).join('')+th('Total')+'</tr></thead>';
    var ih=document.getElementById('pfr-income-head'); var ib=document.getElementById('pfr-income-body');
    var exh=document.getElementById('pfr-expense-head'); var exb=document.getElementById('pfr-expense-body');
    if(ih)ih.innerHTML=months.length?'<tr>'+th('Category')+months.map(function(m){return th(m);}).join('')+th('Total')+'</tr>':'';
    if(ib)ib.innerHTML=makeBreakupRows('income')||noRows(months.length+2,'No income data');
    if(exh)exh.innerHTML=ih?ih.innerHTML:'';
    if(exb)exb.innerHTML=makeBreakupRows('expense')||noRows(months.length+2,'No expense data');

    // ── 📉 EOD Balances ──
    var eodH=document.getElementById('pfr-eod-head'); var eodB=document.getElementById('pfr-eod-body');
    if(eodH&&eodB&&monthOrder.length){
      eodH.innerHTML='<tr>'+th('Day')+monthOrder.map(function(mk){return th(abbData[mk].label);}).join('')+'</tr>';
      var eod_rows='';
      for(var d=1;d<=31;d++){
        var hasAny=monthOrder.some(function(mk){return abbData[mk].dates[d]!==undefined;});
        if(!hasAny)continue;
        eod_rows+='<tr>'+td(d);
        monthOrder.forEach(function(mk){eod_rows+=td(abbData[mk].dates[d]!==undefined?'₹ '+fmt(abbData[mk].dates[d]):'-',true);});
        eod_rows+='</tr>';
      }
      eodB.innerHTML=eod_rows||noRows(monthOrder.length+1,'No EOD balance data');
    }

    // ── 🏛️ Accounts ──
    var accCards=document.getElementById('pfr-accounts-cards');
    var accInfo=document.getElementById('pfr-accounts-info');
    if(accCards&&perFileData.length){
      accCards.innerHTML=perFileData.map(function(pfd,i){
        var info=pfd.accountInfo||{};
        var txns=pfd.txns||[];
        var crT2=txns.filter(function(t){return t.type==='CR';}).reduce(function(s,t){return s+t.amount;},0);
        var drT2=txns.filter(function(t){return t.type==='DR';}).reduce(function(s,t){return s+t.amount;},0);
        return '<div style="background:var(--surface);border:1.5px solid rgba(59,130,246,.3);border-radius:10px;padding:12px 14px">'+
          '<div style="font-size:11px;font-weight:700;margin-bottom:4px;color:var(--accent)">Account '+(i+1)+' — '+(pfd.fileName||'')+'</div>'+
          '<div style="font-size:13px;font-weight:600">'+(info.bank||'Unknown Bank')+'</div>'+
          '<div style="font-size:11px;color:var(--text3);font-family:monospace">'+(info.accountNo||'—')+'</div>'+
          '<div style="font-size:11px;color:var(--text3);margin-top:3px">'+(info.name||'—')+'</div>'+
          '<div style="margin-top:8px;display:flex;gap:8px">'+
            '<span style="font-size:10px;color:#16a34a;font-weight:600">CR ₹'+fmt(crT2)+'</span>'+
            '<span style="font-size:10px;color:#dc2626;font-weight:600">DR ₹'+fmt(drT2)+'</span>'+
          '</div>'+
          '<div style="font-size:10px;color:var(--text3);margin-top:2px">'+(txns.length)+' txns</div>'+
        '</div>';
      }).join('');
    }
    if(accInfo&&accountInfo){
      var fields=[['Account Holder',accountInfo.name],['Bank',accountInfo.bank],['Account No.',accountInfo.accountNo],['Account Type',accountInfo.accountType],['IFSC',accountInfo.ifsc],['Branch',accountInfo.branch],['PAN',accountInfo.pan],['Mobile',accountInfo.mobile]];
      accInfo.innerHTML=fields.map(function(f){
        return '<div style="background:var(--surface);padding:10px 14px"><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px">'+f[0]+'</div><div style="font-size:13px;font-weight:600;color:var(--text)">'+(f[1]||'—')+'</div></div>';
      }).join('');
    }

    // ── ✅ Validation ──
    var valBadge=document.getElementById('pfr-validation-badge');
    var valBody=document.getElementById('pfr-validation-body');
    if(valBadge){
      var passCount=validChecks.filter(function(c){return c.status==='pass';}).length;
      var failCount=validChecks.filter(function(c){return c.status==='fail';}).length;
      var warnCount=validChecks.filter(function(c){return c.status==='warn';}).length;
      valBadge.innerHTML=(failCount>0?tag(failCount+' FAIL','#dc2626')+' ':'')+(warnCount>0?tag(warnCount+' WARN','#f59e0b')+' ':'')+tag(passCount+' PASS','#16a34a');
    }
    if(valBody){
      valBody.innerHTML=validChecks.length?validChecks.map(function(c){
        var ico=c.status==='pass'?'✅':c.status==='fail'?'❌':'⚠️';
        var bg=c.status==='pass'?'rgba(22,163,74,.06)':c.status==='fail'?'rgba(220,38,38,.06)':'rgba(245,158,11,.06)';
        var bd=c.status==='pass'?'rgba(22,163,74,.2)':c.status==='fail'?'rgba(220,38,38,.2)':'rgba(245,158,11,.2)';
        var col=c.status==='pass'?'#16a34a':c.status==='fail'?'#dc2626':'#f59e0b';
        return '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 14px;background:'+bg+';border:1px solid '+bd+';border-radius:8px">'+
          '<span style="font-size:16px;flex-shrink:0">'+ico+'</span>'+
          '<div style="flex:1;min-width:0">'+
            '<div style="font-size:13px;font-weight:600;color:'+col+'">'+(c.title||c.label||'Check')+'</div>'+
            (c.detail?'<div style="font-size:11px;color:var(--text3);margin-top:2px">'+c.detail+'</div>':'')+
          '</div>'+
          '<span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:20px;background:'+bg+';color:'+col+';border:1px solid '+bd+';flex-shrink:0;text-transform:uppercase;letter-spacing:.5px">'+c.status+'</span>'+
        '</div>';
      }).join(''):'<div style="padding:24px;text-align:center;color:var(--text3)">No validation data available</div>';
    }

    window._lastPerfiosReport = data;
  }


  // Store pending Perfios result until user confirms
  window._pendingPerfiosData = null;

  // ── Listen for postMessage from Perfios iframe ──
  window.addEventListener('message', function(ev) {
    // Handle confirm button clicked from inside the iframe
    if (ev.data && ev.data.type === 'PERFIOS_CONFIRM') {
      if (typeof window.pfv9ConfirmAttachment === 'function') window.pfv9ConfirmAttachment();
      return;
    }
    if (!ev.data || ev.data.type !== 'PERFIOS_COMPLETE') return;
    var data = ev.data.data;
    if (!data) return;

    // Store data — do NOT close popup yet
    window._pendingPerfiosData = data;
    window._lastPerfiosData    = data;   // persistent backup

    // ── Build validation result rows ──
    var validChecks = Array.isArray(data.validChecks) ? data.validChecks : [];

    // ── Determine overall pass/fail ──
    var isValid = data.valid === true;
    var salaryCount = (data.salary && Array.isArray(data.salary)) ? data.salary.length : (data.hasSalary ? '✓' : 0);
    var abbFormatted = '₹ ' + Number(data.abb || 0).toLocaleString('en-IN', {minimumFractionDigits:2});

    // ── Build short failure reasons (only if failed) ──
    var failReasons = [];
    if (!isValid) {
      if (validChecks.length) {
        validChecks.filter(function(c){ return c.status === 'fail'; })
          .forEach(function(c){ failReasons.push(c.title || c.detail || ''); });
      }
      if (!failReasons.length) {
        if ((data.span || 0) < 90)     failReasons.push('Statement span ' + (data.span||0) + 'd (min 90d required)');
        if ((data.staledays||0) > 7)   failReasons.push('Last txn ' + data.staledays + 'd ago (max 7d)');
        if (!data.hasSalary)           failReasons.push('No salary detected');
        if (!failReasons.length)       failReasons.push('Validation rules not met');
      }
    }

    // ── Header based on validation result (used by the footer message below) ──
    var headerIcon  = isValid ? '✅' : '⚠️';

    // NOTE: A blocking full-screen popup used to be built here on every
    // PERFIOS_COMPLETE message. It duplicated two UIs that already work:
    // (1) the Perfios iframe's own Close/Confirm Attachment buttons, and
    // (2) the #pfv9-footer bar below (populated right after this comment).
    // Because the popup rendered on top with a dark backdrop, it blocked
    // access to both of those already-working controls — this is the
    // regression. Removed; the footer (already the correct, non-blocking
    // fallback) is reused as-is, with no new UI or duplicate logic added.

    // ── Additional Bank Statement fallback: while a staleness (Rule 3.2)
    // retry is still pending (attempts < 3), the iframe shows its own retry
    // prompt instead of a Confirm option — keep this outer footer/Confirm
    // button hidden too, so the user isn't offered two conflicting actions.
    var staleRetryPending = (data.staledays || 0) > 7 && !data.manualReviewRequired && (data.staleAttempts || 0) < 3;

    var footer = document.getElementById('pfv9-footer');
    if (footer) {
      if (staleRetryPending) {
        footer.style.display = 'none';
      } else {
        footer.style.display = 'flex';
        var info = document.getElementById('pfv9-footer-info');
        if (info) {
          info.innerHTML = (isValid ? '✅' : '⚠️') + ' Report ready · ABB: <strong style="color:#1a4fa3">' + abbFormatted + '</strong>' +
            (data.manualReviewRequired ? ' · <strong style="color:#dc2626">⚠ 3/3 attempts used — flagged for manual review</strong>' : '');
        }
      }
    }
  });

  // ── Confirm & Save: attach doc + populate report + close ──
  window.pfv9ConfirmAttachment = function() {
    var data = window._pendingPerfiosData || window._lastPerfiosData;
    if (!data) { console.warn('[pfv9] No pending Perfios data to confirm'); return; }
    window._lastPerfiosData = data;  // keep a backup

    // 1. Populate Perfios Report section (if function exists)
    if (typeof renderPerfiosReport === 'function') renderPerfiosReport(data);

    // 2. Mark the wizard doc-item as uploaded with Perfios verification
    _pfv9MarkWizardDocUploaded(data);

    // 3. Attach/refresh bank statement entry in Documents tab
    _attachBankStatementToDocuments(data);

    // 3b. Mark the banking doc-item status in wizard as UPLOADED
    _pfv9MarkBankingDocItem(data);

    // 4. Update document progress bar
    if (typeof window._docUpdateProgress === 'function') window._docUpdateProgress();

    // 4b. Flag for manual review if all 3 Additional Bank Statement attempts were used and still stale
    if (data.manualReviewRequired && window.currentDetail && typeof window.addTrackingEntry === 'function') {
      window.currentDetail.perfiosManualReviewRequired = true;
      window.addTrackingEntry(window.currentDetail, 'EFIN-Perfios Bank Statement', 'System Comments',
        'Last Transaction validation (Rule 3.2) failed on all 3 Additional Bank Statement attempts — flagged for manual review.',
        (data.staledays || 0) + ' day(s) since last transaction (max 7 allowed)');
    }

    // 5. Close popup
    if (typeof window.pfv9Close === 'function') window.pfv9Close();

    // 6. Reset footer
    var footer = document.getElementById('pfv9-footer');
    if (footer) footer.style.display = 'none';
    window._pendingPerfiosData = null;

    // 7. Navigate to Perfios Report tab automatically
    setTimeout(function() {
      var reportBtn = document.getElementById('tab-reports-btn');
      var perfiosTab = document.getElementById('reports-subtab-perfios');
      if (perfiosTab && typeof switchReportsSubTab === 'function') {
        if (typeof switchTab === 'function' && reportBtn) switchTab('reports', reportBtn);
        setTimeout(function() { switchReportsSubTab('perfios', perfiosTab); }, 150);
      }
    }, 300);

    // 8. Success toast
    var msg = data.manualReviewRequired
      ? '⚠ Statement attached, but flagged for manual review (3/3 attempts used)'
      : '✅ Bank statement verified — Perfios report saved';
    if (!data.manualReviewRequired && data.hasSalary) msg += ' · Salary detected';
    if (typeof window.showToast === 'function') window.showToast(msg, data.manualReviewRequired ? 'warning' : 'success');
    else alert(msg);
  };

  // ── Mark the wizard doc-item (PENDING → UPLOADED) with Perfios badge ──
  function _pfv9MarkWizardDocUploaded(data) {
    var docItemId = window._pfv9DocItemId;
    var docName   = window._pfv9DocName || 'Last 6 Month Bank Statement (Salary Account)';
    var perfData  = window._pendingPerfiosData || data;
    var perFiles  = perfData ? (perfData.perFileData || []) : [];
    var firstFile = perFiles.length ? perFiles[0] : null;
    var fileName  = firstFile ? firstFile.fileName : docName;

    // Build a synthetic entry in _BFP_STORE so submitWizard captures it
    if (!window._BFP_STORE) window._BFP_STORE = {};
    var storeKey = docItemId || ('docitem-wiz-bank-' + Date.now());
    // Extract password from docFiles or perFileData
    var pdfPwd = null;
    var docFiles = perfData ? (perfData.docFiles || []) : [];
    docFiles.forEach(function(df) { if (df.pdfPassword) pdfPwd = df.pdfPassword; });
    if (!pdfPwd) {
      perFiles.forEach(function(pf) { if (pf.pdfPassword) pdfPwd = pf.pdfPassword; });
    }

    window._BFP_STORE[storeKey] = {
      name:        fileName,
      mimetype:    'application/pdf',
      isPdf:       true,
      isImage:     false,
      url:         '',           // no object URL (file was in iframe; see dataUrl instead)
      dataUrl:     (data && data.fileDataUrl) || (perfData && perfData.fileDataUrl) || '',
      pdfPassword: pdfPwd,
      perfiosVerified: true,
      perfiosData: {
        abb:       data.abb,
        span:      data.span,
        totalTxns: data.totalTxns,
        hasSalary: data.hasSalary,
        valid:     data.valid,
        firstDate: data.firstDate,
        lastDate:  data.lastDate,
      },
    };

    // Find the wizard doc-item in the DOM and visually mark it uploaded
    var item = docItemId ? document.getElementById(docItemId) : null;
    if (!item) {
      // Fallback: find by bank statement label text
      var allItems = document.querySelectorAll('.doc-item, [class*="doc-item"]');
      for (var i = 0; i < allItems.length; i++) {
        if (/bank.statement|banking/i.test(allItems[i].textContent)) {
          item = allItems[i]; break;
        }
      }
    }

    // Give the item a counted id and reuse ONE shared store key (avoid double count).
    if (item) {
      // The render uses id="docitem-wiz-<index>" (a counted prefix) and passes it to
      // pfv9Open, so keep the existing id; only generate one if it is truly missing.
      if (!item.id) {
        item.id = 'docitem-wiz-bank-' + Math.random().toString(36).slice(2, 8);
      }
      // Re-point the shared key to the resolved element id and migrate the entry.
      if (storeKey !== item.id) {
        window._BFP_STORE[item.id] = window._BFP_STORE[storeKey];
        if (storeKey.indexOf('docitem-wiz-bank-') === 0 && storeKey !== item.id) delete window._BFP_STORE[storeKey];
        storeKey = item.id;
      }
      window._pfv9DocItemId = item.id;   // so _pfv9MarkBankingDocItem reuses the same key
      var isValid = data.valid === true;
      // Border + background based on validation
      item.style.borderColor  = isValid ? '#10b981' : '#f59e0b';
      item.style.borderStyle  = 'solid';
      item.style.borderWidth  = '1.5px';
      item.style.background   = isValid ? 'linear-gradient(135deg,#f0faf3,#ecfdf5)' : 'linear-gradient(135deg,#fffbeb,#fef3c7)';
      item.style.boxShadow    = isValid ? '0 3px 10px rgba(16,185,129,.12)' : '0 3px 10px rgba(245,158,11,.12)';

      // Update status badge
      var statusEl = item.querySelector('[id^="doc-status-"], .doc-status, [class*="status"]');
      if (statusEl) {
        statusEl.textContent = isValid ? '✓ VERIFIED' : '⚠ NEEDS REVIEW';
        statusEl.style.cssText = isValid
          ? 'font-size:9.5px;font-weight:800;padding:4px 10px;border-radius:20px;background:linear-gradient(135deg,#059669,#10b981);color:#fff;border:1px solid #10b981;flex-shrink:0;letter-spacing:.6px;box-shadow:0 2px 6px rgba(16,185,129,.28)'
          : 'font-size:9.5px;font-weight:800;padding:4px 10px;border-radius:20px;background:linear-gradient(135deg,#d97706,#f59e0b);color:#fff;border:1px solid #f59e0b;flex-shrink:0;letter-spacing:.6px;box-shadow:0 2px 6px rgba(245,158,11,.28)';
      }


    }
  }

  // ── Attach bank statement file to Documents tab ──
  function _attachBankStatementToDocuments(data) {
    // Get file info from perFileData (sent via postMessage)
    var perFiles = data.perFileData || [];
    var firstFile = perFiles.length ? perFiles[0] : null;
    var fileName = firstFile ? firstFile.fileName : (window._pfv9DocName || 'Bank Statement.pdf');

    // Also check _BFP_STORE for any matching entry
    var bankEntry = null;
    if (window._BFP_STORE) {
      Object.entries(window._BFP_STORE).forEach(function(kv) {
        var k = kv[0], v = kv[1];
        if (v && (/bank.statement|banking/i.test(v.name || '') || v.perfiosVerified)) {
          bankEntry = v;
        }
      });
    }

    var now = new Date();
    var uploadedAt = now.toLocaleDateString('en-IN') + ' ' + now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});

    // Store in app's perfiosDoc for Documents tab display
    // Prefer fileDataUrl from postMessage (base64 data URL — works cross-frame unlike blob URLs)
    var fileDataUrl = data.fileDataUrl || '';
    window._perfiosBankDoc = {
      fileName:    bankEntry ? bankEntry.name : (data.fileName || fileName),
      objUrl:      '',
      dataUrl:     fileDataUrl || (bankEntry ? (bankEntry.dataUrl || '') : ''),
      pdfPassword: (bankEntry && bankEntry.pdfPassword) ? bankEntry.pdfPassword
                 : (data.docFiles && data.docFiles.find(function(f){return f.pdfPassword;}))
                   ? data.docFiles.find(function(f){return f.pdfPassword;}).pdfPassword
                   : (data.perFileData && data.perFileData.find(function(f){return f.pdfPassword;}))
                     ? data.perFileData.find(function(f){return f.pdfPassword;}).pdfPassword : null,
      uploadedAt:  uploadedAt,
      abb:         data.abb,
      span:        data.span,
      txns:        data.totalTxns,
      hasSalary:   data.hasSalary,
      valid:       data.valid,
      firstDate:   data.firstDate,
      lastDate:    data.lastDate,
      accountInfo: data.accountInfo || {},
      validChecks: data.validChecks || [],
    };

    // Inject into the Documents tab if it's currently open
    _refreshDocumentsBankStatement();

    // Also update the BANKING section doc-item status in the wizard if visible
    _pfv9UpdateWizardBankingSection(data);
  }

  // ── Update BANKING section doc-item to show verified status ──
  function _pfv9UpdateWizardBankingSection(data) {
    // Find "Last 6 Month Bank Statement" doc items in the wizard
    var bankItems = [];
    document.querySelectorAll('.doc-item, [data-doc-name]').forEach(function(el) {
      if (/bank.statement|banking/i.test(el.dataset.docName || '') ||
          /bank.statement|banking/i.test(el.querySelector('.doc-name, [class*="doc-name"]')?.textContent || '') ||
          /bank.statement|banking/i.test(el.textContent)) {
        bankItems.push(el);
      }
    });
    bankItems.forEach(function(item) {
      if (item.style.borderColor === 'rgb(16, 185, 129)') return; // already marked
      // Light green styling
      item.style.borderColor  = '#10b981';
      item.style.borderStyle  = 'solid';
      item.style.borderWidth  = '1.5px';
      item.style.background   = 'linear-gradient(135deg,#f0faf3,#ecfdf5)';
      item.style.boxShadow    = '0 3px 10px rgba(16,185,129,.12)';
    });
  }

  // Same Partner/DSA restriction used for every other document Delete button
  // in the app (see deleteWizDoc in efin-app.js) — kept consistent here too.
  function _pfv9IsPartnerOrDSA() {
    return typeof currentUser !== 'undefined' && currentUser &&
      (currentUser.role === 'partner' || currentUser.role === 'dsa');
  }

  function _refreshDocumentsBankStatement() {
    var doc = window._perfiosBankDoc;
    if (!doc) return;
    var existing = document.getElementById('perfios-bank-doc-entry');
    if (existing) existing.remove();

    // Works in both: loan detail Documents tab and wizard Banking section
    var containers = [
      document.getElementById('detail-docs'),
      document.querySelector('.wizard-banking-docs, [data-section="banking"]'),
      // Also try the active wizard step's banking/documents section
      document.querySelector('#step-docs .doc-group[data-group="banking"]'),
      document.querySelector('.doc-group[data-group="banking"]'),
    ].filter(Boolean);
    // Remove duplicates
    var seen = new Set();
    var uniqueContainers = containers.filter(function(c) {
      if (!c || seen.has(c)) return false;
      seen.add(c); return true;
    });

    uniqueContainers.forEach(function(detailDocs) {
      if (!detailDocs) return;

      // ── Remove old section header if exists ──
      var oldHdr = document.getElementById('perfios-bank-doc-section-hdr');
      if (oldHdr) oldHdr.remove();

      // ── Add "Bank Statement — via Perfios" section header ──
      var sectionHdr = document.createElement('div');
      sectionHdr.id = 'perfios-bank-doc-section-hdr';
      sectionHdr.style.cssText =
        'display:flex;align-items:center;justify-content:space-between;' +
        'padding:10px 14px;margin-bottom:8px;border-radius:10px;' +
        'background:linear-gradient(135deg,#eff6ff,#e8f2ff);' +
        'border:1.5px solid #bfdbfe;';
      sectionHdr.innerHTML =
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<div style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#1d4ed8,#1a4fa3);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">🏦</div>' +
          '<div>' +
            '<div style="font-size:13px;font-weight:700;color:#1e3a8a">Bank Statement — via Perfios</div>' +
            '<div style="font-size:11px;color:#3b82f6;margin-top:1px">Verified &amp; Attached automatically after Perfios analysis</div>' +
          '</div>' +
        '</div>' +
        '<span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:20px;background:linear-gradient(135deg,#059669,#10b981);color:#fff;letter-spacing:.5px">✓ PERFIOS</span>';

      var entry = document.createElement('div');
      entry.id = 'perfios-bank-doc-entry';
      entry.style.cssText =
        'border:1.5px solid #10b981;border-radius:12px;padding:14px 16px;margin-bottom:12px;' +
        'background:linear-gradient(135deg,#f0faf3,#ecfdf5);' +
        'display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;' +
        'box-shadow:0 2px 8px rgba(16,185,129,.12)';

      var salaryLine = doc.hasSalary
        ? '<span style="color:#059669;font-weight:700">💰 Salary Detected</span> · '
        : '<span style="color:#b45309">⚠ No Salary</span> · ';

      var acct = doc.accountInfo || {};
      var acctLine = '';
      if (acct.name || acct.bank || acct.accountNo) {
        acctLine = '<div style="font-size:11px;color:#374151;margin-top:4px">' +
          (acct.name ? '👤 ' + acct.name + ' · ' : '') +
          (acct.bank ? '🏦 ' + acct.bank + ' · ' : '') +
          (acct.accountNo ? 'A/C: ' + acct.accountNo : '') +
          '</div>';
      }

      entry.innerHTML =
        '<div style="width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,#0f3278,#1a4fa3);' +
        'display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">🏦</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:13px;font-weight:700;color:#0f172a;display:flex;align-items:center;gap:8px">' +
            doc.fileName +
            (doc.valid
              ? '<span style="font-size:9px;font-weight:800;padding:3px 8px;border-radius:20px;background:linear-gradient(135deg,#059669,#10b981);color:#fff;letter-spacing:.5px;flex-shrink:0">✓ VERIFIED</span>'
              : '<span style="font-size:9px;font-weight:800;padding:3px 8px;border-radius:20px;background:linear-gradient(135deg,#dc2626,#ef4444);color:#fff;letter-spacing:.5px;flex-shrink:0">✗ VALIDATION FAILED</span>') +
          '</div>' +
          '<div style="font-size:11px;color:#64748b;margin-top:3px">' +
            'Attached: ' + doc.uploadedAt + ' · ' +
            'Period: ' + (doc.firstDate || '—') + ' → ' + (doc.lastDate || '—') +
          '</div>' +
          (doc.pdfPassword ?
            '<div style="display:inline-flex;align-items:center;gap:6px;margin-top:6px;background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:4px 10px;">' +
              '<span style="font-size:11px;color:#92400e;font-weight:700">🔑 PDF Password:</span>' +
              '<span id="pfios-pwd-val" style="font-family:monospace;font-size:12px;font-weight:700;color:#78350f;letter-spacing:1px">••••••••</span>' +
              '<button onclick="(function(){var el=document.getElementById(\'pfios-pwd-val\'),h=el.textContent===\'••••••••\';el.textContent=h?\'' + doc.pdfPassword.replace(/'/g,"\'") + '\':\'••••••••\';this.textContent=h?\'🙈 Hide\':\'👁 Show\';}).call(this)" ' +
                'style="padding:2px 8px;font-size:10px;font-weight:700;background:#fff;border:1px solid #fcd34d;border-radius:4px;cursor:pointer;color:#92400e">👁 Show</button>' +
              '<button onclick="navigator.clipboard.writeText(\'' + doc.pdfPassword.replace(/'/g,"\'") + '\').then(function(){var b=document.getElementById(\'pfios-pwd-copy\');b.textContent=\'✓ Copied!\';setTimeout(function(){b.textContent=\'📋 Copy\'},1500);})" ' +
                'id="pfios-pwd-copy" style="padding:2px 8px;font-size:10px;font-weight:700;background:#fff;border:1px solid #fcd34d;border-radius:4px;cursor:pointer;color:#92400e">📋 Copy</button>' +
            '</div>'
          : '') +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;align-items:flex-end">' +
        (doc.dataUrl ?
          '<button onclick="(function(){var d=window._perfiosBankDoc;if(d&&d.dataUrl)window.open(d.dataUrl,\'_blank\');else alert(\'File not available\');})()" ' +
            'style="padding:6px 14px;background:#eff6ff;border:1.5px solid #1a4fa3;color:#1a4fa3;' +
            'border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:5px">👁 View</button>'
        : '') +
        (doc.dataUrl ?
          '<button onclick="(function(){var d=window._perfiosBankDoc;if(!d||!d.dataUrl)return;' +
            'var a=document.createElement(\'a\');a.href=d.dataUrl;' +
            'a.download=d.fileName||\'Bank_Statement.pdf\';' +
            'document.body.appendChild(a);a.click();document.body.removeChild(a);' +
          '})()" ' +
            'style="padding:6px 14px;background:#f0fdf4;border:1.5px solid #16a34a;color:#16a34a;' +
            'border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:5px">⬇ Download</button>'
        : '') +
        (!_pfv9IsPartnerOrDSA() ?
          '<button onclick="(function(){' +
            'var cd=window.currentDetail;if(!cd||!cd.uploadedDocs)return;' +
            'var idx=cd.uploadedDocs.findIndex(function(d){return d.perfiosVerified;});' +
            'if(idx<0){if(typeof showToast===\'function\')showToast(\'Document not found\',\'error\');return;}' +
            'if(typeof window.deleteWizDoc===\'function\')window.deleteWizDoc(cd.id,idx);' +
          '})()" ' +
            'style="padding:6px 14px;background:#fef2f2;border:1.5px solid #ef4444;color:#ef4444;' +
            'border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:5px">🗑 Delete</button>'
        : '') +
        '</div>';

      detailDocs.insertAdjacentElement('afterbegin', entry);
      detailDocs.insertAdjacentElement('afterbegin', sectionHdr);
    });
  }

  // ── Mark the specific "Last 6 Month Bank Statement" doc-item in wizard ──
  function _pfv9MarkBankingDocItem(data) {
    var perFiles  = (data.perFileData || []);
    var docFiles  = (data.docFiles   || []);
    var firstFile = perFiles.length ? perFiles[0] : (docFiles.length ? docFiles[0] : null);
    var fileName  = firstFile ? firstFile.fileName : (window._pfv9DocName || 'Bank Statement.pdf');

    // ── Find the exact wizard doc-item for bank statement ──
    var bankItem = null;
    var docItemId = window._pfv9DocItemId;

    // 1) By saved ID first
    if (docItemId) bankItem = document.getElementById(docItemId);

    // 2) Fallback: find a doc-item whose status badge id starts with "doc-status-"
    //    and whose card text matches a bank statement.
    if (!bankItem) {
      var statusEls = document.querySelectorAll('[id^="doc-status-"]');
      for (var i = 0; i < statusEls.length; i++) {
        var card = statusEls[i].closest('.doc-item') ||
                   statusEls[i].closest('[class*="doc-item"]') ||
                   statusEls[i].parentElement;
        if (card && /bank.?statement|6.month.bank|salary.account/i.test(card.textContent)) {
          bankItem = card; break;
        }
      }
    }

    // 3) Last resort: any element mentioning bank statement
    if (!bankItem) {
      document.querySelectorAll('[class*="doc-item"], .doc-item').forEach(function(el) {
        if (!bankItem && /bank.?statement|6.month.bank|salary.account/i.test(el.textContent)) {
          bankItem = el;
        }
      });
    }

    if (!bankItem) return;
    // The render assigns banking items id="docitem-wiz-<index>" (already a counted
    // prefix) and passes it to pfv9Open, so prefer the element's existing id.
    if (!bankItem.id) {
      bankItem.id = 'docitem-wiz-bank-' + Math.random().toString(36).slice(2, 8);
    }

    // Perfios reaching Confirm means the statement was accepted in the popup.
    // Treat it as UPLOADED; show a "valid/sub-optimal" nuance via the badge label.
    var isValid = data.valid !== false;

    // ── Update status pill exactly like a normal upload ([id^="doc-status-"]) ──
    var pill = bankItem.querySelector('[id^="doc-status-"]') ||
               bankItem.querySelector('[class*="status"]');
    if (pill) {
      pill.textContent = isValid ? '✓ VERIFIED' : '✓ UPLOADED · ⚠';
      pill.style.cssText = 'font-size:9.5px;font-weight:800;padding:4px 10px;border-radius:20px;background:linear-gradient(135deg,#059669,#10b981);color:#fff;border:1px solid #10b981;flex-shrink:0;letter-spacing:.6px;box-shadow:0 2px 6px rgba(16,185,129,.28)';
    }

    // ── Update the "Upload Statement" button → uploaded state ──
    var typeEl = bankItem.querySelector('.doc-type');
    if (typeEl) {
      typeEl.innerHTML = '<span style="color:#059669;font-size:9px">●</span> <span style="color:#059669;font-weight:600">🏦 ' + fileName + ' · Perfios Verified</span>';
    }
    // Relabel the Perfios upload button so it reads as done (it stays clickable to re-run).
    bankItem.querySelectorAll('button').forEach(function(btn){
      if (/upload statement/i.test(btn.textContent)) {
        btn.innerHTML = '🏦 Re-run Perfios';
        btn.style.borderColor = '#10b981';
        btn.style.color = '#059669';
      }
    });

    // ── Card styling — always green once attached (validation already passed in popup) ──
    bankItem.style.border     = '1.5px solid #10b981';
    bankItem.style.background = 'linear-gradient(135deg,#f0faf3,#ecfdf5)';
    bankItem.style.boxShadow  = '0 2px 8px rgba(16,185,129,.15)';

    // Remove any existing info strip (avoid duplicates)
    var oldStrip = bankItem.querySelector('.pfv9-bank-info-strip');
    if (oldStrip) oldStrip.remove();

    // ── Write _BFP_STORE under the ACTUAL element id (what submit/render reads) ──
    if (!window._BFP_STORE) window._BFP_STORE = {};
    var pdfPwd = null;
    docFiles.forEach(function(f) { if (f.pdfPassword) pdfPwd = f.pdfPassword; });
    perFiles.forEach(function(f) { if (!pdfPwd && f.pdfPassword) pdfPwd = f.pdfPassword; });
    window._BFP_STORE[bankItem.id] = {
      name: fileName, mimetype: 'application/pdf', isPdf: true,
      isImage: false, url: '', dataUrl: data.fileDataUrl || '', pdfPassword: pdfPwd,
      perfiosVerified: true,
      files: [{ name: fileName, mimetype: 'application/pdf', isPdf: true, isImage: false, url: '', pdfPassword: pdfPwd }],
      perfiosData: { abb: data.abb, span: data.span, totalTxns: data.totalTxns,
                     hasSalary: data.hasSalary, valid: data.valid }
    };

    // Update the progress bar after marking.
    if (typeof window._docUpdateProgress === 'function') { try { window._docUpdateProgress(); } catch(_) {} }
  }

  // Re-attach when Documents tab is opened
  var _origSwitchTab = window.switchTab;
  window.switchTab = function(name, el) {
    if (typeof _origSwitchTab === 'function') _origSwitchTab.apply(this, arguments);
    if (name === 'documents') {
      setTimeout(_refreshDocumentsBankStatement, 50);
    }
    // Guard: ensure detail-title always shows the app ID
    if (window.currentDetail) {
      var titleEl = document.getElementById('detail-title');
      if (titleEl && !titleEl.textContent.trim()) {
        titleEl.textContent = window.currentDetail.id || window.currentDetail._tempAppNo || '—';
      }
      var subEl = document.getElementById('detail-sub');
      if (subEl && !subEl.textContent.trim() && typeof loanTypeLabel === 'function') {
        subEl.textContent = loanTypeLabel(window.currentDetail.loanType) + ' — ' + (window.currentDetail.name || '');
      }
    }
  };

  // Expose for manual trigger
  // ── Perfios Report tab switcher ──
  window.pfrTab = function(name, btn) {
    document.querySelectorAll('.pfr-panel').forEach(function(p){ p.classList.remove('pfr-active'); p.style.display=''; });
    document.querySelectorAll('.pfr-tab').forEach(function(b){ b.classList.remove('active'); });
    var panel = document.getElementById('pfr-panel-' + name);
    if (panel) { panel.classList.add('pfr-active'); }
    if (btn) btn.classList.add('active');
  };


  window.renderPerfiosReport = renderPerfiosReport;
})();
