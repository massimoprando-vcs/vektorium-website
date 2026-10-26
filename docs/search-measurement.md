# Search and website interaction measurement

## Search visibility

Use the Google Search Console property for `https://vektorium.io/`. Compare
matching search types, country and device filters and clearly dated periods.
Keep brand queries separate from non-brand topics. Page-level average position
is an aggregate across queries; it is not the current rank of a target phrase.
A query absent from an export is not evidence of zero impressions or no rank.

The private search workbook records the selected target phrases, intended
landing pages, baseline and follow-up inputs. Search Console exports, private
performance data, customer inquiries and credentials do not belong in this
public repository or the website output.

For each review:

1. Verify indexing for newly published pages through URL Inspection. An accepted
   indexing request does not prove inclusion in the index.
2. Export Search Console queries and pages for the selected period and filters.
3. Compare exact-query and page measures separately. Normalize daily impressions
   if period lengths differ; do not sum page and query totals as if they were
   independent traffic.
4. Review country, device and Generative AI reporting separately. AI impressions
   may overlap the overall property measures.
5. Compare website intent events and actual inquiry outcomes separately. Record
   a qualified inquiry only after commercial review.

## Existing GA4 measurement

The privacy-controlled loader uses `G-KZL0QVQ6XC`. It keeps the existing
production-only, owner-selected default-on model and respects saved opt-outs,
GPC, DNT and blocked preference storage. No new analytics provider is added.

Custom events are delegated from link/button interactions:

| Event | Parameter | Values | Meaning |
| --- | --- | --- | --- |
| `demo_open` | `demo_variant` | `desktop`, `mobile` | A link to an approved demo destination was activated. |
| `contact_intent` | `contact_method` | `contact_page`, `email`, `copy_button` | A contact page/email link or the contact copy button was activated. |

The event payload contains only these fixed categories. It does not include
link text, destination query strings, email addresses, message text or
clipboard contents. Page and referrer metadata retain the loader's existing
query-stripping behavior. Tracking does not interrupt navigation or the copy
button's original behavior.

These events indicate intent. They do not establish that a demo loaded, an
email was sent, copying succeeded, an inquiry was received or a lead qualified.
Do not map them automatically to `generate_lead` or revenue.

After deployment, inspect `demo_open` and `contact_intent` in the existing GA4
Realtime/Events reports as eligible visitors interact. Standard report data can
lag collection; a local test of event queuing is not proof of server ingestion.
If parameter breakdowns are needed in standard reports, configure event-scoped
custom dimensions for `demo_variant` and `contact_method` in the GA4 property.
Leave recorded metrics unavailable until they are observed.

## Validation

`npm run test:privacy` checks permitted event categories, nested link clicks,
suppression for opt-outs and privacy signals, preview exclusion, revocation,
tag-load failure and ignoring unrelated/lookalike destinations. No test sends
analytics to Google. `npm run test:integration` verifies the deployed loader and
exact existing Content Security Policy.
