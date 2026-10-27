/** Build-time localization of an explicit public corpus. No runtime translation service. */
import { createHash } from 'node:crypto';

export const languages = [
  { code: 'en', name: 'English' }, { code: 'fr', name: 'Français' },
  { code: 'it', name: 'Italiano' }, { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' }, { code: 'pt', name: 'Português' },
  { code: 'ja', name: '日本語' }, { code: 'ko', name: '한국어' },
];
export const localeCodes = languages.map(language => language.code);
const openGraphLocales = { en: 'en_US', fr: 'fr_FR', it: 'it_IT', de: 'de_DE', es: 'es_ES', pt: 'pt_PT', ja: 'ja_JP', ko: 'ko_KR' };
const hash = value => createHash('sha256').update(value).digest('hex');
const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const ignored = new Set(['script', 'style', 'canvas', 'path', 'circle', 'line', 'ellipse', 'rect', 'polygon', 'polyline', 'defs', 'use']);
const inline = new Set(['a', 'abbr', 'b', 'br', 'cite', 'code', 'em', 'i', 'mark', 's', 'small', 'span', 'strong', 'sub', 'sup', 'u', 'wbr']);
const candidates = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'a', 'button', 'label', 'summary', 'dt', 'dd', 'th', 'td', 'figcaption', 'blockquote', 'span', 'div', 'text', 'tspan', 'noscript']);
const entityMap = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', copy: '©', reg: '®', trade: '™', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', bull: '•', middot: '·', larr: '←', rarr: '→', times: '×' };
export function decodeText(value) {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (entity, name) => {
    if (name[0] !== '#') return entityMap[name.toLowerCase()] ?? entity;
    const hex = name[1]?.toLowerCase() === 'x';
    const code = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (!code || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) throw new Error('Invalid text entity');
    return String.fromCodePoint(code);
  });
}
export const normalizeText = value => decodeText(value).replace(/\s+/gu, ' ').trim();
export const escapeText = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const escapeAttribute = value => escapeText(value).replace(/"/g, '&quot;');
export const unitId = source => hash(normalizeText(source)).slice(0, 16);
const attribute = (node, key) => decodeText(node.token?.attrs.get(key)?.raw ?? '');
const translatable = source => /[A-Za-z]/.test(source) && !/^(?:Vektorium(?: Inc\.?)?|Cypher Sentinel|VEKTORIUM|https?:\/\/\S+|[\w.+-]+@[\w.-]+)$/i.test(source);

function tree(html, tokenize) {
  const document = { name: '#document', children: [], start: 0, end: html.length };
  const stack = [document];
  let cursor = 0;
  function text(start, end) {
    if (end <= start) return;
    const value = html.slice(start, end);
    if (!value.replace(/<!--[\s\S]*?-->|<![^>]*>/g, '').trim()) return;
    stack.at(-1).children.push({ name: '#text', start, end, value });
  }
  for (const token of tokenize(html)) {
    text(cursor, token.start);
    cursor = token.end;
    if (token.closing) {
      const position = stack.findLastIndex(node => node.name === token.name);
      if (position < 1) throw new Error(`Unmatched closing ${token.name}`);
      const node = stack[position];
      node.closeStart = token.start;
      node.end = token.end;
      stack.length = position;
      continue;
    }
    const node = { name: token.name, token, children: [], start: token.start, openEnd: token.openEnd ?? token.end, end: token.end };
    stack.at(-1).children.push(node);
    if (token.body !== undefined) node.body = token.body;
    else if (!voidTags.has(token.name) && !/\/\s*>$/.test(token.raw)) stack.push(node);
  }
  text(cursor, html.length);
  if (stack.length !== 1) throw new Error('Unclosed localization document');
  return document;
}

/** Numbered placeholders retain reviewed inline tags and their exact attributes. */
function inlineUnit(node, html) {
  const placeholders = [];
  function visit(child) {
    if (child.name === '#text') return decodeText(child.value.replace(/<!--[\s\S]*?-->/g, ''));
    if (!inline.has(child.name) && child.name !== 'svg' && child.name !== 'img') throw new Error('Non-inline localization child');
    const number = placeholders.length;
    const opaque = child.name === 'svg' || child.name === 'img' || voidTags.has(child.name);
    placeholders.push({ open: opaque ? html.slice(child.start, child.end) : html.slice(child.start, child.openEnd), close: opaque ? '' : html.slice(child.closeStart, child.end), start: child.start, openEnd: opaque ? child.end : child.openEnd, opaque });
    return opaque ? `<${number}/>` : `<${number}>${child.children.map(visit).join('')}</${number}>`;
  }
  return { source: normalizeText(node.children.map(visit).join('')), placeholders };
}
function onlyInline(node) {
  const svgHasText = child => child.name === '#text' ? /[A-Za-z]/.test(child.value) : /[A-Za-z]/.test(child.body ?? '') || child.children.some(svgHasText);
  return node.children.every(child => child.name === '#text' || child.name === 'img' || child.name === 'svg' && !svgHasText(child) || inline.has(child.name) && onlyInline(child));
}

export function extractUnits(page, html, tokenize) {
  const units = [];
  const add = (source, detail) => {
    source = normalizeText(source);
    if (translatable(source)) units.push({ id: unitId(source), source, page, ...detail });
  };
  function visit(node, withinSelected = false) {
    if (node.name === '#text') {
      if (!withinSelected) add(node.value.replace(/<!--[\s\S]*?-->|<![^>]*>/g, ''), { kind: 'text', start: node.start, end: node.end, placeholders: [] });
      return;
    }
    if (node.token) {
      for (const key of ['alt', 'aria-label', 'title', 'placeholder']) {
        const attr = node.token.attrs.get(key);
        if (attr && attr.raw) add(attr.raw, { kind: 'attribute', attribute: key, start: node.token.start + attr.start, end: node.token.start + attr.end });
      }
      if (node.name === 'meta' && ['description', 'keywords', 'og:title', 'og:description', 'og:image:alt', 'twitter:title', 'twitter:description', 'twitter:image:alt'].includes(attribute(node, 'name') || attribute(node, 'property'))) {
        const attr = node.token.attrs.get('content');
        if (attr) add(attr.raw, { kind: 'attribute', attribute: 'content', start: node.token.start + attr.start, end: node.token.start + attr.end });
      }
      if (node.name === 'title') add(node.body, { kind: 'text', start: node.openEnd, end: node.end - '</title>'.length, placeholders: [] });
      if (node.name === 'script' && attribute(node, 'type') === 'application/ld+json') {
        const data = JSON.parse(node.body);
        const humanFields = new Set(['name', 'description', 'headline', 'text', 'articleBody', 'abstract', 'keywords', 'slogan', 'caption', 'alternateName', 'featureList', 'knowsAbout', 'jobTitle', 'contactType']);
        function strings(value, path = [], field = '') {
          if (typeof value === 'string' && humanFields.has(field)) add(value, { kind: 'schema', schemaStart: node.start, path });
          else if (Array.isArray(value)) value.forEach((item, index) => strings(item, [...path, index], field));
          else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) strings(child, [...path, key], key);
        }
        strings(data);
      }
    }
    if (ignored.has(node.name) || attribute(node, 'translate') === 'no' || node.token?.attrs.has('data-i18n-ignore')) return;
    let selected = withinSelected;
    if (!selected && candidates.has(node.name) && onlyInline(node) && node.closeStart !== undefined && node.children.length) {
      const unit = inlineUnit(node, html);
      add(unit.source, { kind: 'html', start: node.openEnd, end: node.closeStart, placeholders: unit.placeholders });
      selected = true;
    }
    for (const child of node.children) visit(child, selected);
  }
  visit(tree(html, tokenize));
  // An inline attribute inside a selected paragraph is rendered through its
  // retained placeholder, and therefore must not also be an overlapping edit.
  const blocks = units.filter(unit => unit.kind === 'html');
  for (const unit of units) if (unit.kind === 'attribute') unit.container = blocks.find(block => unit.start >= block.start && unit.end <= block.end);
  return units;
}

