/**
 * Dependency-free regression tests for the public-output build boundary.
 * Reads the real builder; every generated fixture and output stays inside one
 * process-owned temporary directory. Does not build or modify the checkout.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const checkout = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const builder = join(checkout, 'scripts/build.mjs');
const source = readFileSync(builder, 'utf8');
const manifest = source.match(/const publicPages = new Set\(\[([\s\S]*?)\]\);/);
assert.ok(manifest, 'Builder must retain an explicit literal public-page manifest');
const pages = [...manifest[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
assert.equal(pages.length, 28, 'Review the test inventory explicitly if the public manifest changes');
assert.equal(new Set(pages).size, pages.length, 'Public manifest contains duplicates');
assert.ok(pages.every(page => /^[a-z0-9-]+\.html$/.test(page)), 'Manifest paths must be root-level HTML files');

const temporaryParent = realpathSync(tmpdir());
const temporaryRoot = mkdtempSync(join(temporaryParent, 'vektorium-build-tests-'));
const ownershipToken = randomUUID();
const ownershipMarker = join(temporaryRoot, '.fixture-owner');
writeFileSync(ownershipMarker, ownershipToken);
let passed = 0;
let failed = 0;

function put(root, relative, content) {
  const target = resolve(root, relative);
  assert.ok(target.startsWith(root + '/'), 'Fixture write escaped its temporary directory');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function fixture(name) {
  assert.match(name, /^[a-z0-9-]+$/);
  const root = join(temporaryRoot, name);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  copyFileSync(builder, join(root, 'scripts/build.mjs'));
  for (const page of pages) {
    const robots = page === 'generated.html' ? 'noindex, follow' : 'index, follow';
    put(root, page, `<!doctype html><html lang="en"><head><title>${page}</title><meta name="robots" content="${robots}"><script src="/assets/site.js" defer></script></head><body><main>Build fixture</main></body></html>`);
  }
  put(root, 'assets/site.js', "'use strict';\n");
  put(root, 'robots.txt', 'User-agent: *\nAllow: /\nSitemap: https://vektorium.io/sitemap.xml\n');
  put(root, 'sitemap.xml', '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
  put(root, '.well-known/security.txt', 'Contact: mailto:fixture@example.invalid\nExpires: 2030-01-01T00:00:00Z\n');
  for (const path of ['README.md', 'secret.txt', 'docs/private.html', '.git/fixture-note', '.github/workflows/fixture.yml', 'scripts/private.js']) {
    put(root, path, 'Synthetic private fixture; never publish.\n');
  }
  put(root, 'package.json', '{"private":true}\n');
  return root;
}

function build(root, environment, expectedSuccess = true) {
  const env = { ...process.env };
  delete env.VERCEL_ENV;
  if (environment !== undefined) env.VERCEL_ENV = environment;
  const result = spawnSync(process.execPath, [join(root, 'scripts/build.mjs')], {
    cwd: root, env, encoding: 'utf8', timeout: 20_000, maxBuffer: 1_000_000,
  });
  assert.ifError(result.error);
  if (expectedSuccess) assert.equal(result.status, 0, result.stderr || result.stdout);
  else assert.notEqual(result.status, 0, 'Unsafe build unexpectedly succeeded');
  return result;
}

function robotsTags(html) {
  return [...html.matchAll(/<meta\b(?=[^>]*\bname\s*=\s*["']robots["'])[^>]*>/gi)];
}

function checkPreview(root) {
  for (const page of pages) {
    const html = readFileSync(join(root, 'dist', page), 'utf8');
    const tags = robotsTags(html);
    assert.equal(tags.length, 1, `${page}: exactly one preview robots directive`);
    assert.match(tags[0][0], /content="noindex, nofollow, noarchive"/i);
  }
  assert.equal(readFileSync(join(root, 'dist/robots.txt'), 'utf8'), 'User-agent: *\nDisallow: /\n');
  assert.equal(JSON.parse(readFileSync(join(root, 'build-report.json'), 'utf8')).environment, 'preview');
}

function test(name, action) {
  try {
    action();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

try {
  test('explicit production preserves indexing policy and excludes development files', () => {
    const root = fixture('production');
    build(root, 'production');
    const output = join(root, 'dist');
    assert.deepEqual(readdirSync(output).filter(name => name.endsWith('.html')).sort(), [...pages].sort());
    for (const page of pages) {
      assert.equal(readFileSync(join(output, page), 'utf8'), readFileSync(join(root, page), 'utf8'));
    }
    assert.equal(readFileSync(join(output, 'robots.txt'), 'utf8'), readFileSync(join(root, 'robots.txt'), 'utf8'));
    assert.ok(existsSync(join(output, '.well-known/security.txt')));
    for (const path of ['README.md', 'secret.txt', 'docs', '.git', '.github', 'scripts', 'package.json', 'build-report.json']) {
      assert.equal(existsSync(join(output, path)), false, `${path} must not be public output`);
    }
    const report = JSON.parse(readFileSync(join(root, 'build-report.json'), 'utf8'));
    assert.equal(report.environment, 'production');
    assert.equal(report.pages.length, pages.length);
  });

  for (const [name, environment] of [
    ['preview', 'preview'], ['absent-environment', undefined], ['unknown-environment', 'staging'],
    ['development', 'development'], ['wrong-case-production', 'Production'],
  ]) {
    test(`${name} fails closed to a non-indexable preview`, () => {
      const root = fixture(name);
      build(root, environment);
      checkPreview(root);
    });
  }

  test('recognized generated output can be rebuilt without retaining stale files', () => {
    const root = fixture('rebuild');
    build(root, 'production');
    put(root, 'dist/stale-test.txt', 'Synthetic stale build file.');
    build(root, 'preview');
    checkPreview(root);
    assert.equal(existsSync(join(root, 'dist/stale-test.txt')), false);
  });

  test('unexpected root HTML is rejected before prior output is touched', () => {
    const root = fixture('unexpected-page');
    build(root, 'production');
    put(root, 'dist/preserve-test.txt', 'Keep this synthetic prior output.');
    put(root, 'private-draft.html', '<!doctype html><title>Not approved for publication</title>');
    const result = build(root, 'production', false);
    assert.match(result.stderr, /not in the public manifest/);
    assert.equal(readFileSync(join(root, 'dist/preserve-test.txt'), 'utf8'), 'Keep this synthetic prior output.');
  });

  test('missing manifest page is rejected before prior output is touched', () => {
    const root = fixture('missing-page');
    build(root, 'production');
    put(root, 'dist/preserve-test.txt', 'Keep this synthetic prior output.');
    renameSync(join(root, 'terms.html'), join(root, 'terms.fixture-backup'));
    const result = build(root, 'production', false);
    assert.match(result.stderr, /terms\.html/);
    assert.equal(readFileSync(join(root, 'dist/preserve-test.txt'), 'utf8'), 'Keep this synthetic prior output.');
  });

  test('a symlink cannot substitute for an approved public page', () => {
    const root = fixture('symlink-page');
    renameSync(join(root, 'terms.html'), join(root, 'terms.fixture-backup'));
    symlinkSync(join(root, 'terms.fixture-backup'), join(root, 'terms.html'));
    const result = build(root, 'production', false);
    assert.match(result.stderr, /Refusing non-regular public file/);
    assert.equal(existsSync(join(root, 'dist')), false);
  });

  test('unrecognized output directory is preserved and rejected', () => {
    const root = fixture('unrecognized-output');
    put(root, 'dist/keep-test.txt', 'Do not delete this synthetic directory.');
    const result = build(root, 'production', false);
    assert.match(result.stderr, /Refusing to replace an unrecognized dist/);
    assert.equal(readFileSync(join(root, 'dist/keep-test.txt'), 'utf8'), 'Do not delete this synthetic directory.');
  });

  test('symlinked output is rejected without touching its target', () => {
    const root = fixture('symlink-output');
    put(root, 'saved-output/keep-test.txt', 'Keep this synthetic symlink target.');
    put(root, 'saved-output/.vektorium-static-output', 'Synthetic marker.');
    symlinkSync(join(root, 'saved-output'), join(root, 'dist'));
    const result = build(root, 'production', false);
    assert.match(result.stderr, /Refusing to replace an unrecognized dist/);
    assert.equal(readFileSync(join(root, 'saved-output/keep-test.txt'), 'utf8'), 'Keep this synthetic symlink target.');
  });

  test('non-public files in the assets directory cause a build failure', () => {
    const root = fixture('unexpected-asset');
    put(root, 'assets/private-notes.txt', 'Synthetic notes.');
    const result = build(root, 'production', false);
    assert.match(result.stderr, /Public asset type is not allowlisted/);
    assert.equal(existsSync(join(root, 'dist/assets/private-notes.txt')), false);
  });

  test('hidden editor metadata and every nested file stay out of public output', () => {
    const root = fixture('hidden-editor-metadata');
    put(root, 'assets/.editor-private/session.txt', 'Synthetic editor metadata.');
    put(root, 'assets/.editor-private/nested/private.js', "'Synthetic private script; never publish';\n");
    put(root, 'assets/.editor-state', 'Synthetic hidden editor state.');
    build(root, 'production');
    assert.equal(existsSync(join(root, 'dist/assets/.editor-private')), false);
    assert.equal(existsSync(join(root, 'dist/assets/.editor-private/session.txt')), false);
    assert.equal(existsSync(join(root, 'dist/assets/.editor-private/nested/private.js')), false);
    assert.equal(existsSync(join(root, 'dist/assets/.editor-state')), false);
    assert.deepEqual(readdirSync(join(root, 'dist/assets')), ['site.js']);
    const report = JSON.parse(readFileSync(join(root, 'build-report.json'), 'utf8'));
    assert.ok(!report.assets.some(asset => asset.file.includes('.editor-')));
  });
} finally {
  // Never recursively remove a broad or unresolved path. All checks must hold
  // for the exact mkdtemp directory and marker created by this test process.
  const safe = dirname(temporaryRoot) === temporaryParent
    && basename(temporaryRoot).startsWith('vektorium-build-tests-')
    && lstatSync(temporaryRoot).isDirectory()
    && !lstatSync(temporaryRoot).isSymbolicLink()
    && realpathSync(temporaryRoot) === temporaryRoot
    && existsSync(ownershipMarker)
    && readFileSync(ownershipMarker, 'utf8') === ownershipToken;
  if (!safe) throw new Error(`Refusing cleanup of unrecognized fixture directory: ${temporaryRoot}`);
  rmSync(temporaryRoot, { recursive: true });
}

console.log(`Build boundary tests: ${passed} passed; ${failed} failed. Checkout files were not modified.`);
process.exitCode = failed ? 1 : 0;
