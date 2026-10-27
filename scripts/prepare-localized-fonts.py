#!/usr/bin/env python3
"""Prepare pinned, self-hosted Noto CJK subsets after reviewing ja/ko catalogues.

Development helper only: fontTools and Brotli are not deployment dependencies.
Download the exact upstream TTFs in docs/font-sources.md into --source-directory.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import unicodedata

ROOT = Path(__file__).resolve().parent.parent
SOURCES = {
    "ja": ("notosansjp", "c2f3b4d463500a2ddcd3849cded1fceeb9fd6d1c32e6cbecd568453ba50fc68f", "日本語"),
    "ko": ("notosanskr", "194018e6b2b293a7964f037b25c0249ce1418bc9ab3c971060a03aa57861e252", "한국어"),
}


def cjk(point):
    return (0x1100 <= point <= 0x11FF or 0x2E80 <= point <= 0x9FFF
            or 0xA960 <= point <= 0xA97F or 0xAC00 <= point <= 0xD7FF
            or 0xF900 <= point <= 0xFAFF or 0xFF00 <= point <= 0xFFEF
            or 0x20000 <= point <= 0x3FFFF)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-directory", type=Path, required=True)
    parser.add_argument("--python-library", type=Path)
    args = parser.parse_args()
    if args.python_library:
        sys.path.insert(0, str(args.python_library.resolve()))
    from fontTools import subset
    from fontTools.ttLib import TTFont

    source = json.loads((ROOT / "locales/source.json").read_text())
    manifest = {"version": 1, "locales": {}}
    for locale, (family, digest, label) in SOURCES.items():
        original = args.source_directory / f"{family}.ttf"
        if hashlib.sha256(original.read_bytes()).hexdigest() != digest:
            raise ValueError(f"{family}: upstream font checksum differs")
        catalogue = json.loads((ROOT / f"locales/{locale}.json").read_text())
        if catalogue["sourceHash"] != source["sourceHash"] or set(catalogue["translations"]) != {unit["id"] for unit in source["units"]}:
            raise ValueError(f"{locale}: a complete, current catalogue is required")
        body = unicodedata.normalize("NFC", "".join(catalogue["translations"].values()) + label)
        manifest["locales"][locale] = {"upstreamSha256": digest}
        for purpose, text in [("site", body), ("menu", label)]:
            points = {ord(character) for character in text if cjk(ord(character))}
            font = TTFont(original, recalcTimestamp=False)
            available = set(font.getBestCmap())
            missing = points - available
            if missing:
                raise ValueError(f"{locale}: missing upstream glyphs {sorted(missing)}")
            options = subset.Options()
            options.flavor = "woff2"
            options.recalc_timestamp = False
            options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14, 16, 17, 25]
            options.name_legacy = True
            options.name_languages = ["*"]
            subsetter = subset.Subsetter(options=options)
            subsetter.populate(unicodes=points)
            subsetter.subset(font)
            font.flavor = "woff2"
            path = f"assets/fonts/noto-sans-{'jp' if locale == 'ja' else 'kr'}-{purpose}.woff2"
            font.save(ROOT / path)
            output = (ROOT / path).read_bytes()
            verification = TTFont(ROOT / path)
            coverage = set(verification.getBestCmap())
            if not points <= coverage or "fvar" not in verification:
                raise ValueError(f"{path}: glyph or variable-weight verification failed")
            manifest["locales"][locale][purpose] = {
                "path": path, "sha256": hashlib.sha256(output).hexdigest(),
                "bytes": len(output), "codepoints": sorted(coverage),
            }
            print(f"{path}: {len(points)} characters, {len(output):,} bytes")
    (ROOT / "locales/font-coverage.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
