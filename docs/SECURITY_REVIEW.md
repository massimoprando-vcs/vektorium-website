# Website hardening review and release gate

Review date: 25 October 2026. Scope: Vektorium's public static website,
repository source and parent pages that embed external demonstrations.
This is a preview-branch improvement, not a production security certification
or an assessment of Cypher Sentinel's application internals.

## Content boundary: preserve first, review together

This is a technical-only preview. Original visible product claims and existing
JSON-LD are preserved pending joint review with the owner. Current platform
code, release evidence and operational capabilities have not been examined
in this website review. No conclusion about product readiness, feature
availability or the accuracy of a particular capability claim is established
by the website implementation alone. Proposed editorial changes are not
approved changes to public positioning.

The default source transformation preserves existing JSON-LD rather than
rewriting its claims. Optional schema normalization requires a separate,
explicit decision after the relevant content and evidence have been reviewed.

## Observed live baseline

The read-only HTTP review covered the 27 existing HTML routes: the 25 sitemap
entries plus `/cybersecurity-convergence-platform` and `/generated`. All 27
returned HTTP 200 during the review. Normal HTTP-to-HTTPS, www-to-apex and
`.html`-to-clean-URL redirects were observed. This is a point-in-time check,
not an uptime history or a Core Web Vitals result.

Search Console's Core Web Vitals report was also inspected: both mobile and
desktop showed insufficient usage data for the reported 90-day period, with
the report last updated 21 October 2026. No field-performance pass can be
inferred from missing data.

The checked responses included HSTS, `nosniff`, same-origin framing and a
referrer policy, but no Content Security Policy. Source used inline scripts,
inline styles and event handlers. External fonts and unconditional analytics
created third-party requests. Demo wrappers lacked a restrictive sandbox and
granted unnecessary feature permissions. Repeated logos lacked explicit
dimensions. These are implementation gaps, not proof of exploitation or
measured layout instability.

Structured data included repeated organization definitions, zero-price Offer
entries, a SearchAction and FAQ text that the offline parser did not always
match to visible content. These are review questions, not findings that the
product claims are false. The intended commercial meaning and the relationship
between visible text, schema and current platform evidence must be discussed
with the owner before changing them.

## Controls implemented in this branch, not yet verified live

- Publish allowlisted public output from `dist`, not the repository root.
  Build scripts, audit notes, package metadata, Git metadata and CI settings
  are not public output. The static build has no application dependencies.
  The explicit manifest contains 28 allowlisted public HTML pages, including the
  new security page. Allowlisting is not content approval. An unexpected root
  HTML file or a missing allowlisted page
  stops the build before any existing generated output is touched. Adding a
  page requires deliberate manifest and sitemap review; it is not discovered
  and published automatically.
- Preserve clean URLs, HSTS, `nosniff`, same-origin framing and referrer policy.
  Disable the obsolete `X-XSS-Protection` filter.
- Enforce first-party scripts/styles/fonts; prohibit inline executable code,
  inline styles/handlers, eval, objects and base-URL overrides. The only
  external script allowance is Google's analytics host; external connections
  are limited to its selected collection origins. Allowlisting alone does
  not initiate a request.
- Create analytics only after affirmative consent on the production hostname;
  honor browser privacy signals. Remove unconditional analytics and external
  font markup. Runtime consent still needs browser verification.
- Allow frames only from the two existing demo origins. Load a frame only
  after an explicit visitor action, limiting it to scripts, its own origin
  and fullscreen. No camera, microphone, location, sensor, clipboard, popup,
  autoplay or top-navigation grants. The same-origin sandbox token concerns
  each cross-origin demo's own origin; it does not grant access to this site.
  These controls are not a security certification of either external app.
- Deny unnecessary browser features in response headers. First-party
  clipboard writing remains allowed for the contact-page copy button;
  cross-origin frames receive no clipboard permission. Fullscreen is limited
  to this site and the two demo origins.
