#!/usr/bin/env python3
"""
math_font.py -- swap hand-built slide math from tilted italic to an
upright math stack. System fonts only -- no @font-face, no CDN (rule 2).

Idempotent: re-running does nothing. `revert` removes the injected block
cleanly, restoring the file byte-for-byte.

Files that render math with KaTeX are skipped -- KaTeX already ships proper
math fonts and its italics are correct typography, not the Georgia-italic
fallback the user objected to.

usage:  python3 math_font.py <root> [apply|revert|dry]
"""
import os, re, sys

BEGIN = "<!-- BEGIN math-font:upright -->"
END = "<!-- END math-font:upright -->"

BLOCK = BEGIN + """
<style data-mathfont="upright">
/* ---- upright math typography (rule 17) ---------------------------------
   Cambria Math is a true math face -- real Greek, real operators, digits on
   the baseline. It was never the font that looked wrong, only the italic.
   System fonts only: no @font-face, no CDN, works with no classroom
   network (rule 2).                                                      */
:root{
  --math-stack:"Cambria Math",Cambria,"STIX Two Math","STIX Two Text","Times New Roman",Georgia,serif;
  --font-math:var(--math-stack);
  --math:var(--math-stack);
}
/* plain (not :where) so these beat the original .m / .eq declarations */
.m,.eq,.fr,.frac,.radical,.scene-readout .ro b{
  font-family:var(--math-stack);
  font-style:normal;
}
.m em,.m i,.eq em,.eq i,.m .up,.eq .up,sup,sub{font-style:normal}
/* MathML: browsers auto-italicise single-letter <mi> via text-transform:math-auto */
math{font-family:var(--math-stack)}
math mi,math mn,math mo,math mtext,math ms{text-transform:none;font-style:normal}
/* zero-specificity so existing .am / .gr / .acc bold spans still win */
:where(.m,.eq,.fr,.frac,.radical){
  font-weight:500;
  font-variant-numeric:lining-nums;
  text-rendering:optimizeLegibility;
}
</style>
""" + END + "\n"

BLOCK_RE = re.compile(re.escape(BEGIN) + r".*?" + re.escape(END) + r"\n?", re.S)

# a file is "hand-built math" if it uses the Cambria stack or the math CSS vars
HANDBUILT = re.compile(r"Cambria Math|--font-math|--math\s*:", re.I)
# ...and does not hand math off to KaTeX
KATEX = re.compile(r"KaTeX_Math|katex\.min|renderMathInElement", re.I)


def classify(text):
    if KATEX.search(text):
        return "skip: katex-rendered"
    if not HANDBUILT.search(text):
        return "skip: no hand-built math"
    return "target"


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
                    out = BLOCK_RE.sub("", text)
                    with open(path, "w", encoding="utf-8", newline="") as fh:
                        fh.write(out)
                    changed += 1
                    print(f"  reverted  {rel}")
                continue

            verdict = classify(text)
            if verdict != "target":
                skipped += 1
                print(f"  {verdict:<26} {rel}")
                continue

            if BEGIN in text:
                noop += 1
                print(f"  already done               {rel}")
                continue

            m = re.search(r"</head\s*>", text, re.I)
            if not m:
                skipped += 1
                print(f"  skip: no </head>           {rel}")
                continue

            out = text[: m.start()] + BLOCK + text[m.start():]
            if mode == "apply":
                with open(path, "w", encoding="utf-8", newline="") as fh:
                    fh.write(out)
            changed += 1
            print(f"  {'PATCHED' if mode=='apply' else 'would patch':<26} {rel}")

    print(f"\n{mode}: {changed} changed, {noop} already done, {skipped} skipped")


if __name__ == "__main__":
    main()
