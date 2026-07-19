/* pfv9-modal.js — Bank Statement Modal (pfv9Open/pfv9Close)
 * Load order: EARLY — before efin-app.js, app-core.js, perfios-bank-bridge.js
 * Called by: HTML onclicks, efin-app.js, app-core.js, perfios-bank-bridge.js
 */
    // Perfios v9 Bank Statement Modal — defined early so always available
    // Track current session context
    window._pfv9DocItemId = '';
    window._pfv9DocName   = '';

    function pfv9Open(docItemId, docName) {
      var ov = document.getElementById('pfv9-overlay');
      var fr = document.getElementById('pfv9-frame');
      if (!ov || !fr) { console.warn('[pfv9] overlay not found'); return; }
      // Store context for use when PERFIOS_COMPLETE fires
      window._pfv9DocItemId = docItemId || '';
      window._pfv9DocName   = docName   || 'Bank Statement';
      fr.src = '/perfios/index.html?t=' + Date.now();
      ov.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
    function pfv9Close() {
      var ov = document.getElementById('pfv9-overlay');
      var fr = document.getElementById('pfv9-frame');
      if (ov) ov.classList.remove('open');
      if (fr) fr.src = '';
      document.body.style.overflow = '';
      // Don't clear _pfv9DocItemId here — pfv9ConfirmAttachment may fire after close
    }
