import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSearch, searchTerms, prepareSearchIndex, rankSearch, searchExcerpt } from '../assets/search-engine.js';

const data = { version: 1, pages: [
  { url: '/', title: 'Vektorium', description: 'Sovereign cybersecurity platform.', headings: ['Cypher Sentinel'], category: 'Company', body: 'Architecture integrations post quantum cryptography. Zero trust. SIEM XDR ransomware.' },
  { url: '/architecture', title: 'Architecture', description: 'Architecture and deployment for Cypher Sentinel.', headings: ['Integration bridges'], category: 'Platform', body: 'A sovereign architecture spanning cryptography and security operations.' },
  { url: '/integrations', title: 'Security integrations', description: 'Connect your security stack.', headings: ['Integration bridges'], category: 'Platform', body: 'Existing tools and APIs.' },
  { url: '/post-quantum-cybersecurity', title: 'Post-Quantum Cybersecurity', description: 'Quantum-resistant cryptography.', headings: ['ML-KEM'], category: 'Solutions', body: 'Post quantum cryptography for sovereign operations.' },
  { url: '/zero-trust-cybersecurity-platform', title: 'Zero Trust Cybersecurity', description: 'Verify identities and access.', headings: ['Access policy'], category: 'Solutions', body: 'Zero trust architecture.' },
  { url: '/email-security', title: 'Email security', description: 'Messages and attachments.', headings: [], category: 'Solutions', body: 'Mail protection and trail analysis.' },
  { url: '/ai-powered-siem-platform', title: 'AI-Powered SIEM Platform', description: 'AI-assisted security operations.', headings: ['Sovereign SIEM'], category: 'Solutions', body: 'Security information and event management.' },
  { url: '/endpoint-detection-response', title: 'Endpoint Detection and Response (EDR)', description: 'EDR and XDR for endpoint detection and response.', headings: ['XDR correlation'], category: 'Solutions', body: 'Correlate endpoint threats.' },
  { url: '/blog', title: 'Cybersecurity Resources and Insights', description: 'Guides on EDR/XDR and security.', headings: ['Endpoint Detection & Response (EDR/XDR)'], category: 'Insights', body: 'Resources about security.' },
  { url: '/privacy-policy', title: 'Privacy Policy', description: 'Privacy and personal data enquiries.', headings: [], category: 'Company', body: 'Contact privacy@vektorium.io.' },
] };
const pages = prepareSearchIndex(data);

test('normalizes case, accents, punctuation and post-quantum phrases', () => {
  assert.equal(normalizeSearch('  PÓST—QUANTUM  '), 'post quantum');
  assert.equal(rankSearch(pages, 'post-quantum')[0].url, '/post-quantum-cybersecurity');
  assert.deepEqual(searchTerms('What is the ZERO trust architecture?'), ['zero', 'trust', 'architecture']);
});

test('specific titles and routes outrank broad homepage references', () => {
  assert.equal(rankSearch(pages, 'architecture')[0].url, '/architecture');
  assert.equal(rankSearch(pages, 'integrations')[0].url, '/integrations');
  assert.equal(rankSearch(pages, 'privacy')[0].url, '/privacy-policy');
});

test('matches meaningful tokens and incomplete words without substring spam', () => {
  assert.equal(rankSearch(pages, 'arch')[0].url, '/architecture');
  assert.equal(rankSearch(pages, 'AI')[0].url, '/ai-powered-siem-platform');
  assert.ok(!rankSearch(pages, 'AI').some(page => page.url === '/email-security'));
  assert.ok(!rankSearch(pages, 'trust email').length, 'All query terms must match a page');
  assert.equal(rankSearch(pages, 'zero trust')[0].url, '/zero-trust-cybersecurity-platform');
});

test('acronyms find the intended technical capability pages', () => {
  assert.equal(rankSearch(pages, 'SIEM')[0].url, '/ai-powered-siem-platform');
  assert.equal(rankSearch(pages, 'XDR')[0].url, '/endpoint-detection-response');
  assert.equal(rankSearch(pages, 'ML-KEM')[0].url, '/post-quantum-cybersecurity');
});

test('empty, filler-only, hostile and unrelated queries return no invented results', () => {
  for (const query of ['', '   ', 'what is the', '<script>alert(1)</script>', 'zznotpresentzz']) assert.deepEqual(rankSearch(pages, query), []);
  assert.doesNotThrow(() => rankSearch(pages, 'a'.repeat(10000)));
  assert.ok(searchTerms('a'.repeat(10000))[0].length <= 100);
});

test('the index rejects off-site and executable URLs, duplicates and malformed shape', () => {
  assert.throws(() => prepareSearchIndex({ version: 2, pages: [] }));
  assert.throws(() => prepareSearchIndex({ version: 1, pages: new Array(201) }));
  const index = prepareSearchIndex({ version: 1, pages: [
    ...data.pages,
    ...['javascript:alert(1)', '//example.com', 'https://example.com/', '/contact?private=query', '/contact#part', '/assets/private.json', '/%2fexample.com', '/..', '/bad\\path'].map(url => ({ url, title: 'Invalid' })),
    { url: '/architecture', title: 'Duplicate' }, { url: '/blank', title: '' },
  ] });
  assert.equal(index.length, data.pages.length);
  assert.deepEqual(index.map(page => page.url), pages.map(page => page.url));
});

test('snippets stay concise and hostile source text remains plain text', () => {
  const untrusted = prepareSearchIndex({ version: 1, pages: [{ url: '/example', title: '<img src=x onerror=alert(1)>', description: '<script>literal text</script>', headings: [], body: 'Architecture. '.repeat(100) }] })[0];
  assert.equal(untrusted.title, '<img src=x onerror=alert(1)>');
  assert.equal(searchExcerpt(untrusted, 'literal'), '<script>literal text</script>');
  assert.ok(searchExcerpt(untrusted, 'architecture').length <= 165);
});

test('ranking is deterministic and respects the result limit', () => {
  const first = rankSearch(pages, 'cybersecurity', 2).map(page => page.url);
  assert.equal(first.length, 2);
  assert.deepEqual(first, rankSearch([...pages].reverse(), 'cybersecurity', 2).map(page => page.url));
});
