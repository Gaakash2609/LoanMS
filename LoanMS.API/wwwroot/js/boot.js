// ── Safe localStorage helpers (private to this module) ──
var _lsGet = function(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } };
var _lsSet = function(k,v){ try{ localStorage.setItem(k,v); }catch(e){} };
var _lsRemove = function(k){ try{ localStorage.removeItem(k); }catch(e){} };

    // Staggered page load animation for stat cards
    document.addEventListener('DOMContentLoaded', function () {
      // Init confetti engine
      _confetti.init();

      // ── Migrate any stored partner_user sessions/credentials → partner ──
      (function() {
        try {
          const sess = localStorage.getItem('efin_session');
          if (sess) {
            const s = JSON.parse(sess);
            if (s && s.role === 'partner_user') {
              s.role = 'partner';
              if (!s.loginTs) s.loginTs = Date.now();
              localStorage.setItem('efin_session', JSON.stringify(s));
            }
          }
        } catch(e) {}
      })();

      // ── Auto-restore session from localStorage ──
      // The real backend JWT (loanms_token) is the only thing that gates
      // this restore — not any client-side credential/hash store. This is
      // an optimistic UI restore only (skip the login-screen flash on
      // reload) using the session snapshot saved at login time; api-bridge.js's
      // own DOMContentLoaded handler independently calls GET /api/auth/me
      // with the same token to authoritatively confirm/refresh the session
      // and will clear everything via _clearAuth() if the token is invalid
      // or expired server-side.
      const savedSession = _lsGet('efin_session');
      const savedToken   = _lsGet('loanms_token');
      if (savedSession && savedToken) {
        try {
          const sess = JSON.parse(savedSession);
          // Session expiry: 8 hours
          const _SESSION_MAX_MS = 8 * 60 * 60 * 1000;
          const _sessionAge = sess.loginTs ? (Date.now() - sess.loginTs) : 0;
          const _sessionValid = !sess.loginTs || _sessionAge < _SESSION_MAX_MS;

          if (sess.email && _sessionValid) {
            currentUser = { name: sess.name, role: sess.role, email: sess.email };
            applySession();
            updateGreeting();
            renderPipeline();
            renderChart();
            renderLoanTypeChart();
            updateDashboardStats();
            renderActivity();
            renderBanksTable();
            renderIncredPage();
            updateNotifBadge();
            updateTasksNavBadge();
            document.getElementById('login-screen').style.display = 'none';
            const savedHash = location.hash.replace('#', '');
            if (savedHash && document.getElementById('page-' + savedHash)) {
              const savedNav = document.querySelector('.nav-item[data-menu-id="' + savedHash + '"]');
              showPage(savedHash, savedNav);
            } else if (sess.role === 'partner') {
              showPage('payout', document.getElementById('nav-access'));
              initPayoutFromDisbursed();
            } else if (sess.role === 'accounts') {
              showPage('payout', document.getElementById('nav-access'));
            }
            // Tell efin-app.js's duplicate restore block (runs moments later,
            // same DOMContentLoaded tick) that navigation/rendering already
            // happened, so it doesn't repeat showPage() and role-based
            // network calls (e.g. initPayoutFromDisbursed()) a second time.
            window._efinBootRestoreDone = true;
          } else if (sess.loginTs && _sessionAge >= _SESSION_MAX_MS) {
            localStorage.removeItem('efin_session');
          }
        } catch(e) {
          _lsRemove('efin_session');
        }
      } else if (savedSession && !savedToken) {
        // A session snapshot with no backing JWT can't be trusted — e.g.
        // leftover from the removed offline-login fallback. Never restore
        // from it; always fall through to the login screen.
        _lsRemove('efin_session');
      }

      setTimeout(function () {
        var cards = document.querySelectorAll('.stat-card');
        cards.forEach(function (c, i) {
          c.style.opacity = '0';
          c.style.transform = 'translateY(20px)';
          c.style.transition = 'opacity .45s ease, transform .45s cubic-bezier(.34,1.2,.64,1)';
          setTimeout(function () {
            c.style.opacity = '1';
            c.style.transform = 'translateY(0)';
          }, 120 + i * 90);
        });
        var navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(function (n, i) {
          n.style.opacity = '0';
          n.style.transform = 'translateX(-10px)';
          n.style.transition = 'opacity .3s ease, transform .3s ease';
          setTimeout(function () {
            n.style.opacity = '1';
            n.style.transform = 'translateX(0)';
          }, 60 + i * 30);
        });
      }, 200);
    });

    // ── Keep --topbar-h in sync with the real #main-topbar height ──
    // The shared topbar's padding changes across breakpoints (10px/14px on
    // mobile up to 20px/80px on large desktop), so its rendered height is
    // not a fixed number. Page-level sticky elements (e.g. the unsaved
    // permissions banner, the lender-workflow action bar) offset by
    // var(--topbar-h) instead of top:0 to avoid colliding with the topbar
    // and the hamburger button inside it. This keeps that variable accurate
    // instead of relying on the CSS fallback estimate.
    (function () {
      function _applyTopbarHeight(el) {
        var h = el.offsetHeight;
        if (h > 0) {
          document.documentElement.style.setProperty('--topbar-h', h + 'px');
        }
      }
      function _init() {
        var topbar = document.getElementById('main-topbar');
        if (!topbar) return;
        _applyTopbarHeight(topbar);
        if (typeof ResizeObserver !== 'undefined') {
          var ro = new ResizeObserver(function (entries) {
            for (var i = 0; i < entries.length; i++) {
              _applyTopbarHeight(entries[i].target);
            }
          });
          ro.observe(topbar);
        } else {
          // Fallback for browsers without ResizeObserver support
          window.addEventListener('resize', function () { _applyTopbarHeight(topbar); });
        }
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
      } else {
        _init();
      }
    })();