export function createCatalog(sources, tokenize, runtime = []) {
  const catalogue = new Map();
  function add(unit) {
    const existing = catalogue.get(unit.id);
    if (existing && existing.source !== unit.source) throw new Error('Translation identifier collision');
    if (existing) {
      if (!existing.pages.includes(unit.page)) existing.pages.push(unit.page);
      if (!existing.kinds.includes(unit.kind)) existing.kinds.push(unit.kind);
    } else catalogue.set(unit.id, { id: unit.id, source: unit.source, pages: [unit.page], kinds: [unit.kind] });
  }
  for (const [page, html] of sources) for (const unit of extractUnits(page, html, tokenize)) add(unit);
  for (const source of runtime) add({ id: unitId(source), source: normalizeText(source), page: '@runtime', kind: 'runtime' });
  const units = [...catalogue.values()];
  return { version: 1, sourceLanguage: 'en', sourceHash: hash(JSON.stringify(units.map(unit => [unit.id, unit.source]))), units };
}

export function placeholderTokens(source) { return source.match(/<\/?\d+\s*\/?>/g) ?? []; }
export function validateTranslation(source, translated) {
  if (typeof translated !== 'string' || !translated.trim() || translated.includes('\0')) throw new Error('Missing or invalid translation');
  const expected = placeholderTokens(source).sort();
  const actual = placeholderTokens(translated).sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('Translation placeholders changed');
  const stack = [];
  for (const token of placeholderTokens(translated)) {
    if (token.endsWith('/>')) continue;
    if (token.startsWith('</')) {
      if (stack.pop() !== token.slice(2, -1)) throw new Error('Translation placeholders are not properly nested');
    } else stack.push(token.slice(1, -1));
  }
  if (stack.length) throw new Error('Unclosed translation placeholder');
  if (/<[^>]*>/.test(translated.replace(/<\/?\d+\s*\/?>/g, ''))) throw new Error('Translations may not add markup');
  if (JSON.stringify(source.match(/\{[a-z]+\}/g) ?? []) !== JSON.stringify(translated.match(/\{[a-z]+\}/g) ?? [])) throw new Error('Runtime placeholders changed');
}

