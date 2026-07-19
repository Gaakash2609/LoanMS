/* login-helpers.js — Forgot Password + Remember Me wrappers
 * Load order: after boot.js, before or with efin-app.js
 * Functions: showForgotPassword, showLoginForm, doForgotPassword, loginRememberMe
 * DOM IDs used: login-form-section, forgot-password-section, login-user,
 *               forgot-email, forgot-msg, login-password, login-remember
 * External calls: /api/auth/forgot-password
 */
    // ── Forgot Password ──────────────────────────────────────────────
    function showForgotPassword() {
      var loginSec  = document.getElementById('login-form-section');
      var forgotSec = document.getElementById('forgot-password-section');
      if (!loginSec || !forgotSec) return;
      loginSec.style.display  = 'none';
      forgotSec.style.display = '';
      var emailEl  = document.getElementById('login-user');
      var forgotEl = document.getElementById('forgot-email');
      if (forgotEl && emailEl) forgotEl.value = emailEl.value || '';
      var msgEl = document.getElementById('forgot-msg');
      if (msgEl) msgEl.style.display = 'none';
      setTimeout(function() { if (forgotEl) forgotEl.focus(); }, 100);
    }

    function showLoginForm() {
      var loginSec  = document.getElementById('login-form-section');
      var forgotSec = document.getElementById('forgot-password-section');
      if (forgotSec) forgotSec.style.display = 'none';
      if (loginSec)  loginSec.style.display  = '';
      setTimeout(function() {
        var p = document.getElementById('login-password');
        if (p) p.focus();
      }, 100);
    }

    async function doForgotPassword() {
      var email  = (document.getElementById('forgot-email')?.value || '').trim().toLowerCase();
      var msgEl  = document.getElementById('forgot-msg');
      var btn    = document.querySelector('#forgot-password-section .login-btn');

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        if (msgEl) {
          msgEl.style.display    = '';
          msgEl.style.background = 'rgba(212,43,43,.08)';
          msgEl.style.border     = '1px solid rgba(212,43,43,.2)';
          msgEl.style.color      = 'var(--danger, #d43b2b)';
          msgEl.textContent      = '⚠ Please enter a valid email address.';
        }
        return;
      }

      if (btn) { btn.disabled = true; btn.textContent = '⏳ Processing…'; }
      if (msgEl) msgEl.style.display = 'none';

      try {
        var res = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email }),
          signal: AbortSignal.timeout(15000)
        });
        if (msgEl) {
          msgEl.style.display    = '';
          msgEl.style.background = 'rgba(26,115,64,.08)';
          msgEl.style.border     = '1px solid rgba(26,115,64,.2)';
          msgEl.style.color      = 'var(--success, #1a7340)';
          msgEl.innerHTML        = '✅ If this email is registered, a reset link has been sent.<br>'
            + '<span style="font-size:11px;opacity:.8">Please check your inbox and follow the link to reset your password.</span>';
        }
      } catch(err) {
        if (msgEl) {
          msgEl.style.display    = '';
          msgEl.style.background = 'rgba(212,43,43,.08)';
          msgEl.style.border     = '1px solid rgba(212,43,43,.2)';
          msgEl.style.color      = 'var(--danger, #d43b2b)';
          msgEl.textContent      = '✕ Could not connect to server. Please try again.';
        }
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '📧 Send Reset Link'; }
      }
    }

    // ── Remember Me ──────────────────────────────────────────────────
    function loginRememberMe(checked) {
      try {
        if (checked) {
          var email = document.getElementById('login-user')?.value.trim();
          if (email) localStorage.setItem('efin_remembered_email', email);
          localStorage.setItem('efin_remember_me', '1');
        } else {
          localStorage.removeItem('efin_remembered_email');
          localStorage.removeItem('efin_remember_me');
        }
      } catch(e) {}
    }

    // Restore remembered email on page load
    (function() {
      try {
        if (localStorage.getItem('efin_remember_me') === '1') {
          var email = localStorage.getItem('efin_remembered_email');
          var el    = document.getElementById('login-user');
          var chk   = document.getElementById('login-remember');
          if (email && el) el.value = email;
          if (chk) chk.checked = true;
        }
      } catch(e) {}
    })();
