#!/usr/bin/env python3
"""Offline, dependency-free checks for Vektorium's static website.

This is a regression gate, not a security certification, a full HTML conformance
checker, a browser accessibility audit, or a Core Web Vitals measurement.
It reads source files only and never requests URLs or modifies files.
Semantic schema concerns are review warnings, not approval or rejection of
product claims; original claims remain pending joint review against evidence.
"""

from __future__ import annotations

import argparse
import ast
from collections import Counter
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from html import unescape
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
import unicodedata
from urllib.parse import unquote, urljoin, urlsplit
import xml.etree.ElementTree as ET


ORIGIN = "https://vektorium.io"
SITE_HOSTS = {"vektorium.io", "www.vektorium.io"}
DEMO_ORIGINS = {
    "https://cypher-sentinel-demo.vercel.app",
    "https://mobile-gold-five.vercel.app",
}
EXCLUDED_DIRS = {".git", ".github", "node_modules", "dist", "docs", "scripts"}
VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
}
INERT_TAGS = {"head", "script", "style", "template", "noscript"}
HIDDEN_CLASSES = {"sr-only", "visually-hidden", "seo-faq-hidden", "hidden"}
TRACKER_HOSTS = {
    "www.googletagmanager.com", "www.google-analytics.com",
    "region1.google-analytics.com", "analytics.google.com",
    "region1.analytics.google.com",
}


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", unescape(text)).casefold()
    return re.sub(r"[^\w]+", " ", text).strip()


def types(node: dict) -> set[str]:
    value = node.get("@type", [])
    return {value} if isinstance(value, str) else {item for item in value if isinstance(item, str)} if isinstance(value, list) else set()


