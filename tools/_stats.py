#!/usr/bin/env python3
from pathlib import Path
import re, random, sys
sys.stdout.reconfigure(encoding="utf-8")
root = Path(r"C:\Vishal\Antigravity\pure_html_based_ppt_presentation\JSON_split_html")
htmls = [p for p in root.rglob("*.html") if p.parent != root or True]
# Prefer chapter-nested files
nested = [p for p in htmls if p.parent != root]
print("total html", len(htmls), "nested", len(nested))
chapters = sorted({p.parent.name for p in nested})
print("chapters", len(chapters))
random.seed(1)
sample = random.sample(nested, min(25, len(nested)))
bad = 0
for f in sample:
    t = f.read_text(encoding="utf-8", errors="replace")
    pages = t.count('class="page"')
    if pages < 1 or "ArrowRight" not in t or "__lf-ctl" not in t:
        bad += 1
        print("BAD", f.relative_to(root))
print("spot bad", bad, "/", len(sample))
sizes = sorted(f.stat().st_size for f in nested)
print("size KB min/median/max", sizes[0] // 1024, sizes[len(sizes) // 2] // 1024, sizes[-1] // 1024)
print("sample path:", next(p for p in nested if "Electrostatics" in str(p) and "What_is_charge" in p.name and "part_03" in p.name))
