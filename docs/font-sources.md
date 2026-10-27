# Self-hosted website fonts

All website font requests are same-origin. Keep license notices when distributing
or minifying the stylesheets. Font source downloads and preparation dependencies
are development inputs and must not be included in `dist`.

## Existing Latin faces

The original Google Fonts Latin WOFF2 assets remain unchanged. The OFL 1.1 license
and copyright notices are included in `assets/fonts.css`.

| Asset | SHA-256 |
| --- | --- |
| `assets/fonts/inter-latin-v20.woff2` | `c940764593d0fe5d596be327ca7558855e018039fb78509aa21921fd3644c3e4` |
| `assets/fonts/jetbrains-mono-latin-v24.woff2` | `2c32b9b3ee358c119e210f6f5195f9bd34894d78a785ff2e95d60e718e400af4` |

Inter uses the original 300–700 range, JetBrains Mono 400–500. Their Latin glyphs
cover the requested European-language text and keep the existing visual identity.

## Japanese and Korean

The CJK assets are site-specific variable-weight WOFF2 subsets of Noto Sans JP and
Noto Sans KR from the official Google Fonts repository. Both upstream files carry
the 2014–2021 Adobe copyright notice, the reserved font name “Source”, and OFL 1.1.
The complete notice is distributed in `assets/language-fonts.css`. The Noto family
names are retained; no new font family uses the reserved name.

| Locale | Pinned Google Fonts commit | Source TTF SHA-256 |
| --- | --- | --- |
| Japanese | `295d98a7a0c17c68f1341eaeea354e7960ea70d3` | `c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f` |
| Korean | `4efc2774c63917927efe769ca845def6bd6debae` | `194018e6b2b293a7964f037b25c0249ce1418bc9ab3c971060a03aa57861e252` |

Exact upstream files:

- [Noto Sans JP variable TTF](https://raw.githubusercontent.com/google/fonts/295d98a7a0c17c68f1341eaeea354e7960ea70d3/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf)
- [Noto Sans KR variable TTF](https://raw.githubusercontent.com/google/fonts/4efc2774c63917927efe769ca845def6bd6debae/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf)

Full translated-page subsets load only on their respective language pages through
`assets/cjk-ja.css` or `assets/cjk-ko.css`. Their CJK Unicode ranges complement
Inter and JetBrains Mono, preserving the existing Latin glyphs. Separate small
subsets provide only the 日本語 and 한국어 menu labels on other language pages.
Unseen characters entered into Search can use the visitor's system font fallback.

## Regeneration

Use Python with FontTools and Brotli installed in a development environment. Save
the pinned upstream files as `notosansjp.ttf` and `notosanskr.ttf` in a temporary
source directory, then run:

```sh
python scripts/prepare-localized-fonts.py --source-directory /path/to/pinned-fonts
```

The helper verifies upstream checksums, requires complete current Japanese and
Korean catalogues, subsets all needed CJK codepoints, retains variable weights and
license metadata, and verifies the resulting WOFF2 glyph coverage. It writes four
public font assets and the private `locales/font-coverage.json` manifest. A normal
Node build requires no Python or font-processing packages; it checks the bundled
font hashes and fails if a translated character is absent from recorded coverage.

Commit the WOFF2 files, coverage manifest and catalogue changes together. Do not
commit the original TTFs, downloaded metadata or preparation dependencies.
