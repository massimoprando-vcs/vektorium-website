/* Search is entirely local to the public page index. No query is transmitted. */
const STOP_WORDS = new Set(['a', 'an', 'and', 'are', 'at', 'be', 'by', 'can', 'do', 'does', 'for', 'from', 'how', 'i', 'in', 'is', 'it', 'me', 'of', 'on', 'or', 'our', 'show', 'the', 'to', 'us', 'what', 'with']);

export function normalizeSearch(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export function searchTerms(query) {
  return [...new Set(normalizeSearch(String(query).slice(0, 100)).split(' ').filter(term => term && !STOP_WORDS.has(term)))].slice(0, 12);
}

const safeUrl = value => typeof value === 'string' && /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$/.test(value);
const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit).replace(/\s+/g, ' ').trim() : '';
const words = value => new Set(normalizeSearch(value).split(' ').filter(Boolean));

export function prepareSearchIndex(data) {
  if (data?.version !== 1 || !Array.isArray(data.pages) || data.pages.length > 200) throw new Error('Search index is unavailable');
  const seen = new Set();
  return data.pages.filter(page => page && safeUrl(page.url) && !seen.has(page.url) && seen.add(page.url)).map(page => {
    const prepared = {
      url: page.url,
      title: text(page.title, 220),
      description: text(page.description, 600),
      category: text(page.category, 40),
      headings: Array.isArray(page.headings) ? page.headings.filter(h => typeof h === 'string').slice(0, 100).map(h => text(h, 300)).join(' ') : '',
      body: text(page.body, 30000),
    };
    if (!prepared.title) return null;
    prepared.fields = {
      title: words(prepared.title),
      route: words(prepared.url.slice(1)),
      headings: words(prepared.headings),
      description: words(prepared.description),
      body: words(prepared.body),
    };
    return prepared;
  }).filter(Boolean);
}

function wordScore(set, term) {
  if (set.has(term)) return 1;
  // Complete words and deliberate partial typing; "ai" must not match "email".
  if (term.length >= 3 && [...set].some(word => word.startsWith(term) || (term.endsWith('s') && word === term.slice(0, -1)))) return 0.65;
  return 0;
}

export function rankSearch(pages, query, limit = 6) {
  const terms = searchTerms(query);
  if (!terms.length) return [];
  const phrase = terms.join(' ');
  return pages.map(page => {
    let score = 0;
    for (const term of terms) {
      const hit = Math.max(wordScore(page.fields.title, term) * 24, wordScore(page.fields.route, term) * 20,
        wordScore(page.fields.headings, term) * 10, wordScore(page.fields.description, term) * 6,
        wordScore(page.fields.body, term));
      if (!hit) return null;
      score += hit;
    }
    const title = normalizeSearch(page.title);
    if (title === phrase) score += 80;
    else if ((' ' + title + ' ').includes(' ' + phrase + ' ')) score += 35;
    if (normalizeSearch(page.url.slice(1)) === phrase) score += 50;
    return { page, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score || Number(['/', '/blog'].includes(a.page.url)) - Number(['/', '/blog'].includes(b.page.url)) || a.page.title.localeCompare(b.page.title, 'en') || a.page.url.localeCompare(b.page.url))
    .slice(0, Math.max(1, Math.min(limit, 20))).map(result => result.page);
}

export function searchExcerpt(page, query, limit = 165) {
  const terms = searchTerms(query);
  let source = page.description || page.body;
  const normalizedDescription = words(source);
  if (terms.length && !terms.some(term => wordScore(normalizedDescription, term)) && page.body) {
    const body = page.body;
    const expression = new RegExp('\\b(?:' + terms.join('|') + ')', 'i');
    const at = body.search(expression);
    if (at >= 0) {
      const start = Math.max(0, at - 45);
      source = (start ? '…' : '') + body.slice(start).replace(/^\S*\s/, start ? '' : '$&');
    }
  }
  if (source.length <= limit) return source;
  const clipped = source.slice(0, limit - 1);
  return clipped.slice(0, Math.max(clipped.lastIndexOf(' '), limit - 24)) + '…';
}
