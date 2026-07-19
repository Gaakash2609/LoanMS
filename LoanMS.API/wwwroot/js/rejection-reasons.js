// ════════════════════════════════════════════════════════════════════════
//  REJECTION REASONS — Policy & Product page
//  Collapsible card with Add / Edit / Delete / Reorder functionality.
//  Syncs live with the Reject Application modal select dropdown.
//  Uses MutationObserver (same as product-offer-matrix.js) — no showPage dependency.
// ════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';
// ── Safe localStorage helpers (private to this module) ──
var _lsGet = function(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } };
var _lsSet = function(k,v){ try{ localStorage.setItem(k,v); }catch(e){} };
var _lsRemove = function(k){ try{ localStorage.removeItem(k); }catch(e){} };
;

  // ── Default reasons ───────────────────────────────────────────────────
  var LS_KEY = '_pp_rejection_reasons';
  var DEFAULTS = [
    { id: 'address',     label: 'Address Not Found' },
    { id: 'afford',      label: 'Affordability norms not met' },
    { id: 'age',         label: 'Age norms not met' },
    { id: 'application', label: 'Applicant is director of employer company' },
    { id: 'pf',          label: 'Applicant not found on PF site' },
  ];

  // ── In-memory store ───────────────────────────────────────────────────
  if (!window._PP_REASONS) {
    var _saved = null;
    try { _saved = JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) {}
    window._PP_REASONS = (_saved && _saved.length) ? _saved : DEFAULTS.map(function (r) { return { id: r.id, label: r.label }; });
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  function _e(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function _toast(msg, type) { if (typeof showToast === 'function') showToast(msg, type || 'success'); }

  // ── Persist + sync modal select ───────────────────────────────────────
  function _save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(window._PP_REASONS)); } catch (e) {}
    _syncSelect();
  }

  function _syncSelect() {
    var sel = document.getElementById('reject-reason-select');
    var optWrap = document.getElementById('reject-dd-options');
    if (!optWrap) return;
    optWrap.innerHTML = window._PP_REASONS.map(function(r) {
      return '<div class="reject-dd-opt" data-id="' + _e(r.id) + '" onclick="selectRejectDD(\'' + _e(r.id) + '\',\'' + _e(r.label).replace(/'/g,"&#39;") + '\')" style="padding:9px 14px;font-size:13px;cursor:pointer;transition:background .1s;border-bottom:1px solid rgba(0,0,0,.04)">' + _e(r.label) + '</div>';
    }).join('');
    // Add hover effect via CSS
    optWrap.querySelectorAll('.reject-dd-opt').forEach(function(el) {
      el.onmouseenter = function() { this.style.background = 'var(--surface2)'; };
      el.onmouseleave = function() { this.style.background = ''; };
    });
  }
  window._ppSyncSelect = _syncSelect;

  // ── Searchable dropdown functions ──
  window.toggleRejectDD = function() {
    var list  = document.getElementById('reject-dd-list');
    var arrow = document.getElementById('reject-dd-arrow');
    var trigger = document.getElementById('reject-dd-trigger');
    if (!list) return;
    var open = list.style.display !== 'none' && list.style.display !== '';
    list.style.display = open ? 'none' : 'block';
    if (arrow)   arrow.style.transform   = open ? 'rotate(0deg)' : 'rotate(180deg)';
    if (trigger) trigger.style.borderColor = open ? 'var(--border2)' : 'var(--accent)';
    if (!open) {
      var inp = document.getElementById('reject-dd-search');
      if (inp) { inp.value = ''; window.filterRejectDD(''); inp.focus(); }
    }
  };
  window.selectRejectDD = function(id, label) {
    var sel    = document.getElementById('reject-reason-select');
    var lbl    = document.getElementById('reject-dd-label');
    var list   = document.getElementById('reject-dd-list');
    var arrow  = document.getElementById('reject-dd-arrow');
    var trigger= document.getElementById('reject-dd-trigger');
    if (sel) sel.value = id;
    if (lbl) { lbl.textContent = label; lbl.style.color = 'var(--text)'; }
    if (list)    list.style.display = 'none';
    if (arrow)   arrow.style.transform = 'rotate(0deg)';
    if (trigger) trigger.style.borderColor = 'var(--accent)';
  };
  window.filterRejectDD = function(q) {
    var opts = document.querySelectorAll('#reject-dd-options .reject-dd-opt');
    var lower = (q || '').toLowerCase();
    opts.forEach(function(el) {
      el.style.display = !lower || el.textContent.toLowerCase().indexOf(lower) !== -1 ? '' : 'none';
    });
  };
  // Close dropdown on outside click
  document.addEventListener('click', function(e) {
    var dd = document.getElementById('reject-reason-dropdown');
    var list = document.getElementById('reject-dd-list');
    if (dd && list && !dd.contains(e.target)) list.style.display = 'none';
  });

  // ── Admin guard ───────────────────────────────────────────────────────
  function _guard() {
    if (typeof currentUser === 'undefined' ||
        (currentUser.role !== 'admin' && currentUser.role !== 'product_team')) {
      _toast('Only admins can manage rejection reasons', 'error');
      return false;
    }
    return true;
  }

  // ── Toggle card open/close ────────────────────────────────────────────
  window.ppToggleRejectionCard = function () {
    var body  = document.getElementById('pp-reject-body');
    var chev  = document.getElementById('pp-reject-chevron');
    if (!body) return;
    var open  = body.style.display !== 'none';
    body.style.display = open ? 'none' : '';
    if (chev) chev.style.transform = open ? '' : 'rotate(180deg)';
    if (!open) ppRenderRejectionContent();
  };

  // ── Render full card content ──────────────────────────────────────────
  window.ppRenderRejectionContent = function () {
    var ct = document.getElementById('pp-reject-content');
    if (!ct) return;

    var q = (document.getElementById('pp-rr-search') || {}).value || '';
    q = q.toLowerCase().trim();

    var list = window._PP_REASONS;
    var filtered = list.filter(function (r) {
      return !q || r.label.toLowerCase().indexOf(q) !== -1 || r.id.toLowerCase().indexOf(q) !== -1;
    });

    // Toolbar
    var toolbar = '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:16px">'
      + '<div style="position:relative;flex:1;min-width:180px;max-width:340px">'
      +   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);width:14px;height:14px;color:var(--text3)"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
      +   '<input id="pp-rr-search" type="text" value="' + _e(q) + '" placeholder="Search reasons..." oninput="ppRenderRejectionContent()"'
      +   ' style="width:100%;padding:8px 12px 8px 32px;border:1.5px solid var(--border2);border-radius:9px;font-size:13px;background:var(--surface2);color:var(--text);outline:none;box-sizing:border-box">'
      + '</div>'
      + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
      +   '<span style="font-size:11.5px;font-weight:700;color:var(--text3)">'
      +     list.length + ' reason' + (list.length !== 1 ? 's' : '') + (q ? ' (' + filtered.length + ' matching)' : '')
      +   '</span>'
      +   '<button onclick="rrExportCSV()" title="Export reasons as CSV" style="display:flex;align-items:center;gap:5px;padding:7px 12px;background:var(--surface);border:1.5px solid var(--border2);border-radius:9px;font-size:12px;font-weight:700;color:var(--text2);cursor:pointer">'
      +     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'
      +     ' Export CSV'
      +   '</button>'
      +   '<label title="Import reasons from CSV" style="display:flex;align-items:center;gap:5px;padding:7px 12px;background:var(--surface);border:1.5px solid var(--border2);border-radius:9px;font-size:12px;font-weight:700;color:var(--text2);cursor:pointer">'
      +     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>'
      +     ' Import CSV'
      +     '<input type="file" accept=".csv" onchange="rrImportCSV(this)" style="display:none">'
      +   '</label>'
      +   '<button onclick="ppOpenAddReason()" style="display:flex;align-items:center;gap:6px;padding:8px 14px;background:var(--accent);border:none;border-radius:9px;font-size:12.5px;font-weight:700;color:#fff;cursor:pointer;transition:opacity .15s" onmouseover="this.style.opacity=.85" onmouseout="this.style.opacity=1">'
      +     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:13px;height:13px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>'
      +     'Add Reason'
      +   '</button>'
      + '</div></div>';

    // List rows
    var rows = '';
    if (!filtered.length) {
      rows = '<div style="text-align:center;padding:36px 20px;color:var(--text3)">'
        + '<div style="font-size:30px;margin-bottom:8px">🗂️</div>'
        + '<div style="font-size:13.5px;font-weight:600;color:var(--text2);margin-bottom:4px">No reasons found</div>'
        + '<div style="font-size:12px">Add a rejection reason using the button above.</div>'
        + '</div>';
    } else {
      rows = '<div style="display:flex;flex-direction:column;gap:8px">';
      filtered.forEach(function (r) {
        var gi = list.indexOf(r);
        rows += '<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--surface2);border:1.5px solid var(--border);border-radius:10px;transition:border-color .15s" id="pp-rr-row-' + _e(r.id) + '" onmouseover="this.style.borderColor=\'var(--accent)\'" onmouseout="this.style.borderColor=\'var(--border)\'">'
          // Reorder buttons
          + '<div style="display:flex;flex-direction:column;align-items:center;gap:3px">'
          +   '<button onclick="ppMoveReason(' + gi + ',-1)" title="Move up" style="width:22px;height:22px;border:1px solid var(--border2);border-radius:5px;background:var(--surface);cursor:pointer;font-size:10px;color:var(--text3);line-height:1;padding:0;' + (gi===0?'opacity:.3;pointer-events:none':'') + '">▲</button>'
          +   '<button onclick="ppMoveReason(' + gi + ',1)" title="Move down" style="width:22px;height:22px;border:1px solid var(--border2);border-radius:5px;background:var(--surface);cursor:pointer;font-size:10px;color:var(--text3);line-height:1;padding:0;' + (gi===list.length-1?'opacity:.3;pointer-events:none':'') + '">▼</button>'
          + '</div>'
          // Info
          + '<div style="flex:1;min-width:0">'
          +   '<div style="font-size:13.5px;font-weight:700;color:var(--text);line-height:1.3">' + _e(r.label) + '</div>'
          +   '<div style="font-size:11px;color:var(--text3);font-family:var(--font-mono,monospace);margin-top:2px">' + _e(r.id) + '</div>'
          + '</div>'
          // Actions
          + '<div style="display:flex;gap:7px;flex-shrink:0">'
          +   '<button onclick="ppOpenEditReason(\'' + _e(r.id) + '\')" style="padding:5px 12px;border:1.5px solid var(--border2);border-radius:7px;background:var(--surface);font-size:12px;font-weight:600;color:var(--text2);cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor=\'var(--accent)\';this.style.color=\'var(--accent)\'" onmouseout="this.style.borderColor=\'var(--border2)\';this.style.color=\'var(--text2)\'">Edit</button>'
          +   '<button onclick="ppDeleteReason(\'' + _e(r.id) + '\')" style="padding:5px 12px;border:1.5px solid var(--danger);border-radius:7px;background:var(--surface);font-size:12px;font-weight:600;color:var(--danger);cursor:pointer;transition:opacity .15s" onmouseover="this.style.opacity=\'.7\'" onmouseout="this.style.opacity=\'1\'">Delete</button>'
          + '</div>'
          + '</div>';
      });
      rows += '</div>';
    }

    ct.innerHTML = toolbar + rows
      + '<div style="margin-top:12px;font-size:12px;color:var(--text3)">💡 Changes apply immediately to the Reject Application modal across all users.</div>';

    // Re-focus search if it was active
    if (q) {
      var s = document.getElementById('pp-rr-search');
      if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    }
  };

  // ── ppRenderReasons — kept for backward compat (showPage chain calls it) ─
  window.ppRenderReasons = function () {
    var body = document.getElementById('pp-reject-body');
    if (body && body.style.display !== 'none') ppRenderRejectionContent();
  };

  // ── Modal: Add ────────────────────────────────────────────────────────
  window.ppOpenAddReason = function () {
    if (!_guard()) return;
    _openModal('Add Rejection Reason', '', '', false, 'Save Reason');
  };

  // ── Modal: Edit ───────────────────────────────────────────────────────
  window.ppOpenEditReason = function (id) {
    if (!_guard()) return;
    var r = window._PP_REASONS.find(function (x) { return x.id === id; });
    if (!r) return;
    _openModal('Edit Rejection Reason', id, r.label, true, 'Update Reason');
  };

  function _openModal(title, editId, label, keyDisabled, btnText) {
    document.getElementById('modal-pp-reason-title').textContent = title;
    document.getElementById('pp-reason-edit-id').value  = editId;
    document.getElementById('pp-reason-key').value      = editId;
    document.getElementById('pp-reason-label').value    = label;
    document.getElementById('pp-reason-key').disabled   = keyDisabled;
    document.getElementById('pp-reason-save-btn').textContent = btnText;
    if (typeof openModal === 'function') openModal('modal-pp-reason');
    setTimeout(function () {
      var el = document.getElementById('pp-reason-label');
      if (el) el.focus();
    }, 120);
  }

  // ── Modal: Save (create or update) ───────────────────────────────────
  window.ppSaveReason = function () {
    if (!_guard()) return;
    var editId = (document.getElementById('pp-reason-edit-id').value || '').trim();
    var key    = (document.getElementById('pp-reason-key').value    || '').trim();
    var label  = (document.getElementById('pp-reason-label').value  || '').trim();

    if (!label) { _toast('Display label is required', 'error'); return; }

    if (!editId) {
      // CREATE
      if (!key) { _toast('Reason key is required', 'error'); return; }
      if (!/^[a-z0-9_]+$/.test(key)) { _toast('Key: lowercase letters, digits and underscores only', 'error'); return; }
      if (window._PP_REASONS.find(function (r) { return r.id === key; })) { _toast('Key "' + key + '" already exists', 'error'); return; }
      window._PP_REASONS.push({ id: key, label: label });
      _toast('Rejection reason "' + label + '" added');
    } else {
      // UPDATE
      var r = window._PP_REASONS.find(function (x) { return x.id === editId; });
      if (!r) return;
      r.label = label;
      _toast('Rejection reason updated');
    }

    _save();
    if (typeof closeModal === 'function') closeModal('modal-pp-reason');
    ppRenderRejectionContent();
  };

  // ── Delete ────────────────────────────────────────────────────────────
  window.ppDeleteReason = function (id) {
    if (!_guard()) return;
    var r = window._PP_REASONS.find(function (x) { return x.id === id; });
    if (!r) return;
    if (!confirm('Delete "' + r.label + '"? This cannot be undone.')) return;
    window._PP_REASONS = window._PP_REASONS.filter(function (x) { return x.id !== id; });
    _save();
    ppRenderRejectionContent();
    _toast('Rejection reason deleted', 'warn');
  };

  // ── Reorder ───────────────────────────────────────────────────────────
  window.ppMoveReason = function (idx, dir) {
    if (!_guard()) return;
    var ni = idx + dir;
    if (ni < 0 || ni >= window._PP_REASONS.length) return;
    var tmp = window._PP_REASONS[idx];
    window._PP_REASONS[idx] = window._PP_REASONS[ni];
    window._PP_REASONS[ni]  = tmp;
    _save();
    ppRenderRejectionContent();
  };

  // ── Nav visibility (admin + product_team) ────────────────────────────
  function _ppApplyNavVisibility() {
    var nav = document.getElementById('nav-section-policy');
    if (!nav) return;
    var ok = typeof currentUser !== 'undefined' &&
             (currentUser.role === 'admin' || currentUser.role === 'product_team');
    nav.style.display = ok ? '' : 'none';
  }
  window._ppApplyNavVisibility = _ppApplyNavVisibility;

  // ── MutationObserver: watch page-policy-product 'active' class ────────
  function _startObserver() {
    var page = document.getElementById('page-policy-product');
    if (!page) { setTimeout(_startObserver, 600); return; }
    var wasActive = page.classList.contains('active');
    if (wasActive) { _syncSelect(); }
    new MutationObserver(function () {
      var isActive = page.classList.contains('active');
      if (isActive && !wasActive) {
        wasActive = true;
        _syncSelect();
        // If card is already open, refresh content
        var body = document.getElementById('pp-reject-body');
        if (body && body.style.display !== 'none') ppRenderRejectionContent();
      }
      if (!isActive) wasActive = false;
    }).observe(page, { attributes: true, attributeFilter: ['class'] });
  }

  // ── Export CSV ───────────────────────────────────────────────────────
  window.rrExportCSV = function () {
    var header = 'Key,Display Label';
    var rows = window._PP_REASONS.map(function (r) {
      function esc(v) {
        var s = (v || '').toString().replace(/"/g, '""');
        return s.indexOf(',') !== -1 || s.indexOf('"') !== -1 ? '"' + s + '"' : s;
      }
      return esc(r.id) + ',' + esc(r.label);
    });
    var csv  = [header].concat(rows).join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href = url; a.download = 'rejection_reasons.csv';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    if (typeof showToast === 'function') showToast('Exported ' + window._PP_REASONS.length + ' reason(s) to CSV', 'success');
  };

  // ── Import CSV ───────────────────────────────────────────────────────
  window.rrImportCSV = function (input) {
    var file = input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
      var lines = e.target.result.split(/\r?\n/).filter(function (l) { return l.trim(); });
      if (!lines.length) { if (typeof showToast === 'function') showToast('CSV file is empty', 'error'); return; }

      // Skip header row if present
      var startIdx = 0;
      var firstLow = lines[0].toLowerCase();
      if (firstLow.indexOf('key') !== -1 || firstLow.indexOf('label') !== -1 || firstLow.indexOf('reason') !== -1) {
        startIdx = 1;
      }

      function parseRow(row) {
        var result = []; var inQ = false; var cur = '';
        for (var i = 0; i < row.length; i++) {
          var c = row[i];
          if (c === '"') { if (inQ && row[i+1] === '"') { cur += '"'; i++; } else { inQ = !inQ; } }
          else if (c === ',' && !inQ) { result.push(cur.trim()); cur = ''; }
          else { cur += c; }
        }
        result.push(cur.trim()); return result;
      }

      var added = 0, skipped = 0;
      for (var i = startIdx; i < lines.length; i++) {
        var cols  = parseRow(lines[i]);
        var key   = (cols[0] || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
        var label = (cols[1] || cols[0] || '').trim();
        if (!key || !label) { skipped++; continue; }
        if (window._PP_REASONS.find(function (r) { return r.id === key; })) { skipped++; continue; }
        window._PP_REASONS.push({ id: key, label: label });
        added++;
      }
      try { localStorage.setItem('_pp_rejection_reasons', JSON.stringify(window._PP_REASONS)); } catch (err) {}
      if (typeof _syncSelect === 'function') _syncSelect();
      ppRenderRejectionContent();
      var msg = added + ' reason(s) imported';
      if (skipped) msg += ', ' + skipped + ' skipped (invalid/duplicate)';
      if (typeof showToast === 'function') showToast(msg, added > 0 ? 'success' : 'warn');
      input.value = '';
    };
    reader.readAsText(file);
  };

  // ── Boot ──────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      _syncSelect();
      _ppApplyNavVisibility();
      _startObserver();
    });
  } else {
    _syncSelect();
    _ppApplyNavVisibility();
    _startObserver();
  }

})();
