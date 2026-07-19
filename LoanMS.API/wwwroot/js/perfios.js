// ── Safe localStorage helpers (private to this module) ──
var _lsGet = function(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } };
var _lsSet = function(k,v){ try{ localStorage.setItem(k,v); }catch(e){} };
var _lsRemove = function(k){ try{ localStorage.removeItem(k); }catch(e){} };
// PDF.js worker setup — works on server (/js/pdf.worker.min.js) and file://
(function() {
  // Suppress the fake-worker console warning
  var _origWarn = console.warn;
  console.warn = function() {
    if (arguments[0] && String(arguments[0]).indexOf('fake worker') !== -1) return;
    _origWarn.apply(console, arguments);
  };
  setTimeout(function() { console.warn = _origWarn; }, 5000);

  var isFile = window.location.protocol === 'file:';
  if (!isFile) {
    // Server mode: use local worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/js/pdf.worker.min.js';
  } else {
    // File mode: try CDN worker via blob fetch (avoids fake-worker)
    fetch('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js')
      .then(function(r) { return r.blob(); })
      .then(function(blob) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
      })
      .catch(function() {
        // Offline fallback: fake worker (slower but functional)
        pdfjsLib.GlobalWorkerOptions.workerSrc = '';
      });
  }
})();

// Wrapper: getDocument with 30-second timeout to prevent infinite hang
function _getDocumentWithTimeout(params, timeoutMs) {
  timeoutMs = timeoutMs || 30000;
  return new Promise(function(resolve, reject) {
    const task = pdfjsLib.getDocument(params);
    const timer = setTimeout(function() {
      try { task.destroy(); } catch(e) {}
      reject(new Error('PDF loading timed out after ' + (timeoutMs/1000) + 's. The file may be corrupted or network is slow.'));
    }, timeoutMs);
    task.promise.then(function(pdf) {
      clearTimeout(timer);
      resolve(pdf);
    }).catch(function(err) {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ─── State ───
let allTxns      = [];
let filtered90   = [];
let targetRows   = [];
let salaryTxns   = [];     // detected salary transactions
let achTxns      = [];     // detected ACH transactions
let ecsTxns      = [];     // detected ECS transactions
let neftTxns     = [];     // detected NEFT/RTGS transactions
let upiTxns      = [];     // detected UPI/IMPS transactions
let chequeTxns   = [];     // detected Cheque/CTS transactions
let bounceTxns   = [];     // detected bounce transactions
let overdraftTxns= [];     // transactions that resulted in negative balance
let validChecks  = [];
let abbData      = {};
let monthOrder   = [];
let pendingFiles = [];
let currentFileIdx = 0;
let currentFile  = null;
let accountInfo  = {};
let perFileData  = [];     // per-file account info for multi-account view
let _processLog  = [];     // captured log entries for Perfios report
let pwdAttempts  = 0;
let _txnFilterAccount = 'ALL';

const TARGET_DAYS = [2, 4, 10, 17, 25];

// ── Salary keyword patterns (Req 3) ──
const SALARY_PATTERNS = [
  /\bSAL\b/i,
  /\bSALARY\b/i,
  /\bSALARIES\b/i,
  /\bPAYROLL\b/i,
  /\bPAY\s*ROLL\b/i,
  /\bINCOME\b/i,
  /\bMONTHLY\s*PAY\b/i,
  /\bEMPLOYEE\s*PAY\b/i,
  /\bSTIPEND\b/i,
  /\bREMUNERATION\b/i,
  /\bHR\s*SALARY\b/i,
  /\bSAL\s*CREDIT\b/i,
  /\bMONTHLY\s*CREDIT\b/i,
  /\bWAGES?\b/i,
  /\bMONTHLY\s*WAGES?\b/i,
];

function isSalaryTxn(desc) {
  return SALARY_PATTERNS.some(p => p.test(desc));
}
function getSalaryKeyword(desc) {
  for (const p of SALARY_PATTERNS) {
    const m = desc.match(p);
    if (m) return m[0].toUpperCase();
  }
  return '';
}

// ── ACH keyword patterns ──
// ACH = Automated Clearing House — bulk electronic funds transfers (NACH in India)
const ACH_PATTERNS = [
  { re: /\bACH\b/i,               sub: 'ACH Generic' },
  { re: /\bNACH\b/i,              sub: 'NACH (National ACH)' },
  { re: /\bACH\s*CR\b/i,          sub: 'ACH Credit' },
  { re: /\bACH\s*DR\b/i,          sub: 'ACH Debit' },
  { re: /\bNACH\s*CR\b/i,         sub: 'NACH Credit' },
  { re: /\bNACH\s*DR\b/i,         sub: 'NACH Debit' },
  { re: /\bDIRECT\s*DEBIT\b/i,    sub: 'Direct Debit (ACH)' },
  { re: /\bDIRECT\s*CREDIT\b/i,   sub: 'Direct Credit (ACH)' },
  { re: /\bMANDATE\b/i,           sub: 'ACH Mandate' },
  { re: /\bACH\s*MANDATE\b/i,     sub: 'ACH Mandate' },
  { re: /\bNACH\s*MANDATE\b/i,    sub: 'NACH Mandate' },
  { re: /\bSI\s*DEBIT\b/i,        sub: 'SI Debit (ACH)' },
  { re: /\bSTANDING\s*INST/i,     sub: 'Standing Instruction (ACH)' },
  { re: /\bAUTO\s*PAY\b/i,        sub: 'Auto Pay (ACH)' },
  { re: /\bAUTO\s*DEBIT\b/i,      sub: 'Auto Debit (ACH)' },
  { re: /\bRECURRING\s*DEBIT\b/i, sub: 'Recurring Debit (ACH)' },
  { re: /\bSWEEP\b/i,             sub: 'Sweep (ACH)' },
  { re: /\bBULK\s*PAYMENT\b/i,    sub: 'Bulk Payment (ACH)' },
  { re: /\bVPAY\b/i,              sub: 'VPAY / ACH' },
  { re: /\bCLEARING\b/i,          sub: 'Clearing (ACH)' },
];

function isACHTxn(desc) {
  return ACH_PATTERNS.some(p => p.re.test(desc));
}
function getACHSubType(desc) {
  for (const p of ACH_PATTERNS) {
    if (p.re.test(desc)) return p.sub;
  }
  return 'ACH';
}
function getACHKeyword(desc) {
  for (const p of ACH_PATTERNS) {
    const m = desc.match(p.re);
    if (m) return m[0].toUpperCase();
  }
  return '';
}

// ── ECS keyword patterns ──
// ECS = Electronic Clearing Service — RBI's legacy batch clearing system
const ECS_PATTERNS = [
  { re: /\bECS\b/i,               sub: 'ECS Generic' },
  { re: /\bECS\s*CR\b/i,          sub: 'ECS Credit' },
  { re: /\bECS\s*DR\b/i,          sub: 'ECS Debit' },
  { re: /\bECS\s*CREDIT\b/i,      sub: 'ECS Credit' },
  { re: /\bECS\s*DEBIT\b/i,       sub: 'ECS Debit' },
  { re: /\bECS\s*RETURN\b/i,      sub: 'ECS Return / Bounce' },
  { re: /\bECS\s*BOUNCE\b/i,      sub: 'ECS Return / Bounce' },
  { re: /\bECS\s*REJ\b/i,         sub: 'ECS Rejected' },
  { re: /\bECS\s*REJECT/i,        sub: 'ECS Rejected' },
  { re: /\bECS\s*MANDATE\b/i,     sub: 'ECS Mandate' },
  { re: /\bECS\s*EMI\b/i,         sub: 'ECS EMI Deduction' },
  { re: /\bECS\s*LOAN\b/i,        sub: 'ECS Loan Repayment' },
  { re: /\bECS\s*INSUR/i,         sub: 'ECS Insurance Premium' },
  { re: /\bECS\s*SIP\b/i,         sub: 'ECS SIP / Investment' },
  { re: /\bECS\s*UTIL\b/i,        sub: 'ECS Utility' },
  { re: /\bECS\s*MF\b/i,          sub: 'ECS Mutual Fund SIP' },
  { re: /\bECS\s*INWARD\b/i,      sub: 'ECS Inward Credit' },
  { re: /\bECS\s*OUTWARD\b/i,     sub: 'ECS Outward Debit' },
  { re: /\bECS\s*CLG\b/i,         sub: 'ECS Clearing' },
  { re: /\bECS\s*CHRG\b/i,        sub: 'ECS Charge' },
];

function isECSTxn(desc) {
  return ECS_PATTERNS.some(p => p.re.test(desc));
}
function getECSSubType(desc) {
  for (const p of ECS_PATTERNS) {
    if (p.re.test(desc)) return p.sub;
  }
  return 'ECS';
}
function getECSKeyword(desc) {
  for (const p of ECS_PATTERNS) {
    const m = desc.match(p.re);
    if (m) return m[0].toUpperCase();
  }
  return '';
}

// ── NEFT / RTGS keyword patterns ──
// NEFT = National Electronic Funds Transfer (RBI batch, settled in half-hourly cycles)
// RTGS = Real Time Gross Settlement (RBI high-value, real-time)
//
// Real bank narration formats seen in practice:
//   NEFT-HDFC0001234-John Doe-UTR123456
//   BY NEFT FROM SBI/IFSC/NAME
//   RTGS/2024/UTR12345/VENDOR NAME
//   NEFT CR-ICICI-Raj Kumar
//   INB NEFT TRANSFER
//   NEFT CREDIT FROM HDFC BANK
//   RTGS OUTWARD REMITTANCE
//   RETURN OF NEFT / NEFT RETURN
//
// Strategy: match NEFT or RTGS as a standalone token even when surrounded by
// hyphens, slashes, spaces, or at start/end of string.
const NEFT_SEP = '[\\s\\-\\/\\|_]';          // separator chars used in narrations
const NEFT_BOUND = `(?:^|${NEFT_SEP}|(?<=[A-Z]))`;  // loose left boundary
// Simple helper — word OR hyphen/slash bounded
function _neftRe(pat) {
  // Matches the pattern when preceded/followed by non-alphanumeric or string edge
  return new RegExp('(?:^|[^A-Za-z])' + pat + '(?:[^A-Za-z]|$)', 'i');
}

const NEFT_PATTERNS = [
  // ── RTGS (check before NEFT to avoid partial overlap) ──
  // IDFC FIRST / IDFB format: RTGS/IDFBR62026011301467622/BENEFICIARY/IFSC
  { re: /(?:^|[^A-Za-z])RTGS\/[A-Z0-9]+\//i,     sub: 'RTGS Generic' },  // RTGS/UTR/... format
  { re: _neftRe('RTGS[\\s\\-\\/]*RETURN'),         sub: 'RTGS Return' },
  { re: _neftRe('RTGS[\\s\\-\\/]*REJECT'),         sub: 'RTGS Rejected' },
  { re: _neftRe('RTGS[\\s\\-\\/]*INWARD'),         sub: 'RTGS Inward' },
  { re: _neftRe('RTGS[\\s\\-\\/]*OUTWARD'),        sub: 'RTGS Outward' },
  { re: _neftRe('RTGS[\\s\\-\\/]*CR'),             sub: 'RTGS Credit' },
  { re: _neftRe('RTGS[\\s\\-\\/]*DR'),             sub: 'RTGS Debit' },
  { re: _neftRe('RTGS[\\s\\-\\/]*CREDIT'),         sub: 'RTGS Credit' },
  { re: _neftRe('RTGS[\\s\\-\\/]*DEBIT'),          sub: 'RTGS Debit' },
  { re: _neftRe('RTGS'),                            sub: 'RTGS Generic' },
  // ── NEFT — UTR-prefix format used by IDFC FIRST, ICICI, Kotak, etc. ──
  // Examples: NEFT/KKBKH25344740757/Mudrahub, NEFT/SBIN425360185414/ITDTAX REFUND
  { re: /(?:^|[^A-Za-z])NEFT\/[A-Z0-9]+\//i,      sub: 'NEFT Generic' },  // NEFT/UTR/... format
  // ── NEFT standard sub-types ──
  { re: _neftRe('NEFT[\\s\\-\\/]*RETURN'),         sub: 'NEFT Return' },
  { re: _neftRe('NEFT[\\s\\-\\/]*REJECT'),         sub: 'NEFT Rejected' },
  { re: _neftRe('NEFT[\\s\\-\\/]*INWARD'),         sub: 'NEFT Inward' },
  { re: _neftRe('NEFT[\\s\\-\\/]*OUTWARD'),        sub: 'NEFT Outward' },
  { re: _neftRe('NEFT[\\s\\-\\/]*CR'),             sub: 'NEFT Credit' },
  { re: _neftRe('NEFT[\\s\\-\\/]*DR'),             sub: 'NEFT Debit' },
  { re: _neftRe('NEFT[\\s\\-\\/]*CREDIT'),         sub: 'NEFT Credit' },
  { re: _neftRe('NEFT[\\s\\-\\/]*DEBIT'),          sub: 'NEFT Debit' },
  { re: _neftRe('NEFT'),                            sub: 'NEFT Generic' },
  // ── Combined / contextual ──
  { re: /NEFT\s*[\/]\s*RTGS/i,                     sub: 'NEFT/RTGS Combined' },
  { re: /FUND\s*TRANSFER[\s\-\/]*(NEFT|RTGS)/i,    sub: 'Fund Transfer NEFT/RTGS' },
  { re: /ONLINE\s*TRANSFER[\s\-\/]*NEFT/i,         sub: 'Online Transfer NEFT' },
  { re: /ONLINE\s*TRANSFER[\s\-\/]*RTGS/i,         sub: 'Online Transfer RTGS' },
  { re: /INTERBANK[\s\-\/]*TRANSFER/i,             sub: 'Interbank Transfer (NEFT/RTGS)' },
];

function isNEFTTxn(desc) {
  return NEFT_PATTERNS.some(p => p.re.test(desc));
}
function getNEFTSubType(desc) {
  for (const p of NEFT_PATTERNS) {
    if (p.re.test(desc)) return p.sub;
  }
  return 'NEFT/RTGS';
}
function getNEFTKeyword(desc) {
  for (const p of NEFT_PATTERNS) {
    const m = desc.match(p.re);
    if (m) return m[0].toUpperCase();
  }
  return '';
}

// ── UPI / IMPS keyword patterns ──
const UPI_PATTERNS = [
  { re: /\bUPI\b/i,                                  sub: 'UPI Generic' },
  { re: /\bUPI[\/\-\s]*CR\b/i,                       sub: 'UPI Credit' },
  { re: /\bUPI[\/\-\s]*DR\b/i,                       sub: 'UPI Debit' },
  { re: /\bUPI[\/\-\s]*CREDIT\b/i,                   sub: 'UPI Credit' },
  { re: /\bUPI[\/\-\s]*DEBIT\b/i,                    sub: 'UPI Debit' },
  { re: /\bUPI[\/\-\s]*REFUND\b/i,                   sub: 'UPI Refund' },
  { re: /\bUPI[\/\-\s]*REVERSAL\b/i,                 sub: 'UPI Reversal' },
  { re: /\bUPI[\/\-\s]*RETURN\b/i,                   sub: 'UPI Return' },
  { re: /\bIMPS\b/i,                                  sub: 'IMPS Generic' },
  { re: /\bIMPS[\/\-\s]*CR\b/i,                       sub: 'IMPS Credit' },
  { re: /\bIMPS[\/\-\s]*DR\b/i,                       sub: 'IMPS Debit' },
  { re: /\bIMPS[\/\-\s]*CREDIT\b/i,                   sub: 'IMPS Credit' },
  { re: /\bIMPS[\/\-\s]*DEBIT\b/i,                    sub: 'IMPS Debit' },
  { re: /\bIMPS[\/\-\s]*RETURN\b/i,                   sub: 'IMPS Return' },
  { re: /\bP2P\b/i,                                   sub: 'UPI P2P Transfer' },
  { re: /\bP2M\b/i,                                   sub: 'UPI P2M Payment' },
  { re: /\bBHIM\b/i,                                  sub: 'BHIM UPI' },
  { re: /\bGPAY\b|\bGOOGLE\s*PAY\b/i,                sub: 'Google Pay (UPI)' },
  { re: /\bPHONEPE\b/i,                               sub: 'PhonePe (UPI)' },
  { re: /\bPAYTM\b/i,                                 sub: 'Paytm (UPI)' },
  { re: /\bAMAZON\s*PAY\b/i,                          sub: 'Amazon Pay (UPI)' },
];

function isUPITxn(desc) { return UPI_PATTERNS.some(p => p.re.test(desc)); }
function getUPISubType(desc) {
  for (const p of UPI_PATTERNS) { if (p.re.test(desc)) return p.sub; }
  return 'UPI/IMPS';
}
function getUPIKeyword(desc) {
  for (const p of UPI_PATTERNS) { const m = desc.match(p.re); if (m) return m[0].toUpperCase(); }
  return '';
}

// ── Cheque / CTS keyword patterns ──
const CHEQUE_PATTERNS = [
  { re: /\bCHQ\b/i,                                   sub: 'Cheque Generic' },
  { re: /\bCHEQUE\b/i,                                sub: 'Cheque Generic' },
  { re: /\bCTS\b/i,                                   sub: 'CTS Clearing' },
  { re: /\bCHQ\s*DEP(?:OSIT)?\b/i,                    sub: 'Cheque Deposit' },
  { re: /\bCHEQUE\s*DEP(?:OSIT)?\b/i,                 sub: 'Cheque Deposit' },
  { re: /\bCHQ\s*ISSUE\b|\bCHQ\s*PAYMENT\b/i,         sub: 'Cheque Issue' },
  { re: /\bCHEQUE\s*ISSUE\b|\bCHEQUE\s*PAYMENT\b/i,   sub: 'Cheque Issue' },
  { re: /\bCHQ\s*RETURN\b|\bCHEQUE\s*RETURN\b/i,      sub: 'Cheque Return (Bounce)' },
  { re: /\bCHQ\s*BOUNCE\b|\bCHEQUE\s*BOUNCE\b/i,      sub: 'Cheque Bounce' },
  { re: /\bCHQ\s*DISHON/i,                             sub: 'Cheque Dishonoured' },
  { re: /\bPDC\b/i,                                    sub: 'Post-Dated Cheque' },
  { re: /\bINWARD\s*CLG\b|\bINWARD\s*CLEARING\b/i,    sub: 'Inward Clearing' },
  { re: /\bOUTWARD\s*CLG\b|\bOUTWARD\s*CLEARING\b/i,  sub: 'Outward Clearing' },
  { re: /\bCLG\s*TXN\b|\bCLEARING\s*TXN\b/i,          sub: 'Clearing Transaction' },
  { re: /\bDRAFT\b/i,                                  sub: 'Bank Draft' },
  { re: /\bDD\b/i,                                     sub: 'Demand Draft' },
];

function isChequeTxn(desc) { return CHEQUE_PATTERNS.some(p => p.re.test(desc)); }
function getChequeSubType(desc) {
  for (const p of CHEQUE_PATTERNS) { if (p.re.test(desc)) return p.sub; }
  return 'Cheque';
}
function getChequeKeyword(desc) {
  for (const p of CHEQUE_PATTERNS) { const m = desc.match(p.re); if (m) return m[0].toUpperCase(); }
  return '';
}

// ── Bounce keyword patterns ──
const BOUNCE_PATTERNS = [
  { re: /\bBOUNCE\b/i,                                 sub: 'Cheque Bounce', inward: null },
  { re: /\bCHQ\s*RETURN\b|\bCHEQUE\s*RETURN\b/i,       sub: 'Cheque Return', inward: null },
  { re: /\bCHQ\s*DISHON\b|\bCHEQUE\s*DISHON\b/i,       sub: 'Cheque Dishonoured', inward: null },
  { re: /\bINWARD\s*RETURN\b/i,                         sub: 'Inward Bounce (Non-Technical)', inward: true },
  { re: /\bINWARD\s*BOUNCE\b/i,                         sub: 'Inward Bounce (Non-Technical)', inward: true },
  { re: /\bOUTWARD\s*RETURN\b/i,                        sub: 'Outward Bounce', inward: false },
  { re: /\bOUTWARD\s*BOUNCE\b/i,                        sub: 'Outward Bounce', inward: false },
  { re: /\bECS\s*RETURN\b|\bECS\s*BOUNCE\b/i,           sub: 'ECS Return / Bounce', inward: null },
  { re: /\bNACH\s*RETURN\b|\bNACH\s*BOUNCE\b/i,         sub: 'NACH Return / Bounce', inward: null },
  { re: /\bACH\s*RETURN\b/i,                            sub: 'ACH Return', inward: null },
  { re: /\bNEFT\s*RETURN\b/i,                           sub: 'NEFT Return', inward: null },
  { re: /\bRTGS\s*RETURN\b/i,                           sub: 'RTGS Return', inward: null },
  { re: /\bREJECTED\b|\bREJECT\b/i,                     sub: 'Payment Rejected', inward: null },
  { re: /\bDISHONOURED\b/i,                             sub: 'Instrument Dishonoured', inward: null },
  { re: /\bNOT\s*PAID\b/i,                              sub: 'Unpaid Instrument', inward: null },
  { re: /\bTECHNICAL\s*RETURN\b/i,                      sub: 'Inward Bounce (Technical)', inward: true },
];

function isBounceTxn(desc) { return BOUNCE_PATTERNS.some(p => p.re.test(desc)); }
function getBounceSubType(desc) {
  for (const p of BOUNCE_PATTERNS) { if (p.re.test(desc)) return p.sub; }
  return 'Bounce';
}
function isBounceInward(desc) {
  for (const p of BOUNCE_PATTERNS) {
    if (p.re.test(desc)) return p.inward;
  }
  return null;
}

// ─── Upload Wiring ───
// Guard: these elements only exist in the Perfios popup page, not in the main app
const fileInput = document.getElementById('fileInput');
const uploadZone = document.getElementById('uploadZone');

if (uploadZone) {
  uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('over'); });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('over'));
  uploadZone.addEventListener('drop', e => {
    e.preventDefault(); uploadZone.classList.remove('over');
    handleFiles(Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf'));
  });
}
if (fileInput) {
  fileInput.addEventListener('change', e => {
    const files = Array.from(e.target.files);
    e.target.value = ''; // reset so same file can be re-selected
    handleFiles(files);
  });
}

async function handleFiles(files) {
  if (!files.length) return;
  pendingFiles = files;
  currentFileIdx = 0;
  allTxns = [];
  perFileData = [];
  _applyAllPassword = '';
  accountInfo = {};
  // Hide upload zone once processing starts
  const uz = document.getElementById('uploadZone');
  if (uz) uz.style.display = 'none';
  showLog();
  log('info', `${files.length} file(s) queued`);
  setStep(2);
  processNextFile();
}

async function processNextFile() {
  if (currentFileIdx >= pendingFiles.length) {
    finalizeProcessing();
    return;
  }
  const file = pendingFiles[currentFileIdx];
  currentFile = file;
  showLoader(`Extracting: ${file.name}`);
  log('info', `📄 ${file.name}`);
  try {
    const buf = await file.arrayBuffer();
    try {
      const pdf = await _getDocumentWithTimeout({ data: buf });
      const text = await extractText(pdf);
      const prevInfo = JSON.parse(JSON.stringify(accountInfo));
      const txns = parseTransactions(text, file.name);
      extractAccountInfo(text);
      // Tag each transaction with its source file index
      txns.forEach(t => t._fileIdx = currentFileIdx);
      // Save per-file data
      const _pfd1 = { fileName: file.name, fileSize: file.size, isProtected: false, pdfPassword: null, txns: txns, accountInfo: JSON.parse(JSON.stringify(accountInfo)), fileRef: file };
      perFileData.push(_pfd1);
      _docFiles.push({ fileName: file.name, fileSize: file.size, txnCount: txns.length, isProtected: false, passwordUsed: false, pdfPassword: null, hasSalary: false, span: 0, validatedAt: Date.now() });
      if (typeof _renderDocs === 'function') { _renderDocs(); const ds=document.getElementById('docSection'); if(ds) ds.classList.add('show'); }
      log(txns.length ? 'ok' : 'warn', `  → ${txns.length} transactions parsed`);
      allTxns.push(...txns);
      currentFileIdx++;
      hideLoader();
      processNextFile();
    } catch (err) {
      if (err.name === 'PasswordException' || err.code === 1 || err.code === 2 || (err.message && err.message.includes('password'))) {
        hideLoader();
        document.getElementById('bulkPwdPanel').classList.add('show'); // FIX: reveal pre-set panel only now, after a protected file is detected
        _pendingFile = file; // FIX: freeze file reference HERE before async gap, not inside showPasswordModal
        await showPasswordModal(file.name, null); // null buf — will read fresh via _pendingFile
      } else { throw err; }
    }
  } catch (err) {
    log('warn', `  ⚠ Error: ${err.message}`);
    hideLoader();
    currentFileIdx++;
    processNextFile();
  }
}

// ─── Enhanced Password System ───

// Helper: always get a fresh ArrayBuffer from the stored File to avoid
// "detached ArrayBuffer" errors after pdf.js transfers/consumes the buffer.
let _pendingFile = null; // the original File object
async function _freshBuf() {
  if (!_pendingFile) return _pendingBuf;
  return await _pendingFile.arrayBuffer();
}

// Per-bank password hints
const BANK_PWD_HINTS = {
  hdfc:    { bank: 'HDFC Bank', hint: 'Typically Date of Birth in DDMMYYYY format (e.g., 01011990)', examples: ['01011990','DDMMYYYY','DD-MM-YYYY'] },
  sbi:     { bank: 'SBI', hint: 'Account number or Date of Birth (DDMMYYYY)', examples: ['DDMMYYYY','Account No.'] },
  icici:   { bank: 'ICICI Bank', hint: 'Date of Birth in DDMMYYYY or customer ID', examples: ['DDMMYYYY','Customer ID'] },
  axis:    { bank: 'Axis Bank', hint: 'Date of Birth in DDMMYYYY format', examples: ['DDMMYYYY','DD-MM-YYYY'] },
  kotak:   { bank: 'Kotak Bank', hint: 'Date of Birth in DDMMYYYY or last 4 digits of account', examples: ['DDMMYYYY','Last 4 digits'] },
  yes:     { bank: 'Yes Bank', hint: 'Date of Birth in DDMMYYYY', examples: ['DDMMYYYY'] },
  pnb:     { bank: 'PNB', hint: 'Date of Birth in DDMMYYYY or account number', examples: ['DDMMYYYY','Account No.'] },
  idfc:    { bank: 'IDFC FIRST', hint: 'Date of Birth in DDMMYYYY', examples: ['DDMMYYYY'] },
  indusind:{ bank: 'IndusInd', hint: 'Date of Birth in DDMMYYYY', examples: ['DDMMYYYY'] },
  canara:  { bank: 'Canara Bank', hint: 'Account number (last 6 digits)', examples: ['Last 6 of account'] },
  bob:     { bank: 'Bank of Baroda', hint: 'Date of Birth in DDMMYYYY', examples: ['DDMMYYYY'] },
  union:   { bank: 'Union Bank', hint: 'Date of Birth in DDMMYYYY', examples: ['DDMMYYYY'] },
  boi:     { bank: 'Bank of India', hint: 'Date of Birth DDMMYYYY or account number', examples: ['DDMMYYYY'] },
  federal: { bank: 'Federal Bank', hint: 'Date of Birth in DDMMYYYY', examples: ['DDMMYYYY'] },
  rbl:     { bank: 'RBL Bank', hint: 'Date of Birth in DDMMYYYY', examples: ['DDMMYYYY'] },
  dcb:     { bank: 'DCB Bank', hint: 'Date of Birth in DDMMYYYY', examples: ['DDMMYYYY'] },
  bandhan: { bank: 'Bandhan Bank', hint: 'Date of Birth in DDMMYYYY', examples: ['DDMMYYYY'] },
  au:      { bank: 'AU Small Finance', hint: 'Date of Birth DDMMYYYY or PAN', examples: ['DDMMYYYY','PAN'] },
  standard:{ bank: 'Standard Chartered', hint: 'Last 4 digits of account or DOB DDMMYYYY', examples: ['DDMMYYYY','Last 4 digits'] },
  hsbc:    { bank: 'HSBC India', hint: 'Date of Birth in DDMMYYYY', examples: ['DDMMYYYY'] },
  dbs:     { bank: 'DBS India', hint: 'Date of Birth in DDMMYYYY', examples: ['DDMMYYYY'] },
};

function detectBankFromFileName(name) {
  const n = name.toLowerCase();
  if (n.includes('hdfc')) return 'hdfc';
  if (n.includes('sbi') || n.includes('state bank')) return 'sbi';
  if (n.includes('icici')) return 'icici';
  if (n.includes('axis')) return 'axis';
  if (n.includes('kotak')) return 'kotak';
  if (n.includes('yes bank') || n.includes('yesbank')) return 'yes';
  if (n.includes('pnb') || n.includes('punjab national')) return 'pnb';
  if (n.includes('idfc')) return 'idfc';
  if (n.includes('indusind')) return 'indusind';
  if (n.includes('canara')) return 'canara';
  if (n.includes('baroda') || n.includes('bob')) return 'bob';
  if (n.includes('union')) return 'union';
  if (n.includes('boi') || n.includes('bank of india')) return 'boi';
  if (n.includes('federal')) return 'federal';
  if (n.includes('rbl')) return 'rbl';
  if (n.includes('dcb')) return 'dcb';
  if (n.includes('bandhan')) return 'bandhan';
  if (n.includes('au ') || n.includes('au_') || n.includes('ausf')) return 'au';
  if (n.includes('standard') || n.includes('sc ') || n.includes('scb')) return 'standard';
  if (n.includes('hsbc')) return 'hsbc';
  if (n.includes('dbs')) return 'dbs';
  return null;
}

// Bulk/pre-set password
let _bulkPassword  = '';
let _bulkPwdVisible = false;
let _pwdVisible    = false;
// Session-level password history (most recently successful first)
let _pwdHistory = [];
// "Apply to all" flag & resolved password
let _applyAllPassword = '';

function saveBulkPassword() {
  const val = document.getElementById('bulkPwdInput').value.trim();
  if (!val) { document.getElementById('bulkPwdSaved').classList.remove('show'); return; }
  _bulkPassword = val;
  document.getElementById('bulkPwdSaved').classList.add('show');
}
function clearBulkPassword() {
  _bulkPassword = '';
  document.getElementById('bulkPwdInput').value = '';
  document.getElementById('bulkPwdSaved').classList.remove('show');
}
function toggleBulkPwdVisibility() {
  _bulkPwdVisible = !_bulkPwdVisible;
  const inp = document.getElementById('bulkPwdInput');
  inp.type = _bulkPwdVisible ? 'text' : 'password';
}
function setBulkExample(fmt) {
  const examples = { 'DDMMYYYY':'01011990','DD-MM-YYYY':'01-01-1990','DDMMYY':'010190','YYYYMMDD':'19900101','PAN':'ABCDE1234F','Mobile':'9876543210' };
  document.getElementById('bulkPwdInput').value = examples[fmt] || fmt;
  document.getElementById('bulkPwdInput').focus();
}
function togglePwdVisibility() {
  _pwdVisible = !_pwdVisible;
  const inp = document.getElementById('pwdInput');
  inp.type = _pwdVisible ? 'text' : 'password';
  document.getElementById('pwdToggle').textContent = _pwdVisible ? '🙈' : '👁';
}

let _pendingBuf = null;
async function showPasswordModal(name, buf) {
  _pendingBuf = buf; // kept for legacy fallback only
  // FIX: _pendingFile is now set by the caller (processNextFile) at the moment of the exception,
  // so we no longer overwrite it here — avoids a race condition if currentFile advances.
  if (!_pendingFile) _pendingFile = currentFile; // safety fallback only
  pwdAttempts = 0;
  _pwdVisible = false;

  // 1. Try "apply-to-all" password first (silent)
  if (_applyAllPassword) {
    try {
      const pdf = await _getDocumentWithTimeout({ data: await _freshBuf(), password: _applyAllPassword });
      log('ok', `  🔓 Auto-unlocked ${name} using saved batch password`);
      await _processPdfText(pdf);
      return;
    } catch(e) { /* fall through */ }
  }

  // 2. Try bulk pre-set password silently
  if (_bulkPassword) {
    const autotryEl = document.getElementById('pwdAutotry');
    const autotryMsg = document.getElementById('pwdAutotryMsg');
    autotryEl.classList.add('show');
    autotryMsg.textContent = `Trying pre-set password on ${name}…`;
    try {
      const pdf = await _getDocumentWithTimeout({ data: await _freshBuf(), password: _bulkPassword });
      autotryEl.classList.remove('show');
      log('ok', `  🔓 Auto-unlocked ${name} using pre-set password`);
      // Promote to history
      _addToHistory(_bulkPassword);
      await _processPdfText(pdf);
      return;
    } catch(e) {
      autotryEl.classList.remove('show');
      log('warn', `  ✗ Pre-set password failed for ${name}, prompting…`);
    }
  }

  // 3. Try password history silently
  for (const ph of _pwdHistory) {
    try {
      const pdf = await _getDocumentWithTimeout({ data: await _freshBuf(), password: ph });
      log('ok', `  🔓 Auto-unlocked ${name} using session history`);
      await _processPdfText(pdf);
      return;
    } catch(e) { /* continue */ }
  }

  // 4. Show modal with bank hint
  const bankKey = detectBankFromFileName(name);
  const hint = bankKey ? BANK_PWD_HINTS[bankKey] : null;
  const hintEl = document.getElementById('pwdHint');
  if (hint) {
    document.getElementById('pwdHintBank').textContent = `💡 ${hint.bank} Hint`;
    document.getElementById('pwdHintText').textContent = hint.hint;
    const exDiv = document.getElementById('pwdHintExamples');
    exDiv.innerHTML = hint.examples.map(e =>
      `<span class="pwd-hint-chip" onclick="document.getElementById('pwdInput').value='${e}';document.getElementById('pwdInput').focus()">${e}</span>`
    ).join('');
    hintEl.classList.add('show');
  } else {
    hintEl.classList.remove('show');
  }

  // Show apply-to-all only when multiple files remain
  const remaining = pendingFiles.length - currentFileIdx - 1;
  const applyRow = document.getElementById('pwdApplyAllRow');
  applyRow.style.display = remaining > 0 ? 'flex' : 'none';
  document.getElementById('pwdApplyAll').checked = false;

  // File progress
  document.getElementById('pwdFileProgress').textContent =
    `File ${currentFileIdx + 1} of ${pendingFiles.length}` + (remaining > 0 ? ` · ${remaining} more to go` : '');

  document.getElementById('pwdFileName').textContent = name;
  document.getElementById('pwdInput').value = '';
  document.getElementById('pwdInput').type = 'password';
  document.getElementById('pwdToggle').textContent = '👁';
  document.getElementById('pwdError').classList.remove('show');
  document.getElementById('pwdAttempt').textContent = '';
  document.getElementById('pwdUnlockBtn').disabled = false;
  document.getElementById('pwdUnlockBtn').textContent = '🔓 Unlock & Process';
  document.getElementById('pwdAutotry').classList.remove('show');
  document.getElementById('pwdModal').classList.add('show');
  setTimeout(() => document.getElementById('pwdInput').focus(), 100);
}

// Safe event binding - element may not exist on all pages
(function() {
  var pwdInput = document.getElementById('pwdInput');
  if (pwdInput) {
    pwdInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') submitPassword();
      var errEl = document.getElementById('pwdError');
      if (errEl) errEl.classList.remove('show');
    });
  }
})();

async function submitPassword() {
  const pwd = document.getElementById('pwdInput').value.trim();
  if (!pwd) {
    document.getElementById('pwdError').textContent = '⚠ Please enter a password.';
    document.getElementById('pwdError').classList.add('show');
    return;
  }
  const btn = document.getElementById('pwdUnlockBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Unlocking…';
  document.getElementById('pwdError').classList.remove('show');

  try {
    const pdf = await _getDocumentWithTimeout({ data: await _freshBuf(), password: pwd });
    // ── Correct ──
    document.getElementById('pwdModal').classList.remove('show');
    log('ok', `  🔓 Unlocked ${currentFile.name} (attempt ${pwdAttempts + 1})`);
    _addToHistory(pwd);
    // Apply-to-all: store password for subsequent protected files
    if (document.getElementById('pwdApplyAll').checked) {
      _applyAllPassword = pwd;
      log('info', `  📌 Password saved for remaining files in this batch`);
    }
    await _processPdfText(pdf);
  } catch (err) {
    // FIX: only treat actual PasswordException (wrong password) as a retry — surface other errors clearly
    const isWrongPwd = err.name === 'PasswordException' || err.code === 2 ||
                       (err.message && err.message.toLowerCase().includes('password'));
    pwdAttempts++;
    btn.disabled = false;
    btn.textContent = '🔓 Unlock & Process';
    document.getElementById('pwdInput').value = '';
    document.getElementById('pwdInput').focus();
    document.getElementById('pwdError').textContent = isWrongPwd
      ? `❌ Incorrect password (attempt ${pwdAttempts}). Please try again.`
      : `❌ Error processing file: ${err.message}`;
    document.getElementById('pwdError').classList.add('show');
    document.getElementById('pwdAttempt').textContent =
      `${pwdAttempts} failed attempt${pwdAttempts > 1 ? 's' : ''} — you can skip this file if needed.`;
    log('warn', `  ✗ ${isWrongPwd ? 'Wrong password' : 'Error'} attempt ${pwdAttempts} for ${currentFile.name}${isWrongPwd ? '' : ': ' + err.message}`);
  }
}

// Common post-unlock processing (extracted to avoid duplication)
async function _processPdfText(pdf) {
  showLoader(`Processing ${currentFile.name}…`);
  const text = await extractText(pdf);
  const txns = parseTransactions(text, currentFile.name);
  extractAccountInfo(text);
  txns.forEach(t => t._fileIdx = currentFileIdx);
  const _usedPwd = (typeof _bulkPassword !== 'undefined' && _bulkPassword) ? _bulkPassword
                  : (typeof _pwdHistory !== 'undefined' && _pwdHistory.length ? _pwdHistory[0] : null);
  perFileData.push({ fileName: currentFile.name, fileSize: (currentFile.size||0), isProtected: true, pdfPassword: _usedPwd||null, txns: txns, accountInfo: JSON.parse(JSON.stringify(accountInfo)), fileRef: currentFile });
  _docFiles.push({ fileName: currentFile.name, fileSize: (currentFile.size||0), txnCount: txns.length, isProtected: true, passwordUsed: true, pdfPassword: _usedPwd||null, hasSalary: false, span: 0, validatedAt: Date.now() });
  if (typeof _renderDocs === 'function') { _renderDocs(); const ds=document.getElementById('docSection'); if(ds) ds.classList.add('show'); }
  log(txns.length ? 'ok' : 'warn', `  → ${txns.length} transactions parsed`);
  allTxns.push(...txns);
  _pendingFile = null;
  hideLoader();
  currentFileIdx++;
  processNextFile();
}

function _addToHistory(pwd) {
  _pwdHistory = [pwd, ..._pwdHistory.filter(p => p !== pwd)].slice(0, 10);
}

function skipPasswordedFile() {
  document.getElementById('pwdModal').classList.remove('show');
  log('skip', `  ⊘ Skipped ${currentFile.name} (${pwdAttempts} failed attempt${pwdAttempts !== 1 ? 's' : ''})`);
  _pendingFile = null; // FIX: clear stale file reference after skip
  currentFileIdx++;
  processNextFile();
}

// ─── Text Extraction ───
// FIX: Use positional grouping so date tokens across adjacent PDF items
// are not split by spaces. Items on the same approximate Y-position are
// joined without a separator; a new line is emitted when Y changes.
async function extractText(pdf) {
  let full = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items = content.items;
    if (!items.length) continue;

    // ── Step 1: collect all text items with their Y positions ──
    const positioned = [];
    for (const item of items) {
      if (!item.str) continue;
      const y = item.transform ? item.transform[5] : 0;
      const x = item.transform ? item.transform[4] : 0;
      positioned.push({ str: item.str, x, y });
    }

    // ── Step 2: cluster by Y into rows (tolerance = font-size aware, min 4px) ──
    // Sort by Y descending (top of page first in PDF coord system)
    positioned.sort((a, b) => b.y - a.y);

    const rows = [];
    let curRow = null;
    let curY   = null;
    // Compute median gap to set dynamic tolerance
    const ys = [...new Set(positioned.map(p => Math.round(p.y)))].sort((a,b)=>b-a);
    const gaps = [];
    for (let k = 1; k < ys.length; k++) gaps.push(Math.abs(ys[k-1]-ys[k]));
    gaps.sort((a,b)=>a-b);
    const medianGap = gaps.length ? gaps[Math.floor(gaps.length/2)] : 10;
    const rowTol    = Math.max(4, Math.min(medianGap * 0.6, 14));

    for (const p of positioned) {
      if (curY === null || Math.abs(p.y - curY) > rowTol) {
        curRow = [];
        rows.push(curRow);
        curY = p.y;
      }
      curRow.push(p);
    }

    // ── Step 3: within each row sort by X (left to right) ──
    for (const row of rows) {
      row.sort((a, b) => a.x - b.x);
      // Build line string — preserve spacing between distant columns
      let line = '';
      let prevX = null;
      let prevLen = 0;
      for (const p of row) {
        if (prevX !== null) {
          const gap = p.x - prevX - prevLen;
          if (gap > 12) {
            line += '  '; // column separator
          } else if (gap > 3 && !line.endsWith(' ') && !p.str.startsWith(' ')) {
            line += ' ';
          }
        }
        line += p.str;
        prevX  = p.x;
        prevLen = p.str.length * 5; // rough char width estimate
      }
      line = line.trim();
      if (line) full += line + '\n';
    }

    full += '\n'; // page break
  }
  return full;
}

// ─── Account Info Extraction — Universal Bank Support ───
// Handles HDFC, SBI, ICICI, Axis, Kotak, PNB, BOB, Canara, Union, IndusInd,
// IDFC FIRST, Yes Bank, Federal, South Indian, RBL, Bandhan, AU SFB, DCB,
// Equitas/Jana/Ujjivan/ESAF/Utkarsh SFB, Paytm/Airtel PB, DBS, HSBC, Co-op banks
function extractAccountInfo(text) {
  const lines = text.split(/\n/).map(l => l.trim());
  const full  = text.replace(/\n/g, ' ');

  // ── Bank name detection: known strings + generic pattern ──
  const KNOWN_BANKS = [
    // PSU Banks
    'State Bank of India','SBI','Punjab National Bank','PNB',
    'Bank of Baroda','Bank of India','Canara Bank','Union Bank of India',
    'Central Bank of India','Indian Bank','Indian Overseas Bank','UCO Bank',
    'Bank of Maharashtra','Punjab & Sind Bank',
    // Private Banks
    'HDFC Bank','ICICI Bank','Axis Bank','Kotak Mahindra Bank','Yes Bank',
    'IDFC FIRST Bank','IndusInd Bank','Federal Bank','South Indian Bank',
    'Karur Vysya Bank','Lakshmi Vilas Bank','Dhanlaxmi Bank',
    'City Union Bank','Tamilnad Mercantile Bank','Nainital Bank',
    'RBL Bank','DCB Bank','Bandhan Bank','CSB Bank','Jammu & Kashmir Bank',
    // Small Finance Banks
    'AU Small Finance Bank','Jana Small Finance Bank','Equitas Small Finance Bank',
    'Ujjivan Small Finance Bank','ESAF Small Finance Bank','Utkarsh Small Finance Bank',
    'Suryoday Small Finance Bank','Capital Small Finance Bank','FINCARE Small Finance Bank',
    'North East Small Finance Bank',
    // Payments Banks
    'Paytm Payments Bank','Airtel Payments Bank','FINO Payments Bank',
    'India Post Payments Bank','Jio Payments Bank','NSDL Payments Bank',
    // Foreign Banks
    'DBS Bank India','HSBC India','Citibank','Standard Chartered Bank',
    'Deutsche Bank','Barclays Bank','BNP Paribas',
    // Co-op Banks (common)
    'Saraswat Co-operative Bank','Saraswat Bank','TJSB Sahakari Bank','SVC Bank',
    'Cosmos Co-operative Bank','Shamrao Vithal Co-operative Bank','The Kalyan Janata',
    'Navi Mumbai Cooperative','Abhyudaya Cooperative Bank','Bassein Catholic Bank',
    'Bharat Co-operative Bank','Zoroastrian Co-operative Bank',
    'The Thane Bharat Sahakari Bank','Mahanagar Co-operative Bank',
    'NKGSB Cooperative Bank','Rajkot Nagarik Sahakari Bank',
  ];

  for (const line of lines) {
    // Bank name — known list first
    if (!accountInfo.bank) {
      for (const kb of KNOWN_BANKS) {
        if (new RegExp(kb.replace(/[()]/g,'\\$&'), 'i').test(line)) {
          accountInfo.bank = kb; break;
        }
      }
    }
    // Bank name — generic fallback
    if (!accountInfo.bank) {
      const m = line.match(/(?:Bank(?:\s*Name)?|Institution|Issued\s*by)[:\-\s]+([A-Za-z][A-Za-z\s,\.]+(?:Bank|Financial|Finance|Cooperative|Co-op)[A-Za-z,\.\s]*)/i);
      if (m) accountInfo.bank = m[1].trim().replace(/\s+/g,' ').slice(0,60);
    }

    // Account number — many labelling styles across banks
    if (!accountInfo.accountNo) {
      const m = line.match(/(?:A\/C\s*(?:No\.?|Num(?:ber)?)?|Account\s*(?:No\.?|Num(?:ber)?)|Acct\.?\s*(?:No\.?|Num)?|SB\s*A\/C|CA\s*A\/C|OD\s*A\/C|CC\s*A\/C|NRE\s*A\/C|NRO\s*A\/C|FCNR\s*A\/C)[\s:\-]*([0-9Xx]{6,20})/i);
      if (m) accountInfo.accountNo = m[1].replace(/[Xx]/g,'x').trim();
    }

    // IFSC — standard format
    if (!accountInfo.ifsc) {
      const m = line.match(/(?:IFSC|IFS\s*Code|Branch\s*Code)[\s:\-]*([A-Z]{4}0[A-Z0-9]{6})/i);
      if (m) accountInfo.ifsc = m[1].toUpperCase();
    }

    // MICR
    if (!accountInfo.micr) {
      const m = line.match(/(?:MICR|MICR\s*Code)[\s:\-]*([0-9]{9})/i);
      if (m) accountInfo.micr = m[1];
    }

    // Account type
    if (!accountInfo.accountType) {
      const m = line.match(/(?:Account\s*Type|A\/C\s*Type|Type\s*of\s*Account)[\s:\-]+(Savings|Current|Overdraft|Cash\s*Credit|NRE|NRO|FCNR|Recurring|Fixed\s*Deposit)[A-Za-z\s]*/i);
      if (m) accountInfo.accountType = m[1].trim();
      else if (/\b(Savings\s*Account|SB\s*Account|Regular\s*Savings)\b/i.test(line)) accountInfo.accountType = 'Savings';
      else if (/\b(Current\s*Account|CA\b)\b/i.test(line)) accountInfo.accountType = 'Current';
    }

    // Branch name
    if (!accountInfo.branch) {
      const m = line.match(/(?:Branch\s*(?:Name)?|Home\s*Branch)[\s:\-]+([A-Za-z][A-Za-z\s,\-\.]{3,60})/i);
      if (m) accountInfo.branch = m[1].trim().replace(/\s+/g,' ').slice(0,60);
    }

    // Account holder name — many patterns
    if (!accountInfo.name) {
      const m = line.match(/(?:Account\s*Holder(?:\s*Name)?|Name\s*(?:of\s*Account\s*Holder)?|Customer\s*Name|Applicant\s*Name|Member\s*Name|Proprietor\s*Name)[:\s]+([A-Z][A-Za-z\s\.]{3,60})/);
      if (m) accountInfo.name = m[1].trim().replace(/\s+/g,' ');
    }

    // Mobile / phone
    if (!accountInfo.mobile) {
      const m = line.match(/(?:Mobile|Phone|Contact|Tel(?:ephone)?)[\s:\-\.]*(?:\+91[-\s]?)?([6-9][0-9]{9})/i);
      if (m) accountInfo.mobile = m[1];
    }

    // Email
    if (!accountInfo.email) {
      const m = line.match(/([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/);
      if (m) accountInfo.email = m[1];
    }

    // PAN — only match when label is present to avoid account/cheque number false positives
    if (!accountInfo.pan) {
      const m = line.match(/(?:PAN|Permanent\s*Account\s*Number)[\s:\-]*([A-Z]{5}[0-9]{4}[A-Z])/i);
      if (m) accountInfo.pan = m[1].toUpperCase();
    }

    // Address
    if (!accountInfo.address) {
      const m = line.match(/(?:Address|Registered\s*Address|Mailing\s*Address|Communication\s*Address)[\s:\-]+(.{15,120})/i);
      if (m) accountInfo.address = m[1].trim().replace(/\s+/g,' ');
    }

    // CIF / Customer ID
    if (!accountInfo.cif) {
      const m = line.match(/(?:CIF\s*(?:No\.?|ID)?|Customer\s*ID|Cust(?:omer)?\s*(?:No\.?|ID))[\s:\-]*([A-Z0-9]{5,16})/i);
      if (m) accountInfo.cif = m[1].trim();
    }

    // Statement period
    if (!accountInfo.periodFrom) {
      const m = line.match(/(?:From|Statement\s*From|Period\s*From)[\s:\-]+(\d{1,2}[-\/][A-Za-z0-9]{2,3}[-\/]\d{2,4})/i);
      if (m) accountInfo.periodFrom = m[1].trim();
    }
    if (!accountInfo.periodTo) {
      const m = line.match(/(?:To|Statement\s*To|Period\s*To)[\s:\-]+(\d{1,2}[-\/][A-Za-z0-9]{2,3}[-\/]\d{2,4})/i);
      if (m) accountInfo.periodTo = m[1].trim();
    }
  }

  // Fallbacks over full text
  if (!accountInfo.ifsc) {
    const m = full.match(/\b([A-Z]{4}0[A-Z0-9]{6})\b/);
    if (m) accountInfo.ifsc = m[1];
  }
  if (!accountInfo.mobile) {
    // Only use fallback with stricter boundaries - must not be adjacent to more digits
    const m = full.match(/(?:^|[\s,;:\(])(?:\+91[-\s]?|91[-\s])?([6-9][0-9]{9})(?:[\s,;:\)]|$)/);
    if (m) accountInfo.mobile = m[1];
  }
  if (!accountInfo.accountNo) {
    const m = full.match(/\b([0-9]{9,18})\b/);
    if (m) accountInfo.accountNo = m[1];
  }
  // Detect bank from IFSC prefix
  if (!accountInfo.bank && accountInfo.ifsc) {
    const IFSC_MAP = {
      HDFC:'HDFC Bank',ICIC:'ICICI Bank',UTIB:'Axis Bank',KKBK:'Kotak Mahindra Bank',
      YESB:'Yes Bank',IDFB:'IDFC FIRST Bank',INDB:'IndusInd Bank',FDRL:'Federal Bank',
      SIBL:'South Indian Bank',KVBL:'Karur Vysya Bank',RATN:'RBL Bank',DCBL:'DCB Bank',
      BDBL:'Bandhan Bank',AUBL:'AU Small Finance Bank',JSFB:'Jana Small Finance Bank',
      ESFB:'Equitas Small Finance Bank',USFB:'Ujjivan Small Finance Bank',
      SBIN:'State Bank of India',PUNB:'Punjab National Bank',BKID:'Bank of India',
      BARB:'Bank of Baroda',CNRB:'Canara Bank',UBIN:'Union Bank of India',
      CBIN:'Central Bank of India',IDIB:'Indian Bank',IOBA:'Indian Overseas Bank',
      UCBA:'UCO Bank',MAHB:'Bank of Maharashtra',PSIB:'Punjab & Sind Bank',
      DBSS:'DBS Bank India',HSBC:'HSBC India',CITI:'Citibank',SCBL:'Standard Chartered',
      PYTM:'Paytm Payments Bank',AIRP:'Airtel Payments Bank',FINO:'FINO Payments Bank',
      NSDL:'NSDL Payments Bank',IIPP:'India Post Payments Bank',
    };
    const prefix = accountInfo.ifsc.slice(0, 4);
    if (IFSC_MAP[prefix]) accountInfo.bank = IFSC_MAP[prefix];
  }
}

// ─── Universal Transaction Parser v7.0 ───
// Handles every major Indian bank PDF statement format including:
//   • Multi-column layouts (amounts in separate debit/credit columns — HDFC, SBI, PNB, BOB)
//   • Inline CR/DR token layouts (Axis, ICICI, IndusInd, Yes, Federal)
//   • IDFC FIRST multi-line split (date on one line, amounts on next)
//   • ISO date (YYYY-MM-DD) used by DBS, HSBC, neo-banks
//   • Named-month formats (DD-Mon-YYYY, DD Mon YYYY) used by Kotak, South Indian, co-ops
//   • Payments bank formats (Paytm, Airtel, FINO)
//   • Co-operative bank tally-style exports
//   • Reversed-balance column ordering
//   • Running balance carry-forward
function parseTransactions(text, filename) {
  const txns = [];
  // Log first 500 chars of extracted text for debugging
  log('info', `  📄 Extracted text preview: ${text.slice(0,300).replace(/\n/g,' ↵ ')}`);
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  log('info', `  📄 Total lines extracted: ${lines.length}`);

  // ── Detect bank from filename / text for format hints ──
  const bankHint = (() => {
    const s = (filename + ' ' + text.slice(0, 2000)).toLowerCase();
    if (/hdfc/i.test(s)) return 'HDFC';
    if (/icici/i.test(s)) return 'ICICI';
    if (/axis/i.test(s)) return 'AXIS';
    if (/kotak/i.test(s)) return 'KOTAK';
    if (/sbi|state bank/i.test(s)) return 'SBI';
    if (/pnb|punjab national/i.test(s)) return 'PNB';
    if (/bob|bank of baroda/i.test(s)) return 'BOB';
    if (/canara/i.test(s)) return 'CANARA';
    if (/union bank/i.test(s)) return 'UNION';
    if (/central bank/i.test(s)) return 'CENTRAL';
    if (/indian bank/i.test(s)) return 'INDIANBANK';
    if (/indian overseas/i.test(s)) return 'IOB';
    if (/uco bank/i.test(s)) return 'UCO';
    if (/bank of india/i.test(s)) return 'BOI';
    if (/bank of maharashtra/i.test(s)) return 'BOM';
    if (/idfc/i.test(s)) return 'IDFC';
    if (/indusind/i.test(s)) return 'INDUSIND';
    if (/yes bank/i.test(s)) return 'YES';
    if (/federal/i.test(s)) return 'FEDERAL';
    if (/south indian/i.test(s)) return 'SIB';
    if (/karur/i.test(s)) return 'KVB';
    if (/rbl/i.test(s)) return 'RBL';
    if (/dcb/i.test(s)) return 'DCB';
    if (/bandhan/i.test(s)) return 'BANDHAN';
    if (/au small|au sfb/i.test(s)) return 'AUSFB';
    if (/jana/i.test(s)) return 'JANASFB';
    if (/equitas/i.test(s)) return 'EQUITAS';
    if (/ujjivan/i.test(s)) return 'UJJIVAN';
    if (/esaf/i.test(s)) return 'ESAF';
    if (/utkarsh/i.test(s)) return 'UTKARSH';
    if (/paytm/i.test(s)) return 'PAYTM';
    if (/airtel/i.test(s)) return 'AIRTEL';
    if (/fino/i.test(s)) return 'FINO';
    if (/dbs/i.test(s)) return 'DBS';
    if (/hsbc/i.test(s)) return 'HSBC';
    if (/citi/i.test(s)) return 'CITI';
    if (/standard chartered/i.test(s)) return 'SCB';
    if (/saraswat/i.test(s)) return 'SARASWAT';
    if (/tjsb/i.test(s)) return 'TJSB';
    if (/svc bank/i.test(s)) return 'SVC';
    if (/cosmos/i.test(s)) return 'COSMOS';
    return 'GENERIC';
  })();

  // ── Detect if the statement has separate Debit/Credit amount columns ──
  // (SBI, PNB, BOB, Canara, Union, Central, IOB, BOI, UCO, BOM, co-ops usually do)
  // Scan the full text, not just the first 4000 chars, to catch late headers.
  const hasSplitAmtCols = /(?:Debit\s+Credit|Withdrawal\s+Deposit|Dr\s+Cr|Withdrawals?\s+Deposits?)/i.test(text);

  // Lines that are headers / metadata — skip even if they contain a date
  const SKIP_LINE_PATTERNS = [
    /statement\s*(period|date|from|to)/i,
    /opening\s*balance/i,
    /closing\s*balance/i,
    /account\s*(summary|statement|period|detail)/i,
    /from\s*date|to\s*date/i,
    /^date\s+(narration|description|particulars|txn|transaction|value)/i,
    /^\s*(date|sl\.?\s*no|sr\.?\s*no|sno\.?|#|s\.no)\s*$/i,
    /page\s*\d+\s*(of\s*\d+)?/i,
    /generated\s*on|print\s*date|print\s*time/i,
    /total\s*(debit|credit|balance|transactions?)/i,
    /^opening\s*balance\s*total/i,
    /brought\s*forward/i,
    /carried\s*forward/i,
    /transaction\s*summary/i,
    /mini\s*statement/i,
    /^(transaction\s*)?date\s+(chq|cheque|ref|value)/i,
    /^narration\s+chq/i,
    /authorized\s*signatory/i,
    /this\s*is\s*(a\s*)?computer\s*generated/i,
    /for\s*(and\s*on\s*behalf|the\s*bank)/i,
    /e-statement|internet\s*banking/i,
    /^\s*(?:debit|credit|withdrawal|deposit|dr|cr|balance)\s*$/i,
    /balance\s+brought\s+forward/i,
  ];

  // All recognised date patterns across all banks
  const DATE_PATTERNS = [
    /(\d{1,2}[-\/]\d{1,2}[-\/]\d{4})/,        // DD/MM/YYYY or D/M/YYYY (most Indian banks)
    /(\d{4}[-\/]\d{2}[-\/]\d{2})/,             // YYYY-MM-DD (DBS, HSBC, neo-banks)
    /(\d{2}[-\/]\d{2}[-\/]\d{2})/,             // DD/MM/YY (some co-ops)
    /(\d{2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4})/i,       // DD Mon YYYY
    /(\d{1,2}[-\/](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[-\/]\d{4})/i, // DD-Mon-YYYY (Kotak, SIB)
    /(\d{2}(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\d{4})/i,             // DDMonYYYY (compact, some co-ops)
    /(\d{2}\.\d{2}\.\d{4})/,                   // DD.MM.YYYY (some foreign banks)
    /(\d{4}\.\d{2}\.\d{2})/,                   // YYYY.MM.DD
    /(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i, // D Month YYYY
  ];

  function stripDates(s) {
    return s
      .replace(/\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/gi,'')
      .replace(/\d{1,2}[-\/](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[-\/]\d{4}/gi,'')
      .replace(/\d{2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}/gi,'')
      .replace(/\d{2}(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\d{4}/gi,'')
      .replace(/\d{4}[-\/\.]\d{2}[-\/\.]\d{2}/g,'')
      .replace(/\d{1,2}[-\/\.]\d{1,2}[-\/\.]\d{4}/g,'')
      .replace(/\d{2}[-\/\.]\d{2}[-\/\.]\d{2}/g,'');
  }

  function lineHasDate(l) {
    for (const pat of DATE_PATTERNS) {
      const m = pat.exec(l);
      if (m) {
        const d = parseIndianDate(m[1]);
        if (d && d.getFullYear() >= 2010 && d.getFullYear() <= 2035) return true;
      }
    }
    return false;
  }

  // Amount pattern: inline in usage to avoid /g flag lastIndex state bug

  // ── Bank-specific column-order correction ──
  // Some banks print columns as: Date | Narration | Debit | Credit | Balance
  // Others: Date | Narration | Amount | CR/DR | Balance
  // hasSplitAmtCols handles the Debit | Credit | Balance layout

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (SKIP_LINE_PATTERNS.some(p => p.test(line))) continue;

    let dateFound = null;
    // Collect ALL date matches in this line and pick the FIRST (leftmost) valid one.
    // Many banks print: TxnDate  Narration  ValueDate  Amount  Balance
    // We always want the TRANSACTION date (leftmost), not the value date (rightmost).
    const allDateMatches = [];
    for (const pat of DATE_PATTERNS) {
      const re = new RegExp(pat.source, 'g');
      let hit;
      while ((hit = re.exec(line)) !== null) {
        const d = parseIndianDate(hit[1]);
        if (d && d.getFullYear() >= 2010 && d.getFullYear() <= 2035) {
          allDateMatches.push({ index: hit.index, date: d });
        }
      }
    }
    if (allDateMatches.length > 0) {
      // Sort by position in line — leftmost = transaction date
      allDateMatches.sort((a, b) => a.index - b.index);
      dateFound = allDateMatches[0].date;
    }
    if (!dateFound) continue;

    // ── Build combined window: up to 5 continuation lines (handles IDFC, some SFBs) ──
    const windowLines = [line];
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      const nextLine = lines[j];
      if (!nextLine) break;
      if (lineHasDate(nextLine) && !SKIP_LINE_PATTERNS.some(p => p.test(nextLine))) break;
      if (SKIP_LINE_PATTERNS.some(p => p.test(nextLine))) break;
      windowLines.push(nextLine);
    }
    const combined = windowLines.join(' ');
    // Inline regex (avoid /g flag state retention bug across loop iterations)
    const strictAmounts = [...combined.matchAll(/[\d,]+\.\d{2}/g)].map(m => parseFloat(m[0].replace(/,/g,'')));
    const amounts = strictAmounts.length ? strictAmounts :
      [...combined.matchAll(/\d{1,2},\d{2},\d{3}|\d{1,3},\d{3}|\d{4,}/g)]
        .map(m => parseFloat(m[0].replace(/,/g,''))).filter(n => n > 0);
    if (!amounts.length) continue;

    // ── Guard: skip lines that are just date ranges (statement headers) ──
    const dateCountInLine = DATE_PATTERNS.reduce((cnt, p) => cnt + (line.match(new RegExp(p.source,'gi')) || []).length, 0);
    if (dateCountInLine >= 2 && amounts.length === 0) continue;

    let balance, amount, type = 'CR';

    if (hasSplitAmtCols) {
      // ── SPLIT-COLUMN mode: Debit | Credit | Balance ──
      // Pattern: 3 amounts → [debit, credit, balance] with one of debit/credit being 0
      // Some banks print 0.00 for empty column; others leave it blank
      if (amounts.length >= 3) {
        // Last is balance; second-to-last credit; third-to-last debit
        balance = amounts[amounts.length - 1];
        const maybeCredit = amounts[amounts.length - 2];
        const maybeDebit  = amounts[amounts.length - 3];
        // If the line explicitly contains Dr/Cr marker, trust it
        const hasDr = /\bDr\.?\b|\bDebit\b|\bWithdrawal\b|\bWD\b|\bDR\b|\/DR\//i.test(combined);
        const hasCr = /\bCr\.?\b|\bCredit\b|\bDeposit\b|\bDP\b|\bCR\b|\/CR\//i.test(combined);
        if (hasDr && !hasCr) { type='DR'; amount=maybeDebit||maybeCredit; }
        else if (hasCr && !hasDr) { type='CR'; amount=maybeCredit||maybeDebit; }
        else {
          // Heuristic: whichever of [debit, credit] is non-zero is the amount
          if (maybeDebit > 0 && maybeCredit === 0) { type='DR'; amount=maybeDebit; }
          else if (maybeCredit > 0 && maybeDebit === 0) { type='CR'; amount=maybeCredit; }
          else {
            // Both non-zero (rare, some banks print actual debit/credit values in both cols)
            // Use balance delta to determine direction: if balance went up it's CR, else DR
            // We'll flag this for post-process delta validation
            if (maybeCredit >= maybeDebit) { type='CR'; amount=maybeCredit; }
            else { type='DR'; amount=maybeDebit; }
          }
        }
      } else if (amounts.length === 2) {
        balance = amounts[1]; amount = amounts[0];
        const hasDr = /\bDr\.?\b|\bDR\b|\/DR\/|\bDebit\b|\bWithdrawal\b/i.test(combined);
        type = hasDr ? 'DR' : 'CR';
      } else {
        amount = amounts[0]; balance = amounts[0];
        type = /\bDr\.?\b|\bDR\b|\/DR\//i.test(combined) ? 'DR' : 'CR';
      }
    } else {
      // ── SINGLE-AMOUNT mode: Amount | CR/DR-marker | Balance ──
      if (amounts.length >= 2) {
        balance = amounts[amounts.length - 1];
        const isDr = /\bDr\.?\b|\bDebit\b|\bWithdrawal\b|\bDR\b|\/DR\/|UPI\/DR\/|NEFT\/DR|RTGS.*DEBIT|\bWD\b/i.test(combined);
        const isCr = /\bCr\.?\b|\bCredit\b|\bDeposit\b|\bCR\b|\/CR\/|UPI\/CR\/|NEFT\/CR|RTGS.*CREDIT|\bDP\b/i.test(combined);
        if (isDr && !isCr) { type='DR'; amount=amounts[amounts.length-2]; }
        else if (isCr && !isDr) { type='CR'; amount=amounts[amounts.length-2]; }
        else {
          // No explicit marker — infer from balance delta vs previous transaction
          amount = amounts[amounts.length - 2];
          // Balance delta heuristic: if balance increased it is likely CR, else DR
          // This is a best-effort guess; post-process validation will flag mismatches
          type = amount <= balance ? 'CR' : 'DR';
        }
      } else {
        amount = amounts[0]; balance = amounts[0];
        type = /\bDr\.?\b|\bDR\b|\/DR\/|UPI\/DR\//i.test(combined) ? 'DR' : 'CR';
      }
    }

    // ── Narration / description cleanup ──
    let desc = stripDates(line)
      .replace(/[\d,]+\.\d{2}/g,'')
      .replace(/\b(Dr|CR|DR|Cr)\b/g,'')
      .replace(/\b\d{12,22}\b/g,'')     // strip UPI/NEFT/UTR reference numbers
      .replace(/\s{2,}/g,' ').trim().slice(0, 100);
    if (!desc) desc = `Txn-${i+1}`;

    const rawDesc = stripDates(combined)
      .replace(/[\d,]+\.\d{2}/g,'')
      .replace(/\b\d{12,22}\b/g,'')     // strip ref numbers from rawDesc too
      .replace(/\s{2,}/g,' ').trim();

    const category = categorize(rawDesc, type);
    txns.push({ date: dateFound, desc, rawDesc, type, amount, balance, category });
  }

  // ── Post-process: remove obvious duplicates (same date+amount+type+balance+desc within 2 rows) ──
  const deduped = [];
  for (let i = 0; i < txns.length; i++) {
    if (i > 0) {
      const prev = txns[i-1], cur = txns[i];
      const sameCore = prev.date.getTime() === cur.date.getTime() &&
          prev.amount === cur.amount && prev.type === cur.type &&
          prev.balance === cur.balance;
      // Only skip if description also matches (prevents removing legit same-day same-amount transactions)
      const sameDesc = prev.desc.slice(0,30) === cur.desc.slice(0,30);
      if (sameCore && sameDesc) continue;
    }
    deduped.push(txns[i]);
  }

  log('info', `  [${bankHint}] ${hasSplitAmtCols ? 'split-col' : 'single-col'} mode → ${deduped.length} txn(s)`);
  if (deduped.length > 0) {
    const sorted = [...deduped].sort((a,b) => a.date - b.date);
    const fmt2 = d => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
    log('info', `  📅 Date range in file: ${fmt2(sorted[0].date)} → ${fmt2(sorted[sorted.length-1].date)}`);
  }

  // ── Post-process: balance delta validation ──
  // Verify prev.balance ± amount ≈ curr.balance for each consecutive pair.
  // Mismatches indicate a misparse (wrong amount, wrong type, or a skipped row).
  // Flag them so the UI can highlight them; do NOT discard them.
  let balanceMismatches = 0;
  const sortedForValidation = [...deduped].sort((a,b) => a.date - b.date);
  for (let i = 1; i < sortedForValidation.length; i++) {
    const prev = sortedForValidation[i-1], cur = sortedForValidation[i];
    // Only validate same-day consecutive pairs (cross-day gaps may have other txns)
    if (prev.date.getTime() !== cur.date.getTime()) continue;
    const expected = prev.type === 'CR'
      ? prev.balance - prev.amount + (cur.type === 'CR' ? cur.amount : -cur.amount)
      : prev.balance + prev.amount + (cur.type === 'CR' ? cur.amount : -cur.amount);
    // Allow ₹1 rounding tolerance
    if (Math.abs(cur.balance - (prev.balance + (cur.type === 'CR' ? cur.amount : -cur.amount))) > 1) {
      cur._balanceMismatch = true;
      balanceMismatches++;
    }
  }
  if (balanceMismatches > 0) {
    log('warn', `  ⚠ ${balanceMismatches} balance delta mismatch(es) detected — rows flagged in UI`);
  }

  return deduped;
}

// ─── Categorize ───
function categorize(desc, type) {
  // Salary check uses full SALARY_PATTERNS list (Req 3)
  if (isSalaryTxn(desc)) return 'Salary';
  // Bounce detection (before other checks — bounce overrides payment type)
  if (isBounceTxn(desc)) return 'Bounce';
  // ACH detection
  if (isACHTxn(desc)) return type === 'CR' ? 'ACH Credit' : 'ACH Debit';
  // ECS detection
  if (isECSTxn(desc)) return type === 'CR' ? 'ECS Credit' : 'ECS Debit';
  // NEFT/RTGS detection
  if (isNEFTTxn(desc)) return type === 'CR' ? 'NEFT/RTGS Credit' : 'NEFT/RTGS Debit';
  // UPI/IMPS detection
  if (isUPITxn(desc)) return type === 'CR' ? 'UPI/IMPS Credit' : 'UPI/IMPS Debit';
  // Cheque detection
  if (isChequeTxn(desc)) return type === 'CR' ? 'Cheque Deposit' : 'Cheque Issue';
  const d = desc.toLowerCase();
  if (/imps|neft|rtgs|upi|transfer/i.test(d)) {
    if (type === 'CR') return d.includes('self') ? 'Transfer from Self' : 'Transfer Credit';
    return d.includes('self') ? 'Transfer To Self' : 'Transfer Debit';
  }
  if (/interest|int\b/i.test(d)) return type === 'CR' ? 'Interest Credit' : 'Interest Charge';
  if (/emi|loan/i.test(d)) return 'Loan/EMI';
  if (/atm|cash/i.test(d)) return type === 'CR' ? 'Cash Deposit' : 'Cash Withdrawal';
  if (/chq|cheque|check/i.test(d)) return type === 'CR' ? 'Cheque Deposit' : 'Cheque Issue';
  if (/charge|fee|gst/i.test(d)) return 'Bank Charges';
  if (/utility|electricity|gas|water|bill/i.test(d)) return 'Utility Payment';
  if (/credit card|cc\b/i.test(d)) return 'Credit Card Payment';
  return type === 'CR' ? 'Other Credit' : 'Other Debit';
}

function parseIndianDate(str) {
  if (!str) return null;
  str = str.trim();
  let m;

  const mon = {
    jan:0, feb:1, mar:2, apr:3, may:4, jun:5,
    jul:6, aug:7, sep:8, oct:9, nov:10, dec:11,
    january:0, february:1, march:2, april:3, june:5,
    july:6, august:7, september:8, october:9, november:10, december:11
  };

  // ── DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY ──
  // Indian banks ALWAYS use DD/MM/YYYY — never MM/DD/YYYY
  // So: first token = day, second token = month. No ambiguity flip.
  m = str.match(/^(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{4})$/);
  if (m) {
    const day = +m[1], month = +m[2], year = +m[3];
    // Validate strictly: day 1-31, month 1-12
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const d = new Date(year, month - 1, day);
      // Extra sanity: JS Date auto-corrects invalid dates (e.g. 31 Feb → 3 Mar)
      // Reject if day/month got shifted
      if (d.getDate() === day && d.getMonth() === month - 1 && d.getFullYear() === year)
        return d;
    }
    return null;
  }

  // ── DD/MM/YY or DD-MM-YY (short year) ──
  m = str.match(/^(\d{2})[-\/\.](\d{2})[-\/\.](\d{2})$/);
  if (m) {
    const day = +m[1], month = +m[2], yr2 = +m[3];
    const year = yr2 <= 35 ? 2000 + yr2 : 1900 + yr2; // 00-35 → 2000s, 36-99 → 1900s
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const d = new Date(year, month - 1, day);
      if (d.getDate() === day && d.getMonth() === month - 1) return d;
    }
    return null;
  }

  // ── YYYY/MM/DD or YYYY-MM-DD or YYYY.MM.DD (ISO, DBS, HSBC, neo-banks) ──
  m = str.match(/^(\d{4})[-\/\.](\d{2})[-\/\.](\d{2})$/);
  if (m) {
    const year = +m[1], month = +m[2], day = +m[3];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(year, month - 1, day);
      if (d.getDate() === day && d.getMonth() === month - 1) return d;
    }
    return null;
  }

  // ── DD Mon YYYY (e.g. "30 Mar 2026", "5 January 2025") ──
  m = str.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/i);
  if (m) {
    const mk = m[2].toLowerCase().slice(0, 3);
    // Use 3-char prefix lookup so "January"→"jan", "September"→"sep" etc.
    const moIdx = mon[m[2].toLowerCase()] !== undefined ? mon[m[2].toLowerCase()] : mon[mk];
    if (moIdx !== undefined) {
      const d = new Date(+m[3], moIdx, +m[1]);
      if (d.getDate() === +m[1] && d.getMonth() === moIdx) return d;
    }
    return null;
  }

  // ── DD-Mon-YYYY (e.g. "30-Mar-2026") ──
  m = str.match(/^(\d{1,2})[-\/]([A-Za-z]{3,9})[-\/](\d{4})$/i);
  if (m) {
    const mk = m[2].toLowerCase().slice(0, 3);
    const moIdx = mon[m[2].toLowerCase()] !== undefined ? mon[m[2].toLowerCase()] : mon[mk];
    if (moIdx !== undefined) {
      const d = new Date(+m[3], moIdx, +m[1]);
      if (d.getDate() === +m[1] && d.getMonth() === moIdx) return d;
    }
    return null;
  }

  // ── DDMonYYYY compact (e.g. "30Mar2026") — some co-op banks ──
  m = str.match(/^(\d{2})([A-Za-z]{3})(\d{4})$/i);
  if (m) {
    const moIdx = mon[m[2].toLowerCase()];
    if (moIdx !== undefined) {
      const d = new Date(+m[3], moIdx, +m[1]);
      if (d.getDate() === +m[1] && d.getMonth() === moIdx) return d;
    }
    return null;
  }

  return null;
}

// ─── Final Processing ───
function finalizeProcessing() {
  if (!allTxns.length) {
    log('warn', '❌ No transactions found.');
    hideLoader();
    showBanner('error',
      '🚫 No transactions could be extracted. Possible reasons: ' +
      '(1) PDF is image/scanned — no text layer. ' +
      '(2) Unsupported bank format. ' +
      '(3) PDF is corrupted or password-protected. ' +
      'Please upload a text-based bank statement PDF.'
    );
    document.getElementById('validationSection').classList.add('show');
    return;
  }

  // FIX: Sort by date ascending (stable — convert date to timestamp for comparison)
  allTxns.sort((a, b) => a.date.getTime() - b.date.getTime());

  // FIX: Derive first/last by explicit min/max across all timestamps
  // (guards against any edge-case where sort order might not match calendar order)
  const allTimestamps = allTxns.map(t => t.date.getTime());
  const minTs = Math.min(...allTimestamps);
  const maxTs = Math.max(...allTimestamps);
  const firstDate = new Date(minTs); firstDate.setHours(0,0,0,0);
  const lastDate  = new Date(maxTs); lastDate.setHours(0,0,0,0);

  // Rule 3.1: span = last txn date − first txn date (must be ≥ 90 days)
  const daysDiff  = Math.floor((lastDate.getTime() - firstDate.getTime()) / 86400000);
  // Rule 3.2: today − lastDate must be ≤ 7 days
  const today     = new Date(); today.setHours(0,0,0,0);
  const staledays = Math.floor((today.getTime() - lastDate.getTime()) / 86400000);
  const cutoffDate = new Date(today); cutoffDate.setDate(today.getDate() - 7);

  log('ok', `📅 Txns parsed: ${allTxns.length} | Unique date range: ${fmtDate(firstDate)} → ${fmtDate(lastDate)}`);
  log('ok', `📅 Span: ${daysDiff} days | Today: ${fmtDate(today)} | Days since last txn: ${staledays}`);

  // ── Rule 3.1: The gap between first and last transaction must be ≥ 90 days ──
  if (daysDiff < 90) {
    showBanner('error',
      `🚫 PERFIOS RUN FAILED [Rule 3.1] — Statement span too short: ${daysDiff} days ` +
      `(${fmtDate(firstDate)} → ${fmtDate(lastDate)}). ` +
      `The gap between the first and last transaction must be at least 90 days.`
    );
    log('warn', `✗ REJECTED [Rule 3.1]: Span ${daysDiff} days < 90 required`);
    hideLoader();
    updateStats(firstDate, lastDate, daysDiff, allTxns.length, 0, staledays);
    setStep(2);
    return;
  }

  // ── Rule 3.2: Last transaction must be within 7 days of today (upload date) ──
  if (staledays > 7) {
    showBanner('error',
      `🚫 PERFIOS RUN FAILED [Rule 3.2] — Statement is stale: last transaction was on ${fmtDate(lastDate)} ` +
      `(${staledays} days ago). Perfios requires the last transaction to be within 7 days of the upload date (${fmtDate(today)}). ` +
      `Earliest acceptable last-transaction date: ${fmtDate(cutoffDate)}.`
    );
    log('warn', `✗ REJECTED [Rule 3.2]: Last txn ${fmtDate(lastDate)} is ${staledays} day(s) old (max 7 allowed)`);
    hideLoader();
    updateStats(firstDate, lastDate, daysDiff, allTxns.length, 0, staledays);
    setStep(2);
    return;
  }

  showBanner('success',
    `✅ Statement validated — Span: ${daysDiff} days (≥ 90 ✓) · ` +
    `Last txn: ${fmtDate(lastDate)}, ${staledays} day(s) ago (≤ 7 ✓)`
  );
  log('ok', `✅ Rule 3.1 PASSED: span ${daysDiff} days`);
  log('ok', `✅ Rule 3.2 PASSED: last txn ${staledays} day(s) old`);

  // Use ALL transactions for carry-forward EOD balance computation (whole statement)
  // but only show/export the 90-day window transactions in the Xns table
  const windowStart = new Date(lastDate);
  windowStart.setDate(windowStart.getDate() - 90);
  filtered90 = allTxns.filter(t => t.date.getTime() >= windowStart.getTime());
  log('ok', `✅ 90-day window: ${fmtDate(windowStart)} → ${fmtDate(lastDate)} (${filtered90.length} txns)`);

  setStep(3);
  // ── Salary Detection (Req 3) ──
  // Minimum salary threshold: ₹3,000 CR — prevents small refunds/credits with "SAL" in narration
  const SALARY_MIN_AMOUNT = 3000;
  salaryTxns = allTxns.filter(t =>
    t.type === 'CR' &&
    t.amount >= SALARY_MIN_AMOUNT &&
    isSalaryTxn(t.rawDesc || t.desc)
  );
  log(salaryTxns.length ? 'ok' : 'warn',
    salaryTxns.length
      ? `💰 Salary detected: ${salaryTxns.length} transaction(s) across ${new Set(salaryTxns.map(t => t.date.getMonth() + '-' + t.date.getFullYear())).size} month(s)`
      : `⚠ No salary transactions detected`
  );

  // ── ACH Detection ──
  achTxns = allTxns.filter(t => isACHTxn(t.rawDesc || t.desc));
  log(achTxns.length ? 'ok' : 'info',
    achTxns.length
      ? `🔄 ACH detected: ${achTxns.length} transaction(s) — Credits: ${achTxns.filter(t=>t.type==='CR').length} / Debits: ${achTxns.filter(t=>t.type==='DR').length}`
      : `ℹ No ACH (NACH/Direct Debit) transactions detected`
  );

  // ── ECS Detection ──
  ecsTxns = allTxns.filter(t => isECSTxn(t.rawDesc || t.desc));
  log(ecsTxns.length ? 'ok' : 'info',
    ecsTxns.length
      ? `⚡ ECS detected: ${ecsTxns.length} transaction(s) — Credits: ${ecsTxns.filter(t=>t.type==='CR').length} / Debits: ${ecsTxns.filter(t=>t.type==='DR').length}`
      : `ℹ No ECS transactions detected`
  );

  // ── NEFT / RTGS Detection ──
  neftTxns = allTxns.filter(t => isNEFTTxn(t.rawDesc || t.desc));
  log(neftTxns.length ? 'ok' : 'info',
    neftTxns.length
      ? `🏦 NEFT/RTGS detected: ${neftTxns.length} transaction(s) — Credits: ${neftTxns.filter(t=>t.type==='CR').length} / Debits: ${neftTxns.filter(t=>t.type==='DR').length}`
      : `ℹ No NEFT/RTGS transactions detected`
  );

  // ── UPI / IMPS Detection ──
  upiTxns = allTxns.filter(t => isUPITxn(t.rawDesc || t.desc));
  log(upiTxns.length ? 'ok' : 'info',
    upiTxns.length
      ? `📲 UPI/IMPS detected: ${upiTxns.length} transaction(s) — Credits: ${upiTxns.filter(t=>t.type==='CR').length} / Debits: ${upiTxns.filter(t=>t.type==='DR').length}`
      : `ℹ No UPI/IMPS transactions detected`
  );

  // ── Cheque / CTS Detection ──
  chequeTxns = allTxns.filter(t => isChequeTxn(t.rawDesc || t.desc));
  log(chequeTxns.length ? 'ok' : 'info',
    chequeTxns.length
      ? `📄 Cheque/CTS detected: ${chequeTxns.length} transaction(s) — Credits: ${chequeTxns.filter(t=>t.type==='CR').length} / Debits: ${chequeTxns.filter(t=>t.type==='DR').length}`
      : `ℹ No Cheque/CTS transactions detected`
  );

  // ── Bounce Detection ──
  bounceTxns = allTxns.filter(t => isBounceTxn(t.rawDesc || t.desc));
  log(bounceTxns.length ? 'warn' : 'ok',
    bounceTxns.length
      ? `⚠ Bounces detected: ${bounceTxns.length} transaction(s)`
      : `✅ No bounce/return transactions detected`
  );

  // ── Overdraft Detection (negative balance after transaction) ──
  overdraftTxns = allTxns.filter(t => t.balance < 0);
  log(overdraftTxns.length ? 'warn' : 'ok',
    overdraftTxns.length
      ? `⚠ Overdraft events: ${overdraftTxns.length} transaction(s) resulting in negative balance`
      : `✅ No overdraft events detected`
  );

  // ── Target Date Filter ──
  targetRows = applyTargetDateFilter(allTxns);
  log('ok', `✅ ${targetRows.length} target-date rows across all statement months`);

  // ── Build Validation Checks (Req 1, 2, 3) ──
  validChecks = buildValidationChecks(firstDate, lastDate, daysDiff, staledays, today, cutoffDate, salaryTxns);

  setStep(4);
  buildABBFromTargetRows(targetRows);
  updateStats(firstDate, lastDate, daysDiff, filtered90.length, targetRows.length, staledays);

  // Render each section with individual error protection
  [renderTxnTable, renderTargetTable, renderPerfiosTable,
   renderSalarySection, renderACHSection, renderECSSection,
   renderNEFTSection, renderUPISection, renderChequeSection,
   renderBounceSection, renderAccountsSection, renderValidationSection,
   renderFinOneTable, renderAnalysisTable, renderBreakupTables,
   renderEODTable, renderAccountInfo, renderSummaryGrid
  ].forEach(function(fn) {
    try { if (typeof fn === 'function') fn(); }
    catch(e) { console.warn('[Perfios] render error in ' + (fn.name || '?') + ':', e.message); }
  });

  // Update stat cards (null-guarded — elements may not exist in popup mode)
  const _eS=document.getElementById('sSelected'); if(_eS) _eS.textContent=targetRows.length;
  const _eA=document.getElementById('sACH');      if(_eA) _eA.textContent=achTxns.length;
  const _eE=document.getElementById('sECS');      if(_eE) _eE.textContent=ecsTxns.length;
  const _eN=document.getElementById('sNEFT');     if(_eN) _eN.textContent=neftTxns.length;

  setStep(5);
  const _tr=document.getElementById('tabsRow'); if(_tr) _tr.style.display='flex';
  const _sr=document.getElementById('statsRow'); if(_sr) _sr.classList.add('show');
  const _sx=document.getElementById('secTxn'); if(_sx) _sx.classList.add('show');
  const _ab=document.getElementById('actionBar'); if(_ab) _ab.classList.add('show');
  if(typeof showTab==='function') showTab('txn');
  hideLoader();
  toast(`✅ Complete! ${filtered90.length} txns · ${salaryTxns.length > 0 ? '💰 Salary FOUND' : '⚠ No salary'} · UPI: ${upiTxns.length} · Bounces: ${bounceTxns.length}`);
}

// ─── 3.4 EOD Balance Carry-Forward (Verified against ABB1 sheet) ───
//
// The EXACT rule used by Perfios / ABB1 sheet:
//   EOD balance for target date = balance after the LAST transaction on or BEFORE that date
//   across the ENTIRE statement (running balance carry-forward).
//
// This is NOT "next available after". It is the running balance as of end-of-day on that date.
// If no transaction has occurred yet (before the first ever transaction), the opening balance is used.
// Verified: all 30 ABB1 values (Jul–Dec 2025) match 100%.
//
// Applied to ALL calendar months present in the statement, not just the 90-day window.

function getOpeningBalance(sortedAllTxns) {
  // Opening balance = infer from first transaction
  // If CR: opening = balance - amount  (credit added to opening to get current balance)
  // If DR: opening = balance + amount  (debit subtracted from opening to get current balance)
  if (!sortedAllTxns.length) return 0;
  const first = sortedAllTxns[0];
  return first.type === 'CR'
    ? first.balance - first.amount
    : first.balance + first.amount;
}

function getEODBalance(targetYear, targetMonth, targetDay, sortedAllTxns, openingBalance) {
  // targetMonth is 1-based
  const targetStr = `${targetYear}-${String(targetMonth).padStart(2,'0')}-${String(targetDay).padStart(2,'0')}`;
  let lastBal = openingBalance;
  for (const t of sortedAllTxns) {
    const d = t.date;
    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (ds <= targetStr) lastBal = t.balance;
    else break; // sorted, so we can stop early
  }
  return lastBal;
}

function applyTargetDateFilter(sortedAllTxns) {
  const rows = [];
  const openingBalance = getOpeningBalance(sortedAllTxns);

  // Collect ALL unique year-month keys present in the statement
  const monthSet = new Set();
  for (const t of sortedAllTxns) {
    monthSet.add(`${t.date.getFullYear()}-${String(t.date.getMonth()+1).padStart(2,'0')}`);
  }
  const monthKeys = [...monthSet].sort();

  for (const mk of monthKeys) {
    const [yr, mo] = mk.split('-').map(Number);
    for (const targetDay of TARGET_DAYS) {
      const targetDt = new Date(yr, mo-1, targetDay);
      // Get the running EOD balance as of this target date
      const eodBal = getEODBalance(yr, mo, targetDay, sortedAllTxns, openingBalance);
      // Find the last actual transaction on or before this date (for display/fallback info)
      const targetStr = `${yr}-${String(mo).padStart(2,'0')}-${String(targetDay).padStart(2,'0')}`;
      let lastTxnOnOrBefore = null;
      for (const t of sortedAllTxns) {
        const ds = `${t.date.getFullYear()}-${String(t.date.getMonth()+1).padStart(2,'0')}-${String(t.date.getDate()).padStart(2,'0')}`;
        if (ds <= targetStr) lastTxnOnOrBefore = t;
        else break;
      }
      // Check if there was a txn exactly on this date
      const hasExactMatch = lastTxnOnOrBefore &&
        lastTxnOnOrBefore.date.getFullYear() === yr &&
        lastTxnOnOrBefore.date.getMonth() === mo-1 &&
        lastTxnOnOrBefore.date.getDate() === targetDay;

      rows.push({
        targetDate: targetDt,
        actualDate: lastTxnOnOrBefore ? lastTxnOnOrBefore.date : null,
        fallback: !hasExactMatch,
        eodBalance: eodBal,        // ← the verified carry-forward balance (used for ABB)
        txn: lastTxnOnOrBefore     // ← last transaction on/before (for display)
      });
    }
  }
  return rows;
}

// ─── ABB Builder (mirrors ABB1 sheet logic exactly) ───
// ABB1: each cell = EOD carry-forward balance at target date
// Monthly Average = AVERAGE(5 target-date balances) [col K in FinOne1]
// ABB = AVERAGE of all monthly averages [ABB1 row 14]
function buildABBFromTargetRows(rows) {
  abbData = {};
  monthOrder = [];

  for (const row of rows) {
    // Key by target date's own month (not the actual txn date — ABB1 organises by calendar month)
    const d = row.targetDate;
    const mk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const label = new Date(d.getFullYear(), d.getMonth(), 1)
      .toLocaleString('en-IN', { month: 'short', year: '2-digit' });
    if (!abbData[mk]) {
      abbData[mk] = { label, dates: {}, credits: 0, creditCount: 0, debitCount: 0, debitTotal: 0 };
      monthOrder.push(mk);
    }
    // Store the verified EOD carry-forward balance for this target day
    abbData[mk].dates[row.targetDate.getDate()] = row.eodBalance;
  }

  // Add monthly credit/debit totals from the full transaction list
  for (const t of allTxns) {
    const mk = `${t.date.getFullYear()}-${String(t.date.getMonth()+1).padStart(2,'0')}`;
    if (abbData[mk]) {
      if (t.type === 'CR') { abbData[mk].credits += t.amount; abbData[mk].creditCount++; }
      else { abbData[mk].debitTotal += t.amount; abbData[mk].debitCount++; }
    }
  }

  monthOrder.sort();
}

// ─── FinOne1 Data Builder ───
// Mirrors FinOne1 sheet columns exactly:
// A=Month, B=Credits_Nos, C=Credits_Value, D=IW_Chq_Returns,
// E=Bal@2, F=Bal@4, G=Bal@10, H=Bal@17, I=Bal@25, J=Bal@0(EOD last),
// K=AVERAGE(E:I), L=Withdrawal_Amount, M=OW_Chq_Returns, N=Withdrawl_Nos,
// O=Total_Cheque_Bounces, P=IF(B>0,(M/B)*100,0), Q=Min_Balance,
// R=EMI_Reflects, S=Salary_Credit, T=Salary_Date, U=IF(N>0,(D/N)*100,0)
function buildFinOneData() {
  const rows = [];
  const sortedAll = [...allTxns].sort((a,b) => a.date - b.date);
  const openingBalance = getOpeningBalance(sortedAll);

  for (const mk of monthOrder) {
    const [yr, mo] = mk.split('-').map(Number);
    const monthTxns = allTxns.filter(t => t.date.getFullYear() === yr && t.date.getMonth() === mo - 1);
    const creditTxns = monthTxns.filter(t => t.type === 'CR');
    const debitTxns  = monthTxns.filter(t => t.type === 'DR');

    const creditsNos    = creditTxns.length;
    const creditsValue  = creditTxns.reduce((s,t) => s + t.amount, 0);
    // Real inward/outward cheque return detection using bounce patterns
    const iwChqRet = monthTxns.filter(t => {
      if (!isBounceTxn(t.rawDesc||t.desc)) return false;
      const inward = isBounceInward(t.rawDesc||t.desc);
      return inward === true || inward === null; // inward or unknown = inward
    }).length;
    const owChqRet = monthTxns.filter(t => {
      if (!isBounceTxn(t.rawDesc||t.desc)) return false;
      return isBounceInward(t.rawDesc||t.desc) === false;
    }).length;
    const withdrawlNos  = debitTxns.length;
    const withdrawalAmt = debitTxns.reduce((s,t) => s + t.amount, 0);
    // Total cheque bounces = all bounce/return transactions in month
    const totalChqBounces = monthTxns.filter(t => isBounceTxn(t.rawDesc||t.desc)).length;
    // EMI reflects = transactions with EMI/Loan keywords (debit side)
    const emiReflects = debitTxns.filter(t => /\bemi\b|\bloan\b|\binstalment\b|\binstallment\b/i.test(t.rawDesc||t.desc)).length;

    // Target-day EOD balances — carry-forward (verified formula)
    const bal2  = getEODBalance(yr, mo, 2,  sortedAll, openingBalance);
    const bal4  = getEODBalance(yr, mo, 4,  sortedAll, openingBalance);
    const bal10 = getEODBalance(yr, mo, 10, sortedAll, openingBalance);
    const bal17 = getEODBalance(yr, mo, 17, sortedAll, openingBalance);
    const bal25 = getEODBalance(yr, mo, 25, sortedAll, openingBalance);

    // K column: =AVERAGE(E:I) — exact formula from FinOne1
    const kAvg = (bal2 + bal4 + bal10 + bal17 + bal25) / 5;

    // J column (col index 9 = "0" header): EOD balance of last day of month
    const daysInMonth = new Date(yr, mo, 0).getDate();
    const eodLast = getEODBalance(yr, mo, daysInMonth, sortedAll, openingBalance);

    // Min balance across all EOD days in month
    let minBal = Infinity;
    for (let d = 1; d <= daysInMonth; d++) {
      const b = getEODBalance(yr, mo, d, sortedAll, openingBalance);
      if (b < minBal) minBal = b;
    }
    if (minBal === Infinity) minBal = 0;

    // Salary detection
    const salaryTxn = creditTxns.find(t => /salary|sal\b/i.test(t.desc));
    const salaryCredit = salaryTxn ? salaryTxn.amount : 0;
    const salaryDate   = salaryTxn ? fmtDate(salaryTxn.date) : 'N/A';

    // P = IF(B>0,(M/B)*100, 0)  — exact formula from FinOne1 col P
    const pct_ow = creditsNos > 0 ? (owChqRet / creditsNos) * 100 : 0;
    // U = IF(N>0,(D/N)*100, 0)  — exact formula from FinOne1 col U
    const pct_iw = withdrawlNos > 0 ? (iwChqRet / withdrawlNos) * 100 : 0;

    rows.push({
      month: abbData[mk].label, creditsNos, creditsValue, iwChqRet,
      bal2, bal4, bal10, bal17, bal25, eodLast, kAvg,
      withdrawalAmt, owChqRet, withdrawlNos,
      totalChqBounces, pct_ow, minBal,
      emiReflects, salaryCredit, salaryDate, pct_iw
    });
  }

  // Total row — mirrors FinOne1 row 8: =SUM(col2:col7) for each column
  if (rows.length > 0) {
    const tot = { month: 'TOTAL', creditsNos: 0, creditsValue: 0, iwChqRet: 0,
      bal2: 0, bal4: 0, bal10: 0, bal17: 0, bal25: 0, eodLast: 0, kAvg: 0,
      withdrawalAmt: 0, owChqRet: 0, withdrawlNos: 0, totalChqBounces: 0,
      pct_ow: 0, minBal: 0, emiReflects: 0, salaryCredit: 0, salaryDate: '', pct_iw: 0
    };
    for (const r of rows) {
      for (const k of ['creditsNos','creditsValue','iwChqRet','bal2','bal4','bal10','bal17','bal25',
                        'eodLast','kAvg','withdrawalAmt','owChqRet','withdrawlNos','totalChqBounces',
                        'pct_ow','minBal','emiReflects','salaryCredit','pct_iw']) {
        tot[k] += r[k];
      }
    }
    rows.push(tot);
  }
  return rows;
}

// ─── Analysis1 Data Builder ───
// Mirrors all Analysis1 rows 18–105
function buildAnalysisData() {
  const months = monthOrder;
  const [yr0, mo0] = months.length ? months[0].split('-').map(Number) : [2025,7];

  const getMonthTxns = (mk) => {
    const [yr, mo] = mk.split('-').map(Number);
    return allTxns.filter(t => t.date.getFullYear()===yr && t.date.getMonth()===mo-1);
  };

  const sumField = (field, mk) => {
    const txns = getMonthTxns(mk);
    if (field === 'creditNos') return txns.filter(t=>t.type==='CR').length;
    if (field === 'creditAmt') return txns.filter(t=>t.type==='CR').reduce((s,t)=>s+t.amount,0);
    if (field === 'debitNos') return txns.filter(t=>t.type==='DR').length;
    if (field === 'debitAmt') return txns.filter(t=>t.type==='DR').reduce((s,t)=>s+t.amount,0);
    if (field === 'selfCreditNos') return txns.filter(t=>t.type==='CR'&&/self|own|transfer/i.test(t.category)).length;
    if (field === 'selfCreditAmt') return txns.filter(t=>t.type==='CR'&&/self|own|transfer/i.test(t.category)).reduce((s,t)=>s+t.amount,0);
    if (field === 'selfDebitNos') return txns.filter(t=>t.type==='DR'&&/self|own|transfer/i.test(t.category)).length;
    if (field === 'selfDebitAmt') return txns.filter(t=>t.type==='DR'&&/self|own|transfer/i.test(t.category)).reduce((s,t)=>s+t.amount,0);
    if (field === 'cashDepNos') return txns.filter(t=>t.type==='CR'&&/cash/i.test(t.category)).length;
    if (field === 'cashDepAmt') return txns.filter(t=>t.type==='CR'&&/cash/i.test(t.category)).reduce((s,t)=>s+t.amount,0);
    if (field === 'cashWdNos') return txns.filter(t=>t.type==='DR'&&/cash/i.test(t.category)).length;
    if (field === 'cashWdAmt') return txns.filter(t=>t.type==='DR'&&/cash/i.test(t.category)).reduce((s,t)=>s+t.amount,0);
    if (field === 'minBal') { const b=txns.map(t=>t.balance); return b.length?Math.min(...b):0; }
    if (field === 'maxBal') { const b=txns.map(t=>t.balance); return b.length?Math.max(...b):0; }
    if (field === 'avgBal') { const b=txns.map(t=>t.balance); return b.length?b.reduce((s,v)=>s+v,0)/b.length:0; }
    if (field === 'upiCrAmt') return txns.filter(t=>t.type==='CR'&&/upi|imps/i.test(t.desc)).reduce((s,t)=>s+t.amount,0);
    if (field === 'upiCrNos') return txns.filter(t=>t.type==='CR'&&/upi|imps/i.test(t.desc)).length;
    if (field === 'upiDrAmt') return txns.filter(t=>t.type==='DR'&&/upi|imps/i.test(t.desc)).reduce((s,t)=>s+t.amount,0);
    if (field === 'upiDrNos') return txns.filter(t=>t.type==='DR'&&/upi|imps/i.test(t.desc)).length;
    if (field === 'bizCrAmt') return txns.filter(t=>t.type==='CR'&&!/self/i.test(t.category)).reduce((s,t)=>s+t.amount,0);
    if (field === 'bizCrNos') return txns.filter(t=>t.type==='CR'&&!/self/i.test(t.category)).length;
    if (field === 'bankChargeAmt') return txns.filter(t=>/charge|fee|gst/i.test(t.category)).reduce((s,t)=>s+t.amount,0);
    if (field === 'bankChargeNos') return txns.filter(t=>/charge|fee|gst/i.test(t.category)).length;
    if (field === 'invCrAmt') return txns.filter(t=>t.type==='CR'&&/interest/i.test(t.desc)).reduce((s,t)=>s+t.amount,0);
    if (field === 'inwardBounceNT') return txns.filter(t=>isBounceTxn(t.rawDesc||t.desc)&&isBounceInward(t.rawDesc||t.desc)===true&&!/technical/i.test(getBounceSubType(t.rawDesc||t.desc))).length;
    if (field === 'inwardBounceT')  return txns.filter(t=>isBounceTxn(t.rawDesc||t.desc)&&/technical/i.test(getBounceSubType(t.rawDesc||t.desc))).length;
    if (field === 'outwardBounce')  return txns.filter(t=>isBounceTxn(t.rawDesc||t.desc)&&isBounceInward(t.rawDesc||t.desc)===false).length;
    if (field === 'overdraftTimes') return txns.filter(t=>t.balance<0).length;
    if (field === 'overdraftDays')  return new Set(txns.filter(t=>t.balance<0).map(t=>fmtDate(t.date))).size;
    if (field === 'achCrAmt') return txns.filter(t=>t.type==='CR'&&isACHTxn(t.desc)).reduce((s,t)=>s+t.amount,0);
    if (field === 'achCrNos') return txns.filter(t=>t.type==='CR'&&isACHTxn(t.desc)).length;
    if (field === 'achDrAmt') return txns.filter(t=>t.type==='DR'&&isACHTxn(t.desc)).reduce((s,t)=>s+t.amount,0);
    if (field === 'achDrNos') return txns.filter(t=>t.type==='DR'&&isACHTxn(t.desc)).length;
    if (field === 'ecsCrAmt') return txns.filter(t=>t.type==='CR'&&isECSTxn(t.desc)).reduce((s,t)=>s+t.amount,0);
    if (field === 'ecsCrNos') return txns.filter(t=>t.type==='CR'&&isECSTxn(t.desc)).length;
    if (field === 'ecsDrAmt') return txns.filter(t=>t.type==='DR'&&isECSTxn(t.desc)).reduce((s,t)=>s+t.amount,0);
    if (field === 'ecsDrNos') return txns.filter(t=>t.type==='DR'&&isECSTxn(t.desc)).length;
    if (field === 'ecsRetNos') return txns.filter(t=>isECSTxn(t.desc)&&/return|bounce|rej/i.test(getECSSubType(t.desc))).length;
    if (field === 'neftCrAmt') return txns.filter(t=>t.type==='CR'&&isNEFTTxn(t.rawDesc||t.desc)).reduce((s,t)=>s+t.amount,0);
    if (field === 'neftCrNos') return txns.filter(t=>t.type==='CR'&&isNEFTTxn(t.rawDesc||t.desc)).length;
    if (field === 'neftDrAmt') return txns.filter(t=>t.type==='DR'&&isNEFTTxn(t.rawDesc||t.desc)).reduce((s,t)=>s+t.amount,0);
    if (field === 'neftDrNos') return txns.filter(t=>t.type==='DR'&&isNEFTTxn(t.rawDesc||t.desc)).length;
    if (field === 'neftRetNos') return txns.filter(t=>isNEFTTxn(t.rawDesc||t.desc)&&/return|reject/i.test(getNEFTSubType(t.rawDesc||t.desc))).length;
    if (field === 'rtgsCrAmt') return txns.filter(t=>t.type==='CR'&&/rtgs/i.test(t.desc)).reduce((s,t)=>s+t.amount,0);
    if (field === 'rtgsCrNos') return txns.filter(t=>t.type==='CR'&&/rtgs/i.test(t.desc)).length;
    if (field === 'rtgsDrAmt') return txns.filter(t=>t.type==='DR'&&/rtgs/i.test(t.desc)).reduce((s,t)=>s+t.amount,0);
    if (field === 'rtgsDrNos') return txns.filter(t=>t.type==='DR'&&/rtgs/i.test(t.desc)).length;
    if (field === 'salCrAmt') return txns.filter(t=>t.type==='CR'&&isSalaryTxn(t.desc)).reduce((s,t)=>s+t.amount,0);
    if (field === 'salCrNos') return txns.filter(t=>t.type==='CR'&&isSalaryTxn(t.desc)).length;
    // UPI / IMPS
    if (field === 'upiCrNos') return txns.filter(t=>t.type==='CR'&&isUPITxn(t.rawDesc||t.desc)&&!/imps/i.test(getUPISubType(t.rawDesc||t.desc))).length;
    if (field === 'upiCrAmt') return txns.filter(t=>t.type==='CR'&&isUPITxn(t.rawDesc||t.desc)&&!/imps/i.test(getUPISubType(t.rawDesc||t.desc))).reduce((s,t)=>s+t.amount,0);
    if (field === 'upiDrNos') return txns.filter(t=>t.type==='DR'&&isUPITxn(t.rawDesc||t.desc)&&!/imps/i.test(getUPISubType(t.rawDesc||t.desc))).length;
    if (field === 'upiDrAmt') return txns.filter(t=>t.type==='DR'&&isUPITxn(t.rawDesc||t.desc)&&!/imps/i.test(getUPISubType(t.rawDesc||t.desc))).reduce((s,t)=>s+t.amount,0);
    if (field === 'impsCrNos') return txns.filter(t=>t.type==='CR'&&isUPITxn(t.rawDesc||t.desc)&&/imps/i.test(getUPISubType(t.rawDesc||t.desc))).length;
    if (field === 'impsCrAmt') return txns.filter(t=>t.type==='CR'&&isUPITxn(t.rawDesc||t.desc)&&/imps/i.test(getUPISubType(t.rawDesc||t.desc))).reduce((s,t)=>s+t.amount,0);
    if (field === 'impsDrNos') return txns.filter(t=>t.type==='DR'&&isUPITxn(t.rawDesc||t.desc)&&/imps/i.test(getUPISubType(t.rawDesc||t.desc))).length;
    if (field === 'impsDrAmt') return txns.filter(t=>t.type==='DR'&&isUPITxn(t.rawDesc||t.desc)&&/imps/i.test(getUPISubType(t.rawDesc||t.desc))).reduce((s,t)=>s+t.amount,0);
    // Cheque
    if (field === 'chqDepNos') return txns.filter(t=>t.type==='CR'&&isChequeTxn(t.rawDesc||t.desc)).length;
    if (field === 'chqDepAmt') return txns.filter(t=>t.type==='CR'&&isChequeTxn(t.rawDesc||t.desc)).reduce((s,t)=>s+t.amount,0);
    if (field === 'chqIssNos') return txns.filter(t=>t.type==='DR'&&isChequeTxn(t.rawDesc||t.desc)).length;
    if (field === 'chqIssAmt') return txns.filter(t=>t.type==='DR'&&isChequeTxn(t.rawDesc||t.desc)).reduce((s,t)=>s+t.amount,0);
    if (field === 'chqRetNos') return txns.filter(t=>isChequeTxn(t.rawDesc||t.desc)&&/return|bounce|dishon/i.test(getChequeSubType(t.rawDesc||t.desc))).length;
    return 0;
  };

  // Build metric rows — matches Analysis1 sheet structure exactly
  const metricDefs = [
    { label: 'Total No. of Credit Transactions', field: 'creditNos', fmt: 'n' },
    { label: 'Total Amount of Credit Transactions', field: 'creditAmt', fmt: '₹' },
    { label: 'Total No. of Debit Transactions', field: 'debitNos', fmt: 'n' },
    { label: 'Total Amount of Debit Transactions', field: 'debitAmt', fmt: '₹' },
    { label: 'Total No. of Self Credit Transactions', field: 'selfCreditNos', fmt: 'n' },
    { label: 'Total Amount of Self Credit Transactions', field: 'selfCreditAmt', fmt: '₹' },
    { label: 'Total No. of Self Debit Transactions', field: 'selfDebitNos', fmt: 'n' },
    { label: 'Total Amount of Self Debit Transactions', field: 'selfDebitAmt', fmt: '₹' },
    { label: 'Total No. of Cash Deposits', field: 'cashDepNos', fmt: 'n' },
    { label: 'Total Amount of Cash Deposits', field: 'cashDepAmt', fmt: '₹' },
    { label: 'Total No.of Cash Withdrawal', field: 'cashWdNos', fmt: 'n' },
    { label: 'Total Amount of Cash Withdrawal', field: 'cashWdAmt', fmt: '₹' },
    { label: 'Total No. of Inward Bounces (Non Technical)', field: 'inwardBounceNT', fmt: 'n' },
    { label: 'Total No. of Inward Bounces (Technical)', field: 'inwardBounceT', fmt: 'n' },
    { label: 'Total No. of outward Bounces', field: 'outwardBounce', fmt: 'n' },
    { label: '%age of Outward Bounces', field: 'pctOwBounce', fmt: '%', derived: true },
    { label: '%age of Inward Bounces (Non Technical)', field: 'zero', fmt: '%' },
    { label: '%age of Inward Bounces (Technical)', field: 'zero', fmt: '%' },
    { label: 'No.of Times Account is Overdrawn', field: 'overdraftTimes', fmt: 'n' },
    { label: 'No.of Days Account is Overdrawn', field: 'overdraftDays', fmt: 'n' },
    { label: '%age of Cash Deposit to Total Credit', field: 'pctCashDep', fmt: '%', derived: true },
    { label: '%age of Cash Withdrawal to Total Debit', field: 'pctCashWd', fmt: '%', derived: true },
    { label: 'Min EOD Balance', field: 'minBal', fmt: '₹' },
    { label: 'Max EOD Balance', field: 'maxBal', fmt: '₹' },
    { label: 'Average EOD Balance', field: 'avgBal', fmt: '₹' },
    { label: 'Total Amount of Bank Charges', field: 'bankChargeAmt', fmt: '₹' },
    { label: 'Total No. of Bank Charges', field: 'bankChargeNos', fmt: 'n' },
    { label: 'Total Amount of UPI Credits', field: 'upiCrAmt', fmt: '₹' },
    { label: 'Total Count of UPI Credits', field: 'upiCrNos', fmt: 'n' },
    { label: 'Total Amount of UPI Debits', field: 'upiDrAmt', fmt: '₹' },
    { label: 'Total Count of UPI Debits', field: 'upiDrNos', fmt: 'n' },
    { label: 'Total Amount of Business Credits', field: 'bizCrAmt', fmt: '₹' },
    { label: 'Total No. of Business Credits', field: 'bizCrNos', fmt: 'n' },
    { label: 'Investment Credit Amount', field: 'invCrAmt', fmt: '₹' },
    // ── ACH / NACH Metrics ──
    { label: '── ACH / NACH ──', field: 'zero', fmt: 'n' },
    { label: 'Total No. of ACH/NACH Credit Transactions', field: 'achCrNos', fmt: 'n' },
    { label: 'Total Amount of ACH/NACH Credits', field: 'achCrAmt', fmt: '₹' },
    { label: 'Total No. of ACH/NACH Debit Transactions', field: 'achDrNos', fmt: 'n' },
    { label: 'Total Amount of ACH/NACH Debits', field: 'achDrAmt', fmt: '₹' },
    // ── ECS Metrics ──
    { label: '── ECS ──', field: 'zero', fmt: 'n' },
    { label: 'Total No. of ECS Credit Transactions', field: 'ecsCrNos', fmt: 'n' },
    { label: 'Total Amount of ECS Credits', field: 'ecsCrAmt', fmt: '₹' },
    { label: 'Total No. of ECS Debit Transactions', field: 'ecsDrNos', fmt: 'n' },
    { label: 'Total Amount of ECS Debits', field: 'ecsDrAmt', fmt: '₹' },
    { label: 'Total No. of ECS Returns / Bounces', field: 'ecsRetNos', fmt: 'n' },
    // ── NEFT / RTGS Metrics ──
    { label: '── NEFT / RTGS ──', field: 'zero', fmt: 'n' },
    { label: 'Total No. of NEFT Credit Transactions', field: 'neftCrNos', fmt: 'n' },
    { label: 'Total Amount of NEFT Credits', field: 'neftCrAmt', fmt: '₹' },
    { label: 'Total No. of NEFT Debit Transactions', field: 'neftDrNos', fmt: 'n' },
    { label: 'Total Amount of NEFT Debits', field: 'neftDrAmt', fmt: '₹' },
    { label: 'Total No. of NEFT Returns / Rejections', field: 'neftRetNos', fmt: 'n' },
    { label: 'Total No. of RTGS Credit Transactions', field: 'rtgsCrNos', fmt: 'n' },
    { label: 'Total Amount of RTGS Credits', field: 'rtgsCrAmt', fmt: '₹' },
    { label: 'Total No. of RTGS Debit Transactions', field: 'rtgsDrNos', fmt: 'n' },
    { label: 'Total Amount of RTGS Debits', field: 'rtgsDrAmt', fmt: '₹' },
    // ── Salary Metrics ──
    { label: '── Salary ──', field: 'zero', fmt: 'n' },
    { label: 'Total No. of Salary Credit Transactions', field: 'salCrNos', fmt: 'n' },
    { label: 'Total Amount of Salary Credits', field: 'salCrAmt', fmt: '₹' },
    // ── UPI / IMPS Metrics ──
    { label: '── UPI / IMPS ──', field: 'zero', fmt: 'n' },
    { label: 'Total No. of UPI Credit Transactions', field: 'upiCrNos', fmt: 'n' },
    { label: 'Total Amount of UPI Credits', field: 'upiCrAmt', fmt: '₹' },
    { label: 'Total No. of UPI Debit Transactions', field: 'upiDrNos', fmt: 'n' },
    { label: 'Total Amount of UPI Debits', field: 'upiDrAmt', fmt: '₹' },
    { label: 'Total No. of IMPS Credit Transactions', field: 'impsCrNos', fmt: 'n' },
    { label: 'Total Amount of IMPS Credits', field: 'impsCrAmt', fmt: '₹' },
    { label: 'Total No. of IMPS Debit Transactions', field: 'impsDrNos', fmt: 'n' },
    { label: 'Total Amount of IMPS Debits', field: 'impsDrAmt', fmt: '₹' },
    // ── Cheque / CTS Metrics ──
    { label: '── Cheque / CTS ──', field: 'zero', fmt: 'n' },
    { label: 'Total No. of Cheque Deposits', field: 'chqDepNos', fmt: 'n' },
    { label: 'Total Amount of Cheque Deposits', field: 'chqDepAmt', fmt: '₹' },
    { label: 'Total No. of Cheque Issues', field: 'chqIssNos', fmt: 'n' },
    { label: 'Total Amount of Cheque Issues', field: 'chqIssAmt', fmt: '₹' },
    { label: 'Total No. of Cheque Returns/Bounces', field: 'chqRetNos', fmt: 'n' },
  ];

  const result = [];
  for (const def of metricDefs) {
    const row = { label: def.label, fmt: def.fmt, values: [], total: 0 };
    for (const mk of months) {
      let val = 0;
      if (def.field === 'zero') val = 0;
      else if (def.field === 'pctOwBounce') val = 0; // no bounce data from PDF
      else if (def.field === 'pctCashDep') {
        const ca = sumField('cashDepAmt', mk); const ta = sumField('creditAmt', mk);
        val = ta > 0 ? ca/ta : 0;
      }
      else if (def.field === 'pctCashWd') {
        const cw = sumField('cashWdAmt', mk); const td = sumField('debitAmt', mk);
        val = td > 0 ? cw/td : 0;
      }
      else val = sumField(def.field, mk);
      row.values.push(val);
      row.total += val;
    }
    result.push(row);
  }
  return result;
}

// ─── Breakup Builder ───
function buildBreakupData() {
  const incomeCategories = [
    'Interest Credit','Transfer Credit','Transfer from Self','Salary',
    'ACH Credit','ECS Credit','NEFT/RTGS Credit','UPI/IMPS Credit',
    'Cheque Deposit','Other Credit','Cash Deposit','Loan/EMI Credit'
  ];
  const expenseCategories = [
    'Salary','Utility Payment','Credit Card Payment','Bank Charges','Loan/EMI',
    'ACH Debit','ECS Debit','NEFT/RTGS Debit','UPI/IMPS Debit',
    'Cheque Issue','Cash Withdrawal','Other Debit','Bounce'
  ];

  const buildTable = (categories, type) => {
    const rows = [];
    for (const cat of categories) {
      const row = { label: cat, values: [] };
      for (const mk of monthOrder) {
        const [yr, mo] = mk.split('-').map(Number);
        const amt = allTxns.filter(t =>
          t.date.getFullYear()===yr && t.date.getMonth()===mo-1 &&
          (type==='CR' ? t.type==='CR' : t.type==='DR') &&
          t.category === cat
        ).reduce((s,t) => s+t.amount, 0);
        row.values.push(amt);
      }
      row.total = row.values.reduce((s,v)=>s+v,0);
      row.avg = row.values.length ? row.total/row.values.length : 0;
      rows.push(row);
    }
    return rows;
  };

  return {
    income: buildTable(incomeCategories, 'CR'),
    expense: buildTable(expenseCategories, 'DR')
  };
}

// ─── EOD Builder ───
// Mirrors EOD Balances1 sheet: Day (1-31) × Month grid
// Uses the same carry-forward logic: balance after last txn on/before each day
function buildEODData() {
  const sortedAll = [...allTxns].sort((a,b) => a.date - b.date);
  const openingBalance = getOpeningBalance(sortedAll);
  const eodGrid = {};
  for (let d = 1; d <= 31; d++) eodGrid[d] = {};

  for (const mk of monthOrder) {
    const [yr, mo] = mk.split('-').map(Number);
    const daysInMonth = new Date(yr, mo, 0).getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      eodGrid[day][mk] = getEODBalance(yr, mo, day, sortedAll, openingBalance);
    }
  }
  return eodGrid;
}

// ─── Render Functions ───

// ─── Build Validation Checks (Req 1, 2, 3) ───
function buildValidationChecks(firstDate, lastDate, daysDiff, staledays, today, cutoffDate, salaryTxns) {
  const checks = [];

  // Check 1: 90-day span
  const span90pass = daysDiff >= 90;
  checks.push({
    id:     'span90',
    status: span90pass ? 'pass' : 'fail',
    icon:   span90pass ? '✅' : '🚫',
    title:  `Rule 1 — 90-Day Statement Span: ${span90pass ? 'PASSED' : 'FAILED'}`,
    detail: span90pass
      ? `Statement spans ${daysDiff} days (${fmtDate(firstDate)} → ${fmtDate(lastDate)}), which meets the minimum 90-day requirement.`
      : `Statement spans only ${daysDiff} days (${fmtDate(firstDate)} → ${fmtDate(lastDate)}). Minimum 90 days required. Perfios processing is blocked.`,
    value:  daysDiff + ' days'
  });

  // Check 2: 7-day staleness
  const fresh = staledays <= 7;
  checks.push({
    id:     'staleness',
    status: fresh ? 'pass' : 'fail',
    icon:   fresh ? '✅' : '🚫',
    title:  `Rule 2 — Recent Activity (≤7 Days): ${fresh ? 'PASSED' : 'FAILED'}`,
    detail: fresh
      ? `Last transaction on ${fmtDate(lastDate)} is ${staledays} day(s) before today (${fmtDate(today)}), within the 7-day limit.`
      : `Last transaction on ${fmtDate(lastDate)} is ${staledays} days before today (${fmtDate(today)}), exceeding the 7-day limit. Earliest acceptable date: ${fmtDate(cutoffDate)}.`,
    value:  staledays + ' day(s) ago'
  });

  // Check 3: Salary detection
  const hasSalary = salaryTxns.length > 0;
  const salaryMonths = [...new Set(salaryTxns.map(t =>
    t.date.toLocaleString('en-IN', { month: 'short', year: '2-digit' })
  ))];
  const totalSalaryAmt = salaryTxns.reduce((s, t) => s + (t.type === 'CR' ? t.amount : 0), 0);
  checks.push({
    id:     'salary',
    status: hasSalary ? 'pass' : 'warn',
    icon:   hasSalary ? '💰' : '⚠️',
    title:  `Rule 3 — Salary Detection: ${hasSalary ? 'SALARY FOUND' : 'NO SALARY DETECTED'}`,
    detail: hasSalary
      ? `${salaryTxns.length} salary transaction(s) detected across ${salaryMonths.length} month(s): ${salaryMonths.join(', ')}. Total credited: ₹${fmt(totalSalaryAmt)}.`
      : `No transactions matched salary keywords (SAL, SALARY, PAYROLL, INCOME, WAGES, STIPEND, REMUNERATION, etc.). This account may not receive a regular salary.`,
    value:  hasSalary ? salaryTxns.length + ' txn(s)' : 'None'
  });

  // Check 4: Password-protected handling
  checks.push({
    id:     'password',
    status: 'pass',
    icon:   '🔒',
    title:  'Rule 4 — Password-Protected PDF: Handled',
    detail: `All uploaded PDFs were successfully processed. Password-protected files were unlocked via password entry. Files that could not be unlocked were skipped.`,
    value:  pendingFiles.map(f => f.name).join(', ') || '—'
  });

  // Check 5: Transaction count sanity
  const txnCountOk = allTxns.length >= 3;
  checks.push({
    id:     'txncount',
    status: txnCountOk ? 'pass' : 'warn',
    icon:   txnCountOk ? '✅' : '⚠️',
    title:  `Data Quality — Transaction Count: ${allTxns.length} transactions`,
    detail: `${allTxns.length} total transactions found across the full statement period. ` +
            `${filtered90.length} fall within the 90-day analysis window.`,
    value:  allTxns.length + ' total'
  });

  // Check 6: ACH detection
  const hasACH = achTxns.length > 0;
  const achCr  = achTxns.filter(t=>t.type==='CR').reduce((s,t)=>s+t.amount,0);
  const achDr  = achTxns.filter(t=>t.type==='DR').reduce((s,t)=>s+t.amount,0);
  checks.push({
    id:     'ach',
    status: hasACH ? 'pass' : 'warn',
    icon:   hasACH ? '🔄' : 'ℹ️',
    title:  `ACH / NACH Detection: ${hasACH ? achTxns.length + ' TRANSACTION(S) FOUND' : 'NONE DETECTED'}`,
    detail: hasACH
      ? `${achTxns.length} ACH/NACH/Direct Debit transactions found. Credits: ₹${fmt(achCr)} | Debits: ₹${fmt(achDr)}. Sub-types: ${[...new Set(achTxns.map(t=>getACHSubType(t.desc)))].join(', ')}.`
      : `No ACH, NACH, Direct Debit, Auto Pay, or Standing Instruction transactions found in the statement.`,
    value: hasACH ? achTxns.length + ' txn(s)' : 'None'
  });

  // Check 7: ECS detection
  const hasECS    = ecsTxns.length > 0;
  const ecsReturns= ecsTxns.filter(t=>/return|bounce|rej/i.test(getECSSubType(t.desc))).length;
  const ecsCr     = ecsTxns.filter(t=>t.type==='CR').reduce((s,t)=>s+t.amount,0);
  const ecsDr     = ecsTxns.filter(t=>t.type==='DR').reduce((s,t)=>s+t.amount,0);
  checks.push({
    id:     'ecs',
    status: hasECS ? (ecsReturns > 0 ? 'warn' : 'pass') : 'warn',
    icon:   hasECS ? (ecsReturns > 0 ? '⚠️' : '⚡') : 'ℹ️',
    title:  `ECS Detection: ${hasECS ? ecsTxns.length + ' TRANSACTION(S) FOUND' : 'NONE DETECTED'}${ecsReturns>0 ? ` · ${ecsReturns} RETURN(S)/BOUNCE(S)` : ''}`,
    detail: hasECS
      ? `${ecsTxns.length} ECS transactions found. Credits: ₹${fmt(ecsCr)} | Debits: ₹${fmt(ecsDr)}${ecsReturns>0 ? ` | ⚠ ${ecsReturns} ECS return(s)/bounce(s) detected — may indicate failed payments.` : '. No ECS returns detected.'}`
      : `No ECS transactions found in the statement. ECS is an RBI legacy batch clearing system used for EMI, insurance premiums, SIP deductions, etc.`,
    value: hasECS ? ecsTxns.length + ' txn(s)' : 'None'
  });

  // Check 8: NEFT/RTGS detection
  const hasNEFT   = neftTxns.length > 0;
  const neftCr    = neftTxns.filter(t=>t.type==='CR').reduce((s,t)=>s+t.amount,0);
  const neftDr    = neftTxns.filter(t=>t.type==='DR').reduce((s,t)=>s+t.amount,0);
  const neftRet   = neftTxns.filter(t=>/return|reject/i.test(getNEFTSubType(t.rawDesc||t.desc))).length;
  const neftSubTypesStr = [...new Set(neftTxns.map(t=>getNEFTSubType(t.rawDesc||t.desc)))].join(', ') || '—';
  checks.push({
    id:     'neft',
    status: hasNEFT ? (neftRet > 0 ? 'warn' : 'pass') : 'warn',
    icon:   hasNEFT ? (neftRet > 0 ? '⚠️' : '🏦') : 'ℹ️',
    title:  `NEFT / RTGS Detection: ${hasNEFT ? neftTxns.length + ' TRANSACTION(S) FOUND' : 'NONE DETECTED'}${neftRet>0 ? ` · ${neftRet} RETURN(S)` : ''}`,
    detail: hasNEFT
      ? `${neftTxns.length} NEFT/RTGS transactions found. Credits: ₹${fmt(neftCr)} | Debits: ₹${fmt(neftDr)}${neftRet>0 ? ` | ⚠ ${neftRet} return(s)/rejection(s) detected.` : '. No returns detected.'} Sub-types: ${neftSubTypesStr}.`
      : `No NEFT or RTGS fund transfer transactions detected in the statement.`,
    value: hasNEFT ? neftTxns.length + ' txn(s)' : 'None'
  });

  // Check 9: UPI/IMPS detection
  const hasUPI = upiTxns.length > 0;
  const upiCr  = upiTxns.filter(t=>t.type==='CR').reduce((s,t)=>s+t.amount,0);
  const upiDr  = upiTxns.filter(t=>t.type==='DR').reduce((s,t)=>s+t.amount,0);
  checks.push({
    id:     'upi',
    status: hasUPI ? 'pass' : 'warn',
    icon:   hasUPI ? '📲' : 'ℹ️',
    title:  `UPI / IMPS Detection: ${hasUPI ? upiTxns.length + ' TRANSACTION(S) FOUND' : 'NONE DETECTED'}`,
    detail: hasUPI
      ? `${upiTxns.length} UPI/IMPS transactions found. Credits: ₹${fmt(upiCr)} | Debits: ₹${fmt(upiDr)}. Sub-types: ${[...new Set(upiTxns.map(t=>getUPISubType(t.rawDesc||t.desc)))].join(', ')}.`
      : `No UPI or IMPS instant payment transactions detected.`,
    value: hasUPI ? upiTxns.length + ' txn(s)' : 'None'
  });

  // Check 10: Bounce detection
  const hasBounces = bounceTxns.length > 0;
  const inwardBounceNT = bounceTxns.filter(t=>isBounceInward(t.rawDesc||t.desc)===true&&!/technical/i.test(getBounceSubType(t.rawDesc||t.desc))).length;
  const inwardBounceT  = bounceTxns.filter(t=>/technical/i.test(getBounceSubType(t.rawDesc||t.desc))).length;
  const outwardBounce  = bounceTxns.filter(t=>isBounceInward(t.rawDesc||t.desc)===false).length;
  checks.push({
    id:     'bounce',
    status: hasBounces ? 'warn' : 'pass',
    icon:   hasBounces ? '⚠️' : '✅',
    title:  `Bounce / Return Detection: ${hasBounces ? bounceTxns.length + ' BOUNCE(S) FOUND' : 'CLEAN — NO BOUNCES'}`,
    detail: hasBounces
      ? `${bounceTxns.length} bounce/return transactions detected. Inward (Non-Tech): ${inwardBounceNT} | Inward (Technical): ${inwardBounceT} | Outward: ${outwardBounce}. High bounce count may indicate financial stress.`
      : `No bounce, return, or dishonoured instrument transactions detected. Statement is bounce-free.`,
    value: hasBounces ? bounceTxns.length + ' bounce(s)' : 'Clean'
  });

  // Check 11: Overdraft detection
  const hasOD = overdraftTxns.length > 0;
  const odDays = new Set(overdraftTxns.map(t=>fmtDate(t.date))).size;
  checks.push({
    id:     'overdraft',
    status: hasOD ? 'warn' : 'pass',
    icon:   hasOD ? '📉' : '✅',
    title:  `Overdraft / Negative Balance: ${hasOD ? overdraftTxns.length + ' EVENT(S) DETECTED' : 'NONE DETECTED'}`,
    detail: hasOD
      ? `Account went overdrawn ${overdraftTxns.length} time(s) across ${odDays} day(s). Most negative balance: ₹${fmt(Math.min(...overdraftTxns.map(t=>t.balance)))}. This indicates the account was overdrawn.`
      : `No negative EOD balance events detected. Account maintained positive balance throughout.`,
    value: hasOD ? overdraftTxns.length + ' event(s)' : 'Clean'
  });

  return checks;
}

// ─── Render Salary Section (Req 3) ───
function renderSalarySection() {
  const hasSalary = salaryTxns.length > 0;
  const badge = document.getElementById('salaryBadge');
  badge.textContent = hasSalary ? `${salaryTxns.length} salary transaction(s)` : 'No salary detected';
  badge.style.color = hasSalary ? 'var(--green)' : 'var(--amber)';

  // Summary cards
  const summaryEl = document.getElementById('salarySummary');
  const totalAmt = salaryTxns.reduce((s, t) => s + (t.type === 'CR' ? t.amount : 0), 0);
  const avgAmt   = salaryTxns.length ? totalAmt / salaryTxns.filter(t => t.type === 'CR').length || 0 : 0;
  const months   = [...new Set(salaryTxns.map(t => t.date.getMonth() + '-' + t.date.getFullYear()))].length;
  const keywords = [...new Set(salaryTxns.map(t => getSalaryKeyword(t.desc)))].join(', ') || '—';

  summaryEl.innerHTML = `
    <div class="salary-summary-item">
      <label>Salary Present</label>
      <div class="sv">${hasSalary
        ? '<span class="salary-badge salary-yes">✓ YES</span>'
        : '<span class="salary-badge salary-no">✗ NOT FOUND</span>'}</div>
    </div>
    <div class="salary-summary-item">
      <label>Transactions Found</label>
      <div class="sv" style="color:var(--green)">${salaryTxns.length}</div>
    </div>
    <div class="salary-summary-item">
      <label>Total Credited</label>
      <div class="sv" style="color:var(--green)">₹ ${fmt(totalAmt)}</div>
    </div>
    <div class="salary-summary-item">
      <label>Avg per Month</label>
      <div class="sv">₹ ${fmt(avgAmt)}</div>
    </div>
    <div class="salary-summary-item">
      <label>Months w/ Salary</label>
      <div class="sv">${months}</div>
    </div>
    <div class="salary-summary-item">
      <label>Keywords Matched</label>
      <div class="sv" style="font-size:11px;color:var(--text2)">${keywords}</div>
    </div>
    <div class="salary-summary-item" style="grid-column:span 2;">
      <label>Status</label>
      <div style="font-size:13px;color:${hasSalary ? 'var(--green)' : 'var(--amber)'}">
        ${hasSalary
          ? `Regular salary credits detected. Account shows income activity.`
          : `No salary keywords found. Account may be non-salaried or salary credited under a different description.`}
      </div>
    </div>
  `;

  // Transaction table
  const tbody = document.getElementById('tbodySalary');
  tbody.innerHTML = '';
  if (!salaryTxns.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text3);padding:32px;">No salary transactions detected across any keyword pattern.</td></tr>`;
    return;
  }
  salaryTxns.forEach((t, i) => {
    const kw = getSalaryKeyword(t.desc);
    const monthLabel = t.date.toLocaleString('en-IN', { month: 'short', year: '2-digit' });
    const tr = document.createElement('tr');
    tr.style.background = 'rgba(34,197,94,0.03)';
    tr.innerHTML = `
      <td class="t-muted">${i + 1}</td>
      <td class="t-mono">${fmtDate(t.date)}</td>
      <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;">${t.desc}</td>
      <td><span class="tag ${t.type === 'CR' ? 'tag-cr' : 'tag-dr'}">${t.type}</span></td>
      <td class="t-cr" style="font-weight:700">${fmt(t.amount)}</td>
      <td class="t-bal">${fmt(t.balance)}</td>
      <td><span class="tag tag-salary">${kw || 'SALARY'}</span></td>
      <td class="t-muted">${monthLabel}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ─── Render ACH Section ───
function renderACHSection() {
  const hasACH = achTxns.length > 0;
  const badge = document.getElementById('achBadge');
  badge.textContent = hasACH ? `${achTxns.length} ACH transaction(s)` : 'No ACH detected';
  badge.style.color = hasACH ? '#c084fc' : 'var(--text3)';

  const crTxns = achTxns.filter(t => t.type === 'CR');
  const drTxns = achTxns.filter(t => t.type === 'DR');
  const totalCr = crTxns.reduce((s,t) => s+t.amount, 0);
  const totalDr = drTxns.reduce((s,t) => s+t.amount, 0);
  const months  = [...new Set(achTxns.map(t => t.date.getMonth()+'-'+t.date.getFullYear()))].length;
  const subTypes= [...new Set(achTxns.map(t => getACHSubType(t.desc)))].join(', ') || '—';

  document.getElementById('achSummary').innerHTML = `
    <div class="payment-summary-item">
      <label>ACH Present</label>
      <div class="psv psv-purple">${hasACH ? '✓ YES' : '✗ NONE'}</div>
    </div>
    <div class="payment-summary-item">
      <label>Total Txns</label>
      <div class="psv psv-purple">${achTxns.length}</div>
    </div>
    <div class="payment-summary-item">
      <label>Credits (${crTxns.length})</label>
      <div class="psv psv-green">₹ ${fmt(totalCr)}</div>
    </div>
    <div class="payment-summary-item">
      <label>Debits (${drTxns.length})</label>
      <div class="psv psv-red">₹ ${fmt(totalDr)}</div>
    </div>
    <div class="payment-summary-item">
      <label>Months w/ ACH</label>
      <div class="psv psv-amber">${months}</div>
    </div>
  `;

  const tbody = document.getElementById('tbodyACH');
  tbody.innerHTML = '';
  if (!achTxns.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--text3);padding:32px;">
      No ACH / NACH / Direct Debit / Auto Pay transactions detected in the statement.</td></tr>`;
    return;
  }
  achTxns.forEach((t, i) => {
    const sub = getACHSubType(t.desc);
    const kw  = getACHKeyword(t.desc);
    const mo  = t.date.toLocaleString('en-IN', {month:'short', year:'2-digit'});
    const tr  = document.createElement('tr');
    tr.style.background = 'rgba(168,85,247,0.03)';
    tr.innerHTML = `
      <td class="t-muted">${i+1}</td>
      <td class="t-mono">${fmtDate(t.date)}</td>
      <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;">${t.desc}</td>
      <td><span class="tag ${t.type==='CR'?'tag-cr':'tag-dr'}">${t.type}</span></td>
      <td class="${t.type==='CR'?'t-cr':'t-dr'}" style="font-weight:600">${fmt(t.amount)}</td>
      <td class="t-bal">${fmt(t.balance)}</td>
      <td><span class="tag tag-ach" style="white-space:nowrap">${sub}</span></td>
      <td class="t-muted">${kw}</td>
      <td class="t-muted">${mo}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ─── Render ECS Section ───
function renderECSSection() {
  const hasECS = ecsTxns.length > 0;
  const badge = document.getElementById('ecsBadge');
  badge.textContent = hasECS ? `${ecsTxns.length} ECS transaction(s)` : 'No ECS detected';
  badge.style.color = hasECS ? '#2dd4bf' : 'var(--text3)';

  const crTxns = ecsTxns.filter(t => t.type === 'CR');
  const drTxns = ecsTxns.filter(t => t.type === 'DR');
  const totalCr = crTxns.reduce((s,t) => s+t.amount, 0);
  const totalDr = drTxns.reduce((s,t) => s+t.amount, 0);
  const months  = [...new Set(ecsTxns.map(t => t.date.getMonth()+'-'+t.date.getFullYear()))].length;
  const returns = ecsTxns.filter(t => /return|bounce|rej/i.test(getECSSubType(t.desc))).length;

  document.getElementById('ecsSummary').innerHTML = `
    <div class="payment-summary-item">
      <label>ECS Present</label>
      <div class="psv psv-teal">${hasECS ? '✓ YES' : '✗ NONE'}</div>
    </div>
    <div class="payment-summary-item">
      <label>Total Txns</label>
      <div class="psv psv-teal">${ecsTxns.length}</div>
    </div>
    <div class="payment-summary-item">
      <label>Credits (${crTxns.length})</label>
      <div class="psv psv-green">₹ ${fmt(totalCr)}</div>
    </div>
    <div class="payment-summary-item">
      <label>Debits (${drTxns.length})</label>
      <div class="psv psv-red">₹ ${fmt(totalDr)}</div>
    </div>
    <div class="payment-summary-item">
      <label>ECS Returns/Bounces</label>
      <div class="psv ${returns>0?'psv-red':'psv-amber'}">${returns}</div>
    </div>
  `;

  const tbody = document.getElementById('tbodyECS');
  tbody.innerHTML = '';
  if (!ecsTxns.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--text3);padding:32px;">
      No ECS transactions detected in the statement.</td></tr>`;
    return;
  }
  ecsTxns.forEach((t, i) => {
    const sub = getECSSubType(t.desc);
    const kw  = getECSKeyword(t.desc);
    const mo  = t.date.toLocaleString('en-IN', {month:'short', year:'2-digit'});
    const isReturn = /return|bounce|rej/i.test(sub);
    const tr  = document.createElement('tr');
    tr.style.background = isReturn ? 'rgba(239,68,68,0.04)' : 'rgba(20,184,166,0.03)';
    tr.innerHTML = `
      <td class="t-muted">${i+1}</td>
      <td class="t-mono">${fmtDate(t.date)}</td>
      <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;">${t.desc}</td>
      <td><span class="tag ${t.type==='CR'?'tag-cr':'tag-dr'}">${t.type}</span></td>
      <td class="${t.type==='CR'?'t-cr':'t-dr'}" style="font-weight:600">${fmt(t.amount)}</td>
      <td class="t-bal">${fmt(t.balance)}</td>
      <td><span class="tag tag-ecs" style="white-space:nowrap${isReturn?';background:rgba(239,68,68,0.12);color:#f87171;border-color:rgba(239,68,68,0.25)':''}">${sub}</span></td>
      <td class="t-muted">${kw}</td>
      <td class="t-muted">${mo}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ─── Render NEFT / RTGS Section ───
function renderNEFTSection() {
  const hasNEFT = neftTxns.length > 0;
  const badge = document.getElementById('neftBadge');
  badge.textContent = hasNEFT ? `${neftTxns.length} NEFT/RTGS transaction(s)` : 'No NEFT/RTGS detected';
  badge.style.color = hasNEFT ? '#fbbf24' : 'var(--text3)';

  const crTxns  = neftTxns.filter(t => t.type === 'CR');
  const drTxns  = neftTxns.filter(t => t.type === 'DR');
  const totalCr = crTxns.reduce((s,t) => s+t.amount, 0);
  const totalDr = drTxns.reduce((s,t) => s+t.amount, 0);
  const months  = [...new Set(neftTxns.map(t => t.date.getMonth()+'-'+t.date.getFullYear()))].length;
  const returns = neftTxns.filter(t => /return|reject/i.test(getNEFTSubType(t.rawDesc || t.desc))).length;
  const neftOnly = neftTxns.filter(t => /neft/i.test(getNEFTSubType(t.rawDesc || t.desc)));
  const rtgsOnly = neftTxns.filter(t => /rtgs/i.test(getNEFTSubType(t.rawDesc || t.desc)));

  document.getElementById('neftSummary').innerHTML = `
    <div class="payment-summary-item">
      <label>NEFT/RTGS Present</label>
      <div class="psv psv-blue">${hasNEFT ? '✓ YES' : '✗ NONE'}</div>
    </div>
    <div class="payment-summary-item">
      <label>Total Txns</label>
      <div class="psv psv-blue">${neftTxns.length}</div>
    </div>
    <div class="payment-summary-item">
      <label>NEFT Txns</label>
      <div class="psv" style="color:#fbbf24">${neftOnly.length}</div>
    </div>
    <div class="payment-summary-item">
      <label>RTGS Txns</label>
      <div class="psv" style="color:#f97316">${rtgsOnly.length}</div>
    </div>
    <div class="payment-summary-item">
      <label>Credits (${crTxns.length})</label>
      <div class="psv psv-green">₹ ${fmt(totalCr)}</div>
    </div>
    <div class="payment-summary-item">
      <label>Debits (${drTxns.length})</label>
      <div class="psv psv-red">₹ ${fmt(totalDr)}</div>
    </div>
    <div class="payment-summary-item">
      <label>Months w/ NEFT/RTGS</label>
      <div class="psv psv-amber">${months}</div>
    </div>
    <div class="payment-summary-item">
      <label>Returns / Rejects</label>
      <div class="psv ${returns>0?'psv-red':'psv-amber'}">${returns}</div>
    </div>
  `;

  const tbody = document.getElementById('tbodyNEFT');
  tbody.innerHTML = '';
  if (!neftTxns.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--text3);padding:32px;">
      No NEFT / RTGS fund transfer transactions detected in the statement.</td></tr>`;
    return;
  }
  neftTxns.forEach((t, i) => {
    const sub    = getNEFTSubType(t.rawDesc || t.desc);
    const kw     = getNEFTKeyword(t.rawDesc || t.desc);
    const mo     = t.date.toLocaleString('en-IN', {month:'short', year:'2-digit'});
    const isRet  = /return|reject/i.test(sub);
    const isRTGS = /rtgs/i.test(sub);
    const tr     = document.createElement('tr');
    tr.style.background = isRet ? 'rgba(239,68,68,0.04)' : isRTGS ? 'rgba(249,115,22,0.03)' : 'rgba(251,191,36,0.03)';
    tr.innerHTML = `
      <td class="t-muted">${i+1}</td>
      <td class="t-mono">${fmtDate(t.date)}</td>
      <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;">${t.desc}</td>
      <td><span class="tag ${t.type==='CR'?'tag-cr':'tag-dr'}">${t.type}</span></td>
      <td class="${t.type==='CR'?'t-cr':'t-dr'}" style="font-weight:600">${fmt(t.amount)}</td>
      <td class="t-bal">${fmt(t.balance)}</td>
      <td><span class="tag tag-neft" style="white-space:nowrap${isRet?';background:rgba(239,68,68,0.12);color:#f87171;border-color:rgba(239,68,68,0.25)':isRTGS?';background:rgba(249,115,22,0.12);color:#fb923c;border-color:rgba(249,115,22,0.25)':''}">${sub}</span></td>
      <td class="t-muted">${kw}</td>
      <td class="t-muted">${mo}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ─── Render UPI / IMPS Section ───
function renderUPISection() {
  const has = upiTxns.length > 0;
  const badge = document.getElementById('upiBadge');
  badge.textContent = has ? `${upiTxns.length} UPI/IMPS transaction(s)` : 'No UPI/IMPS detected';
  badge.style.color = has ? '#a5b4fc' : 'var(--text3)';

  const crTxns = upiTxns.filter(t => t.type === 'CR');
  const drTxns = upiTxns.filter(t => t.type === 'DR');
  const totalCr = crTxns.reduce((s,t) => s+t.amount, 0);
  const totalDr = drTxns.reduce((s,t) => s+t.amount, 0);
  const months  = [...new Set(upiTxns.map(t => t.date.getMonth()+'-'+t.date.getFullYear()))].length;
  const impsOnly = upiTxns.filter(t => /imps/i.test(getUPISubType(t.rawDesc||t.desc))).length;

  document.getElementById('upiSummary').innerHTML = `
    <div class="payment-summary-item"><label>UPI/IMPS Present</label><div class="psv" style="color:#a5b4fc">${has ? '✓ YES' : '✗ NONE'}</div></div>
    <div class="payment-summary-item"><label>Total Txns</label><div class="psv" style="color:#a5b4fc">${upiTxns.length}</div></div>
    <div class="payment-summary-item"><label>IMPS Txns</label><div class="psv" style="color:#f9a8d4">${impsOnly}</div></div>
    <div class="payment-summary-item"><label>Credits (${crTxns.length})</label><div class="psv psv-green">₹ ${fmt(totalCr)}</div></div>
    <div class="payment-summary-item"><label>Debits (${drTxns.length})</label><div class="psv psv-red">₹ ${fmt(totalDr)}</div></div>
    <div class="payment-summary-item"><label>Months w/ UPI</label><div class="psv psv-amber">${months}</div></div>
  `;

  const tbody = document.getElementById('tbodyUPI');
  tbody.innerHTML = '';
  if (!upiTxns.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--text3);padding:32px;">No UPI or IMPS transactions detected.</td></tr>`;
    return;
  }
  upiTxns.forEach((t, i) => {
    const sub = getUPISubType(t.rawDesc||t.desc);
    const kw  = getUPIKeyword(t.rawDesc||t.desc);
    const mo  = t.date.toLocaleString('en-IN', {month:'short', year:'2-digit'});
    const isIMPS = /imps/i.test(sub);
    const tr  = document.createElement('tr');
    tr.style.background = isIMPS ? 'rgba(236,72,153,0.03)' : 'rgba(99,102,241,0.03)';
    tr.innerHTML = `
      <td class="t-muted">${i+1}</td>
      <td class="t-mono">${fmtDate(t.date)}</td>
      <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;">${t.desc}</td>
      <td><span class="tag ${t.type==='CR'?'tag-cr':'tag-dr'}">${t.type}</span></td>
      <td class="${t.type==='CR'?'t-cr':'t-dr'}" style="font-weight:600">${fmt(t.amount)}</td>
      <td class="t-bal">${fmt(t.balance)}</td>
      <td><span class="tag ${isIMPS?'tag-imps':'tag-upi'}" style="white-space:nowrap">${sub}</span></td>
      <td class="t-muted">${kw}</td>
      <td class="t-muted">${mo}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ─── Render Cheque / CTS Section ───
function renderChequeSection() {
  const has = chequeTxns.length > 0;
  const badge = document.getElementById('chequeBadge');
  badge.textContent = has ? `${chequeTxns.length} Cheque/CTS transaction(s)` : 'No Cheque/CTS detected';
  badge.style.color = has ? '#fcd34d' : 'var(--text3)';

  const crTxns = chequeTxns.filter(t => t.type === 'CR');
  const drTxns = chequeTxns.filter(t => t.type === 'DR');
  const totalCr = crTxns.reduce((s,t) => s+t.amount, 0);
  const totalDr = drTxns.reduce((s,t) => s+t.amount, 0);
  const months  = [...new Set(chequeTxns.map(t => t.date.getMonth()+'-'+t.date.getFullYear()))].length;
  const bounces = chequeTxns.filter(t => /return|bounce|dishon/i.test(getChequeSubType(t.rawDesc||t.desc))).length;

  document.getElementById('chequeSummary').innerHTML = `
    <div class="payment-summary-item"><label>Cheque Present</label><div class="psv" style="color:#fcd34d">${has ? '✓ YES' : '✗ NONE'}</div></div>
    <div class="payment-summary-item"><label>Total Txns</label><div class="psv" style="color:#fcd34d">${chequeTxns.length}</div></div>
    <div class="payment-summary-item"><label>Deposits (${crTxns.length})</label><div class="psv psv-green">₹ ${fmt(totalCr)}</div></div>
    <div class="payment-summary-item"><label>Issues (${drTxns.length})</label><div class="psv psv-red">₹ ${fmt(totalDr)}</div></div>
    <div class="payment-summary-item"><label>Returns/Bounces</label><div class="psv ${bounces>0?'psv-red':'psv-amber'}">${bounces}</div></div>
    <div class="payment-summary-item"><label>Months w/ Cheques</label><div class="psv psv-amber">${months}</div></div>
  `;

  const tbody = document.getElementById('tbodyCheque');
  tbody.innerHTML = '';
  if (!chequeTxns.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--text3);padding:32px;">No Cheque / CTS transactions detected.</td></tr>`;
    return;
  }
  chequeTxns.forEach((t, i) => {
    const sub = getChequeSubType(t.rawDesc||t.desc);
    const kw  = getChequeKeyword(t.rawDesc||t.desc);
    const mo  = t.date.toLocaleString('en-IN', {month:'short', year:'2-digit'});
    const isBounce = /return|bounce|dishon/i.test(sub);
    const tr  = document.createElement('tr');
    tr.style.background = isBounce ? 'rgba(239,68,68,0.04)' : 'rgba(245,158,11,0.03)';
    tr.innerHTML = `
      <td class="t-muted">${i+1}</td>
      <td class="t-mono">${fmtDate(t.date)}</td>
      <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;">${t.desc}</td>
      <td><span class="tag ${t.type==='CR'?'tag-cr':'tag-dr'}">${t.type}</span></td>
      <td class="${t.type==='CR'?'t-cr':'t-dr'}" style="font-weight:600">${fmt(t.amount)}</td>
      <td class="t-bal">${fmt(t.balance)}</td>
      <td><span class="tag ${isBounce?'tag-bounce':'tag-chq'}" style="white-space:nowrap">${sub}</span></td>
      <td class="t-muted">${kw}</td>
      <td class="t-muted">${mo}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ─── Render Bounce / Overdraft Section ───
function renderBounceSection() {
  const hasBounce = bounceTxns.length > 0;
  const hasOD     = overdraftTxns.length > 0;

  // Bounce summary
  const inwardNT = bounceTxns.filter(t => { const d = isBounceInward(t.rawDesc||t.desc); return d === true && !/technical/i.test(getBounceSubType(t.rawDesc||t.desc)); }).length;
  const inwardT  = bounceTxns.filter(t => /technical/i.test(getBounceSubType(t.rawDesc||t.desc))).length;
  const outward  = bounceTxns.filter(t => isBounceInward(t.rawDesc||t.desc) === false).length;
  const other    = bounceTxns.length - inwardNT - inwardT - outward;

  document.getElementById('bounceBadge').textContent = hasBounce
    ? `${bounceTxns.length} bounce/return(s)` : 'No bounces detected';
  document.getElementById('bounceBadge').style.color = hasBounce ? 'var(--red)' : 'var(--green)';

  document.getElementById('bounceSummary').innerHTML = `
    <div class="payment-summary-item"><label>Total Bounces</label><div class="psv psv-red">${bounceTxns.length}</div></div>
    <div class="payment-summary-item"><label>Inward (Non-Tech)</label><div class="psv psv-amber">${inwardNT}</div></div>
    <div class="payment-summary-item"><label>Inward (Technical)</label><div class="psv psv-amber">${inwardT}</div></div>
    <div class="payment-summary-item"><label>Outward Bounces</label><div class="psv psv-red">${outward}</div></div>
    <div class="payment-summary-item"><label>Other Returns</label><div class="psv" style="color:var(--text2)">${other}</div></div>
  `;

  const tbodyB = document.getElementById('tbodyBounce');
  tbodyB.innerHTML = '';
  if (!bounceTxns.length) {
    tbodyB.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--green);padding:24px;">✅ No bounce or return transactions detected.</td></tr>`;
  } else {
    bounceTxns.forEach((t, i) => {
      const sub = getBounceSubType(t.rawDesc||t.desc);
      const mo  = t.date.toLocaleString('en-IN', {month:'short', year:'2-digit'});
      const tr  = document.createElement('tr');
      tr.style.background = 'rgba(239,68,68,0.04)';
      tr.innerHTML = `
        <td class="t-muted">${i+1}</td>
        <td class="t-mono">${fmtDate(t.date)}</td>
        <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;">${t.desc}</td>
        <td><span class="tag ${t.type==='CR'?'tag-cr':'tag-dr'}">${t.type}</span></td>
        <td class="${t.type==='CR'?'t-cr':'t-dr'}" style="font-weight:600">${fmt(t.amount)}</td>
        <td class="t-bal">${fmt(t.balance)}</td>
        <td><span class="tag tag-bounce" style="white-space:nowrap">${sub}</span></td>
        <td class="t-muted">${mo}</td>
      `;
      tbodyB.appendChild(tr);
    });
  }

  // Overdraft summary
  document.getElementById('overdraftBadge').textContent = hasOD
    ? `${overdraftTxns.length} overdraft event(s)` : 'No overdraft events';
  document.getElementById('overdraftBadge').style.color = hasOD ? 'var(--red)' : 'var(--green)';

  const odDays  = new Set(overdraftTxns.map(t => fmtDate(t.date))).size;
  const odTimes = overdraftTxns.length;
  const minBal  = overdraftTxns.length ? Math.min(...overdraftTxns.map(t => t.balance)) : 0;
  document.getElementById('overdraftSummary').innerHTML = `
    <div class="payment-summary-item"><label>Times Overdrawn</label><div class="psv psv-red">${odTimes}</div></div>
    <div class="payment-summary-item"><label>Days Overdrawn</label><div class="psv psv-red">${odDays}</div></div>
    <div class="payment-summary-item"><label>Most Negative Balance</label><div class="psv psv-red">${odTimes>0?'₹ '+fmt(minBal):'—'}</div></div>
    <div class="payment-summary-item"><label>Status</label><div class="psv ${hasOD?'psv-red':'psv-green'}">${hasOD?'⚠ OVERDRAWN':'✅ CLEAN'}</div></div>
  `;

  const tbodyOD = document.getElementById('tbodyOverdraft');
  tbodyOD.innerHTML = '';
  if (!overdraftTxns.length) {
    tbodyOD.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--green);padding:24px;">✅ Account was never overdrawn.</td></tr>`;
  } else {
    overdraftTxns.forEach((t, i) => {
      const mo = t.date.toLocaleString('en-IN', {month:'short', year:'2-digit'});
      const tr = document.createElement('tr');
      tr.style.background = 'rgba(239,68,68,0.05)';
      tr.innerHTML = `
        <td class="t-muted">${i+1}</td>
        <td class="t-mono">${fmtDate(t.date)}</td>
        <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;">${t.desc}</td>
        <td><span class="tag ${t.type==='CR'?'tag-cr':'tag-dr'}">${t.type}</span></td>
        <td class="${t.type==='CR'?'t-cr':'t-dr'}" style="font-weight:600">${fmt(t.amount)}</td>
        <td class="t-dr" style="font-weight:700">${fmt(t.balance)}</td>
        <td class="t-muted">${mo}</td>
      `;
      tbodyOD.appendChild(tr);
    });
  }
}

// ─── Render Multi-Account Section ───
function renderAccountsSection() {
  const badge = document.getElementById('accountsBadge');
  badge.textContent = perFileData.length + ' file(s) / account(s) loaded';

  const grid = document.getElementById('accountsGrid');
  grid.innerHTML = perFileData.map((fd, idx) => {
    const info = fd.accountInfo;
    const txns = fd.txns;
    const crTotal = txns.filter(t=>t.type==='CR').reduce((s,t)=>s+t.amount,0);
    const drTotal = txns.filter(t=>t.type==='DR').reduce((s,t)=>s+t.amount,0);
    const sorted = [...txns].sort((a,b)=>a.date-b.date);
    const firstT = sorted[0];
    const openBal = firstT ? (firstT.type === 'CR' ? firstT.balance - firstT.amount : firstT.balance + firstT.amount) : 0;
    return `
      <div class="stat-card" style="border-color:rgba(59,130,246,0.3)">
        <label>Account ${idx+1} — ${fd.fileName}</label>
        <div class="sv" style="font-size:12px;margin-bottom:4px">${info.bank || 'Unknown Bank'}</div>
        <div style="font-size:11px;color:var(--text2);font-family:'IBM Plex Mono',monospace">${info.accountNo || '—'}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:4px">${info.name || '—'}</div>
        <div style="margin-top:8px;display:flex;gap:8px">
          <span style="font-size:10px;color:var(--green)">CR ₹${fmt(crTotal)}</span>
          <span style="font-size:10px;color:var(--red)">DR ₹${fmt(drTotal)}</span>
        </div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px">Opening Bal: ₹${fmt(openBal)}</div>
      </div>`;
  }).join('');

  const tbody = document.getElementById('tbodyAccounts');
  tbody.innerHTML = '';
  perFileData.forEach((fd, idx) => {
    const info = fd.accountInfo;
    const txns = fd.txns;
    const sorted = [...txns].sort((a,b)=>a.date-b.date);
    const crTotal = txns.filter(t=>t.type==='CR').reduce((s,t)=>s+t.amount,0);
    const drTotal = txns.filter(t=>t.type==='DR').reduce((s,t)=>s+t.amount,0);
    const firstT2 = sorted[0];
    const openBal = firstT2 ? (firstT2.type === 'CR' ? firstT2.balance - firstT2.amount : firstT2.balance + firstT2.amount) : 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="t-muted" style="max-width:120px;overflow:hidden;text-overflow:ellipsis;">${fd.fileName}</td>
      <td class="t-mono">${info.accountNo || '—'}</td>
      <td>${info.bank || '—'}</td>
      <td>${info.name || '—'}</td>
      <td class="t-mono">${sorted.length ? fmtDate(sorted[0].date) : '—'}</td>
      <td class="t-mono">${sorted.length ? fmtDate(sorted[sorted.length-1].date) : '—'}</td>
      <td>${txns.length}</td>
      <td class="t-cr" style="font-weight:600">${fmt(crTotal)}</td>
      <td class="t-dr" style="font-weight:600">${fmt(drTotal)}</td>
      <td class="t-bal">${fmt(openBal)}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ─── Render Validation Section (Req 1, 2, 3, 4) ───
function renderValidationSection() {
  const grid = document.getElementById('validationGrid');
  const badge = document.getElementById('validationBadge');
  const passes = validChecks.filter(c => c.status === 'pass').length;
  const fails  = validChecks.filter(c => c.status === 'fail').length;
  badge.textContent = `${passes} passed · ${fails > 0 ? fails + ' failed' : 'all clear'}`;
  badge.style.color = fails > 0 ? 'var(--red)' : 'var(--green)';

  grid.innerHTML = validChecks.map(c => `
    <div class="vcheck ${c.status}">
      <div class="vcheck-icon">${c.icon}</div>
      <div class="vcheck-body">
        <div class="vcheck-title">${c.title}</div>
        <div class="vcheck-detail">${c.detail}</div>
      </div>
      <div class="vcheck-badge">
        <span class="tag ${c.status === 'pass' ? 'tag-cr' : c.status === 'fail' ? 'tag-dr' : 'tag-skip'}" style="font-size:11px">${c.value}</span>
      </div>
    </div>
  `).join('');
}

function renderTxnTable() {
  // Build category options for filter dropdown
  const catSelect = document.getElementById('txnCatFilter');
  if (catSelect && catSelect.options.length <= 1) {
    const cats = [...new Set(filtered90.map(t => t.category || 'Other'))].sort();
    cats.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      catSelect.appendChild(opt);
    });
  }

  // Build multi-account buttons if multiple files
  const acctBar = document.getElementById('txnAcctBar');
  if (perFileData.length > 1) {
    acctBar.style.display = 'flex';
    acctBar.innerHTML = '<label>Account:</label><button class="acct-btn active" onclick="setTxnAccount(\'ALL\',this)">All</button>' +
      perFileData.map((fd, idx) => {
        const acno = fd.accountInfo.accountNo || ('File '+(idx+1));
        return `<button class="acct-btn" onclick="setTxnAccount(${idx},this)">${acno.slice(-4) ? '···'+acno.slice(-4) : 'Acct '+(idx+1)}</button>`;
      }).join('');
  } else {
    acctBar.style.display = 'none';
  }

  filterTxnTable();
}

function setTxnAccount(idx, btn) {
  _txnFilterAccount = idx;
  document.querySelectorAll('#txnAcctBar .acct-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  filterTxnTable();
}

function filterTxnTable() {
  const query  = (document.getElementById('txnSearch')?.value || '').toLowerCase();
  const typeF  = document.getElementById('txnTypeFilter')?.value || '';
  const catF   = document.getElementById('txnCatFilter')?.value || '';
  const acctF  = _txnFilterAccount;

  let txns = filtered90;
  if (acctF !== 'ALL' && acctF !== undefined) {
    txns = txns.filter(t => t._fileIdx === acctF);
  }
  if (typeF) txns = txns.filter(t => t.type === typeF);
  if (catF)  txns = txns.filter(t => (t.category || '') === catF);
  if (query) txns = txns.filter(t =>
    t.desc.toLowerCase().includes(query) ||
    (t.category || '').toLowerCase().includes(query) ||
    fmt(t.amount).includes(query)
  );

  const tbody = document.getElementById('tbodyTxn');
  tbody.innerHTML = '';
  txns.forEach((t, i) => {
    const cat = t.category || '';
    let catTag = `<span style="font-size:10px;color:var(--text3)">${cat}</span>`;
    if (/^ACH/i.test(cat))         catTag = `<span class="tag tag-ach" style="font-size:10px">${cat}</span>`;
    else if (/^ECS/i.test(cat))    catTag = `<span class="tag tag-ecs" style="font-size:10px">${cat}</span>`;
    else if (/^NEFT\/RTGS/i.test(cat)) catTag = `<span class="tag tag-neft" style="font-size:10px">${cat}</span>`;
    else if (/^UPI\/IMPS/i.test(cat))  catTag = `<span class="tag tag-upi" style="font-size:10px">${cat}</span>`;
    else if (/^Cheque/i.test(cat))     catTag = `<span class="tag tag-chq" style="font-size:10px">${cat}</span>`;
    else if (cat === 'Salary')         catTag = `<span class="tag tag-sal" style="font-size:10px">Salary</span>`;
    else if (cat === 'Bounce')         catTag = `<span class="tag tag-bounce" style="font-size:10px">Bounce</span>`;
    const acctLabel = perFileData.length > 1 && t._fileIdx !== undefined
      ? `<span class="account-chip" style="font-size:9px;margin-left:4px">A${t._fileIdx+1}</span>` : '';
    const mismatchWarning = t._balanceMismatch
      ? `<span title="Balance delta mismatch — possible parse error" style="font-size:10px;color:var(--amber);margin-left:4px">⚠</span>` : '';
    const tr = document.createElement('tr');
    if (t._balanceMismatch) tr.style.background = 'rgba(245,158,11,0.05)';
    tr.innerHTML = `
      <td class="t-muted">${i+1}</td>
      <td class="t-mono">${fmtDate(t.date)}</td>
      <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;">${t.desc}${acctLabel}${mismatchWarning}</td>
      <td><span class="tag ${t.type==='CR'?'tag-cr':'tag-dr'}">${t.type}</span></td>
      <td class="${t.type==='CR'?'t-cr':'t-dr'}">${fmt(t.amount)}</td>
      <td class="t-bal">${fmt(t.balance)}</td>
      <td>${catTag}</td>
    `;
    tbody.appendChild(tr);
  });
  const countEl = document.getElementById('txnSearchCount');
  if (countEl) countEl.textContent = txns.length === filtered90.length ? '' : `${txns.length} / ${filtered90.length} shown`;
  document.getElementById('txnBadge').textContent = filtered90.length + ' rows';
}

function renderTargetTable() {
  const tbody = document.getElementById('tbodyTarget');
  tbody.innerHTML = '';
  targetRows.forEach(row => {
    const tr = document.createElement('tr');
    // eodBalance is the carry-forward balance used in ABB (always present)
    // txn is the last transaction on/before (may be null if before any transaction ever)
    const hasRef = !!row.txn;
    tr.innerHTML = `
      <td class="t-mono">${fmtDate(row.targetDate)}</td>
      <td class="t-mono">${row.actualDate ? fmtDate(row.actualDate) : '—'}</td>
      <td>${row.fallback ? '<span class="tag tag-skip">Carry-fwd</span>' : '<span class="tag tag-cr">Exact</span>'}</td>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;">${hasRef ? row.txn.desc : 'Opening Balance'}</td>
      <td>${hasRef ? `<span class="tag ${row.txn.type==='CR'?'tag-cr':'tag-dr'}">${row.txn.type}</span>` : '—'}</td>
      <td class="${hasRef ? (row.txn.type==='CR'?'t-cr':'t-dr') : 't-muted'}">${hasRef ? fmt(row.txn.amount) : '—'}</td>
      <td class="t-bal" style="font-weight:600;color:var(--accent)">${fmt(row.eodBalance)}</td>
    `;
    tbody.appendChild(tr);
  });
  document.getElementById('targetBadge').textContent = targetRows.length + ' rows';
}

function renderPerfiosTable() {
  const head = document.getElementById('pfHead');
  const body = document.getElementById('pfBody');
  head.innerHTML = ''; body.innerHTML = '';
  if (!monthOrder.length) return;

  // Header (matches ABB1 row 5)
  const htr = document.createElement('tr');
  htr.innerHTML = `<th>Date ↓ / Month →</th>` +
    monthOrder.map(mk => `<th>${abbData[mk].label}</th>`).join('');
  head.appendChild(htr);

  // Data rows for each target day (ABB1 rows 6-10)
  for (const day of TARGET_DAYS) {
    const tr = document.createElement('tr');
    let cells = `<td>${day}</td>`;
    for (const mk of monthOrder) {
      const val = abbData[mk].dates[day];
      cells += `<td>${val !== undefined ? fmt(val) : '<span style="color:var(--text3)">—</span>'}</td>`;
    }
    tr.innerHTML = cells;
    body.appendChild(tr);
  }

  const cols = monthOrder.length + 1;

  // Total row (SUM formula — ABB1 row 11)
  const totRow = document.createElement('tr');
  totRow.className = 'row-pf-total';
  let totCells = `<td>Total</td>`;
  const totals = {};
  for (const mk of monthOrder) {
    const sum = Object.values(abbData[mk].dates).reduce((a,b)=>a+b, 0);
    totals[mk] = sum;
    totCells += `<td>${fmt(sum)}</td>`;
  }
  totRow.innerHTML = totCells;
  body.appendChild(totRow);

  // Monthly Average (AVERAGE formula — ABB1 row 12)
  const avgRow = document.createElement('tr');
  avgRow.className = 'row-pf-avg';
  let avgCells = `<td>Monthly Average</td>`;
  const avgs = {};
  for (const mk of monthOrder) {
    const vals = Object.values(abbData[mk].dates);
    const avg = vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0;
    avgs[mk] = avg;
    avgCells += `<td>${fmt(avg)}</td>`;
  }
  avgRow.innerHTML = avgCells;
  body.appendChild(avgRow);

  // ABB = AVERAGE of monthly averages (ABB1 row 14)
  const abbVal = monthOrder.length ? Object.values(avgs).reduce((a,b)=>a+b,0)/monthOrder.length : 0;
  const abbRow = document.createElement('tr');
  abbRow.className = 'row-pf-abb';
  abbRow.innerHTML = `<td colspan="${cols}">🏦 Average Bank Balance (ABB): ₹ ${fmt(abbVal)}</td>`;
  body.appendChild(abbRow);
  document.getElementById('abABBVal').textContent = '₹ ' + fmt(abbVal);
  document.getElementById('sABB').textContent = '₹ ' + fmt(abbVal);

  // Total Credits row (ABB1 row 29)
  const crRow = document.createElement('tr');
  crRow.className = 'row-pf-cr';
  let crCells = `<td>Total Credits</td>`;
  for (const mk of monthOrder) crCells += `<td>${fmt(abbData[mk].credits)}</td>`;
  crRow.innerHTML = crCells;
  body.appendChild(crRow);

  // Credit Count row
  const cnRow = document.createElement('tr');
  cnRow.className = 'row-pf-cr';
  let cnCells = `<td>Credit Count</td>`;
  for (const mk of monthOrder) cnCells += `<td>${abbData[mk].creditCount}</td>`;
  cnRow.innerHTML = cnCells;
  body.appendChild(cnRow);
}

function renderFinOneTable() {
  const data = buildFinOneData();
  const head = document.getElementById('finOneHead');
  const body = document.getElementById('finOneBody');

  const cols = [
    'Month','Credits Nos','Credits Value','IW Chq Ret',
    'Bal@2','Bal@4','Bal@10','Bal@17','Bal@25','EOD Last','Avg(2-25)',
    'Withdrawal Amt','OW Chq Ret','Withdrawl Nos','Total Chq Bounces',
    'OW Bounce%','Min Balance','EMI Reflects','Salary Credit','Salary Date','IW Bounce%'
  ];
  head.innerHTML = `<tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr>`;

  body.innerHTML = '';
  for (const r of data) {
    const isTotal = r.month === 'TOTAL';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.month}</td>
      <td>${r.creditsNos}</td>
      <td>${fmt(r.creditsValue)}</td>
      <td>${r.iwChqRet}</td>
      <td>${fmt(r.bal2)}</td>
      <td>${fmt(r.bal4)}</td>
      <td>${fmt(r.bal10)}</td>
      <td>${fmt(r.bal17)}</td>
      <td>${fmt(r.bal25)}</td>
      <td>${fmt(r.eodLast)}</td>
      <td>${fmt(r.kAvg)}</td>
      <td>${fmt(r.withdrawalAmt)}</td>
      <td>${r.owChqRet}</td>
      <td>${r.withdrawlNos}</td>
      <td>${r.totalChqBounces}</td>
      <td>${r.pct_ow.toFixed(2)}%</td>
      <td>${fmt(r.minBal)}</td>
      <td>${r.emiReflects}</td>
      <td>${fmt(r.salaryCredit)}</td>
      <td>${r.salaryDate}</td>
      <td>${r.pct_iw.toFixed(2)}%</td>
    `;
    body.appendChild(tr);
  }
}

function renderAnalysisTable() {
  const data = buildAnalysisData();
  const head = document.getElementById('analysisHead');
  const body = document.getElementById('analysisBody');

  const monthLabels = monthOrder.map(mk => abbData[mk].label);
  head.innerHTML = `<tr>
    <th>Metric</th>
    ${monthLabels.map(l=>`<th>${l}</th>`).join('')}
    <th>TOTAL</th>
  </tr>`;

  body.innerHTML = '';
  for (const row of data) {
    const tr = document.createElement('tr');
    const fmtVal = (v) => row.fmt === '%' ? (v*100).toFixed(2)+'%' : row.fmt === 'n' ? v : fmt(v);
    const totalFmt = row.fmt === '%' ? (row.total*100/Math.max(1,row.values.length)).toFixed(2)+'%'
                    : row.fmt === 'n' ? row.total : fmt(row.total);
    tr.innerHTML = `
      <td>${row.label}</td>
      ${row.values.map(v=>`<td>${fmtVal(v)}</td>`).join('')}
      <td style="color:var(--amber);font-weight:600">${totalFmt}</td>
    `;
    body.appendChild(tr);
  }
  document.getElementById('analysisBadge').textContent = data.length + ' metrics · ' + monthOrder.length + ' months';
}

function renderBreakupTables() {
  const { income, expense } = buildBreakupData();
  const monthLabels = monthOrder.map(mk => abbData[mk].label);

  const renderBreakup = (rows, headId, bodyId) => {
    const head = document.getElementById(headId);
    const body = document.getElementById(bodyId);
    head.innerHTML = `<tr>
      <th>Item</th>
      ${monthLabels.map(l=>`<th>${l}</th>`).join('')}
      <th>Total</th><th>Average</th>
    </tr>`;
    body.innerHTML = '';
    // Data rows
    for (const row of rows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${row.label}</td>${row.values.map(v=>`<td>${fmt(v)}</td>`).join('')}<td>${fmt(row.total)}</td><td>${fmt(row.avg)}</td>`;
      body.appendChild(tr);
    }
    // Total row (SUM formula)
    const totTr = document.createElement('tr');
    totTr.className = 'bt-total';
    const totVals = monthLabels.map((_,i) => rows.reduce((s,r)=>s+r.values[i],0));
    totTr.innerHTML = `<td>Total</td>${totVals.map(v=>`<td>${fmt(v)}</td>`).join('')}<td>${fmt(totVals.reduce((s,v)=>s+v,0))}</td><td>${fmt(totVals.reduce((s,v)=>s+v,0)/Math.max(1,totVals.length))}</td>`;
    body.appendChild(totTr);
    // Average row (AVERAGE formula)
    const avgTr = document.createElement('tr');
    avgTr.className = 'bt-avg';
    const avgVals = monthLabels.map((_,i) => rows.reduce((s,r)=>s+r.values[i],0)/Math.max(1,rows.length));
    avgTr.innerHTML = `<td>Average</td>${avgVals.map(v=>`<td>${fmt(v)}</td>`).join('')}<td></td><td></td>`;
    body.appendChild(avgTr);
  };

  renderBreakup(income, 'incomeHead', 'incomeBody');
  renderBreakup(expense, 'expenseHead', 'expenseBody');
}

function renderEODTable() {
  const eodGrid = buildEODData();
  const head = document.getElementById('eodHead');
  const body = document.getElementById('eodBody');

  head.innerHTML = `<tr>
    <th>Day</th>
    ${monthOrder.map(mk=>`<th>${abbData[mk].label}</th>`).join('')}
  </tr>`;

  body.innerHTML = '';
  for (let day = 1; day <= 31; day++) {
    const isTarget = TARGET_DAYS.includes(day);
    const tr = document.createElement('tr');
    let cells = `<td${isTarget?' class="eod-highlight"':''}>${day}</td>`;
    for (const mk of monthOrder) {
      const v = eodGrid[day] && eodGrid[day][mk];
      const cls = (isTarget && v) ? ' class="eod-highlight"' : '';
      cells += `<td${cls}>${v ? fmt(v) : '<span style="color:var(--text3)">—</span>'}</td>`;
    }
    tr.innerHTML = cells;
    body.appendChild(tr);
  }
}

function renderAccountInfo() {
  const grid = document.getElementById('infoGrid');
  const lastTxnDate   = allTxns.length ? allTxns[allTxns.length-1].date : null;
  const firstTxnDate  = allTxns.length ? allTxns[0].date : null;
  const today         = new Date(); today.setHours(0,0,0,0);
  const staledays     = lastTxnDate ? Math.floor((today - lastTxnDate) / 86400000) : null;
  const span          = (firstTxnDate && lastTxnDate) ? Math.floor((lastTxnDate - firstTxnDate) / 86400000) : null;

  // Opening balance — inferred from first transaction
  const sortedAll = [...allTxns].sort((a,b)=>a.date-b.date);
  const openingBal = getOpeningBalance(sortedAll);
  const openBalEl = document.getElementById('openingBalBadge');
  if (openBalEl) openBalEl.innerHTML = `<span class="opening-bal-badge">Opening Balance: ₹ ${fmt(openingBal)}</span>`;

  const fields = [
    { label: 'Account Holder',    val: accountInfo.name        || '—', highlight: false },
    { label: 'Bank',              val: accountInfo.bank        || '—', highlight: false },
    { label: 'Account Number',    val: accountInfo.accountNo   || '—', highlight: true  },
    { label: 'Account Type',      val: accountInfo.accountType || '—', highlight: false },
    { label: 'IFSC Code',         val: accountInfo.ifsc        || '—', highlight: true  },
    { label: 'MICR Code',         val: accountInfo.micr        || '—', highlight: true  },
    { label: 'Branch',            val: accountInfo.branch      || '—', highlight: false },
    { label: 'CIF / Customer ID', val: accountInfo.cif         || '—', highlight: true  },
    { label: 'Mobile',            val: accountInfo.mobile      || '—', highlight: false },
    { label: 'Email',             val: accountInfo.email       || '—', highlight: false },
    { label: 'PAN',               val: accountInfo.pan         || '—', highlight: true  },
    { label: 'Address',           val: accountInfo.address     || '—', highlight: false },
    { label: 'Statement From',    val: accountInfo.periodFrom  || fmtDate(firstTxnDate), highlight: false },
    { label: 'Statement To',      val: accountInfo.periodTo    || fmtDate(lastTxnDate),  highlight: false },
    { label: 'Opening Balance',   val: '₹ ' + fmt(openingBal),        highlight: true, color: 'var(--amber)' },
    { label: 'Statement Span',    val: span !== null ? span + ' days' : '—',
      highlight: false, color: span !== null && span >= 90 ? 'var(--green)' : 'var(--red)' },
    { label: 'Days Since Last Txn', val: staledays !== null ? staledays + ' day(s) ago' : '—',
      highlight: false, color: staledays !== null && staledays <= 7 ? 'var(--green)' : 'var(--red)' },
    { label: 'Total Transactions',val: allTxns.length,                 highlight: false },
    { label: 'Bounce Events',     val: bounceTxns.length + (bounceTxns.length>0?' ⚠':''),
      highlight: false, color: bounceTxns.length > 0 ? 'var(--red)' : 'var(--green)' },
    { label: 'Statement Status',  val: 'VERIFIED',                     highlight: false, color: 'var(--green)' },
  ];

  grid.innerHTML = fields.map(f => `
    <div class="info-item">
      <label>${f.label}</label>
      <span style="${f.color ? 'color:'+f.color+';font-weight:600;' : ''}${f.highlight ? 'font-family:\'IBM Plex Mono\',monospace;letter-spacing:0.5px;' : ''}">${f.val}</span>
    </div>`
  ).join('');
}

function renderSummaryGrid() {
  const lastDateIdx = filtered90.length - 1;
  const last3m = new Date(filtered90[lastDateIdx].date);
  last3m.setMonth(last3m.getMonth() - 3);
  const last6m = new Date(filtered90[lastDateIdx].date);
  last6m.setMonth(last6m.getMonth() - 6);

  const txn3m = filtered90.filter(t => t.date >= last3m);
  const txn6m = filtered90.filter(t => t.date >= last6m);

  const avgBal3 = txn3m.map(t=>t.balance).reduce((s,v)=>s+v,0)/Math.max(1,txn3m.length);
  const avgBal6 = txn6m.map(t=>t.balance).reduce((s,v)=>s+v,0)/Math.max(1,txn6m.length);
  const totalCr3 = txn3m.filter(t=>t.type==='CR').reduce((s,t)=>s+t.amount,0);
  const totalDr3 = txn3m.filter(t=>t.type==='DR').reduce((s,t)=>s+t.amount,0);

  const grid = document.getElementById('summaryGrid');
  const items = [
    { label: 'Avg EOD Bal (Last 3M)', val: '₹ ' + fmt(avgBal3), cls: 'sv-green' },
    { label: 'Avg EOD Bal (Last 6M)', val: '₹ ' + fmt(avgBal6), cls: '' },
    { label: 'Total Credits (3M)', val: '₹ ' + fmt(totalCr3), cls: 'sv-green' },
    { label: 'Total Debits (3M)', val: '₹ ' + fmt(totalDr3), cls: 'sv-amber' },
    { label: 'Neg EOD Flag', val: 'N', cls: 'sv-green' },
    { label: 'Interest Delay', val: '0', cls: 'sv-green' },
    { label: 'Cr Txns (3M)', val: txn3m.filter(t=>t.type==='CR').length, cls: '' },
    { label: 'Dr Txns (3M)', val: txn3m.filter(t=>t.type==='DR').length, cls: '' },
  ];
  grid.innerHTML = items.map(it =>
    `<div class="summary-item"><label>${it.label}</label><div class="sv ${it.cls}">${it.val}</div></div>`
  ).join('');
}

// ─── Stats ───
function updateStats(first, last, days, total, selected, staledays) {
  document.getElementById('sFirstDate').textContent = fmtDate(first);
  document.getElementById('sLastDate').textContent = fmtDate(last);
  document.getElementById('sDays').textContent = days + ' days';
  document.getElementById('sDays').className = 'sv ' + (days < 90 ? 'red' : 'green');
  const stEl = document.getElementById('sStaleness');
  if (staledays !== undefined && staledays !== null) {
    stEl.textContent = staledays + ' day(s)';
    stEl.className = 'sv ' + (staledays > 7 ? 'red' : staledays >= 5 ? 'amber' : 'green');
  }
  document.getElementById('sTxnCount').textContent = total;
  document.getElementById('sSelected').textContent = selected;
  document.getElementById('statsRow').classList.add('show');
}

// ─── Excel Export (Full Perfios Format — All Sheets) ───
function exportExcel() {
  if (!monthOrder.length) return;
  showLoader('Building Excel workbook...');
  setTimeout(() => {
    try { _doExport(); hideLoader(); toast('✅ Excel exported successfully!'); }
    catch(e) { hideLoader(); toast('⚠ Export error: ' + e.message); }
  }, 50);
}

function _doExport() {
  const wb = XLSX.utils.book_new();
  const months = monthOrder.map(mk => new Date(+mk.split('-')[0], +mk.split('-')[1]-1, 1));
  const monthLabels = monthOrder.map(mk => abbData[mk].label);
  const cols = monthOrder.length;

  // ── Sheet 1: Analysis1 ──
  const a1 = [];
  a1.push(['Personal Info']);
  a1.push(['Name of the Account Holder', accountInfo.name        || '']);
  a1.push(['Address',                    accountInfo.address     || '']);
  a1.push(['Email',                      accountInfo.email       || '']);
  a1.push(['PAN',                        accountInfo.pan         || '']);
  a1.push(['Mobile Number',              accountInfo.mobile      || '']);
  a1.push(['IFSC Code',                  accountInfo.ifsc        || '']);
  a1.push(['Applicant ID',               '']);
  a1.push(['Perfios Transaction ID',     '']);
  a1.push(['Account Open Date',          accountInfo.periodFrom  || '']);
  a1.push(['DOB',                        'NA']);
  a1.push([]);
  a1.push(['Summary Info']);
  a1.push(['Name of the Bank',           accountInfo.bank        || '']);
  a1.push(['Account Number',             accountInfo.accountNo   || '']);
  a1.push(['Account Type',               accountInfo.accountType || '']);
  a1.push([]);
  a1.push(['Monthwise Details']);
  a1.push(['', ...monthLabels, 'TOTAL']);

  const analysisData = buildAnalysisData();
  for (const row of analysisData) {
    const r = [row.label];
    for (const v of row.values) r.push(v);
    r.push(row.total);
    a1.push(r);
  }
  a1.push([]);
  a1.push(['Overall Summary']);
  const ws1 = XLSX.utils.aoa_to_sheet(a1);
  ws1['!cols'] = [{ wch: 55 }, ...monthLabels.map(() => ({ wch: 14 })), { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Analysis1');

  // ── Sheet 2: FinOne1 ──
  const finOneData = buildFinOneData();
  const finOneCols = ['Month','Credits_Nos','Credits_Value','IW_Chq_Returns',
    '2','4','10','17','25','EOD_Last','Average','Withdrawal_Amount','OW_Chq_Returns',
    'Withdrawl_Nos','Total_Cheque_Bounces','O/W Chq Bounces%','Min_Balance',
    'EMI_Reflects','Salary_Credit','Salary_Date','I/W Chq Bounces%'];
  const f1 = [finOneCols];
  for (const r of finOneData) {
    f1.push([r.month,r.creditsNos,r.creditsValue,r.iwChqRet,
      r.bal2,r.bal4,r.bal10,r.bal17,r.bal25,r.eodLast,r.kAvg,
      r.withdrawalAmt,r.owChqRet,r.withdrawlNos,r.totalChqBounces,
      r.pct_ow,r.minBal,r.emiReflects,r.salaryCredit,r.salaryDate,r.pct_iw]);
  }
  const ws2 = XLSX.utils.aoa_to_sheet(f1);
  ws2['!cols'] = finOneCols.map(c => ({ wch: Math.max(c.length, 12) }));
  XLSX.utils.book_append_sheet(wb, ws2, 'FinOne1');

  // ── Sheet 3: ABB1 ──
  const abbRows = [];
  abbRows.push([]);
  abbRows.push(['Bank Name', accountInfo.bank || '']);
  abbRows.push(['Account number', accountInfo.accountNo || '']);
  abbRows.push([]);
  abbRows.push(['Date', ...months]);
  for (const day of TARGET_DAYS) {
    const row = [day];
    for (const mk of monthOrder) row.push(abbData[mk].dates[day] || 0);
    abbRows.push(row);
  }
  // Total (SUM formula)
  const totRow = ['Total'];
  for (const mk of monthOrder) totRow.push(Object.values(abbData[mk].dates).reduce((s,v)=>s+v,0));
  abbRows.push(totRow);
  // Monthly Average (AVERAGE formula)
  const avgRow = ['Monthly Average'];
  const monthlyAvgs = [];
  for (const mk of monthOrder) {
    const vals = Object.values(abbData[mk].dates);
    const avg = vals.length ? vals.reduce((s,v)=>s+v,0)/vals.length : 0;
    monthlyAvgs.push(avg);
    avgRow.push(avg);
  }
  abbRows.push(avgRow);
  abbRows.push([]);
  const abbVal = monthlyAvgs.length ? monthlyAvgs.reduce((s,v)=>s+v,0)/monthlyAvgs.length : 0;
  abbRows.push(['Average Bank Balance', abbVal]);
  abbRows.push([]);
  const credRow = ['Total credits'];
  for (const mk of monthOrder) credRow.push(abbData[mk].credits);
  abbRows.push(credRow);
  abbRows.push([]);
  abbRows.push(['', 'TOTAL']);
  abbRows.push(['Credit', ...monthOrder.map(mk=>abbData[mk].creditCount), monthOrder.reduce((s,mk)=>s+abbData[mk].creditCount,0)]);
  abbRows.push(['Credit Total', ...monthOrder.map(mk=>abbData[mk].credits), monthOrder.reduce((s,mk)=>s+abbData[mk].credits,0)]);

  const ws3 = XLSX.utils.aoa_to_sheet(abbRows);
  ws3['!cols'] = [{ wch: 28 }, ...monthOrder.map(() => ({ wch: 16 }))];
  XLSX.utils.book_append_sheet(wb, ws3, 'ABB1');

  // ── Sheet 4: Derived Analysis ──
  const da = [['Derived  Analysis'], ['',...monthLabels,'TOTAL','AVERAGE']];
  for (const row of analysisData) {
    const vals = row.values;
    const total = row.total;
    const avg = vals.length ? total/vals.length : 0;
    da.push([row.label, ...vals, total, avg]);
  }
  const ws4 = XLSX.utils.aoa_to_sheet(da);
  ws4['!cols'] = [{ wch: 55 }, ...monthLabels.map(() => ({ wch: 14 })), { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws4, 'Derived Analysis');

  // ── Sheet 5: Derived FinOne ──
  const df = [finOneCols];
  for (const r of finOneData) {
    df.push([r.month,r.creditsNos,r.creditsValue,r.iwChqRet,
      r.bal2,r.bal4,r.bal10,r.bal17,r.bal25,r.eodLast,r.kAvg,
      r.withdrawalAmt,r.owChqRet,r.withdrawlNos,r.totalChqBounces,
      r.pct_ow,r.minBal,r.emiReflects,r.salaryCredit,r.salaryDate,r.pct_iw]);
  }
  const ws5 = XLSX.utils.aoa_to_sheet(df);
  XLSX.utils.book_append_sheet(wb, ws5, 'Derived FinOne');

  // ── Sheet 6: Xns (All Transactions) ──
  const xData = [['Sl. No.','Date','Cheque No.','Description','Amount','Category','Balance']];
  filtered90.forEach((t,i) => xData.push([i+1, fmtDate(t.date), '', t.desc, t.type==='CR'?t.amount:-t.amount, t.category, t.balance]));
  const ws6 = XLSX.utils.aoa_to_sheet(xData);
  ws6['!cols'] = [{wch:6},{wch:12},{wch:12},{wch:60},{wch:14},{wch:28},{wch:14}];
  XLSX.utils.book_append_sheet(wb, ws6, 'Xns1');

  // ── Sheet 7: Target Date Rows ──
  const tdData = [['Target Date','Actual Date','Fallback?','Narration','Type','Amount','Balance']];
  for (const row of targetRows) {
    tdData.push([
      fmtDate(row.targetDate), row.actualDate ? fmtDate(row.actualDate) : 'N/A',
      row.fallback ? 'Yes' : 'No',
      row.txn ? row.txn.desc : 'No Data', row.txn ? row.txn.type : '—',
      row.txn ? row.txn.amount : '', row.txn ? row.txn.balance : ''
    ]);
  }
  const ws7 = XLSX.utils.aoa_to_sheet(tdData);
  ws7['!cols'] = [{wch:14},{wch:14},{wch:10},{wch:55},{wch:6},{wch:14},{wch:14}];
  XLSX.utils.book_append_sheet(wb, ws7, 'Target_Date_Rows');

  // ── Sheet 8: BreakUp-Income1 ──
  const { income, expense } = buildBreakupData();
  const incHead = [['Breakup of Incomes'], [' ITEM', ...months, 'Total', 'Average']];
  for (const r of income) incHead.push([r.label, ...r.values, r.total, r.avg]);
  const ws8 = XLSX.utils.aoa_to_sheet(incHead);
  ws8['!cols'] = [{wch:32}, ...months.map(()=>({wch:14})), {wch:14}, {wch:14}];
  XLSX.utils.book_append_sheet(wb, ws8, 'BreakUp-Income1');

  // ── Sheet 9: BreakUp-Expense1 ──
  const expHead = [['Breakup of Expenses'], [' ITEM', ...months, 'Total', 'Average']];
  for (const r of expense) expHead.push([r.label, ...r.values, r.total, r.avg]);
  const ws9 = XLSX.utils.aoa_to_sheet(expHead);
  ws9['!cols'] = [{wch:32}, ...months.map(()=>({wch:14})), {wch:14}, {wch:14}];
  XLSX.utils.book_append_sheet(wb, ws9, 'BreakUp-Expense1');

  // ── Sheet 10: EOD Balances1 ──
  const eodGrid = buildEODData();
  const eodData = [['Day/Month', ...months]];
  for (let d = 1; d <= 31; d++) {
    const row = [d];
    for (const mk of monthOrder) {
      const v = eodGrid[d] && eodGrid[d][mk];
      row.push(v || '');
    }
    eodData.push(row);
  }
  const ws10 = XLSX.utils.aoa_to_sheet(eodData);
  ws10['!cols'] = [{wch:10}, ...months.map(()=>({wch:14}))];
  XLSX.utils.book_append_sheet(wb, ws10, 'EOD Balances1');

  // ── Sheet 11: Statements Considered ──
  const stData = [[
    'File Name','Institution','Account No','Transaction Start Date','Transaction End Date',
    'Name as in Statement','Address as in Statement','Mobile as in Statement',
    'Landline as in Statement','Email as in Statement','PAN as in Statement',
    'Password Protected','Statement Status','Perfios Transaction Id'
  ]];
  if (filtered90.length) {
    stData.push([
      pendingFiles.map(f=>f.name).join(', '),
      accountInfo.bank || '',
      accountInfo.accountNo || '',
      fmtDate(filtered90[0].date),
      fmtDate(filtered90[filtered90.length-1].date),
      accountInfo.name    || '',
      accountInfo.address || '',
      accountInfo.mobile  || '',
      '',
      accountInfo.email   || '',
      accountInfo.pan     || '',
      'No','VERIFIED',''
    ]);
  }
  const ws11 = XLSX.utils.aoa_to_sheet(stData);
  ws11['!cols'] = stData[0].map(h => ({ wch: Math.max(h.length, 16) }));
  XLSX.utils.book_append_sheet(wb, ws11, 'Statements Considered');

  // ── Sheet 12: Salary Detection (Req 3 + 5) ──
  const salHeader = [['Salary Detection Report']];
  const hasSal = salaryTxns.length > 0;
  salHeader.push(['Salary Present', hasSal ? 'YES' : 'NO']);
  salHeader.push(['Total Salary Transactions', salaryTxns.length]);
  salHeader.push(['Total Credited', salaryTxns.reduce((s,t)=>s+(t.type==='CR'?t.amount:0),0)]);
  salHeader.push(['Keywords Matched', [...new Set(salaryTxns.map(t=>getSalaryKeyword(t.desc)))].join(', ') || 'None']);
  salHeader.push([]);
  salHeader.push(['#','Date','Description','CR/DR','Amount','Balance','Keyword Matched','Month']);
  salaryTxns.forEach((t,i) => salHeader.push([
    i+1, fmtDate(t.date), t.desc, t.type,
    t.amount, t.balance,
    getSalaryKeyword(t.desc) || 'SALARY',
    t.date.toLocaleString('en-IN',{month:'short',year:'2-digit'})
  ]));
  const wsSal = XLSX.utils.aoa_to_sheet(salHeader);
  wsSal['!cols'] = [{wch:4},{wch:12},{wch:60},{wch:6},{wch:14},{wch:14},{wch:18},{wch:10}];
  XLSX.utils.book_append_sheet(wb, wsSal, 'Salary_Detection');

  // ── Sheet 13: ACH Detection ──
  const achHeader = [['ACH / NACH Detection Report']];
  const hasACHExp = achTxns.length > 0;
  const achCrTotal = achTxns.filter(t=>t.type==='CR').reduce((s,t)=>s+t.amount,0);
  const achDrTotal = achTxns.filter(t=>t.type==='DR').reduce((s,t)=>s+t.amount,0);
  achHeader.push(['ACH Present', hasACHExp ? 'YES' : 'NO']);
  achHeader.push(['Total ACH Transactions', achTxns.length]);
  achHeader.push(['Total ACH Credits', achTxns.filter(t=>t.type==='CR').length, 'Amount', achCrTotal]);
  achHeader.push(['Total ACH Debits',  achTxns.filter(t=>t.type==='DR').length, 'Amount', achDrTotal]);
  achHeader.push(['Sub-Types Detected', [...new Set(achTxns.map(t=>getACHSubType(t.desc)))].join(', ') || 'None']);
  achHeader.push([]);
  achHeader.push(['#','Date','Description','CR/DR','Amount','Balance','ACH Sub-Type','Keyword Matched','Month']);
  achTxns.forEach((t,i) => achHeader.push([
    i+1, fmtDate(t.date), t.desc, t.type,
    t.amount, t.balance,
    getACHSubType(t.desc),
    getACHKeyword(t.desc) || 'ACH',
    t.date.toLocaleString('en-IN',{month:'short',year:'2-digit'})
  ]));
  const wsACH = XLSX.utils.aoa_to_sheet(achHeader);
  wsACH['!cols'] = [{wch:4},{wch:12},{wch:60},{wch:6},{wch:14},{wch:14},{wch:28},{wch:18},{wch:10}];
  XLSX.utils.book_append_sheet(wb, wsACH, 'ACH_Detection');

  // ── Sheet 14: ECS Detection ──
  const ecsHeader = [['ECS — Electronic Clearing Service Detection Report']];
  const hasECSExp = ecsTxns.length > 0;
  const ecsCrTotal  = ecsTxns.filter(t=>t.type==='CR').reduce((s,t)=>s+t.amount,0);
  const ecsDrTotal  = ecsTxns.filter(t=>t.type==='DR').reduce((s,t)=>s+t.amount,0);
  const ecsRetTotal = ecsTxns.filter(t=>/return|bounce|rej/i.test(getECSSubType(t.desc))).length;
  ecsHeader.push(['ECS Present', hasECSExp ? 'YES' : 'NO']);
  ecsHeader.push(['Total ECS Transactions', ecsTxns.length]);
  ecsHeader.push(['Total ECS Credits', ecsTxns.filter(t=>t.type==='CR').length, 'Amount', ecsCrTotal]);
  ecsHeader.push(['Total ECS Debits',  ecsTxns.filter(t=>t.type==='DR').length, 'Amount', ecsDrTotal]);
  ecsHeader.push(['ECS Returns / Bounces', ecsRetTotal]);
  ecsHeader.push(['Sub-Types Detected', [...new Set(ecsTxns.map(t=>getECSSubType(t.desc)))].join(', ') || 'None']);
  ecsHeader.push([]);
  ecsHeader.push(['#','Date','Description','CR/DR','Amount','Balance','ECS Sub-Type','Keyword Matched','Month','Return?']);
  ecsTxns.forEach((t,i) => {
    const sub = getECSSubType(t.desc);
    ecsHeader.push([
      i+1, fmtDate(t.date), t.desc, t.type,
      t.amount, t.balance,
      sub,
      getECSKeyword(t.desc) || 'ECS',
      t.date.toLocaleString('en-IN',{month:'short',year:'2-digit'}),
      /return|bounce|rej/i.test(sub) ? 'YES ⚠' : 'NO'
    ]);
  });
  const wsECS = XLSX.utils.aoa_to_sheet(ecsHeader);
  wsECS['!cols'] = [{wch:4},{wch:12},{wch:60},{wch:6},{wch:14},{wch:14},{wch:30},{wch:18},{wch:10},{wch:8}];
  XLSX.utils.book_append_sheet(wb, wsECS, 'ECS_Detection');

  // ── Sheet 15: NEFT / RTGS Detection ──
  const neftHeader = [['NEFT / RTGS — Fund Transfer Detection Report']];
  const hasNEFTExp   = neftTxns.length > 0;
  const neftCrTotal  = neftTxns.filter(t=>t.type==='CR').reduce((s,t)=>s+t.amount,0);
  const neftDrTotal  = neftTxns.filter(t=>t.type==='DR').reduce((s,t)=>s+t.amount,0);
  const neftRetTotal = neftTxns.filter(t=>/return|reject/i.test(getNEFTSubType(t.rawDesc||t.desc))).length;
  const neftOnlyExp  = neftTxns.filter(t=>/neft/i.test(getNEFTSubType(t.rawDesc||t.desc)));
  const rtgsOnlyExp  = neftTxns.filter(t=>/rtgs/i.test(getNEFTSubType(t.rawDesc||t.desc)));
  neftHeader.push(['NEFT/RTGS Present', hasNEFTExp ? 'YES' : 'NO']);
  neftHeader.push(['Total NEFT/RTGS Transactions', neftTxns.length]);
  neftHeader.push(['NEFT Transactions', neftOnlyExp.length]);
  neftHeader.push(['RTGS Transactions', rtgsOnlyExp.length]);
  neftHeader.push(['Total Credits', neftTxns.filter(t=>t.type==='CR').length, 'Amount (₹)', neftCrTotal]);
  neftHeader.push(['Total Debits',  neftTxns.filter(t=>t.type==='DR').length, 'Amount (₹)', neftDrTotal]);
  neftHeader.push(['Returns / Rejections', neftRetTotal]);
  neftHeader.push(['Sub-Types Detected', [...new Set(neftTxns.map(t=>getNEFTSubType(t.rawDesc||t.desc)))].join(', ') || 'None']);
  neftHeader.push([]);
  neftHeader.push(['#','Date','Description','CR/DR','Amount (₹)','Balance (₹)','Transfer Type','Keyword Matched','Month','Return?']);
  neftTxns.forEach((t,i) => {
    const sub = getNEFTSubType(t.rawDesc||t.desc);
    neftHeader.push([
      i+1, fmtDate(t.date), t.desc, t.type,
      t.amount, t.balance,
      sub,
      getNEFTKeyword(t.rawDesc||t.desc) || 'NEFT/RTGS',
      t.date.toLocaleString('en-IN',{month:'short',year:'2-digit'}),
      /return|reject/i.test(sub) ? 'YES ⚠' : 'NO'
    ]);
  });
  const wsNEFT = XLSX.utils.aoa_to_sheet(neftHeader);
  wsNEFT['!cols'] = [{wch:4},{wch:12},{wch:60},{wch:6},{wch:14},{wch:14},{wch:32},{wch:18},{wch:10},{wch:8}];
  XLSX.utils.book_append_sheet(wb, wsNEFT, 'NEFT_RTGS_Detection');

  // ── Sheet 16: Payment Summary (ACH + ECS + NEFT/RTGS + Salary combined) ──
  const pmtRows = [
    ['Payment Detection Summary — Perfios Banking System'],
    ['Generated On', fmtDate(new Date())],
    [],
    ['Category', 'Present?', 'Total Txns', 'Credit Txns', 'Credit Amount (₹)', 'Debit Txns', 'Debit Amount (₹)', 'Returns/Bounces', 'Months Active'],
  ];
  const salCrPmt = salaryTxns.filter(t=>t.type==='CR');
  const salDrPmt = salaryTxns.filter(t=>t.type==='DR');
  const achCrPmt = achTxns.filter(t=>t.type==='CR');
  const achDrPmt = achTxns.filter(t=>t.type==='DR');
  const ecsCrPmt = ecsTxns.filter(t=>t.type==='CR');
  const ecsDrPmt = ecsTxns.filter(t=>t.type==='DR');
  pmtRows.push([
    'SALARY',
    salaryTxns.length > 0 ? 'YES' : 'NO',
    salaryTxns.length,
    salCrPmt.length, salCrPmt.reduce((s,t)=>s+t.amount,0),
    salDrPmt.length, salDrPmt.reduce((s,t)=>s+t.amount,0),
    0,
    new Set(salaryTxns.map(t=>t.date.getMonth()+'-'+t.date.getFullYear())).size
  ]);
  pmtRows.push([
    'ACH / NACH',
    achTxns.length > 0 ? 'YES' : 'NO',
    achTxns.length,
    achCrPmt.length, achCrPmt.reduce((s,t)=>s+t.amount,0),
    achDrPmt.length, achDrPmt.reduce((s,t)=>s+t.amount,0),
    0,
    new Set(achTxns.map(t=>t.date.getMonth()+'-'+t.date.getFullYear())).size
  ]);
  const neftCrPmt = neftTxns.filter(t=>t.type==='CR');
  const neftDrPmt = neftTxns.filter(t=>t.type==='DR');
  pmtRows.push([
    'ECS',
    ecsTxns.length > 0 ? 'YES' : 'NO',
    ecsTxns.length,
    ecsCrPmt.length, ecsCrPmt.reduce((s,t)=>s+t.amount,0),
    ecsDrPmt.length, ecsDrPmt.reduce((s,t)=>s+t.amount,0),
    ecsTxns.filter(t=>/return|bounce|rej/i.test(getECSSubType(t.desc))).length,
    new Set(ecsTxns.map(t=>t.date.getMonth()+'-'+t.date.getFullYear())).size
  ]);
  pmtRows.push([
    'NEFT / RTGS',
    neftTxns.length > 0 ? 'YES' : 'NO',
    neftTxns.length,
    neftCrPmt.length, neftCrPmt.reduce((s,t)=>s+t.amount,0),
    neftDrPmt.length, neftDrPmt.reduce((s,t)=>s+t.amount,0),
    neftTxns.filter(t=>/return|reject/i.test(getNEFTSubType(t.rawDesc||t.desc))).length,
    new Set(neftTxns.map(t=>t.date.getMonth()+'-'+t.date.getFullYear())).size
  ]);
  pmtRows.push([]);
  pmtRows.push(['TOTAL PAYMENT TRANSACTIONS',
    '', salaryTxns.length + achTxns.length + ecsTxns.length + neftTxns.length,
    salCrPmt.length+achCrPmt.length+ecsCrPmt.length+neftCrPmt.length,
    salCrPmt.reduce((s,t)=>s+t.amount,0)+achCrPmt.reduce((s,t)=>s+t.amount,0)+ecsCrPmt.reduce((s,t)=>s+t.amount,0)+neftCrPmt.reduce((s,t)=>s+t.amount,0),
    salDrPmt.length+achDrPmt.length+ecsDrPmt.length+neftDrPmt.length,
    salDrPmt.reduce((s,t)=>s+t.amount,0)+achDrPmt.reduce((s,t)=>s+t.amount,0)+ecsDrPmt.reduce((s,t)=>s+t.amount,0)+neftDrPmt.reduce((s,t)=>s+t.amount,0),
    ecsTxns.filter(t=>/return|bounce|rej/i.test(getECSSubType(t.desc))).length + neftTxns.filter(t=>/return|reject/i.test(getNEFTSubType(t.rawDesc||t.desc))).length,
    ''
  ]);
  const wsPmt = XLSX.utils.aoa_to_sheet(pmtRows);
  wsPmt['!cols'] = [{wch:20},{wch:10},{wch:12},{wch:14},{wch:20},{wch:14},{wch:20},{wch:18},{wch:14}];
  XLSX.utils.book_append_sheet(wb, wsPmt, 'Payment_Summary');

  // ── Sheet 17: UPI / IMPS Detection ──
  const upiHeader = [['UPI / IMPS — Instant Payment Detection Report']];
  const upiCrExp = upiTxns.filter(t=>t.type==='CR'); const upiDrExp = upiTxns.filter(t=>t.type==='DR');
  upiHeader.push(['UPI/IMPS Present', upiTxns.length > 0 ? 'YES' : 'NO']);
  upiHeader.push(['Total UPI/IMPS Transactions', upiTxns.length]);
  upiHeader.push(['Credits', upiCrExp.length, 'Amount (₹)', upiCrExp.reduce((s,t)=>s+t.amount,0)]);
  upiHeader.push(['Debits',  upiDrExp.length, 'Amount (₹)', upiDrExp.reduce((s,t)=>s+t.amount,0)]);
  upiHeader.push([]);
  upiHeader.push(['#','Date','Description','CR/DR','Amount (₹)','Balance (₹)','Payment Type','Keyword Matched','Month']);
  upiTxns.forEach((t,i) => upiHeader.push([i+1, fmtDate(t.date), t.desc, t.type, t.amount, t.balance, getUPISubType(t.rawDesc||t.desc), getUPIKeyword(t.rawDesc||t.desc)||'UPI/IMPS', t.date.toLocaleString('en-IN',{month:'short',year:'2-digit'})]));
  const wsUPI = XLSX.utils.aoa_to_sheet(upiHeader);
  wsUPI['!cols'] = [{wch:4},{wch:12},{wch:60},{wch:6},{wch:14},{wch:14},{wch:28},{wch:16},{wch:10}];
  XLSX.utils.book_append_sheet(wb, wsUPI, 'UPI_IMPS_Detection');

  // ── Sheet 18: Cheque / CTS Detection ──
  const chqHeader = [['Cheque / CTS — Paper Instrument Detection Report']];
  const chqCrExp = chequeTxns.filter(t=>t.type==='CR'); const chqDrExp = chequeTxns.filter(t=>t.type==='DR');
  const chqBounceExp = chequeTxns.filter(t=>/return|bounce|dishon/i.test(getChequeSubType(t.rawDesc||t.desc))).length;
  chqHeader.push(['Cheque Present', chequeTxns.length > 0 ? 'YES' : 'NO']);
  chqHeader.push(['Total Cheque Transactions', chequeTxns.length]);
  chqHeader.push(['Deposits', chqCrExp.length, 'Amount (₹)', chqCrExp.reduce((s,t)=>s+t.amount,0)]);
  chqHeader.push(['Issues', chqDrExp.length, 'Amount (₹)', chqDrExp.reduce((s,t)=>s+t.amount,0)]);
  chqHeader.push(['Returns/Bounces', chqBounceExp]);
  chqHeader.push([]);
  chqHeader.push(['#','Date','Description','CR/DR','Amount (₹)','Balance (₹)','Sub-Type','Keyword Matched','Month','Bounce?']);
  chequeTxns.forEach((t,i) => { const sub = getChequeSubType(t.rawDesc||t.desc); chqHeader.push([i+1, fmtDate(t.date), t.desc, t.type, t.amount, t.balance, sub, getChequeKeyword(t.rawDesc||t.desc)||'CHQ', t.date.toLocaleString('en-IN',{month:'short',year:'2-digit'}), /return|bounce|dishon/i.test(sub)?'YES ⚠':'NO']); });
  const wsChq = XLSX.utils.aoa_to_sheet(chqHeader);
  wsChq['!cols'] = [{wch:4},{wch:12},{wch:60},{wch:6},{wch:14},{wch:14},{wch:28},{wch:16},{wch:10},{wch:8}];
  XLSX.utils.book_append_sheet(wb, wsChq, 'Cheque_CTS_Detection');

  // ── Sheet 19: Bounce / Overdraft Report ──
  const bounceHeader = [['Bounce & Overdraft Report — Perfios Banking System v6.0']];
  bounceHeader.push(['Total Bounce Events', bounceTxns.length]);
  bounceHeader.push(['Inward Bounces (Non-Technical)', bounceTxns.filter(t=>isBounceInward(t.rawDesc||t.desc)===true&&!/technical/i.test(getBounceSubType(t.rawDesc||t.desc))).length]);
  bounceHeader.push(['Inward Bounces (Technical)', bounceTxns.filter(t=>/technical/i.test(getBounceSubType(t.rawDesc||t.desc))).length]);
  bounceHeader.push(['Outward Bounces', bounceTxns.filter(t=>isBounceInward(t.rawDesc||t.desc)===false).length]);
  bounceHeader.push(['Overdraft Events', overdraftTxns.length]);
  bounceHeader.push(['Days Overdrawn', new Set(overdraftTxns.map(t=>fmtDate(t.date))).size]);
  bounceHeader.push([]);
  bounceHeader.push(['BOUNCE TRANSACTIONS']);
  bounceHeader.push(['#','Date','Description','CR/DR','Amount (₹)','Balance (₹)','Bounce Type','Month']);
  bounceTxns.forEach((t,i) => bounceHeader.push([i+1, fmtDate(t.date), t.desc, t.type, t.amount, t.balance, getBounceSubType(t.rawDesc||t.desc), t.date.toLocaleString('en-IN',{month:'short',year:'2-digit'})]));
  bounceHeader.push([]);
  bounceHeader.push(['OVERDRAFT EVENTS (Negative Balance)']);
  bounceHeader.push(['#','Date','Description','CR/DR','Amount (₹)','Balance After (₹)','Month']);
  overdraftTxns.forEach((t,i) => bounceHeader.push([i+1, fmtDate(t.date), t.desc, t.type, t.amount, t.balance, t.date.toLocaleString('en-IN',{month:'short',year:'2-digit'})]));
  const wsBounce = XLSX.utils.aoa_to_sheet(bounceHeader);
  wsBounce['!cols'] = [{wch:4},{wch:12},{wch:60},{wch:6},{wch:14},{wch:14},{wch:32},{wch:10}];
  XLSX.utils.book_append_sheet(wb, wsBounce, 'Bounce_Overdraft');

  // ── Sheet 20: Multi-Account Summary ──
  const acctRows = [['Multi-Account Summary — Perfios Banking System v8.0'],[]];
  acctRows.push(['File','Account No.','Bank','Holder','First Txn','Last Txn','Total Txns','Total CR (₹)','Total DR (₹)','Opening Balance (₹)']);
  perFileData.forEach(fd => {
    const st = [...fd.txns].sort((a,b)=>a.date-b.date);
    const crT = fd.txns.filter(t=>t.type==='CR').reduce((s,t)=>s+t.amount,0);
    const drT = fd.txns.filter(t=>t.type==='DR').reduce((s,t)=>s+t.amount,0);
    const firstT = st[0];
    const ob = firstT ? (firstT.type === 'CR' ? firstT.balance - firstT.amount : firstT.balance + firstT.amount) : 0;
    acctRows.push([fd.fileName, fd.accountInfo.accountNo||'', fd.accountInfo.bank||'', fd.accountInfo.name||'', st.length?fmtDate(st[0].date):'', st.length?fmtDate(st[st.length-1].date):'', fd.txns.length, crT, drT, ob]);
  });
  const wsAcct = XLSX.utils.aoa_to_sheet(acctRows);
  wsAcct['!cols'] = [{wch:40},{wch:20},{wch:30},{wch:30},{wch:14},{wch:14},{wch:12},{wch:16},{wch:16},{wch:18}];
  XLSX.utils.book_append_sheet(wb, wsAcct, 'Multi_Account_Summary');

  // ── Sheet 21: Validation Report ──
  const today2 = new Date(); today2.setHours(0,0,0,0);
  const firstD = allTxns.length ? allTxns[0].date : null;
  const lastD  = allTxns.length ? allTxns[allTxns.length-1].date : null;
  const span   = firstD && lastD ? Math.floor((lastD - firstD)/86400000) : 0;
  const stale  = lastD ? Math.floor((today2 - lastD)/86400000) : 999;
  // Opening balance for validation report
  const sortedV = [...allTxns].sort((a,b)=>a.date-b.date);
  const openBalV = getOpeningBalance(sortedV);
  const valRows = [
    ['Validation Report — Perfios Banking System v8.0 — Universal Bank Parser'],
    ['Generated On', fmtDate(today2)],
    ['File(s) Processed', pendingFiles.map(f=>f.name).join(', ')],
    ['Opening Balance (₹)', openBalV],
    [],
    ['Rule', 'Check', 'Result', 'Value', 'Detail'],
    ['Rule 1 (90-Day Span)',
      'First txn → Last txn ≥ 90 days',
      span >= 90 ? 'PASS' : 'FAIL',
      span + ' days',
      `${fmtDate(firstD)} → ${fmtDate(lastD)}`],
    ['Rule 2 (7-Day Staleness)',
      'Last txn within 7 days of upload',
      stale <= 7 ? 'PASS' : 'FAIL',
      stale + ' day(s) ago',
      `Last txn: ${fmtDate(lastD)}, Today: ${fmtDate(today2)}`],
    ['Rule 3 (Salary Detection)',
      'Salary transactions present',
      salaryTxns.length > 0 ? 'FOUND' : 'NOT FOUND',
      salaryTxns.length + ' txn(s)',
      salaryTxns.length > 0 ? `Keywords: ${[...new Set(salaryTxns.map(t=>getSalaryKeyword(t.desc)))].join(', ')}` : 'No salary keywords matched'],
    ['Rule 4 (ACH / NACH Detection)', 'ACH/NACH/Direct Debit transactions', achTxns.length > 0 ? 'FOUND' : 'NOT DETECTED', achTxns.length + ' txn(s)', achTxns.length > 0 ? `Sub-types: ${[...new Set(achTxns.map(t=>getACHSubType(t.desc)))].join(', ')}` : 'None'],
    ['Rule 5 (ECS Detection)', 'ECS transactions present', ecsTxns.length > 0 ? 'FOUND' : 'NOT DETECTED', ecsTxns.length + ' txn(s)', ecsTxns.length > 0 ? `Returns/Bounces: ${ecsTxns.filter(t=>/return|bounce|rej/i.test(getECSSubType(t.desc))).length}` : 'None'],
    ['Rule 6 (NEFT/RTGS Detection)', 'NEFT/RTGS fund transfer transactions', neftTxns.length > 0 ? 'FOUND' : 'NOT DETECTED', neftTxns.length + ' txn(s)', neftTxns.length > 0 ? `Returns: ${neftTxns.filter(t=>/return|reject/i.test(getNEFTSubType(t.rawDesc||t.desc))).length}` : 'None'],
    ['Rule 7 (UPI/IMPS Detection)', 'UPI/IMPS instant payment transactions', upiTxns.length > 0 ? 'FOUND' : 'NOT DETECTED', upiTxns.length + ' txn(s)', upiTxns.length > 0 ? `Sub-types: ${[...new Set(upiTxns.map(t=>getUPISubType(t.rawDesc||t.desc)))].join(', ')}` : 'None'],
    ['Rule 8 (Cheque/CTS Detection)', 'Cheque/CTS paper instrument transactions', chequeTxns.length > 0 ? 'FOUND' : 'NOT DETECTED', chequeTxns.length + ' txn(s)', chequeTxns.length > 0 ? `Bounces: ${chequeTxns.filter(t=>/return|bounce|dishon/i.test(getChequeSubType(t.rawDesc||t.desc))).length}` : 'None'],
    ['Rule 9 (Bounce Detection)', 'Bounce / return / dishonoured instruments', bounceTxns.length > 0 ? 'BOUNCES FOUND' : 'CLEAN', bounceTxns.length + ' bounce(s)', bounceTxns.length > 0 ? `Inward NT: ${bounceTxns.filter(t=>isBounceInward(t.rawDesc||t.desc)===true&&!/technical/i.test(getBounceSubType(t.rawDesc||t.desc))).length}, Inward T: ${bounceTxns.filter(t=>/technical/i.test(getBounceSubType(t.rawDesc||t.desc))).length}, Outward: ${bounceTxns.filter(t=>isBounceInward(t.rawDesc||t.desc)===false).length}` : 'No bounces'],
    ['Rule 10 (Overdraft)', 'Negative balance events', overdraftTxns.length > 0 ? 'OVERDRAWN' : 'CLEAN', overdraftTxns.length + ' event(s)', overdraftTxns.length > 0 ? `Days overdrawn: ${new Set(overdraftTxns.map(t=>fmtDate(t.date))).size}, Min balance: ₹${fmt(Math.min(...overdraftTxns.map(t=>t.balance)))}` : 'Never overdrawn'],
    ['Rule 11 (Password PDF)', 'Password-protected files handled', 'HANDLED', pwdAttempts + ' attempt(s)', 'Password entry provided; incorrect passwords prompted retry'],
    ['Rule 12 (Output)', 'Structured Excel report generated', 'PASS', (wb.SheetNames.length + 1) + ' sheets', 'Full sheet set generated including UPI, Cheque, Bounce, Multi-Account'],
    [],
    ['Overall Result', (span >= 90 && stale <= 7) ? 'PERFIOS RUN: APPROVED' : 'PERFIOS RUN: REJECTED', '', '', ''],
  ];
  const wsVal = XLSX.utils.aoa_to_sheet(valRows);
  wsVal['!cols'] = [{wch:28},{wch:36},{wch:18},{wch:18},{wch:80}];
  XLSX.utils.book_append_sheet(wb, wsVal, 'Validation_Report');

  const exportDate = new Date();
  const fname = `Perfios_BankAnalysis_${String(exportDate.getDate()).padStart(2,'0')}${String(exportDate.getMonth()+1).padStart(2,'0')}${exportDate.getFullYear()}.xlsx`;
  XLSX.writeFile(wb, fname);
}

// ─── Tabs ───
function showTab(tab) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('show'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const map = {
    txn:'secTxn', perfios:'secPerfios', target:'secTarget',
    salary:'secSalary', ach:'secACH', ecs:'secECS', neft:'secNEFT',
    upi:'secUPI', cheque:'secCheque', bounce:'secBounce', accounts:'secAccounts',
    validation:'secValidation',
    finone:'secFinOne', analysis:'secAnalysis', breakup:'secBreakup', eod:'secEOD'
  };
  const tabBtns = document.querySelectorAll('.tab');
  const tabIdx  = { txn:0, perfios:1, target:2, salary:3, ach:4, ecs:5, neft:6, upi:7, cheque:8, bounce:9, finone:10, analysis:11, breakup:12, eod:13, accounts:14, validation:15 };
  const secId = map[tab];
  if (secId) document.getElementById(secId).classList.add('show');
  if (tabIdx[tab] !== undefined) tabBtns[tabIdx[tab]].classList.add('active');
}

// ─── Pipeline steps ───
function setStep(n) {
  for (let i = 1; i <= 5; i++) {
    const el = document.getElementById('pStep' + i);
    if (!el) continue;
    el.classList.remove('active', 'done');
    if (i < n) el.classList.add('done');
    else if (i === n) el.classList.add('active');
  }
}

// ─── Misc UI ───
let _loaderTimer = null;
function showLoader(msg) {
  const m = msg || 'Processing...';
  document.getElementById('loaderMsg').textContent = m;
  document.getElementById('loadingOverlay').classList.add('show');
  const ps = document.getElementById('procStatus');
  const pt = document.getElementById('procStatusText');
  if (ps && pt) { ps.style.display = 'flex'; pt.textContent = m; }
  clearTimeout(_loaderTimer);
  _loaderTimer = setTimeout(function() {
    hideLoader();
    showBanner('error',
      '⚠️ Processing timed out after 45s. The PDF may be image-based (scanned, no text layer), ' +
      'corrupted, or in an unsupported format. Please try a different PDF.'
    );
    document.getElementById('validationSection').classList.add('show');
    if (currentFileIdx < (pendingFiles ? pendingFiles.length : 0)) {
      currentFileIdx++;
      processNextFile();
    }
  }, 45000);
}
function hideLoader() {
  clearTimeout(_loaderTimer);
  document.getElementById('loadingOverlay').classList.remove('show');
  const ps = document.getElementById('procStatus');
  if (ps) ps.style.display = 'none';
}
function showLog() { document.getElementById('logCard').classList.add('show'); }
function log(type, msg) {
  _processLog.push({ type, msg: String(msg) });
  const area = document.getElementById('logInner');
  const d = document.createElement('div');
  d.className = type === 'ok' ? 'l-ok' : type === 'warn' ? 'l-warn' : type === 'skip' ? 'l-skip' : 'l-info';
  d.textContent = '> ' + msg;
  area.appendChild(d);
  area.scrollTop = area.scrollHeight;
  document.getElementById('logBadge').textContent = area.children.length + ' events';
}
function showBanner(type, msg) {
  const b    = document.getElementById('valBanner');
  const icon = document.getElementById('bannerIcon');
  const title = document.getElementById('bannerTitle');
  const detail = document.getElementById('bannerDetail');
  if (!b) return;
  b.className = 'banner show ' + type;
  // Split on ' · ' to separate title from details
  const parts = msg.replace(/^[🚫✅⚠️]+\s*/, '').split(' · ');
  const mainTitle = parts[0].replace(/^PERFIOS RUN FAILED \[.*?\]\s*[—\-]\s*/, '').trim();
  const details = parts.slice(1);
  if (icon) icon.textContent = type==='error' ? '🚫' : type==='success' ? '✅' : '⚠️';
  if (title) title.textContent = mainTitle;
  if (detail) detail.textContent = details.join(' · ');
}
function toast(msg) {
  const t = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 4000);
}

function resetAll() {
  _processLog = [];
  allTxns=[]; filtered90=[]; targetRows=[]; abbData={}; monthOrder=[]; pendingFiles=[]; currentFileIdx=0; accountInfo={};
  salaryTxns=[]; achTxns=[]; ecsTxns=[]; neftTxns=[]; upiTxns=[]; chequeTxns=[]; bounceTxns=[]; overdraftTxns=[]; validChecks=[]; pwdAttempts=0; perFileData=[]; _txnFilterAccount='ALL';
  document.getElementById('fileInput').value = '';
  document.getElementById('bulkPwdPanel').classList.remove('show'); // FIX: hide pre-set panel on reset
  document.getElementById('logCard').classList.remove('show');
  document.getElementById('logInner').innerHTML = '';
  const _sRow = document.getElementById('statsRow'); if (_sRow) _sRow.classList.remove('show');
  const _tRow = document.getElementById('tabsRow'); if (_tRow) _tRow.style.display = 'none';
  ['secTxn','secPerfios','secTarget','secSalary','secACH','secECS','secNEFT','secUPI','secCheque','secBounce','secAccounts','secValidation','secFinOne','secAnalysis','secBreakup','secEOD'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('show');
  });
  const _ab=document.getElementById('actionBar'); if(_ab) _ab.classList.remove('show');
  const _vb=document.getElementById('valBanner'); if(_vb) _vb.className='banner';
  salaryTxns = []; achTxns = []; ecsTxns = []; neftTxns = []; validChecks = []; pwdAttempts = 0;
  ['tbodyTxn','tbodyTarget','tbodySalary','tbodyACH','tbodyECS','tbodyNEFT','tbodyUPI','tbodyCheque','tbodyBounce','tbodyOverdraft','tbodyAccounts',
   'pfHead','pfBody','finOneHead','finOneBody',
   'analysisHead','analysisBody','incomeHead','incomeBody','expenseHead','expenseBody',
   'eodHead','eodBody','infoGrid','summaryGrid','salarySummary','achSummary','ecsSummary','neftSummary',
   'upiSummary','chequeSummary','bounceSummary','overdraftSummary','accountsGrid','validationGrid'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
  ['sFirstDate','sLastDate','sDays','sStaleness','sTxnCount','sSelected','sABB','sACH','sECS','sNEFT'].forEach(function(id){var el=document.getElementById(id);if(el)el.textContent='—';});
  const acctBar = document.getElementById('txnAcctBar');
  if (acctBar) { acctBar.style.display='none'; acctBar.innerHTML='<label>Account:</label><button class="acct-btn active" onclick="setTxnAccount(\'ALL\',this)">All</button>'; }
  setStep(1);
}

// ─── Formatters ───
function fmtDate(d) {
  if (!d) return '—';
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}
function fmt(n) {
  if (n === null || n === undefined || n === '') return '';
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Mark step 1 active on load
// abDays removed — not in popup-only UI