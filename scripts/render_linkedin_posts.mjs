#!/usr/bin/env node
// Publication archive renderer. Source text is escaped, never rewritten.
// --check and --test are read-only. Default mode writes generated output only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://vektorium.io';
const CSS_LINK = '<link rel="stylesheet" href="/assets/blog-insights.css">';
const ARCHIVE_START = '<!-- BEGIN LINKEDIN PUBLICATION ARCHIVE -->';
const ARCHIVE_END = '<!-- END LINKEDIN PUBLICATION ARCHIVE -->';
const SITEMAP_START = '<!-- BEGIN LINKEDIN INSIGHTS SITEMAP -->';
const SITEMAP_END = '<!-- END LINKEDIN INSIGHTS SITEMAP -->';
const MODIFIED = '2026-10-25';
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const decodeHtml = value => value.replace(/&quot;/g, '"').replace(/&#(?:39|x27);/g, "'").replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
const normalizeSpace = value => value.replace(/\s+/g, ' ').trim();
const jsonForHtml = value => JSON.stringify(value, null, 2).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
const dateLabel = value => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(value + 'T00:00:00Z'));

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function safeSource(value, id) {
  const url = new URL(value);
  assert.equal(url.origin, 'https://www.linkedin.com', 'Source must be an HTTPS LinkedIn URL');
  assert.ok(!url.username && !url.password && !url.search && !url.hash, 'Unexpected source URL components');
  assert.ok(url.pathname === `/feed/update/urn:li:activity:${id}` || new RegExp(`^/posts/vektorium_[a-zA-Z0-9_-]+-activity-${id}-[a-zA-Z0-9_-]+/?$`).test(url.pathname), 'Post source and ID do not match');
  return value;
}

function safeImage(image, checkFile = true) {
  assert.match(image.path, /^\/assets\/blog\/linkedin-\d+-\d+\.webp$/, 'Only local approved WebP images are allowed');
  assert.ok(Number.isInteger(image.width) && image.width > 0 && Number.isInteger(image.height) && image.height > 0, 'Image dimensions required');
  assert.ok(typeof image.alt === 'string' && image.alt.trim(), 'Image alt text required');
  if (image.caption !== undefined) assert.equal(typeof image.caption, 'string');
  if (checkFile) {
    const filename = path.join(ROOT, image.path.slice(1));
    assert.ok(!fs.lstatSync(filename).isSymbolicLink(), 'Image symlinks are not allowed');
    const bytes = fs.readFileSync(filename);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', 'Expected WebP RIFF image');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP', 'Expected WebP image');
  }
}

function validateData(data, checkImages = true) {
  assert.ok(validDate(data.capturedOn), 'Valid capture date required');
  assert.equal(data.posts.length, 13, 'Expected the 13 reviewed publication records');
  assert.equal(data.posts.filter(p => p.kind === 'article').length, 11, 'Expected 11 original articles');
  assert.equal(data.posts.filter(p => p.kind === 'repost').length, 1, 'Expected one repost');
  assert.equal(data.posts.filter(p => p.kind === 'link').length, 1, 'Expected one link update');
  const ids = new Set(), slugs = new Set();
  for (const post of data.posts) {
    assert.match(post.id, /^\d{19}$/);
    assert.ok(!ids.has(post.id), 'Duplicate publication ID'); ids.add(post.id);
    assert.equal(post.author, 'Vektorium Inc.');
    assert.ok(validDate(post.datePublished) && post.datePublished <= data.capturedOn, 'Invalid or future publication date');
    assert.ok(typeof post.body === 'string' && post.body.trim() && typeof post.title === 'string' && post.title.trim(), 'Body and title are required');
    assert.ok(!/(?:^|\n)\s*hashtag(?:\s|$)/i.test(post.body), 'LinkedIn accessibility hashtag label remains');
    assert.ok(normalizeSpace(post.body).includes(normalizeSpace(post.title)), 'Heading must remain a source excerpt');
    safeSource(post.sourceUrl, post.id);
    if (post.kind === 'article') {
      assert.match(post.slug, /^insight-[a-z0-9]+(?:-[a-z0-9]+)*$/);
      assert.ok(!slugs.has(post.slug), 'Duplicate article slug'); slugs.add(post.slug);
    } else assert.equal(post.slug, null);
    assert.ok(Array.isArray(post.images));
    for (const image of post.images) safeImage(image, checkImages);
    for (const link of post.links || []) {
      const url = new URL(link.url);
      assert.ok(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password, 'Unsafe source link');
      assert.ok(['www.linkedin.com', 'linkedin.com', 'vektorium.io', 'www.vektorium.io', 'lnkd.in'].includes(url.hostname), 'Unexpected source-link host');
    }
  }
  for (const post of data.posts.filter(p => p.kind === 'repost')) {
    const original = data.posts.find(p => p.id === post.repostOf && p.kind === 'article');
    assert.ok(original && original.datePublished <= post.datePublished, 'Invalid repost relationship');
    assert.equal(post.body, original.body, 'Repost text differs from its original');
  }
}

