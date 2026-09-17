'use strict';
const http = require('node:http');
const { randomBytes, timingSafeEqual } = require('node:crypto');

// The HTTP API can read local media paths. A random per-launch header, added
// only by the app's Electron session, keeps unrelated browser tabs out.
async function listenLocal(handler, port = 0) {
  const token = randomBytes(32).toString('hex');
  const secret = Buffer.from(token);
  const server = http.createServer((req, res) => {
    const supplied = Buffer.from(String(req.headers['x-tbg-desktop'] || ''));
    if (supplied.length !== secret.length || !timingSafeEqual(supplied, secret)) {
      res.writeHead(403, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      res.end('Diese Adresse gehört zum lokalen App-Fenster.');
      return;
    }
    handler(req, res);
  });
  const listen = p => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(p, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  try { await listen(port); }
  catch (err) { if (port && err.code === 'EADDRINUSE') await listen(0); else throw err; }
  return { server, token, origin: `http://127.0.0.1:${server.address().port}` };
}

module.exports = { listenLocal };
