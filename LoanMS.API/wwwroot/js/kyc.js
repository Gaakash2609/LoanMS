// ── Safe localStorage helpers (private to this module) ──
var _lsGet = function(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } };
var _lsSet = function(k,v){ try{ localStorage.setItem(k,v); }catch(e){} };
var _lsRemove = function(k){ try{ localStorage.removeItem(k); }catch(e){} };
  // ═══════════════════════════════════════════════════════
  //  KYC MODULE — Integrated from kyc_v16
  // ═══════════════════════════════════════════════════════

  // ── Server-Side KYC Vision Proxy ────────────────────────────────────────────
  // Browser calls /api/kyc/vision — the .NET backend holds the Anthropic API key
  // encrypted in DB. The key is NEVER sent to the browser.
  // To configure: Settings → KYC Vision → enter your Anthropic API key.
  function _kycApiEndpoint() {
    // Always route through our own backend proxy — no localStorage, no direct API key in browser.
    var sess = JSON.parse(_lsGet('efin_session') || '{}');
    return {
      url: '/api/kyc/vision',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (sess.token || '')
      }
    };
  }

// ─────────────────────── STATE ───────────────────────
// KYC state object — use window.KYC if already defined by efin-app.js, else create it
if (typeof window.KYC === 'undefined') {
  window.KYC = {
    pan:    { file:null, dataUrl:null, mediaType:null, isPdf:false, data:null },
    aadhar: { file:null, dataUrl:null, mediaType:null, isPdf:false, data:null },
    aadharBack: { file:null, dataUrl:null, mediaType:null, isPdf:false },
    validationLog: [],
    reportTs: null,
    apiKey: ''
  };
}
var KYC = window.KYC;

// ─────────────────────── UPLOAD ───────────────────────
function kycHandleUpload(type, input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 15*1024*1024) { showToast('File too large (max 15MB)','error'); return; }

  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  if (isPdf && typeof pdfjsLib !== 'undefined' && typeof _docPasswordPrompt !== 'undefined') {
    // Check for password protection before committing
    file.arrayBuffer().then(function(buf) {
      const bytes = new Uint8Array(buf);
      pdfjsLib.getDocument({ data: bytes }).promise
        .then(function() {
          // Not password-protected — normal flow
          _kycHandleUploadCommit(type, file, null);
        })
        .catch(function(err) {
          if (err.name === 'PasswordException' || String(err.message).toLowerCase().includes('password')) {
            // Show shared password prompt
            _docPasswordPrompt(
              file, file.name,
              function onSuccess(password) {
                _kycHandleUploadCommit(type, file, password);
              },
              function onSkip() {
                // Attach without unlocking — OCR will handle or user fills manually
                _kycHandleUploadCommit(type, file, null);
              }
            );
          } else {
            _kycHandleUploadCommit(type, file, null);
          }
        });
    }).catch(function() {
      _kycHandleUploadCommit(type, file, null);
    });
  } else {
    _kycHandleUploadCommit(type, file, null);
  }
}

function _kycHandleUploadCommit(type, file, pdfPassword) {
  KYC[type].file = file;
  KYC[type].isPdf = (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
  KYC[type].mediaType = file.type;
  if (pdfPassword) KYC[type].pdfPassword = pdfPassword;  // stored for session use by OCR
  const reader = new FileReader();
  reader.onload = function(ev) {
    KYC[type].dataUrl = ev.target.result;
    if (!KYC[type].isPdf) {
      const img = document.getElementById('kyc-'+type+'-img');
      const prev = document.getElementById('kyc-'+type+'-preview');
      if (img) img.src = ev.target.result;
      if (prev) prev.style.display = 'block';
      document.getElementById('kyc-'+type+'-pdf-info').style.display = 'none';
    } else {
      document.getElementById('kyc-'+type+'-preview').style.display = 'none';
      const pi = document.getElementById('kyc-'+type+'-pdf-info');
      pi.textContent = (pdfPassword ? '🔓 ' : '📄 ') + file.name + ' (' + (file.size/1024).toFixed(0) + ' KB)' + (pdfPassword ? ' — password saved' : '');
      pi.style.display = 'block';
    }
    const badge = document.getElementById('kyc-'+type+'-badge');
    if (badge) badge.innerHTML = '<span class="kyc-badge-info">\u2713 Ready' + (pdfPassword ? ' 🔐' : '') + '</span>';
    const bt = document.getElementById('kyc-'+type+'-btn-text');
    if (bt) bt.textContent = 'Change ' + (type==='pan' ? 'PAN' : 'Aadhaar');
    const st = document.getElementById('kyc-'+type+'-status');
    if (st) st.innerHTML = '<div style="font-size:11.5px;color:var(--success);font-weight:600;margin-top:4px">\u2713 ' + file.name + (pdfPassword ? ' <span style="font-size:10px;color:#b45309;background:rgba(217,119,6,.1);padding:2px 7px;border-radius:10px;margin-left:4px">🔐 Password saved</span>' : '') + '</div>';
    const card = document.getElementById('kyc-'+type+'-card');
    if (card) { card.classList.add('card-uploaded'); card.style.borderColor='var(--success)'; card.style.borderStyle='solid'; }
    kycCheckExtractReady();
  };
  reader.readAsDataURL(file);
}

function kycCheckExtractReady() {
  const btn = document.getElementById('kyc-extract-btn');
  const panReady        = !!KYC.pan.dataUrl;
  const aadharReady     = !!KYC.aadhar.dataUrl;
  const aadharBackReady = !!KYC.aadharBack.dataUrl;
  if (btn) {
    btn.disabled = !(panReady && aadharReady && aadharBackReady);
    const hint = document.getElementById('kyc-hint-text');
    if (hint) {
      if (!panReady && !aadharReady) { hint.textContent = '⚠ Upload PAN card and Aadhaar card (front & back) to enable extraction'; hint.style.color = 'var(--warn)'; }
      else if (!panReady) { hint.textContent = '⚠ PAN card required — please upload PAN card'; hint.style.color = 'var(--warn)'; }
      else if (!aadharReady) { hint.textContent = '⚠ Aadhaar front side required — please upload Aadhaar front'; hint.style.color = 'var(--warn)'; }
      else if (!aadharBackReady) { hint.textContent = '⚠ Aadhaar back side required — please upload Aadhaar back'; hint.style.color = 'var(--warn)'; }
      else { hint.textContent = 'AI-powered OCR • Works with images & PDFs'; hint.style.color = 'var(--text3)'; }
    }
  }
  kycUpdateReadinessChecklist();
}

// ── Step 2 readiness checklist — shows exactly what's missing before Next ──
function kycUpdateReadinessChecklist() {
  var panel = document.getElementById('kyc-readiness-panel');
  var container = document.getElementById('kyc-checklist-items');
  if (!panel || !container) return;

  // Required checks — all must pass to enable Next
  var checks = [
    { key: 'pan_upload',   label: 'PAN uploaded',              ok: !!KYC.pan.dataUrl },
    { key: 'aadhar_upload',label: 'Aadhaar front uploaded',    ok: !!KYC.aadhar.dataUrl },
    { key: 'aadhar_back',  label: 'Aadhaar back uploaded',     ok: !!KYC.aadharBack.dataUrl },
    { key: 'pan_num',      label: 'PAN number extracted',       ok: /^[A-Z]{5}[0-9]{4}[A-Z]$/.test((document.getElementById('w-pan')?.value||'').trim()) || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test((document.getElementById('kyc-out-pan')?.value||'').trim()) },
    { key: 'aadhar_num',   label: 'Aadhaar number (12 digits)', ok: /^\d{12}$/.test((document.getElementById('kyc-out-aadhar')?.value||'').replace(/\s/g,'')) },
    { key: 'name',         label: 'Name extracted',             ok: !!(document.getElementById('w-fname')?.value||'').trim() || !!(document.getElementById('kyc-out-fname')?.value||'').trim() },
    { key: 'dob',          label: 'Date of Birth',              ok: !!(document.getElementById('w-dob')?.value||'').trim() || !!(document.getElementById('kyc-out-dob')?.value||'').trim() },
  ];
  // Optional checks — shown but do NOT block Next
  var optionalChecks = [
    { key: 'father', label: "Father's Name (optional)", ok: !!(document.getElementById('w-father')?.value||'').trim() },
  ];

  var allOk = checks.every(function(c){ return c.ok; });
  panel.style.display = 'block';
  var allChecks = checks.concat(optionalChecks);
  container.innerHTML = allChecks.map(function(c, i){
    var isOpt = i >= checks.length;
    var bg  = c.ok ? 'rgba(26,115,64,.1)'  : isOpt ? 'rgba(120,130,160,.08)' : 'rgba(212,43,43,.07)';
    var col = c.ok ? 'var(--success)'       : isOpt ? 'var(--text3)'          : 'var(--danger)';
    return '<div style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:99px;font-size:11.5px;font-weight:600;background:'+bg+';color:'+col+';">'
      + (c.ok ? '✓' : '○') + ' ' + c.label + '</div>';
  }).join('');

  // Update the Next button's visual state
  var nextBtn = document.getElementById('wiz-next');
  if (nextBtn && currentStep === 2) {
    if (allOk) {
      nextBtn.style.opacity = '1';
      nextBtn.style.cursor = 'pointer';
      nextBtn.title = '';
    } else {
      nextBtn.style.opacity = '0.5';
      nextBtn.style.cursor = 'not-allowed';
      var missing = checks.filter(function(c){ return !c.ok; }).map(function(c){ return c.label; }).join(', ');
      nextBtn.title = 'Complete required fields: ' + missing;
    }
  }
}

// ─────────────────────── AADHAAR BACK UPLOAD ───────────────────────
function kycHandleUploadBack(type, input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 15*1024*1024) { showToast('File too large (max 15MB)','error'); return; }

  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  if (isPdf && typeof pdfjsLib !== 'undefined' && typeof _docPasswordPrompt !== 'undefined') {
    file.arrayBuffer().then(function(buf) {
      const bytes = new Uint8Array(buf);
      pdfjsLib.getDocument({ data: bytes }).promise
        .then(function() {
          _kycHandleUploadBackCommit(file, null);
        })
        .catch(function(err) {
          if (err.name === 'PasswordException' || String(err.message).toLowerCase().includes('password')) {
            _docPasswordPrompt(
              file, file.name,
              function onSuccess(password) { _kycHandleUploadBackCommit(file, password); },
              function onSkip()            { _kycHandleUploadBackCommit(file, null); }
            );
          } else {
            _kycHandleUploadBackCommit(file, null);
          }
        });
    }).catch(function() { _kycHandleUploadBackCommit(file, null); });
  } else {
    _kycHandleUploadBackCommit(file, null);
  }
}

function _kycHandleUploadBackCommit(file, pdfPassword) {
  KYC.aadharBack.file = file;
  KYC.aadharBack.isPdf = (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
  KYC.aadharBack.mediaType = file.type;
  if (pdfPassword) KYC.aadharBack.pdfPassword = pdfPassword;
  const reader = new FileReader();
  reader.onload = function(ev) {
    KYC.aadharBack.dataUrl = ev.target.result;
    if (!KYC.aadharBack.isPdf) {
      const img = document.getElementById('kyc-aadhar-back-img');
      const prev = document.getElementById('kyc-aadhar-back-preview');
      if (img) img.src = ev.target.result;
      if (prev) prev.style.display = 'block';
      document.getElementById('kyc-aadhar-back-pdf-info').style.display = 'none';
    } else {
      document.getElementById('kyc-aadhar-back-preview').style.display = 'none';
      const pi = document.getElementById('kyc-aadhar-back-pdf-info');
      pi.textContent = (pdfPassword ? '🔓 ' : '📄 ') + file.name + ' (' + (file.size/1024).toFixed(0) + ' KB)' + (pdfPassword ? ' — password saved' : '');
      pi.style.display = 'block';
    }
    const bt = document.getElementById('kyc-aadhar-back-btn-text');
    if (bt) bt.textContent = 'Change Back Side';
    const st = document.getElementById('kyc-aadhar-back-status');
    if (st) st.innerHTML = '<div style="font-size:11.5px;color:var(--success);font-weight:600;margin-top:4px">\u2713 ' + file.name + (pdfPassword ? ' <span style="font-size:10px;color:#b45309;background:rgba(217,119,6,.1);padding:2px 7px;border-radius:10px;margin-left:4px">🔐 Password saved</span>' : '') + '</div>';
    // Update the badge on the main card
    const badge = document.getElementById('kyc-aadhar-badge');
    if (KYC.aadhar.dataUrl && KYC.aadharBack.dataUrl && badge) badge.innerHTML = '<span class="kyc-badge-ok" style="font-size:11px;background:rgba(26,115,64,.1);color:var(--success);padding:2px 8px;border-radius:20px;font-weight:700">\u2713 Both sides ready</span>';
    kycCheckExtractReady();
  };
  reader.readAsDataURL(file);
}

// ─────────────────────── LOADING ───────────────────────
function kycShowLoading(msg) {
  const ov = document.getElementById('kyc-loading-overlay');
  if (ov) ov.style.display = 'flex';
  const lm = document.getElementById('kyc-loading-msg');
  if (lm) lm.textContent = msg || 'Processing\u2026';
}
function kycHideLoading() {
  const ov = document.getElementById('kyc-loading-overlay');
  if (ov) ov.style.display = 'none';
}

// ─────────────────────── PDF → CANVASES ───────────────────────
async function kycPdfToCanvases(dataUrl) {
  const b64    = dataUrl.split(',')[1];
  const bin    = atob(b64);
  const bytes  = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const pdf    = await pdfjsLib.getDocument({ data: bytes }).promise;
  const canvases = [], embParts = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page     = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 5.0 }); // Higher scale = better clarity for blurry/low-res scans
    const canvas   = document.createElement('canvas');
    canvas.width   = viewport.width;
    canvas.height  = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    // Apply contrast/sharpness enhancement for low-quality scans
    canvases.push(kycEnhanceCanvas(canvas));
    try {
      const tc = await page.getTextContent();
      const pt = tc.items.map(function(i){ return i.str; }).join(' ');
      if (pt.trim()) embParts.push(pt);
    } catch(_) {}
  }
  return { canvases: canvases, embeddedText: embParts.join('\n') };
}

// ─────────────────────── IMAGE ENHANCEMENT ───────────────────────
// Boosts contrast and sharpens image for blurry/low-quality scans before AI reading
function kycEnhanceCanvas(srcCanvas) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const dst = document.createElement('canvas');
  dst.width = w; dst.height = h;
  const ctx = dst.getContext('2d');
  ctx.drawImage(srcCanvas, 0, 0);
  // Apply contrast filter via CSS filter trick
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const tctx = tmp.getContext('2d');
  tctx.filter = 'contrast(1.4) brightness(1.05) saturate(1.1)';
  tctx.drawImage(srcCanvas, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(tmp, 0, 0);
  return dst.toDataURL('image/png');
}

// Enhance a dataUrl image (for direct image uploads)
// [kycEnhanceDataUrl moved to Vision-API section below]

// ─────────────────────── CLAUDE VISION API ───────────────────────
// Replaces Tesseract OCR entirely. Sends the card image directly to Claude
// which reads it accurately regardless of background colour, angle, or quality.

// ── Gemini API key helpers (server-side via .env) ──
function _getGeminiKey() {
  // Gemini is configured server-side in .env (AI__Provider=gemini).
  // Direct browser→Google calls are disabled — the backend proxy handles AI routing.
  // Return null so kycCallGeminiVision (direct Google call) is never attempted.
  return null;
}
window.stgSaveGeminiKey = function() {
  showToast('✅ Gemini is configured server-side (.env) — KYC extraction is ready', 'success');
  var st = document.getElementById('stg-gemini-status');
  if (st) { st.innerHTML = '✅ Gemini configured on server — PAN & Aadhaar extraction ready'; st.style.color = 'var(--success)'; }
};
// Load saved key into input on Settings page open
window.stgLoadGeminiKey = function() {
  var inp = document.getElementById('stg-gemini-api-key');
  var st = document.getElementById('stg-gemini-status');
  if (inp) inp.value = '(Configured server-side in .env)';
  if (st) {
    st.innerHTML = '✅ Gemini configured on server (AI__Provider=gemini in .env) — ready';
    st.style.color = 'var(--success)';
  }
};