function excerpt(post, limit = 190) {
  const blocks = post.body.split(/\n\s*\n/).map(normalizeSpace).filter(Boolean);
  const text = blocks.find(block => block !== 'vektorium.io' && block !== post.title && !block.startsWith('#')) || blocks[0];
  if (text.length <= limit) return text;
  const truncated = text.slice(0, limit);
  return truncated.slice(0, truncated.lastIndexOf(' ')) + '…';
}

function figure(image, hero = false) {
  return `<figure class="insight-figure"><img src="${escapeHtml(image.path)}" alt="${escapeHtml(image.alt)}" width="${image.width}" height="${image.height}" loading="${hero ? 'eager' : 'lazy'}" decoding="async">${image.caption ? `<figcaption>${escapeHtml(image.caption)}</figcaption>` : ''}</figure>`;
}

function renderArchive(posts) {
  const cards = posts.map((post, index) => {
    const original = post.kind === 'repost' ? posts.find(p => p.id === post.repostOf) : null;
    const target = post.kind === 'article' ? '/' + post.slug : original ? '/' + original.slug : '/';
    const kind = post.kind === 'repost' ? 'Repost' : post.kind === 'link' ? 'Website update' : 'Published insight';
    const image = post.images[0];
    const media = image ? `<a class="insight-card-media" href="${target}" tabindex="-1" aria-hidden="true"><img src="${escapeHtml(image.path)}" alt="" width="${image.width}" height="${image.height}" loading="lazy" decoding="async"></a>` : '';
    const note = original ? `<p class="insight-repost-note">Reposted on ${dateLabel(post.datePublished)}. Original publication: ${dateLabel(original.datePublished)}.</p>` : '';
    const primary = post.kind === 'article' ? 'Read insight' : original ? 'Read original insight' : 'Visit Vektorium';
    return `<article class="insight-card${index === 0 ? ' insight-card-featured' : ''}" data-publication-id="${post.id}" data-publication-kind="${post.kind}">${media}<div class="insight-card-content"><div class="insight-meta"><span class="insight-kind">${kind}</span><time datetime="${post.datePublished}">${dateLabel(post.datePublished)}</time></div><h3><a href="${target}">${escapeHtml(post.title)}</a></h3><p class="insight-excerpt">${escapeHtml(excerpt(post))}</p>${note}<div class="insight-card-actions"><a class="insight-read-link" href="${target}">${primary}<span aria-hidden="true"> ↗</span></a><a class="insight-source-link" href="${escapeHtml(post.sourceUrl)}" target="_blank" rel="noopener noreferrer">${original ? 'View repost' : 'Original on LinkedIn'}<span class="vx-visually-hidden"> (opens in a new tab)</span></a></div></div></article>`;
  }).join('\n');
  return `${ARCHIVE_START}\n<section class="insight-archive" aria-labelledby="published-insights"><div class="insight-section-heading"><p class="insight-eyebrow">From Vektorium</p><h2 id="published-insights">Published insights</h2><p>Ideas and perspectives published by Vektorium. Original publication dates and LinkedIn sources are retained.</p></div><div class="insight-archive-grid">\n${cards}\n</div></section>\n${ARCHIVE_END}`;
}

