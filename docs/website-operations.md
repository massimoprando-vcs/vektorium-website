# Public website operations

This repository contains the public Vektorium marketing website. It is separate
from the Cypher Sentinel application and its security assessment.

## Build and review

Use Node.js 24. The build and checks have no package dependencies or install step.

```sh
npm run check
npm run test:privacy
npm run test:integration
npm run build
```

Only `dist` is deployed. The builder uses an explicit page/file manifest and a
restricted public asset directory. Repository files, documentation, source
tooling and review artifacts are not part of the deployed output. Treat every
file under `assets` as public. Do not put secrets, source maps, exports or private
documents there.

A production build requires `VERCEL_ENV=production`. All other values produce
non-indexable review pages and a disallow-all robots file. The analytics loader
also checks the exact public hostname; review deployments do not load it.

## Preserve the desktop design

Original inline effects, CSS and product copy remain in the HTML source. The
build substitutes the old analytics loader and remote font links in output,
adds the scoped privacy control and versions local stylesheet/script URLs. It
does not reserialize or rewrite the original animation code.

The six homepage schematics and LinkedIn archive use small, separate stylesheets.
Do not reintroduce the parked global stylesheet or replacement desktop-effects
implementation when making subsequent changes.

The shared mobile header is inserted only into the 37 marketing/content pages.
Its layout and reading refinements live in `assets/mobile.css` and apply only
at 768px or narrower. The original desktop header, cursor, WebGL effects and
inline style/script bodies stay intact. The native menu remains usable without
JavaScript; `assets/mobile.js` adds dismissal and focus handling. Keep desktop
selectors out of that stylesheet's ungated rules and check both sides of the
768px breakpoint whenever changing it.

The enforced Content Security Policy permits the reviewed inline scripts,
style blocks and static style attributes by their exact SHA-256 hashes. If one
changes, the build fails until the configuration change is reviewed. Inspect
the proposed configuration with:

```sh
node scripts/build.mjs --print-config
```

Do not add `unsafe-inline`, `unsafe-eval`, broad wildcard origins or automatic
policy regeneration to work around a failing check. Runtime effect code uses
direct CSS property assignments; changing it to `cssText` or inline event
handlers can break the policy.

## Analytics and privacy settings

The owner selected an opt-out model: existing Google Analytics is enabled by
default on the two public hostnames, subject to a saved opt-out and supported
browser privacy signals. The footer control lets visitors change the setting.
The interface describes on/off state; the default is not recorded as an
affirmative consent action.

This implementation does not establish that default-on GA qualifies for any
particular jurisdiction's consent exemption. Regional legal requirements,
Google account settings, linked products, retention and data-sharing settings
require a separate assessment. Do not describe this website release as a
compliance certification or as validating Cypher Sentinel's security claims.

The privacy notice must remain consistent with the loader. Never add tracking
tags to individual pages or bypass a saved privacy preference. The original
GA snippets remain in source solely to keep the baseline readable; production
and preview output remove them before adding the controlled loader. Serve built
output for testing rather than opening source HTML as a substitute.

## External demonstrations

The demonstration wrappers load the existing external applications only after a
visitor chooses to load or open them. The frames use two explicitly allowed
origins, limited sandbox permissions and no referrer. A frame load event proves
only that the frame loaded, not that the external application is healthy or
secure. Recheck the embedded applications separately when they change.

### Branded demo hosts — release prerequisite

Keep the branded-host change in a draft pull request until **both custom hosts
resolve publicly and serve valid TLS certificates for their exact hostnames**.
The Vercel domain assignments alone do not complete this change. Verify the
desktop and mobile applications through the branded hosts before merging; retain
the working Vercel-hosted links in production while DNS or TLS is pending.

| Public host | Existing Vercel application | Application path |
| --- | --- | --- |
| `demo.vektorium.io` | `cypher-sentinel-demo.vercel.app` | `/` |
| `mobile-demo.vektorium.io` | `mobile-gold-five.vercel.app` | `/demo` |

The standby view keeps `/demo?mode=standby&autostart=true&fullscreen=true` on
`demo.vektorium.io`. The same two exact branded origins are allowed by CSP
`frame-src` and the fullscreen Permissions-Policy; do not add wildcard hosts.

The registrar is Squarespace Domains LLC, confirmed through its public RDAP
record. Start at `https://account.squarespace.com/domains` and select
`vektorium.io` → DNS. Vercel labels the underlying nameserver infrastructure as
Google Cloud DNS; this is not the account dashboard name. Required CNAMEs:

| Name in the `vektorium.io` zone | Type | Target |
| --- | --- | --- |
| `demo` | CNAME | `769f0889689c9db7.vercel-dns-017.com.` |
| `mobile-demo` | CNAME | `2e2280978d921a9d.vercel-dns-017.com.` |

This host mapping does not change analytics host checks, cookie scope, demo
sandbox permissions or the external applications themselves. Recheck any
application origin restrictions and load/open/stop/fullscreen behavior through
the protected website preview after DNS and TLS are ready.

## Release checks

Review changes through the GitHub pull request and its protected Vercel preview.
Check the live desktop cursor and mouse-following light, homepage graphics,
article pages, contact copy control, privacy controls, and demo load/stop on
desktop and mobile. Inspect console errors for CSP failures. Merge only the
reviewed commit after automated checks pass, then verify the production domain
and actual response headers.

For mobile changes, check 320px, 390px and 768px layouts, menu navigation and
dismissal, readable homepage diagrams, article links, footer and privacy controls.
Recheck desktop identity above the mobile breakpoint. The demo wrapper has its
own layout: keep the self-hosted Inter/JetBrains Mono fonts, a generous frame,
the direct standalone destination and Stop/unload available in full screen.

Vercel deployment history and Git history retain prior releases for recovery.
Domain, DNS, billing, account security and access settings are separate from
source-code releases.
