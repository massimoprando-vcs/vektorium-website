/** Explicit maintenance operation: translations are never silently regenerated. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mobilePages, prepareHtml, htmlTokens } from './build.mjs';
import { createCatalog } from './localization.mjs';
import { runtimeSources } from './localization-runtime.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sources = new Map([...mobilePages].map(page => [page, prepareHtml(page, readFileSync(join(root, page), 'utf8'))]));
const runtime = runtimeSources(['assets/home-search.js', 'assets/privacy-controls.js'].map(path => readFileSync(join(root, path), 'utf8')), readFileSync(join(root, 'index.html'), 'utf8'));
const catalogue = createCatalog(sources, htmlTokens, runtime);
mkdirSync(join(root, 'locales'), { recursive: true });
writeFileSync(join(root, 'locales/source.json'), JSON.stringify(catalogue, null, 2) + '\n');
console.log(JSON.stringify({ units: catalogue.units.length, sourceHash: catalogue.sourceHash, words: catalogue.units.reduce((n, unit) => n + unit.source.split(/\s+/).length, 0) }));