export function applyTextEdits(html, edits) {
  let boundary = html.length;
  for (const edit of [...edits].sort((a, b) => b.start - a.start || b.end - a.end)) {
    if (edit.end > boundary || edit.start > edit.end) throw new Error('Overlapping localization edits');
    html = html.slice(0, edit.start) + edit.text + html.slice(edit.end);
    boundary = edit.start;
  }
  return html;
}

export function checkCatalogue(source, locale, code) {
  if (locale?.version !== 1 || locale.locale !== code || locale.sourceHash !== source.sourceHash || !locale.translations || typeof locale.translations !== 'object') throw new Error(`${code}: stale or malformed translation catalogue`);
  const known = new Set(source.units.map(unit => unit.id));
  const scales = { million: 1000000n, billion: 1000000000n, trillion: 1000000000000n, '百万': 1000000n, '千万': 10000000n, '千億': 100000000000n, '万': 10000n, '億': 100000000n, '兆': 1000000000000n, '백만': 1000000n, '천만': 10000000n, '만': 10000n, '억': 100000000n, '조': 1000000000000n };
  const numeric = text => {
    text = text.replace(/<\/?\d+\s*\/?>/g, '');
    if (!['ja', 'ko'].includes(code)) return (text.match(/\d+(?:[,.]\d+)*/g) ?? []).map(number => number.replace(/[,.]/g, '')).sort();
    // Japanese/Korean group large amounts by ten-thousands. Preserve values,
    // e.g. English 20 million = Japanese 2,000万 = Korean 2,000만.
    return [...text.matchAll(/(\d+(?:[,.]\d+)*)(?:\s*(trillion|billion|million|百万|千万|千億|万|億|兆|백만|천만|만|억|조))?/gi)].map(([, number, scale]) => {
      if (!scale) return number.replace(/[,.]/g, '');
      const [integer, decimal = ''] = number.replace(/,/g, '').split('.');
      const numerator = BigInt(integer + decimal) * scales[scale.toLowerCase()];
      const denominator = 10n ** BigInt(decimal.length);
      return numerator % denominator === 0n ? String(numerator / denominator) : `${numerator}/${denominator}`;
    }).sort();
  };
  for (const key of Object.keys(locale.translations)) if (!known.has(key)) throw new Error(`${code}: unknown translation ${key}`);
  for (const unit of source.units) {
    try {
      const translated = locale.translations[unit.id];
      validateTranslation(unit.source, translated);
      if (JSON.stringify(numeric(unit.source)) !== JSON.stringify(numeric(translated))) throw new Error('Numerical claims changed');
      for (const name of ['Vektorium', 'Cypher Sentinel', 'Massimo Prando']) {
        const occurrences = text => (text.toLowerCase().match(new RegExp(name.toLowerCase(), 'g')) ?? []).length;
        if (occurrences(unit.source) !== occurrences(translated)) throw new Error(`Protected name changed: ${name}`);
      }
      if (unit.source === translated && unit.source.split(/\s+/).length > 15 && /[.!?]$/.test(unit.source)) throw new Error('Untranslated English paragraph');
    }
    catch (error) { throw new Error(`${code}/${unit.id}: ${error.message}`); }
  }
}

