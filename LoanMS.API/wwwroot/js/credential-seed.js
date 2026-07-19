/* credential-seed.js — Default credential hash seeding
 * Load order: JUST BEFORE efin-app.js
 * Reads/writes: localStorage keys efin_credentials_v1, efin_cred_version
 */
    (function() {
      try {
        var KEY = 'efin_credentials_v1';
        // SHA-256 hashes of default passwords
        var defaults = {
          'admin@efin.com':        'e86f78a8a3caf0b60d8e74e5942aa6d86dc150cd3c03338aef25b7d2d7e3acc7',
          'manager@efin.com':      'e8392925a98c9c22795d1fc5d0dfee5b9a6943f6b768ec5a2a0c077e5ed119cf',
          'sales@efin.com':        'b0131d869ccf6c9ae9c2d66a8ddb367c7022a554e8477f18068bfb81271ebd90',
          'login@efin.com':        '302e4ade65334f76887ffb76dddfade52a293b8ae8c995c0c3eb03d4f81f9794',
          'tl@efin.com':           'aef3d605618615cae1e51760bda170ba3ef5fe175f9f95017f822787fdd59fb4',
          'partner@efin.com':      '7658d201cff9989480d422a9fad0970bd036df504a0baa0ce6e1187df49b2381',
          'accounts@efin.com':     '934975bf2a884e397d6e3f50ded9d96221b82ec6af04565a5917ff74b8347c2c',
          'product@efin.com':      '874c610ba950209dc44157b57b7ff209eebf70f5c8edf183e28537a0681d3a23',
          'locationhead@efin.com': 'dbb0c00fc6784a219eb2310320598e56f1a52db00eb5da607473a6f189e022b7',
          'opmanager@efin.com':    '167178921ce5119f3e049f4591e1e3ea9d5973279e535c122b2c2d3e0cc69004',
          'dsa@efin.com':          '3e6f142c7143c6faca4fd558338d30624e964affd360f1b635e5486e5d58680d'
        };
        // Version check: force re-seed if version mismatch
        var VER_KEY = 'efin_cred_version';
        var CURRENT_VER = '2';
        var storedVer = localStorage.getItem(VER_KEY);
        var existing = {};
        if (storedVer !== CURRENT_VER) {
          // Force fresh defaults on version mismatch
          existing = {};
          localStorage.removeItem(KEY);
          localStorage.setItem(VER_KEY, CURRENT_VER);
        } else {
          try { existing = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch(e) {}
        }
        var merged = Object.assign({}, defaults, existing);
        // Always ensure admin/manager/sales have at least the default hash
        merged['admin@efin.com']   = merged['admin@efin.com']   || defaults['admin@efin.com'];
        merged['manager@efin.com'] = merged['manager@efin.com'] || defaults['manager@efin.com'];
        merged['sales@efin.com']   = merged['sales@efin.com']   || defaults['sales@efin.com'];
        localStorage.setItem(KEY, JSON.stringify(merged));
      } catch(e) {}
    })();