// ── Gemini Vision API call ──
async function kycCallGeminiVision(base64Data, mediaType, prompt) {
  var apiKey = _getGeminiKey();
  if (!apiKey) throw new Error('GEMINI_NOT_CONFIGURED');
  var response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [
        { inline_data: { mime_type: mediaType, data: base64Data } },
        { text: prompt }
      ]}]
    })
  });
  if (!response.ok) {
    var errBody = '';
    try { var ej = await response.json(); errBody = (ej.error && ej.error.message) || JSON.stringify(ej); } catch(_) {}
    throw new Error('Gemini API error ' + response.status + (errBody ? ': ' + errBody : ''));
  }
  var data = await response.json();
  return (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts || [])
    .map(function(p) { return p.text || ''; }).join('');
}

// ── Main Vision call: tries Anthropic → Gemini → throws ──
async function kycCallClaudeVision(base64Data, mediaType, prompt) {
  console.log('[KYC v39] kycCallClaudeVision called — Gemini key present:', !!_getGeminiKey());
  var anthropicError = null;

  // 1. Try backend proxy (provider-neutral: Gemini/Claude via AI__Provider in .env)
  var _ep = _kycApiEndpoint();
  if (_ep) {
    try {
      var response = await fetch(_ep.url, {
        method: 'POST',
        headers: _ep.headers,
        body: JSON.stringify({
          documentType: 'GENERIC',
          images: [{ mediaType: mediaType, data: base64Data }],
          prompt: prompt
        })
      });
      if (response.ok) {
        var data = await response.json();
        if (data.code === 'NOT_CONFIGURED') throw new Error('not_configured');
        if (data.success) return data.text || '';
        anthropicError = new Error(data.error || 'KYC proxy error');
      } else {
        var errBody = '';
        try { var ej = await response.json(); errBody = ej.error || JSON.stringify(ej); } catch(_) {}
        anthropicError = new Error('KYC proxy error ' + response.status + (errBody ? ': ' + errBody : ''));
      }
    } catch(fetchErr) {
      anthropicError = fetchErr;
    }
  }

  // 2. Try Gemini Vision (free) — always try if key exists, regardless of Anthropic result
  console.log('[KYC v39] Anthropic result:', anthropicError ? 'FAILED ('+anthropicError.message+')' : 'skipped', '— trying Gemini:', !!_getGeminiKey());
  if (_getGeminiKey()) {
    try {
      return await kycCallGeminiVision(base64Data, mediaType, prompt);
    } catch(geminiErr) {
      // If both failed, prefer showing the Gemini error since that's what user configured
      throw geminiErr;
    }
  }

  // 3. Neither configured or Anthropic failed without Gemini
  if (anthropicError) throw anthropicError;
  var err = new Error('KYC_API_NOT_CONFIGURED');
  err.isApiNotConfigured = true;
  throw err;
}

// Extract base64 data and media type from a dataUrl
function kycDataUrlParts(dataUrl) {
  var m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('Invalid data URL');
  return { mediaType: m[1], base64: m[2] };
}

// ─────────────────────── AI-POWERED EXTRACTION ───────────────────────
async function kycExtractPanViaVision(dataUrl) {
  var parts = kycDataUrlParts(dataUrl);
  var prompt = 'Read this Indian PAN card image (may be rotated — orient by "INCOME TAX DEPARTMENT" header). Extract cardholder name (not father), father name, PAN (10 chars: 5 letters+4 digits+1 letter), DOB. Name: exact as printed, never reorder. Split: 1 word=first only, 2=first+last, 3=first+middle+last, 4+=first+middle(joined)+last. Return ONLY JSON:\n{"full_name":"","first_name":"","middle_name":"","last_name":"","pan_number":"","date_of_birth":"DD/MM/YYYY","father_name":"","layout":"PHYSICAL or EPAN"}\nNull for unreadable fields. No markdown.';

  var _ep = _kycApiEndpoint();
  try {
    var response = await fetch(_ep.url, {
      method: 'POST',
      headers: _ep.headers,
      body: JSON.stringify({
        documentType: 'PAN',
        images: [{ mediaType: parts.mediaType, data: parts.base64 }],
        prompt: prompt
      })
    });
    var data = await response.json();
    if (!response.ok || !data.success) {
      if (data.code === 'NOT_CONFIGURED') {
        var ncErr = new Error('KYC_API_NOT_CONFIGURED'); ncErr.isApiNotConfigured = true; throw ncErr;
      }
      throw new Error(data.error || ('KYC proxy error ' + response.status));
    }
    var raw = (data.text || '').replace(/```json|```/g, '').trim();
    var jm = raw.match(/\{[\s\S]*\}/); if (jm) raw = jm[0];
    return JSON.parse(raw);
  } catch(e) {
    throw e;
  }
}

async function kycExtractAadhaarViaVision(imageDataUrl, embeddedText, backDataUrl) {
  if (embeddedText && embeddedText.replace(/\s/g,'').length > 100) {
    return kycParseAadharFromText(embeddedText);
  }
  var parts = kycDataUrlParts(imageDataUrl);
  var backParts = null;
  if (backDataUrl) { try { backParts = kycDataUrlParts(backDataUrl); } catch(_) {} }

  var prompt = 'Read this Indian Aadhaar card.' + (backParts ? ' Image 1=FRONT (name/DOB/gender/number). Image 2=BACK (address).' : '') + ' Extract: full_name (English only, exclude DOB/mobile/number), aadhaar_number (12 digits, not VID), date_of_birth (DD/MM/YYYY or YYYY), gender (Male/Female), address fields ONLY from back side. Parse address into: house_number (flat+floor), street (road/marg/lane), locality (area/nagar/colony), city (district name), state, pin_code (6 digits). Return ONLY JSON:\n{"full_name":"","aadhaar_number":"","date_of_birth":"","gender":"","house_number":"","street":"","locality":"","city":"","state":"","pin_code":"","address":"full address as printed"}\nNull for absent fields. No markdown.';

  var images = [{ mediaType: parts.mediaType, data: parts.base64 }];
  if (backParts) images.push({ mediaType: backParts.mediaType, data: backParts.base64 });

  var _ep2 = _kycApiEndpoint();
  try {
    var response = await fetch(_ep2.url, {
      method: 'POST',
      headers: _ep2.headers,
      body: JSON.stringify({
        documentType: 'AADHAAR',
        images: images,
        prompt: prompt
      })
    });
    var data = await response.json();
    if (!response.ok || !data.success) {
      if (data.code === 'NOT_CONFIGURED') {
        var ncErr = new Error('KYC_API_NOT_CONFIGURED'); ncErr.isApiNotConfigured = true; throw ncErr;
      }
      throw new Error(data.error || ('KYC proxy error ' + response.status));
    }
    var raw = (data.text || '').replace(/```json|```/g, '').trim();
    var jm = raw.match(/\{[\s\S]*\}/); if (jm) raw = jm[0];
    return JSON.parse(raw);
  } catch(e) {
    throw e;
  }
}


// ─────────────────────── GET FULL TEXT (legacy fallback for PDF text layer) ───────────────────────
async function kycGetText(type) {
  const state = KYC[type];
  kycShowLoading('Reading ' + (type==='pan'?'PAN':'Aadhaar') + ' document\u2026');
  if (state.isPdf) {
    const result = await kycPdfToCanvases(state.dataUrl);
    if (result.embeddedText.replace(/\s/g,'').length > 60) return result.embeddedText;
    return { canvases: result.canvases, embeddedText: '' };
  }
  // For images: return the dataUrl so Tesseract fallback can OCR it
  return state.dataUrl || null;
}

// ─────────────────────── TESSERACT OCR (kept as last-resort fallback) ───────────────────────
// [kycOcrImage moved to Vision-API section below]

// ─────────────────────── PARSE PAN ───────────────────────
function kycParsePan(raw) {
  var flat = raw.replace(/\n/g,' ').replace(/\s+/g,' ');
  var panM = flat.match(/[A-Z]{5}[0-9]{4}[A-Z]/);
  var pan_number = panM ? panM[0] : null;
  var dobM = flat.match(/\b(\d{2}[\/\-]\d{2}[\/\-]\d{4})\b/);
  var date_of_birth = dobM ? dobM[1].replace(/-/g,'/') : null;
  var full_name = null, father_name = null;

  var skipWords = /^(INCOME|TAX|DEPT|GOVT|INDIA|PERMANENT|ACCOUNT|NUMBER|CARD|PAN|VALID|THROUGH|SIGNATURE|DATE|BIRTH|NAME|FATHER|OF|DEPARTMENT)$/;
  var nameLabelPat = /(?:नाम\s*[\/|]\s*Name|naam\s*[\/|]\s*Name|Name\s*[\/|]\s*नाम|^(?:नाम|Name)$)/i;
  var fatherLabelPat = /father['']?s?\s*name|पिता\s*का\s*नाम/i;

  var lines = raw.split('\n').map(function(l){ return l.trim(); }).filter(Boolean);

  function isValidNameCandidate(str) {
    var words = str.trim().split(/\s+/);
    // Allow single-letter initials (e.g. "PRACHI R BHAVE" — "R" is valid)
    return words.length >= 2 && words.length <= 5 &&
      words.every(function(w){ return w.length >= 1 && !skipWords.test(w.toUpperCase()); }) &&
      /^[A-Z]/.test(str) && words.filter(function(w){ return w.length >= 2; }).length >= 2;
  }

  // ── Detect Layout B (older format): PAN number appears AFTER the names ──
  // In Layout B: name block appears before "Permanent Account Number" line
  var panLabelIdx = -1;
  for (var pi = 0; pi < lines.length; pi++) {
    if (/permanent\s+account\s+number/i.test(lines[pi])) { panLabelIdx = pi; break; }
  }
  var isLayoutB = panLabelIdx > 0; // PAN label found mid-card → Layout B

  if (isLayoutB) {
    // Collect ALL-CAPS name lines that appear BEFORE the "Permanent Account Number" label
    var nameBlock = [];
    var junkPat = /^(INCOME|TAX|DEPT|GOVT|INDIA|DEPARTMENT|GOVT\.|आयकर|विभाग|भारत|सरकार)/i;
    for (var bi = 0; bi < panLabelIdx; bi++) {
      var bl = lines[bi].trim();
      if (!bl || junkPat.test(bl)) continue;
      // Must look like ALL-CAPS name (letters, spaces, single-letter initials allowed)
      if (/^[A-Z][A-Z\s\.]{2,50}$/.test(bl) && isValidNameCandidate(bl)) {
        nameBlock.push(bl);
      }
    }
    // In Layout B: first name block = cardholder, second = father
    if (nameBlock.length >= 1) full_name  = nameBlock[0];
    if (nameBlock.length >= 2) father_name = nameBlock[1];
  }

  // ── Layout A: look for explicit Name label ──
  if (!full_name) {
    // Strategy 1: label + name on same line
    for (var i = 0; i < lines.length; i++) {
      var lnM = lines[i].match(/(?:नाम\s*[\/|]\s*Name|naam\s*[\/|]\s*Name|Name\s*[\/|]\s*नाम|(?:^|\s)Name\s+)([A-Z]{2,}(?:\s[A-Z]{1,}){1,4})/i);
      if (lnM) { var c = lnM[1].trim(); if (isValidNameCandidate(c)) { full_name = c; break; } }
    }
  }
  if (!full_name) {
    // Strategy 2: label line then next ALL-CAPS line
    for (var j = 0; j < lines.length; j++) {
      if (nameLabelPat.test(lines[j])) {
        for (var k = j+1; k < lines.length; k++) {
          var nl = lines[k].trim(); if (!nl) continue;
          if (/^[A-Z][A-Z\s]{3,50}$/.test(nl) && isValidNameCandidate(nl)) full_name = nl;
          break;
        }
        if (full_name) break;
      }
    }
  }
  if (!full_name) {
    // Strategy 3: first standalone ALL-CAPS line that looks like a name
    for (var s3i = 0; s3i < lines.length; s3i++) {
      var ln3 = lines[s3i];
      if (!/^[A-Z][A-Z\s]{3,50}$/.test(ln3) || !isValidNameCandidate(ln3)) continue;
      // Make sure it isn't the father's name by checking if there's a father label before it
      full_name = ln3; break;
    }
  }

  // ── Father name (Layout A): look for explicit label ──
  if (!father_name) {
    for (var fi = 0; fi < lines.length; fi++) {
      if (fatherLabelPat.test(lines[fi])) {
        var sameLine = lines[fi].match(/(?:father['']?s?\s*name|पिता\s*का\s*नाम)\s*[\/|]?\s*(?:[A-Za-z\s]+[\/|]\s*)?([A-Z]{2,}(?:\s[A-Z]{1,}){1,4})/i);
        if (sameLine && isValidNameCandidate(sameLine[1].trim())) { father_name = sameLine[1].trim(); break; }
        for (var fj = fi+1; fj < lines.length; fj++) {
          var fl2 = lines[fj].trim(); if (!fl2) continue;
          if (/^[A-Z][A-Z\s]{3,}$/.test(fl2)) father_name = fl2;
          break;
        }
        break;
      }
    }
  }
  // Fallback: ALL-CAPS phrase immediately after the cardholder name
  if (!father_name && full_name) {
    var idx = flat.indexOf(full_name);
    var after = flat.slice(idx + full_name.length, idx + full_name.length + 100);
    var fm = after.match(/([A-Z]{2,}(?:\s[A-Z]{1,}){1,4})/);
    if (fm && isValidNameCandidate(fm[1].trim()) && fm[1].trim() !== full_name) father_name = fm[1].trim();
  }

  var split = kycSplitName({ full_name:full_name, first_name:null, middle_name:null, last_name:null });
  return { pan_number:pan_number, full_name:full_name, first_name:split.first, middle_name:split.middle, last_name:split.last, date_of_birth:date_of_birth, father_name:father_name, doc_type:'PAN', _raw:raw };
}

// ─────────────────────── PARSE AADHAAR FROM EMBEDDED PDF TEXT ───────────────────────
// Used when e-Aadhaar PDF has a proper text layer (most common case)
function kycParseAadharFromText(raw) {
  return kycParseAadhar(raw);
}