export function translator(locale) {
  return source => {
    if (!locale) return normalizeText(source);
    const id = unitId(source);
    if (typeof locale.translations[id] !== 'string') throw new Error(`${locale.locale}: untranslated text: ${source.slice(0, 100)}`);
    return locale.translations[id];
  };
}

export const pagePath = page => page === 'index.html' ? '/' : '/' + page.replace(/\.html$/, '');
export function localizedPath(page, code) {
  if (!localeCodes.includes(code)) throw new Error('Unknown language');
  return code === 'en' ? pagePath(page) : '/' + code + (page === 'index.html' ? '' : pagePath(page));
}
export const localizedFile = (page, code) => code === 'en' ? page : page === 'index.html' ? `${code}.html` : `${code}/${page}`;

export function localizeContent(page, html, translate, units, tokenize, code) {
  const edits = [];
  const attributes = units.filter(unit => unit.kind === 'attribute');
  const attributeEdit = unit => ({ start: unit.start, end: unit.end, text: ` ${unit.attribute}="${escapeAttribute(translate(unit.source))}"` });
  for (const unit of units) {
    if (unit.kind === 'attribute') { if (!unit.container) edits.push(attributeEdit(unit)); continue; }
    if (!['html', 'text'].includes(unit.kind)) continue;
    let text = escapeText(translate(unit.source));
    if (unit.kind === 'html') {
      const placeholders = unit.placeholders.map(holder => ({ ...holder, open: applyTextEdits(holder.open, attributes.filter(attr => attr.start >= holder.start && attr.end <= holder.openEnd).map(attr => {
        const edit = attributeEdit(attr); return { ...edit, start: edit.start - holder.start, end: edit.end - holder.start };
      })) }));
      text = text.replace(/&lt;(\/?)(\d+)(\/?)&gt;/g, (_, close, id, self) => {
        const holder = placeholders[Number(id)];
        if (!holder || Boolean(self) !== holder.opaque && !close) throw new Error('Invalid inline placeholder');
        return close ? holder.close : holder.open;
      });
    }
    edits.push({ start: unit.start, end: unit.end, text });
  }
  for (const token of tokenize(html)) if (token.name === 'script' && token.attrs.get('type')?.raw === 'application/ld+json') {
    const schema = JSON.parse(token.body);
    for (const unit of units.filter(unit => unit.kind === 'schema' && unit.schemaStart === token.start)) {
      let target = schema;
      for (const key of unit.path.slice(0, -1)) target = target[key];
      target[unit.path.at(-1)] = translate(unit.source);
    }
    function language(value) {
      if (Array.isArray(value)) value.forEach(language);
      else if (value && typeof value === 'object') {
        if (['WebPage', 'AboutPage', 'ContactPage', 'CollectionPage', 'Article', 'TechArticle', 'Blog', 'BlogPosting', 'FAQPage', 'WebSite'].includes(value['@type'])) value.inLanguage = code;
        for (const child of Object.values(value)) language(child);
      }
    }
    language(schema);
    edits.push({ start: token.openEnd, end: token.end - '</script>'.length, text: JSON.stringify(schema).replace(/</g, '\\u003c') });
  }
  return applyTextEdits(html, edits);
}

