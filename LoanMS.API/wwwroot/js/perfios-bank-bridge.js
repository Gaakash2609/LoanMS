(function () {
  'use strict';

  // ── Open Perfios v9 popup ─────────────────────────────────────────
  window.pfv9Open = function (docItemId, docName) {
    var overlay = document.getElementById('pfv9-overlay');
    var frame   = document.getElementById('pfv9-frame');
    if (!overlay || !frame) return;
    // Store context so pfv9ConfirmAttachment can mark the right banking doc-item.
    window._pfv9DocItemId = docItemId || '';
    window._pfv9DocName   = docName   || 'Bank Statement';
    frame.src = '/perfios/index.html?t=' + Date.now();
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  };

  // ── Close popup ───────────────────────────────────────────────────
  window.pfv9Close = function () {
    var overlay = document.getElementById('pfv9-overlay');
    var frame   = document.getElementById('pfv9-frame');
    if (overlay) overlay.classList.remove('open');
    if (frame)   frame.src = '';
    document.body.style.overflow = '';
  };

  // ── Close on backdrop click ───────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    var ov = document.getElementById('pfv9-overlay');
    if (ov) ov.addEventListener('click', function (e) {
      if (e.target === ov) window.pfv9Close();
    });
  });

}());
