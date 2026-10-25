# Self-hosted website fonts

Retrieved from official Google Fonts sources on 2026-10-25. No package was
installed, and the font binaries were not converted, edited or re-subsetted.
This document is repository maintenance material and is not copied to `dist`.
The complete OFL 1.1 text and both copyright notices are also bundled in the
public `assets/fonts.css` license-preserving comment, so the deployed font
distribution carries its license independently of this document.

## Original typography

All 25 ordinary pages in commit
`cef245c65469120dec8ce2c5d2198a6643fea7c8` requested this stylesheet, sometimes
twice in the same document:

https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap

The original `demo.html` and `generated.html` iframe wrappers requested no font
stylesheet. The original homepage includes CSS declarations for weight 200,
but its Google Fonts request never supplied that weight. The self-hosted
declarations retain Inter 300–700 and JetBrains Mono 400–500 instead of changing
that original matching behavior by exposing additional weights.

The official CSS response supplied the same variable Latin file for all five
requested Inter weights, and the same variable Latin file for both requested
JetBrains Mono weights. Two local `@font-face` declarations reuse those files.
The upstream `font-display: swap` behavior and Latin `unicode-range` are retained.

## Downloaded assets

| Local file | Source revision label | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `assets/fonts/inter-latin-v20.woff2` | Google Fonts Inter v20, normal, Latin | 48,432 | `c940764593d0fe5d596be327ca7558855e018039fb78509aa21921fd3644c3e4` |
| `assets/fonts/jetbrains-mono-latin-v24.woff2` | Google Fonts JetBrains Mono v24, normal, Latin | 31,340 | `2c32b9b3ee358c119e210f6f5195f9bd34894d78a785ff2e95d60e718e400af4` |

Combined font payload: **79,772 bytes**, before HTTP overhead. Files are served
from the site's own origin. There are no font CSS imports, preconnects or remote
font URLs in `assets/fonts.css`; licensing URLs occur only in comments.

Exact official binary URLs returned by the original CSS request:

- Inter: https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2
- JetBrains Mono: https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwgknk-4.woff2

The CSS was requested with a modern desktop browser user agent to obtain WOFF2.
These upstream version labels are URL revisions, not claims that the font's
internal product version is 20 or 24.

## License and authoritative references

Both fonts are distributed under **SIL Open Font License 1.1**. The upstream
license files carry these notices:

- Inter: `Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter)`
- JetBrains Mono: `Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)`

Sources verified for this change:

- Inter license: https://github.com/google/fonts/blob/main/ofl/inter/OFL.txt
- Inter license, raw: https://raw.githubusercontent.com/google/fonts/main/ofl/inter/OFL.txt
- JetBrains Mono license: https://github.com/google/fonts/blob/main/ofl/jetbrainsmono/OFL.txt
- JetBrains Mono license, raw: https://raw.githubusercontent.com/google/fonts/main/ofl/jetbrainsmono/OFL.txt
- Google Fonts CSS API and weight-range documentation: https://developers.google.com/fonts/docs/css2

Keep the full license comment in `assets/fonts.css` with any redistributed
copy of these fonts. If future tooling strips CSS comments, preserve the `/*!`
license block or distribute the complete upstream license notices separately
with the public font assets. Do not broaden the public output allowlist merely
to expose this maintenance document.

## Validation and maintenance

- `file` recognizes both assets as WOFF2/TrueType with the expected lengths.
- `fc-scan` opens both successfully, identifies the correct family names and
  variable font instances, and reports the printable ASCII range `20-7e`.
- SHA-256 hashes above pin the exact downloaded bytes for later verification.
- Only the official Latin subsets are included. Characters outside that subset
  continue to use the page's fallback font stack; add an appropriate official
  subset and its exact Unicode range when publishing new-language content.
- The existing build accepts `.woff2` and `.css`; the CSP remains `font-src 'self'`.
- Load `/assets/fonts.css` before per-page styles so the original family
  declarations continue to resolve without changing page typography rules.
- Verify actual mobile and desktop rendering, font requests and layout shift in
  the deployment preview. Source checks do not substitute for rendered QA.

To check the pinned assets locally without fetching anything:

```sh
sha256sum assets/fonts/inter-latin-v20.woff2 assets/fonts/jetbrains-mono-latin-v24.woff2
file assets/fonts/inter-latin-v20.woff2 assets/fonts/jetbrains-mono-latin-v24.woff2
```
