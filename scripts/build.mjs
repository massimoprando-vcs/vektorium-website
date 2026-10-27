/**
 * Dependency-free, desktop-preserving static build.
 * Source HTML is never rewritten. Only approved GA/font substitutions, external
 * privacy controls, shared navigation, multilingual output, cache versions, and
 * preview robots metadata change in dist.
 * Existing inline effects/styles are authorized by exact CSP hashes, not by
 * unsafe-inline. A changed hash requires an explicit committed config review.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSearchIndex, siteSearchIndexPath } from './search-index.mjs';
import { desktopNavigationEdit, menuIcon } from './navigation.mjs';
import { compileLocales } from './build-locales.mjs';

export const publicPages = new Set([
  'index.html',
  'cypher-sentinel.html',
  'sovereign-cybersecurity-platform.html',
  'cybersecurity-convergence-platform.html',
  'integrations.html',
  'architecture.html',
  'government-cybersecurity-platform.html',
  'critical-infrastructure-cybersecurity.html',
  'post-quantum-cybersecurity.html',
  'zero-trust-cybersecurity-platform.html',
  'ai-powered-siem-platform.html',
  'ai-machine-learning-cybersecurity.html',
  'cloud-security-platform.html',
  'endpoint-detection-response.html',
  'network-security-monitoring.html',
  'threat-intelligence-platform.html',
  'identity-access-management-security.html',
  'cybersecurity-compliance.html',
  'cybersecurity-risk-management.html',
  'ransomware-prevention-recovery.html',
  'managed-cybersecurity-services.html',
  'penetration-testing-ethical-hacking.html',
  'cybersecurity-awareness-training.html',
  'blog.html',
  'insight-control-is-a-dial.html',
  'insight-agent-era-containment.html',
  'insight-will-you-own-your-company.html',
  'insight-verify-what-you-own.html',
  'insight-own-your-defense.html',
  'insight-flaws-in-the-foundations.html',
  'insight-dependency-is-exposure.html',
  'insight-stealth-and-cybersecurity.html',
  'insight-cybersecurity-convergence.html',
  'insight-why-cypher-sentinel.html',
  'insight-vektorium-builds-cypher-sentinel.html',
  'contact.html',
  'privacy-policy.html',
  'terms.html',
  'demo.html',
  'generated.html',
]);
export const fixedFiles = new Set([
  'robots.txt', 'sitemap.xml', 'favicon.ico', 'favicon.svg',
  'favicon-48x48.png', 'favicon-180x180.png',
  'apple-touch-icon.png', 'apple-touch-icon-precomposed.png',
  'vektorium-logo.webp', 'vektorium-logo-1x.webp', 'vektorium-logo-2x.webp', 'vektorium-logo.png',
  '517e3ed770994898b0c5482b33af8418.txt', '.well-known/security.txt',
]);
export const mobilePages = new Set([...publicPages].filter(page => !['demo.html', 'generated.html'].includes(page)));
export const searchIndexPages = new Set([...publicPages].filter(page => !['demo.html', 'generated.html'].includes(page)));
// One additive mobile shell. Original source markup, scripts, styles and copy
// remain byte-for-byte intact; mobile.css hides this header above 768px.
export const mobileHeader = `
<header class="vx-mobile-header">
  <a class="vx-mobile-brand" href="/" aria-label="Vektorium home"><img src="/vektorium-logo.webp" width="28" height="28" alt="">Vektorium</a>
  <details class="vx-mobile-menu">
    <summary class="vx-menu-toggle" aria-label="Navigation menu" aria-controls="vx-mobile-panel">${menuIcon}</summary>
    <nav class="vx-mobile-panel" id="vx-mobile-panel" aria-label="Mobile navigation">
      <a href="/">Home</a>
      <a href="/cypher-sentinel">Cypher Sentinel</a>
      <a href="/architecture">Architecture</a>
      <a href="/sovereign-cybersecurity-platform">Platform</a>
      <a href="/cybersecurity-convergence-platform">Convergence</a>
      <a href="/integrations">Integrations</a>
      <a href="/critical-infrastructure-cybersecurity">Infrastructure</a>
      <a href="/post-quantum-cybersecurity">Post-Quantum</a>
      <a href="/blog">Blog &amp; insights</a>
      <a href="/#about">About Vektorium</a>
      <a class="vx-mobile-demo" href="https://mobile-demo.vektorium.io/demo">View demo</a>
      <a class="vx-mobile-contact" href="/contact">Contact us</a>
    </nav>
  </details>
</header>
`;
const assetExtensions = new Set(['.css', '.js', '.svg', '.png', '.webp', '.avif', '.jpg', '.jpeg', '.woff2']);
const markerText = 'Generated only by scripts/build.mjs; safe to regenerate.\n';
const buildOrigin = 'https://vektorium-build.invalid';
export const legacyGaSource = 'https://www.googletagmanager.com/gtag/js?id=G-KZL0QVQ6XC';
export const legacyGaBody = 'window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag("js",new Date());gtag("config","G-KZL0QVQ6XC");';
export const legacyGaBodies = new Set([legacyGaBody, "\n    window.dataLayer = window.dataLayer || [];\n    function gtag(){dataLayer.push(arguments);}\n    gtag('js', new Date());\n    gtag('config', 'G-KZL0QVQ6XC');\n  "]);
const fontOrigins = new Set(['https://fonts.googleapis.com', 'https://fonts.gstatic.com']);
const browserText = value => value.replace(/\r\n?/g, '\n');
export const cspHash = (value, normalizeNewlines = true) => `sha256-${createHash('sha256').update(normalizeNewlines ? browserText(value) : value, 'utf8').digest('base64')}`;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Unknown entities in security-sensitive inputs fail closed rather than
 * guessing browser decoding. Current style values are entirely ASCII. */