const globe = '<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></svg>';
export function languageMenu(page, code, placement, translate) {
  const label = `${translate('Choose language')} (${languages.find(language => language.code === code).name})`;
  return `<details class="vx-language vx-language-${placement}" data-search-ignore><summary class="vx-language-toggle" aria-label="${escapeAttribute(label)}" aria-controls="vx-language-${placement}-panel">${globe}</summary><nav class="vx-language-panel" id="vx-language-${placement}-panel" aria-label="${escapeAttribute(translate('Language'))}"><p class="vx-language-heading">${escapeText(translate('Choose language'))}</p>${languages.map(language => `<a href="${localizedPath(page, language.code)}" lang="${language.code}" hreflang="${language.code}"${code === language.code ? ' aria-current="true"' : ''}><span>${language.name}</span>${code === language.code ? '<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg>' : ''}</a>`).join('')}</nav></details>`;
}

export function rewriteLocaleShell(page, html, code, translate, tokenize, readAttribute, knownPages) {
  const edits = [];
  const origin = 'https://vektorium.io';
  const canonical = origin + localizedPath(page, code);
  const known = new Map([...knownPages].map(source => [pagePath(source), source]));
  function route(value, resource = false) {
    if (!value || value.startsWith('#') || /^(?:mailto:|tel:|data:)/i.test(value)) return value;
    const url = new URL(value, origin + '/' + page);
    if (url.origin !== origin) return value;
    if (resource) return url.pathname + url.search + url.hash;
    let path = url.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
    if (path === '/index') path = '/';
    const source = known.get(path);
    return (source ? localizedPath(source, code) : url.pathname) + url.search + url.hash;
  }
  const tokens = tokenize(html);
  const nodes = [];
  const stack = [];
  for (const token of tokens) {
    if (token.closing) {
      const at = stack.findLastIndex(node => node.token.name === token.name);
      if (at >= 0) { stack[at].close = token; stack.length = at; }
      continue;
    }
    const node = { token, parent: stack.at(-1) };
    nodes.push(node);
    if (token.body === undefined && !voidTags.has(token.name) && !/\/\s*>$/.test(token.raw)) stack.push(node);
  }
  const hasClass = (node, name) => (readAttribute(node.token, 'class') || '').split(/\s+/).includes(name);
  const mobile = nodes.find(node => hasClass(node, 'vx-mobile-header'));
  const brand = nodes.find(node => node.parent === mobile && hasClass(node, 'vx-mobile-brand'));
  if (!brand?.close) throw new Error(`${page}: missing mobile language placement`);
  edits.push({ start: brand.close.end, end: brand.close.end, text: languageMenu(page, code, 'mobile', translate) });
  if (page === 'index.html') {
    const toggle = nodes.find(node => readAttribute(node.token, 'id') === 'vx-search-toggle');
    if (!toggle?.close) throw new Error('Missing homepage search anchor');
    edits.push({ start: toggle.token.start, end: toggle.token.start, text: '<div class="vx-home-tools">' });
    edits.push({ start: toggle.close.end, end: toggle.close.end, text: languageMenu(page, code, 'home', translate) + '</div>' });
  } else {
    const menu = nodes.find(node => hasClass(node, 'vx-desktop-menu'));
    if (!menu?.close) throw new Error(`${page}: missing desktop language placement`);
    edits.push({ start: menu.close.end, end: menu.close.end, text: languageMenu(page, code, 'desktop', translate) });
  }
  if (code !== 'en') for (const node of nodes) {
    if (node.token.name !== 'a' || !node.close) continue;
    const href = readAttribute(node.token, 'href') || '';
    if (!/^https:\/\/(?:mobile-)?demo\.vektorium\.io(?:\/|$)/.test(href)) continue;
    const label = translate('Demo (English)');
    const extra = (node.token.attrs.has('hreflang') ? '' : ' hreflang="en"') + (node.token.attrs.has('title') ? '' : ` title="${escapeAttribute(label)}"`);
    if (extra) edits.push({ start: node.token.end - 1, end: node.token.end - 1, text: extra });
    const standalone = ['vx-mobile-demo', 'cta-btn', 'cta'].some(name => hasClass(node, name)) || node.parent && ['vx-menu-actions', 'header-left'].some(name => hasClass(node.parent, name));
    if (standalone && !html.slice(node.token.end, node.close.start).includes('<')) edits.push({ start: node.token.end, end: node.close.start, text: escapeText(label) });
  }
  for (const token of tokens) {
    if (token.closing) {
      if (token.name === 'head') {
        const alternates = languages.map(language => `<link rel="alternate" hreflang="${language.code}" href="${origin + localizedPath(page, language.code)}">`).join('\n');
        const fonts = `<link rel="stylesheet" href="/assets/language-fonts.css">\n` + (['ja', 'ko'].includes(code) ? `<link rel="stylesheet" href="/assets/cjk-${code}.css">\n` : '');
        const socialLocales = `<meta property="og:locale" content="${openGraphLocales[code]}">\n` + languages.filter(language => language.code !== code).map(language => `<meta property="og:locale:alternate" content="${openGraphLocales[language.code]}">`).join('\n');
        edits.push({ start: token.start, end: token.start, text: `${alternates}\n<link rel="alternate" hreflang="x-default" href="${origin + pagePath(page)}">\n${socialLocales}\n<link rel="stylesheet" href="/assets/languages.css">\n${fonts}<script src="/assets/languages.js" defer></script>\n` });
      }
      continue;
    }
    if (token.name === 'html') {
      const attr = token.attrs.get('lang');
      if (!attr) throw new Error('Missing source language');
      edits.push({ start: token.start + attr.start, end: token.start + attr.end, text: ` lang="${code}"` });
    }
    if (token.name === 'link' && readAttribute(token, 'rel') === 'alternate' && token.attrs.has('hreflang')) { edits.push({ start: token.start, end: token.end, text: '' }); continue; }
    if (token.name === 'meta' && ['og:locale', 'og:locale:alternate'].includes(readAttribute(token, 'property'))) { edits.push({ start: token.start, end: token.end, text: '' }); continue; }
    for (const key of ['href', 'src', 'poster']) {
      const attr = token.attrs.get(key);
      if (!attr) continue;
      const original = readAttribute(token, key);
      const resource = key !== 'href' || token.name === 'link';
      let value = token.name === 'link' && readAttribute(token, 'rel') === 'canonical' ? canonical : route(original, resource);
      if (code !== 'en' && token.name === 'script' && ['/assets/home-search.js', '/assets/privacy-controls.js'].includes(value)) value = `/assets/localized/${code}/${value.split('/').at(-1)}`;
      if (value !== original) edits.push({ start: token.start + attr.start, end: token.start + attr.end, text: ` ${key}="${escapeAttribute(value)}"` });
    }
    if (token.attrs.has('srcset')) {
      const attr = token.attrs.get('srcset');
      const original = readAttribute(token, 'srcset');
      const value = original.split(',').map(part => { const [url, ...rest] = part.trim().split(/\s+/); return [route(url, true), ...rest].join(' '); }).join(', ');
      if (original !== value) edits.push({ start: token.start + attr.start, end: token.start + attr.end, text: ` srcset="${escapeAttribute(value)}"` });
    }
    if (token.name === 'meta' && ['og:url', 'twitter:url'].includes(readAttribute(token, 'property') || readAttribute(token, 'name'))) {
      const attr = token.attrs.get('content');
      if (attr) edits.push({ start: token.start + attr.start, end: token.start + attr.end, text: ` content="${canonical}"` });
    }
    if (code !== 'en' && token.name === 'script' && readAttribute(token, 'type') === 'application/ld+json') {
      const data = JSON.parse(token.body);
      function urls(value, key = '') {
        if (typeof value === 'string' && value.startsWith(origin) && ['url', '@id', 'item', 'mainEntityOfPage'].includes(key)) {
          if (key === '@id' && /#(?:organization|person|founder|software|product|website)$/.test(value)) return value;
          return origin + route(value);
        }
        if (Array.isArray(value)) return value.map(item => urls(item, key));
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, child]) => [k, urls(child, k)]));
        return value;
      }
      edits.push({ start: token.openEnd, end: token.end - '</script>'.length, text: JSON.stringify(urls(data)).replace(/</g, '\\u003c') });
    }
  }
  return applyTextEdits(html, edits);
}