// ─────────────────────── PARSE AADHAAR ───────────────────────
function kycParseAadhar(raw) {
  var flat = raw.replace(/\n/g,' ').replace(/\s+/g,' ');

  // ── Aadhaar Number ──
  // Fix common OCR mistakes: O→0, I→1, l→1, then try flexible spacing
  var fixedFlat = flat.replace(/[Oo]/g,'0').replace(/[IlL]/g,'1');
  // Match 12-digit number with optional spaces every 4 digits (e.g. "1234 5678 9012" or "123456789012")
  var aM = fixedFlat.match(/\b(\d{4})\s?(\d{4})\s?(\d{4})\b/) ||
            fixedFlat.match(/\b(\d{4})\s(\d{4})\s(\d{4})\b/);
  var aadhaar_number = aM ? (aM[1]+aM[2]+aM[3]) : null;

  // If still not found, try to find 12 consecutive digits with possible single-char noise
  if (!aadhaar_number) {
    var digitMatch = fixedFlat.match(/\b\d[\d\s]{10,13}\d\b/);
    if (digitMatch) {
      var digits = digitMatch[0].replace(/\s/g,'');
      if (digits.length === 12) aadhaar_number = digits;
    }
  }

  var dobM = flat.match(/(?:DOB|Date\s+of\s+Birth|D\.O\.B)[:\s]*(\d{2}[\/\-]\d{2}[\/\-]\d{4})/i) ||
             flat.match(/\b(\d{2}[\/\-]\d{2}[\/\-]\d{4})\b/);
  var date_of_birth = dobM ? dobM[1].replace(/-/g,'/') : null;
  var gM = flat.match(/\b(Male|Female|Transgender|MALE|FEMALE)\b/i);
  var gender = gM ? (gM[1].charAt(0).toUpperCase()+gM[1].slice(1).toLowerCase()) : null;

  // ── Name: first non-header/non-junk line with 2-4 proper words ──
  var full_name = null;
  var skipPat = /govt|government|india|unique|authority|uidai|aadhaar|aadhar|enrollment|identification|samaanya|maansacha|mera|meri|pehchaan|माझे|आधार|ओळख|प्राधिकरण|सरकार/i;
  var nameDobPat = /^\d{2}[\/\-]\d{2}[\/\-]\d{4}$|^\d{4}$/;
  var lines = raw.split('\n').map(function(l){ return l.trim(); }).filter(Boolean);
  // First try: look for explicit "To," prefix (printed letter format)
  for (var ti = 0; ti < lines.length; ti++) {
    var toM = lines[ti].match(/^To[,\s]+(.+)$/i);
    if (toM) { var tc = toM[1].trim(); if (tc.split(' ').length >= 2 && /^[A-Za-z]/.test(tc)) { full_name = tc; break; } }
  }
  // Second try: first non-junk line that looks like 2-5 proper English name words
  if (!full_name) {
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (skipPat.test(line)) continue;
      if (nameDobPat.test(line)) continue;
      if (/^[A-Za-z][A-Za-z\s]{3,40}$/.test(line) && line.split(' ').length >= 2 && line.split(' ').length <= 5) {
        full_name = line.trim(); break;
      }
    }
  }

  // ── PIN: 6-digit code, must not be part of Aadhaar number ──
  var pinCandidates = flat.match(/\b\d{6}\b/g) || [];
  var pin_code = pinCandidates.find(function(p){ return !aadhaar_number || !aadhaar_number.includes(p); }) || pinCandidates[0] || null;

  // ── State ──
  var STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Delhi','Jammu and Kashmir','Ladakh'];
  var state = null;
  for (var si = 0; si < STATES.length; si++) {
    if (flat.toLowerCase().indexOf(STATES[si].toLowerCase()) !== -1) { state = STATES[si]; break; }
  }

  // ── Address ──
  // Lines to always reject regardless of context
  var addrJunkPat = /signature|not verified|digitally signed|\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}|IST|authority of india|uidai|aadhaar|aadhar|enrollment|govt|government|unique identification|mera aadhaar|meri pehchaan|सूचना|information/i;

  var addrLines = [];

  // Priority 1: look for explicit "Address:" label in the text (common in PDF e-Aadhaar)
  var addrLabelMatch = raw.match(/Address\s*:\s*([\s\S]{10,400}?)(?:\n\s*\n|\d{12}|VID\s*:|$)/i);
  if (addrLabelMatch) {
    // Split on commas, clean each part, remove empties and junk
    var rawAddr = addrLabelMatch[1].replace(/\n/g,' ').replace(/\s+/g,' ').trim();
    // Capture PIN before stripping it
    var pinInAddr = rawAddr.match(/[-–]?\s*(\d{6})\s*$/);
    if (pinInAddr && !pin_code) pin_code = pinInAddr[1];
    // Strip trailing "State - PIN" pattern
    rawAddr = rawAddr.replace(/,?\s*[A-Za-z\s]+\s*[-–]\s*\d{6}\s*$/, '').trim();
    // Split and clean
    var addrParts = rawAddr.split(/,\s*/).map(function(p){ return p.trim(); })
      .filter(function(p){ return p.length > 1 && !addrJunkPat.test(p); })
      .map(function(p){
        // Strip label prefixes like "PO:", "VTC:", "DIST:", "Sub District:" but KEEP the value
        return p.replace(/^(?:PO|VTC|DIST|SUB\s*DIST(?:RICT)?|Sub\s*District|District|State|PIN\s*Code|Mobile)\s*:\s*/i, '').trim();
      })
      .filter(function(p){ return p.length > 1; });
    addrLines = addrParts;
  }

  // Priority 2: line-by-line collection after the name (for image Aadhaar)
  if (!addrLines.length) {
    var collecting = false;
    for (var li = 0; li < lines.length; li++) {
      var ln = lines[li];
      if (addrJunkPat.test(ln)) continue;
      if (full_name && ln === full_name) { collecting = true; continue; }
      if (collecting) {
        var digitsOnly = ln.replace(/\s/g,'');
        if (/^\d{12}$/.test(digitsOnly)) break;
        if (/^\d{10}$/.test(digitsOnly)) continue; // skip phone numbers
        if (ln.length <= 3) continue;
        if (/^\d{2}[\/\-]\d{2}[\/\-]\d{4}$/.test(ln)) continue;
        if (/^(Male|Female|Transgender)$/i.test(ln)) continue;
        if (addrJunkPat.test(ln)) continue;
        addrLines.push(ln);
        if (addrLines.length >= 6) break;
      }
    }
  }

  // Priority 3: keyword-based scan
  if (!addrLines.length) {
    var addrKeywords = /s\/o|w\/o|c\/o|d\/o|h\.?no|house|flat|plot|door|village|vill|ward|near|post|dist|district|street|road|nagar|colony|lane|sector|block|taluk|tehsil|tower|chawl|room/i;
    for (var ai = 0; ai < lines.length; ai++) {
      if (addrKeywords.test(lines[ai]) && !addrJunkPat.test(lines[ai])) {
        for (var aj = ai; aj < lines.length && addrLines.length < 6; aj++) {
          var al = lines[aj].trim();
          if (al.length > 3 && !/^\d{12}$/.test(al.replace(/\s/g,'')) && !addrJunkPat.test(al)) addrLines.push(al);
        }
        break;
      }
    }
  }

  // Map address parts to fields:
  // addrLines example: ["605", "Kasturi Tower", "Ghar Angan Road", "Titwala East", "Ambivali Tarf Vasundri"]
  // house_number = first parts joined until we hit a road/street/locality keyword
  // street = road/road name part, locality = area/village, city = district

  // Filter out any addrLines that are purely a 12-digit Aadhaar number or digital-sig noise
  addrLines = addrLines.filter(function(l) {
    var stripped = l.replace(/\s/g,'');
    if (/^\d{12}$/.test(stripped)) return false;
    if (/signature|not verified|digitally signed|IST\s*\d|date:\s*\d{4}/i.test(l)) return false;
    return true;
  });

  var full_address = addrLines.length ? addrLines.join(', ') : null;
  // Strip any trailing Aadhaar number that leaked into full_address
  if (full_address) {
    full_address = full_address.replace(/\s*\d{4}\s+\d{4}\s+\d{4}\s*$/, '').replace(/\s*\d{12}\s*$/, '').trim();
  }

  // Smart field mapping: combine numeric-start part with building name for house_number
  var house_number = null, street = null, locality = null, city_field = null;
  if (addrLines.length >= 1) {
    // If first part is just a number or "NNN, Building Name", combine first two
    if (/^\d/.test(addrLines[0]) && addrLines.length >= 2) {
      house_number = addrLines[0] + ', ' + addrLines[1];
      street   = addrLines[2] || null;
      locality = addrLines[3] || null;
      city_field = addrLines[4] || null;
    } else {
      house_number = addrLines[0];
      street   = addrLines[1] || null;
      locality = addrLines[2] || null;
      city_field = addrLines[3] || null;
    }
  }
  // Use district/thane as city if we have it from state detection area
  if (!city_field && state) city_field = null; // state separately stored

  return { aadhaar_number:aadhaar_number, full_name:full_name, date_of_birth:date_of_birth, gender:gender,
           house_number:house_number, street:street, locality:locality, landmark:null,
           city:city_field, state:state, pin_code:pin_code, full_address:full_address, doc_type:'AADHAAR', _raw:raw };
}

// ─────────────────────── NAME SPLITTER ───────────────────────
// IMPORTANT: The name is split strictly left-to-right in the exact sequence
// it appears on the PAN card. No reordering is performed whatsoever.
// Word 1 = First Name, Word(s) 2..N-1 = Middle Name, Word N = Last Name.
// If only 1 word → First only. If 2 words → First + Last, no Middle.
function kycSplitName(d) {
  var first  = (d.first_name  || '').trim();
  var middle = (d.middle_name || '').trim();
  var last   = (d.last_name   || '').trim();
  if ((!first || !last) && d.full_name) {
    // Preserve exact left-to-right sequence as printed on PAN card
    var parts = d.full_name.trim().replace(/\s+/g,' ').split(' ');
    if (parts.length === 1)      { first=parts[0]; middle=''; last=''; }
    else if (parts.length === 2) { first=parts[0]; middle=''; last=parts[1]; }
    else {
      // Word 1 = First, middle word(s) = Middle, last word = Last
      // Sequence is NEVER changed — exactly as on PAN card
      first  = parts[0];
      last   = parts[parts.length - 1];
      middle = parts.slice(1, parts.length - 1).join(' ');
    }
  }
  return { first:first, middle:middle, last:last };
}

// ─────────────────────── MAIN ORCHESTRATOR ───────────────────────
// [kycExtractAll moved to Vision-API section below]
var _lsSet = function(k,v){ try{ localStorage.setItem(k,v); }catch(e){} };
var _lsRemove = function(k){ try{ localStorage.removeItem(k); }catch(e){} };
  // ═══════════════════════════════════════════════════════
  //  KYC MODULE — Integrated from kyc_v16
  // ═══════════════════════════════════════════════════════

  // ── Server-Side KYC Vision Proxy ────────────────────────────────────────────
  // Browser calls /api/kyc/vision — the .NET backend holds the Anthropic API key
  // encrypted in DB. The key is NEVER sent to the browser.
  // To configure: Settings → KYC Vision → enter your Anthropic API key.
  function _kycApiEndpoint() {
    // Always route through our own backend proxy — no localStorage, no direct API key in browser.
    var sess = JSON.parse(_lsGet('efin_session') || '{}');
    return {
      url: '/api/kyc/vision',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (sess.token || '')
      }
    };
  }

// ─────────────────────── STATE ───────────────────────
// KYC state object — use window.KYC if already defined by efin-app.js, else create it
if (typeof window.KYC === 'undefined') {
  window.KYC = {
    pan:    { file:null, dataUrl:null, mediaType:null, isPdf:false, data:null },
    aadhar: { file:null, dataUrl:null, mediaType:null, isPdf:false, data:null },
    aadharBack: { file:null, dataUrl:null, mediaType:null, isPdf:false },
    validationLog: [],
    reportTs: null,
    apiKey: ''
  };
}
var KYC = window.KYC;

// ─────────────────────── UPLOAD ───────────────────────
function kycHandleUpload(type, input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 15*1024*1024) { showToast('File too large (max 15MB)','error'); return; }

  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  if (isPdf && typeof pdfjsLib !== 'undefined' && typeof _docPasswordPrompt !== 'undefined') {
    // Check for password protection before committing
    file.arrayBuffer().then(function(buf) {
      const bytes = new Uint8Array(buf);
      pdfjsLib.getDocument({ data: bytes }).promise
        .then(function() {
          // Not password-protected — normal flow
          _kycHandleUploadCommit(type, file, null);
        })
        .catch(function(err) {
          if (err.name === 'PasswordException' || String(err.message).toLowerCase().includes('password')) {
            // Show shared password prompt
            _docPasswordPrompt(
              file, file.name,
              function onSuccess(password) {
                _kycHandleUploadCommit(type, file, password);
              },
              function onSkip() {
                // Attach without unlocking — OCR will handle or user fills manually
                _kycHandleUploadCommit(type, file, null);
              }
            );
          } else {
            _kycHandleUploadCommit(type, file, null);
          }
        });
    }).catch(function() {
      _kycHandleUploadCommit(type, file, null);
    });
  } else {
    _kycHandleUploadCommit(type, file, null);
  }
}

function _kycHandleUploadCommit(type, file, pdfPassword) {
  KYC[type].file = file;
  KYC[type].isPdf = (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
  KYC[type].mediaType = file.type;
  if (pdfPassword) KYC[type].pdfPassword = pdfPassword;  // stored for session use by OCR
  const reader = new FileReader();
  reader.onload = function(ev) {
    KYC[type].dataUrl = ev.target.result;
    if (!KYC[type].isPdf) {
      const img = document.getElementById('kyc-'+type+'-img');
      const prev = document.getElementById('kyc-'+type+'-preview');
      if (img) img.src = ev.target.result;
      if (prev) prev.style.display = 'block';
      document.getElementById('kyc-'+type+'-pdf-info').style.display = 'none';
    } else {
      document.getElementById('kyc-'+type+'-preview').style.display = 'none';
      const pi = document.getElementById('kyc-'+type+'-pdf-info');
      pi.textContent = (pdfPassword ? '🔓 ' : '📄 ') + file.name + ' (' + (file.size/1024).toFixed(0) + ' KB)' + (pdfPassword ? ' — password saved' : '');
      pi.style.display = 'block';
    }
    const badge = document.getElementById('kyc-'+type+'-badge');
    if (badge) badge.innerHTML = '<span class="kyc-badge-info">\u2713 Ready' + (pdfPassword ? ' 🔐' : '') + '</span>';
    const bt = document.getElementById('kyc-'+type+'-btn-text');
    if (bt) bt.textContent = 'Change ' + (type==='pan' ? 'PAN' : 'Aadhaar');
    const st = document.getElementById('kyc-'+type+'-status');
    if (st) st.innerHTML = '<div style="font-size:11.5px;color:var(--success);font-weight:600;margin-top:4px">\u2713 ' + file.name + (pdfPassword ? ' <span style="font-size:10px;color:#b45309;background:rgba(217,119,6,.1);padding:2px 7px;border-radius:10px;margin-left:4px">🔐 Password saved</span>' : '') + '</div>';
    const card = document.getElementById('kyc-'+type+'-card');
    if (card) { card.classList.add('card-uploaded'); card.style.borderColor='var(--success)'; card.style.borderStyle='solid'; }
    kycCheckExtractReady();
  };
  reader.readAsDataURL(file);
}

function kycCheckExtractReady() {
  const btn = document.getElementById('kyc-extract-btn');
  const panReady        = !!KYC.pan.dataUrl;
  const aadharReady     = !!KYC.aadhar.dataUrl;
  const aadharBackReady = !!KYC.aadharBack.dataUrl;
  if (btn) {
    btn.disabled = !(panReady && aadharReady && aadharBackReady);
    const hint = document.getElementById('kyc-hint-text');
    if (hint) {
      if (!panReady && !aadharReady) { hint.textContent = '⚠ Upload PAN card and Aadhaar card (front & back) to enable extraction'; hint.style.color = 'var(--warn)'; }
      else if (!panReady) { hint.textContent = '⚠ PAN card required — please upload PAN card'; hint.style.color = 'var(--warn)'; }
      else if (!aadharReady) { hint.textContent = '⚠ Aadhaar front side required — please upload Aadhaar front'; hint.style.color = 'var(--warn)'; }
      else if (!aadharBackReady) { hint.textContent = '⚠ Aadhaar back side required — please upload Aadhaar back'; hint.style.color = 'var(--warn)'; }
      else { hint.textContent = 'AI-powered OCR • Works with images & PDFs'; hint.style.color = 'var(--text3)'; }
    }
  }
  kycUpdateReadinessChecklist();
}

// ── Step 2 readiness checklist — shows exactly what's missing before Next ──
function kycUpdateReadinessChecklist() {
  var panel = document.getElementById('kyc-readiness-panel');
  var container = document.getElementById('kyc-checklist-items');
  if (!panel || !container) return;

  // Required checks — all must pass to enable Next
  var checks = [
    { key: 'pan_upload',   label: 'PAN uploaded',              ok: !!KYC.pan.dataUrl },
    { key: 'aadhar_upload',label: 'Aadhaar front uploaded',    ok: !!KYC.aadhar.dataUrl },
    { key: 'aadhar_back',  label: 'Aadhaar back uploaded',     ok: !!KYC.aadharBack.dataUrl },
    { key: 'pan_num',      label: 'PAN number extracted',       ok: /^[A-Z]{5}[0-9]{4}[A-Z]$/.test((document.getElementById('w-pan')?.value||'').trim()) || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test((document.getElementById('kyc-out-pan')?.value||'').trim()) },
    { key: 'aadhar_num',   label: 'Aadhaar number (12 digits)', ok: /^\d{12}$/.test((document.getElementById('kyc-out-aadhar')?.value||'').replace(/\s/g,'')) },
    { key: 'name',         label: 'Name extracted',             ok: !!(document.getElementById('w-fname')?.value||'').trim() || !!(document.getElementById('kyc-out-fname')?.value||'').trim() },
    { key: 'dob',          label: 'Date of Birth',              ok: !!(document.getElementById('w-dob')?.value||'').trim() || !!(document.getElementById('kyc-out-dob')?.value||'').trim() },
  ];
  // Optional checks — shown but do NOT block Next
  var optionalChecks = [
    { key: 'father', label: "Father's Name (optional)", ok: !!(document.getElementById('w-father')?.value||'').trim() },
  ];

  var allOk = checks.every(function(c){ return c.ok; });
  panel.style.display = 'block';
  var allChecks = checks.concat(optionalChecks);
  container.innerHTML = allChecks.map(function(c, i){
    var isOpt = i >= checks.length;
    var bg  = c.ok ? 'rgba(26,115,64,.1)'  : isOpt ? 'rgba(120,130,160,.08)' : 'rgba(212,43,43,.07)';
    var col = c.ok ? 'var(--success)'       : isOpt ? 'var(--text3)'          : 'var(--danger)';
    return '<div style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:99px;font-size:11.5px;font-weight:600;background:'+bg+';color:'+col+';">'
      + (c.ok ? '✓' : '○') + ' ' + c.label + '</div>';
  }).join('');

  // Update the Next button's visual state
  var nextBtn = document.getElementById('wiz-next');
  if (nextBtn && currentStep === 2) {
    if (allOk) {
      nextBtn.style.opacity = '1';
      nextBtn.style.cursor = 'pointer';
      nextBtn.title = '';
    } else {
      nextBtn.style.opacity = '0.5';
      nextBtn.style.cursor = 'not-allowed';
      var missing = checks.filter(function(c){ return !c.ok; }).map(function(c){ return c.label; }).join(', ');
      nextBtn.title = 'Complete required fields: ' + missing;
    }
  }
}

// ─────────────────────── AADHAAR BACK UPLOAD ───────────────────────
function kycHandleUploadBack(type, input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 15*1024*1024) { showToast('File too large (max 15MB)','error'); return; }

  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  if (isPdf && typeof pdfjsLib !== 'undefined' && typeof _docPasswordPrompt !== 'undefined') {
    file.arrayBuffer().then(function(buf) {
      const bytes = new Uint8Array(buf);
      pdfjsLib.getDocument({ data: bytes }).promise
        .then(function() {
          _kycHandleUploadBackCommit(file, null);
        })
        .catch(function(err) {
          if (err.name === 'PasswordException' || String(err.message).toLowerCase().includes('password')) {
            _docPasswordPrompt(
              file, file.name,
              function onSuccess(password) { _kycHandleUploadBackCommit(file, password); },
              function onSkip()            { _kycHandleUploadBackCommit(file, null); }
            );
          } else {
            _kycHandleUploadBackCommit(file, null);
          }
        });
    }).catch(function() { _kycHandleUploadBackCommit(file, null); });
  } else {
    _kycHandleUploadBackCommit(file, null);
  }
}

