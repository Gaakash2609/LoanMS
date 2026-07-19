    // Runs synchronously before paint — zero flash
    (function() {
      try {
        var s = localStorage.getItem('efin_session');
        if (s && JSON.parse(s).email) {
          document.documentElement.classList.add('has-session');
        }
      } catch(e) {}
    })();