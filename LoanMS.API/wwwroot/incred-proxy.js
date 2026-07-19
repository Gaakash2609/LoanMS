/**
 * InCred API Proxy Server
 * Run: node incred-proxy.js
 * Then open: http://localhost:7070
 * 
 * This proxy:
 *  1. Serves all static files (index.html, js/, css/)
 *  2. Routes /api/incred/* → https://api.incred.com/v3 (avoids CORS)
 */

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

const PORT       = 7070;
const STATIC_DIR = __dirname;

// InCred credentials (from incred_mixin.py)
const INCRED_BASE    = 'https://api.incred.com/v3';
const CLIENT_ID      = '5251599593571026P';
const CLIENT_SECRET  = 'VGCm5yu8wSCfog4zL8gdqf353Rj08gXi';

// ── MIME types ──────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
  '.ttf':  'font/ttf',
};

// ── InCred API proxy helper ──────────────────────────────────────────────────
function proxyToInCred(targetUrl, method, headers, body, res) {
  const parsed   = url.parse(targetUrl);
  const options  = {
    hostname: parsed.hostname,
    port:     443,
    path:     parsed.path,
    method:   method,
    headers:  headers,
  };

  const proxyReq = https.request(options, (proxyRes) => {
    let data = '';
    proxyRes.on('data', chunk => data += chunk);
    proxyRes.on('end', () => {
      res.writeHead(proxyRes.statusCode, {
        'Content-Type':                'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(data);
    });
  });

  proxyReq.on('error', (err) => {
    console.error('[InCred Proxy Error]', err.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: false, message: 'InCred proxy error: ' + err.message }));
  });

  if (body) proxyReq.write(body);
  proxyReq.end();
}

// ── Get InCred access token ──────────────────────────────────────────────────
function getToken(callback) {
  const body = `grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}`;
  const options = {
    hostname: 'api.incred.com',
    port:     443,
    path:     '/v3/auth/incred/protocol/openid-connect/token',
    method:   'POST',
    headers:  {
      'Content-Type':   'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        callback(null, json.access_token);
      } catch(e) {
        callback(e, null);
      }
    });
  });
  req.on('error', callback);
  req.write(body);
  req.end();
}

// ── Main HTTP server ─────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url);
  const pathname  = parsedUrl.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    });
    return res.end();
  }

  // ── /api/incred/* → InCred API proxy ──────────────────────────────────────
  if (pathname.startsWith('/api/incred/')) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const subPath = pathname.replace('/api/incred', '');

      // /api/incred/token → get token with built-in credentials
      if (subPath === '/token') {
        getToken((err, token) => {
          if (err || !token) {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ status: false, message: 'Token fetch failed: ' + (err ? err.message : 'no token') }));
          }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ access_token: token }));
        });
        return;
      }

      // Other InCred API routes — get token first, then forward
      getToken((err, token) => {
        if (err || !token) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ status: false, message: 'Token fetch failed' }));
        }

        // Map proxy path back to InCred path
        let incredPath = subPath;
        if (!incredPath.startsWith('/digital-partner') && !incredPath.startsWith('/auth')) {
          incredPath = '/digital-partner' + incredPath;
        }

        const targetUrl = INCRED_BASE + incredPath;
        console.log(`[InCred] ${req.method} ${targetUrl}`);

        const fwdHeaders = {
          'Content-Type': 'application/json',
          'jwt_token':    token,
        };
        if (body) fwdHeaders['Content-Length'] = Buffer.byteLength(body);

        proxyToInCred(targetUrl, 'POST', fwdHeaders, body || null, res);
      });
    });
    return;
  }

  // ── Static file server ────────────────────────────────────────────────────
  let filePath = path.join(STATIC_DIR, pathname === '/' ? 'index.html' : pathname);

  // SPA fallback: unknown paths → index.html
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(STATIC_DIR, 'index.html');
  }

  const ext  = path.extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  ✅ LoanMS running at http://localhost:' + PORT);
  console.log('  ✅ InCred API proxy active at /api/incred/*');
  console.log('  ✅ Credentials: ' + CLIENT_ID);
  console.log('');
  console.log('  Open your browser: http://localhost:' + PORT);
  console.log('  Press Ctrl+C to stop');
  console.log('');
});