function _kycHandleUploadBackCommit(file, pdfPassword) {
  KYC.aadharBack.file = file;
  KYC.aadharBack.isPdf = (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
  KYC.aadharBack.mediaType = file.type;
  if (pdfPassword) KYC.aadharBack.pdfPassword = pdfPassword;
  const reader = new FileReader();
  reader.onload = function(ev) {
    KYC.aadharBack.dataUrl = ev.target.result;
    if (!KYC.aadharBack.isPdf) {
      const img = document.getElementById('kyc-aadhar-back-img');
      const prev = document.getElementById('kyc-aadhar-back-preview');
      if (img) img.src = ev.target.result;
      if (prev) prev.style.display = 'block';
      document.getElementById('kyc-aadhar-back-pdf-info').style.display = 'none';
    } else {
      document.getElementById('kyc-aadhar-back-preview').style.display = 'none';
      const pi = document.getElementById('kyc-aadhar-back-pdf-info');
      pi.textContent = (pdfPassword ? '🔓 ' : '📄 ') + file.name + ' (' + (file.size/1024).toFixed(0) + ' KB)' + (pdfPassword ? ' — password saved' : '');
      pi.style.display = 'block';
    }
    const bt = document.getElementById('kyc-aadhar-back-btn-text');
    if (bt) bt.textContent = 'Change Back Side';
    const st = document.getElementById('kyc-aadhar-back-status');
    if (st) st.innerHTML = '<div style="font-size:11.5px;color:var(--success);font-weight:600;margin-top:4px">\u2713 ' + file.name + (pdfPassword ? ' <span style="font-size:10px;color:#b45309;background:rgba(217,119,6,.1);padding:2px 7px;border-radius:10px;margin-left:4px">🔐 Password saved</span>' : '') + '</div>';
    // Update the badge on the main card
    const badge = document.getElementById('kyc-aadhar-badge');
    if (KYC.aadhar.dataUrl && KYC.aadharBack.dataUrl && badge) badge.innerHTML = '<span class="kyc-badge-ok" style="font-size:11px;background:rgba(26,115,64,.1);color:var(--success);padding:2px 8px;border-radius:20px;font-weight:700">\u2713 Both sides ready</span>';
    kycCheckExtractReady();
  };
  reader.readAsDataURL(file);
}

// ─────────────────────── LOADING ───────────────────────
function kycShowLoading(msg) {
  const ov = document.getElementById('kyc-loading-overlay');
  if (ov) ov.style.display = 'flex';
  const lm = document.getElementById('kyc-loading-msg');
  if (lm) lm.textContent = msg || 'Processing\u2026';
}
function kycHideLoading() {
  const ov = document.getElementById('kyc-loading-overlay');
  if (ov) ov.style.display = 'none';
}

// ─────────────────────── PDF → CANVASES ───────────────────────
async function kycPdfToCanvases(dataUrl) {
  const b64    = dataUrl.split(',')[1];
  const bin    = atob(b64);
  const bytes  = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const pdf    = await pdfjsLib.getDocument({ data: bytes }).promise;
  const canvases = [], embParts = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page     = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 5.0 }); // Higher scale = better clarity for blurry/low-res scans
    const canvas   = document.createElement('canvas');
    canvas.width   = viewport.width;
    canvas.height  = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    // Apply contrast/sharpness enhancement for low-quality scans
    canvases.push(kycEnhanceCanvas(canvas));
    try {
      const tc = await page.getTextContent();
      const pt = tc.items.map(function(i){ return i.str; }).join(' ');
      if (pt.trim()) embParts.push(pt);
    } catch(_) {}
  }
  return { canvases: canvases, embeddedText: embParts.join('\n') };
}

// ─────────────────────── IMAGE ENHANCEMENT ───────────────────────
// Boosts contrast and sharpens image for blurry/low-quality scans before AI reading
function kycEnhanceCanvas(srcCanvas) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const dst = document.createElement('canvas');
  dst.width = w; dst.height = h;
  const ctx = dst.getContext('2d');
  ctx.drawImage(srcCanvas, 0, 0);
  // Apply contrast filter via CSS filter trick
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  const tctx = tmp.getContext('2d');
  tctx.filter = 'contrast(1.4) brightness(1.05) saturate(1.1)';
  tctx.drawImage(srcCanvas, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(tmp, 0, 0);
  return dst.toDataURL('image/png');
}

// Enhance a dataUrl image (for direct image uploads)
// Enhance a raw uploaded image (JPG/PNG/etc.) before sending it to Vision.
// PDF pages already get a contrast/brightness boost via kycEnhanceCanvas
// (see kycPdfToCanvases above) — but a directly-uploaded image never went
// through any equivalent step. Images created by printing a document and
// then scanning/photographing or re-saving that printout typically lose
// contrast and sharpness in that round trip, which is exactly the kind of
// degradation kycEnhanceCanvas already compensates for. This closes that gap
// so image uploads get the same treatment PDF uploads always had.
// Never throws and never blocks extraction — falls back to the original
// dataUrl untouched if anything about the enhancement step fails.
function kycEnhanceDataUrl(dataUrl) {
  return new Promise(function(resolve) {
    try {
      var img = new Image();
      img.onload = function() {
        try {
          var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
          if (!w || !h) { resolve(dataUrl); return; }
          var canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          resolve(kycEnhanceCanvas(canvas));
        } catch(e) { resolve(dataUrl); }
      };
      img.onerror = function() { resolve(dataUrl); };
      img.src = dataUrl;
    } catch(e) { resolve(dataUrl); }
  });
}

// ─────────────────────── CLAUDE VISION API ───────────────────────
// Replaces Tesseract OCR entirely. Sends the card image directly to Claude
// which reads it accurately regardless of background colour, angle, or quality.

// ── Gemini API key helpers (server-side via .env) ──
function _getGeminiKey() {
  // Gemini is configured server-side in .env (AI__Provider=gemini).
  // Direct browser→Google calls are disabled — the backend proxy handles AI routing.
  // Return null so kycCallGeminiVision (direct Google call) is never attempted.
  return null;
}
window.stgSaveGeminiKey = function() {
  showToast('✅ Gemini is configured server-side (.env) — KYC extraction is ready', 'success');
  var st = document.getElementById('stg-gemini-status');
  if (st) { st.innerHTML = '✅ Gemini configured on server — PAN & Aadhaar extraction ready'; st.style.color = 'var(--success)'; }
};
// Load saved key into input on Settings page open
window.stgLoadGeminiKey = function() {
  var inp = document.getElementById('stg-gemini-api-key');
  var st = document.getElementById('stg-gemini-status');
  if (inp) inp.value = '(Configured server-side in .env)';
  if (st) {
    st.innerHTML = '✅ Gemini configured on server (AI__Provider=gemini in .env) — ready';
    st.style.color = 'var(--success)';
  }
};

// ── Gemini Vision API call ──
async function kycCallGeminiVision(base64Data, mediaType, prompt) {
  var apiKey = _getGeminiKey();
  if (!apiKey) throw new Error('GEMINI_NOT_CONFIGURED');
  var response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [
        { inline_data: { mime_type: mediaType, data: base64Data } },
        { text: prompt }
      ]}]
    })
  });
  if (!response.ok) {
    var errBody = '';
    try { var ej = await response.json(); errBody = (ej.error && ej.error.message) || JSON.stringify(ej); } catch(_) {}
    throw new Error('Gemini API error ' + response.status + (errBody ? ': ' + errBody : ''));
  }
  var data = await response.json();
  return (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts || [])
    .map(function(p) { return p.text || ''; }).join('');
}

// ── Main Vision call: tries Anthropic → Gemini → throws ──
async function kycCallClaudeVision(base64Data, mediaType, prompt) {
  console.log('[KYC v39] kycCallClaudeVision called — Gemini key present:', !!_getGeminiKey());
  var anthropicError = null;

  // 1. Try backend proxy (provider-neutral: Gemini/Claude via AI__Provider in .env)
  var _ep = _kycApiEndpoint();
  if (_ep) {
    try {
      var response = await fetch(_ep.url, {
        method: 'POST',
        headers: _ep.headers,
        body: JSON.stringify({
          documentType: 'GENERIC',
          images: [{ mediaType: mediaType, data: base64Data }],
          prompt: prompt
        })
      });
      if (response.ok) {
        var data = await response.json();
        if (data.code === 'NOT_CONFIGURED') throw new Error('not_configured');
        if (data.success) return data.text || '';
        anthropicError = new Error(data.error || 'KYC proxy error');
      } else {
        var errBody = '';
        try { var ej = await response.json(); errBody = ej.error || JSON.stringify(ej); } catch(_) {}
        anthropicError = new Error('KYC proxy error ' + response.status + (errBody ? ': ' + errBody : ''));
      }
    } catch(fetchErr) {
      anthropicError = fetchErr;
    }
  }

  // 2. Try Gemini Vision (free) — always try if key exists, regardless of Anthropic result
  console.log('[KYC v39] Anthropic result:', anthropicError ? 'FAILED ('+anthropicError.message+')' : 'skipped', '— trying Gemini:', !!_getGeminiKey());
  if (_getGeminiKey()) {
    try {
      return await kycCallGeminiVision(base64Data, mediaType, prompt);
    } catch(geminiErr) {
      // If both failed, prefer showing the Gemini error since that's what user configured
      throw geminiErr;
    }
  }

  // 3. Neither configured or Anthropic failed without Gemini
  if (anthropicError) throw anthropicError;
  var err = new Error('KYC_API_NOT_CONFIGURED');
  err.isApiNotConfigured = true;
  throw err;
}

// Extract base64 data and media type from a dataUrl
function kycDataUrlParts(dataUrl) {
  var m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('Invalid data URL');
  return { mediaType: m[1], base64: m[2] };
}

// ─────────────────────── AI-POWERED EXTRACTION ───────────────────────
async function kycExtractPanViaVision(dataUrl) {
  var parts = kycDataUrlParts(dataUrl);
  var prompt = 'Read this Indian PAN card image (may be rotated — orient by "INCOME TAX DEPARTMENT" header). Extract cardholder name (not father), father name, PAN (10 chars: 5 letters+4 digits+1 letter), DOB. Name: exact as printed, never reorder. Split: 1 word=first only, 2=first+last, 3=first+middle+last, 4+=first+middle(joined)+last. Return ONLY JSON:\n{"full_name":"","first_name":"","middle_name":"","last_name":"","pan_number":"","date_of_birth":"DD/MM/YYYY","father_name":"","layout":"PHYSICAL or EPAN"}\nNull for unreadable fields. No markdown.';

  var _ep = _kycApiEndpoint();
  try {
    var response = await fetch(_ep.url, {
      method: 'POST',
      headers: _ep.headers,
      body: JSON.stringify({
        documentType: 'PAN',
        images: [{ mediaType: parts.mediaType, data: parts.base64 }],
        prompt: prompt
      })
    });
    var data = await response.json();
    if (!response.ok || !data.success) {
      if (data.code === 'NOT_CONFIGURED') {
        var ncErr = new Error('KYC_API_NOT_CONFIGURED'); ncErr.isApiNotConfigured = true; throw ncErr;
      }
      throw new Error(data.error || ('KYC proxy error ' + response.status));
    }
    var raw = (data.text || '').replace(/```json|```/g, '').trim();
    var jm = raw.match(/\{[\s\S]*\}/); if (jm) raw = jm[0];
    return JSON.parse(raw);
  } catch(e) {
    throw e;
  }
}

async function kycExtractAadhaarViaVision(imageDataUrl, embeddedText, backDataUrl) {
  if (embeddedText && embeddedText.replace(/\s/g,'').length > 100) {
    return kycParseAadharFromText(embeddedText);
  }
  var parts = kycDataUrlParts(imageDataUrl);
  var backParts = null;
  if (backDataUrl) { try { backParts = kycDataUrlParts(backDataUrl); } catch(_) {} }

  var prompt = 'Read this Indian Aadhaar card.' + (backParts ? ' Image 1=FRONT (name/DOB/gender/number). Image 2=BACK (address).' : '') + ' Extract: full_name (English only, exclude DOB/mobile/number), aadhaar_number (12 digits, not VID), date_of_birth (DD/MM/YYYY or YYYY), gender (Male/Female), address fields ONLY from back side. Parse address into: house_number (flat+floor), street (road/marg/lane), locality (area/nagar/colony), city (district name), state, pin_code (6 digits). Return ONLY JSON:\n{"full_name":"","aadhaar_number":"","date_of_birth":"","gender":"","house_number":"","street":"","locality":"","city":"","state":"","pin_code":"","address":"full address as printed"}\nNull for absent fields. No markdown.';

  var images = [{ mediaType: parts.mediaType, data: parts.base64 }];
  if (backParts) images.push({ mediaType: backParts.mediaType, data: backParts.base64 });

  var _ep2 = _kycApiEndpoint();
  try {
    var response = await fetch(_ep2.url, {
      method: 'POST',
      headers: _ep2.headers,
      body: JSON.stringify({
        documentType: 'AADHAAR',
        images: images,
        prompt: prompt
      })
    });
    var data = await response.json();
    if (!response.ok || !data.success) {
      if (data.code === 'NOT_CONFIGURED') {
        var ncErr = new Error('KYC_API_NOT_CONFIGURED'); ncErr.isApiNotConfigured = true; throw ncErr;
      }
      throw new Error(data.error || ('KYC proxy error ' + response.status));
    }
    var raw = (data.text || '').replace(/```json|```/g, '').trim();
    var jm = raw.match(/\{[\s\S]*\}/); if (jm) raw = jm[0];
    return JSON.parse(raw);
  } catch(e) {
    throw e;
  }
}


// ─────────────────────── GET FULL TEXT (legacy fallback for PDF text layer) ───────────────────────
async function kycGetText(type) {
  const state = KYC[type];
  kycShowLoading('Reading ' + (type==='pan'?'PAN':'Aadhaar') + ' document\u2026');
  if (state.isPdf) {
    const result = await kycPdfToCanvases(state.dataUrl);
    if (result.embeddedText.replace(/\s/g,'').length > 60) return result.embeddedText;
    return { canvases: result.canvases, embeddedText: '' };
  }
  // For images: return the dataUrl so Tesseract fallback can OCR it
  return state.dataUrl || null;
}

