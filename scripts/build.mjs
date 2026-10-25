/**
 * Dependency-free static output builder. Only this allowlisted output is served.
 * No package, source tooling, audit notes, Git metadata, or credentials are copied.
 */
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'dist');
const marker = join(output, '.vektorium-static-output');
// Fail closed: only Vercel's explicit production environment is indexable.
const preview = process.env.VERCEL_ENV !== 'production';
const publicPages = new Set([
  'index.html',
  'cypher-sentinel.html',
  'sovereign-cybersecurity-platform.html',
  'cybersecurity-convergence-platform.html',
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
  'security.html',
  'demo.html',
  'generated.html',
]);
const fixedFiles = new Set([
  'robots.txt', 'sitemap.xml', 'favicon.ico', 'favicon.svg',
  'favicon-48x48.png', 'favicon-180x180.png',
  'vektorium-logo.webp', 'vektorium-logo-1x.webp', 'vektorium-logo-2x.webp', 'vektorium-logo.png',
  '517e3ed770994898b0c5482b33af8418.txt',
]);
const assetExtensions = new Set(['.css', '.js', '.svg', '.png', '.webp', '.avif', '.jpg', '.jpeg', '.woff2']);
const report = { environment: preview ? 'preview' : 'production', pages: [], assets: [] };

function assertRegular(path) {
  if (!lstatSync(path).isFile()) throw new Error(`Refusing non-regular public file: ${path}`);
}

function checkHtml(file, html) {
  if (/\sstyle\s*=/i.test(html)) throw new Error(`${file}: inline style attribute remains`);
  if (/\son[a-z]+\s*=/i.test(html)) throw new Error(`${file}: inline event handler remains`);
  if (/<style\b/i.test(html)) throw new Error(`${file}: inline style block remains`);
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = match[1];
    if (/\btype\s*=\s*["']application\/ld\+json["']/i.test(attrs)) {
      JSON.parse(match[2]);
    } else if (!/\bsrc\s*=\s*["']\/assets\/[a-z0-9_./-]+\.js["']/i.test(attrs) || match[2].trim()) {
      throw new Error(`${file}: executable scripts must be external first-party assets`);
    }
  }
  if (/fonts\.(?:googleapis|gstatic)\.com/i.test(html)) throw new Error(`${file}: external font request remains`);
  if (!/<title>[^<]+<\/title>/i.test(html)) throw new Error(`${file}: missing title`);
}

function copyFile(relative) {
  const source = join(root, relative);
  const target = join(output, relative);
  assertRegular(source);
  mkdirSync(dirname(target), { recursive: true });
  if (extname(relative) === '.html') {
    let html = readFileSync(source, 'utf8');
    checkHtml(relative, html);
    if (preview) {
      html = html.replace(/<meta\b(?=[^>]*\bname\s*=\s*["']robots["'])[^>]*>/gi, '');
      html = html.replace(/<\/head>/i, '<meta name="robots" content="noindex, nofollow, noarchive">\n</head>');
    }
    writeFileSync(target, html);
    report.pages.push({ file: relative, bytes: Buffer.byteLength(html) });
  } else if (relative === 'robots.txt' && preview) {
    writeFileSync(target, 'User-agent: *\nDisallow: /\n');
  } else {
    cpSync(source, target);
    const bytes = readFileSync(target);
    report.assets.push({ file: relative, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
}

function copyAssets(relative) {
  const directory = join(root, relative);
  if (lstatSync(directory).isSymbolicLink()) throw new Error(`Symlink not allowed in public assets: ${relative}`);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`Unexpected public asset symlink: ${relative}/${entry.name}`);
    // Editor/tool metadata and hidden files are never public assets.
    if (entry.name.startsWith('.')) continue;
    const path = `${relative}/${entry.name}`;
    if (entry.isDirectory()) copyAssets(path);
    else if (entry.isFile() && assetExtensions.has(extname(entry.name))) copyFile(path);
    else throw new Error(`Public asset type is not allowlisted: ${path}`);
  }
}

// Validate the manifest before touching prior generated output. A draft or
// internal HTML file cannot silently become a public page on the next build.
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (entry.name.endsWith('.html') && !publicPages.has(entry.name)) {
    throw new Error(`HTML page is not in the public manifest: ${entry.name}`);
  }
}
for (const file of publicPages) assertRegular(join(root, file));

if (existsSync(output)) {
  if (lstatSync(output).isSymbolicLink() || !existsSync(marker)) {
    throw new Error('Refusing to replace an unrecognized dist directory. Use a clean checkout.');
  }
  rmSync(output, { recursive: true });
}
mkdirSync(output);
writeFileSync(marker, 'Generated only by scripts/build.mjs; safe to regenerate.\n');
for (const file of publicPages) copyFile(file);
for (const file of fixedFiles) {
  if (existsSync(join(root, file))) copyFile(file);
}
if (existsSync(join(root, 'assets'))) copyAssets('assets');
copyFile('.well-known/security.txt');
if (report.pages.length !== publicPages.size) throw new Error(`Public page manifest mismatch: ${report.pages.length} pages`);
report.pages.sort((a, b) => a.file.localeCompare(b.file));
report.assets.sort((a, b) => a.file.localeCompare(b.file));
writeFileSync(join(root, 'build-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Built ${report.pages.length} static pages and ${report.assets.length} assets into dist (${report.environment}).`);
console.log('No application runtime, package dependencies, repository metadata, or development files are deployed.');
