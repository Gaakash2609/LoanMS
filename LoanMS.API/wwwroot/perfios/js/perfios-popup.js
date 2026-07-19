// ═══════════════════════════════════════════════════════════════
//  POPUP MODE — Upload + Process + Send full data to parent
//  All report tabs rendered in parent's Perfios Report section
// ═══════════════════════════════════════════════════════════════

// ── State (not already declared in script 3) ──
let _docFiles    = [];
let _analysisResult = null;

// ── Capture original functions before overriding ──
const _origHandleFiles        = handleFiles;
const _origFinalizeProcessing = finalizeProcessing;
const _origResetAll           = resetAll;
const _origLog                = log;

// ── Capture log entries for postMessage payload ──
log = function(type, msg) {
  _processLog.push({ type, msg: String(msg) });
  _origLog(type, msg);
};

// ── Override showLoader / hideLoader ──
showLoader = function(msg) {
  const el = document.getElementById('loaderMsg');
  const ov = document.getElementById('loadingOverlay');
  if (el) el.textContent = msg || 'Processing…';
  if (ov) ov.classList.add('show');
  clearTimeout(_loaderTimer);
  _loaderTimer = setTimeout(function() {
    hideLoader();
    showBanner('error', 'Processing timed out after 45 seconds.');
    document.getElementById('validationSection').classList.add('show');
    if (currentFileIdx < (pendingFiles ? pendingFiles.length : 0)) {
      currentFileIdx++;
      processNextFile();
    }
  }, 45000);
};
hideLoader = function() {
  clearTimeout(_loaderTimer);
  const ov = document.getElementById('loadingOverlay');
  if (ov) ov.classList.remove('show');
};

// ── Track every file uploaded in this session (original + Additional
// Bank Statement retries) so a retry attempt can be re-validated together
// with what was already uploaded, instead of discarding it. ──
window._pfAllUploadedFiles = window._pfAllUploadedFiles || [];

// ── Override handleFiles: hide upload zone; merge files during an
// Additional Bank Statement retry so Perfios re-runs on the COMPLETE
// combined statement (original + newly added), not the new file alone. ──
handleFiles = async function(files) {
  if (!files.length) return;
  const uz = document.getElementById('uploadZone');
  if (uz) uz.style.display = 'none';

  const isAdditionalRetry = !!(window._pfStaleFailure && window._pfStaleFailure.isStale && !window._pfStaleFailure.exhausted);
  if (isAdditionalRetry) {
    // Merge with everything uploaded so far in this session.
    window._pfAllUploadedFiles = window._pfAllUploadedFiles.concat(Array.from(files));
    log('info', `📎 Additional Bank Statement added — re-validating against all ${window._pfAllUploadedFiles.length} file(s) uploaded so far`);
    await _origHandleFiles(window._pfAllUploadedFiles.slice());
  } else {
    window._pfAllUploadedFiles = Array.from(files);
    await _origHandleFiles(files);
  }
};

// ── STUB all render functions — rendering happens in parent app ──
updateStats        = function() {};
renderTxnTable     = function() {};
renderTargetTable  = function() {};
renderPerfiosTable = function() {};
renderSalarySection   = function() {};
renderACHSection      = function() {};
renderECSSection      = function() {};
renderNEFTSection     = function() {};
renderUPISection      = function() {};
renderChequeSection   = function() {};
renderBounceSection   = function() {};
renderAccountsSection = function() {};
renderFinOneTable     = function() {};
renderAnalysisTable   = function() {};
renderBreakupTables   = function() {};
renderEODTable        = function() {};
renderAccountInfo     = function() {};
renderSummaryGrid     = function() {};
exportExcel           = function() {};
filterTxnTable        = function() {};
setTxnAccount         = function() {};
showTab               = function() {};

// ── renderValidationSection: show pass/fail in popup validation card ──
renderValidationSection = function() {
  const grid  = document.getElementById('validationGrid');
  const badge = document.getElementById('validationBadge');
  if (!grid) return;
  const passes = validChecks.filter(c => c.status === 'pass').length;
  const fails  = validChecks.filter(c => c.status === 'fail').length;
  const warns  = validChecks.filter(c => c.status === 'warn').length;
  if (badge) {
    badge.textContent = passes + ' passed' +
      (fails > 0 ? ' · ' + fails + ' failed' : '') +
      (warns > 0 ? ' · ' + warns + ' warning(s)' : '');
    badge.style.color = fails > 0 ? 'var(--danger)' : 'var(--success)';
  }
  const toShow = fails === 0 ? validChecks : validChecks.filter(c => c.status !== 'pass');
  grid.innerHTML = toShow.map(c => `
    <div class="vcheck ${c.status}">
      <div class="vcheck-icon">${c.icon}</div>
      <div class="vcheck-body">
        <div class="vcheck-title">${c.title}</div>
        <div class="vcheck-detail">${c.detail}</div>
      </div>
      <div class="vcheck-val">${c.value}</div>
    </div>`).join('');
  document.getElementById('validationSection').classList.add('show');
};