function renderArticle(post, chrome) {
  const canonical = ORIGIN + '/' + post.slug;
  const description = excerpt(post, 165);
  const hero = post.images[0];
  const socialImage = ORIGIN + (hero ? hero.path : '/vektorium-logo.webp');
  const schema = {
    '@context': 'https://schema.org', '@type': 'BlogPosting', '@id': canonical + '#article',
    headline: post.title, description, url: canonical, mainEntityOfPage: canonical,
    datePublished: post.datePublished, inLanguage: 'en',
    author: { '@type': 'Organization', name: post.author, url: ORIGIN + '/' },
    publisher: { '@type': 'Organization', name: 'Vektorium Inc.', url: ORIGIN + '/', logo: { '@type': 'ImageObject', url: ORIGIN + '/vektorium-logo.webp' } },
    isBasedOn: post.sourceUrl, articleBody: post.body,
    ...(post.images.length ? { image: post.images.map(image => ({ '@type': 'ImageObject', url: ORIGIN + image.path, width: image.width, height: image.height })) } : {})
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(post.title)} | Vektorium Insights</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="alternate" hreflang="en" href="${canonical}">
<link rel="alternate" hreflang="x-default" href="${canonical}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48x48.png">
<link rel="apple-touch-icon" sizes="180x180" href="/favicon-180x180.png">
<meta property="og:site_name" content="Vektorium">
<meta property="og:type" content="article">
<meta property="og:url" content="${canonical}">
<meta property="og:title" content="${escapeHtml(post.title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${socialImage}">
<meta property="og:image:alt" content="${escapeHtml(hero ? hero.alt : 'Vektorium logo')}">
<meta property="article:published_time" content="${post.datePublished}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(post.title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${socialImage}">
<script type="application/ld+json">${jsonForHtml(schema)}</script>
<link rel="stylesheet" href="/assets/styles/blog.css">
${CSS_LINK}
</head>
<body class="insight-page">
<div class="cursor-dot" id="cursorDot" aria-hidden="true"></div>
<div class="cursor-ring" id="cursorRing" aria-hidden="true"></div>
<div class="canvas-wrapper" aria-hidden="true"><canvas id="fluidCanvas" aria-hidden="true"></canvas></div>
${chrome.nav}
<nav class="breadcrumb insight-breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a><span aria-hidden="true">›</span><a href="/blog#published-insights">Published insights</a></nav>
<main class="page-content insight-main" id="main-content" tabindex="-1">
<article class="insight-article" aria-labelledby="insight-title">
<header class="insight-article-header"><p class="insight-eyebrow">Vektorium / Published insight</p><h1 id="insight-title">${escapeHtml(post.title)}</h1><div class="insight-meta"><span>${escapeHtml(post.author)}</span><time datetime="${post.datePublished}">${dateLabel(post.datePublished)}</time></div><p class="insight-publication-note">Originally published on LinkedIn. The publication text below is retained as published.</p><a class="insight-source-link" href="${escapeHtml(post.sourceUrl)}" target="_blank" rel="noopener noreferrer">View original publication<span class="vx-visually-hidden"> (opens in a new tab)</span><span aria-hidden="true"> ↗</span></a></header>
${hero ? figure(hero, true) : ''}
<div class="insight-body" id="publication-text">${escapeHtml(post.body)}</div>
${post.images.slice(1).map(image => figure(image)).join('\n')}
<footer class="insight-article-footer"><a href="/blog#published-insights">← All published insights</a><a href="/cypher-sentinel">Explore Cypher Sentinel →</a></footer>
</article>
</main>
${chrome.footer}
<noscript><div class="insight-noscript">This publication and its navigation work without JavaScript. <a href="/privacy-policy">Privacy information</a> · <a href="/blog">All resources</a></div></noscript>
</body>
</html>
`;
}

function replaceMarked(source, begin, end, block, anchor) {
  const first = source.indexOf(begin), last = source.indexOf(end);
  assert.equal(first < 0, last < 0, 'Incomplete generation markers');
  if (first >= 0) {
    assert.equal(source.indexOf(begin, first + begin.length), -1, 'Duplicate generation block');
    return source.slice(0, first) + block + source.slice(last + end.length);
  }
  assert.equal(source.indexOf(anchor), source.lastIndexOf(anchor), 'Insertion anchor is not unique');
  assert.ok(source.includes(anchor), 'Insertion anchor missing');
  return source.replace(anchor, block + '\n\n' + anchor);
}

function normalizePages(pages) {
  const python = `import json,sys\nfrom pathlib import Path\nsys.path.insert(0,str(Path.cwd()/'scripts'))\nfrom harden_site import transform_page\nresult=[]\nfor item in json.load(sys.stdin):\n r=transform_page(item['html'],item['filename'],item.get('css'),normalize_schema=False)\n r2=transform_page(r.html,item['filename'],r.css,normalize_schema=False)\n if r.html!=r2.html or r.css!=r2.css: raise ValueError('Non-idempotent transform')\n result.append({'filename':item['filename'],'html':r.html,'css':r.css})\njson.dump(result,sys.stdout,ensure_ascii=False)`;
  const result = spawnSync('python3', ['-B', '-c', python], { cwd: ROOT, input: JSON.stringify(pages), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || 'HTML normalization failed');
  return JSON.parse(result.stdout);
}

function assertArticle(html, post) {
  const body = html.match(/<div class="insight-body" id="publication-text">([\s\S]*?)<\/div>/);
  assert.ok(body, 'Publication text missing');
  assert.equal(decodeHtml(body[1]), post.body, 'Published body changed during rendering');
  const schema = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(schema.articleBody, post.body);
  assert.equal(schema.datePublished, post.datePublished);
  assert.equal(schema.headline, post.title);
  assert.equal(schema.isBasedOn, post.sourceUrl);
  assert.ok(!/<iframe\b|<style\b|\sstyle=|<script(?![^>]*application\/ld\+json|[^>]*src="\/assets\/(?:site|desktop-effects)\.js")/i.test(html), 'Unexpected embed, inline style, or executable script');
}

function runTests() {
  let count = 0;
  const test = fn => { fn(); count++; };
  test(() => assert.equal(decodeHtml(escapeHtml('<script>&"\'😀')), '<script>&"\'😀'));
  test(() => assert.ok(!jsonForHtml({ text: '</script><script>alert(1)</script>' }).includes('</script>')));
  test(() => assert.ok(validDate('2026-10-16') && !validDate('2026-02-30') && !validDate('16 October 2026')));
  test(() => safeSource('https://www.linkedin.com/feed/update/urn:li:activity:7516703823625613312', '7516703823625613312'));
  test(() => assert.throws(() => safeSource('https://evil.example/posts/vektorium_x-activity-7516703823625613312-a', '7516703823625613312')));
  test(() => assert.throws(() => safeSource('javascript:alert(1)', '7516703823625613312')));
  test(() => assert.throws(() => safeSource('https://www.linkedin.com/feed/update/urn:li:activity:7516703823625613313', '7516703823625613312')));
  test(() => assert.throws(() => safeImage({ path: '/assets/blog/../private.webp', alt: 'x', width: 1, height: 1 }, false)));
  test(() => assert.throws(() => safeImage({ path: 'https://media.licdn.com/x.webp', alt: 'x', width: 1, height: 1 }, false)));
  test(() => assert.throws(() => validateData({ capturedOn: '2026-10-25', posts: [] }, false)));
  const sample = { id: '7516703823625613312', kind: 'article', slug: 'insight-test', title: 'Title <&>', body: 'Title <&>\n\n<script>alert("x")</script>\n#Tag', datePublished: '2026-10-16', author: 'Vektorium Inc.', sourceUrl: 'https://www.linkedin.com/feed/update/urn:li:activity:7516703823625613312', images: [] };
  test(() => assertArticle(renderArticle(sample, { nav: '<nav></nav>', footer: '<footer></footer>' }), sample));
  test(() => assert.equal(replaceMarked('a\nANCHOR', 'BEGIN', 'END', 'BEGINcontentEND', 'ANCHOR'), 'a\nBEGINcontentEND\n\nANCHOR'));
  test(() => assert.equal(replaceMarked('aBEGINoldENDb', 'BEGIN', 'END', 'BEGINnewEND', 'ANCHOR'), 'aBEGINnewENDb'));
  console.log(JSON.stringify({ mode: 'test', passed: count, failed: 0, writes: 0 }));
}

function main() {
  const args = process.argv.slice(2);
  assert.ok(args.length <= 1 && (!args.length || ['--check', '--test'].includes(args[0])), 'Usage: node scripts/render_linkedin_posts.mjs [--check|--test]');
  if (args[0] === '--test') return runTests();
  const check = args[0] === '--check';
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/linkedin-posts.json'), 'utf8'));
  validateData(data);
  const blogPath = path.join(ROOT, 'blog.html'), blog = fs.readFileSync(blogPath, 'utf8');
  const chrome = { nav: blog.match(/<nav class="site-nav">[\s\S]*?<\/nav>/)?.[0], footer: blog.match(/<footer class="footer">[\s\S]*?<\/footer>/)?.[0] };
  assert.ok(chrome.nav && chrome.footer, 'Existing blog navigation/footer not found');
  let archivePage = replaceMarked(blog, ARCHIVE_START, ARCHIVE_END, renderArchive(data.posts), '<h2 id="featured-resources">');
  if (!archivePage.includes(CSS_LINK)) {
    assert.ok(archivePage.includes('<meta name="robots"'), 'Missing metadata insertion anchor');
    archivePage = archivePage.replace('<meta name="robots"', CSS_LINK + '\n<meta name="robots"');
  }
  const articles = data.posts.filter(post => post.kind === 'article');
  const plans = articles.map(post => ({ filename: post.slug + '.html', html: renderArticle(post, chrome) }));
  plans.push({ filename: 'blog.html', html: archivePage, css: fs.readFileSync(path.join(ROOT, 'assets/styles/blog.css'), 'utf8') });
  const normalized = normalizePages(plans);
  const outputs = new Map();
  for (const item of normalized) {
    if (item.filename !== 'blog.html') assertArticle(item.html, articles.find(post => post.slug + '.html' === item.filename));
    outputs.set(item.filename, item.html);
    outputs.set('assets/styles/' + item.filename.replace(/\.html$/, '.css'), item.css);
  }
  const generatedBlog = outputs.get('blog.html');
  assert.equal((generatedBlog.match(/data-publication-id=/g) || []).length, 13);
  const schemas = html => html.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || [];
  assert.deepEqual(schemas(generatedBlog), schemas(blog), 'Existing blog schema changed');
  assert.equal(generatedBlog.slice(generatedBlog.indexOf('<h2 id="featured-resources">')), blog.slice(blog.indexOf('<h2 id="featured-resources">')), 'Existing guides or footer changed');
  const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  const sitemapBlock = SITEMAP_START + '\n' + articles.map(post => `  <url><loc>${ORIGIN}/${post.slug}</loc><lastmod>${MODIFIED}</lastmod></url>`).join('\n') + '\n' + SITEMAP_END;
  outputs.set('sitemap.xml', replaceMarked(sitemap, SITEMAP_START, SITEMAP_END, sitemapBlock, '</urlset>'));
  const stale = [];
  for (const [relative, expected] of outputs) {
    const filename = path.join(ROOT, relative);
    assert.ok(!fs.existsSync(filename) || !fs.lstatSync(filename).isSymbolicLink(), 'Refusing generated-output symlink');
    const actual = fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : null;
    if (actual !== expected) {
      stale.push(relative);
      if (!check) fs.writeFileSync(filename, expected, 'utf8');
    }
  }
  console.log(JSON.stringify({ mode: check ? 'check' : 'render', sourceRecords: data.posts.length, articles: articles.length, reposts: 1, linkUpdates: 1, images: data.posts.reduce((sum, post) => sum + post.images.length, 0), changed: stale, writes: check ? 0 : stale.length, sourceTextPreserved: true }, null, 2));
  if (check && stale.length) process.exitCode = 1;
}

try { main(); } catch (error) { console.error('render_linkedin_posts: ' + error.message); process.exitCode = 2; }
