/** Deterministic multilingual output from the reviewed English source and complete catalogues. */
import { createHash } from 'node:crypto';
import { languages, localeCodes, createCatalog, checkCatalogue, extractUnits, translator, localizedPath, localizedFile, localizeContent, rewriteLocaleShell, applyTextEdits } from './localization.mjs';
import { runtimeSources, translateScript } from './localization-runtime.mjs';
import { createSearchIndex } from './search-index.mjs';

export function compileLocales({ root, sources, files, tokenize, readAttribute, readRegular }) {
  const read = path => readRegular(root, path).toString('utf8');
  const runtime = runtimeSources([read('assets/home-search.js'), read('assets/privacy-controls.js')], read('index.html'));
  const expected = createCatalog(sources, tokenize, runtime);
  const source = JSON.parse(read('locales/source.json'));
  if (source.version !== 1 || source.sourceHash !== expected.sourceHash || JSON.stringify(source.units) !== JSON.stringify(expected.units)) throw new Error('English content changed: refresh and review the translation catalogues before publishing');
  const catalogues = new Map();
  for (const { code } of languages.slice(1)) {
    const catalogue = JSON.parse(read(`locales/${code}.json`));
    checkCatalogue(source, catalogue, code);
    catalogues.set(code, catalogue);
  }
  const fontCoverage = JSON.parse(read('locales/font-coverage.json'));
  if (fontCoverage.version !== 1) throw new Error('Unsupported localized font manifest');
  const needsCjkFont = point => point >= 0x1100 && point <= 0x11ff || point >= 0x2e80 && point <= 0x9fff || point >= 0xa960 && point <= 0xa97f || point >= 0xac00 && point <= 0xd7ff || point >= 0xf900 && point <= 0xfaff || point >= 0xff00 && point <= 0xffef || point >= 0x20000 && point <= 0x3ffff;
  for (const code of ['ja', 'ko']) {
    const label = languages.find(language => language.code === code).name;
    for (const purpose of ['site', 'menu']) {
      const font = fontCoverage.locales?.[code]?.[purpose];
      const asset = font && files.get(font.path);
      if (!asset || createHash('sha256').update(asset).digest('hex') !== font.sha256) throw new Error(`${code}: missing or changed ${purpose} font`);
      const coverage = new Set(font.codepoints);
      const content = (purpose === 'site' ? Object.values(catalogues.get(code).translations).join('') : '') + label;
      for (const character of content.normalize('NFC')) {
        const point = character.codePointAt(0);
        if (needsCjkFont(point) && !coverage.has(point)) throw new Error(`${code}: refresh font subsets for U+${point.toString(16).toUpperCase()}`);
      }
    }
  }
  const units = new Map([...sources].map(([page, html]) => [page, extractUnits(page, html, tokenize)]));
  const pages = new Set();
  for (const { code } of languages) {
    const translate = translator(catalogues.get(code));
    const localizedSources = new Map();
    if (code !== 'en') for (const filename of ['home-search.js', 'privacy-controls.js']) {
      const body = translateScript(read(`assets/${filename}`), translate, runtime, code);
      files.set(`assets/localized/${code}/${filename}`, Buffer.from(body));
    }
    for (const [page, original] of sources) {
      let html = code === 'en' ? original : localizeContent(page, original, translate, units.get(page), tokenize, code);
      if (code !== 'en') {
        const scripts = [];
        for (const token of tokenize(html)) {
          if (token.name !== 'script' || token.closing || token.attrs.has('src') || readAttribute(token, 'type') === 'application/ld+json') continue;
          const body = translateScript(token.body, translate, runtime, code, { htmlText: page === 'index.html' });
          if (body === token.body) continue;
          const digest = createHash('sha256').update(body).digest('hex').slice(0, 12);
          const path = `assets/localized/${code}/inline-${page.replace('.html', '')}-${digest}.js`;
          files.set(path, Buffer.from(body));
          scripts.push({ start: token.start, end: token.end, text: `<script src="/${path}"></script>` });
        }
        html = applyTextEdits(html, scripts);
      }
      html = rewriteLocaleShell(page, html, code, translate, tokenize, readAttribute, new Set(sources.keys()));
      const path = localizedFile(page, code);
      files.set(path, Buffer.from(html));
      localizedSources.set(page, html);
      pages.add(path);
    }
    if (code !== 'en') {
      const index = createSearchIndex(localizedSources, tokenize);
      for (const record of index.pages) {
        const page = record.url === '/' ? 'index.html' : record.url.slice(1) + '.html';
        record.url = localizedPath(page, code);
        record.category = translate(record.category);
      }
      index.locale = code;
      files.set(`assets/site-search-index-${code}.json`, Buffer.from(JSON.stringify(index) + '\n'));
    }
  }
  // hreflang is supplied once in HTML. This sitemap lists only real, indexable pages.
  const urls = [...sources.keys()].flatMap(page => localeCodes.map(code => 'https://vektorium.io' + localizedPath(page, code)));
  files.set('sitemap.xml', Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.map(url => `  <url><loc>${url}</loc></url>`).join('\n') + '\n</urlset>\n'));
  return pages;
}
