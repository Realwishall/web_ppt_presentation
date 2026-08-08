#!/usr/bin/env python3
"""
math_font.py -- make hand-built slide math UPRIGHT (rule 17).

The durable fix lives in tools/deck-base.css, so anything built by
build-deck.mjs is already correct. This script is only for decks that were
built BEFORE that change and have the old CSS inlined in them.

It appends a marked CSS block to the deck's existing <style> -- not a second
<style> element, because validate-deck.mjs warns when a deck has more than one.
System fonts only: no @font-face, no CDN (rule 2).

Idempotent: re-running does nothing. `revert` removes the block cleanly,
restoring the file byte-for-byte.

Files that render math with KaTeX at runtime are skipped -- KaTeX ships its own
math fonts and its italics are correct typography, not the Georgia-italic
fallback that made the old decks look tilted.

usage:  python3 tools/math_font.py <root> [apply|revert|dry]
"""
import os, re, sys

BEGIN = "/* BEGIN math-font:upright */"
END = "/* END math-font:upright */"

BLOCK = "\n" + BEGIN + """
/* ---- upright math typography (rule 17) ---------------------------------
   Cambria Math is a true math face: real Greek, real operators, digits that
   sit on the baseline. It was never the font that read wrong here, only the
   italic -- and the Georgia fallback underneath it. System fonts only, so a
   deck still sets correctly with no classroom network (rule 2).          */
:root{
  --math-stack:'Cambria Math',Cambria,'STIX Two Math','Times New Roman',serif;
  --font-math:var(--math-stack);
  --math:var(--math-stack);
}
/* plain selectors (not :where) so these beat the deck's own .m / .eq rules */
.m,.eq,.fr,.frac,.radical,.scene-readout .ro b{
  font-family:var(--math-stack);
  font-style:normal;
}
.m em,.m i,.eq em,.eq i,.m .up,.eq .up,sup,sub{font-style:normal}
/* MathML: the UA sheet italicises a single-letter <mi> through
   text-transform:math-auto, which font-style does not override. */
math{font-family:var(--math-stack)}
math mi,math mn,math mo,math mtext,math ms{text-transform:none;font-style:normal}
/* zero-specificity so .am / .gr / .acc bold spans still win */
:where(.m,.eq,.fr,.frac,.radical){
  font-weight:500;
  font-variant-numeric:lining-nums;
  text-rendering:optimizeLegibility;
}
""" + END + "\n"

BLOCK_RE = re.compile(r"\n?" + re.escape(BEGIN) + r".*?" + re.escape(END) + r"\n?", re.S)

# hand-built math: uses the Cambria stack or the math CSS custom properties
HANDBUILT = re.compile(r"Cambria Math|--font-math|--math\s*:", re.I)
# ...and does not hand math off to KaTeX at runtime
KATEX = re.compile(r"KaTeX_Math|katex\.min|renderMathInElement", re.I)


def classify(text):
    if KATEX.search(text):
        return "skip: katex-rendered"
    if not HANDBUILT.search(text):
        return "skip: no hand-built math"
    return "target"


def insert_at(text):
    """End of the last <style> block inside <head>, or None."""
    m = re.search(r"</head\s*>", text, re.I)
    if not m:
        return None
    closes = [c.start() for c in re.finditer(r"</style\s*>", text[: m.start()], re.I)]
    return closes[-1] if closes else None


def main():
    root = sys.argv[1]
    mode = sys.argv[2] if len(sys.argv) > 2 else "dry"
    changed = skipped = noop = 0

    for dirpath, _, names in os.walk(root):
        for name in sorted(names):
            if not name.endswith(".html"):
                continue
            path = os.path.join(dirpath, name)
            rel = os.path.relpath(path, root)
            with open(path, encoding="utf-8") as fh:
                text = fh.read()

            if mode == "revert":
                if BLOCK_RE.search(text):
                    with open(path, "w", encoding="utf-8", newline="") as fh:
                        fh.write(BLOCK_RE.sub("", text))
                    changed += 1
                    print(f"  reverted                   {rel}")
                continue

            verdict = classify(text)
            if verdict != "target":
                skipped += 1
                print(f"  {verdict:<26} {rel}")
                continue

            if BEGIN in text:
                noop += 1
                print(f"  {'already done':<26} {rel}")
                continue

            at = insert_at(text)
            if at is None:
                skipped += 1
                print(f"  {'skip: no <style> in head':<26} {rel}")
                continue

            out = text[:at] + BLOCK + text[at:]
            if mode == "apply":
                with open(path, "w", encoding="utf-8", newline="") as fh:
                    fh.write(out)
            changed += 1
            print(f"  {'PATCHED' if mode == 'apply' else 'would patch':<26} {rel}")

    print(f"\n{mode}: {changed} changed, {noop} already done, {skipped} skipped")


if __name__ == "__main__":
    main()