// ─────────────────────── TESSERACT OCR (kept as last-resort fallback) ───────────────────────
// [kycOcrImage moved to Vision-API section below]

// ─────────────────────── PARSE PAN ───────────────────────
function kycParsePan(raw) {
  var flat = raw.replace(/\n/g,' ').replace(/\s+/g,' ');
  var panM = flat.match(/[A-Z]{5}[0-9]{4}[A-Z]/);
  var pan_number = panM ? panM[0] : null;
  var dobM = flat.match(/\b(\d{2}[\/\-]\d{2}[\/\-]\d{4})\b/);
  var date_of_birth = dobM ? dobM[1].replace(/-/g,'/') : null;
  var full_name = null, father_name = null;

  var skipWords = /^(INCOME|TAX|DEPT|GOVT|INDIA|PERMANENT|ACCOUNT|NUMBER|CARD|PAN|VALID|THROUGH|SIGNATURE|DATE|BIRTH|NAME|FATHER|OF|DEPARTMENT)$/;
  var nameLabelPat = /(?:नाम\s*[\/|]\s*Name|naam\s*[\/|]\s*Name|Name\s*[\/|]\s*नाम|^(?:नाम|Name)$)/i;
  var fatherLabelPat = /father['']?s?\s*name|पिता\s*का\s*नाम/i;

  var lines = raw.split('\n').map(function(l){ return l.trim(); }).filter(Boolean);

  function isValidNameCandidate(str) {
    var words = str.trim().split(/\s+/);
    // Allow single-letter initials (e.g. "PRACHI R BHAVE" — "R" is valid)
    return words.length >= 2 && words.length <= 5 &&
      words.every(function(w){ return w.length >= 1 && !skipWords.test(w.toUpperCase()); }) &&
      /^[A-Z]/.test(str) && words.filter(function(w){ return w.length >= 2; }).length >= 2;
  }

  // ── Detect Layout B (older format): PAN number appears AFTER the names ──
  // In Layout B: name block appears before "Permanent Account Number" line
  var panLabelIdx = -1;
  for (var pi = 0; pi < lines.length; pi++) {
    if (/permanent\s+account\s+number/i.test(lines[pi])) { panLabelIdx = pi; break; }
  }
  var isLayoutB = panLabelIdx > 0; // PAN label found mid-card → Layout B

  if (isLayoutB) {
    // Collect ALL-CAPS name lines that appear BEFORE the "Permanent Account Number" label
    var nameBlock = [];
    var junkPat = /^(INCOME|TAX|DEPT|GOVT|INDIA|DEPARTMENT|GOVT\.|आयकर|विभाग|भारत|सरकार)/i;
    for (var bi = 0; bi < panLabelIdx; bi++) {
      var bl = lines[bi].trim();
      if (!bl || junkPat.test(bl)) continue;
      // Must look like ALL-CAPS name (letters, spaces, single-letter initials allowed)
      if (/^[A-Z][A-Z\s\.]{2,50}$/.test(bl) && isValidNameCandidate(bl)) {
        nameBlock.push(bl);
      }
    }
    // In Layout B: first name block = cardholder, second = father
    if (nameBlock.length >= 1) full_name  = nameBlock[0];
    if (nameBlock.length >= 2) father_name = nameBlock[1];
  }

  // ── Layout A: look for explicit Name label ──
  if (!full_name) {
    // Strategy 1: label + name on same line
    for (var i = 0; i < lines.length; i++) {
      var lnM = lines[i].match(/(?:नाम\s*[\/|]\s*Name|naam\s*[\/|]\s*Name|Name\s*[\/|]\s*नाम|(?:^|\s)Name\s+)([A-Z]{2,}(?:\s[A-Z]{1,}){1,4})/i);
      if (lnM) { var c = lnM[1].trim(); if (isValidNameCandidate(c)) { full_name = c; break; } }
    }
  }
  if (!full_name) {
    // Strategy 2: label line then next ALL-CAPS line
    for (var j = 0; j < lines.length; j++) {
      if (nameLabelPat.test(lines[j])) {
        for (var k = j+1; k < lines.length; k++) {
          var nl = lines[k].trim(); if (!nl) continue;
          if (/^[A-Z][A-Z\s]{3,50}$/.test(nl) && isValidNameCandidate(nl)) full_name = nl;
          break;
        }
        if (full_name) break;
      }
    }
  }
  if (!full_name) {
    // Strategy 3: first standalone ALL-CAPS line that looks like a name
    for (var s3i = 0; s3i < lines.length; s3i++) {
      var ln3 = lines[s3i];
      if (!/^[A-Z][A-Z\s]{3,50}$/.test(ln3) || !isValidNameCandidate(ln3)) continue;
      // Make sure it isn't the father's name by checking if there's a father label before it
      full_name = ln3; break;
    }
  }

  // ── Father name (Layout A): look for explicit label ──
  if (!father_name) {
    for (var fi = 0; fi < lines.length; fi++) {
      if (fatherLabelPat.test(lines[fi])) {
        var sameLine = lines[fi].match(/(?:father['']?s?\s*name|पिता\s*का\s*नाम)\s*[\/|]?\s*(?:[A-Za-z\s]+[\/|]\s*)?([A-Z]{2,}(?:\s[A-Z]{1,}){1,4})/i);
        if (sameLine && isValidNameCandidate(sameLine[1].trim())) { father_name = sameLine[1].trim(); break; }
        for (var fj = fi+1; fj < lines.length; fj++) {
          var fl2 = lines[fj].trim(); if (!fl2) continue;
          if (/^[A-Z][A-Z\s]{3,}$/.test(fl2)) father_name = fl2;
          break;
        }
        break;
      }
    }
  }
  // Fallback: ALL-CAPS phrase immediately after the cardholder name
  if (!father_name && full_name) {
    var idx = flat.indexOf(full_name);
    var after = flat.slice(idx + full_name.length, idx + full_name.length + 100);
    var fm = after.match(/([A-Z]{2,}(?:\s[A-Z]{1,}){1,4})/);
    if (fm && isValidNameCandidate(fm[1].trim()) && fm[1].trim() !== full_name) father_name = fm[1].trim();
  }

  var split = kycSplitName({ full_name:full_name, first_name:null, middle_name:null, last_name:null });
  return { pan_number:pan_number, full_name:full_name, first_name:split.first, middle_name:split.middle, last_name:split.last, date_of_birth:date_of_birth, father_name:father_name, doc_type:'PAN', _raw:raw };
}

// ─────────────────────── PARSE AADHAAR FROM EMBEDDED PDF TEXT ───────────────────────
// Used when e-Aadhaar PDF has a proper text layer (most common case)
function kycParseAadharFromText(raw) {
  return kycParseAadhar(raw);
}

// ─────────────────────── PARSE AADHAAR ───────────────────────
function kycParseAadhar(raw) {
  var flat = raw.replace(/\n/g,' ').replace(/\s+/g,' ');

  // ── Aadhaar Number ──
  // Fix common OCR mistakes: O→0, I→1, l→1, then try flexible spacing
  var fixedFlat = flat.replace(/[Oo]/g,'0').replace(/[IlL]/g,'1');
  // Match 12-digit number with optional spaces every 4 digits (e.g. "1234 5678 9012" or "123456789012")
  var aM = fixedFlat.match(/\b(\d{4})\s?(\d{4})\s?(\d{4})\b/) ||
            fixedFlat.match(/\b(\d{4})\s(\d{4})\s(\d{4})\b/);
  var aadhaar_number = aM ? (aM[1]+aM[2]+aM[3]) : null;

  // If still not found, try to find 12 consecutive digits with possible single-char noise
  if (!aadhaar_number) {
    var digitMatch = fixedFlat.match(/\b\d[\d\s]{10,13}\d\b/);
    if (digitMatch) {
      var digits = digitMatch[0].replace(/\s/g,'');
      if (digits.length === 12) aadhaar_number = digits;
    }
  }

  var dobM = flat.match(/(?:DOB|Date\s+of\s+Birth|D\.O\.B)[:\s]*(\d{2}[\/\-]\d{2}[\/\-]\d{4})/i) ||
             flat.match(/\b(\d{2}[\/\-]\d{2}[\/\-]\d{4})\b/);
  var date_of_birth = dobM ? dobM[1].replace(/-/g,'/') : null;
  var gM = flat.match(/\b(Male|Female|Transgender|MALE|FEMALE)\b/i);
  var gender = gM ? (gM[1].charAt(0).toUpperCase()+gM[1].slice(1).toLowerCase()) : null;

  // ── Name: first non-header/non-junk line with 2-4 proper words ──
  var full_name = null;
  var skipPat = /govt|government|india|unique|authority|uidai|aadhaar|aadhar|enrollment|identification|samaanya|maansacha|mera|meri|pehchaan|माझे|आधार|ओळख|प्राधिकरण|सरकार/i;
  var nameDobPat = /^\d{2}[\/\-]\d{2}[\/\-]\d{4}$|^\d{4}$/;
  var lines = raw.split('\n').map(function(l){ return l.trim(); }).filter(Boolean);
  // First try: look for explicit "To," prefix (printed letter format)
  for (var ti = 0; ti < lines.length; ti++) {
    var toM = lines[ti].match(/^To[,\s]+(.+)$/i);
    if (toM) { var tc = toM[1].trim(); if (tc.split(' ').length >= 2 && /^[A-Za-z]/.test(tc)) { full_name = tc; break; } }
  }
  // Second try: first non-junk line that looks like 2-5 proper English name words
  if (!full_name) {
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (skipPat.test(line)) continue;
      if (nameDobPat.test(line)) continue;
      if (/^[A-Za-z][A-Za-z\s]{3,40}$/.test(line) && line.split(' ').length >= 2 && line.split(' ').length <= 5) {
        full_name = line.trim(); break;
      }
    }
  }

  // ── PIN: 6-digit code, must not be part of Aadhaar number ──
  var pinCandidates = flat.match(/\b\d{6}\b/g) || [];
  var pin_code = pinCandidates.find(function(p){ return !aadhaar_number || !aadhaar_number.includes(p); }) || pinCandidates[0] || null;

  // ── State ──
  var STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Delhi','Jammu and Kashmir','Ladakh'];
  var state = null;
  for (var si = 0; si < STATES.length; si++) {
    if (flat.toLowerCase().indexOf(STATES[si].toLowerCase()) !== -1) { state = STATES[si]; break; }
  }

  // ── Address ──
  // Lines to always reject regardless of context
  var addrJunkPat = /signature|not verified|digitally signed|\d{4}\.\d{2}\.\d{2}\s+\d{2}:\d{2}|IST|authority of india|uidai|aadhaar|aadhar|enrollment|govt|government|unique identification|mera aadhaar|meri pehchaan|सूचना|information/i;

  var addrLines = [];

  // Priority 1: look for explicit "Address:" label in the text (common in PDF e-Aadhaar)
  var addrLabelMatch = raw.match(/Address\s*:\s*([\s\S]{10,400}?)(?:\n\s*\n|\d{12}|VID\s*:|$)/i);
  if (addrLabelMatch) {
    // Split on commas, clean each part, remove empties and junk
    var rawAddr = addrLabelMatch[1].replace(/\n/g,' ').replace(/\s+/g,' ').trim();
    // Capture PIN before stripping it
    var pinInAddr = rawAddr.match(/[-–]?\s*(\d{6})\s*$/);
    if (pinInAddr && !pin_code) pin_code = pinInAddr[1];
    // Strip trailing "State - PIN" pattern
    rawAddr = rawAddr.replace(/,?\s*[A-Za-z\s]+\s*[-–]\s*\d{6}\s*$/, '').trim();
    // Split and clean
    var addrParts = rawAddr.split(/,\s*/).map(function(p){ return p.trim(); })
      .filter(function(p){ return p.length > 1 && !addrJunkPat.test(p); })
      .map(function(p){
        // Strip label prefixes like "PO:", "VTC:", "DIST:", "Sub District:" but KEEP the value
        return p.replace(/^(?:PO|VTC|DIST|SUB\s*DIST(?:RICT)?|Sub\s*District|District|State|PIN\s*Code|Mobile)\s*:\s*/i, '').trim();
      })
      .filter(function(p){ return p.length > 1; });
    addrLines = addrParts;
  }

  // Priority 2: line-by-line collection after the name (for image Aadhaar)
  if (!addrLines.length) {
    var collecting = false;
    for (var li = 0; li < lines.length; li++) {
      var ln = lines[li];
      if (addrJunkPat.test(ln)) continue;
      if (full_name && ln === full_name) { collecting = true; continue; }
      if (collecting) {
        var digitsOnly = ln.replace(/\s/g,'');
        if (/^\d{12}$/.test(digitsOnly)) break;
        if (/^\d{10}$/.test(digitsOnly)) continue; // skip phone numbers
        if (ln.length <= 3) continue;
        if (/^\d{2}[\/\-]\d{2}[\/\-]\d{4}$/.test(ln)) continue;
        if (/^(Male|Female|Transgender)$/i.test(ln)) continue;
        if (addrJunkPat.test(ln)) continue;
        addrLines.push(ln);
        if (addrLines.length >= 6) break;
      }
    }
  }

  // Priority 3: keyword-based scan
  if (!addrLines.length) {
    var addrKeywords = /s\/o|w\/o|c\/o|d\/o|h\.?no|house|flat|plot|door|village|vill|ward|near|post|dist|district|street|road|nagar|colony|lane|sector|block|taluk|tehsil|tower|chawl|room/i;
    for (var ai = 0; ai < lines.length; ai++) {
      if (addrKeywords.test(lines[ai]) && !addrJunkPat.test(lines[ai])) {
        for (var aj = ai; aj < lines.length && addrLines.length < 6; aj++) {
          var al = lines[aj].trim();
          if (al.length > 3 && !/^\d{12}$/.test(al.replace(/\s/g,'')) && !addrJunkPat.test(al)) addrLines.push(al);
        }
        break;
      }
    }
  }

  // Map address parts to fields:
  // addrLines example: ["605", "Kasturi Tower", "Ghar Angan Road", "Titwala East", "Ambivali Tarf Vasundri"]
  // house_number = first parts joined until we hit a road/street/locality keyword
  // street = road/road name part, locality = area/village, city = district

  // Filter out any addrLines that are purely a 12-digit Aadhaar number or digital-sig noise
  addrLines = addrLines.filter(function(l) {
    var stripped = l.replace(/\s/g,'');
    if (/^\d{12}$/.test(stripped)) return false;
    if (/signature|not verified|digitally signed|IST\s*\d|date:\s*\d{4}/i.test(l)) return false;
    return true;
  });

  var full_address = addrLines.length ? addrLines.join(', ') : null;
  // Strip any trailing Aadhaar number that leaked into full_address
  if (full_address) {
    full_address = full_address.replace(/\s*\d{4}\s+\d{4}\s+\d{4}\s*$/, '').replace(/\s*\d{12}\s*$/, '').trim();
  }

  // Smart field mapping: combine numeric-start part with building name for house_number
  var house_number = null, street = null, locality = null, city_field = null;
  if (addrLines.length >= 1) {
    // If first part is just a number or "NNN, Building Name", combine first two
    if (/^\d/.test(addrLines[0]) && addrLines.length >= 2) {
      house_number = addrLines[0] + ', ' + addrLines[1];
      street   = addrLines[2] || null;
      locality = addrLines[3] || null;
      city_field = addrLines[4] || null;
    } else {
      house_number = addrLines[0];
      street   = addrLines[1] || null;
      locality = addrLines[2] || null;
      city_field = addrLines[3] || null;
    }
  }
  // Use district/thane as city if we have it from state detection area
  if (!city_field && state) city_field = null; // state separately stored

  return { aadhaar_number:aadhaar_number, full_name:full_name, date_of_birth:date_of_birth, gender:gender,
           house_number:house_number, street:street, locality:locality, landmark:null,
           city:city_field, state:state, pin_code:pin_code, full_address:full_address, doc_type:'AADHAAR', _raw:raw };
}

