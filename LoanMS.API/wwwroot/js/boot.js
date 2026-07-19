// ── Safe localStorage helpers (private to this module) ──
var _lsGet = function(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } };
var _lsSet = function(k,v){ try{ localStorage.setItem(k,v); }catch(e){} };
var _lsRemove = function(k){ try{ localStorage.removeItem(k); }catch(e){} };

    // Staggered page load animation for stat cards
    document.addEventListener('DOMContentLoaded', function () {
      // Init confetti engine
      _confetti.init();

      // ── Hydrate credential hashes from localStorage into USER_ACCOUNTS ──
      _hydrateUserAccounts();

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

      // ── Sanitise stale localStorage: remove corrupt credential store ──
      // A corrupt store is one that exists but has no valid email→hash entries.
      // This handles the case where a previous session left an empty {} object,
      // which would block the first-run wizard from ever appearing.
      (function() {
        try {
          const UA_KEY = 'efin_credentials_v1';
          const raw = localStorage.getItem(UA_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) {
              localStorage.removeItem(UA_KEY);
            }
          }
        } catch(e) {
          try { localStorage.removeItem('efin_credentials_v1'); } catch(_) {}
        }
      })();

      // ── First-run check: show setup wizard if no credentials stored ──
      if (!_loadCredentials()) {
        _showFirstRunSetup();
      }

      // ── Auto-restore session from localStorage ──
      const savedSession = _lsGet('efin_session');
      if (savedSession) {
        try {
          const sess = JSON.parse(savedSession);
          const account = USER_ACCOUNTS.find(u => u.email === sess.email);
          const credMap = _loadCredentials();
          // Session expiry: 8 hours
          const _SESSION_MAX_MS = 8 * 60 * 60 * 1000;
          const _sessionAge = sess.loginTs ? (Date.now() - sess.loginTs) : 0;
          const _sessionValid = !sess.loginTs || _sessionAge < _SESSION_MAX_MS;

          if (account && credMap && credMap[sess.email] && _sessionValid) {
            currentUser = { name: account.name, role: account.role, email: account.email };
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
            } else if (account.role === 'partner') {
              showPage('payout', document.getElementById('nav-access'));
              initPayoutFromDisbursed();
            } else if (account.role === 'accounts') {
              showPage('payout', document.getElementById('nav-access'));
            }
          } else if (sess.loginTs && _sessionAge >= _SESSION_MAX_MS) {
            localStorage.removeItem('efin_session');
          } else if (!account || !credMap || !credMap[sess.email]) {
            localStorage.removeItem('efin_session');
          }
        } catch(e) {
          _lsRemove('efin_session');
        }
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
