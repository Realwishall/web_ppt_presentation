#!/usr/bin/env python3
from pathlib import Path
import sys
sys.stdout.reconfigure(encoding="utf-8")
root = Path(r"C:\Vishal\Antigravity\pure_html_based_ppt_presentation\JSON_split_html")
big = sorted(((p.stat().st_size, p) for p in root.rglob("*.html")), reverse=True)[:15]
for sz, p in big:
    print(f"{sz/1024/1024:7.1f} MB  {p.relative_to(root)}")
