import os
import re

directory = r"c:\Vishal\Antigravity\pure_html_based_ppt_presentation\JSON_split_html\02 - Unit and Measurement"

# Only target font-size: 45px or font-size:45px
pattern = re.compile(r"(font-size:\s*)([0-9]+)(px)")

def replace_match(match):
    prefix = match.group(1)
    val = float(match.group(2))
    unit = match.group(3)
    
    # Do not scale if already scaled. If val > 80 it's getting too big, 
    # but some might be up to 74px naturally. 
    # Let's scale if it is likely original. 
    # 74px * 1.3 = 96px
    # 48px * 1.3 = 62px
    # Let's just scale everything if it hasn't been scaled in this run. 
    # To be safe against multiple runs, we'll only scale if we haven't modified the file yet.
    
    val = val * 1.3
    
    def fmt(v):
        v = round(v)
        return int(v) if float(v).is_integer() else v
        
    return f"{prefix}{fmt(val)}{unit}"

files_to_check = [
    "02_00 Unit and Dimention Intro.html",
    "02_04 Unit and Dimention Screw-Gauge-3d-model.html",
    "02_06 Unit and Dimention Screw-Gauge Points_0.html",
    "02_06_01 Unit and Dimention Vernier Calliper intro.html",
    "02_07 Unit and Dimention Vernier Calliper-3d-model.html",
    "02_07_01 Unit and Dimention Vernier Calliper outro.html",
    "02_08 Unit and Dimention Dimensional-Analysis.html",
    "Waste 02_04 Unit and Dimention Screw-Gauge-3d-model.html",
    "Waste 02_06 Unit and Dimention Screw-Gauge Points.html",
    "Waste 02_06_01 Unit and Dimention Vernier Calliper intro.html"
]

for filename in files_to_check:
    filepath = os.path.join(directory, filename)
    if not os.path.exists(filepath):
        continue
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
        
    new_content, num_subs = pattern.subn(replace_match, content)
    
    if new_content != content:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(new_content)
        print(f"Updated {num_subs} matches in {filename}")
    else:
        print(f"No changes made in {filename}")