// ─────────────────────── NAME SPLITTER ───────────────────────
// IMPORTANT: The name is split strictly left-to-right in the exact sequence
// it appears on the PAN card. No reordering is performed whatsoever.
// Word 1 = First Name, Word(s) 2..N-1 = Middle Name, Word N = Last Name.
// If only 1 word → First only. If 2 words → First + Last, no Middle.
function kycSplitName(d) {
  var first  = (d.first_name  || '').trim();
  var middle = (d.middle_name || '').trim();
  var last   = (d.last_name   || '').trim();
  if ((!first || !last) && d.full_name) {
    // Preserve exact left-to-right sequence as printed on PAN card
    var parts = d.full_name.trim().replace(/\s+/g,' ').split(' ');
    if (parts.length === 1)      { first=parts[0]; middle=''; last=''; }
    else if (parts.length === 2) { first=parts[0]; middle=''; last=parts[1]; }
    else {
      // Word 1 = First, middle word(s) = Middle, last word = Last
      // Sequence is NEVER changed — exactly as on PAN card
      first  = parts[0];
      last   = parts[parts.length - 1];
      middle = parts.slice(1, parts.length - 1).join(' ');
    }
  }
  return { first:first, middle:middle, last:last };
}

// ─────────────────────── MAIN ORCHESTRATOR ───────────────────────
// ─────────────────────── MAIN ORCHESTRATOR ───────────────────────
async function kycExtractAll() {
  KYC.validationLog = [];
  KYC.reportTs = new Date();
  var btn = document.getElementById('kyc-extract-btn');
  btn.disabled = true;
  btn.innerHTML = '<span id="kyc-extract-icon">⧗</span> Extracting…';

  var panData = null, aadharData = null;

  // ── PAN extraction — Vision API ──
  if (KYC.pan.dataUrl) {
    try {
      kycShowLoading('Reading PAN card…');
      var panImageUrl = KYC.pan.dataUrl;
      if (KYC.pan.isPdf) {
        var panPdfResult = await kycPdfToCanvases(KYC.pan.dataUrl);
        // Try embedded text first (fastest, most accurate for e-PAN)
        var panEmbText = panPdfResult.embeddedText || '';
        if (panEmbText.replace(/\s/g,'').length > 30) {
          var textParsed = kycParsePan(panEmbText);
          if (textParsed && textParsed.pan_number && /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(textParsed.pan_number)) {
            panData = textParsed;
            KYC.pan.data = panData;
            kycRenderPanExtracted(panData);
          }
        }
        // Text layer failed — render PDF page to image, send to Vision API
        if (!panData && panPdfResult.canvases && panPdfResult.canvases.length) {
          var c = panPdfResult.canvases[0];
          panImageUrl = c.toDataURL ? c.toDataURL('image/png') : c;
        }
      } else {
        // Direct image upload (JPG/PNG/etc.) — apply the same contrast/sharpness
        // boost PDF-rendered pages already get, so scan/print-degraded images
        // aren't disadvantaged before reaching Vision.
        panImageUrl = await kycEnhanceDataUrl(panImageUrl);
      }
      if (!panData) {
        kycShowLoading('Analysing PAN via AI…');
        panData = await kycExtractPanViaVision(panImageUrl);
        if (panData) { KYC.pan.data = panData; kycRenderPanExtracted(panData); }
      }
    } catch(err) {
      console.error('[KYC] PAN extraction error:', err);
      KYC.validationLog.push({ icon:'❌', label:'PAN Extraction', value:'Failed', status:'error', detail: err.message });
      var panExtEl = document.getElementById('kyc-pan-extracted');
      if (panExtEl) {
        panExtEl.style.display = 'block';
        if (!document.getElementById('kyc-pan-error-msg')) {
          panExtEl.insertAdjacentHTML('beforeend',
            '<div id="kyc-pan-error-msg" style="color:#92400e;font-size:12px;padding:8px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;margin-top:8px">' +
            '⚠️ Could not read PAN — please fill fields manually.</div>');
        }
      }
    }
  }

  // ── Aadhaar extraction — Vision API ──
  if (KYC.aadhar.dataUrl) {
    try {
      kycShowLoading('Reading Aadhaar…');
      var aadharImageUrl = KYC.aadhar.dataUrl;
      var aadharBackUrl  = KYC.aadharBack.dataUrl || null;
      var embText = '';
      if (KYC.aadhar.isPdf) {
        var aadharPdfResult = await kycPdfToCanvases(KYC.aadhar.dataUrl);
        embText = aadharPdfResult.embeddedText || '';
        if (aadharPdfResult.canvases && aadharPdfResult.canvases.length) {
          var ac = aadharPdfResult.canvases[0];
          aadharImageUrl = ac.toDataURL ? ac.toDataURL('image/png') : ac;
        }
      } else {
        // Direct image upload — same contrast/sharpness boost PDF pages get.
        aadharImageUrl = await kycEnhanceDataUrl(aadharImageUrl);
      }
      if (aadharBackUrl && !KYC.aadharBack.isPdf) {
        aadharBackUrl = await kycEnhanceDataUrl(aadharBackUrl);
      }
      kycShowLoading('Analysing Aadhaar via AI…');
      aadharData = await kycExtractAadhaarViaVision(aadharImageUrl, embText, aadharBackUrl);
      if (aadharData) { KYC.aadhar.data = aadharData; kycRenderAadharExtracted(aadharData); }
      else {
        // Extraction completed but returned no data — still show the form for manual entry
        var aadharExtEl = document.getElementById('kyc-aadhar-extracted');
        if (aadharExtEl) aadharExtEl.style.display = 'block';
      }
    } catch(err) {
      console.error('[KYC] Aadhaar extraction error:', err);
      KYC.validationLog.push({ icon:'❌', label:'Aadhaar Extraction', value:'Failed', status:'error', detail: err.message });
      var aadharExtEl = document.getElementById('kyc-aadhar-extracted');
      if (aadharExtEl) {
        aadharExtEl.style.display = 'block';
        if (!document.getElementById('kyc-aadhar-error-msg')) {
          aadharExtEl.insertAdjacentHTML('beforeend',
            '<div id="kyc-aadhar-error-msg" style="color:#92400e;font-size:12px;padding:8px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;margin-top:8px">' +
            '⚠️ Could not read Aadhaar — please fill fields manually.</div>');
        }
      }
      showToast('Aadhaar extraction failed — please fill manually', 'warn');
    }
  }

  kycHideLoading();
  if (panData && aadharData) kycCrossValidate(panData, aadharData);

  var panel = document.getElementById('kyc-extracted-panel');
  if (panel) panel.style.display = 'block';
  kycBuildReport(panData, aadharData);
  kycUpdateTrackingRecord(panData, aadharData);

  btn.disabled = false;
  btn.innerHTML = '<span id="kyc-extract-icon">✓</span> Re-Extract';
  kycCheckExtractReady();
  kycUpdateReadinessChecklist();
  if (panel) panel.scrollIntoView({ behavior:'smooth', block:'start' });
  showToast('KYC extraction complete — fields auto-filled', 'success');
}

// Build Aadhaar data object from Claude Vision JSON response
function kycBuildAadharFromVision(v) {
  // Sanitise Aadhaar number: 12 digits only, strip spaces; reject VID (16 digits)
  var aNum = (v.aadhaar_number || '').replace(/\s/g,'');
  if (aNum.length !== 12 || !/^\d{12}$/.test(aNum)) aNum = '';

  // Declare state/pin FIRST so they are available throughout the function
  var pin_code  = v.pin_code || null;
  var state_val = v.state    || null;

  // Detect state from address if not provided
  var STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Delhi','Jammu and Kashmir','Ladakh'];
  if (!state_val && v.address) {
    for (var si = 0; si < STATES.length; si++) {
      if (v.address.toLowerCase().indexOf(STATES[si].toLowerCase()) !== -1) { state_val = STATES[si]; break; }
    }
  }
  // Sanitise full_address: strip trailing Aadhaar/VID numbers, duplicate PINs, and phone numbers
  var fullAddr = (v.address || '')
    .replace(/\s*VID\s*:?\s*\d[\d\s]{14,}\d\s*$/i, '')  // strip VID suffix
    .replace(/\s*\d{4}\s+\d{4}\s+\d{4}\s*$/, '')         // strip "XXXX XXXX XXXX" Aadhaar
    .replace(/\s*\d{12}\s*$/, '')                             // strip 12-digit Aadhaar
    .replace(/,?\s*\d{10}\s*$/, '')                           // strip trailing 10-digit phone number
    .replace(/(\b\d{6})\s+\1\s*$/, '$1')                    // deduplicate PIN
    .trim();

  // Extract PIN from "State PIN" combined pattern if pin_code not already set
  if (!pin_code) {
    // Try to find PIN in full address
    var pinM = fullAddr.match(/\b(\d{6})\b/);
    if (pinM) pin_code = pinM[1];
  }
  // If state has a 6-digit number embedded (e.g. Claude returned "Maharashtra 400607" as state), split it
  if (state_val && /\d{6}/.test(state_val)) {
    var sm = state_val.match(/^([A-Za-z\s]+?)\s*[-–]?\s*(\d{6})\s*$/);
    if (sm) { state_val = sm[1].trim(); if (!pin_code) pin_code = sm[2]; }
  }

  // Normalise DOB: if only a 4-digit year returned (e.g. "1995"), keep as-is for display
  var dob = v.date_of_birth || null;
  if (dob && /^\d{4}$/.test((dob || '').trim())) {
    dob = dob.trim(); // year-only — store as "YYYY", sync will handle gracefully
  }

  // Sanitise full_name: strip any trailing DOB, year, gender, mobile, or Aadhaar number that may have leaked in
  var fullName = (v.full_name || '').trim();
  // Remove anything after a digit run that looks like a DOB or mobile suffix
  fullName = fullName.replace(/\s+\d[\d\/\-\s]{3,}\s*$/, '').trim();
  // Remove trailing gender words that leaked in
  fullName = fullName.replace(/\s+(Male|Female|Transgender|MALE|FEMALE|पुरुष|महिला)\s*$/i, '').trim();
  fullName = fullName || null;

  return {
    aadhaar_number: aNum || null,
    full_name:      fullName,
    date_of_birth:  dob,
    gender:         v.gender        || null,
    house_number:   v.house_number  || null,
    street:         v.street        || null,
    locality:       v.locality      || null,
    landmark:       null,
    city:           v.city          || null,
    state:          state_val,
    pin_code:       pin_code,
    full_address:   fullAddr        || null,
    doc_type: 'AADHAAR'
  };
}

// ─────────────────────── RENDER PAN ───────────────────────
function kycRenderPanExtracted(d) {
  if (!d) return;
  document.getElementById('kyc-pan-extracted').style.display = 'block';
  // Use pre-split fields directly (set by kycExtractAll from Vision API response).
  // Fall back to kycSplitName only when those fields are absent (e.g. Tesseract fallback path).
  var firstName  = d.first_name  || '';
  var middleName = d.middle_name || '';
  var lastName   = d.last_name   || '';
  if (!firstName && !lastName && d.full_name) {
    var sp = kycSplitName(d);
    firstName = sp.first; middleName = sp.middle; lastName = sp.last;
  }
  kycSetField('kyc-out-fname',  firstName);
  kycSetField('kyc-out-mname',  middleName);
  kycSetField('kyc-out-lname',  lastName);
  kycSetField('kyc-out-pan',    d.pan_number    || '');
  kycSetField('kyc-out-dob',    d.date_of_birth || '');
  kycSetField('kyc-out-father', d.father_name   || '');
  if (firstName)  kycAutoFill('w-fname', firstName);
  if (middleName) kycAutoFill('w-mname', middleName);
  if (lastName)   kycAutoFill('w-lname', lastName);
  if (d.pan_number) kycAutoFill('w-pan', d.pan_number.replace(/\s/g,'').toUpperCase());
  if (d.father_name) {
    window._kycFatherName = d.father_name;
    kycAutoFill('w-father', d.father_name);
    try {
      if (typeof APPLICATIONS !== 'undefined') {
        var _wip = APPLICATIONS.find(function(a){ return a.status === 'wip' || a.status === 'new'; });
        if (_wip) _wip.father = d.father_name;
      }
    } catch(e) {}
  }
  if (d.date_of_birth) kycSyncDob(d.date_of_birth);

  // ── Also persist into the in-progress APPLICATIONS object ──
  // This ensures loadWizardFromApp (called when navigating steps) keeps KYC values
  try {
    if (typeof APPLICATIONS !== 'undefined') {
      var _wip = APPLICATIONS.find(function(a){ return a.status === 'wip' || a.status === 'new'; });
      if (_wip) {
        if (firstName)         _wip.fname  = firstName;
        if (middleName)        _wip.mname  = middleName;
        if (lastName)          _wip.lname  = lastName;
        if (d.pan_number)      _wip.pan    = d.pan_number.replace(/\s/g,'').toUpperCase();
        if (d.date_of_birth) {
          // Convert DD/MM/YYYY to YYYY-MM-DD for date input
          var dp = d.date_of_birth.split(/[\/\-]/);
          if (dp.length === 3 && dp[2].length === 4) _wip.dob = dp[2]+'-'+dp[1].padStart(2,'0')+'-'+dp[0].padStart(2,'0');
        }
        if (d.father_name)     _wip.father = d.father_name;
      }
    }
  } catch(e) {}

  var pv = d.pan_number && /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(d.pan_number.replace(/\s/g,''));
  var badge = document.getElementById('kyc-pan-val-badge');
  if (badge) badge.innerHTML = pv ? '<span class="kyc-badge-ok">\u2713 Valid PAN</span>' : '<span class="kyc-badge-warn">\u26A0 Check PAN</span>';
  KYC.validationLog.push({ icon:pv?'\u2705':'\u26A0\uFE0F', label:'PAN Number', value:d.pan_number||'Not detected', status:pv?'valid':'warn', detail:pv?'Format valid':'Unconfirmed' });
  KYC.validationLog.push({ icon:'\uD83D\uDC64', label:'Name (PAN)', value:d.full_name||[firstName,middleName,lastName].filter(Boolean).join(' '), status:'info', detail:'From PAN card' });
  if (d.date_of_birth) KYC.validationLog.push({ icon:'\uD83D\uDCC5', label:'DOB', value:d.date_of_birth, status:'info', detail:'From PAN card' });
}