// ── Override finalizeProcessing ──
finalizeProcessing = function() {
  _origFinalizeProcessing();
  setTimeout(function() {
    const staleFail = window._pfStaleFailure;

    // ── Additional Bank Statement fallback: staleness (Rule 3.2) failure with
    // attempts still remaining → show the retry prompt instead of Confirm
    // Attachment, and stop here (don't touch docs/validation/confirm-bar/reset-bar).
    if (staleFail && staleFail.isStale && !staleFail.exhausted) {
      _showAdditionalStatementRetry(staleFail.attempts);
      hideLoader();
      _postToParent(); // keep parent in sync with the latest (failed) attempt
      return;
    }

    // Build _docFiles from perFileData (populated by original processNextFile)
    if (perFileData && perFileData.length) {
      const ts = (filtered90 || []).map(t => t.date instanceof Date ? t.date.getTime() : +t.date).filter(Boolean);
      const span = ts.length ? Math.round((Math.max(...ts) - Math.min(...ts)) / 86400000) : 0;
      _docFiles = perFileData.map(pfd => ({
        fileName:    pfd.fileName,
        fileSize:    pfd.fileSize || 0,
        txnCount:    pfd.txns ? pfd.txns.length : 0,
        isProtected: pfd.isProtected || false,
        pdfPassword: pfd.pdfPassword || null,
        hasSalary:   (salaryTxns || []).length > 0,
        span,
        validated:   true,
        attachedAt:  Date.now()
      }));
      _renderDocs();
      const ds = document.getElementById('docSection');
      if (ds) ds.classList.add('show');
    }

    // Show validation section
    document.getElementById('validationSection').classList.add('show');

    // 3 attempts exhausted and still stale → application must be flagged for
    // manual review; Confirm Attachment reappears so the (best available)
    // statement can still be attached.
    const exhaustedStale = !!(staleFail && staleFail.isStale && staleFail.exhausted);
    window._pfManualReviewRequired = exhaustedStale;

    // Show confirm bar
    const uz = document.getElementById('uploadZone');
    if (uz) uz.style.display = 'none'; // hide any leftover retry uploader
    _showConfirmBar(exhaustedStale);

    // Show reset bar with ABB + span
    const rb = document.getElementById('resetBar');
    if (rb) rb.classList.add('show');
    _updateResetBar();

    hideLoader();

    // Send full data to parent
    _postToParent();
  }, 150);
};

// ── _showAdditionalStatementRetry: prompt for another statement upload ──
// Reuses the existing upload zone (already wired to handleFiles via the
// fileInput 'change' listener) so no new upload plumbing is needed — just
// re-reveal it with retry-specific copy and hide the confirm bar meanwhile.
function _showAdditionalStatementRetry(attemptsUsed) {
  const bar = document.getElementById('confirmBar');
  if (bar) bar.classList.remove('show');
  const uz = document.getElementById('uploadZone');
  if (!uz) return;
  uz.style.display = '';
  const h2 = uz.querySelector('h2');
  const p  = uz.querySelector('p');
  const attemptsLeft = Math.max(0, 3 - attemptsUsed);
  if (h2) h2.textContent = 'Upload Additional Bank Statement';
  if (p)  p.innerHTML = `Last transaction was too old (Rule 3.2). Attempt <strong>${attemptsUsed}/3</strong> used — `
    + `${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} left. Please upload a more recent statement.`;
}

