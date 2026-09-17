const assert = require('node:assert/strict');
const { listenLocal } = require('../desktop/local-server.cjs');
(async () => {
  const local = await listenLocal((_req, res) => { res.writeHead(200); res.end('ok'); });
  try {
    assert.equal((await fetch(local.origin)).status, 403);
    assert.equal((await fetch(local.origin, { headers: { 'x-tbg-desktop': 'wrong' } })).status, 403);
    const response = await fetch(local.origin, { headers: { 'x-tbg-desktop': local.token } });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'ok');
    assert.equal(local.server.address().address, '127.0.0.1');
    console.log('Desktop HTTP boundary passed.');
  } finally { local.server.closeAllConnections(); await new Promise(resolve => local.server.close(resolve)); }
})().catch(err => { console.error(err); process.exitCode = 1; });
