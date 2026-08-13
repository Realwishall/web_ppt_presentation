import os
import re

target_dir = r"c:\Vishal\Antigravity\pure_html_based_ppt_presentation\JSON_split_html"

def update_titles(directory):
    count = 0
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.endswith(".html"):
                filepath = os.path.join(root, file)
                
                with open(filepath, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                # Replace the title tag content with the file name
                new_content = re.sub(r'<title>.*?</title>', f'<title>{file}</title>', content, flags=re.IGNORECASE | re.DOTALL)
                
                if new_content != content:
                    with open(filepath, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    count += 1
    print(f"Updated titles in {count} HTML files.")

if __name__ == "__main__":
    update_titles(target_dir)
