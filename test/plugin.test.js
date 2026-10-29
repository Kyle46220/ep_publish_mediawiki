'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {convert} = require('../lib/convert');
const {destination, publish} = require('../lib/wiki');
const {validateApi, isPublic, Transport} = require('../lib/http');
const api = 'https://example.org/w/api.php';
test('destination accepts pretty URLs and title query URLs', () => {
  assert.equal(destination('https://example.org/wiki/My_page', api), 'My page');
  assert.equal(destination('https://example.org/w/index.php?title=My%20page', api), 'My page');
  assert.equal(destination('https://example.org/articles/One/Two', api, '/articles/'), 'One/Two');
});
for (const value of ['http://example.org/wiki/A', 'https://evil.org/wiki/A',
  'https://user:pass@example.org/wiki/A', 'https://example.org/wiki/',
  'https://example.org/wiki/MediaWiki:Common.js', 'https://example.org/wiki/Template:A',
  'https://example.org/wiki/Bad%7Btitle', 'https://example.org/foo/A']) {
  test(`destination rejects ${value}`, () => assert.throws(() => destination(value, api)));
}
test('API validation rejects unsafe endpoints', () => {
  for (const value of ['http://example.org/api.php', 'https://example.org:8000/api.php',
    'https://user:pass@example.org/api.php', api + '?foo=bar', 'https://example.org/wiki/A']) {
    assert.throws(() => validateApi(value));
  }
});
test('IP validation excludes local, private, mapped, reserved and metadata addresses', () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', '192.0.2.1']) {
    assert.equal(isPublic(address), false, address);
  }
  assert.equal(isPublic('8.8.8.8'), true);
  assert.equal(isPublic('2606:4700:4700::1111'), true);
});
test('private and mixed DNS answers are blocked before sending any credentials', async () => {
  let called = false;
  const t = new Transport(api, {lookup: async () => [{address: '8.8.8.8', family: 4},
    {address: '127.0.0.1', family: 4}], request: () => {called = true;}});
  await assert.rejects(t.call({password: 'SECRET'}), /public/);
  assert.equal(called, false);
});
test('rich text preserves basic structure and neutralizes literal wiki templates', () => {
  const wiki = convert('<h2>Heading</h2><p><b>Bold</b> and <i>italic</i></p><ul><li>One<ul><li>Two</li></ul></li></ul><p>{{Danger}} [[File:X]] &lt;/nowiki&gt;</p>');
  assert.match(wiki, /== <nowiki>Heading<\/nowiki> ==/);
  assert.match(wiki, /'''<nowiki>Bold<\/nowiki>'''/);
  assert.match(wiki, /\n\* <nowiki>One/);
  assert.match(wiki, /\n\*\* <nowiki>Two/);
  assert.match(wiki, /<nowiki>\{\{Danger\}\} \[\[File:X\]\] &lt;\/nowiki&gt;<\/nowiki>/);
});
test('rich text strips scripts and unsafe links', () => {
  const wiki = convert('<script>secret()</script><a href="javascript:bad()">Name</a><a href="https://example.org/">Link</a>');
  assert.doesNotMatch(wiki, /secret|javascript/);
  assert.match(wiki, /\[https:\/\/example.org\/ <nowiki>Link<\/nowiki>\]/);
});
function fake({missing = false, failure, existing = 'OLD'} = {}) {
  const calls = [];
  return {calls, async call(params) {
    calls.push(params);
    if (params.type === 'login') return {query: {tokens: {logintoken: 'LOGIN'}}};
    if (params.action === 'login') return {login: {result: 'Success'}};
    if (params.action === 'query') return {curtimestamp: '2026-10-29T01:00:00Z', query: {
      tokens: {csrftoken: 'CSRF'}, pages: [{title: 'Target', ...(missing ? {missing: true} : {revisions: [
        {revid: 42, timestamp: '2026-10-28T01:00:00Z', slots: {main: {content: existing, contentmodel: 'wikitext'}}},
      ]})}]}};
    if (failure && failure(params)) throw new Error('editconflict');
    return {edit: {result: 'Success', newrevid: 43}};
  }};
}
const input = {title: 'Target', username: 'User@Bot', password: 'SECRET', text: 'NEW', mode: 'replace'};
test('replace uses conflict guards and preserves destination page', async () => {
  const transport = fake();
  const result = await publish({...input, transport});
  const edit = transport.calls.at(-1);
  assert.equal(edit.baserevid, 42); assert.equal(edit.nocreate, '1');
  assert.equal(edit.basetimestamp, '2026-10-28T01:00:00Z');
  assert.equal(edit.text, 'NEW'); assert.equal(result.revision, 43);
});
test('missing destination uses createonly', async () => {
  const transport = fake({missing: true});
  await publish({...input, transport});
  assert.equal(transport.calls.at(-1).createonly, '1');
});
test('archive is saved before replacement and contains previous content', async () => {
  const transport = fake(); const result = await publish({...input, transport, mode: 'archive'});
  const edits = transport.calls.filter((p) => p.action === 'edit');
  assert.equal(edits.length, 2); assert.equal(edits[0].text, 'OLD');
  assert.equal(edits[0].createonly, '1'); assert.match(result.archive, /^Target\/Archive\//);
  assert.equal(edits[1].text, 'NEW');
});
test('archive failure leaves destination unchanged', async () => {
  const transport = fake({failure: (p) => p.title.includes('/Archive/')});
  await assert.rejects(publish({...input, transport, mode: 'archive'}), /editconflict/);
  assert.equal(transport.calls.filter((p) => p.action === 'edit').length, 1);
});
test('replacement failure reports successfully saved archive', async () => {
  const transport = fake({failure: (p) => p.title === 'Target'});
  await assert.rejects(publish({...input, transport, mode: 'archive'}), /Archive saved at Target\/Archive\//);
});
test('unchanged pages make no edits or archives', async () => {
  const transport = fake({existing: 'NEW'});
  assert.equal((await publish({...input, transport, mode: 'archive'})).unchanged, true);
  assert.equal(transport.calls.filter((p) => p.action === 'edit').length, 0);
});
test('empty pads and unknown modes are refused', async () => {
  await assert.rejects(publish({...input, transport: fake(), text: '  '}), /Empty/);
  await assert.rejects(publish({...input, transport: fake(), mode: 'delete'}), /mode/);
});
