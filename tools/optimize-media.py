#!/usr/bin/env python3
"""
Downscale extracted photographs so they can be inlined as data-URIs without
blowing the deck's size budget.

    python tools/optimize-media.py build/<deck-slug>
    python tools/optimize-media.py build/<deck-slug> --max-width 1400 --quality 74

Reads  build/<slug>/media/*
Writes build/<slug>/media/opt/<name>.jpg   (or .png where transparency matters)

Fragments then reference the optimised copy:

    <img data-media="media/opt/img-007.jpg" alt="...">

Only photographs should go through here. Diagrams belong as inline SVG — a
downscaled screenshot of a diagram is still a screenshot.

Requires: pillow  (pip install pillow)
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("pillow is required:  pip install pillow")

SKIP_UNDER_KB = 60          # already small enough to inline as-is


def optimise(src: Path, dst_dir: Path, max_width: int, quality: int) -> tuple[Path, int, int]:
    im = Image.open(src)
    before = src.stat().st_size

    has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
    if im.width > max_width:
        h = round(im.height * max_width / im.width)
        im = im.resize((max_width, h), Image.LANCZOS)

    if has_alpha:
        dst = dst_dir / f"{src.stem}.png"
        im.save(dst, "PNG", optimize=True)
    else:
        dst = dst_dir / f"{src.stem}.jpg"
        im.convert("RGB").save(dst, "JPEG", quality=quality, optimize=True, progressive=True)

    return dst, before, dst.stat().st_size


def main() -> None:
    ap = argparse.ArgumentParser(description="Shrink extracted media for inlining.")
    ap.add_argument("deck", help="build/<deck-slug>")
    ap.add_argument("--max-width", type=int, default=1600)
    ap.add_argument("--quality", type=int, default=78)
    ap.add_argument("--only", nargs="*", help="specific filenames, e.g. img-007.jpg")
    args = ap.parse_args()

    media = Path(args.deck) / "media"
    if not media.is_dir():
        sys.exit(f"no media/ in {args.deck} — run extract.py first")

    out = media / "opt"
    out.mkdir(exist_ok=True)

    files = sorted(p for p in media.iterdir() if p.is_file())
    if args.only:
        wanted = set(args.only)
        files = [p for p in files if p.name in wanted]

    total_before = total_after = 0
    done = 0
    for p in files:
        kb = p.stat().st_size / 1024
        if kb < SKIP_UNDER_KB and not args.only:
            continue
        try:
            dst, before, after = optimise(p, out, args.max_width, args.quality)
        except Exception as exc:                                   # noqa: BLE001
            print(f"  FAILED {p.name}: {exc}")
            continue
        total_before += before
        total_after += after
        done += 1
        print(f"  {p.name:<18} {before/1024:8.0f} KB -> {after/1024:7.0f} KB   {dst.name}")

    if not done:
        print("nothing needed optimising")
        return
    print(f"\n{done} file(s): {total_before/1024:.0f} KB -> {total_after/1024:.0f} KB "
          f"({100 * (1 - total_after / total_before):.0f}% smaller)")
    print(f"reference them as  media/opt/<name>  in your fragments")


if __name__ == "__main__":
    main()
