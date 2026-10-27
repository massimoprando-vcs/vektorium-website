/** Human-facing runtime literals eligible for build-time translation. */
import { normalizeText, escapeText, applyTextEdits } from './localization.mjs';
export function scriptStrings(code) {
  const found = [];
  for (let i = 0; i < code.length; i += 1) {
    if (code.slice(i, i + 2) === '//') { i = code.indexOf('\n', i); if (i < 0) break; continue; }
    if (code.slice(i, i + 2) === '/*') { i = code.indexOf('*/', i + 2) + 1; if (i < 1) throw new Error('Unclosed comment'); continue; }
    if (!['"', "'", '`'].includes(code[i])) continue;
    const start = i, quote = code[i];
    let value = '';
    for (i += 1; i < code.length && code[i] !== quote; i += 1) {
      if (code[i] === '\\') {
        i += 1;
        value += ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' })[code[i]] ?? code[i];
      } else value += code[i];
    }
    if (code[i] !== quote) throw new Error('Unclosed JavaScript string');
    if (quote !== '`') found.push({ start, end: i + 1, value });
  }
  return found;
}
export function runtimeSources(files, homepage) {
  const sources = new Set([
    'Choose language', 'Language', 'Current language', 'Demo (English)',
    'Company', 'Platform', 'Solutions', 'Insights',
    '{count} result', '{count} results', 'SCROLL', 'VEKTORIUM is', 'Copied!',
  ]);
  for (const code of files) for (const { value } of scriptStrings(code)) {
    if (/^[A-Z][A-Za-z]/.test(value) && (value.includes(' ') || ['Close'].includes(value)) && !/[{}<>]/.test(value)) sources.add(value.trim());
  }
  const ticker = /var items=(\[[^;]+\]);/.exec(homepage);
  if (!ticker) throw new Error('Expected homepage ticker');
  for (const { value } of scriptStrings(ticker[1])) sources.add(value);
  return [...sources];
}

export function translateScript(code, translate, runtime, locale, options = {}) {
  const allowed = new Set(runtime);
  return applyTextEdits(code, scriptStrings(code).flatMap(literal => {
    const normalized = normalizeText(literal.value);
    let value = literal.value;
    if (allowed.has(normalized)) {
      const translated = translate(normalized);
      value = literal.value.match(/^\s*/)[0] + (options.htmlText ? escapeText(translated) : translated) + literal.value.match(/\s*$/)[0];
    } else if (options.htmlText && value.includes('VEKTORIUM is ')) value = value.replace('VEKTORIUM is ', escapeText(translate('VEKTORIUM is')) + ' ');
    if (value === './search-engine.js') value = '/assets/search-engine.js';
    if (value === '/assets/site-search-index.json') value = `/assets/site-search-index-${locale}.json`;
    if (['/privacy-policy', '/contact'].includes(value)) value = '/' + locale + value;
    return value === literal.value ? [] : [{ start: literal.start, end: literal.end, text: JSON.stringify(value) }];
  }));
}
