// ═══════════════════════════════════════════════════════════════════
//  DOCUMENT PASSWORD PROMPT ENGINE
//  Shared utility — used by wizard doc upload (Step 8), KYC upload
//  (Step 2), and custom doc upload for any password-protected PDFs.
//
//  Usage:
//    _docPasswordPrompt(file, fileName, onSuccess, onSkip)
//      file      — File object
//      fileName  — display name for the prompt
//      onSuccess(password, bytes) — called after correct password
//      onSkip()  — called when user clicks "Skip for now"
//
//  Passwords are stored in window._DOC_PASSWORDS[itemId] and also
//  in _BFP_STORE[itemId].password when a doc-item id is provided.
// ═══════════════════════════════════════════════════════════════════
(function() {
  if (!window._DOC_PASSWORDS) window._DOC_PASSWORDS = {};

  let _pwCallback   = null;  // { onSuccess, onSkip, bytes }
  let _pwVisible    = false;

  // ── Check if a PDF is password-protected (fast, no full parse) ──
  window._docIsPdfPasswordProtected = async function(file) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return false;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await pdfjsLib.getDocument({ data: bytes.slice() }).promise;   // .slice() preserves bytes
      return { protected: false, bytes };
    } catch (e) {
      if (e.name === 'PasswordException' || String(e.message).toLowerCase().includes('password')) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        return { protected: true, bytes };
      }
      return { protected: false, bytes: null };
    }
  };

  // ── Show the shared password prompt modal ──
  window._docPasswordPrompt = function(file, fileName, onSuccess, onSkip) {
    const overlay = document.getElementById('doc-pw-overlay');
    const input   = document.getElementById('doc-pw-input');
    const errDiv  = document.getElementById('doc-pw-error');
    const fnEl    = document.getElementById('doc-pw-filename');
    if (!overlay || !input) { if (onSkip) onSkip(); return; }

    // Read bytes upfront
    file.arrayBuffer().then(function(buf) {
      const bytes = new Uint8Array(buf);
      _pwCallback = { onSuccess, onSkip, bytes, fileName };
      _pwVisible  = false;

      // Populate UI
      if (fnEl) fnEl.textContent = '\u201C' + fileName + '\u201D — Enter the password to unlock and process this document.';
      input.value       = '';
      input.type        = 'password';
      errDiv.style.display = 'none';
      const toggleBtn   = document.getElementById('doc-pw-toggle');
      if (toggleBtn) toggleBtn.textContent = '👁';

      overlay.style.display = 'flex';
      requestAnimationFrame(() => { requestAnimationFrame(() => { input.focus(); }); });
    });
  };

  // ── Toggle password visibility ──
  window._docPwToggleVisible = function() {
    _pwVisible = !_pwVisible;
    const input = document.getElementById('doc-pw-input');
    const btn   = document.getElementById('doc-pw-toggle');
    if (input) input.type = _pwVisible ? 'text' : 'password';
    if (btn)   btn.textContent = _pwVisible ? '🙈' : '👁';
  };

  // ── Submit password attempt ──
  window._docPwSubmit = async function() {
    if (!_pwCallback) return;
    const input    = document.getElementById('doc-pw-input');
    const errDiv   = document.getElementById('doc-pw-error');
    const errText  = document.getElementById('doc-pw-error-text');
    const submitBtn = document.getElementById('doc-pw-submit-btn');
    const pw       = input ? input.value : '';
    if (!pw.trim()) {
      if (errText) errText.textContent = 'Please enter the password.';
      if (errDiv)  errDiv.style.display = 'flex';
      input.focus();
      return;
    }

    // Disable button during attempt
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '⏳ Verifying…'; }

    try {
      // Try to open the PDF with the supplied password (.slice() preserves the stored buffer for retries)
      const doc = await pdfjsLib.getDocument({ data: _pwCallback.bytes.slice(), password: pw }).promise;
      // Success — close modal and fire callback
      _docPwClose();
      // Store password globally keyed by filename for this session
      window._DOC_PASSWORDS[_pwCallback.fileName] = pw;
      if (_pwCallback.onSuccess) _pwCallback.onSuccess(pw, _pwCallback.bytes, doc);
    } catch(e) {
      const isWrongPw = e.name === 'PasswordException' ||
                        String(e.message).toLowerCase().includes('password') ||
                        String(e.message).toLowerCase().includes('incorrect');
      if (errText) errText.textContent = isWrongPw
        ? 'Incorrect password — please try again.'
        : 'Could not open this PDF (' + e.message + '). Try a different password.';
      if (errDiv)  errDiv.style.display = 'flex';
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '🔓 Unlock & Process'; }
      input.select();
    }
  };

  // ── Cancel / Skip ──
  window._docPwCancel = function() {
    const cb = _pwCallback;
    _docPwClose();
    if (cb && cb.onSkip) cb.onSkip();
  };

  function _docPwClose() {
    const overlay = document.getElementById('doc-pw-overlay');
    const submitBtn = document.getElementById('doc-pw-submit-btn');
    if (overlay) overlay.style.display = 'none';
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '🔓 Unlock & Process'; }
    _pwCallback = null;
  }

  // Close on backdrop click
  document.getElementById('doc-pw-overlay').addEventListener('click', function(e) {
    if (e.target === this) _docPwCancel();
  });

})();