// ── _updateResetBar ──
function _updateResetBar() {
  const sorted = [...allTxns].sort((a,b) => a.date - b.date);
  let abbVal = 0;
  if (monthOrder.length && Object.keys(abbData).length) {
    const avgs = monthOrder.map(mk => {
      const vals = Object.values(abbData[mk].dates);
      return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
    });
    abbVal = avgs.reduce((a,b)=>a+b,0) / Math.max(1,avgs.length);
  }
  const fl = sorted.length ? sorted[0].date : null;
  const ll = sorted.length ? sorted[sorted.length-1].date : null;
  const span = (fl && ll) ? Math.floor((ll-fl)/86400000) : 0;
  const abbEl  = document.getElementById('abABBVal');
  const daysEl = document.getElementById('abDays');
  if (abbEl)  abbEl.textContent  = '₹ ' + fmt(abbVal);
  if (daysEl) daysEl.textContent = span;
}

// ── _showConfirmBar ──
function _showConfirmBar(manualReviewRequired) {
  const bar = document.getElementById('confirmBar');
  if (!bar) return;
  const meta = document.getElementById('confirmBarMeta');
  if (meta) {
    const sorted = [...allTxns].sort((a,b) => a.date - b.date);
    const fl = sorted.length ? sorted[0].date : null;
    const ll = sorted.length ? sorted[sorted.length-1].date : null;
    const span = (fl && ll) ? Math.floor((ll-fl)/86400000) : 0;
    const fname = perFileData && perFileData.length ? perFileData[0].fileName : '';
    meta.textContent = (fname ? fname + ' · ' : '') + span + ' days · ' +
      ((salaryTxns||[]).length > 0 ? '💰 Salary detected' : 'No salary detected') +
      (manualReviewRequired ? ' · ⚠ 3/3 attempts used — flagged for manual review' : '');
  }
  bar.classList.add('show');
}

// ── _pfv9Confirm: send PERFIOS_CONFIRM to parent ──
async function _pfv9Confirm() {
  await _postToParent();
  // Send PERFIOS_CONFIRM to parent — parent will call pfv9ConfirmAttachment which closes popup
  try { window.parent.postMessage({ type: 'PERFIOS_CONFIRM' }, '*'); } catch(e) {}
  try {
    if (typeof window.parent.pfv9ConfirmAttachment === 'function') {
      window.parent.pfv9ConfirmAttachment();
    } else {
      // Fallback: close directly if parent fn not available
      try { window.parent.pfv9Close(); } catch(e2) {}
    }
  } catch(e) {
    // Last resort close
    try { window.parent.document.getElementById('pfv9-overlay').classList.remove('open'); } catch(e2) {}
  }
  const bar = document.getElementById('confirmBar');
  if (bar) bar.classList.remove('show');
}

// ── _fileToDataUrl: convert a File to a base64 data URL ──
// Blob object URLs (URL.createObjectURL) don't reliably survive the
// iframe → parent postMessage boundary; a base64 data URL string does,
// since it's plain serializable data rather than a reference into this
// frame's local object-URL registry.
function _fileToDataUrl(file) {
  return new Promise((resolve) => {
    if (!file) { resolve(''); return; }
    try {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result || '');
      reader.onerror = () => resolve('');
      reader.readAsDataURL(file);
    } catch (e) { resolve(''); }
  });
}

