'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const express = require('express');
const {createHash} = require('node:crypto');

test('HTTP routes enforce access, same-origin, snapshot checks, locking and secret-free settings', async (t) => {
  const store = new Map(); let allowed = true; let release;
  const blocking = new Promise((resolve) => {release = resolve;});
  let shouldBlock = false;
  const originalLoad = Module._load;
  const stubs = {
    'ep_etherpad-lite/node/utils/Settings': {cookie: {prefix: 'ep_'}},
    'ep_etherpad-lite/node/db/PadManager': {doesPadExist: async () => true,
      getPad: async () => ({head: 7, getInternalRevisionAText: async () => ({text: 'Hello\n'})})},
    'ep_etherpad-lite/node/db/DB': {get: async (key) => store.get(key), set: async (key, value) => store.set(key, value)},
    'ep_etherpad-lite/node/db/SecurityManager': {checkAccess: async () => ({accessStatus: allowed ? 'grant' : 'deny'})},
    'ep_etherpad-lite/node/hooks/express/webaccess': {userCanModify: () => allowed},
    'ep_etherpad-lite/node/utils/ExportHtml': {getPadHTML: async () => '<div>Hello</div>'},
  };
  const wiki = require('../lib/wiki'); const originalPublish = wiki.publish;
  wiki.publish = async () => { if (shouldBlock) await blocking; return {title: 'Page', revision: 9}; };
  delete require.cache[require.resolve('../index')];
  const plugin = require('../index'); wiki.publish = originalPublish;
  const app = express();
  Module._load = function (id, ...rest) { return stubs[id] || originalLoad.call(this, id, ...rest); };
  try { plugin.expressCreateServer('', {app}); } finally {Module._load = originalLoad;}
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`; const endpoint = base + '/p/demo/publish-mediawiki';
  const body = {api: 'https://example.org/api.php', url: 'https://example.org/wiki/Page',
    articlePath: '/wiki/', username: 'Me@Bot', password: 'SECRET', mode: 'replace', format: 'rich',
    expectedRevision: 7, textHash: createHash('sha256').update('Hello').digest('hex')};
  const post = (payload = body, origin = base) => fetch(endpoint, {method: 'POST',
    headers: {'Content-Type': 'application/json', 'Origin': origin, 'X-Etherpad-Publish': '1'}, body: JSON.stringify(payload)});
  allowed = false; assert.equal((await fetch(endpoint)).status, 403); assert.equal((await post()).status, 400);
  allowed = true; assert.equal((await post(body, 'https://evil.org')).status, 403);
  assert.match((await (await post({...body, textHash: 'bad'})).json()).error, /still saving/);
  assert.match((await (await post({...body, expectedRevision: 6})).json()).error, /still saving/);
  const result = await post(); assert.equal(result.status, 200);
  assert.equal((await result.json()).revision, 9);
  const saved = await (await fetch(endpoint)).json();
  assert.equal(saved.url, body.url); assert.equal(saved.password, undefined); assert.equal(saved.username, undefined);
  assert.doesNotMatch(JSON.stringify([...store]), /SECRET/);
  shouldBlock = true;
  const pending = post();
  // Wait until first request has acquired its lock using repeated GETs as a round trip.
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal((await post()).status, 409);
  assert.equal((await post()).status, 409); // A rejected request must not release another request's lock.
  release(); assert.equal((await pending).status, 200);
});
