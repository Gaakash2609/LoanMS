/* Numbers-only text fields for the legacy pages.
   The old markup used <input type="number">, which draws the up/down stepper
   arrows. Those inputs are now <input type="text" inputmode="decimal" data-numeric>
   (numeric keypad on phones, no stepper) and this file keeps them numeric: only
   digits, one decimal point and an optional leading minus get through.

   Runs in the capture phase on the document, so the value is already cleaned by
   the time a field's own oninput="..." handler reads this.value. Works for inputs
   the app renders later too, because it listens on the document, not the field. */
(function () {
  'use strict';

  function sanitize(raw, allowNegative) {
    var s = String(raw).replace(/[^\d.-]/g, '');
    var negative = allowNegative && s.charAt(0) === '-';
    s = s.replace(/-/g, '');
    var dot = s.indexOf('.');
    if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
    return (negative ? '-' : '') + s;
  }

  document.addEventListener('input', function (e) {
    var el = e.target;
    if (!el || el.nodeType !== 1 || !el.hasAttribute || !el.hasAttribute('data-numeric')) return;
    var min = el.getAttribute('min');
    var allowNegative = min === null || min === '' || Number(min) < 0;
    var clean = sanitize(el.value, allowNegative);
    if (clean === el.value) return;
    var caret = el.selectionStart;
    el.value = clean;
    if (caret !== null && el.setSelectionRange) {
      var pos = sanitize(String(el.value).slice(0, caret), allowNegative).length;
      try { el.setSelectionRange(pos, pos); } catch (err) { /* not selectable */ }
    }
  }, true);
})();
