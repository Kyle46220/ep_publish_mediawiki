'use strict';
exports.documentReady = () => {
  const button = document.getElementById('ep-publish-mediawiki');
  if (!button || button.dataset.bound) return;
  button.dataset.bound = '1';
  const match = location.pathname.match(/^(.*\/p\/[^/]+)(?:\/.*)?$/);
  if (!match) return;
  const endpoint = `${match[1]}/publish-mediawiki`;
  const dialog = document.createElement('dialog');
  dialog.style.cssText = 'width:440px;max-width:90vw;border:1px solid #999;border-radius:8px;padding:20px;color:#222;background:white;font:14px system-ui';
  dialog.innerHTML = `<form method="dialog">
    <h2 style="font-size:18px;margin:0 0 16px">Publish to MediaWiki</h2>
    <label>Destination page URL<input name="url" type="url" placeholder="https://domain.net/wiki/My_page" required></label>
    <details><summary>Wiki connection</summary>
    <label>Wiki API URL<input name="api" type="url" placeholder="https://domain.net/w/api.php" required></label>
    <label>Article path prefix<input name="articlePath" value="/wiki/" required></label>
    <p>The API URL is configured once for this pad. It is not always /w/api.php; check your wiki’s Special:Version → Entry point URLs.</p>
    </details>
    <label>Bot username<input name="username" placeholder="YourName@Etherpad" autocomplete="off" required></label>
    <label>Bot password<input name="password" type="password" autocomplete="off" required></label>
    <p style="font-size:12px">Create credentials at your wiki’s Special:BotPasswords. They stay in this tab’s memory until reload.</p>
    <label>Content<select name="format"><option value="rich">Convert Etherpad formatting</option><option value="wikitext">Pad already contains wiki markup</option></select></label>
    <label>Existing page<select name="mode"><option value="replace">Replace — keep revision history</option><option value="archive">Archive a copy, then replace</option></select></label>
    <p style="font-size:12px">Publishes the whole pad. Rich text supports headings, lists, bold, italic, underline, strikeout and web links. Images, tables and plugin-specific formatting are not preserved.</p>
    <p role="status" aria-live="polite" style="white-space:pre-wrap"></p>
    <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" data-close>Close</button><button type="submit" data-publish>Publish</button></div>
  </form>`;
  for (const label of dialog.querySelectorAll('label')) label.style.cssText = 'display:block;margin:12px 0';
  for (const field of dialog.querySelectorAll('input,select')) field.style.cssText = 'display:block;width:100%;box-sizing:border-box;padding:7px;margin-top:4px;font:inherit';
  document.body.appendChild(dialog);
  const form = dialog.querySelector('form');
  const status = dialog.querySelector('[role=status]');
  const submit = dialog.querySelector('[data-publish]');
  form.elements.api.addEventListener('input', () => {form.elements.password.value = '';});
  let loaded = false;
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  button.onclick = async () => {
    status.textContent = '';
    dialog.showModal();
    if (loaded) return;
    try {
      const response = await fetch(endpoint, {credentials: 'same-origin', cache: 'no-store'});
      if (!response.ok) throw new Error('Cannot load saved settings. Check pad editing access.');
      const saved = await response.json();
      loaded = true;
      for (const name of ['url', 'api', 'articlePath', 'mode', 'format']) {
        if (typeof saved[name] === 'string') form.elements[name].value = saved[name];
      }
      if (!form.elements.api.value) dialog.querySelector('details').open = true;
    } catch (err) { status.textContent = err.message; }
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    status.textContent = 'Publishing…';
    const payload = Object.fromEntries(new FormData(form));
    try {
      const pad = require('ep_etherpad-lite/static/js/pad').pad;
      const editor = require('ep_etherpad-lite/static/js/pad_editor').padeditor.ace;
      if (!pad.collabClient || pad.collabClient.hasUnacceptedCommit()) throw new Error('Pad is still saving. Wait a moment, then publish again.');
      payload.expectedRevision = pad.collabClient.getCurrentRevisionNumber();
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(editor.exportText()));
      payload.textHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
      const response = await fetch(endpoint, {method: 'POST', credentials: 'same-origin',
        headers: {'Content-Type': 'application/json', 'X-Etherpad-Publish': '1'}, body: JSON.stringify(payload)});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Publication failed.');
      status.textContent = result.unchanged ? 'Already up to date. ' : `Published pad revision ${result.padRevision}. `;
      const link = document.createElement('a');
      link.href = payload.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open wiki page';
      status.appendChild(link);
      if (result.archive) status.appendChild(document.createTextNode(`\nPrevious content archived at ${result.archive}`));
      if (result.warning) status.appendChild(document.createTextNode(`\n${result.warning}`));
    } catch (err) { status.textContent = err.message; }
    finally { payload.password = ''; submit.disabled = false; }
  };
};
