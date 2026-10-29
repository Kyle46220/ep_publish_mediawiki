'use strict';
const {Transport} = require('./lib/http');
const {convert} = require('./lib/convert');
const {destination, publish} = require('./lib/wiki');
const active = new Set();
const {createHash} = require('node:crypto');
exports.toolbar = (_hook, context) => {
  context.content += '<li><button type="button" id="ep-publish-mediawiki" title="Publish to MediaWiki" style="padding:0 8px;font:inherit;cursor:pointer">Publish</button></li>';
};
exports.expressCreateServer = (_hook, {app}) => {
  const express = require('express');
  const settingsModule = require('ep_etherpad-lite/node/utils/Settings');
  const settings = settingsModule.default || settingsModule;
  const pads = require('ep_etherpad-lite/node/db/PadManager');
  const db = require('ep_etherpad-lite/node/db/DB');
  const security = require('ep_etherpad-lite/node/db/SecurityManager');
  const webaccess = require('ep_etherpad-lite/node/hooks/express/webaccess');
  const exporter = require('ep_etherpad-lite/node/utils/ExportHtml');
  const route = '/p/:pad/publish-mediawiki';
  const key = (id) => `ep_publish_mediawiki:${Buffer.from(id).toString('base64url')}`;
  async function authorize(req) {
    const id = req.params.pad;
    if (!id || id.startsWith('r.') || !webaccess.userCanModify(id, req) || !(await pads.doesPadExist(id))) {
      throw new Error('Pad does not exist or you do not have editing access.');
    }
    const p = settings.cookie?.prefix || '';
    const result = await security.checkAccess(id, req.cookies?.[`${p}sessionID`] || req.cookies?.sessionID,
      req.cookies?.[`${p}token`] || req.cookies?.token, req.session?.user);
    if (result.accessStatus !== 'grant') throw new Error('Pad access denied.');
    return id;
  }
  app.get(route, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { const id = await authorize(req); res.json(await db.get(key(id)) || {}); }
    catch { res.status(403).json({error: 'Pad access denied.'}); }
  });
  app.post(route, express.json({limit: '24kb', type: 'application/json'}), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    let id; let locked = false;
    try {
      let origin;
      try { origin = new URL(req.get('origin')); } catch { throw new Error('Same-origin browser request required.'); }
      if (origin.host !== req.get('host') || req.get('x-etherpad-publish') !== '1' || !req.is('application/json')) {
        return res.status(403).json({error: 'Same-origin browser request required.'});
      }
      id = await authorize(req);
      if (active.has(id)) return res.status(409).json({error: 'Publication already in progress for this pad.'});
      const input = req.body || {};
      for (const field of ['api', 'url', 'username', 'password', 'mode', 'format', 'articlePath']) {
        if (typeof input[field] !== 'string' || input[field].length > 4096) throw new Error(`Invalid ${field}.`);
      }
      const title = destination(input.url, input.api, input.articlePath);
      if (!['rich', 'wikitext'].includes(input.format)) throw new Error('Unknown content format.');
      active.add(id); locked = true;
      const pad = await pads.getPad(id);
      // Pin publication to one saved revision, even if collaborators keep typing.
      const revision = pad.head;
      const snapshot = await pad.getInternalRevisionAText(revision);
      if (!Number.isInteger(input.expectedRevision) || input.expectedRevision !== revision ||
          createHash('sha256').update(snapshot.text.slice(0, -1)).digest('hex') !== input.textHash) {
        throw new Error('The pad is still saving or changed during publication. Wait for it to sync, then publish again.');
      }
      const text = input.format === 'wikitext'
        ? (await pad.getInternalRevisionAText(revision)).text
        : convert(await exporter.getPadHTML(pad, revision));
      if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('Pad exceeds the 1 MB publication limit.');
      const result = await publish({transport: new Transport(input.api), title, username: input.username,
        password: input.password, text, mode: input.mode, summary: `Published from Etherpad ${id}, revision ${revision}`});
      const saved = {api: input.api, url: input.url, articlePath: input.articlePath,
        mode: input.mode, format: input.format};
      try { await db.set(key(id), saved); }
      catch { result.warning = 'Published, but destination settings could not be saved.'; }
      res.json({...result, padRevision: revision});
    } catch (err) {
      // Known failures are useful, but never log request bodies or credentials.
      res.status(400).json({error: err.message || 'Publication failed. Check the wiki before retrying.'});
    } finally { if (locked) active.delete(id); }
  });
};
