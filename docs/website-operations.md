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

## Release checks

Review changes through the GitHub pull request and its protected Vercel preview.
Check the live desktop cursor and mouse-following light, homepage graphics,
article pages, contact copy control, privacy controls, and demo load/stop on
desktop and mobile. Inspect console errors for CSP failures. Merge only the
reviewed commit after automated checks pass, then verify the production domain
and actual response headers.

Vercel deployment history and Git history retain prior releases for recovery.
Domain, DNS, billing, account security and access settings are separate from
source-code releases.
