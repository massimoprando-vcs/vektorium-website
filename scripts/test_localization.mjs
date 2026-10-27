/** Localization safety, complete routing and multilingual search regressions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareBuild, mobilePages, publicPages, prepareHtml, htmlTokens, attr, inspectHtml } from './build.mjs';
import { languages, createCatalog, extractUnits, localizeContent, rewriteLocaleShell, validateTranslation, checkCatalogue, translator, localizedPath, localizedFile, unitId } from './localization.mjs';
import { translateScript } from './localization-runtime.mjs';
import { prepareSearchIndex, rankSearch, normalizeSearch } from '../assets/search-engine.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = JSON.parse(readFileSync(resolve(root, 'locales/source.json'), 'utf8'));

test('the approved eight languages retain their exact order and clean routes', () => {
  assert.deepEqual(languages.map(language => language.code), ['en', 'fr', 'it', 'de', 'es', 'pt', 'ja', 'ko']);
  assert.deepEqual(languages.map(language => language.name), ['English', 'Français', 'Italiano', 'Deutsch', 'Español', 'Português', '日本語', '한국어']);
  assert.equal(localizedPath('index.html', 'en'), '/');
  assert.equal(localizedPath('index.html', 'ja'), '/ja');
  assert.equal(localizedPath('architecture.html', 'ko'), '/ko/architecture');
  assert.equal(localizedFile('index.html', 'fr'), 'fr.html');
  assert.equal(localizedFile('architecture.html', 'fr'), 'fr/architecture.html');
  assert.throws(() => localizedPath('index.html', 'xx'));
});

test('inline structure can move naturally but markup and claims cannot be invented', () => {
  const english = 'Use <0>90 engines</0> with <1>Cypher Sentinel</1>.<2/>';
  assert.doesNotThrow(() => validateTranslation(english, '<1>Cypher Sentinel</1>と<0>90のエンジン</0>を使用します。<2/>'));
  for (const invalid of ['<0>Missing link</0>', '<0><1>Wrong nesting</0></1><2/>', '<0>Text</0><1>Text</1><2/><img src=x>', '<0>Text</0><1>Text</1><2/><2/>']) assert.throws(() => validateTranslation(english, invalid));
  assert.throws(() => validateTranslation('{count} results', 'Résultats'));
  const fixture = { version: 1, sourceHash: 'test', units: [{ id: unitId(english), source: english }] };
  const locale = { version: 1, locale: 'fr', sourceHash: 'test', translations: { [unitId(english)]: 'Utilisez <0>90 moteurs</0> avec <1>Cypher Sentinel</1>.<2/>' } };
  assert.doesNotThrow(() => checkCatalogue(fixture, locale, 'fr'));
  assert.throws(() => checkCatalogue(fixture, { ...locale, sourceHash: 'old' }, 'fr'), /stale/);
  assert.throws(() => checkCatalogue(fixture, { ...locale, translations: { [unitId(english)]: locale.translations[unitId(english)].replace('90', '900') } }, 'fr'), /Numerical/);
  assert.throws(() => checkCatalogue(fixture, { ...locale, translations: {} }, 'fr'), /Missing/);
});

test('whole paragraphs translate while retaining safe original tags and translated accessible labels', () => {
  const html = '<html lang="en"><head><title>Original title</title><meta name="description" content="Original description"><meta property="og:image:alt" content="Original image description"><meta name="twitter:image:alt" content="Original image description"></head><body><p>Use <a href="/architecture" aria-label="Read architecture">our architecture</a> with <strong>90 engines</strong>.</p><script>const unchanged = 42;</script></body></html>';
  const units = extractUnits('example.html', html, htmlTokens);
  const paragraph = units.find(unit => unit.kind === 'html' && unit.source.startsWith('Use'));
  const mapping = new Map([
    ['Original title', 'Titre traduit'], ['Original description', 'Description traduite'],
    ['Read architecture', 'Lire notre architecture'],
    ['Original image description', 'Description de l’image traduite'],
    [paragraph.source, 'Utilisez <0>notre architecture</0> avec <1>90 moteurs</1>.'],
  ]);
  const localized = localizeContent('example.html', html, text => mapping.get(text), units, htmlTokens, 'fr');
  assert.ok(localized.includes('<a href="/architecture" aria-label="Lire notre architecture">notre architecture</a>'));
  assert.ok(localized.includes('<strong>90 moteurs</strong>'));
  assert.ok(localized.includes('<script>const unchanged = 42;</script>'));
  assert.ok(localized.includes('content="Description traduite"'));
  assert.equal((localized.match(/content="Description de l’image traduite"/g) || []).length, 2);
});

test('large Japanese and Korean amounts preserve their value across different counting scales', () => {
  const english = 'A €20 million limit, a $250 billion market and 1 trillion US$ in 5-7 years.';
  const fixture = { version: 1, sourceHash: 'amounts', units: [{ id: unitId(english), source: english }] };
  for (const [code, value] of [['ja', '上限2,000万ユーロ、2,500億ドルの市場、5-7年後には1兆米ドル。'], ['ko', '한도2,000만 유로, 시장2,500억 달러, 5-7년 후1조 미국 달러.']]) {
    const locale = { version: 1, locale: code, sourceHash: 'amounts', translations: { [unitId(english)]: value } };
    assert.doesNotThrow(() => checkCatalogue(fixture, locale, code));
    assert.throws(() => checkCatalogue(fixture, { ...locale, translations: { [unitId(english)]: value.replace('2,500', '250') } }, code), /Numerical/);
  }
});

test('technical articles and blog collections identify their translated language in structured data', () => {
  const html = '<html lang="en"><head><title>Articles</title><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"TechArticle","headline":"Technical article","featureList":["90 engines","Human approval"]},{"@type":"Blog","name":"Company blog","knowsAbout":["Cybersecurity"]}]}</script></head><body><p>Article content.</p></body></html>';
  const localized = localizeContent('blog.html', html, text => 'FR: ' + text, extractUnits('blog.html', html, htmlTokens), htmlTokens, 'fr');
  const schema = JSON.parse(htmlTokens(localized).find(token => token.name === 'script').body);
  assert.deepEqual(schema['@graph'].map(item => item.inLanguage), ['fr', 'fr']);
  assert.equal(schema['@graph'][0].headline, 'FR: Technical article');
  assert.deepEqual(schema['@graph'][0].featureList, ['FR: 90 engines', 'FR: Human approval']);
  assert.deepEqual(schema['@graph'][1].knowsAbout, ['FR: Cybersecurity']);
});

test('runtime translation changes approved literals without translating code or sending search text', () => {
  const code = "const state='off'; const text='Privacy settings'; const query='SCROLL '; const index='/assets/site-search-index.json';";
  const translated = translateScript(code, text => ({ 'Privacy settings': 'Confidentialité', SCROLL: 'DÉFILEMENT' })[text], ['Privacy settings', 'SCROLL'], 'fr');
  assert.ok(translated.includes("state='off'"));
  assert.ok(translated.includes('"Confidentialité"'));
  assert.ok(translated.includes('"DÉFILEMENT "'));
  assert.ok(translated.includes('"/assets/site-search-index-fr.json"'));
});

test('search supports European accents, Japanese and Korean while rejecting foreign and malformed URLs', () => {
  assert.equal(normalizeSearch('Sécurité QUÂNTICA'), 'securite quantica');
  assert.equal(normalizeSearch('ポスト量子 암호화'), 'ポスト量子 암호화');
  const pages = prepareSearchIndex({ version: 1, pages: [
    { url: '/fr/architecture', title: 'Architecture et sécurité souveraine', description: 'Architecture de Cypher Sentinel.' },
    { url: '/ja/post-quantum-cybersecurity', title: 'ポスト量子暗号', description: '量子コンピューターに対する暗号保護。' },
    { url: '/ko/post-quantum-cybersecurity', title: '양자 내성 암호화', description: '주권형 사이버보안 플랫폼의 암호화 기능.' },
    ...['//example.com', '/xx/private', '/ja/../../secret', '/ja/%2Fbad', '/ko/architecture?query=private', 'https://example.com'].map(url => ({ url, title: 'Invalid' })),
  ] });
  assert.equal(pages.length, 3);
  assert.equal(rankSearch(pages, 'sécurité')[0].url, '/fr/architecture');
  assert.equal(rankSearch(pages, '量子暗号')[0].url, '/ja/post-quantum-cybersecurity');
  assert.equal(rankSearch(pages, '암호화')[0].url, '/ko/post-quantum-cybersecurity');
});

test('every catalogue is complete, current, and preserves numerical and named claims', () => {
  assert.equal(source.units.length, 2166);
  for (const { code } of languages.slice(1)) checkCatalogue(source, JSON.parse(readFileSync(resolve(root, `locales/${code}.json`), 'utf8')), code);
});

test('all 304 content pages have reciprocal language links, correct canonical/indexing and valid assets', () => {
  const prepared = prepareBuild(root, 'production');
  assert.equal(prepared.pagePaths.size, 306);
  const origin = 'https://vektorium.io';
  const exists = pathname => pathname === '/' ? prepared.files.has('index.html') : prepared.files.has(pathname.slice(1)) || prepared.files.has(pathname.slice(1) + '.html');
  for (const page of mobilePages) for (const { code } of languages) {
    const path = localizedFile(page, code);
    const html = prepared.files.get(path).toString();
    const tokens = htmlTokens(html);
    assert.equal(attr(tokens.find(token => token.name === 'html'), 'lang'), code, path);
    const canonical = tokens.filter(token => token.name === 'link' && attr(token, 'rel') === 'canonical');
    assert.equal(canonical.length, 1, path);
    assert.equal(attr(canonical[0], 'href'), origin + localizedPath(page, code), path);
    const socialLocales = tokens.filter(token => token.name === 'meta' && attr(token, 'property') === 'og:locale');
    assert.equal(socialLocales.length, 1, path);
    assert.ok(attr(socialLocales[0], 'content').startsWith(code + '_'), path);
    assert.equal(tokens.filter(token => token.name === 'meta' && attr(token, 'property') === 'og:locale:alternate').length, 7, path);
    const alternates = tokens.filter(token => token.name === 'link' && attr(token, 'rel') === 'alternate' && token.attrs.has('hreflang'));
    assert.deepEqual(alternates.map(token => attr(token, 'hreflang')), [...languages.map(language => language.code), 'x-default'], path);
    assert.deepEqual(alternates.map(token => attr(token, 'href')), [...languages.map(language => origin + localizedPath(page, language.code)), origin + localizedPath(page, 'en')], path);
    const ids = tokens.filter(token => !token.closing && token.attrs.has('id')).map(token => attr(token, 'id'));
    assert.equal(ids.length, new Set(ids).size, path);
    assert.ok(ids.includes('vx-language-mobile-panel'), path);
    assert.ok(ids.includes(page === 'index.html' ? 'vx-language-home-panel' : 'vx-language-desktop-panel'), path);
    assert.equal(tokens.filter(token => token.name === 'a' && token.attrs.has('hreflang') && attr(token, 'href').startsWith('/')).length, 16, path);
    if (code !== 'en') for (const token of tokens.filter(token => token.name === 'a' && /^https:\/\/(?:mobile-)?demo\.vektorium\.io\//.test(attr(token, 'href')))) assert.equal(attr(token, 'hreflang'), 'en', path);
    assert.equal(tokens.filter(token => token.name === 'meta' && attr(token, 'name') === 'robots' && /noindex/.test(attr(token, 'content'))).length, 0, path);
    if (code !== 'en') for (const token of tokens.filter(token => token.name === 'script' && attr(token, 'type') === 'application/ld+json')) {
      const checkLanguage = value => {
        if (Array.isArray(value)) value.forEach(checkLanguage);
        else if (value && typeof value === 'object') {
          if (['WebPage', 'AboutPage', 'ContactPage', 'CollectionPage', 'Article', 'TechArticle', 'Blog', 'BlogPosting', 'FAQPage', 'WebSite'].includes(value['@type'])) assert.equal(value.inLanguage, code, path);
          Object.values(value).forEach(checkLanguage);
        }
      };
      checkLanguage(JSON.parse(token.body));
    }
    for (const token of tokens.filter(token => !token.closing)) for (const key of ['href', 'src']) {
      const value = attr(token, key);
      if (!value || /^(?:#|mailto:|tel:|data:)/.test(value)) continue;
      const url = new URL(value, origin + localizedPath(page, code));
      if (url.origin === origin) assert.ok(exists(url.pathname), `${path}: missing ${value}`);
    }
    inspectHtml(path, html);
  }
  const sitemap = prepared.files.get('sitemap.xml').toString();
  assert.equal((sitemap.match(/<loc>/g) ?? []).length, 304);
  for (const { code } of languages.slice(1)) {
    const index = JSON.parse(prepared.files.get(`assets/site-search-index-${code}.json`));
    assert.equal(index.pages.length, 38, code);
    assert.ok(index.pages.every(page => page.url === '/' + code || page.url.startsWith('/' + code + '/')), code);
    assert.equal(prepareSearchIndex(index).length, 38, code);
  }
  for (const excluded of ['locales/source.json', 'locales/fr.json', 'scripts/build.mjs', 'docs/localization.md']) assert.ok(!prepared.files.has(excluded));
});