// ─────────────────────── RENDER AADHAAR ───────────────────────
function kycRenderAadharExtracted(d) {
  if (!d) return;
  document.getElementById('kyc-aadhar-extracted').style.display = 'block';
  var aNum = (d.aadhaar_number || '').replace(/\s/g,'');
  var fmt  = aNum.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3');
  kycSetField('kyc-out-aadhar', fmt  || '');

  // Name: use Aadhaar name; if missing, fall back to PAN full_name (cross-doc fill)
  var aName = d.full_name || '';
  if (!aName && KYC.pan.data && KYC.pan.data.full_name) {
    aName = KYC.pan.data.full_name;
  }
  kycSetField('kyc-out-aname',  aName);
  kycSetField('kyc-out-gender', d.gender    || '');

  // ── Smart address field mapping ──
  // FIELD MEANINGS (matching the renamed labels):
  //   s1  → "House / Flat No."   = flat number + floor (e.g. "Flat no 501, 4 thfloor")
  //   s2  → "Street & Locality"  = road name + ALL locality/area/nagar names
  //   city → "City / District"   = district name only (e.g. "Belgaum")
  //
  // Priority:
  //   1. Vision sub-fields (house_number, street, locality, city) — most accurate
  //   2. Smart parsing of full_address for any gaps

  var s1 = '', s2 = '', city = d.city || '', state = d.state || '', pin = d.pin_code || '';

  var floorPat  = /^(?:\d+\s*(?:st|nd|rd|th)\s*floor|ground\s*floor|\d+\s*floor|floor\s*\d+|\d+\s*(?:st|nd|rd|th)\s*fl\.?|gf|basement)/i;
  var roadKw    = /\b(road|marg|lane|cross|main|street|avenue|path|highway|bypass|nagar\s*road|chawl)\b/i;
  var localKw   = /\b(nagar|vihar|colony|sector|layout|phase|ward|block|extension|park|enclave|residency|society|wadi|galli|basti|puram|ganj|gunj|peth|pura|pur)\b/i;
  var houseKw   = /^(?:\d|flat|room|plot|door|house|h\.?no|f\.?no|gf|rno|wing|[a-z]\/\d|\d+[a-z]?\s*[\/\-]|s\/o|w\/o|d\/o|c\/o)/i;
  var STATES_KYC = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Delhi','Jammu and Kashmir','Ladakh'];
  var statePat  = new RegExp('^(' + STATES_KYC.join('|') + ')(?:\\s*[-–]?\\s*\\d{6})?$', 'i');
  var stPinPat  = new RegExp('^(' + STATES_KYC.join('|') + ')\\s*[-–]?\\s*(\\d{6})$', 'i');

  // ── Step 1: Build from Vision sub-fields ──
  if (d.house_number) s1 = d.house_number;
  var s2Parts = [];
  if (d.street)   s2Parts.push(d.street);
  if (d.locality) s2Parts.push(d.locality);
  if (s2Parts.length) s2 = s2Parts.join(', ');
  if (!s1 && d.street) { s1 = d.street; s2 = d.locality || ''; }

  // ── Step 2: Augment from address text ──
  // Vision API returns this field as 'address'; the text-layer parser
  // (kycParseAadharFromText, used for PDFs with embedded text) returns
  // 'full_address' — both feed this same renderer, so check either.
  var addrText = d.address || d.full_address;
  if (addrText) {
    var rawAddr = addrText.replace(/\s+/g,' ').trim();

    // Extract PIN if missing
    if (!pin) { var pm = rawAddr.match(/\b(\d{6})\b/); if (pm) pin = pm[1]; }

    // Split address into comma-parts, stripping state/pin/phone
    var addrParts = rawAddr.split(',').map(function(p){ return p.trim(); }).filter(function(p){ return p.length > 1; });
    var bodyParts = [];
    addrParts.forEach(function(part) {
      if (/^\d{10}$/.test(part.replace(/\s/g,''))) return; // phone
      // "DIST: X" → city
      if (/^(?:DIST(?:RICT)?|District)[\s:]/i.test(part)) {
        var dv = part.replace(/^[A-Za-z\s\-\.]+:\s*/i,'').trim();
        if (!city && dv) city = dv; return;
      }
      // Strip PO/VTC/SubDist label prefix, keep value
      var val = /^(?:PO|VTC|SUB.?DIST|Sub.?District|Taluka|Tehsil)[\s:]/i.test(part)
        ? part.replace(/^[A-Za-z\s\-\.]+:\s*/i,'').trim() : part;
      // State+PIN combined (e.g. "Karnataka - 590019")
      var spM = part.match(stPinPat);
      if (spM) { if (!state) state = spM[1]; if (!pin) pin = spM[2]; return; }
      if (!val || val.length <= 1) return;
      if (statePat.test(val.trim())) { if (!state) state = val.replace(/\s*[-–]?\s*\d{6}\s*$/,'').trim(); return; }
      if (/^\d{6}$/.test(val.trim())) { if (!pin) pin = val.trim(); return; }
      bodyParts.push(val);
    });

    // ── Step 3: If Vision sub-fields present but incomplete, absorb missing parts ──
    if (s1 && bodyParts.length) {
      // Find where s1 (house_number) appears in bodyParts
      var s1Idx = -1;
      for (var bi = 0; bi < bodyParts.length; bi++) {
        if (bodyParts[bi].toLowerCase().indexOf(s1.toLowerCase().split(',')[0].trim()) !== -1) { s1Idx = bi; break; }
      }
      if (s1Idx === -1) s1Idx = 0;

      // Absorb floor: if the part immediately after s1 in bodyParts is a floor descriptor, merge into s1
      var nextAfterHouse = s1Idx + 1;
      if (nextAfterHouse < bodyParts.length && floorPat.test(bodyParts[nextAfterHouse].trim())) {
        s1 = s1 + ', ' + bodyParts[nextAfterHouse];
        nextAfterHouse++;
      }

      // Now collect everything between nextAfterHouse and the city/end as s2
      // Find city boundary: repeated/duplicate parts and "Doordarshan Nagar" style suffixes indicate city
      var midParts = bodyParts.slice(nextAfterHouse);

      // Deduplicate consecutive identical/near-identical parts (e.g. "Belgaum Doordarshan Nagar" repeated)
      var seen = {};
      midParts = midParts.filter(function(p) {
        var key = p.toLowerCase().replace(/\s+/g,' ');
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });

      // Separate city-candidate parts (match known city pattern) from locality parts
      // City candidate = last non-state non-pin part that contains a known district word
      // Anything that is ONLY a city-district (no road/locality keyword) at the end = city
      var localParts = [], cityCandidate = null;
      for (var mi = 0; mi < midParts.length; mi++) {
        var mp = midParts[mi];
        // If this part is city-like (no road/locality keyword but has city-pattern),
        // AND city not yet set, AND it's one of the last 2 parts → treat as city boundary
        var isCityLike = !roadKw.test(mp) && !localKw.test(mp) && mp.split(' ').filter(Boolean).length <= 4;
        // Extract pure district name: strip "Doordarshan Nagar", "Extension", "Phase" etc suffixes
        var distWord = mp.replace(/\s*(Doordarshan|Extension|Phase|Part|Ward|Block|Layout|Nagar\s*Road).*$/i,'').trim();
        if (isCityLike && distWord && distWord !== mp && distWord.split(' ').length <= 3) {
          // e.g. "Belgaum Doordarshan Nagar" → district = "Belgaum"
          if (!city || (city && roadKw.test(city))) city = distWord;
          // Don't add this to localParts — it's the city/district marker
        } else if (city && mp.toLowerCase().indexOf(city.toLowerCase()) !== -1 && mp !== city) {
          // This part repeats the city name with a suffix — it's a duplicate district marker, skip
        } else {
          localParts.push(mp);
        }
      }

      // Build s2 from localParts (road + locality) if Vision s2 is incomplete
      var freshS2 = localParts.join(', ');
      // Use freshS2 if it's longer/more complete than Vision-provided s2
      if (freshS2 && freshS2.length > s2.length) s2 = freshS2;

    } else if (!s1 && !s2 && bodyParts.length) {
      // ── Step 4: No Vision sub-fields at all — full heuristic split ──
      var houseIdx = -1, nextStart = 0;
      for (var bpi = 0; bpi < bodyParts.length; bpi++) {
        if (houseKw.test(bodyParts[bpi])) { houseIdx = bpi; break; }
      }
      if (houseIdx === -1) houseIdx = 0;

      // Absorb floor into s1
      s1 = bodyParts[houseIdx];
      nextStart = houseIdx + 1;
      if (nextStart < bodyParts.length && floorPat.test(bodyParts[nextStart].trim())) {
        s1 += ', ' + bodyParts[nextStart]; nextStart++;
      }

      // Everything else (until city/state/pin) → s2
      var remaining = bodyParts.slice(nextStart);
      var s2Acc = [], dedupe2 = {};
      remaining.forEach(function(p) {
        var key = p.toLowerCase().replace(/\s+/g,' ');
        if (dedupe2[key]) return; dedupe2[key] = true;
        // Strip city-suffix duplicates
        var dist2 = p.replace(/\s*(Doordarshan|Extension|Phase|Part|Ward|Block|Layout|Nagar\s*Road).*$/i,'').trim();
        if (!roadKw.test(p) && !localKw.test(p) && dist2 !== p) {
          if (!city || roadKw.test(city)) city = dist2;
        } else if (city && p.toLowerCase().indexOf(city.toLowerCase()) !== -1 && p !== city) {
          // duplicate city marker, skip
        } else {
          s2Acc.push(p);
        }
      });
      s2 = s2Acc.join(', ');
    }

    // ── City derivation: if still empty or road-like, find word before state ──
    var roadPattern2 = /\b(cross|main|road|marg|lane|nagar|vihar|colony|sector|chawl|wadi|galli|street|avenue)\b/i;
    if (rawAddr && (!city || roadPattern2.test(city)) && state) {
      var stPat2 = new RegExp('([A-Za-z][A-Za-z\\s]{2,25}),\\s*' + state.replace(/ /g,'\\s+') + '(?:\\s*[-–]?\\s*\\d{6})?', 'i');
      var stM2 = rawAddr.match(stPat2);
      if (stM2) {
        var cand = stM2[1].trim().replace(/\s*(Doordarshan|Nagar|Colony|Layout|Extension|Phase|Part|Ward|Block).*$/i,'').trim();
        if (cand && cand.split(' ').length <= 3 && !roadPattern2.test(cand)) city = cand;
      }
    }
  }

  // ── Populate KYC extracted-panel display fields ──
  kycSetField('kyc-out-street1',  s1);
  kycSetField('kyc-out-street2',  s2);
  kycSetField('kyc-out-city',     city);
  kycSetField('kyc-out-pin',      pin);
  kycSetField('kyc-out-state',    state);
  kycSetField('kyc-out-fulladdr', (d.address || d.full_address) || [s1, s2, city && 'Dist: '+city, state, pin].filter(Boolean).join(', '));

  // ── Auto-fill wizard address fields (current + permanent) ──
  if (aNum) kycAutoFill('w-aadhar', aNum);
  if (d.gender) kycSyncGender(d.gender);

  function fillAddr(curr, perm, val) {
    if (!val) return;
    kycAutoFill(curr, val);
    kycAutoFill(perm, val);
  }

  fillAddr('w-street1', 'w-pstreet1', s1);
  fillAddr('w-street2', 'w-pstreet2', s2);
  fillAddr('w-city',    'w-pcity',    city);
  fillAddr('w-zip',     'w-pzip',     pin);
  if (state) { kycFillState('w-state', state); kycFillState('w-pstate', state); }

  // Trigger kycSyncAddr so listener logic fires identically to manual input
  if (s1)    kycSyncAddr('street1', s1);
  if (s2)    kycSyncAddr('street2', s2);
  if (city)  kycSyncAddr('city',    city);
  if (pin)   kycSyncAddr('pin',     pin);
  if (state) kycSyncAddr('state',   state);

  var av = /^\d{12}$/.test(aNum);
  var ab = document.getElementById('kyc-aadhar-val-badge');
  if (ab) ab.innerHTML = av ? '<span class="kyc-badge-ok">\u2713 Valid Aadhaar</span>' : '<span class="kyc-badge-warn">\u26A0 Check Aadhaar</span>';
  KYC.validationLog.push({ icon:av?'\u2705':'\u26A0\uFE0F', label:'Aadhaar Number', value:fmt||'Not detected', status:av?'valid':'warn', detail:av?'12-digit valid':'Unconfirmed' });
  KYC.validationLog.push({ icon:'\uD83D\uDC64', label:'Name (Aadhaar)', value:d.full_name||'', status:'info', detail:'Name on Aadhaar' });
  if (d.gender) KYC.validationLog.push({ icon:'\u26A7\uFE0F', label:'Gender',   value:d.gender, status:'info', detail:'From Aadhaar' });
  if (city)     KYC.validationLog.push({ icon:'\uD83D\uDCCD', label:'City',     value:city,     status:'info', detail:'From address' });
  if (state)    KYC.validationLog.push({ icon:'\uD83D\uDDFA\uFE0F', label:'State', value:state, status:'info', detail:'From address' });
  if (pin)      KYC.validationLog.push({ icon:'\uD83D\uDCEE', label:'PIN Code', value:pin,      status:'info', detail:'From address' });
}

// ─────────────────────── CROSS-VALIDATE ───────────────────────
function kycCrossValidate(pan, aadhar) {
  var box=document.getElementById('kyc-cross-check'), title=document.getElementById('kyc-cross-title'), details=document.getElementById('kyc-cross-details');
  var checks=[], pass=0;
  var pn=(pan.full_name||'').toUpperCase().replace(/\s+/g,' ').trim();
  var an=(aadhar.full_name||'').toUpperCase().replace(/\s+/g,' ').trim();
  if (pn && an) {
    var ok = pn.split(' ').every(function(w){ return an.indexOf(w)!==-1; }) || an.split(' ').every(function(w){ return pn.indexOf(w)!==-1; });
    checks.push(ok ? '\u2705 Name matches PAN and Aadhaar' : '\u26A0\uFE0F Name difference \u2014 PAN: '+pn+' | Aadhaar: '+an);
    if (ok) pass++;
    KYC.validationLog.push({ icon:ok?'\u2705':'\u26A0\uFE0F', label:'Name Cross-Check', value:ok?'Match':'Mismatch', status:ok?'valid':'warn', detail:'PAN vs Aadhaar' });
  }
  var wp=(document.getElementById('w-pan')?.value||'').trim().toUpperCase();
  var ep=(pan.pan_number||'').replace(/\s/g,'').toUpperCase();
  if (wp && ep) {
    var panOk = (wp===ep);
    checks.push(panOk ? '\u2705 PAN matches Step 1 entry' : '\u26A0\uFE0F PAN mismatch \u2014 entered: '+wp+' | extracted: '+ep);
    if (panOk) pass++;
    KYC.validationLog.push({ icon:panOk?'\u2705':'\u26A0\uFE0F', label:'PAN vs Entry', value:panOk?ep:'Mismatch', status:panOk?'valid':'warn', detail:panOk?'Consistent':'Verify PAN' });
  }
  var allOk = checks.length > 0 && pass === checks.length;
  if (box) { box.style.display='block'; box.style.background=allOk?'rgba(26,115,64,.07)':'rgba(230,126,0,.07)'; box.style.border='1px solid '+(allOk?'rgba(26,115,64,.2)':'rgba(230,126,0,.25)'); }
  if (title) { title.textContent = allOk ? '\u2705 Cross-Validation Passed' : '\u26A0 Review Required'; title.style.color = allOk ? 'var(--success)' : 'var(--warn)'; }
  if (details) details.innerHTML = checks.join('<br>');
  var sum = document.getElementById('kyc-validation-summary');
  if (sum) { sum.textContent=allOk?'\u2713 All checks passed':pass+'/'+checks.length+' passed'; sum.style.background=allOk?'rgba(26,115,64,.12)':'rgba(230,126,0,.12)'; sum.style.color=allOk?'var(--success)':'var(--warn)'; }
}

// ─────────────────────── REPORT ───────────────────────
function kycBuildReport(pd, ad) {
  var ts=KYC.reportTs||new Date(), tsStr=ts.toLocaleString('en-IN'), id='EFIN-KYC-'+Date.now().toString(36).toUpperCase();
  var v=KYC.validationLog.filter(function(l){return l.status==='valid';}).length;
  var w=KYC.validationLog.filter(function(l){return l.status==='warn';}).length;
  var e=KYC.validationLog.filter(function(l){return l.status==='error';}).length;
  var h = '<div style="margin-bottom:12px;font-size:11.5px;color:var(--text3)">Generated: '+tsStr+' &nbsp;|&nbsp; Ref: '+id+'</div>';
  h += '<div style="display:flex;gap:16px;margin-bottom:16px;padding:12px;background:var(--surface2);border-radius:var(--r-sm)">'
    + '<div style="text-align:center"><div style="font-family:var(--font-head);font-size:22px;font-weight:800;color:var(--success)">'+v+'</div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px">Passed</div></div>'
    + '<div style="text-align:center"><div style="font-family:var(--font-head);font-size:22px;font-weight:800;color:var(--warn)">'+w+'</div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px">Warnings</div></div>'
    + '<div style="text-align:center"><div style="font-family:var(--font-head);font-size:22px;font-weight:800;color:var(--danger)">'+e+'</div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px">Errors</div></div>'
    + '<div style="text-align:center"><div style="font-family:var(--font-head);font-size:22px;font-weight:800;color:var(--text)">'+(v+w+e)+'</div><div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:1px">Total</div></div></div>';
  h += '<div style="margin-bottom:8px">';
  h += kycRRow('\uD83C\uDD94','PAN Card Upload',   KYC.pan.file    ? KYC.pan.file.name    : 'Not uploaded', KYC.pan.file    ? 'valid' : 'warn');
  h += kycRRow('\uD83C\uDD94','Aadhaar Upload',    KYC.aadhar.file ? KYC.aadhar.file.name : 'Not uploaded', KYC.aadhar.file ? 'valid' : 'warn');
  KYC.validationLog.forEach(function(l){ h += kycRRow(l.icon, l.label, l.value+(l.detail?' \u2014 '+l.detail:''), l.status); });
  h += '</div>';
  var filled = [];
  if (pd && pd.full_name)         filled.push('First/Middle/Last Name', 'DOB');
  if (ad && ad.aadhaar_number)    filled.push('Aadhaar No.');
  if (ad && (ad.city || ad.address || ad.full_address)) filled.push('Current & Permanent Address');
  h += '<div style="margin-top:12px;padding:10px 14px;background:rgba(26,79,163,.05);border-radius:8px;font-size:12px;color:var(--text3)">\uD83D\uDCCC Auto-filled: '+(filled.length ? filled.join(', ') : 'None')+'</div>';
  window._kycReportText = [
    'EFIN KYC Report | Ref: '+id, 'Generated: '+tsStr, '---',
    'PAN    : '+(pd?pd.pan_number||'\u2014':'\u2014'),
    'Name   : '+(pd?pd.full_name ||'\u2014':'\u2014'),
    'DOB    : '+(pd?pd.date_of_birth||'\u2014':'\u2014'),
    '---',
    'Aadhaar: '+(ad?ad.aadhaar_number||'\u2014':'\u2014'),
    'Name   : '+(ad?ad.full_name||'\u2014':'\u2014'),
    'Address: '+(ad?(ad.address||ad.full_address)||'\u2014':'\u2014'),
    'City   : '+(ad?ad.city||'\u2014':'\u2014'),
    'State  : '+(ad?ad.state||'\u2014':'\u2014'),
    'PIN    : '+(ad?ad.pin_code||'\u2014':'\u2014'),
    '---', 'Passed: '+v+' | Warnings: '+w+' | Errors: '+e
  ].join('\n');
  var rb = document.getElementById('kyc-report-body');
  if (rb) rb.innerHTML = h;
}
function kycRRow(icon,label,value,status) {
  var c={valid:'var(--success)',warn:'var(--warn)',error:'var(--danger)',info:'var(--accent)'};
  var sym={valid:'\u2713',warn:'\u26A0',error:'\u2717',info:'\u2022'};
  return '<div class="kyc-report-row"><span class="kyc-report-icon">'+icon+'</span><span class="kyc-report-label">'+label+'</span><span class="kyc-report-value">'+(value||'\u2014')+'</span><span class="kyc-report-status" style="color:'+(c[status]||'var(--text3)')+'">'+sym[status]+'</span></div>';
}
function kycDownloadReport() {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([window._kycReportText||'No report yet.'],{type:'text/plain'}));
  a.download = 'KYC_Report_'+new Date().toISOString().slice(0,10)+'.txt';
  a.click();
  showToast('KYC report downloaded','success');
}

