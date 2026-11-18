# Outage ownership publication plan

> For agentic workers: execute the existing content-publication workflow and use a final independent review.

**Goal:** Publish Vektorium's 18 November 2026 LinkedIn post under Blog in all eight existing languages.

**Architecture:** Reuse the current native insight template and static localization pipeline. Keep the original publication text, date, two accompanying images, and LinkedIn source; include the nine links from the author's source comment in a separate references section.

**Tech stack:** Existing static HTML/CSS and dependency-free Node build; existing JSON translation catalogues and pinned Noto font subsets.

**Spec:** The owner's request in this session: read the newest LinkedIn post, assess it candidly, and add it to the website Blog in all eight languages. The existing Blog design supplies the presentation.

## Constraints and decisions

- Use the published sentence “Not every outage has an attacker. Every outage has an owner.” as the article heading.
- Preserve the English body as published apart from insignificant trailing whitespace and social-link presentation; translations retain its meaning and paragraph structure.
- Keep editorial feedback separate from the archived publication.
- Feature the article first in Blog; retain all earlier articles.
- Preserve language order: en, fr, it, de, es, pt, ja, ko.
- Reuse executable scripts and inline styles exactly; do not change CSP, privacy, analytics, demo routing, or registered-office details.
- Use original image bytes. No new third-party embeds or runtime dependencies.
- Use the existing release tests and targeted output/browser checks; no new behavior or permanent content-specific tests are needed.

## Tasks

- [x] Create the English insight, Blog card, source links, local images and explicit page-manifest entry.
- [x] Extract the actual new translation units, translate all seven catalogues, preserve existing translations, and refresh CJK subsets from pinned upstream sources if needed.
- [x] Update inventory assertions and maintenance counts for 39 content pages, 312 canonical URLs and 314 HTML files.
- [x] Run existing privacy, search, localization and build/integration gates; independently review source, all eight outputs, references and original-text fidelity.
- [ ] Publish the reviewed branch through the established GitHub/Vercel workflow when authenticated publishing access is available; verify the deployed article, Blog, search, sitemap, metadata and assets.

## Review focus

- Accurate publication provenance and separation of author sources from the original post body.
- Paragraph breaks, named entities, quantities and claim strength preserved in translation.
- Exact CSP/configuration unchanged; local assets and glyph coverage valid.
- All eight canonical routes, corresponding Blog entries, search results and reciprocal language links.
- Long headings, source links and both images remain readable at narrow widths.

## Verification status

- 97 existing tests passed: 44 privacy, 8 search, 9 localization and 36 build/integration.
- Production output: 314 HTML files, 89 public assets, 312 canonical sitemap URLs.
- Independent read-only review found no blocking or minor defects; all eight article/Blog outputs, original text, references, translations and pinned font subsets were checked.
- Authenticated publication, protected-preview rendering and live production verification remain pending.