def walk_json(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk_json(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk_json(child)


def parse_public_manifest(source: str) -> list[str]:
    match = re.search(r"const publicPages = new Set\(\[([\s\S]*?)\]\);", source)
    if not match:
        raise ValueError("Missing explicit literal publicPages manifest")
    try:
        pages = ast.literal_eval("[" + match.group(1) + "]")
    except (ValueError, SyntaxError) as exc:
        raise ValueError("Public manifest must contain only literal filenames") from exc
    if not isinstance(pages, list) or not pages or not all(isinstance(name, str) and re.fullmatch(r"[a-z0-9-]+\.html", name) for name in pages):
        raise ValueError("Public manifest must contain root-level HTML filenames")
    return pages


@dataclass
class Node:
    tag: str
    attrs: dict[str, str]
    line: int


class Page(HTMLParser):
    def __init__(self, path: Path, source: str):
        super().__init__(convert_charrefs=True)
        self.path = path
        self.source = source
        self.nodes: list[Node] = []
        self.ids: Counter = Counter()
        self.stack: list[tuple[str, bool]] = []
        self.titles: list[list[str]] = []
        self.h1: list[list[str]] = []
        self.visible: list[str] = []
        self.scripts: list[tuple[Node, str]] = []
        self.duplicates: list[tuple[int, str]] = []
        self.script_node: Node | None = None
        self.script_text: list[str] = []
        self.doctype = False
        self.feed(source)
        self.close()

    def handle_decl(self, decl):
        if decl.casefold() == "doctype html":
            self.doctype = True

    def handle_starttag(self, tag, attrs):
        keys = [key.casefold() for key, _ in attrs]
        for key, count in Counter(keys).items():
            if count > 1:
                self.duplicates.append((self.getpos()[0], key))
        attr = {key.casefold(): value if value is not None else "" for key, value in attrs}
        node = Node(tag, attr, self.getpos()[0])
        self.nodes.append(node)
        if attr.get("id"):
            self.ids[attr["id"]] += 1
        inherited = any(hidden for _, hidden in self.stack)
        hidden = inherited or tag in INERT_TAGS or "hidden" in attr
        hidden = hidden or attr.get("aria-hidden", "").casefold() == "true"
        hidden = hidden or bool(set(attr.get("class", "").split()) & HIDDEN_CLASSES)
        if tag not in VOID_TAGS:
            self.stack.append((tag, hidden))
        if tag == "title" and any(parent == "head" for parent, _ in self.stack):
            self.titles.append([])
        elif tag == "h1":
            self.h1.append([])
        elif tag == "script":
            self.script_node = node
            self.script_text = []

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID_TAGS:
            self.handle_endtag(tag)

    def handle_data(self, data):
        names = [tag for tag, _ in self.stack]
        if self.script_node:
            self.script_text.append(data)
        if "head" in names and "title" in names and self.titles:
            self.titles[-1].append(data)
        if "h1" in names and self.h1:
            self.h1[-1].append(data)
        if "body" in names and not any(hidden for _, hidden in self.stack):
            self.visible.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self.script_node:
            self.scripts.append((self.script_node, "".join(self.script_text)))
            self.script_node = None
            self.script_text = []
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                break

    def select(self, tag):
        return [node for node in self.nodes if node.tag == tag]

    def meta(self, name):
        return [n.attrs.get("content", "") for n in self.select("meta")
                if n.attrs.get("name", "").casefold() == name]

    @property
    def is_noindex(self):
        return any("noindex" in re.split(r"[\s,]+", value.casefold()) for value in self.meta("robots"))


class Audit:
    def __init__(self, root: Path):
        self.root = root
        self.passed = 0
        self.failed = 0
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.pages: dict[str, Page] = {}

    def check(self, condition, path, message, line=None):
        if condition:
            self.passed += 1
        else:
            self.failed += 1
            suffix = f":{line}" if line else ""
            self.errors.append(f"{path}{suffix}: {message}")

    def warn(self, condition, path, message, line=None):
        if not condition:
            suffix = f":{line}" if line else ""
            self.warnings.append(f"{path}{suffix}: {message}")

    def result(self):
        return {
            "pages": len(self.pages),
            "checks_passed": self.passed,
            "checks_failed": self.failed,
            "errors": self.errors,
            "warnings_count": len(self.warnings),
            "warnings": self.warnings,
            "content_review_required": True,
            "content_review_status": "Original product claims and schema meanings are preserved pending joint review; current platform code was not assessed.",
        }

    def local_reference(self, value: str, base_url: str, location: str, line=None):
        if not value or value == "#":
            return
        self.check(not re.search(r"[\x00-\x1f]", value), location, "Control character in URL", line)
        try:
            parsed = urlsplit(urljoin(base_url, value))
            hostname = parsed.hostname
        except ValueError:
            self.check(False, location, f"Malformed URL: {value}", line)
            return
        scheme = parsed.scheme.casefold()
        if scheme in {"mailto", "tel"}:
            return
        if scheme == "data":
            return  # CSP permits image data; executable URL contexts are checked separately.
        self.check(scheme in {"https", "http"}, location, f"Unsafe or unsupported URL scheme: {scheme}", line)
        if scheme not in {"https", "http"} or hostname not in SITE_HOSTS:
            return
        path = unquote(parsed.path or "/")
        route = path[:-5] if path.endswith(".html") else path
        route = "/" if route in {"/index", "/index/"} else route.rstrip("/") or "/"
        target_page = self.pages.get(route)
        if target_page:
            fragment = unquote(parsed.fragment)
            if fragment and not fragment.startswith(":~:text="):
                self.check(fragment in target_page.ids, location,
                           f"Missing fragment #{fragment} in {target_page.path.name}", line)
            return
        asset = (self.root / path.lstrip("/")).resolve()
        inside = asset.is_relative_to(self.root)
        self.check(inside and asset.is_file(), location, f"Missing local route or asset: {path}", line)

    def validate_schema(self, page: Page):
        location = page.path.relative_to(self.root).as_posix()
        body = normalize(" ".join(page.visible))
        org_ids: set[str] = set()
        org_names: set[str] = set()
        for script, text in page.scripts:
            if script.attrs.get("type", "").casefold() != "application/ld+json":
                continue
            try:
                data = json.loads(text)
                self.check(isinstance(data, (dict, list)), location, "JSON-LD root must be object/array", script.line)
            except (ValueError, TypeError) as exc:
                self.check(False, location, f"Invalid JSON-LD: {exc}", script.line)
                continue
            for node in walk_json(data):
                if "@type" in node:
                    schema_type = node["@type"]
                    self.check(isinstance(schema_type, str) or (isinstance(schema_type, list) and all(isinstance(item, str) for item in schema_type)),
                               location, "JSON-LD @type must be text or an array of text", script.line)
                node_types = types(node)
                self.warn("SearchAction" not in node_types, location,
                          "SearchAction is declared; confirm the advertised search behavior during content review", script.line)
                if "Organization" in node_types:
                    org_id = str(node.get("@id", "")).strip()
                    org_name = normalize(str(node.get("name", "")))
                    duplicate = bool((org_id and org_id in org_ids) or (org_name and org_name in org_names))
                    self.warn(not duplicate, location, "Repeated Organization definition in JSON-LD; review whether the same entity should be referenced once", script.line)
                    if org_id:
                        org_ids.add(org_id)
                    if org_name:
                        org_names.add(org_name)
                if "Offer" in node_types and "price" in node:
                    try:
                        is_zero = Decimal(str(node["price"])) == 0
                    except InvalidOperation:
                        is_zero = False
                    self.warn(not is_zero, location, "Offer price is 0; confirm its intended commercial meaning with the owner before changing it", script.line)
                if "Question" in node_types:
                    question = normalize(str(node.get("name", "")))
                    self.warn(bool(question) and question in body, location,
                              "FAQ question was not matched to visible body text by the offline parser; review it with the owner", script.line)
                    answers = node.get("acceptedAnswer", [])
                    answers = answers if isinstance(answers, list) else [answers]
                    self.warn(bool(answers), location, "FAQ question has no acceptedAnswer; review intended structured data", script.line)
                    for answer in answers:
                        answer_text = answer.get("text", "") if isinstance(answer, dict) else ""
                        answer_text = normalize(re.sub(r"<[^>]+>", " ", str(answer_text)))
                        self.warn(bool(answer_text) and answer_text in body, location,
                                  "FAQ answer was not matched to visible body text by the offline parser; review it with the owner", script.line)

    def validate_page(self, route: str, page: Page):
        location = page.path.relative_to(self.root).as_posix()
        base_url = ORIGIN + route
        tags = Counter(n.tag for n in page.nodes)
        self.check(page.doctype, location, "Missing HTML5 doctype")
        for tag in ("html", "head", "body", "main"):
            self.check(tags[tag] == 1, location, f"Expected one {tag} element, found {tags[tag]}")
        self.check(bool(page.select("html") and page.select("html")[0].attrs.get("lang")), location, "Missing document language")
        self.check(len(page.titles) == 1 and bool("".join(page.titles[0]).strip()), location, "Expected one nonempty title")
        self.check(len(page.meta("description")) == 1 and bool(page.meta("description")[0].strip()), location, "Expected one nonempty meta description")
        canonicals = [n.attrs.get("href", "") for n in page.select("link") if "canonical" in n.attrs.get("rel", "").casefold().split()]
        self.check(canonicals == [base_url], location, f"Canonical must occur once and equal {base_url}")
        utility_exemption = route == "/generated" and page.is_noindex
        self.check((utility_exemption and not page.h1) or (len(page.h1) == 1 and bool("".join(page.h1[0]).strip())), location, "Expected exactly one nonempty H1")
        self.check(page.script_node is None, location, "Unterminated script element")
        self.check(not page.duplicates, location, f"Duplicate attributes: {page.duplicates}")
        self.check(not any(count > 1 for count in page.ids.values()), location,
                   f"Duplicate IDs: {[key for key, count in page.ids.items() if count > 1]}")
        self.check(any(n.attrs.get("id") == "main-content" for n in page.select("main")), location, "Main landmark must use id=main-content")
        self.check(any(n.attrs.get("href") == "#main-content" for n in page.select("a")), location, "Missing skip link to #main-content")
        if route in {"/demo", "/generated"}:
            self.check(any("demo-nav" in n.attrs.get("class", "").split() for n in page.select("nav")), location, "Missing responsive demo navigation")
        else:
            self.check(any("vx-mobile-menu" in n.attrs.get("class", "").split() for n in page.select("details")), location, "Missing native mobile navigation menu")
            self.check(bool(page.select("summary")), location, "Mobile menu must have a summary control")
        for node in page.nodes:
            attrs = node.attrs
            self.check("style" not in attrs, location, "Inline style attribute is forbidden by CSP", node.line)
            self.check(not any(key.startswith("on") for key in attrs), location, "Inline event handler is forbidden", node.line)
            if node.tag in {"style", "base", "object", "embed"}:
                self.check(False, location, f"Forbidden element <{node.tag}>", node.line)
            if attrs.get("target", "").casefold() == "_blank":
                self.check("noopener" in attrs.get("rel", "").casefold().split(), location, "target=_blank requires rel=noopener", node.line)
            if node.tag == "img":
                self.check("alt" in attrs, location, "Image lacks alt attribute", node.line)
                for dimension in ("width", "height"):
                    self.check(bool(re.fullmatch(r"[1-9][0-9]*", attrs.get(dimension, ""))), location,
                               f"Image lacks positive intrinsic {dimension}", node.line)
            if node.tag == "iframe":
                self.check(not attrs.get("src"), location, "Demo iframe must load only after explicit user action", node.line)
                self.check("srcdoc" not in attrs, location, "Inline iframe documents are forbidden", node.line)
                self.check(bool(attrs.get("title")), location, "Iframe needs an accessible title", node.line)
                self.check(set(attrs.get("sandbox", "").split()) == {"allow-scripts", "allow-same-origin"}, location, "Unexpected demo iframe sandbox permissions", node.line)
                self.check(attrs.get("allow", "").strip() == "fullscreen", location, "Iframe permissions must be limited to fullscreen", node.line)
            for attribute in ("href", "src", "poster", "action"):
                if attribute not in attrs or not attrs[attribute]:
                    continue
                value = attrs[attribute].strip()
                try:
                    parsed = urlsplit(urljoin(base_url, value))
                    hostname = parsed.hostname
                except ValueError:
                    self.check(False, location, f"Malformed URL: {value}", node.line)
                    continue
                if attribute in {"href", "action"}:
                    self.check(parsed.scheme.casefold() not in {"javascript", "data", "vbscript"}, location, "Executable URL in link or form action", node.line)
                if node.tag in {"script", "link", "img"} and hostname in TRACKER_HOSTS:
                    self.check(False, location, "Static analytics request bypasses the opt-in loader", node.line)
                if hostname and ("fonts.googleapis.com" in hostname or "fonts.gstatic.com" in hostname):
                    self.check(False, location, "External font request is not permitted", node.line)
                if node.tag == "link" and "stylesheet" in attrs.get("rel", "").casefold().split():
                    self.check(hostname in SITE_HOSTS, location, "Stylesheets must be self-hosted", node.line)
                if node.tag == "link" and attrs.get("as", "").casefold() == "font":
                    self.check(hostname in SITE_HOSTS, location, "Fonts must be self-hosted", node.line)
                self.local_reference(value, base_url, location, node.line)
            if attrs.get("srcset"):
                for candidate in attrs["srcset"].split(","):
                    parts = candidate.strip().split()
                    self.check(bool(parts), location, "Empty srcset candidate", node.line)
                    if parts:
                        self.local_reference(parts[0], base_url, location, node.line)
        for node, text in page.scripts:
            mime = node.attrs.get("type", "").casefold().strip()
            src = node.attrs.get("src", "")
            if src:
                try:
                    parsed = urlsplit(urljoin(base_url, src))
                    self.check(parsed.hostname in SITE_HOSTS, location, "Static executable scripts must be self-hosted", node.line)
                except ValueError:
                    self.check(False, location, "Malformed script URL", node.line)
                self.check(not text.strip(), location, "External script element must not contain inline code", node.line)
            else:
                self.check(mime == "application/ld+json", location, "Inline executable script is forbidden", node.line)
        self.validate_schema(page)

    def validate_assets(self):
        for path in sorted((self.root / "assets").rglob("*.css")):
            text = path.read_text(encoding="utf-8")
            location = path.relative_to(self.root).as_posix()
            self.check(not re.search(r"@import\b", text, re.I), location, "CSS imports are not allowed; bundle/self-host styles")
            self.check("fonts.googleapis.com" not in text and "fonts.gstatic.com" not in text, location, "External fonts are forbidden")
            for match in re.finditer(r"url\(\s*([\"']?)(.*?)\1\s*\)", text, re.I):
                self.local_reference(match.group(2), ORIGIN + "/" + location, location)
        javascript = sorted((self.root / "assets").rglob("*.js"))
        self.check(bool(javascript), "assets", "No external JavaScript assets found")
        for path in javascript:
            text = path.read_text(encoding="utf-8")
            location = path.relative_to(self.root).as_posix()
            self.check(not re.search(r"\beval\s*\(|\bnew\s+Function\s*\(", text), location, "Dynamic code evaluation is forbidden")
            self.check(not re.search(r"\.innerHTML\s*=|\.outerHTML\s*=|document\.write\s*\(", text), location, "Unsafe HTML-writing sink requires explicit review")
        common = self.root / "assets/site.js"
        self.check(common.is_file(), "assets/site.js", "Missing consent/navigation script")
        if common.is_file():
            text = common.read_text(encoding="utf-8")
            for marker in ("vektorium.analytics-consent.v1", "globalPrivacyControl", "doNotTrack"):
                self.check(marker in text, "assets/site.js", f"Missing static consent safeguard marker: {marker}")

    def validate_sitemap(self):
        path = self.root / "sitemap.xml"
        try:
            tree = ET.fromstring(path.read_text(encoding="utf-8"))
            urls = [node.text.strip() if node.text else "" for node in tree.iter() if node.tag.endswith("}loc") or node.tag == "loc"]
        except (OSError, ET.ParseError) as exc:
            self.check(False, "sitemap.xml", f"Could not parse sitemap: {exc}")
            return
        expected = {ORIGIN + route for route, page in self.pages.items() if not page.is_noindex}
        self.check(len(urls) == len(set(urls)), "sitemap.xml", "Duplicate sitemap URLs")
        self.check(set(urls) == expected, "sitemap.xml", f"Indexable-page mismatch; missing={sorted(expected - set(urls))}; unexpected={sorted(set(urls) - expected)}")
        robots = self.root / "robots.txt"
        self.check(robots.is_file(), "robots.txt", "Missing robots.txt")
        if robots.is_file():
            text = robots.read_text(encoding="utf-8")
            self.check(bool(re.search(r"^Sitemap:\s*https://vektorium\.io/sitemap\.xml\s*$", text, re.M | re.I)), "robots.txt", "Missing canonical sitemap declaration")

    def validate_config(self):
        try:
            config = json.loads((self.root / "vercel.json").read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            self.check(False, "vercel.json", f"Could not read configuration: {exc}")
            return
        self.check(config.get("cleanUrls") is True, "vercel.json", "cleanUrls must remain enabled")
        self.check(config.get("buildCommand") == "npm run build" and config.get("outputDirectory") == "dist", "vercel.json", "Build must publish only the dist allowlist output")
        self.check("framework" in config and config["framework"] is None, "vercel.json", "Use the static Other framework preset")
        self.check(config.get("installCommand") == "", "vercel.json", "Dependency-free site should skip package installation")
        universal = {}
        for rule in config.get("headers", []):
            for header in rule.get("headers", []):
                self.check("immutable" not in header.get("value", "").casefold(), "vercel.json", "Unfingerprinted assets must not be immutable-cached")
            if rule.get("source") == "/(.*)":
                universal.update({item["key"].casefold(): item["value"] for item in rule.get("headers", [])})
        csp = universal.get("content-security-policy", "")
        directives = {parts[0]: parts[1:] for directive in csp.split(";") if (parts := directive.strip().split())}
        self.check(bool(csp), "vercel.json", "An enforced Content-Security-Policy is required after externalization")
        for directive, values in {"default-src": ["'self'"], "object-src": ["'none'"], "base-uri": ["'none'"], "frame-ancestors": ["'self'"], "script-src-attr": ["'none'"], "style-src": ["'self'"], "style-src-attr": ["'none'"], "font-src": ["'self'"]}.items():
            self.check(directives.get(directive) == values, "vercel.json", f"Unexpected CSP {directive}")
        self.check("'unsafe-inline'" not in csp and "'unsafe-eval'" not in csp, "vercel.json", "CSP must not allow unsafe inline/eval execution")
        self.check(set(directives.get("script-src", [])) == {"'self'", "https://www.googletagmanager.com"}, "vercel.json", "CSP script-src must be self plus the consented Google tag host only")
        self.check(set(directives.get("connect-src", [])) == {"'self'"} | {"https://" + host for host in TRACKER_HOSTS}, "vercel.json", "CSP connect-src must not exceed the chosen analytics endpoints")
        self.check(set(directives.get("img-src", [])) == {"'self'", "data:", "https://www.googletagmanager.com", "https://www.google-analytics.com", "https://region1.google-analytics.com"}, "vercel.json", "Unexpected CSP image origins")
        self.check(set(directives.get("frame-src", [])) == DEMO_ORIGINS, "vercel.json", "CSP frame-src must contain only the two approved demo origins")
        self.check(directives.get("form-action") == ["'self'", "mailto:"], "vercel.json", "Unexpected form submission destinations")
        for key in ("strict-transport-security", "x-content-type-options", "x-frame-options", "referrer-policy", "permissions-policy"):
            self.check(bool(universal.get(key)), "vercel.json", f"Missing baseline header {key}")
        self.check(universal.get("x-xss-protection", "0") == "0", "vercel.json", "Disable the obsolete X-XSS-Protection filter")
        self.check(universal.get("x-content-type-options") == "nosniff", "vercel.json", "MIME sniffing must be disabled")
        permissions = universal.get("permissions-policy", "")
        for feature in ("camera", "microphone", "geolocation", "payment", "accelerometer", "gyroscope", "magnetometer", "clipboard-read", "autoplay"):
            self.check(bool(re.search(r"(?:^|,\s*)" + feature + r"=\(\)(?:,|$)", permissions)), "vercel.json", f"Browser feature must remain denied: {feature}")

    def validate_public_manifest(self):
        try:
            declared = parse_public_manifest((self.root / "scripts/build.mjs").read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            self.check(False, "scripts/build.mjs", f"Could not validate public-page manifest: {exc}")
            return
        self.check(len(declared) == len(set(declared)), "scripts/build.mjs", "Duplicate public-page manifest entries")
        actual = {page.path.relative_to(self.root).as_posix() for page in self.pages.values()}
        expected = set(declared)
        self.check(actual == expected, "Public HTML inventory", f"Manifest mismatch; missing={sorted(expected - actual)}; unexpected={sorted(actual - expected)}")

    def run(self):
        files = [path for path in sorted(self.root.rglob("*.html"))
                 if not any(part in EXCLUDED_DIRS for part in path.relative_to(self.root).parts[:-1])]
        self.check(bool(files), ".", "No HTML pages found")
        for path in files:
            relative = path.relative_to(self.root).as_posix()
            route = "/" if relative == "index.html" else "/" + relative.removesuffix(".html")
            try:
                self.pages[route] = Page(path, path.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, ValueError) as exc:
                self.check(False, relative, f"HTML parsing failed: {exc}")
        for route, page in self.pages.items():
            self.validate_page(route, page)
        titles = [normalize("".join(page.titles[0])) for page in self.pages.values() if page.titles]
        h1 = [normalize("".join(page.h1[0])) for route, page in self.pages.items() if page.h1 and route != "/generated"]
        self.check(len(titles) == len(set(titles)), "HTML inventory", "Page titles must be unique")
        self.check(len(h1) == len(set(h1)), "HTML inventory", "Page H1 headings must be unique")
        self.validate_assets()
        self.validate_sitemap()
        self.validate_config()
        self.validate_public_manifest()


def self_test():
    fixture = '<!doctype html><html lang="en"><head><title>A &amp; B</title><script type="application/ld+json">{"@type":"Organization","name":"A"}</script></head><body><main id="main-content"><h1>Hello <span>world</span></h1><p>Visible answer</p><p hidden>Hidden answer</p><a href="#main-content">Skip</a></main></body></html>'
    page = Page(Path("fixture.html"), fixture)
    assert page.doctype and "".join(page.titles[0]) == "A & B"
    assert "".join(page.h1[0]) == "Hello world"
    assert normalize("Visible answer") in normalize(" ".join(page.visible))
    assert normalize("Hidden answer") not in normalize(" ".join(page.visible))
    assert len(page.scripts) == 1 and json.loads(page.scripts[0][1])["@type"] == "Organization"
    assert normalize("Post–Quantum &amp; AI") == "post quantum ai"
    assert types({"@type": ["Organization", "Thing"]}) == {"Organization", "Thing"}
    assert types({"@type": ["Organization", {}]}) == {"Organization"}
    assert len(list(walk_json({"@graph": [{"@type": "Offer", "price": "0"}]}))) == 2
    assert parse_public_manifest("const publicPages = new Set(['index.html', 'insight-example.html',]);") == ["index.html", "insight-example.html"]
    for invalid_manifest in ("const pages = [];", "const publicPages = new Set([unknown]);", "const publicPages = new Set(['../private.html']);", "const publicPages = new Set([1]);"):
        try:
            parse_public_manifest(invalid_manifest)
        except ValueError:
            pass
        else:
            raise AssertionError("Malformed or nonliteral manifests must be rejected")
    duplicate = Page(Path("fixture.html"), '<div id="a" id="b"></div><div id="b"></div>')
    assert duplicate.duplicates and duplicate.ids["b"] == 2
    titled_svg = Page(Path("fixture.html"), '<html><head><title>Page title</title></head><body><svg role="img"><title>Accessible illustration title</title></svg></body></html>')
    assert len(titled_svg.titles) == 1 and "".join(titled_svg.titles[0]) == "Page title", "SVG accessibility titles are not document metadata titles"
    audit = Audit(Path("/site"))
    audit.pages["/"] = page
    audit.local_reference("/#main-content", ORIGIN + "/", "fixture.html")
    assert audit.failed == 0
    audit.local_reference("/#missing", ORIGIN + "/", "fixture.html")
    audit.local_reference("https://[invalid", ORIGIN + "/", "fixture.html")
    assert audit.failed == 2
    bad_schema = Page(Path("/site/fixture.html"), '<script type="application/ld+json">{"@graph":[{"@type":"Organization","name":"Same"},{"@type":"Organization","name":"Same"},{"@type":"Offer","price":0},{"@type":"SearchAction"},{"@type":"Question","name":"Hidden","acceptedAnswer":{"text":"Invisible"}}]}</script>')
    before = audit.failed
    audit.validate_schema(bad_schema)
    assert audit.failed == before, "Semantic content concerns must not fail the technical gate"
    assert len(audit.warnings) == 5
    assert any("Organization" in item for item in audit.warnings)
    assert any("price is 0" in item for item in audit.warnings)
    assert any("SearchAction" in item for item in audit.warnings)
    assert sum("FAQ" in item for item in audit.warnings) == 2
    malformed = Page(Path("/site/invalid.html"), '<script type="application/ld+json">{"@type":</script><script type="application/ld+json">{"@type":["Organization",{}]}</script>')
    audit.validate_schema(malformed)
    assert audit.failed - before == 2, "Malformed JSON and schema @type values must remain failures"
    assert len(audit.warnings) == 5
    result = audit.result()
    assert result["content_review_required"] is True
    assert result["warnings_count"] == 5 and result["checks_failed"] == audit.failed
    warnings_only = Audit(Path("/site"))
    warnings_only.validate_schema(bad_schema)
    assert warnings_only.failed == 0 and warnings_only.result()["content_review_required"] is True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--self-test", action="store_true", help="Run parser/helper checks before the site audit")
    parser.add_argument("--json", action="store_true", help="Print a machine-readable result without writing a file")
    args = parser.parse_args()
    if args.self_test:
        self_test()
    audit = Audit(args.root.resolve())
    audit.run()
    result = audit.result()
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        for error in audit.errors:
            print(f"FAIL {error}")
        for warning in audit.warnings:
            print(f"WARN content review: {warning}")
        print(f"{'PASS' if audit.failed == 0 else 'FAIL'} technical checks: {len(audit.pages)} pages; {audit.passed} checks passed; {audit.failed} checks failed; {len(audit.warnings)} content-review warnings.")
        print(result["content_review_status"])
        print("A technical pass does not approve product claims or structured-data meaning.")
        print("Offline checks only. Preview-browser, deployed-header, accessibility and performance checks remain required.")
    return 1 if audit.failed else 0


if __name__ == "__main__":
    sys.exit(main())
