'use strict';
const {randomUUID} = require('node:crypto');
const {validateApi} = require('./http');
function destination(value, api, articlePath = '/wiki/') {
  const url = new URL(value); const endpoint = validateApi(api);
  if (url.protocol !== 'https:' || url.origin !== endpoint.origin || url.username || url.password) {
    throw new Error('Destination must be an HTTPS page on the same origin as the configured wiki API.');
  }
  if (!articlePath.startsWith('/') || !articlePath.endsWith('/')) throw new Error('Article path must start and end with /.');
  let title = url.searchParams.get('title');
  if (!title) {
    if (!url.pathname.startsWith(articlePath)) throw new Error(`Destination must use ${articlePath} or an index.php?title= URL.`);
    title = decodeURIComponent(url.pathname.slice(articlePath.length));
  }
  title = title.replace(/_/g, ' ').trim();
  if (!title || /[\x00-\x1f\x7f#<>\[\]{}|]/.test(title) || title.length > 240 ||
      /^(Special|Media|MediaWiki|File|Image|Template|Module|User|Category):/i.test(title) ||
      /\.(js|css|json)$/i.test(title)) throw new Error('Use an ordinary content page title (1–240 characters).');
  return title;
}
async function publish({transport, title, username, password, text, mode, summary = 'Published from Etherpad'}) {
  if (!['replace', 'archive'].includes(mode)) throw new Error('Unknown publishing mode.');
  if (!text.trim()) throw new Error('Empty pads are not published.');
  if (!username || !password) throw new Error('Enter a wiki bot username and bot password.');
  const loginToken = (await transport.call({action: 'query', meta: 'tokens', type: 'login'})).query?.tokens?.logintoken;
  if (!loginToken) throw new Error('Wiki did not return a login token.');
  const login = await transport.call({action: 'login', lgname: username, lgpassword: password, lgtoken: loginToken});
  if (login.login?.result !== 'Success') throw new Error('Wiki login failed. Check the bot username and password.');
  const data = await transport.call({action: 'query', meta: 'tokens', prop: 'revisions', titles: title,
    rvprop: 'ids|content|timestamp', rvslots: 'main', curtimestamp: '1'});
  const page = data.query?.pages?.[0]; const token = data.query?.tokens?.csrftoken;
  if (!page || page.invalid || !token) throw new Error('Unable to read destination page or edit token.');
  const revision = page.revisions?.[0];
  const oldText = revision?.slots?.main?.content;
  if (!page.missing && typeof oldText !== 'string') throw new Error('Existing page content is inaccessible.');
  if (!page.missing && revision.slots.main.contentmodel && revision.slots.main.contentmodel !== 'wikitext') {
    throw new Error('Destination is not a wikitext page.');
  }
  if (oldText === text) return {unchanged: true, title};
  let archive;
  if (mode === 'archive' && !page.missing) {
    archive = `${page.title}/Archive/${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
    const result = await transport.call({action: 'edit', title: archive, text: oldText, createonly: '1',
      summary: `Snapshot of [[${page.title}]] revision ${revision.revid} before Etherpad publication`, token});
    if (result.edit?.result !== 'Success') throw new Error('Archive was not confirmed; destination was not changed.');
  }
  try {
    const result = await transport.call({action: 'edit', title: page.title || title, text,
      ...(page.missing ? {createonly: '1'} : {nocreate: '1', baserevid: revision.revid,
        basetimestamp: revision.timestamp}), starttimestamp: data.curtimestamp,
      summary: summary.slice(0, 250), token});
    if (result.edit?.result !== 'Success') throw new Error('Wiki did not confirm publication. Check the page before retrying.');
    return {title: page.title || title, revision: result.edit.newrevid, archive};
  } catch (err) {
    if (archive) throw new Error(`${err.message} Archive saved at ${archive}.`);
    throw err;
  }
}
module.exports = {destination, publish};
