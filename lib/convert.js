'use strict';
const {parseDocument} = require('htmlparser2');
const literal = (s) => s ? `<nowiki>${s.replace(/<\/nowiki\s*>/gi, '&lt;/nowiki&gt;')}</nowiki>` : '';
const convert = (html) => {
  const doc = parseDocument(html);
  const children = (node, prefix = '') => (node.children || []).map((n) => render(n, prefix)).join('');
  const render = (node, prefix = '') => {
    if (node.type === 'text') return literal(node.data);
    if (!node.name) return children(node, prefix);
    const name = node.name.toLowerCase();
    if (['script', 'style'].includes(name)) return '';
    if (name === 'br') return '\n';
    if (name === 'ul' || name === 'ol') return children(node, prefix + (name === 'ul' ? '*' : '#'));
    if (name === 'li') {
      let out = `\n${prefix || '*'} `;
      for (const child of node.children || []) out += render(child, prefix);
      return out + '\n';
    }
    const inner = children(node, prefix);
    if (/^h[1-6]$/.test(name)) { const marks = '='.repeat(Number(name[1])); return `\n${marks} ${inner} ${marks}\n`; }
    if (name === 'b' || name === 'strong') return `'''${inner}'''`;
    if (name === 'i' || name === 'em') return `''${inner}''`;
    if (name === 'u') return `<u>${inner}</u>`;
    if (name === 's' || name === 'del' || name === 'strike') return `<s>${inner}</s>`;
    if (name === 'a') {
      const href = node.attribs?.href || '';
      if (/^https?:\/\/[^\s<>\[\]"{}|]+$/i.test(href)) return `[${href} ${inner}]`;
      return inner;
    }
    if (name === 'p') return `${inner}\n\n`;
    if (name === 'div') return `${inner}\n`;
    if (name === 'img') return literal(node.attribs?.alt || '[Image omitted]');
    return inner;
  };
  return children(doc).replace(/\n{2,}(?=[*#])/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
};
module.exports = {convert};