- Cache shared, unfingerprinted assets for one hour with revalidation, not
  `immutable`, because their filenames can remain unchanged across updates.
- Keep `/generated` non-indexable and out of the sitemap. Mark all preview
  HTML `noindex`; preview robots disallows crawling. **Neither robots nor
  noindex is access control.** Confidential previews need deployment protection.
  Only the exact environment value `VERCEL_ENV=production` preserves production
  indexing directives; absent, unknown, development and preview values all
  fail closed to the non-indexable preview output. The sitemap contains 27
  intended indexable pages.
- Add a read-only, dependency-free regression CI job with verified commit-pinned
  actions. It has no deployment credentials or production-promotion step.

The CSP in `vercel.json` is intentionally enforcing, not report-only. Evaluate
it with this branch's fully externalized HTML/assets. Do not copy the header
alone onto the old production pages: it would block their inline behavior.
The build and validator reject those old patterns.

## Automated checks

```sh
python3 -B -m unittest discover -s scripts -p 'test_harden_site.py' -v
python3 -B scripts/validate_site.py --self-test
npm run check:js
node scripts/test_site.mjs
node scripts/test_build.mjs
npm run build
```

`npm run build` without an explicit production environment creates a
non-indexable local preview. This is intentional, not a build failure.

The validator discovers page counts dynamically and reports passed/failed
checks. It covers landmarks, unique titles/H1s, canonicals, local routes,
assets and fragments, JSON-LD validity,
image dimensions, new-tab links, mobile navigation, iframe restrictions,
externalization, consent safeguard markers, sitemap and header invariants.
`--json` prints machine-readable output without writing a file. Its self-tests
use in-memory fixtures. It is not a complete HTML conformance checker,
accessibility certification, browser test or penetration test.

Malformed JSON and malformed schema type values are technical failures.
Repeated Organization definitions, zero-price offers, SearchAction declarations
and unmatched/hidden FAQ text are emitted separately as content-review warnings.
They do not fail the technical gate or authorize automatic removal. Console
and JSON reports explicitly state that original product claims remain pending
joint review; even zero technical failures is not an all-content-approved result.

CI also tests the transformer, checks JavaScript syntax and frontend consent
logic, exercises build boundaries in isolated temporary fixtures, builds production
output, checks that development files are excluded, then builds and verifies
the non-indexable preview. CI deploys neither output. Passing CI does not mean
branch protections require it: no account or repository protection settings
were changed. A workflow run on GitHub must still be observed after pushing
the authorized branch; local success is not proof that hosted CI has run.

The build tests do not modify or build the checkout. They create synthetic
fixtures beneath one process-owned temporary directory and verify explicit
production, preview, absent/unknown environments, accidental HTML publication,
missing pages, symlink rejection, output-directory preservation and disallowed
asset types. Cleanup validates the exact temporary root and ownership marker
before removing only those synthetic fixtures. Frontend simulation tests are
not a substitute for real-browser network, CSP and accessibility testing.

## Mandatory preview review before production

The owner must review the real preview and explicitly approve production
promotion. Preserve the current production deployment for rollback. Do not
move domains/projects, change DNS, account access or deployment protection
as part of this code review.

1. **Routes:** Open every sitemap page plus `/generated` in the preview.
   Check local navigation, fragments, email/download links, real 404s and
   redirects from legacy `.html` URLs.
2. **Rendering/accessibility:** Test desktop, tablet, narrow mobile, keyboard
   navigation, visible focus, skip links, expanded native menus, zoom and
   reduced motion. Check contrast and horizontal overflow. Navigation and
   core text must remain usable without JavaScript.
3. **Headers/network:** Inspect actual responses and browser console. Confirm
   no first-party script/style/asset is blocked. Confirm only intended
   external requests occur. The optional Vercel toolbar is not allowlisted;
   do not weaken CSP to enable it. No CSP reporting service is installed.
