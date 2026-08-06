import os
import re

directory = r"c:\Vishal\Antigravity\pure_html_based_ppt_presentation\JSON_split_html\02 - Unit and Measurement"

old_block = """  /* type scale — presentation scale, NOT web scale (rule 9) */
  --fs-title:     clamp(36px, 8.8vmin, 100px);
  --fs-h2:        clamp(26px, 5.6vmin, 60px);
  --fs-h3:        clamp(22px, 4.4vmin, 46px);
  --fs-body:      clamp(19px, 3.3vmin, 38px);
  --fs-small:     clamp(17px, 2.8vmin, 32px);
  --fs-note:      clamp(16px, 2.6vmin, 28px);
  --fs-eq:        clamp(20px, 3.9vmin, 44px);
  --fs-th:        clamp(15px, 2.2vmin, 25px);
  --fs-td:        clamp(15px, 2.35vmin, 26px);"""

new_block = """  /* type scale — presentation scale, NOT web scale (rule 9) */
  --fs-title:     clamp(47px, 11.4vmin, 130px);
  --fs-h2:        clamp(34px, 7.3vmin, 78px);
  --fs-h3:        clamp(29px, 5.7vmin, 60px);
  --fs-body:      clamp(25px, 4.3vmin, 49px);
  --fs-small:     clamp(22px, 3.6vmin, 42px);
  --fs-note:      clamp(21px, 3.4vmin, 36px);
  --fs-eq:        clamp(26px, 5.1vmin, 57px);
  --fs-th:        clamp(20px, 2.9vmin, 33px);
  --fs-td:        clamp(20px, 3.1vmin, 34px);"""

for filename in os.listdir(directory):
    if filename.endswith(".html"):
        filepath = os.path.join(directory, filename)
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
            
        if old_block in content:
            content = content.replace(old_block, new_block)
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(content)
            print(f"Updated {filename}")
        else:
            print(f"Block not found in {filename} or already updated")
