# Vektorium public website

**[vektorium.io](https://vektorium.io/)** is the corporate website for Vektorium,
the company building **Cypher Sentinel**, a sovereign cybersecurity convergence
platform.

## Cypher Sentinel

**Keep your security stack. Add frontier defense.**

Cypher Sentinel brings together **160 surfaced capabilities across 90
customer-facing engines and 27 command families**. Integration bridges and APIs
connect existing security tools with the platform's native capabilities for
shared context and coordinated defense under customer-defined authority.

The website presents four connected themes:

- **Convergence:** security functions and connected tools operate with shared
  context and coordinated workflows.
- **Cryptographic architecture:** advanced cryptographic capabilities form part
  of the same security platform.
- **Sovereign control:** customers define deployment boundaries, connected
  systems and authorized actions.
- **AI operating model:** designed to coordinate capabilities, reduce manual SOC
  work and accelerate response within those boundaries.

This repository contains the public marketing website. The Cypher Sentinel
application, private development source and product validation records are
maintained separately.

## Main pages

| Page | Purpose |
| --- | --- |
| [Home](https://vektorium.io/) | Company vision and frontier security architecture |
| [Cypher Sentinel](https://vektorium.io/cypher-sentinel) | Platform breadth and operating model |
| [Architecture](https://vektorium.io/architecture) | Capability organization, shared context and customer-defined authority |
| [Integrations](https://vektorium.io/integrations) | How Cypher Sentinel works alongside an existing security stack |
| [Cybersecurity convergence](https://vektorium.io/cybersecurity-convergence-platform) | Shared context and integration with existing tools |
| [AI-powered SIEM](https://vektorium.io/ai-powered-siem-platform) | AI-assisted security operations |
| [Sovereign cybersecurity](https://vektorium.io/sovereign-cybersecurity-platform) | Customer control and deployment choices |
| [Government cybersecurity](https://vektorium.io/government-cybersecurity-platform) | Government and defence use cases |
| [Critical infrastructure](https://vektorium.io/critical-infrastructure-cybersecurity) | Infrastructure protection |
| [Post-quantum cybersecurity](https://vektorium.io/post-quantum-cybersecurity) | Cryptographic architecture |
| [Insights](https://vektorium.io/blog) | Technical perspectives and archived publications |
| [Contact](https://vektorium.io/contact) | Demo and commercial inquiries |

## Build and release

The website uses static HTML, CSS and JavaScript, with a dependency-free Node.js
24 build. Vercel deploys only the generated `dist` directory.

```sh
npm run check
npm run test:privacy
npm run test:integration
VERCEL_ENV=production npm run build
```

Other build environments produce non-indexable previews. See
[website operations](docs/website-operations.md) for the public-file manifest,
privacy controls, exact Content Security Policy, preview review and release
checks. Preserve the existing typography, cyan visual identity and desktop
mouse/light effects when updating content.

## Contact

- **Website:** [vektorium.io](https://vektorium.io/)
- **Email:** [massimo.prando@vektorium.io](mailto:massimo.prando@vektorium.io)
- **LinkedIn:** [Vektorium](https://www.linkedin.com/company/vektorium)
