    // Runs synchronously before paint — zero flash
    // Requires the real backend JWT (loanms_token) in addition to the
    // efin_session display cache, matching boot.js's restore condition
    // below. Previously this checked efin_session alone, so if the token had
    // been cleared (e.g. by a failed background refresh) while efin_session
    // lingered, the login screen was hidden here but boot.js/efin-app.js had
    // nothing to actually restore — leaving a dashboard shell with no user
    // data painted in, showing the raw "User Name" / "AG" placeholders.
    (function() {
      try {
        var s = localStorage.getItem('efin_session');
        var t = localStorage.getItem('loanms_token');
        if (s && t && JSON.parse(s).email) {
          document.documentElement.classList.add('has-session');
        }
      } catch(e) {}
    })();