// ── _postToParent: send PERFIOS_COMPLETE with full data ──
async function _postToParent() {
  const sorted  = [...allTxns].sort((a,b) => a.date - b.date);
  const openBal = sorted.length
    ? (sorted[0].type === 'CR' ? sorted[0].balance - sorted[0].amount : sorted[0].balance + sorted[0].amount)
    : 0;
  let abbVal = 0;
  if (monthOrder.length && Object.keys(abbData).length) {
    const avgs = monthOrder.map(mk => {
      const vals = Object.values(abbData[mk].dates);
      return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
    });
    abbVal = avgs.reduce((a,b)=>a+b,0) / Math.max(1,avgs.length);
  }
  const fl       = sorted.length ? sorted[0].date : null;
  const ll       = sorted.length ? sorted[sorted.length-1].date : null;
  const span     = (fl && ll) ? Math.floor((ll-fl)/86400000) : 0;
  const today    = new Date(); today.setHours(0,0,0,0);
  const staledays = ll ? Math.floor((today-ll)/86400000) : 999;

  // Convert the primary file to a base64 data URL so it actually survives
  // the postMessage to the parent window (see _fileToDataUrl comment above).
  const primaryFileRef = perFileData.length ? perFileData[0].fileRef : null;
  const fileDataUrl = await _fileToDataUrl(primaryFileRef);

  try {
    window.parent.postMessage({
      type: 'PERFIOS_COMPLETE',
      data: {
        valid:           span >= 90 && staledays <= 7,
        fileObjUrl:      perFileData.length && perFileData[0].fileRef ? URL.createObjectURL(perFileData[0].fileRef) : '',
        fileDataUrl,
        fileName:        perFileData.length ? perFileData[0].fileName : '',
        span, staledays,
        firstDate:       fl ? fmtDate(fl) : '—',
        lastDate:        ll ? fmtDate(ll) : '—',
        abb:             abbVal,
        totalTxns:       (filtered90||[]).length,
        salary:          salaryTxns  || [],
        hasSalary:       (salaryTxns||[]).length > 0,
        achTxns,  ecsTxns, neftTxns, upiTxns, chequeTxns,
        ach:       achTxns, upi: upiTxns, ecs: ecsTxns,
        neft:      neftTxns, cheque: chequeTxns,
        bounces:         bounceTxns  || [],
        overdraftEvents: overdraftTxns || [],
        hasBounces:      (bounceTxns||[]).length > 0,
        validChecks:     validChecks || [],
        accountInfo,
        openingBalance:  openBal,
        perFileData,
        docFiles:        _docFiles,
        transactions:    filtered90 || [],
        txns90:          filtered90 || [],
        targetRows:      targetRows || [],
        abbData, monthOrder,
        processLog:      _processLog,
        staleAttempts:        window._pfLastTxnAttempts || 0,
        manualReviewRequired: !!window._pfManualReviewRequired,
      }
    }, '*');
  } catch(e) {}
}

// ── _renderDocs ──
function _fmtSize(b) {
  if (!b) return '—';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
  return (b/1048576).toFixed(2) + ' MB';
}
function _renderDocs() {
  const list  = document.getElementById('docList');
  const count = document.getElementById('docCount');
  if (!list) return;
  if (count) count.textContent = _docFiles.length + ' file' + (_docFiles.length !== 1 ? 's' : '');
  if (!_docFiles.length) {
    list.innerHTML = '<div class="doc-empty">No documents attached yet</div>';
    return;
  }
  list.innerHTML = _docFiles.map(d => {
    const iconClass = d.isProtected ? 'protected' : (d.validated ? 'verified' : 'normal');
    const icon      = d.isProtected ? '🔓' : '📄';
    const badges    = [];
    if (d.validated)   badges.push('<span class="badge badge-green">✓ VERIFIED</span>');
    if (d.isProtected) badges.push('<span class="badge badge-amber">🔒 PASSWORD</span>');
    if (d.hasSalary)   badges.push('<span class="badge badge-blue">💰 SALARY</span>');
    if (d.span >= 90)  badges.push('<span class="badge badge-green">90D ✓</span>');
    else if (d.span > 0) badges.push('<span class="badge badge-red">SPAN: ' + d.span + 'D</span>');
    const ts = d.attachedAt
      ? new Date(d.attachedAt).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})
      : '—';
    return '<div class="doc-row">' +
      '<div class="doc-row-icon ' + iconClass + '">' + icon + '</div>' +
      '<div class="doc-row-info">' +
        '<div class="doc-row-name">' + d.fileName + '</div>' +
        '<div class="doc-row-meta">' + _fmtSize(d.fileSize) + ' · ' + (d.txnCount||0) + ' txns · ' + ts +
          (d.isProtected && d.pdfPassword ? ' · 🔑 Pwd saved' : '') + '</div>' +
      '</div>' +
      '<div class="doc-row-badges">' + badges.join('') + '</div>' +
      '</div>';
  }).join('');
}

// ── Override resetAll ──
resetAll = function() {
  _origResetAll();
  _docFiles    = [];
  _processLog  = [];
  const uz = document.getElementById('uploadZone');
  if (uz) uz.style.display = '';
  _renderDocs();
  ['docSection','validationSection','confirmBar','resetBar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('show');
  });
  const vg = document.getElementById('validationGrid');
  if (vg) vg.innerHTML = '';
  // Restore the upload zone's default (non-retry) copy
  const _uzH2 = document.querySelector('#uploadZone h2');
  const _uzP  = document.querySelector('#uploadZone p');
  if (_uzH2) _uzH2.textContent = 'Drop Bank Statement PDF';
  if (_uzP)  _uzP.innerHTML = 'Supports 45+ banks · password-protected &amp; plain PDFs · multiple files<br>90-day span check · staleness check · salary, bounce &amp; overdraft detection';
};