export function decodeAttribute(value) {
  return browserText(value).replace(/&(?:#(?:x[0-9a-f]+|[0-9]+);?|[a-z][a-z0-9]*;)/gi, entity => {
    const name = entity.slice(1).replace(/;$/, '');
    if (name[0] === '#') {
      const hex = name[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) || (code >= 0x80 && code <= 0x9f)) throw new Error('Unsupported numeric entity in a security-sensitive attribute');
      return String.fromCodePoint(code);
    }
    const decoded = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', AMP: '&', QUOT: '"', LT: '<', GT: '>' }[name];
    if (decoded === undefined) throw new Error(`Unsupported named entity in a security-sensitive attribute: ${entity}`);
    return decoded;
  });
}

// Quote-aware tokenizer for this reviewed static corpus. Script/style bodies
// are raw text; markup-looking strings inside them are never resource tags.
export function htmlTokens(html) {
  if (html.includes('\0')) throw new Error('NUL byte in HTML is not supported');
  const tokens = [];
  const tags = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][a-z0-9:-]*(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
  let match;
  while ((match = tags.exec(html))) {
    const raw = match[0];
    if (raw.startsWith('<!')) continue;
    const named = /^<(\/)?([a-z][a-z0-9:-]*)/i.exec(raw);
    const token = { start: match.index, end: tags.lastIndex, raw, name: named[2].toLowerCase(), closing: Boolean(named[1]), attrs: new Map() };
    if (!token.closing) {
      const pattern = /\s+([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
      pattern.lastIndex = named[0].length;
      let attribute;
      while ((attribute = pattern.exec(raw))) {
        const name = attribute[1].toLowerCase();
        if (token.attrs.has(name)) throw new Error(`Duplicate HTML attribute: ${name}`);
        token.attrs.set(name, { raw: attribute[2] ?? attribute[3] ?? attribute[4] ?? '', start: attribute.index, end: pattern.lastIndex });
      }
      if (['script', 'style', 'textarea', 'title'].includes(token.name)) {
        const close = new RegExp('</' + token.name + '\\s*>', 'gi');
        close.lastIndex = tags.lastIndex;
        const ending = close.exec(html);
        if (!ending) throw new Error(`Unclosed ${token.name} element`);
        token.body = html.slice(tags.lastIndex, ending.index);
        token.openEnd = tags.lastIndex;
        token.end = close.lastIndex;
        tags.lastIndex = token.end;
      }
    }
    tokens.push(token);
  }
  return tokens;
}

export function attr(token, name) {
  const value = token.attrs.get(name)?.raw;
  return value === undefined ? undefined : decodeAttribute(value);
}

function applyEdits(html, edits) {
  let boundary = html.length;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    if (edit.end > boundary || edit.start > edit.end) throw new Error('Overlapping HTML build edits');
    html = html.slice(0, edit.start) + edit.text + html.slice(edit.end);
    boundary = edit.start;
  }
  return html;
}

/** Approved output-only changes. Does not reserialize existing HTML. */
export function prepareHtml(page, source, preview = false) {
  const edits = [];
  const tokens = htmlTokens(source);
  let headEnd;
  let bodyStart;
  let fontsInserted = false;
  let gaLoader = 0;
  let gaInline = 0;
  for (const token of tokens) {
    if (token.closing && token.name === 'head') headEnd = token.start;
    if (token.closing) continue;
    if (token.name === 'body') bodyStart = token.end;
    if (token.name === 'script' && attr(token, 'src') === legacyGaSource) {
      if (token.body.trim()) throw new Error(`${page}: unexpected code inside legacy GA loader`);
      edits.push({ start: token.start, end: token.end, text: '' });
      gaLoader += 1;
    } else if (token.name === 'script' && legacyGaBodies.has(token.body) && !token.attrs.has('src')) {
      edits.push({ start: token.start, end: token.end, text: '' });
      gaInline += 1;
    } else if (token.name === 'link' && token.attrs.has('href')) {
      const url = new URL(attr(token, 'href'), buildOrigin);
      if (fontOrigins.has(url.origin)) {
        const onload = attr(token, 'onload');
        if (onload !== undefined && onload !== "this.onload=null;this.rel='stylesheet'") throw new Error(`${page}: unexpected Google Fonts event handler`);
        edits.push({ start: token.start, end: token.end, text: fontsInserted ? '' : '<link rel="stylesheet" href="/assets/fonts.css">' });
        fontsInserted = true;
      }
    } else if (preview && token.name === 'meta' && attr(token, 'name')?.toLowerCase() === 'robots') {
      edits.push({ start: token.start, end: token.end, text: '' });
    }
  }
  if (headEnd === undefined) throw new Error(`${page}: missing closing head`);
  if (mobilePages.has(page)) {
    if (bodyStart === undefined) throw new Error(`${page}: missing opening body for mobile navigation`);
    edits.push(desktopNavigationEdit(page, tokens, attr));
    edits.push({ start: bodyStart, end: bodyStart, text: mobileHeader });
  }
  if (gaLoader !== gaInline || gaLoader > 1) throw new Error(`${page}: legacy GA loader/config pair is inconsistent`);
  const additions = [
    ...(fontsInserted ? [] : ['<link rel="stylesheet" href="/assets/fonts.css">']),
    ...(mobilePages.has(page) ? [
      '<link rel="stylesheet" href="/assets/mobile.css">',
      '<link rel="stylesheet" href="/assets/navigation.css">',
      '<script src="/assets/mobile.js" defer></script>',
      '<script src="/assets/navigation.js" defer></script>',
    ] : []),
    '<link rel="stylesheet" href="/assets/privacy-controls.css">',
    '<script src="/assets/privacy-controls.js" defer></script>',
    ...(preview ? ['<meta name="robots" content="noindex, nofollow, noarchive">'] : []),
  ].join('\n') + '\n';
  edits.push({ start: headEnd, end: headEnd, text: additions });
  return applyEdits(source, edits);
}

export function inspectHtml(page, html, inventory = { scripts: new Set(), styles: new Set(), attributes: new Set() }) {
  let titleCount = 0;
  for (const token of htmlTokens(html)) {
    if (token.closing) continue;
    for (const [name] of token.attrs) if (/^on/i.test(name)) throw new Error(`${page}: inline event handler remains: ${name}`);
    // Attribute source newlines are normalized before entities are decoded.
    // A CR produced by an entity must not be normalized a second time.
    if (token.attrs.has('style')) inventory.attributes.add(cspHash(attr(token, 'style'), false));
    if (token.name === 'style') inventory.styles.add(cspHash(token.body));
    if (token.name === 'title' && token.body.trim()) titleCount += 1;
    if (token.name === 'base') throw new Error(`${page}: base element is not permitted`);
    if (token.name === 'script') {
      const type = attr(token, 'type')?.toLowerCase();
      const source = attr(token, 'src');
      if (type === 'application/ld+json') {
        if (source !== undefined) throw new Error(`${page}: external JSON-LD is not approved`);
        JSON.parse(token.body); // Existing claim semantics are preserved, not approved.
      } else if (source !== undefined) {
        if (!/^\/assets\/[a-z0-9_.\/-]+\.js(?:[?#][^\s]*)?$/i.test(source) || token.body.trim()) throw new Error(`${page}: unexpected external executable script: ${source}`);
      } else {
        if (type && !['text/javascript', 'application/javascript', 'module'].includes(type)) throw new Error(`${page}: unreviewed inline script type: ${type}`);
        if (token.body.includes('gtag(') || token.body.includes('googletagmanager.com')) throw new Error(`${page}: unconditional analytics code remains`);
        inventory.scripts.add(cspHash(token.body));
      }
    }
    for (const key of ['src', 'href']) if (token.attrs.has(key) && /fonts\.(?:googleapis|gstatic)\.com/i.test(attr(token, key))) throw new Error(`${page}: external font request remains`);
  }
  if (!titleCount) throw new Error(`${page}: title is missing`);
  return inventory;
}

export function expectedConfig(inventory) {
  const quoted = set => [...set].sort().map(hash => `'${hash}'`).join(' ');
  const analytics = 'https://www.google-analytics.com https://region1.google-analytics.com https://analytics.google.com https://region1.analytics.google.com';
  const policy = [
    "default-src 'self'",
    `script-src 'self' https://www.googletagmanager.com ${quoted(inventory.scripts)}`.trim(),
    "script-src-attr 'none'",
    `style-src 'self' ${quoted(inventory.styles)}`.trim(),
    inventory.attributes.size ? `style-src-attr 'unsafe-hashes' ${quoted(inventory.attributes)}` : "style-src-attr 'none'",
    "font-src 'self'",
    "img-src 'self' data: https://www.google-analytics.com https://www.googletagmanager.com",
    `connect-src 'self' https://www.googletagmanager.com ${analytics}`,
    'frame-src https://demo.vektorium.io https://mobile-demo.vektorium.io',
    "frame-ancestors 'self'", "object-src 'none'", "base-uri 'none'",
    "form-action 'self' mailto:", "worker-src 'none'", 'upgrade-insecure-requests',
  ].join('; ');
  if (Buffer.byteLength(policy) > 8000) throw new Error('CSP exceeds the conservative 8 KB review budget');
  const header = (key, value) => ({ key, value });
  return {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    framework: null, buildCommand: 'npm run build', installCommand: '', outputDirectory: 'dist', cleanUrls: true,
    redirects: [
      ...['/demo', '/demo.html'].flatMap(source => [
        {
          source,
          has: [{ type: 'header', key: 'user-agent', value: '.*(Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini).*' }],
          destination: 'https://mobile-demo.vektorium.io/demo',
          permanent: false,
        },
        { source, destination: 'https://demo.vektorium.io/', permanent: false },
      ]),
      ...['/generated', '/generated.html'].map(source => ({
        source,
        destination: 'https://demo.vektorium.io/demo?mode=standby&autostart=true',
        permanent: true,
      })),
    ],
    headers: [
      { source: '/(.*)', headers: [
        header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload'),
        header('X-Content-Type-Options', 'nosniff'), header('X-Frame-Options', 'SAMEORIGIN'),
        header('X-XSS-Protection', '0'), header('Referrer-Policy', 'strict-origin-when-cross-origin'),
        header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), accelerometer=(), gyroscope=(), magnetometer=(), usb=(), interest-cohort=(), clipboard-write=(self), fullscreen=(self "https://demo.vektorium.io" "https://mobile-demo.vektorium.io")'),
        header('Content-Security-Policy', policy),
        header('Cache-Control', 'public, max-age=0, must-revalidate'),
      ] },
      { source: '/assets/(.*)', headers: [header('Cache-Control', 'public, max-age=0, must-revalidate')] },
      { source: '/generated', headers: [header('X-Robots-Tag', 'noindex, follow')] },
      { source: '/generated.html', headers: [header('X-Robots-Tag', 'noindex, follow')] },
    ],
  };
}

function readRegular(root, relative) {
  let path = root;
  const parts = relative.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw new Error(`Unsafe public path: ${relative}`);
  for (const [index, part] of parts.entries()) {
    path = join(path, part);
    const status = lstatSync(path);
    if (status.isSymbolicLink() || (index === parts.length - 1 ? !status.isFile() : !status.isDirectory())) throw new Error(`Refusing non-regular public file: ${relative}`);
  }
  return readFileSync(path);
}

export function versionPageAssets(page, html, files) {
  const edits = [];
  for (const token of htmlTokens(html)) {
    if (token.closing || !['link', 'script'].includes(token.name)) continue;
    const key = token.name === 'script' ? 'src' : 'href';
    if (!token.attrs.has(key)) continue;
    const decoded = attr(token, key);
    const url = new URL(decoded, `${buildOrigin}/${page}`);
    if (url.origin !== buildOrigin || !/\.(?:css|js)$/i.test(url.pathname)) continue;
    const asset = decodeURIComponent(url.pathname).replace(/^\//, '');
    if (!/^assets\/(?:[a-z0-9_-][a-z0-9_.-]*\/)*[a-z0-9_-][a-z0-9_.-]*\.(?:css|js)$/i.test(asset)) throw new Error(`${page}: CSS/JS reference is outside the public assets boundary: ${decoded}`);
    if (!files.has(asset)) throw new Error(`${page}: missing regular public CSS/JS asset: ${asset}`);
    url.searchParams.delete('v');
    url.searchParams.append('v', sha256(files.get(asset)).slice(0, 16));
    const safe = `${url.pathname}${url.search}${url.hash}`.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const range = token.attrs.get(key);
    edits.push({ start: token.start + range.start, end: token.start + range.end, text: ` ${key}="${safe}"` });
  }
  return applyEdits(html, edits);
}

export function prepareBuild(root, environment, checkConfig = true, withLocalization = true) {
  const preview = environment !== 'production';
  for (const entry of readdirSync(root, { withFileTypes: true })) if (/\.html$/i.test(entry.name) && !publicPages.has(entry.name)) throw new Error(`HTML page is not in the public manifest: ${entry.name}`);
  const files = new Map();
  const searchSources = new Map();
  const inventory = { scripts: new Set(), styles: new Set(), attributes: new Set() };
  for (const page of publicPages) {
    const bytes = readRegular(root, page);
    const html = bytes.toString('utf8');
    if (!Buffer.from(html).equals(bytes)) throw new Error(`${page}: source must be valid UTF-8`);
    if (searchIndexPages.has(page)) searchSources.set(page, html);
    const prepared = prepareHtml(page, html, preview);
    inspectHtml(page, prepared, inventory);
    files.set(page, prepared);
  }
  const config = expectedConfig(inventory);
  if (checkConfig) {
    const actual = JSON.parse(readRegular(root, 'vercel.json').toString('utf8'));
    if (JSON.stringify(actual) !== JSON.stringify(config)) throw new Error('vercel.json does not match the reviewed reproducible CSP/config. Run node scripts/build.mjs --print-config and review the exact diff; the build never updates policy automatically.');
  }
  for (const file of fixedFiles) if (existsSync(join(root, file))) files.set(file, readRegular(root, file));
  for (const required of ['robots.txt', 'sitemap.xml', '.well-known/security.txt']) if (!files.has(required)) throw new Error(`Required public file missing: ${required}`);
  const visitAssets = relative => {
    const directory = join(root, relative);
    const status = lstatSync(directory);
    if (!status.isDirectory() || status.isSymbolicLink()) throw new Error(`Symlink/non-directory public assets boundary: ${relative}`);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`Unexpected public asset symlink: ${relative}/${entry.name}`);
      if (entry.name.startsWith('.')) continue;
      const asset = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visitAssets(asset);
      else if (entry.isFile() && assetExtensions.has(extname(entry.name))) files.set(asset, readRegular(root, asset));
      else throw new Error(`Public asset type is not allowlisted: ${asset}`);
    }
  };
  visitAssets('assets');
  // One explicit generated asset. Source JSON files remain outside the public
  // allowlist, and only the validated content manifest supplies search text.
  files.set(siteSearchIndexPath, Buffer.from(JSON.stringify(createSearchIndex(searchSources, htmlTokens)) + '\n'));
  const pagePaths = new Set(publicPages);
  if (withLocalization) {
    const sources = new Map([...mobilePages].map(page => [page, files.get(page)]));
    const generated = compileLocales({ root, sources, files, tokenize: htmlTokens, readAttribute: attr, readRegular });
    for (const page of generated) { pagePaths.add(page); inspectHtml(page, files.get(page).toString('utf8'), inventory); }
    if (JSON.stringify(expectedConfig(inventory)) !== JSON.stringify(config)) throw new Error('Localized output changed the exact reviewed CSP inventory');
  }
  for (const page of pagePaths) files.set(page, Buffer.from(versionPageAssets(page, files.get(page).toString('utf8'), files)));
  if (preview) files.set('robots.txt', Buffer.from('User-agent: *\nDisallow: /\n'));
  return { files, inventory, config, pagePaths, environment: preview ? 'preview' : 'production' };
}

export function build(root, environment, withLocalization = true) {
  // Complete validation and read every approved input BEFORE touching old output.
  const prepared = prepareBuild(root, environment, true, withLocalization);
  const output = join(root, 'dist');
  const marker = join(output, '.vektorium-static-output');
  if (existsSync(output)) {
    if (lstatSync(output).isSymbolicLink() || !lstatSync(output).isDirectory() || !existsSync(marker) || !lstatSync(marker).isFile() || lstatSync(marker).isSymbolicLink() || readFileSync(marker, 'utf8') !== markerText) throw new Error('Refusing to replace an unrecognized dist directory. Use a clean checkout.');
    rmSync(output, { recursive: true }); // Exact, validated generated output only.
  }
  mkdirSync(output);
  writeFileSync(marker, markerText);
  const report = { environment: prepared.environment, pages: [], assets: [], csp: {} };
  for (const [file, bytes] of prepared.files) {
    const target = join(output, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    (prepared.pagePaths.has(file) ? report.pages : report.assets).push({ file, bytes: bytes.length, sha256: sha256(bytes) });
  }
  for (const [kind, hashes] of Object.entries(prepared.inventory)) report.csp[kind] = [...hashes].sort();
  for (const list of [report.pages, report.assets]) list.sort((a, b) => a.file.localeCompare(b.file));
  writeFileSync(join(root, 'build-report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const arguments_ = process.argv.slice(2);
  if (arguments_.length === 1 && arguments_[0] === '--print-config') {
    const inventory = { scripts: new Set(), styles: new Set(), attributes: new Set() };
    for (const page of publicPages) inspectHtml(page, prepareHtml(page, readRegular(root, page).toString('utf8')), inventory);
    console.log(JSON.stringify(expectedConfig(inventory), null, 2)); // Read-only; never changes policy.
  } else if (arguments_.length === 1 && arguments_[0] === '--check') {
    const result = prepareBuild(root, process.env.VERCEL_ENV);
    console.log(`Checked ${result.pagePaths.size} pages, ${result.files.size - result.pagePaths.size} public assets; exact CSP/config and static-output boundary passed. No files written.`);
  } else if (!arguments_.length) {
    const result = build(root, process.env.VERCEL_ENV);
    console.log(`Built ${result.pages.length} pages and ${result.assets.length} public assets into dist (${result.environment}).`);
    console.log('Original desktop effects/styles preserved; no source, repository metadata, or development files are deployed.');
  } else throw new Error('Usage: node scripts/build.mjs [--check | --print-config]');
}
