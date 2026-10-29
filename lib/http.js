'use strict';
const https = require('node:https');
const dns = require('node:dns').promises;
const ipaddr = require('ipaddr.js');
const {CookieJar} = require('tough-cookie');

const isPublic = (address) => {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
};
const validateApi = (value) => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      !url.pathname.endsWith('/api.php') || (url.port && url.port !== '443')) {
    throw new Error('Use an HTTPS MediaWiki API URL ending in /api.php, without a query or custom port.');
  }
  return url;
};

// Resolve and pin a public IP for each request. Never follow redirects or send
// cookies/credentials to a destination inferred from wiki page content.
class Transport {
  constructor(api, {lookup = dns.lookup, request = https.request} = {}) {
    this.url = validateApi(api); this.lookup = lookup; this.request = request;
    this.jar = new CookieJar();
  }
  async call(params) {
    const url = this.url;
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = await this.lookup(hostname, {all: true});
    if (!addresses.length || addresses.some(({address}) => !isPublic(address))) {
      throw new Error('Wiki API must resolve only to public Internet addresses.');
    }
    const selected = addresses[0];
    const body = new URLSearchParams({...params, format: 'json', formatversion: '2'}).toString();
    const cookie = await this.jar.getCookieString(url.href);
    const response = await new Promise((resolve, reject) => {
      const req = this.request(url, {
        method: 'POST', agent: false,
        lookup: (_host, options, cb) => options?.all
          ? cb(null, [selected]) : cb(null, selected.address, selected.family),
        headers: {'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body), 'User-Agent': 'ep_publish_mediawiki/0.1.0',
          ...(cookie ? {Cookie: cookie} : {})},
      }, (res) => {
        let size = 0; const chunks = [];
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > 5 * 1024 * 1024) res.destroy(new Error('Wiki response exceeds 5 MB.'));
          else chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => resolve({status: res.statusCode, headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8')}));
      });
      req.setTimeout(20000, () => req.destroy(new Error('Wiki request timed out. Check the wiki before retrying.')));
      req.on('error', reject); req.end(body);
    });
    if (response.status !== 200) throw new Error(`Wiki returned HTTP ${response.status}; redirects are not followed. Check the API URL.`);
    for (const cookie of response.headers['set-cookie'] || []) await this.jar.setCookie(cookie, url.href);
    let data;
    try { data = JSON.parse(response.body); } catch { throw new Error('Wiki did not return JSON. Check the API URL and access restrictions.'); }
    if (data.error) {
      // Do not echo remote responses: they can contain submitted content or credentials.
      const code = String(data.error.code || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
      throw new Error(`MediaWiki error: ${code}.`);
    }
    return data;
  }
}
module.exports = {Transport, validateApi, isPublic};