4. **Consent:** In a fresh context, verify no analytics script, collection
   request or cookie before consent or after denial. Test persistence,
   revocation, GPC/DNT and storage failure. Preview hosts intentionally do not
   run analytics: test the production-only branch in a controlled staging
   harness, then perform a short production smoke test after promotion is
   approved. Do not use real customer, credential or operational data.
5. **Demo isolation:** Verify neither external demo loads before the load
   button. Test desktop/mobile destinations, loading/failure states,
   stop/unload and optional fullscreen. Do not expand permissions to dismiss
   unexpected prompts. The explicit external link leaves the frame sandbox.
6. **Search/content:** Check deployed canonicals, OG tags, sitemap, preview
   noindex and structured-data syntax. Preserve the original product claims
   while technical work is reviewed. Discuss semantic warnings and any proposed
   product, services or schema changes jointly with the owner using current
   platform evidence before applying them. The owner must review privacy,
   terms and security-reporting wording against the actual technical changes
   before publication.
   Verify the published reporting mailbox is actually monitored: mailbox
   delivery and monitoring were not established by this review. Do not claim
   certification, compliance or customer evidence without verification.
7. **Performance:** Measure representative templates on mobile and desktop;
   record conditions and distinguish lab from real-user data. Track LCP,
   INP and CLS. HTTP fetch time is not page-load speed; no Lighthouse score
   or Core Web Vitals pass is claimed without completed measurements.
   Consent-enabled and demo-loaded sessions need separate attention.
8. **Promotion/rollback:** Confirm change review, preview results and content
   approval, then promote only with explicit owner approval. Recheck TLS,
   apex/www routing, navigation, contact links, headers and representative
   pages. Roll back deployment if critical behavior fails; investigate in a
   new preview instead of making ad-hoc DNS changes.

## Outside the scope of this review

No exploitation, fuzzing, load testing, credential extraction or form
submission was performed. No independent audit covered the demo apps,
product backend, databases, API authorization, logs, restore procedures,
incident response, account recovery, cloud IAM, branch protections, secret
scanning or Vercel account permissions. Registrar security, MFA/recovery keys
and billing ownership remain owner-level checks. Privacy/legal wording needs
owner review against actual practices and applicable requirements.

Absolute security, perfect performance and guaranteed search/AI rankings
would be misleading. Crawler access, readable HTML and accurate structured
data improve technical eligibility, but do not guarantee indexing, rich
results, citations or voice-assistant selection. Do not add invented ratings,
review counts or unsupported metadata to seek those outcomes. Existing price,
FAQ and other semantic claims are preserved for joint review, not silently
reinterpreted or removed by this technical pass.

## Primary references and action provenance

- Vercel configuration: <https://vercel.com/docs/project-configuration/vercel-json>
  (`framework: null`, empty install command, output/build settings, headers,
  clean URLs).
- Google tag CSP guidance:
  <https://developers.google.com/tag-platform/security/guides/csp>.
  This branch deliberately uses exact hosts, not the guide's broad wildcard
  allowances, and excludes Ads/DoubleClick features. Consent-enabled behavior
  requires the browser test above; a new endpoint is a review decision, not
  an automatic reason to broaden the policy.
- Checkout v7.0.1 verified tag:
  <https://api.github.com/repos/actions/checkout/git/ref/tags/v7.0.1>
  — `3d3c42e5aac5ba805825da76410c181273ba90b1`.
- Setup Node v7.1.0 verified tag:
  <https://api.github.com/repos/actions/setup-node/git/ref/tags/v7.1.0>
  — `949feb2413d6458794dcd2491c4babbbce0c15c1`.
- Setup inputs and Node 24 action runtime:
  <https://github.com/actions/setup-node/blob/v7.1.0/action.yml>.

Review action updates deliberately. Commit pinning stops a tag moving
silently; it does not eliminate the need to track security fixes.
