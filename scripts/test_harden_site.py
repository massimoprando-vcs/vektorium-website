"""In-memory tests for the static website transformer; no website writes."""

import json
import unittest

from harden_site import CSS_HEADER, find, parse, transform_page, walk


FIXTURE = '''<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><title>Safe &amp; useful | Vektorium</title>
<meta name="description" content="A sovereign platform discussion.">
<meta name="robots" content="index, follow"><meta name="robots" content="noindex, follow">
<meta name="author" content="Vektorium Inc."><meta name="author" content="Duplicate">
<meta name="keywords" content="old, seo">
<meta name="google-site-verification" content="real-code"><meta name="msvalidate.01" content="">
<link rel="canonical" href="https://old.invalid/">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" href="https://fonts.googleapis.com/css2?family=Inter" as="style" onload="this.rel='stylesheet'">
<noscript><link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet"></noscript>
<script src="https://www.googletagmanager.com/gtag/js?id=old"></script>
<script>window.legacy=true;</script>
<script type="application/ld+json">{"@type":"Offer","price":"0"}</script>
<style>.copy { color:red; } .photo { background:url('logo.webp'); }</style>
<style media="screen and (max-width: 900px)">.copy { color:blue; }</style>
</head><body>
<div class="cursor-dot" id="cursorDot"></div><div class="cursor-ring" id="cursorRing"></div>
<div class="canvas-wrapper"><canvas id="fluidCanvas"></canvas></div>
<nav class="site-nav"><a href="/">Desktop nav</a></nav>
<main class="page-content" id="old-main">
<h1>Safe &amp; useful</h1><p class="copy prior" style="color: green; margin-top: 2px" onclick="alert(1)">Visible &amp; preserved.</p>
<p style="color: green; margin-top: 2px">Same declaration.</p>
<span data-target="14200">0</span><span data-count="7">0</span><span data-count="8">Approved copy</span>
<img src="vektorium-logo.png" alt="Vektorium Logo">
<a target="_blank" href="https://example.com" rel="nofollow">Example</a>
<svg viewBox="0 0 16 16"><path d="M 0 0" /></svg>
</main>
<footer><div class="footer-col"><h3>Resources</h3><a href="/contact">Contact</a></div></footer>
<script>requestAnimationFrame(loop);</script>
</body></html>'''


def nodes(source, tag):
    return [node for node in walk(parse(source)) if node.tag == tag]


