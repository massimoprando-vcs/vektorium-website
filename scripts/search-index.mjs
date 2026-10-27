/** Pure extraction for the approved public HTML corpus. No filesystem, network,
 * repository discovery, query logging or hand-maintained search content. */
export const siteSearchIndexPath = 'assets/site-search-index.json';
export const searchBodyLimit = 24_000;

const excludedElements = new Set(['nav', 'footer', 'script', 'style', 'svg', 'canvas', 'template', 'noscript', 'textarea', 'button']);
// Existing page templates also use these div-based navigation containers.
const navigationClasses = ['breadcrumb', 'internal-links', 'nav-links'];
const voidElements = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const blockElements = new Set(['address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'ol', 'p', 'pre', 'section', 'table', 'td', 'th', 'tr', 'ul']);
const platformPages = new Set(['cypher-sentinel.html', 'architecture.html', 'integrations.html', 'cybersecurity-convergence-platform.html', 'sovereign-cybersecurity-platform.html']);
const companyPages = new Set(['index.html', 'contact.html', 'privacy-policy.html', 'terms.html']);
const textEntities = { amp: '&', AMP: '&', quot: '"', QUOT: '"', apos: "'", lt: '<', LT: '<', gt: '>', GT: '>', nbsp: ' ', copy: '©', reg: '®', trade: '™', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', bull: '•', middot: '·', larr: '←', rarr: '→', times: '×' };

function decodeText(value) {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (entity, name) => {
    if (name[0] !== '#') return textEntities[name] ?? entity;
    const hex = name[1]?.toLowerCase() === 'x';
    const code = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ' ';
  });
}

const cleanText = value => decodeText(value).replace(/\s+/gu, ' ').trim();
const attribute = (node, name) => decodeText(node.token?.attrs.get(name)?.raw ?? '');
const hasClass = (node, name) => attribute(node, 'class').split(/\s+/).includes(name);
const isContentRoot = node => node.name === 'main' || node.name === 'article' || attribute(node, 'role') === 'main' || hasClass(node, 'content-wrapper');

function bounded(value, limit) {
  if (value.length <= limit) return value;
  let result = value.slice(0, limit);
  // Never split a Unicode surrogate pair, and prefer a complete final word.
  if (/[\uD800-\uDBFF]$/.test(result)) result = result.slice(0, -1);
  const space = result.lastIndexOf(' ');
  return (space > limit - 120 ? result.slice(0, space) : result).trim();
}

function parseDocument(html, tokenize) {
  const document = { name: 'document', children: [], ignored: false };
  const stack = [document];
  let cursor = 0;
  const appendText = value => {
    // The shared tokenizer deliberately omits comments and declarations.
    const text = value.replace(/<!--[\s\S]*?-->|<![^>]*>/g, '');
    if (text) stack.at(-1).children.push(text);
  };
  for (const token of tokenize(html)) {
    appendText(html.slice(cursor, token.start));
    cursor = token.end;
    if (token.closing) {
      const position = stack.findLastIndex(node => node.name === token.name);
      if (position > 0) stack.length = position;
      continue;
    }
    const node = { name: token.name, token, children: [], ignored: false };
    const role = attribute(node, 'role').toLowerCase();
    node.ignored = excludedElements.has(node.name) || navigationClasses.some(name => hasClass(node, name)) || token.attrs.has('data-search-ignore') ||
      token.attrs.has('hidden') || attribute(node, 'aria-hidden').toLowerCase() === 'true' ||
      ['navigation', 'contentinfo', 'search', 'banner'].includes(role) ||
      (node.name === 'header' && !stack.some(isContentRoot));
    stack.at(-1).children.push(node);
    if (token.body !== undefined) node.children.push(token.body);
    else if (!voidElements.has(node.name) && !/\/\s*>$/.test(token.raw)) stack.push(node);
  }
  appendText(html.slice(cursor));
  return document;
}

function findElements(node, predicate, stopAtMatch = false) {
  if (typeof node === 'string' || node.ignored) return [];
  const matches = predicate(node) ? [node] : [];
  if (matches.length && stopAtMatch) return matches;
  return matches.concat(node.children.flatMap(child => findElements(child, predicate, stopAtMatch)));
}

function textContent(node) {
  if (typeof node === 'string') return node;
  if (node.ignored || node.name === 'head') return '';
  // Animated statistics start at zero in HTML; index their approved final count.
  const target = hasClass(node, 'counter') ? attribute(node, 'data-target') : '';
  const text = /^(?:0|[1-9]\d*)$/.test(target) && Number.isSafeInteger(Number(target))
    ? target : node.children.map(textContent).join('');
  return blockElements.has(node.name) ? ` ${text} ` : text;
}

function pageUrl(page) {
  if (!/^[a-z0-9-]+\.html$/.test(page) || ['demo.html', 'generated.html'].includes(page)) {
    throw new Error(`Not an indexable public content filename: ${page}`);
  }
  return page === 'index.html' ? '/' : '/' + page.slice(0, -5);
}

function category(page) {
  if (page === 'blog.html' || page.startsWith('insight-')) return 'Insights';
  if (companyPages.has(page)) return 'Company';
  return platformPages.has(page) ? 'Platform' : 'Solutions';
}

export function extractSearchPage(page, html, tokenize) {
  const url = pageUrl(page);
  const document = parseDocument(html, tokenize);
  let roots = findElements(document, node => node.name === 'main' || attribute(node, 'role') === 'main', true);
  if (!roots.length) roots = findElements(document, node => hasClass(node, 'content-wrapper'), true);
  if (!roots.length) roots = findElements(document, node => node.name === 'article', true);
  if (!roots.length) roots = findElements(document, node => node.name === 'body', true);
  if (!roots.length) roots = [document];
  const headingNodes = roots.flatMap(root => findElements(root, node => /^h[1-6]$/.test(node.name)));
  const headingText = node => cleanText(textContent(node));
  const h1 = headingNodes.filter(node => node.name === 'h1').map(headingText).find(Boolean);
  const titleNode = findElements(document, node => node.name === 'title')[0];
  const fallbackTitle = titleNode ? cleanText(textContent(titleNode)).replace(/\s*(?:\||[-–—])\s*Vektorium(?:\s+Inc\.?)?\s*$/i, '').trim() : '';
  const descriptionNode = findElements(document, node => node.name === 'meta' && attribute(node, 'name').toLowerCase() === 'description')[0];
  return {
    url,
    title: bounded(h1 || fallbackTitle || page.slice(0, -5).replace(/-/g, ' '), 240),
    description: bounded(cleanText(descriptionNode?.token.attrs.get('content')?.raw ?? ''), 600),
    category: category(page),
    headings: [...new Set(headingNodes.map(headingText).filter(Boolean).map(text => bounded(text, 240)))].slice(0, 80),
    body: bounded(cleanText(roots.map(textContent).join(' ')), searchBodyLimit),
  };
}

/** The caller supplies only already validated, manifest-approved HTML sources. */
export function createSearchIndex(sources, tokenize) {
  const pages = [...sources].map(([page, html]) => extractSearchPage(page, html, tokenize));
  pages.sort((a, b) => a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
  if (new Set(pages.map(page => page.url)).size !== pages.length) throw new Error('Duplicate public search URL');
  return { version: 1, pages };
}
