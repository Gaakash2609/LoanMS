    window.onerror = function(msg, src, line, col, err) {
      console.error('[EFIN]', msg, src ? src.split('/').pop() + ':' + line : '');
      return false; // let default browser handler still log it
    };
    window.addEventListener('unhandledrejection', function(e) {
      console.error('[EFIN Promise]', e.reason);
    });