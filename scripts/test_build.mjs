/** Dependency-free tests. Every write is inside a process-owned temporary
 * fixture tree; the checkout and any existing dist are never changed. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attr, build, cspHash, decodeAttribute, expectedConfig, fixedFiles, htmlTokens, inspectHtml, legacyGaBodies, legacyGaBody, legacyGaSource, mobileHeader, mobilePages, prepareBuild, prepareHtml, publicPages, searchIndexPages, versionPageAssets } from './build.mjs';
import { createSearchIndex, extractSearchPage, searchBodyLimit, siteSearchIndexPath } from './search-index.mjs';
import { desktopMenu, menuIcon } from './navigation.mjs';

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const options = new Set(process.argv.slice(2));
assert.ok([...options].every(option => ['--actual', '--keep-actual'].includes(option)), 'Unknown test option');
assert.ok(!options.has('--keep-actual') || options.has('--actual'), '--keep-actual requires --actual');
assert.equal(publicPages.size, 40, 'Review the explicit public manifest if the site inventory changes');
assert.ok([...publicPages].every(page => /^[a-z0-9-]+\.html$/.test(page)));
const temporaryParent = realpathSync(tmpdir());
const temporaryRoot = mkdtempSync(join(temporaryParent, 'vektorium-compatible-tests-'));
const owner = randomUUID();
writeFileSync(join(temporaryRoot, '.fixture-owner'), owner);
let passed = 0;
let failed = 0;
const retained = [];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function put(root, relative, value) {
  const target = resolve(root, relative);
  assert.ok(target.startsWith(root + '/'), 'Fixture write escaped its owned root');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, value);
}

function synchronizeFixtureConfig(root) {
  const inventory = { scripts: new Set(), styles: new Set(), attributes: new Set() };
  for (const page of publicPages) inspectHtml(page, prepareHtml(page, readFileSync(join(root, page), 'utf8')), inventory);
  put(root, 'vercel.json', JSON.stringify(expectedConfig(inventory), null, 2) + '\n');
}

function fixtureNavigation(page) {
  if (!mobilePages.has(page)) return '';
  const links = '<a href="/">Home</a><a href="/contact" class="cta"><span>Contact</span></a>';
  if (page === 'index.html') return `<nav class="floating-nav" aria-label="Primary navigation">${links}</nav>`;
  // The published-insight and blog templates use the same class without a label.
  const label = page === 'blog.html' || page.startsWith('insight-') ? '' : ' aria-label="Primary navigation"';
  return `<nav class="site-nav"${label}><a href="/" class="logo">Vektorium</a><div class="nav-links">${links}</div></nav>`;
}

function fixture(name) {
  assert.match(name, /^[a-z0-9-]+$/);
  const root = join(temporaryRoot, name);
  mkdirSync(root);
  for (const page of publicPages) {
    const robots = page === 'generated.html' ? 'noindex, follow' : 'index, follow';
    put(root, page, `<!doctype html><html lang="en"><head><title>${page}</title><meta name="robots" content="${robots}">
<script async src="${legacyGaSource}"></script><script>${legacyGaBody}</script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" href="https://fonts.googleapis.com/css2?family=Inter&amp;display=swap" as="style" onload="this.onload=null;this.rel='stylesheet'">
<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter&amp;display=swap"></noscript>
<style>\nbody { color: #eef; }\n</style><link rel="stylesheet" href="/assets/fixture.css"><script src="/assets/fixture.js" defer></script>
<script type="application/ld+json">{"@type":"Organization","name":"Unchanged fixture claim"}</script>
</head><body>${fixtureNavigation(page)}<main style="color: #eef">Fixture</main><script>\nwindow.fixture = 'unchanged';\n</script></body></html>`);
  }
  for (const [path, content] of [
    ['assets/fixture.css', 'body { background: #111; }\n'], ['assets/fixture.js', "'use strict';\n"],
    ['assets/fonts.css', '/*! Font-license fixture */\n@font-face { font-family: Fixture; src: url(/assets/fonts/fixture.woff2); }\n'],
    ['assets/fonts/fixture.woff2', Buffer.from([0x77, 0x4f, 0x46, 0x32, 0, 1, 2])],
    ['assets/privacy-controls.css', '.fixture-privacy { color: inherit; }\n'],
    ['assets/privacy-controls.js', "'use strict'; // No network access in fixture.\n"],
    ['assets/mobile.css', '.vx-mobile-header { display: none; }\n'],
    ['assets/mobile.js', "'use strict'; // Mobile navigation fixture.\n"],
    ['assets/navigation.css', '.vx-desktop-menu { display: none; }\n'],
    ['assets/navigation.js', "'use strict'; // Desktop navigation fixture.\n"],
    ['robots.txt', 'User-agent: *\nAllow: /\nSitemap: https://vektorium.io/sitemap.xml\n'],
    ['sitemap.xml', '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>'],
    ['.well-known/security.txt', 'Contact: mailto:fixture@example.invalid\nExpires: 2030-01-01T00:00:00Z\n'],
    ['README.md', 'Private fixture notes'], ['docs/review.html', 'Private fixture notes'],
    ['content/source-posts.json', '{"private":"fixture"}'], ['.github/workflows/check.yml', 'Private fixture'],
    ['.git/fixture-note', 'Private fixture'], ['scripts/private.mjs', '// Private fixture'],
    ['package.json', '{"private":true}'], ['secret.txt', 'Synthetic fixture, not a credential'],
  ]) put(root, path, content);
  synchronizeFixtureConfig(root);
  return root;
}

