# Vektorium public website

This repository contains the static corporate website for [Vektorium](https://vektorium.io), the company behind **Cypher Sentinel**. It is not the Cypher Sentinel application repository, deployment package or an assessment of the platform's current implementation.

## Purpose and content boundary

The website is a commercial and informational entry point: visitors can learn about Vektorium and Cypher Sentinel, explore relevant topics and demonstrations, and contact the company. Vektorium is the company; Cypher Sentinel is the platform. Navigation and technical improvements should support that role.

**This preview preserves original visible product claims and existing JSON-LD pending joint review with the owner.** Current platform code and release evidence have not been reviewed as part of this website work. Do not infer readiness, missing capabilities, service availability or certification status from this repository, and do not change those claims without discussion and evidence. Any editorial proposal is separate from the authorized technical changes.

The source transformer preserves existing structured data by default. Its optional `--normalize-schema` mode changes content and must not be used for this technical-only preview without explicit content-review approval. Do not copy confidential platform code or operational data into this public website repository.

## Website structure

- Static HTML, CSS and JavaScript, hosted on Vercel.
- [Home](https://vektorium.io/) and [Cypher Sentinel](https://vektorium.io/cypher-sentinel) are the principal entry points.
- Topic routes retain existing URLs so bookmarks and inbound links continue to work.
- [Contact](https://vektorium.io/contact) uses direct email and LinkedIn; no website upload or inquiry form is required.
- Demonstrations are separate applications. The website controls only their parent-page embedding and permission boundaries, not their internals.
- The security page and reporting file concern this public website; verify reporting-mailbox monitoring before publication.

## Review and release discipline

This technical upgrade is prepared on a preview branch. Do not promote it to production without explicit owner approval. Review the rendered pages, navigation, metadata, keyboard/mobile accessibility, analytics consent, actual response headers and demonstration isolation.

Discuss product claims and any proposed semantic changes jointly using current platform evidence. Privacy, terms and security-reporting wording must be checked against actual deployed behavior and business practices before publication. No legal-compliance or product-security certification is established by these technical changes.

The technical implementation keeps optional analytics disabled unless the visitor explicitly opts in, subject to browser privacy signals and the production-host restriction. Verify this in a real browser; a simulated test is not a deployed-network observation.

## Build and publication controls

The dependency-free builder publishes only allowlisted output in `dist`, not repository files. Only the exact value `VERCEL_ENV=production` preserves production indexing directives. Default, unknown, development and preview environments all create non-indexable preview output. Robots directives and noindex are not access control and must not be relied on to protect confidential content.

`scripts/build.mjs` maintains an explicit public-page manifest (39 pages, including `security.html` and 11 republished LinkedIn articles). The build rejects an unexpected root HTML page or a missing expected page before touching existing generated output. Adding a public page requires a reviewed manifest update and corresponding sitemap changes; root-level files are not published automatically. Source material under `content/` is not public output. Allowlisting is not content approval.

```sh
python3 -B -m unittest discover -s scripts -p 'test_harden_site.py' -v
node scripts/render_linkedin_posts.mjs --test
node scripts/render_linkedin_posts.mjs --check
python3 -B scripts/validate_site.py --self-test
npm run check:js
node scripts/test_site.mjs
node scripts/test_build.mjs
npm run build
```

The last command creates a local noindex preview unless the environment is explicitly production. There are no application package dependencies to install. Build-fixture tests write only to their own guarded temporary directory.

Technical checks cover links/assets/fragments, document landmarks, navigation, externalized scripts/styles, consent safeguards, image dimensions, JSON-LD syntax, sitemap coverage, headers and output isolation. Malformed JSON/schema types remain failures. Repeated organizations, zero-price offers, SearchAction and unmatched FAQ text are separate review warnings. **A technical pass is not content approval.**

See [the website security review and release gate](docs/SECURITY_REVIEW.md) for scope, limitations, browser checks, account-level exclusions and rollback requirements. Search Console lacks sufficient field data for a Core Web Vitals conclusion; no performance pass or guaranteed search/AI ranking is claimed.

No production promotion, DNS/domain transfer, account-permission change or branch-protection change is part of these checks. GitHub CI is read-only and has no deployment step.

## Contact

- Website: [vektorium.io](https://vektorium.io)
- Business inquiries: massimo.prando@vektorium.io

Vektorium Inc. — Cypher Sentinel is the platform; Vektorium is the company.
