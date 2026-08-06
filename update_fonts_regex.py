import os
import re

directory = r"c:\Vishal\Antigravity\pure_html_based_ppt_presentation\JSON_split_html\02 - Unit and Measurement"

pattern = re.compile(r"(--fs-[a-z0-9-]+:\s*clamp\()([0-9.]+)(px|rem),\s*([0-9.]+)(vmin|vw|vh),\s*([0-9.]+)(px|rem)(\);)")

def replace_match(match):
    prefix = match.group(1)
    val1 = float(match.group(2))
    unit1 = match.group(3)
    val2 = float(match.group(4))
    unit2 = match.group(5)
    val3 = float(match.group(6))
    unit3 = match.group(7)
    suffix = match.group(8)
    
    # Check if already updated (e.g. fs-body val1 > 22 or fs-title val1 > 40)
    # We know original fs-title is ~36px, fs-body is ~19px
    # If val1 looks already scaled (like 47, 25, 46.8), we just return it as is.
    # original ranges: 15 to 36 for val1
    if val1 > 40 or (val1 > 22 and 'body' in prefix): 
        # it might be already scaled
        return match.group(0)

    val1 = val1 * 1.3
    val2 = val2 * 1.3
    val3 = val3 * 1.3

    def fmt(v):
        v = round(v, 1)
        return int(v) if v.is_integer() else v
        
    return f"{prefix}{fmt(val1)}{unit1}, {fmt(val2)}{unit2}, {fmt(val3)}{unit3}{suffix}"

for filename in os.listdir(directory):
    if filename.endswith(".html"):
        filepath = os.path.join(directory, filename)
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
            
        new_content, num_subs = pattern.subn(replace_match, content)
        
        if new_content != content:
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(new_content)
            print(f"Updated {num_subs} matches in {filename}")
        else:
            print(f"No changes made in {filename} (might be already updated)")

# Also check for .brand, .headline, .tagline fonts in the Intro.html which were using clamp or rem directly
pattern2 = re.compile(r"(\.brand\s*\{.*font-size:clamp\()([0-9.]+)(px|rem),\s*([0-9.]+)(vmin|vw|vh),\s*([0-9.]+)(px|rem)(\);)")
def replace_match2(match):
    prefix = match.group(1)
    val1 = float(match.group(2))
    if val1 > 3: # 2.5rem is original, 3.25 is scaled
        return match.group(0)
    val1 = val1 * 1.3
    unit1 = match.group(3)
    val2 = float(match.group(4)) * 1.3
    unit2 = match.group(5)
    val3 = float(match.group(6)) * 1.3
    unit3 = match.group(7)
    suffix = match.group(8)
    def fmt(v):
        v = round(v, 1)
        return int(v) if v.is_integer() else v
    return f"{prefix}{fmt(val1)}{unit1}, {fmt(val2)}{unit2}, {fmt(val3)}{unit3}{suffix}"

for filename in os.listdir(directory):
    if filename.endswith(".html"):
        filepath = os.path.join(directory, filename)
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
            
        new_content, num_subs = pattern2.subn(replace_match2, content)
        
        if new_content != content:
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(new_content)
            print(f"Updated {num_subs} brand matches in {filename}")