class HardenSiteTests(unittest.TestCase):
    def test_cleanup_and_visible_content_preserved(self):
        result = transform_page(FIXTURE, "example.html")
        document = parse(result.html)
        self.assertIn("Visible &amp; preserved.", result.html)
        self.assertIn("Desktop nav", result.html)
        self.assertIn('viewBox="0 0 16 16"', result.html)
        self.assertNotIn("window.legacy", result.html)
        self.assertNotIn("googletagmanager", result.html)
        self.assertNotIn("fonts.googleapis", result.html)
        self.assertNotIn("fonts.gstatic", result.html)
        self.assertNotIn("<style", result.html)
        self.assertNotIn("style=", result.html)
        self.assertNotIn("onclick", result.html)
        self.assertEqual(len(nodes(result.html, "canvas")), 1)
        self.assertIn('id="fluidCanvas" aria-hidden="true"', result.html)
        self.assertIn('class="canvas-wrapper" aria-hidden="true"', result.html)
        self.assertIn('class="cursor-dot" id="cursorDot" aria-hidden="true"', result.html)
        self.assertIn('class="cursor-ring" id="cursorRing" aria-hidden="true"', result.html)
        self.assertEqual(len(nodes(result.html, "noscript")), 0)
        main = find(document, lambda node: node.tag == "main")
        self.assertEqual(main.get("id"), "main-content")
        self.assertEqual(main.get("tabindex"), "-1")
        self.assertIn('id="old-main"', result.html)
        self.assertIn('data-target="14200">14,200', result.html)
        self.assertIn('data-count="7">7', result.html)
        self.assertIn('data-count="8">Approved copy', result.html)
        self.assertIn('rel="nofollow noopener"', result.html)
        logo = next(node for node in nodes(result.html, "img") if node.get("alt") == "Vektorium Logo")
        self.assertEqual((logo.get("src"), logo.get("width"), logo.get("height")),
                         ("/vektorium-logo.webp", "240", "240"))

    def test_css_order_and_class_order(self):
        result = transform_page(FIXTURE, "example.html")
        self.assertTrue(result.css.startswith(CSS_HEADER))
        self.assertLess(result.css.index("color:red"), result.css.index("color:blue"))
        self.assertLess(result.css.index("color:blue"), result.css.index("color: green"))
        self.assertEqual(result.css.count("color: green"), 1)
        self.assertIn("url('/logo.webp')", result.css)
        self.assertIn('@media screen and (max-width: 900px)', result.css)
        styled = next(node for node in nodes(result.html, "p") if "copy" in node.classes())
        self.assertEqual(styled.classes()[:2], ["copy", "prior"])
        self.assertTrue(styled.classes()[2].startswith("vx-style-"))
        stylesheets = [node.get("href") for node in nodes(result.html, "link") if node.get("rel") == "stylesheet"]
        self.assertEqual(stylesheets, ["/assets/fonts.css", "/assets/styles/example.css", "/assets/site.css", "/assets/desktop-effects.css"])

    def test_metadata_and_schema(self):
        result = transform_page(FIXTURE, "example.html", normalize_schema=True)
        metas = nodes(result.html, "meta")
        self.assertEqual([n.get("content") for n in metas if n.get("name") == "robots"], ["follow, noindex"])
        self.assertEqual([n.get("content") for n in metas if n.get("name") == "author"], ["Vektorium Inc."])
        self.assertEqual([n.get("content") for n in metas if n.get("name") == "google-site-verification"], ["real-code"])
        self.assertFalse(any(n.get("name") in {"keywords", "msvalidate.01"} for n in metas))
        scripts = nodes(result.html, "script")
        self.assertEqual(len(scripts), 3)
        ld = next(n for n in scripts if n.get("type") == "application/ld+json")
        graph = json.loads("".join(n.raw for n in ld.children))["@graph"]
        self.assertEqual([node["@type"] for node in graph], ["Organization", "WebSite", "WebPage", "BreadcrumbList"])
        self.assertEqual(graph[0]["@id"], "https://vektorium.io/#organization")
        self.assertNotIn("foundingDate", str(graph))
        self.assertNotIn("offers", str(graph))
        self.assertNotIn("SearchAction", str(graph))
        self.assertNotIn("FAQPage", str(graph))
        self.assertEqual(graph[2]["name"], "Safe & useful | Vektorium")
        self.assertEqual(graph[2]["url"], "https://vektorium.io/example")

    def test_navigation_and_footer(self):
        result = transform_page(FIXTURE, "contact.html")
        document = parse(result.html)
        nav = find(document, lambda n: n.tag == "nav" and n.get("aria-label") == "Mobile navigation")
        current = [n for n in walk(nav) if n.get("aria-current") == "page"]
        self.assertEqual([n.get("href") for n in current], ["/contact"])
        self.assertTrue(any(n.tag == "details" and "vx-mobile-menu" in n.classes() for n in walk(document)))
        self.assertTrue(any(n.tag == "a" and "vx-skip-link" in n.classes() and n.get("href") == "#main-content" for n in walk(document)))
        self.assertEqual(result.html.count('href="/security"'), 2)

    def test_exact_idempotence(self):
        first = transform_page(FIXTURE, "example.html")
        second = transform_page(first.html, "example.html", first.css)
        self.assertEqual(first.html, second.html)
        self.assertEqual(first.css, second.css)
        self.assertFalse(second.report["changed_html"])
        self.assertFalse(second.report["changed_css"])

    def test_default_preserves_existing_json_ld_verbatim(self):
        raw_json = '''\n  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "Cypher Sentinel",
    "softwareVersion": "2.5",
    "featureList": ["72 security engines", "14,200 tests"],
    "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
    "description": "Preserve exact punctuation, strings & values: 100%."
  }\n'''
        original_script = '<script type="application/ld+json">{"@type":"Offer","price":"0"}</script>'
        source = FIXTURE.replace(original_script, '<script type="application/ld+json">' + raw_json + '</script>')
        result = transform_page(source, "cypher-sentinel.html")
        ld = [node for node in nodes(result.html, "script") if node.get("type") == "application/ld+json"]
        self.assertEqual(len(ld), 1)
        retained = "".join(node.raw for node in ld[0].children)
        self.assertEqual(retained, raw_json)
        self.assertEqual(json.loads(retained), json.loads(raw_json))
        self.assertEqual(result.report["schema_mode"], "preserved")
        self.assertEqual(result.report["structured_data_preserved"], 1)
        self.assertNotIn('id="vx-structured-data"', result.html)
        second = transform_page(result.html, "cypher-sentinel.html", result.css)
        self.assertEqual(result.html, second.html)
        self.assertEqual(result.css, second.css)

    def test_normalization_is_explicit_and_idempotent(self):
        first = transform_page(FIXTURE, "cypher-sentinel.html", normalize_schema=True)
        second = transform_page(first.html, "cypher-sentinel.html", first.css, normalize_schema=True)
        self.assertEqual(first.html, second.html)
        self.assertEqual(first.css, second.css)
        self.assertEqual(first.report["schema_mode"], "normalized")
        self.assertEqual(first.report["structured_data_preserved"], 0)
        self.assertIn('id="vx-structured-data"', first.html)
        self.assertNotIn('"price"', first.html)

    def test_no_schema_is_synthesized_by_default(self):
        source = '<!DOCTYPE html><html lang="en"><head><title>Security</title></head><body><main id="main-content"><h1>Security</h1></main></body></html>'
        result = transform_page(source, "security.html")
        self.assertEqual(len(nodes(result.html, "script")), 1)
        self.assertEqual(nodes(result.html, "script")[0].get("src"), "/assets/site.js")
        self.assertNotIn("application/ld+json", result.html)

    def test_no_style_legal_page_and_product_only_schema(self):
        source = '<!DOCTYPE html><html lang="en"><head><title>Policy</title></head><body><div class="content-wrapper"><h1>Policy</h1></div></body></html>'
        first = transform_page(source, "terms.html")
        second = transform_page(first.html, "terms.html", first.css)
        self.assertEqual(first.html, second.html)
        self.assertEqual(first.css, second.css)
        self.assertEqual(len(nodes(first.html, "main")), 1)
        self.assertNotIn("SoftwareApplication", first.html)
        product = transform_page(source, "cypher-sentinel.html", normalize_schema=True)
        self.assertIn("SoftwareApplication", product.html)
        self.assertNotIn('"price"', product.html)
        home = transform_page(source, "index.html", normalize_schema=True)
        self.assertNotIn("BreadcrumbList", home.html)
        self.assertIn('href="https://vektorium.io/"', home.html)

    def test_exclusions_and_missing_generated_styles_fail_safe(self):
        with self.assertRaises(ValueError):
            transform_page(FIXTURE, "demo.html")
        with self.assertRaises(ValueError):
            transform_page(FIXTURE, "generated.html")
        first = transform_page(FIXTURE, "example.html")
        with self.assertRaises(ValueError):
            transform_page(first.html, "example.html")

    def test_contact_social_image(self):
        source = FIXTURE.replace('<meta charset="UTF-8">', '<meta charset="UTF-8"><meta property="og:image" content="https://vektorium.io/og-image.webp"><meta name="twitter:image" content="https://vektorium.io/og-image.webp">')
        result = transform_page(source, "contact.html")
        self.assertNotIn("/og-image.webp", result.html)

    def test_desktop_hooks_and_approved_assets_are_idempotent(self):
        source = FIXTURE.replace('</head>', '<link rel="stylesheet" href="/assets/capability-visuals.css"></head>')
        first = transform_page(source, "index.html")
        second = transform_page(first.html, "index.html", first.css)
        self.assertEqual(first.html, second.html)
        scripts = [node.get("src") for node in nodes(first.html, "script") if node.get("src")]
        self.assertEqual(scripts, ["/assets/site.js", "/assets/desktop-effects.js"])
        stylesheets = [node.get("href") for node in nodes(first.html, "link") if node.get("rel") == "stylesheet"]
        self.assertEqual(stylesheets, ["/assets/fonts.css", "/assets/styles/index.css", "/assets/capability-visuals.css", "/assets/site.css", "/assets/desktop-effects.css"])
        self.assertTrue(all(node.has("defer") for node in nodes(first.html, "script") if node.get("src")))
        self.assertTrue(first.report["desktop_effects"])
        self.assertEqual(first.report["canvases_removed"], 0)
        self.assertEqual(first.report["cursor_nodes_removed"], 0)

    def test_svg_tag_case_and_unchanged_markup_are_preserved(self):
        svg = '''<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="paint" gradientUnits="userSpaceOnUse"><stop stop-color="#00d4ff"/><stop offset="1" stop-color="#00ffcc" /></linearGradient><radialGradient id="aura"><stop stop-opacity=".13"/></radialGradient></defs><path d="M1 1H10" stroke="url(#paint)"/></svg>'''
        source = FIXTURE.replace('<svg viewBox="0 0 16 16"><path d="M 0 0" /></svg>', svg)
        first = transform_page(source, "index.html")
        self.assertIn(svg, first.html)
        self.assertNotIn("lineargradient", first.html)
        self.assertNotIn("radialgradient", first.html)
        second = transform_page(first.html, "index.html", first.css)
        self.assertEqual(first.html, second.html)

    def test_html_attribute_escaping_is_canonical_but_svg_is_preserved(self):
        source = FIXTURE.replace('<meta charset="UTF-8">', '<meta charset="UTF-8"><meta property="og:image:alt" content="Vektorium&#39;s image">')
        svg = '<svg viewBox="0 0 16 16" aria-label="Vektorium&#39;s illustration"><path d="M 0 0"/></svg>'
        source = source.replace('<svg viewBox="0 0 16 16"><path d="M 0 0" /></svg>', svg)
        first = transform_page(source, "index.html")
        self.assertIn('<meta property="og:image:alt" content="Vektorium&#x27;s image">', first.html)
        self.assertIn(svg, first.html)
        second = transform_page(first.html, "index.html", first.css)
        self.assertEqual(first.html, second.html)


if __name__ == "__main__":
    unittest.main()