// ─────────────────────── TRACKING ───────────────────────
// ─────────── FIELD SOURCE TRACKING (auto-extracted vs manually entered) ───────────
// Records, per field, whether the value came from AI auto-extraction or a manual user
// edit, so the Fix indicator and the application timeline can show provenance clearly.
window._kycFieldSources = window._kycFieldSources || {};   // field id  -> 'auto' | 'manual'
window._kycManualEdits  = window._kycManualEdits  || {};   // field label -> timestamp string

function _kycTimeStamp(){
  var now=new Date();
  return now.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})+' '+now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
}

// Readable label for a field, derived from its <label> (Fix button / badges stripped out).
function _kycFieldLabel(el){
  try {
    var grp = el.closest('.form-group');
    var lab = grp ? grp.querySelector('label') : null;
    if (lab){
      var clone = lab.cloneNode(true);
      var kids = clone.querySelectorAll('button, span');
      for (var i=0;i<kids.length;i++) kids[i].remove();
      var txt = (clone.textContent||'').replace(/\s+/g,' ').trim();
      if (txt) return txt;
    }
  } catch(e){}
  return (el && el.id) ? el.id.replace('kyc-out-','') : 'Field';
}

// The "Fix" button that belongs to a field (may be null for fields that show a validity badge).
function _kycFixBtnFor(el){
  var grp = el ? el.closest('.form-group') : null;
  return grp ? grp.querySelector('.kyc-fix-btn') : null;
}

// Tag a field (and its Fix button) as AUTO-EXTRACTED by the system.
function _kycMarkAuto(el){
  if(!el) return;
  el.classList.add('kyc-field-autofilled');
  el.classList.remove('kyc-field-fixed');
  window._kycFieldSources[el.id] = 'auto';
  // A re-extraction supersedes any earlier manual edit on this field.
  var lbl = _kycFieldLabel(el);
  if (window._kycManualEdits && window._kycManualEdits[lbl]) delete window._kycManualEdits[lbl];
  var btn = _kycFixBtnFor(el);
  if(btn){
    btn.classList.add('kyc-fix-auto'); btn.classList.remove('kyc-fix-manual');
    btn.innerHTML = '\u2713 Auto';
    btn.title = 'Auto-extracted by system — click to edit';
  }
}

// Build / refresh the single "Manual Correction" timeline entry from recorded edits.
function _kycSyncManualTimelineEntry(){
  if(!window._kycTrackingEntries) window._kycTrackingEntries = [];
  var arr = window._kycTrackingEntries;
  var idx = -1;
  for (var i=0;i<arr.length;i++){ if(arr[i] && arr[i].name==='EFIN-KYC Manual Correction'){ idx=i; break; } }
  var labels = Object.keys(window._kycManualEdits||{});
  if(!labels.length){ if(idx>=0) arr.splice(idx,1); return; }   // nothing manual → ensure entry is gone
  var sess = {}; try { sess = JSON.parse(localStorage.getItem('efin_session')||'{}'); } catch(e){}
  var who = sess.name || 'User';
  var sections = Object.keys(window._kycManualSections||{});
  var sectionLabel = sections.length ? sections.join(' + ') : 'KYC';
  var entry = {
    name:'EFIN-KYC Manual Correction', current_stage:'KYC_VERIFY', current_user: who,
    status:'COMPLETE', source:'manual',
    comment:'Manual',
    sub_note: sectionLabel,
    date:_kycTimeStamp()
  };
  if(idx>=0) arr[idx]=entry; else arr.push(entry);
}

function kycUpdateTrackingRecord(pd, ad) {
  var ds = _kycTimeStamp();
  window._kycTrackingEntries = [
    { name:'EFIN-KYC PAN Validation',     current_stage:'KYC_VERIFY', current_user:'System (AI Vision)', status:pd&&pd.pan_number?'COMPLETE':'Partial', source:'auto', comment:pd?'Auto-extracted \u2014 PAN: '+(pd.pan_number||'read from card'):'Not uploaded',         sub_note:'Auto-filled from PAN',          date:ds },
    { name:'EFIN-KYC Aadhaar Validation', current_stage:'KYC_VERIFY', current_user:'System (AI Vision)', status:ad&&ad.aadhaar_number?'COMPLETE':'Partial', source:'auto', comment:ad?'Auto-extracted \u2014 Aadhaar: '+(ad.aadhaar_number||'read from card'):'Not uploaded', sub_note:'Auto-filled from Aadhaar', date:ds }
  ];
  // Preserve a manual-correction entry for any field the user has already edited
  // (e.g. fields the AI could not read and the user filled in by hand).
  _kycSyncManualTimelineEntry();
}

// ─────────────────────── FIELD SYNC HELPERS ───────────────────────
function kycSyncField(f,v){ var m={fname:'w-fname',mname:'w-mname',lname:'w-lname',aadhar:'w-aadhar'}; var el=document.getElementById(m[f]); if(el){el.value=v;el.classList.add('kyc-field-autofilled');} }
function kycSyncAddr(p,v){ var m={street1:['w-street1','w-pstreet1'],street2:['w-street2','w-pstreet2'],city:['w-city','w-pcity'],pin:['w-zip','w-pzip'],state:['w-state','w-pstate']}; (m[p]||[]).forEach(function(id){var el=document.getElementById(id);if(!el)return;if(el.tagName==='SELECT')kycFillState(id,v);else{el.value=v;el.classList.add('kyc-field-autofilled');}});}
function kycSyncDob(val){ var el=document.getElementById('w-dob'); if(!el||!val)return; var p=val.split(/[\/\-]/); if(p.length===3){var dd,mm,yyyy; if(p[2].length===4){dd=p[0];mm=p[1];yyyy=p[2];}else if(p[0].length===4){yyyy=p[0];mm=p[1];dd=p[2];}else return; el.value=yyyy+'-'+mm.padStart(2,'0')+'-'+dd.padStart(2,'0'); el.classList.add('kyc-field-autofilled'); var d2=document.getElementById('kyc-out-dob'); if(d2)d2.value=val; } else if(p.length===1 && /^\d{4}$/.test(val.trim())){ /* year-only from physical Aadhaar */ var d2=document.getElementById('kyc-out-dob'); if(d2){d2.value=val;d2.classList.add('kyc-field-autofilled');} } }
function kycSyncGender(v){ var el=document.getElementById('w-gender'); if(!el)return; var u=v.toUpperCase(); el.value=u.charAt(0)==='M'?'M':u.charAt(0)==='F'?'F':'other'; el.classList.add('kyc-field-autofilled'); }
function kycFillState(sid,sn){ var el=document.getElementById(sid); if(!el||!sn)return; var m=null; for(var i=0;i<el.options.length;i++){if(el.options[i].text.toLowerCase()===sn.toLowerCase()){m=el.options[i];break;}} if(m){el.value=m.value;}else{var o=document.createElement('option');o.value=sn;o.text=sn;el.appendChild(o);el.value=sn;} el.classList.add('kyc-field-autofilled'); if(sid==='w-state'){var wv=document.getElementById('wsdd-state-val');if(wv){wv.textContent=(el.options[el.selectedIndex]?el.options[el.selectedIndex].text:sn);wv.classList.remove('placeholder');}}else if(typeof wsddSetValue==='function'){wsddSetValue(sid.replace('w-','wsdd-'),el.value);} }
function kycAutoFill(id,v){ var el=document.getElementById(id); if(el&&v){el.value=v;el.classList.add('kyc-field-autofilled','kyc-autofill-pulse');setTimeout(function(){el.classList.remove('kyc-autofill-pulse');},1200); setTimeout(kycUpdateReadinessChecklist, 150);} }
function kycSetField(id,v){ var el=document.getElementById(id); if(!el)return; el.value=v; if(v) _kycMarkAuto(el); }

// ── Inline correction helpers ──
function kycFocusField(id){
  var el=document.getElementById(id);
  if(!el)return;
  el.focus();
  el.select();
  el.style.borderColor='var(--accent)';
  el.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function kycMarkFixed(el){
  el.classList.add('kyc-field-fixed');
  el.classList.remove('kyc-field-autofilled');
  window._kycFieldSources[el.id] = 'manual';
  var btn = _kycFixBtnFor(el);
  if(btn){
    btn.classList.add('kyc-fix-manual'); btn.classList.remove('kyc-fix-auto');
    btn.innerHTML = '\u270E Manual';
    btn.title = 'Manually entered \u2014 click to edit again';
  }
  // Record this field for the application timeline as a manual entry.
  window._kycManualEdits[_kycFieldLabel(el)] = _kycTimeStamp();
  window._kycManualSections = window._kycManualSections || {};
  window._kycManualSections[(el.id||'').toLowerCase().indexOf('pan') !== -1 ? 'PAN' : 'Aadhaar'] = true;
  _kycSyncManualTimelineEntry();
  setTimeout(kycUpdateReadinessChecklist, 100);
}

// ── Inline PAN format validation ──
function kycValidatePanInline(el){
  var v=(el.value||'').replace(/\s/g,'').toUpperCase();
  el.value=v;
  var badge=document.getElementById('kyc-pan-fmt-badge');
  var valid=/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v);
  if(badge){badge.style.display=valid?'inline':'none';}
  if(valid){ el.style.borderColor='var(--success)'; kycAutoFill('w-pan',v); }
  else { el.style.borderColor=''; }
}

// ── Inline Aadhaar format validation ──
function kycValidateAadhaarInline(el){
  var v=(el.value||'').replace(/\s/g,'');
  var badge=document.getElementById('kyc-aadhar-fmt-badge');
  var valid=/^\d{12}$/.test(v);
  if(badge){badge.style.display=valid?'inline':'none';}
  if(valid){ el.style.borderColor='var(--success)'; kycAutoFill('w-aadhar',v); }
  else { el.style.borderColor=''; }
}

// ─────────────────────── HOOKS ───────────────────────
(function(){
  var orig = window.submitWizard;
  if (typeof orig !== 'function') return;
  window.submitWizard = function() {
    orig.apply(this, arguments);
    if (window._kycTrackingEntries && window.APPLICATIONS && APPLICATIONS.length) {
      var app = APPLICATIONS[0];
      if (app && app.tracking) {
        window._kycTrackingEntries.forEach(function(e){ app.tracking.splice(1,0,e); });
      }
    }
  };
})();

(function(){
  var orig = window.showPage;
  if (typeof orig !== 'function') return;
  window.showPage = function(pageId, navEl) {
    orig.apply(this, arguments);
    if (pageId === 'new-application') {
      KYC.pan    = { file:null, dataUrl:null, mediaType:null, isPdf:false, data:null };
      KYC.aadhar = { file:null, dataUrl:null, mediaType:null, isPdf:false, data:null };
      KYC.aadharBack = { file:null, dataUrl:null, mediaType:null, isPdf:false };
      KYC.validationLog = [];
      // Reset auto-vs-manual field-source tracking for the new application
      window._kycFieldSources = {};
      window._kycManualEdits  = {};
      window._kycManualSections = {};
      window._kycTrackingEntries = null;
      ['pan','aadhar'].forEach(function(t) {
        var ids = ['kyc-'+t+'-badge','kyc-'+t+'-status'];
        ids.forEach(function(id){ var el=document.getElementById(id); if(el)el.innerHTML=''; });
        var prev=document.getElementById('kyc-'+t+'-preview'); if(prev){prev.style.display='none';}
        var pi=document.getElementById('kyc-'+t+'-pdf-info'); if(pi){pi.style.display='none';pi.textContent='';}
        var card=document.getElementById('kyc-'+t+'-card'); if(card){card.classList.remove('card-uploaded');card.style.borderColor='';card.style.borderStyle='';card.style.background='';}
        var bt=document.getElementById('kyc-'+t+'-btn-text'); if(bt)bt.textContent='Upload '+(t==='pan'?'PAN Card':'Front Side');
        var fi=document.getElementById('kyc-'+t+'-file'); if(fi)fi.value='';
      });
      // Reset back-side UI
      var bprev=document.getElementById('kyc-aadhar-back-preview'); if(bprev)bprev.style.display='none';
      var bpi=document.getElementById('kyc-aadhar-back-pdf-info'); if(bpi){bpi.style.display='none';bpi.textContent='';}
      var bbt=document.getElementById('kyc-aadhar-back-btn-text'); if(bbt)bbt.textContent='Upload Back Side';
      var bst=document.getElementById('kyc-aadhar-back-status'); if(bst)bst.innerHTML='';
      var bfi=document.getElementById('kyc-aadhar-back-file'); if(bfi)bfi.value='';
      var ep=document.getElementById('kyc-extracted-panel'); if(ep)ep.style.display='none';
      var btn=document.getElementById('kyc-extract-btn'); if(btn){btn.disabled=true;btn.innerHTML='<span id="kyc-extract-icon">&#x2736;</span> Extract &amp; Auto-Fill Details';}
      // Check if KYC AI Vision API key is configured — show/hide banner
      (function() {
        try {
          fetch('/api/kyc/vision/status').then(function(r){ return r.json(); }).then(function(d){
            var banner = document.getElementById('kyc-api-status-banner');
            if (!banner) return;
            var configured = d && d.configured;
            banner.style.display = configured ? 'none' : '';
            var hint = document.getElementById('kyc-hint-text');
            if (hint) hint.textContent = configured
              ? 'AI-powered Vision \u2022 Works with images & PDFs'
              : 'Basic OCR mode \u2022 Configure AI Vision in Settings for best results';
          }).catch(function(){});
        } catch(e) {}
      })();
    }
  };
})();

// ── Auto-exposed globals for HTML onclick handlers ──
window.kycDownloadReport = kycDownloadReport;
window.kycExtractAll = kycExtractAll;
window.kycFocusField = kycFocusField;


// ── KYC upload globals ──
window.kycHandleUpload = kycHandleUpload;
window.kycHandleUploadBack = kycHandleUploadBack;


// ── Additional globals ──
window.kycMarkFixed = kycMarkFixed;
window.kycSyncAddr = kycSyncAddr;
window.kycSyncDob = kycSyncDob;
window.kycSyncField = kycSyncField;
window.kycSyncGender = kycSyncGender;
window.kycValidateAadhaarInline = kycValidateAadhaarInline;
window.kycValidatePanInline = kycValidatePanInline;