function edit(root, page, action) {
  put(root, page, action(readFileSync(join(root, page), 'utf8')));
}

function test(name, action) {
  try { action(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { failed += 1; console.error(`FAIL ${name}: ${error.stack || error.message}`); }
}

function importantInline(html) {
  return htmlTokens(html).filter(token => !token.closing).flatMap(token => {
    if (['script', 'style'].includes(token.name) && !token.attrs.has('src') && !legacyGaBodies.has(token.body)) return [[token.name, attr(token, 'type') || '', token.body]];
    return [];
  });
}

function styleAttributes(html) {
  return htmlTokens(html).filter(token => !token.closing && token.attrs.has('style')).map(token => token.attrs.get('style').raw);
}

function outputCheck(root, environment) {
  const output = join(root, 'dist');
  const preview = environment !== 'production';
  assert.deepEqual(readdirSync(output).filter(name => name.endsWith('.html')).sort(), [...publicPages].sort());
  for (const page of publicPages) {
    const source = readFileSync(join(root, page), 'utf8');
    const html = readFileSync(join(output, page), 'utf8');
    assert.deepEqual(importantInline(html), importantInline(source), `${page}: original inline block bytes changed`);
    assert.deepEqual(styleAttributes(html), styleAttributes(source), `${page}: static style attribute bytes changed`);
    const tokens = htmlTokens(html);
    const robots = tokens.filter(t => t.name === 'meta' && attr(t, 'name')?.toLowerCase() === 'robots');
    if (preview) {
      assert.equal(robots.length, 1, page);
      assert.equal(attr(robots[0], 'content'), 'noindex, nofollow, noarchive', page);
    } else {
      const original = htmlTokens(source).filter(t => t.name === 'meta' && attr(t, 'name')?.toLowerCase() === 'robots').map(t => t.raw);
      assert.deepEqual(robots.map(t => t.raw), original, `${page}: production robots changed`);
    }
    assert.equal(tokens.filter(t => t.name === 'script' && attr(t, 'src')?.startsWith('/assets/privacy-controls.js?')).length, 1, page);
    assert.equal(tokens.filter(t => t.name === 'link' && attr(t, 'href')?.startsWith('/assets/fonts.css?')).length, 1, page);
    const mobileCount = mobilePages.has(page) ? 1 : 0;
    assert.equal(tokens.filter(t => t.name === 'header' && attr(t, 'class') === 'vx-mobile-header').length, mobileCount, page);
    assert.equal(tokens.filter(t => t.name === 'script' && attr(t, 'src')?.startsWith('/assets/mobile.js?')).length, mobileCount, page);
    assert.equal(tokens.filter(t => t.name === 'link' && attr(t, 'href')?.startsWith('/assets/mobile.css?')).length, mobileCount, page);
    const desktop = tokens.filter(t => !t.closing && t.name === 'details' && attr(t, 'class') === 'vx-desktop-menu');
    assert.equal(desktop.length, mobileCount, page);
    const navigationCss = tokens.filter(t => t.name === 'link' && attr(t, 'href')?.startsWith('/assets/navigation.css?'));
    const navigationJs = tokens.filter(t => t.name === 'script' && attr(t, 'src')?.startsWith('/assets/navigation.js?'));
    assert.equal(navigationCss.length, mobileCount, page);
    assert.equal(navigationJs.length, mobileCount, page);
    const ids = tokens.filter(t => !t.closing && t.attrs.has('id')).map(t => attr(t, 'id'));
    assert.equal(new Set(ids).size, ids.length, `${page}: duplicate HTML IDs`);
    for (const panel of ['vx-mobile-panel', 'vx-desktop-panel']) {
      assert.equal(ids.filter(id => id === panel).length, mobileCount, page);
      const summaries = tokens.filter(t => !t.closing && t.name === 'summary' && attr(t, 'aria-controls') === panel);
      assert.equal(summaries.length, mobileCount, page);
      if (mobileCount) assert.equal(attr(summaries[0], 'aria-label'), 'Navigation menu', page);
    }
    if (mobileCount) {
      assert.ok(navigationJs[0].attrs.has('defer'), page);
      assert.ok(navigationCss[0].start > tokens.find(t => t.name === 'link' && attr(t, 'href')?.startsWith('/assets/mobile.css?')).start, page);
      assert.ok(desktop[0].attrs.has('data-search-ignore'), page);
      const sourceTokens = htmlTokens(source);
      const contact = sourceTokens.find(t => !t.closing && t.name === 'a' && attr(t, 'href') === '/contact' && attr(t, 'class')?.split(/\s+/).includes('cta'));
      assert.ok(contact, `${page}: expected original primary Contact link`);
      const contactClose = sourceTokens.slice(sourceTokens.indexOf(contact) + 1).find(t => t.closing && t.name === 'a');
      assert.ok(html.includes(source.slice(contact.start, contactClose.end) + desktopMenu), `${page}: desktop menu must immediately follow the unchanged Contact anchor`);
    }
    const inventory = inspectHtml(page, html);
    const policy = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8')).headers[0].headers.find(h => h.key === 'Content-Security-Policy').value;
    for (const hashes of Object.values(inventory)) for (const hash of hashes) assert.ok(policy.includes(`'${hash}'`), `${page}: unapproved inline hash`);
    for (const token of tokens) {
      const reference = token.name === 'script' ? attr(token, 'src') : token.name === 'link' ? attr(token, 'href') : undefined;
      if (!reference?.startsWith('/assets/') || !/\.(css|js)[?#]/.test(reference)) continue;
      const url = new URL(reference, 'https://fixture.invalid');
      const bytes = readFileSync(join(output, decodeURIComponent(url.pathname)));
      assert.equal(url.searchParams.getAll('v').length, 1);
      assert.equal(url.searchParams.get('v'), digest(bytes).slice(0, 16));
    }
  }
  const report = JSON.parse(readFileSync(join(root, 'build-report.json'), 'utf8'));
  assert.equal(report.pages.length, publicPages.size);
  assert.equal(report.environment, preview ? 'preview' : 'production');
  assert.ok(report.assets.some(asset => asset.file === 'robots.txt'), 'Rewritten robots is included in build report');
  assert.ok(report.assets.some(asset => asset.file === siteSearchIndexPath), 'Generated search index is included in build report');
  const index = JSON.parse(readFileSync(join(output, siteSearchIndexPath), 'utf8'));
  assert.equal(index.version, 1);
  assert.equal(index.pages.length, searchIndexPages.size);
  assert.deepEqual(index.pages.map(page => page.url), [...searchIndexPages].map(page => page === 'index.html' ? '/' : '/' + page.slice(0, -5)).sort());
  for (const page of index.pages) {
    assert.deepEqual(Object.keys(page), ['url', 'title', 'description', 'category', 'headings', 'body']);
    for (const key of ['url', 'title', 'description', 'category', 'body']) assert.equal(typeof page[key], 'string');
    assert.ok(Array.isArray(page.headings) && page.headings.every(heading => typeof heading === 'string'));
    assert.ok(page.body.length <= searchBodyLimit);
  }
  for (const forbidden of ['.git', '.github', 'scripts', 'docs', 'content', 'node_modules', 'README.md', 'package.json', 'package-lock.json', 'vercel.json', 'build-report.json', 'secret.txt']) assert.equal(existsSync(join(output, forbidden)), false, `${forbidden} leaked into output`);
  if (preview) assert.equal(readFileSync(join(output, 'robots.txt'), 'utf8'), 'User-agent: *\nDisallow: /\n');
  else assert.equal(readFileSync(join(output, 'robots.txt'), 'utf8'), readFileSync(join(root, 'robots.txt'), 'utf8'));
  return report;
}

try {
  test('shared hamburger markup has complete allowed links, accessible controls and no inline code', () => {
    assert.equal(mobilePages.size, 38);
    assert.equal(mobilePages.has('demo.html'), false);
    assert.equal(mobilePages.has('generated.html'), false);
    assert.ok(!/<(?:script|style)\b|\s(?:style|on[a-z]+)=/i.test(mobileHeader + desktopMenu), 'Navigation markup may not authorize inline code or styling');
    assert.equal(htmlTokens(menuIcon).filter(t => t.name === 'span' && !t.closing).length, 4, 'Icon has one wrapper and three lines');
    assert.ok(mobileHeader.includes(menuIcon) && desktopMenu.includes(menuIcon));
    const mobileLinks = htmlTokens(mobileHeader).filter(t => t.name === 'a' && !t.closing).map(t => attr(t, 'href')).slice(1);
    assert.deepEqual(mobileLinks, ['/', '/cypher-sentinel', '/architecture', '/sovereign-cybersecurity-platform', '/cybersecurity-convergence-platform', '/integrations', '/critical-infrastructure-cybersecurity', '/post-quantum-cybersecurity', '/blog', '/#about', 'https://mobile-demo.vektorium.io/demo', '/contact']);
    const desktopLinks = htmlTokens(desktopMenu).filter(t => t.name === 'a' && !t.closing).map(t => attr(t, 'href'));
    assert.deepEqual(desktopLinks, ['/cypher-sentinel', '/architecture', '/integrations', '/sovereign-cybersecurity-platform', '/cybersecurity-convergence-platform', '/#product', '/critical-infrastructure-cybersecurity', '/post-quantum-cybersecurity', '/ai-powered-siem-platform', '/zero-trust-cybersecurity-platform', '/', '/#vision', '/#about', '/#technology', '/blog', 'https://demo.vektorium.io/', '/contact']);
    assert.equal(htmlTokens(desktopMenu).filter(t => t.name === 'section' && !t.closing).length, 3);
    assert.equal(htmlTokens(desktopMenu).filter(t => t.name === 'nav').length, 0, 'Desktop panel does not nest a second navigation landmark');
    const links = [...mobileLinks, ...desktopLinks];
    for (const href of links) {
      if (['https://mobile-demo.vektorium.io/demo', 'https://demo.vektorium.io/'].includes(href)) continue;
      assert.ok(href.startsWith('/') && !href.startsWith('//'), 'Navigation must remain on this site');
      const path = new URL(href, 'https://vektorium.io').pathname;
      assert.ok(publicPages.has(path === '/' ? 'index.html' : path.slice(1) + '.html'), `Missing navigation target: ${href}`);
    }
    const source = '<html><head><title>Original</title></head><body>' + fixtureNavigation('index.html') + '<main>Original product claim</main></body></html>';
    const output = prepareHtml('index.html', source);
    assert.ok(output.includes('<body>' + mobileHeader + '<nav class="floating-nav"'));
    assert.ok(output.includes('</span></a>' + desktopMenu + '</nav><main>Original product claim</main>'));
    assert.ok(!prepareHtml('demo.html', source).includes('vx-mobile-header'));
    assert.ok(!prepareHtml('generated.html', source).includes('vx-desktop-menu'));
    assert.throws(() => prepareHtml('index.html', source.replace('<body>', '')), /missing opening body/);
    assert.throws(() => prepareHtml('index.html', source.replace('<body>', '<body>' + mobileHeader)), /inserted only by the build/);
  });
  test('desktop insertion recognizes both source layouts without touching comments, inline code or existing bytes', () => {
    for (const page of ['index.html', 'architecture.html', 'blog.html']) {
      const nav = fixtureNavigation(page);
      const decoy = '<!-- ' + nav + ' --><script>const example = ' + JSON.stringify(nav) + ';</script>';
      const source = '<html><head><title>Original</title><style>.original { color: cyan; }</style></head><body><header><a href="/contact">Contact Us</a></header>' + decoy + nav + '<main>Original content</main></body></html>';
      const output = prepareHtml(page, source);
      assert.deepEqual(importantInline(output), importantInline(source));
      assert.ok(output.includes(decoy));
      assert.ok(output.includes(nav.replace('</span></a>', '</span></a>' + desktopMenu)));
      assert.equal(htmlTokens(output).filter(t => !t.closing && attr(t, 'class') === 'vx-desktop-menu').length, 1);
      const restored = output.replace(mobileHeader, '').replace(desktopMenu, '').replace(/<link rel="stylesheet" href="\/assets\/(?:fonts|mobile|navigation|privacy-controls)\.css">\n/g, '').replace(/<script src="\/assets\/(?:mobile|navigation|privacy-controls)\.js" defer><\/script>\n/g, '');
      assert.equal(restored, source, 'Only the explicit additive markup and assets may change');
    }
  });
  test('ambiguous, missing or malformed navigation and pre-existing generated IDs fail closed', () => {
    const nav = fixtureNavigation('index.html');
    const source = '<html><head><title>Original</title></head><body>' + nav + '</body></html>';
    for (const invalid of [
      source.replace(nav, ''),
      source.replace(nav, nav + nav),
      source.replace('href="/contact"', 'href="/other"'),
      source.replace('</nav>', '<a href="/contact">Another contact</a></nav>'),
      source.replace('<a href="/contact"', '<div><a href="/contact"').replace('</span></a>', '</span></a></div>'),
      source.replace('</span></a>', '</span></div>'),
      source.replace('aria-label="Primary navigation"', 'aria-label="Secondary navigation"'),
    ]) assert.throws(() => prepareHtml('index.html', invalid), /primary navigation|Contact anchor/);
    for (const marker of ["<div id='vx-desktop-panel'></div>", "<div id='vx-mobile-panel'></div>", "<details class='vx-desktop-menu'></details>"]) {
      assert.throws(() => prepareHtml('index.html', source.replace('</body>', marker + '</body>')), /inserted only by the build/);
    }
    const subpage = source.replace(nav, fixtureNavigation('architecture.html'));
    assert.throws(() => prepareHtml('architecture.html', subpage.replace('</nav>', '<div class="nav-links"></div></nav>')), /nav-links container/);
  });
  test('search extracts visible main content while excluding navigation, code, graphics and ignored subtrees', () => {
    const html = `<html><head><title>Fallback | Vektorium</title><meta name="description" content="Research &amp; development"></head>
      <body><header>HEADER_ONLY</header><nav>NAV_ONLY</nav><p>OUTSIDE_MAIN</p>
      <main><article><header><h1>Security <em>architecture</em></h1></header>
      <h2>Shared context</h2><p>Research &amp; development. cyber<strong>security</strong>. &#x1f512; &amp;quot;</p>
      <!-- COMMENT_ONLY --><div data-search-ignore><h2>IGNORED_HEADING</h2><div>IGNORED_BODY</div></div>
      <nav>NESTED_NAV</nav><div role="navigation">ROLE_NAV</div><footer>FOOTER_ONLY</footer>
      <div class="breadcrumb">BREADCRUMB_ONLY</div><div class="nav-links">MENU_ONLY</div>
      <div class="internal-links"><h3>RELATED_ONLY</h3><div><a href="/blog">UNRELATED_TOPIC_ONLY</a></div></div>
      <script>const text = '<main>JAVASCRIPT_ONLY</main>';</script><style>.STYLE_ONLY{color:red}</style>
      <svg><text>SVG_ONLY</text></svg><canvas>CANVAS_ONLY</canvas><template>TEMPLATE_ONLY</template>
      <noscript>NOSCRIPT_ONLY</noscript><textarea>TEXTAREA_ONLY</textarea><button>BUTTON_ONLY</button>
      <p hidden>HIDDEN_ONLY</p><p aria-hidden="true">ARIA_ONLY</p></article></main></body></html>`;
    const page = extractSearchPage('architecture.html', html, htmlTokens);
    assert.equal(page.url, '/architecture');
    assert.equal(page.title, 'Security architecture');
    assert.equal(page.description, 'Research & development');
    assert.equal(page.category, 'Platform');
    assert.deepEqual(page.headings, ['Security architecture', 'Shared context']);
    assert.equal(page.body, 'Security architecture Shared context Research & development. cybersecurity. 🔒 &quot;');
    assert.ok(!JSON.stringify(page).match(/_ONLY|OUTSIDE_MAIN|IGNORED_|NESTED_NAV|ROLE_NAV/));
  });
  test('search supports legal wrappers and title/body fallbacks without inventing external or redirect routes', () => {
    const legal = extractSearchPage('privacy-policy.html', '<html><head><title>Privacy | Vektorium Inc.</title></head><body><header>Global header</header><div class="content-wrapper"><h1>Privacy Policy</h1><p>Data rights.</p></div><p>Outside wrapper</p></body></html>', htmlTokens);
    assert.equal(legal.category, 'Company');
    assert.equal(legal.body, 'Privacy Policy Data rights.');
    const fallback = extractSearchPage('index.html', '<html><head><title>Public reference — Vektorium</title></head><body><header>Ignore global header</header><p>Useful public body.</p><footer>Ignore footer</footer></body></html>', htmlTokens);
    assert.equal(fallback.url, '/');
    assert.equal(fallback.title, 'Public reference');
    assert.equal(fallback.description, '');
    assert.deepEqual(fallback.headings, []);
    assert.equal(fallback.body, 'Useful public body.');
    for (const page of ['../secret.html', 'docs/private.html', 'https://example.com/page.html', 'demo.html', 'generated.html']) {
      assert.throws(() => extractSearchPage(page, '<title>Not public</title>', htmlTokens), /Not an indexable public content filename/);
    }
  });
  test('search is manifest-bound and only the build can produce its JSON asset', () => {
    const root = fixture('search-boundary');
    for (const page of ['demo.html', 'generated.html']) edit(root, page, html => html.replace('>Fixture</main>', '>REDIRECT_ONLY_SENTINEL</main>'));
    put(root, 'docs/private-search.html', '<main>PRIVATE_REPOSITORY_SENTINEL</main>');
    put(root, 'content/private-search.json', '{"text":"PRIVATE_REPOSITORY_SENTINEL"}');
    const prepared = prepareBuild(root, 'production');
    const text = prepared.files.get(siteSearchIndexPath).toString('utf8');
    const index = JSON.parse(text);
    assert.equal(index.pages.length, 38);
    assert.equal(searchIndexPages.size, 38);
    assert.ok(!text.includes('REDIRECT_ONLY_SENTINEL') && !text.includes('PRIVATE_REPOSITORY_SENTINEL'));
    assert.ok(!index.pages.some(page => ['/demo', '/generated'].includes(page.url)));
    assert.equal(existsSync(join(root, siteSearchIndexPath)), false, 'Index must not depend on a checked-in source JSON file');
    put(root, siteSearchIndexPath, '{"private":"SOURCE_JSON_MUST_NOT_DEPLOY"}');
    assert.throws(() => prepareBuild(root, 'production'), /not allowlisted/);
  });
  test('search generation is deterministic, environment-independent and follows source edits', () => {
    const root = fixture('search-deterministic');
    const production = prepareBuild(root, 'production').files.get(siteSearchIndexPath);
    assert.deepEqual(prepareBuild(root, 'production').files.get(siteSearchIndexPath), production);
    assert.deepEqual(prepareBuild(root, 'preview').files.get(siteSearchIndexPath), production);
    const sources = [...searchIndexPages].map(page => [page, readFileSync(join(root, page), 'utf8')]);
    assert.deepEqual(createSearchIndex(sources, htmlTokens), createSearchIndex([...sources].reverse(), htmlTokens));
    const before = JSON.parse(production);
    edit(root, 'architecture.html', html => html.replace('>Fixture</main>', '>Updated searchable architecture.</main>'));
    const after = JSON.parse(prepareBuild(root, 'production').files.get(siteSearchIndexPath));
    assert.equal(after.pages.find(page => page.url === '/architecture').body, 'Updated searchable architecture.');
    assert.deepEqual(after.pages.filter(page => page.url !== '/architecture'), before.pages.filter(page => page.url !== '/architecture'));
  });
  test('search bounds public text size and keeps decoded text separate from markup', () => {
    const page = extractSearchPage('blog.html', `<title>Insights</title><main><h1>Insights</h1><p>${'Long public text. '.repeat(3000)}</p></main>`, htmlTokens);
    assert.equal(page.category, 'Insights');
    assert.ok(page.body.length <= searchBodyLimit && page.body.length > searchBodyLimit - 120);
    const encoded = extractSearchPage('contact.html', '<title>Contact</title><main>&lt;svg&gt;Text, not markup&lt;/svg&gt;<p>Still public.</p></main>', htmlTokens);
    assert.equal(encoded.body, '<svg>Text, not markup</svg> Still public.');
  });
  test('production preserves original inline code, styles, schema and robots while isolating public output', () => {
    const root = fixture('production');
    const before = [...publicPages].map(page => digest(readFileSync(join(root, page))));
    build(root, 'production'); outputCheck(root, 'production');
    assert.deepEqual([...publicPages].map(page => digest(readFileSync(join(root, page)))), before, 'Source HTML was mutated');
  });
  for (const [name, environment] of [['preview', 'preview'], ['absent-environment', undefined], ['unknown-environment', 'staging'], ['development', 'development'], ['wrong-case-production', 'Production']]) {
    test(`${name} fails closed to noindex`, () => { const root = fixture(name); build(root, environment); outputCheck(root, environment); });
  }
  test('CSP is exact, reproducible and contains no broad inline/eval authorization', () => {
    const root = fixture('policy'); const prepared = prepareBuild(root, 'production');
    const policy = prepared.config.headers[0].headers.find(h => h.key === 'Content-Security-Policy').value;
    assert.ok(!policy.includes("'unsafe-inline'") && !policy.includes("'unsafe-eval'"));
    assert.match(policy, /script-src-attr 'none'/);
    assert.match(policy, /style-src-attr 'unsafe-hashes' 'sha256-/);
    assert.match(policy, /object-src 'none'/);
    assert.match(policy, /base-uri 'none'/);
    assert.equal(prepared.config.headers[0].headers.find(h => h.key === 'X-XSS-Protection').value, '0');
    assert.match(prepared.config.headers[0].headers.find(h => h.key === 'Permissions-Policy').value, /clipboard-write=\(self\)/);
  });
  test('changing inline code fails policy review before prior output is touched', () => {
    const root = fixture('changed-script'); build(root, 'production'); put(root, 'dist/preserve.txt', 'keep');
    edit(root, 'index.html', html => html.replace("window.fixture = 'unchanged'", "window.fixture = 'changed'"));
    assert.throws(() => build(root, 'production'), /reproducible CSP/);
    assert.equal(readFileSync(join(root, 'dist/preserve.txt'), 'utf8'), 'keep');
  });
  test('changing inline styles fails policy review without silently authorizing it', () => {
    const root = fixture('changed-style'); edit(root, 'index.html', html => html.replace('color: #eef', 'color: #fff'));
    assert.throws(() => build(root, 'production'), /reproducible CSP/); assert.equal(existsSync(join(root, 'dist')), false);
  });
  test('changing static style attributes fails policy review', () => {
    const root = fixture('changed-attribute'); edit(root, 'index.html', html => html.replace('style="color: #eef"', 'style="color: #abc"'));
    assert.throws(() => build(root, 'production'), /reproducible CSP/);
  });
  test('altered CSP and unsafe-inline config are rejected', () => {
    const root = fixture('altered-config'); edit(root, 'vercel.json', text => text.replace("default-src 'self'", "default-src 'self' 'unsafe-inline'"));
    assert.throws(() => build(root, 'production'), /reproducible CSP/);
  });
  test('unexpected root HTML and missing expected pages fail before replacing output', () => {
    const root = fixture('unexpected-page'); build(root, 'production'); put(root, 'dist/preserve.txt', 'keep');
    put(root, 'private-draft.html', '<title>Private draft</title>'); assert.throws(() => build(root, 'production'), /not in the public manifest/);
    renameSync(join(root, 'private-draft.html'), join(root, 'private-draft.txt'));
    renameSync(join(root, 'terms.html'), join(root, 'terms.fixture-backup')); assert.throws(() => build(root, 'production'), /terms\.html/);
    assert.equal(readFileSync(join(root, 'dist/preserve.txt'), 'utf8'), 'keep');
  });
  test('public page symlinks are rejected', () => {
    const root = fixture('symlink-page'); renameSync(join(root, 'terms.html'), join(root, 'terms.fixture-backup')); symlinkSync(join(root, 'terms.fixture-backup'), join(root, 'terms.html'));
    assert.throws(() => build(root, 'production'), /non-regular public file/);
  });
  test('unrecognized dist and output symlinks are preserved', () => {
    const root = fixture('unsafe-output'); put(root, 'saved-output/keep.txt', 'keep'); symlinkSync(join(root, 'saved-output'), join(root, 'dist'));
    assert.throws(() => build(root, 'production'), /unrecognized dist/); assert.equal(readFileSync(join(root, 'saved-output/keep.txt'), 'utf8'), 'keep');
    const another = fixture('unknown-output'); put(another, 'dist/keep.txt', 'keep'); assert.throws(() => build(another, 'production'), /unrecognized dist/);
    assert.equal(readFileSync(join(another, 'dist/keep.txt'), 'utf8'), 'keep');
  });
  test('recognized generated output rebuilds without stale files', () => {
    const root = fixture('rebuild'); build(root, 'production'); put(root, 'dist/stale.txt', 'old'); build(root, 'preview'); outputCheck(root, 'preview'); assert.equal(existsSync(join(root, 'dist/stale.txt')), false);
  });
  test('asset symlinks and unapproved asset types are rejected before output exists', () => {
    const root = fixture('asset-symlink'); symlinkSync(join(root, 'secret.txt'), join(root, 'assets/secret.js'));
    assert.throws(() => build(root, 'production'), /public asset symlink/); assert.equal(existsSync(join(root, 'dist')), false);
    const another = fixture('asset-type'); put(another, 'assets/private.txt', 'private'); assert.throws(() => build(another, 'production'), /not allowlisted/); assert.equal(existsSync(join(another, 'dist')), false);
  });
  test('hidden editor metadata is never public', () => {
    const root = fixture('hidden-metadata'); put(root, 'assets/.editor-private/deep/secret.js', '// private'); put(root, 'assets/.editor-state', 'private');
    build(root, 'production'); assert.equal(existsSync(join(root, 'dist/assets/.editor-private')), false); assert.equal(existsSync(join(root, 'dist/assets/.editor-state')), false);
  });
  test('fonts, images and their license stylesheet are copied without binary changes', () => {
    const root = fixture('binary-assets'); put(root, 'assets/fixture.webp', Buffer.from([82, 73, 70, 70, 1, 2, 3])); build(root, 'production');
    for (const path of ['assets/fonts.css', 'assets/fonts/fixture.woff2', 'assets/fixture.webp']) assert.deepEqual(readFileSync(join(root, 'dist', path)), readFileSync(join(root, path)));
  });
  test('stable asset contents yield stable query versions and content changes alter only their version', () => {
    const root = fixture('asset-versions'); build(root, 'production'); const first = readFileSync(join(root, 'dist/index.html'), 'utf8');
    build(root, 'production'); assert.equal(readFileSync(join(root, 'dist/index.html'), 'utf8'), first);
    put(root, 'assets/fixture.css', 'body { background: #222; }\n'); build(root, 'production'); const next = readFileSync(join(root, 'dist/index.html'), 'utf8');
    assert.notEqual(next, first); assert.deepEqual(importantInline(next), importantInline(first)); outputCheck(root, 'production');
  });
  test('existing version parameters are replaced while other query fields and fragments survive', () => {
    const files = new Map([['assets/fixture.css', Buffer.from('x')]]);
    const output = versionPageAssets('index.html', '<link href="assets/fixture.css?theme=dark&amp;v=old&amp;v=duplicate#sample" rel="stylesheet">', files);
    const url = new URL(attr(htmlTokens(output)[0], 'href'), 'https://fixture.invalid');
    assert.equal(url.searchParams.get('theme'), 'dark'); assert.deepEqual(url.searchParams.getAll('v'), [digest(Buffer.from('x')).slice(0, 16)]); assert.equal(url.hash, '#sample');
  });
  test('missing or escaped CSS/JS references fail preflight', () => {
    const files = new Map(); assert.throws(() => versionPageAssets('index.html', '<link href="/assets/missing.css">', files), /missing regular public/);
    assert.throws(() => versionPageAssets('index.html', '<link href="/assets/%2e%2e/private.css">', files), /outside the public assets/);
    const root = fixture('missing-reference'); renameSync(join(root, 'assets/fixture.js'), join(root, 'assets/fixture.old.js')); assert.throws(() => build(root, 'production'), /missing regular public/); assert.equal(existsSync(join(root, 'dist')), false);
  });
  test('comment and raw script/schema strings are never rewritten as resource references', () => {
    const sample = '<!-- <link href="/assets/missing.css"> --><script type="application/ld+json">{"example":"<link href=\"/assets/missing.css\">"}</script><script>const example = "<link href=\'/assets/missing.css\'>";</script>';
    assert.equal(versionPageAssets('index.html', sample, new Map()), sample);
  });
  test('inline handlers, unreviewed external code and altered font handlers are rejected', () => {
    assert.throws(() => inspectHtml('fixture', '<title>X</title><button onclick="x()">X</button>'), /inline event handler/);
    assert.throws(() => inspectHtml('fixture', '<title>X</title><script src="https://example.invalid/a.js"></script>'), /unexpected external/);
    const root = fixture('font-handler'); edit(root, 'index.html', html => html.replace("this.onload=null;this.rel='stylesheet'", 'other()')); assert.throws(() => build(root, 'production'), /unexpected Google Fonts/);
  });
  test('unknown analytics snippets and inconsistent loader pairs fail closed', () => {
    const source = readFileSync(join(fixture('analytics-variant'), 'index.html'), 'utf8');
    assert.throws(() => prepareHtml('fixture', source.replace(legacyGaBody, legacyGaBody + 'extra();')), /inconsistent/);
    assert.throws(() => inspectHtml('fixture', '<title>X</title><script>gtag("config", "unknown");</script>'), /unconditional analytics/);
  });
  test('CRLF hash normalization and attribute entity decoding match browser input rules', () => {
    assert.equal(cspHash('\r\na\rb'), cspHash('\na\nb'));
    assert.equal(decodeAttribute('content: &quot;A&amp;B&quot;'), 'content: "A&B"');
    assert.equal(decodeAttribute('&amp;quot;'), '&quot;', 'Entities are decoded exactly once');
    assert.equal(decodeAttribute('x&#x3A; y&#59;'), 'x: y;');
    const attributeInventory = inspectHtml('fixture', '<title>X</title><div style="content: &quot;A&#13;B&quot;"></div>');
    assert.ok(attributeInventory.attributes.has(cspHash('content: "A\rB"', false)), 'An entity-produced CR is preserved in the browser attribute value');
    assert.throws(() => decodeAttribute('&unknown;'), /Unsupported named entity/);
    assert.throws(() => decodeAttribute('&#0;'), /Unsupported numeric entity/);
  });
  test('malformed JSON-LD fails while existing product-claim values are preserved', () => {
    assert.throws(() => inspectHtml('fixture', '<title>X</title><script type="application/ld+json">{</script>'), SyntaxError);
    const claims = '<title>X</title><script type="application/ld+json">{"@type":"Offer","price":"0"}</script>';
    const inventory = inspectHtml('fixture', claims); assert.equal(inventory.scripts.size, 0, 'JSON-LD must not become executable authorization');
  });
  test('both exact original GA formatting variants are removed without touching other scripts', () => {
    for (const body of legacyGaBodies) {
      const source = `<html><head><title>X</title><script src="${legacyGaSource}"></script><script>${body}</script></head><body><script>const keep = 1;</script></body></html>`;
      const output = prepareHtml('fixture', source); assert.ok(!output.includes(legacyGaSource)); assert.ok(!output.includes(body)); assert.ok(output.includes('<script>const keep = 1;</script>'));
    }
  });

  if (options.has('--actual')) {
    test('actual checkout production and preview builds preserve all approved desktop source bytes', () => {
      const prepared = prepareBuild(checkout, 'production'); // Read-only source preflight.
      const paths = [...prepared.files.keys()].filter(path => path !== siteSearchIndexPath).concat(['vercel.json', 'package.json', 'scripts/build.mjs', 'scripts/search-index.mjs', 'scripts/navigation.mjs']);
      const sourceDigests = new Map(paths.map(path => [path, digest(readFileSync(join(checkout, path)))]));
      const outputDigests = new Map([...prepared.files].map(([path, bytes]) => [path, digest(bytes)]));
      for (const environment of ['production', 'preview']) {
        const root = join(temporaryRoot, `actual-${environment}`); mkdirSync(root);
        for (const relative of paths) { const target = join(root, relative); mkdirSync(dirname(target), { recursive: true }); copyFileSync(join(checkout, relative), target); }
        for (const relative of ['docs/private-review.md', 'content/private-source.json', '.git/private-fixture', '.github/private-fixture', 'scripts/private.mjs', 'README.md']) put(root, relative, 'Synthetic excluded build input.');
        // Exercise the real deployment command and CLI in the isolated copy,
        // not only the imported build function used by smaller fixture tests.
        const run = spawnSync('npm', ['run', 'build'], { cwd: root, env: { ...process.env, VERCEL_ENV: environment }, encoding: 'utf8', timeout: 30_000, maxBuffer: 1_000_000 });
        assert.ifError(run.error);
        assert.equal(run.status, 0, run.stderr || run.stdout);
        const report = outputCheck(root, environment);
        for (const asset of report.assets) if (!(environment === 'preview' && asset.file === 'robots.txt')) assert.equal(digest(readFileSync(join(root, 'dist', asset.file))), outputDigests.get(asset.file), `${environment}: asset bytes changed during integration: ${asset.file}`);
        retained.push(root);
        console.log(JSON.stringify({ actualBuild: environment, output: join(root, 'dist'), pages: report.pages.length, assets: report.assets.length, hashCounts: Object.fromEntries(Object.entries(report.csp).map(([key, values]) => [key, values.length])) }));
      }
      for (const [path, before] of sourceDigests) assert.equal(digest(readFileSync(join(checkout, path))), before, `Checkout changed during test: ${path}`);
    });
  }
} finally {
  assert.equal(readFileSync(join(temporaryRoot, '.fixture-owner'), 'utf8'), owner, 'Fixture ownership marker changed');
  assert.equal(realpathSync(dirname(temporaryRoot)), temporaryParent);
  assert.ok(basename(temporaryRoot).startsWith('vektorium-compatible-tests-'));
  assert.ok(lstatSync(temporaryRoot).isDirectory() && !lstatSync(temporaryRoot).isSymbolicLink());
  if (options.has('--keep-actual') && retained.length && !failed) console.log(`Retained scoped build fixtures for independent review: ${temporaryRoot}`);
  else rmSync(temporaryRoot, { recursive: true }); // Only this process-owned fixture directory.
}
console.log(`${passed} build tests passed; ${failed} failed.`);
if (failed) process.exitCode = 1;
