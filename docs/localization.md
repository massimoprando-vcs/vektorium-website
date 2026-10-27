# Multilingual public website

The English HTML remains the editorial source. The dependency-free Node 24 build
emits all 38 public content pages in eight languages, plus the two existing demo
redirects: 306 HTML files in total. External demo applications are separate and
remain in English.

| Language | Menu label | Homepage | Example content page |
| --- | --- | --- | --- |
| English | English | `/` | `/architecture` |
| French | Français | `/fr` | `/fr/architecture` |
| Italian | Italiano | `/it` | `/it/architecture` |
| German | Deutsch | `/de` | `/de/architecture` |
| Spanish | Español | `/es` | `/es/architecture` |
| Portuguese | Português | `/pt` | `/pt/architecture` |
| Japanese | 日本語 | `/ja` | `/ja/architecture` |
| Korean | 한국어 | `/ko` | `/ko/architecture` |

Keep this exact language order. The desktop homepage globe is beside the Search
control above the logo. Other desktop pages put it in the fixed top navigation.
Every mobile page puts it in the fixed mobile header. Native details and anchor
elements provide the menu and equivalent-page navigation without JavaScript;
enhancements add dismissal, pointer light and section-hash preservation. Search
and navigation popovers close when the language menu opens. There are no browser
language redirects, location redirects, language cookies or translation services.

## Content maintenance

1. Edit the approved English HTML or eligible runtime interface text.
2. Run `node scripts/update-localization-source.mjs` explicitly and review the
   catalogue diff. A normal build never rewrites translation source data.
3. Translate every new or changed unit in all seven `locales/{code}.json` files;
   update their `sourceHash` only after reconciling the complete source catalogue.
4. Preserve numbered inline placeholders, including opening/closing pairs and
   self-closing placeholders. The original links and formatting are reinserted
   after escaping translated text. Preserve runtime `{count}` tokens exactly.
5. Keep product and legal qualifications, names, URLs, email addresses and
   numerical claims. Translation is not a new product or compliance assertion.
6. Refresh Japanese/Korean font subsets if the glyph-coverage check asks for it;
   see [font sources](font-sources.md).
7. Run the checks below and review the protected preview in all affected languages.

```sh
npm run check
npm run test:privacy
npm run test:search
npm run test:localization
npm run test:integration
VERCEL_ENV=production npm run build
```

The build rejects incomplete or stale catalogues, unknown translation keys,
missing or malformed placeholders, invented markup, changed numerical claims,
changed protected brand/person names, and long untranslated English paragraphs.
These checks catch structural mistakes; they do not replace editorial review by
a speaker of the language. Terminology, nuance, short labels and the meaning of
claims still require judgment. The initial translations are model-generated and
have not been certified by professional native-language translators.

For Japanese and Korean, the numerical check compares the exact value of large
amounts across counting scales: for example, English 20 million is 2,000万 or
2,000만. Technical counts, dates and standard identifiers remain preserved.

The source catalogue covers visible text, accessible labels, image alternatives,
page titles/descriptions, human-readable JSON-LD, navigation, footer, search and
privacy interface strings. Brand names, standards, acronyms, email addresses,
URLs and original linked assets may remain in their original form. Original
English URL slugs and stable section IDs are retained inside each locale.

## Output and security

`scripts/localization.mjs` extracts and safely reinserts text. Its catalogue IDs
are SHA-256 prefixes of normalized source units, so identical text is translated
consistently across pages. `scripts/build-locales.mjs` generates the complete
output. Original English source files are not rewritten.

The original inline scripts, styles and style attributes retain their existing
CSP inventory. On translated pages, an inline script containing approved human
text is emitted as a same-origin external script at its original location. This
keeps its execution order and uses the existing `script-src 'self'` permission.
The CSP is neither broadened nor automatically regenerated. All other inline
effects remain exact. Translations never become executable markup or code.

Only `dist` is deployed. Catalogue JSON, font provenance/coverage data,
translation tooling, Python font tooling and documentation are private build
inputs. Do not broaden the public asset allowlist to include them.

## Search and discovery

Each locale has a separate generated 38-page local search index. Search queries
stay in the browser. Unicode normalization preserves Japanese and Korean, while
accent folding continues to support European languages. The ranking engine
rejects external, executable and malformed result URLs.

Each content page has one self-referencing canonical URL, `lang`, and reciprocal
`hreflang` links for all eight versions plus English `x-default`. Translated
JSON-LD uses corresponding local page URLs and `inLanguage`. The sitemap lists
304 actual content URLs. Preview pages and preview robots remain non-indexable.
This is a discoverable multilingual structure; it is not a promise of search or
AI-answer rankings.

## Review and release

Check the homepage globe beside Search and the fixed desktop/mobile headers;
opening, keyboard focus, Escape and outside dismissal; all eight labels in the
approved order; equivalent-page switching and section hashes; localized search;
contact and privacy controls; and long labels or diagram text at 320px, 390px,
768px, compact desktop and wide desktop. Check font loading, console errors,
asset URLs, every locale homepage and nested routes on the protected preview.
Publish only the reviewed commit with passing CI, then verify production routes,
headers, canonicals and visible interface behavior.
