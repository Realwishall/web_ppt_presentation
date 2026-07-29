#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Convert JSON_split_data/*.json → LessonForge presenter decks (.html).

Output mirrors chapter folders under JSON_split_html/ by default.
Each file is self-contained: deck-base.css inlined, <section class="page">
slides, .step reveals, standalone fallback controller (rule 6).
"""

from __future__ import annotations

import argparse
import base64
import html as html_lib
import io
import json
import os
import re
import sys
import traceback
from pathlib import Path
from typing import Any

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    Image = None  # type: ignore

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_IN = ROOT / "JSON_split_data"
DEFAULT_OUT = ROOT / "JSON_split_html"
CSS_PATH = ROOT / "tools" / "deck-base.css"

# Classroom of ~100: bump type slightly above the design-system baseline.
CLASSROOM_OVERRIDES = """
:root{
  --fs-title: clamp(40px, 9.2vmin, 110px);
  --fs-h2:    clamp(30px, 6.4vmin, 72px);
  --fs-h3:    clamp(24px, 4.8vmin, 52px);
  --fs-body:  clamp(22px, 3.8vmin, 44px);
  --fs-small: clamp(19px, 3.1vmin, 36px);
  --fs-note:  clamp(17px, 2.8vmin, 30px);
  --fs-eq:    clamp(24px, 4.4vmin, 52px);
  --fs-th:    clamp(18px, 2.8vmin, 32px);
  --fs-td:    clamp(17px, 2.6vmin, 30px);
  --pad-y: 7.5vmin;
  --pad-x: 6.5vmin;
}
.figure-frame img{max-height:62vh}
.figure-frame.hero img{max-height:78vh}
.chip{display:inline-block;padding:.55vmin 1.8vmin;border-radius:99px;
  font-size:clamp(15px,2.4vmin,26px);font-weight:700;letter-spacing:.08em;
  text-transform:uppercase;color:var(--cyan);
  background:rgba(56,189,248,.12);border:.22vmin solid rgba(56,189,248,.4)}
.media-miss{padding:3vmin;text-align:center;color:var(--muted);border:.2vmin dashed var(--card-border);
  border-radius:1.2vmin;font-size:var(--fs-small)}
"""

FALLBACK = r"""
<script>
(function(){
  window.addEventListener('load', function(){
    setTimeout(function(){
      if (document.getElementById('__lf-ctl')) return;
      var pages = [].slice.call(document.querySelectorAll('.page'));
      if (!pages.length) return;
      var i = 0, step = 0;
      var steps = function(p){ return [].slice.call(p.querySelectorAll('.step')); };
      function render(){
        pages.forEach(function(p,k){ p.style.display = k===i ? '' : 'none'; });
        steps(pages[i]).forEach(function(s,k){
          s.style.transition = 'opacity .4s, transform .4s';
          s.style.opacity = k < step ? '1' : '0';
          s.style.transform = k < step ? 'none' : 'translateY(14px)';
        });
      }
      function next(){ var n = steps(pages[i]).length;
        if (step < n) step++; else if (i < pages.length-1){ i++; step = 0; } render(); }
      function prev(){ if (step > 0) step--; else if (i > 0){ i--; step = steps(pages[i]).length; } render(); }
      document.addEventListener('keydown', function(e){
        if (e.key === 'ArrowRight' || e.key === ' ') next();
        else if (e.key === 'ArrowLeft') prev();
      });
      document.addEventListener('click', function(e){ if (!e.target.closest('.clickable')) next(); });
      render();
    }, 250);
  });
})();
</script>
"""

LOGO_NAME_RE = re.compile(r"(logo|pw[_ -]?logo|physics.?wallah|medal|badge|watermark)", re.I)
NOISE_TEXT_RE = re.compile(
    r"^(physics\s*wallah|pw|www\.|https?://|©|copyright|\d{1,2}/\d{1,2}/\d{2,4})$",
    re.I,
)
OPTION_LETTER_RE = re.compile(r"^([a-dA-D]|[1-4])[.)]?\s*$")
ANS_RE = re.compile(r"^(ans(wer)?\s*[:：].+)$", re.I)
MAX_IMG_EDGE = 1400
MAX_IMG_BYTES = 180_000


def esc(s: Any) -> str:
    return html_lib.escape("" if s is None else str(s), quote=True)


def clean_text(s: str | None) -> str:
    if not s:
        return ""
    t = s.replace("\xa0", " ").replace("\r", "")
    t = re.sub(r"[ \t]+\n", "\n", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def flatten_objects(objects: list[dict], depth: int = 0) -> list[dict]:
    out: list[dict] = []
    for o in objects or []:
        o = dict(o)
        o["_depth"] = depth
        out.append(o)
        subs = o.get("sub_objects") or []
        if subs:
            out.extend(flatten_objects(subs, depth + 1))
    return out


def max_font_pt(obj: dict) -> float:
    tc = obj.get("text_content") or {}
    best = 0.0
    for p in tc.get("paragraphs") or []:
        for r in p.get("runs") or []:
            fs = r.get("font_size_pt")
            if isinstance(fs, (int, float)) and fs > best:
                best = float(fs)
    return best


def obj_text(obj: dict) -> str:
    tc = obj.get("text_content") or {}
    return clean_text(tc.get("full_text") or "")


def is_logo_image(obj: dict, slide_w: float, slide_h: float) -> bool:
    info = obj.get("image_info") or {}
    pos = obj.get("position") or info.get("position_found") or {}
    w = float(pos.get("width_in") or 0)
    h = float(pos.get("height_in") or 0)
    top = float(pos.get("top_in") or 0)
    left = float(pos.get("left_in") or 0)
    name = (obj.get("name") or "") + " " + (info.get("alt_text") or "")
    size = int(info.get("size_bytes") or 0)

    if LOGO_NAME_RE.search(name):
        return True
    # Tiny / banner chrome (PW strip, icons)
    if h and h < 0.85 and w < 3.2:
        return True
    if h and h < 1.2 and w / max(h, 0.01) > 4.5 and top < 1.2:
        return True
    if size and size < 12_000 and max(w, h) < 2.5:
        return True
    # Corner watermark
    if w < 2.5 and h < 2.5 and (left < 0.4 or left > slide_w - 2.8) and top < 0.6:
        return True
    return False


def is_fullbleed(obj: dict, slide_w: float, slide_h: float) -> bool:
    pos = obj.get("position") or (obj.get("image_info") or {}).get("position_found") or {}
    w = float(pos.get("width_in") or 0)
    h = float(pos.get("height_in") or 0)
    return w >= slide_w * 0.82 and h >= slide_h * 0.82


def animated_shape_ids(slide: dict) -> list[str]:
    """Ordered unique shape ids that animate IN (for .step)."""
    seen: set[str] = set()
    order: list[str] = []
    anims = sorted(slide.get("animations") or [], key=lambda a: (a.get("step") or 0, a.get("delay_sec") or 0))
    for a in anims:
        if (a.get("transition") or "").lower() not in ("in", ""):
            # keep "in" and unknown; skip explicit "out"
            if (a.get("transition") or "").lower() == "out":
                continue
        if a.get("animation_type") == "set" and (a.get("transition") or "none") == "none":
            # often paired with animEffect — prefer the effect entry
            continue
        sid = str(a.get("target_shape_id") or "")
        if not sid or sid in seen:
            continue
        seen.add(sid)
        order.append(sid)
    # Fallback: any animated target in step order
    if not order:
        for a in anims:
            sid = str(a.get("target_shape_id") or "")
            if sid and sid not in seen:
                seen.add(sid)
                order.append(sid)
    return order


def pick_title(texts: list[tuple[dict, str]]) -> tuple[str, list[tuple[dict, str]]]:
    if not texts:
        return "", []
    candidates = [(o, t) for o, t in texts if not OPTION_LETTER_RE.match(t.strip())]
    pool = candidates or texts
    # Prefer largest font near the top
    ranked = sorted(
        pool,
        key=lambda it: (
            -(max_font_pt(it[0]) or 20),
            float((it[0].get("position") or {}).get("top_in") or 99),
        ),
    )
    title_obj, title = ranked[0]
    # Reject tiny option-like titles
    if OPTION_LETTER_RE.match(title.strip()) or len(title.strip()) <= 2:
        return "", texts
    rest = [t for t in texts if t[0] is not title_obj]
    return title, rest


def _pos(o: dict) -> tuple[float, float]:
    p = o.get("position") or {}
    return float(p.get("top_in") or 0), float(p.get("left_in") or 0)


def try_render_mcq(texts: list[tuple[dict, str]], title: str) -> str | None:
    """Rebuild scattered a/b/c/d text boxes into a real options list."""
    letters = [(o, t) for o, t in texts if OPTION_LETTER_RE.match(t.strip())]
    if len(letters) < 3:
        return None
    answers = [(o, t) for o, t in texts if ANS_RE.match(t.strip())]
    used = {id(o) for o, _ in letters} | {id(o) for o, _ in answers}
    # Question lines: everything else that is not a lone option letter
    q_parts = []
    bodies = []
    for o, t in sorted(texts, key=lambda it: _pos(it[0])):
        if id(o) in used:
            continue
        if t.strip().lower() in ("question", "q.", "q"):
            continue
        bodies.append((o, t))

    # Pair each letter with the nearest text to its right / same row
    options = []
    claimed = set()
    for o, lab in sorted(letters, key=lambda it: _pos(it[0])):
        top, left = _pos(o)
        best = None
        best_score = 1e9
        for o2, t2 in bodies:
            if id(o2) in claimed:
                continue
            t2top, t2left = _pos(o2)
            if t2left + 0.05 < left:
                continue
            dy = abs(t2top - top)
            dx = t2left - left
            if dy > 0.55:
                continue
            score = dy * 3 + max(0, dx)
            if score < best_score:
                best_score = score
                best = (o2, t2)
        letter = lab.strip().rstrip(".)").upper()
        if best:
            claimed.add(id(best[0]))
            options.append((letter, best[1]))
        else:
            options.append((letter, ""))

    leftovers = [(o, t) for o, t in bodies if id(o) not in claimed]
    # Prefer leftovers as question stem (top-most)
    leftovers_sorted = sorted(leftovers, key=lambda it: _pos(it[0]))
    stem_bits = [t for _, t in leftovers_sorted if not ANS_RE.match(t)]
    if not options:
        return None

    stem = title
    if stem_bits:
        # Use the longest leftover as stem if title is weak
        if not stem or len(stem) < 8 or OPTION_LETTER_RE.match(stem):
            stem = stem_bits[0]
            stem_bits = stem_bits[1:]

    body = ['<div class="wrap">']
    body.append('<div class="chip">MCQ</div>')
    body.append(f'<h2 class="heading">{esc(stem or "Question")}</h2>')
    for t in stem_bits[:3]:
        body.append(f'<p>{esc(t)}</p>')
    body.append('<div class="options">')
    for letter, text in options:
        label = f"{letter}. {text}".strip()
        body.append(
            f'<div class="option step"><span class="opt-badge">{esc(letter)}</span>{esc(text or "…")}</div>'
        )
    body.append("</div>")
    for _, t in answers:
        body.append(f'<div class="answer-box step"><span class="ok">&#10003;</span> {esc(t)}</div>')
    body.append("</div>")
    return f'<section class="page">\n{chr(10).join(body)}\n</section>'


def formula_blocks(obj: dict) -> list[dict]:
    return list(obj.get("formulas") or [])


def render_eq(f: dict, stepped: bool) -> str:
    latex = (f.get("latex") or "").strip()
    raw = clean_text(f.get("raw_text") or latex)
    cls = "eq step" if stepped else "eq"
    if latex and len(latex) < 400 and "\\" in latex:
        return f'<div class="{cls}" data-tex="{esc(latex)}"></div>'
    return f'<div class="{cls}">{esc(raw)}</div>'


def render_table(tbl: dict, step_cells: bool = True) -> str:
    matrix = tbl.get("matrix") or []
    if not matrix:
        return ""
    rows = len(matrix)
    cols = max((len(r) for r in matrix), default=0)
    # Cap absurd tables (multiplication chart 11x21 is ok; huge ones get compact)
    compact = " compact" if cols >= 8 or rows >= 10 else ""
    # Classroom pacing: large grids should appear at once (not 200 Next presses)
    data_cells = max(0, (rows - 1) * max(0, cols - 1))
    if data_cells > 24:
        step_cells = False
    # Header = first row if it looks like headers (mostly short / numeric labels)
    head = matrix[0]
    body = matrix[1:] if rows > 1 else []
    html = [f'<table class="data{compact}">', "<thead><tr>"]
    for cell in head:
        html.append(f"<th>{esc(clean_text(cell))}</th>")
    html.append("</tr></thead><tbody>")
    for r in body:
        html.append("<tr>")
        for i, cell in enumerate(r):
            text = clean_text(cell)
            if i == 0:
                html.append(f'<td class="prop">{esc(text)}</td>')
            else:
                step = ' class="step"' if step_cells and text else ""
                html.append(f"<td{step}>{esc(text)}</td>")
        html.append("</tr>")
    html.append("</tbody></table>")
    return "\n".join(html)


def _decode_data_uri(b64: str) -> tuple[str, bytes] | None:
    if b64.startswith("data:"):
        try:
            header, payload = b64.split(",", 1)
            mime = header.split(";")[0].split(":", 1)[1]
            return mime, base64.b64decode(payload)
        except Exception:
            return None
    return "application/octet-stream", base64.b64decode(b64)


def compress_image_bytes(raw: bytes, mime: str) -> tuple[str, bytes]:
    """Downscale / recompress for classroom decks (keeps iframe loads sane)."""
    if Image is None or len(raw) <= MAX_IMG_BYTES:
        return mime, raw
    try:
        im = Image.open(io.BytesIO(raw))
        im.load()
        if im.mode not in ("RGB", "RGBA", "L", "P"):
            im = im.convert("RGBA" if "A" in im.getbands() else "RGB")
        w, h = im.size
        scale = min(1.0, MAX_IMG_EDGE / max(w, h))
        if scale < 1.0:
            im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
        # Prefer JPEG for photographic / large content; keep PNG for simple diagrams with alpha
        has_alpha = im.mode in ("RGBA", "LA", "P") and "A" in im.getbands()
        out = io.BytesIO()
        if has_alpha and len(raw) < 400_000:
            if im.mode != "RGBA":
                im = im.convert("RGBA")
            im.save(out, format="PNG", optimize=True)
            data = out.getvalue()
            if len(data) < len(raw):
                return "image/png", data
            return mime, raw
        if im.mode != "RGB":
            im = im.convert("RGB")
        quality = 70
        best = raw
        best_mime = mime
        for q in (70, 60, 50):
            out = io.BytesIO()
            im.save(out, format="JPEG", quality=q, optimize=True)
            data = out.getvalue()
            if len(data) < len(best):
                best, best_mime, quality = data, "image/jpeg", q
            if len(best) <= MAX_IMG_BYTES:
                break
        return best_mime, best
    except Exception:
        return mime, raw


def img_src(info: dict) -> str | None:
    b64 = info.get("image_base64")
    if not b64:
        return None
    decoded = _decode_data_uri(b64 if b64.startswith("data:") else f"data:image/{(info.get('format') or 'png')};base64,{b64}")
    if not decoded:
        if b64.startswith("data:"):
            return b64
        fmt = (info.get("format") or "png").lower().replace("jpg", "jpeg")
        return f"data:image/{fmt};base64,{b64}"
    mime, raw = decoded
    mime2, raw2 = compress_image_bytes(raw, mime)
    return f"data:{mime2};base64,{base64.b64encode(raw2).decode('ascii')}"


def render_figure(obj: dict, hero: bool = False) -> str:
    info = obj.get("image_info") or {}
    src = img_src(info)
    alt = esc(info.get("alt_text") or obj.get("name") or "figure")
    frame = "figure-frame hero" if hero else "figure-frame"
    if not src:
        desc = clean_text(info.get("description") or alt)
        return f'<div class="media-miss">Figure unavailable offline — {esc(desc[:120])}</div>'
    return f'<div class="{frame}"><img src="{src}" alt="{alt}"></div>'


def useful_texts(objs: list[dict]) -> list[tuple[dict, str]]:
    out = []
    for o in objs:
        if o.get("is_image") or o.get("is_table") or o.get("type") in ("LINE", "MEDIA", "EMBEDDED_OLE_OBJECT"):
            continue
        t = obj_text(o)
        if not t:
            continue
        if NOISE_TEXT_RE.match(t.strip()):
            continue
        # Skip single-character junk
        if len(t) == 1 and not t.isalnum():
            continue
        out.append((o, t))
    return out


def build_page(slide: dict, chapter: str, slide_w: float, slide_h: float) -> str:
    objs = flatten_objects(slide.get("objects") or [])
    anim_ids = animated_shape_ids(slide)

    images = [
        o for o in objs
        if (o.get("is_image") or o.get("type") == "PICTURE") and o.get("image_info")
        and not is_logo_image(o, slide_w, slide_h)
    ]
    tables = [o for o in objs if o.get("is_table") or o.get("table_info")]
    texts = useful_texts(objs)
    formulas = []
    for o in objs:
        for f in formula_blocks(o):
            formulas.append((o, f))

    # Shape-id → should step
    def should_step(o: dict) -> bool:
        sid = str(o.get("shape_id_str") or o.get("id") or "")
        if not anim_ids:
            return True  # no animation info → step body content
        return sid in anim_ids

    title, rest = pick_title(texts)
    fullbleed = [o for o in images if is_fullbleed(o, slide_w, slide_h)]
    content_imgs = [o for o in images if o not in fullbleed]

    # --- Archetype selection ---
    # 1) Full-bleed photo/diagram slide
    if fullbleed and len(texts) <= 2 and not tables:
        cap = title or (rest[0][1] if rest else "")
        body = [f'<div class="wrap center">']
        if cap:
            body.append(f'<h2 class="heading">{esc(cap)}</h2>')
        body.append(render_figure(fullbleed[0], hero=True))
        for o in content_imgs[:2]:
            body.append(f'<div class="step">{render_figure(o)}</div>')
        body.append("</div>")
        return f'<section class="page">\n{chr(10).join(body)}\n</section>'

    # 2) Title / section divider — few short texts, large fonts
    avg_font = sum(max_font_pt(o) for o, _ in texts) / max(len(texts), 1)
    if texts and len(texts) <= 3 and avg_font >= 28 and not tables and not content_imgs and not formulas:
        body = ['<div class="wrap center">']
        if chapter:
            body.append(f'<div class="chip">{esc(chapter)}</div>')
        body.append(f'<h1 class="title">{esc(title or texts[0][1])}</h1>')
        for _, t in (rest if title else texts[1:]):
            body.append(f'<p class="sub step">{esc(t)}</p>')
        body.append("</div>")
        return f'<section class="page">\n{chr(10).join(body)}\n</section>'

    # 3) MCQ — scattered a/b/c/d boxes from PPT (before image splits steal them)
    mcq = try_render_mcq(texts, title)
    if mcq:
        return mcq

    # 4) Table-forward
    if tables:
        body = ['<div class="wrap dense">']
        if title:
            body.append(f'<h2 class="heading">{esc(title)}</h2>')
        for o in tables:
            body.append(render_table(o.get("table_info") or {}))
        for o, t in rest[:8]:
            cls = "step" if should_step(o) else ""
            body.append(f'<p class="{cls}">{esc(t)}</p>' if cls else f"<p>{esc(t)}</p>")
        body.append("</div>")
        return f'<section class="page">\n{chr(10).join(body)}\n</section>'

    # 5) Image + text split
    if content_imgs and (rest or formulas):
        body = ['<div class="wrap">']
        if title:
            body.append(f'<h2 class="heading">{esc(title)}</h2>')
        body.append('<div class="split-6040">')
        body.append("<div>" + "".join(render_figure(o) for o in content_imgs[:2]) + "</div>")
        body.append('<div class="stack">')
        items = rest if title else texts
        for o, t in items:
            # Multi-line → bullets
            lines = [ln.strip() for ln in t.split("\n") if ln.strip()]
            if len(lines) > 1:
                body.append('<ul class="bullets arrow">')
                for ln in lines:
                    step = " step" if should_step(o) else ""
                    body.append(f'<li class="{step.strip()}">{esc(ln)}</li>' if step else f"<li>{esc(ln)}</li>")
                body.append("</ul>")
            else:
                step = " step" if should_step(o) else ""
                body.append(f'<p class="{step.strip()}">{esc(t)}</p>' if step else f"<p>{esc(t)}</p>")
        for o, f in formulas[:6]:
            body.append(render_eq(f, stepped=should_step(o)))
        body.append("</div></div></div>")
        return f'<section class="page">\n{chr(10).join(body)}\n</section>'

    # 6) Image-only (non fullbleed)
    if images and not texts and not formulas and not tables:
        body = ['<div class="wrap center">', render_figure(images[0], hero=True)]
        for o in images[1:3]:
            body.append(f'<div class="step">{render_figure(o)}</div>')
        body.append("</div>")
        return f'<section class="page">\n{chr(10).join(body)}\n</section>'

    # 7) Formula sheet
    if formulas and len(texts) <= 4:
        body = ['<div class="wrap">']
        if title:
            body.append(f'<h2 class="heading">{esc(title)}</h2>')
        body.append('<div class="eq-block">')
        for o, f in formulas:
            body.append(render_eq(f, stepped=True))
        body.append("</div>")
        for o, t in (rest if title else texts):
            body.append(f'<p class="step">{esc(t)}</p>')
        if content_imgs:
            body.append(render_figure(content_imgs[0]))
        body.append("</div>")
        return f'<section class="page">\n{chr(10).join(body)}\n</section>'

    # 8) Definition / Q&A-ish (label : value pairs)
    colon_pairs = []
    other = []
    for o, t in (rest if title else texts):
        if ":" in t and len(t) < 180:
            left, right = t.split(":", 1)
            if 1 <= len(left.strip()) <= 40 and right.strip():
                colon_pairs.append((o, left.strip(), right.strip()))
                continue
        other.append((o, t))
    if colon_pairs and len(colon_pairs) >= 2 and len(colon_pairs) >= len(other):
        body = ['<div class="wrap">']
        if title:
            body.append(f'<h2 class="heading">{esc(title)}</h2>')
        body.append('<div class="glossary">')
        for o, lab, val in colon_pairs:
            body.append('<div class="g-row">')
            body.append(f'<span class="label">{esc(lab)}:</span>')
            body.append(f'<span class="step">{esc(val)}</span>')
            body.append("</div>")
        body.append("</div>")
        for o, t in other:
            body.append(f'<p class="step">{esc(t)}</p>')
        body.append("</div>")
        return f'<section class="page">\n{chr(10).join(body)}\n</section>'

    # 9) Default: heading + bullets / cards
    body = ['<div class="wrap">']
    if title:
        body.append(f'<h2 class="heading">{esc(title)}</h2>')
    items = rest if title else texts

    # Group into bullets when many short lines
    short = [(o, t) for o, t in items if len(t) < 140 and "\n" not in t]
    long = [(o, t) for o, t in items if not (len(t) < 140 and "\n" not in t)]

    if len(short) >= 2:
        body.append('<ul class="bullets arrow">')
        for idx, (o, t) in enumerate(short):
            body.append(f'<li class="step">{esc(t)}</li>')
        body.append("</ul>")
    else:
        short = []  # fall through all as blocks
        long = items

    for o, t in long:
        lines = [ln.strip() for ln in t.split("\n") if ln.strip()]
        if len(lines) > 1:
            body.append('<ul class="bullets dot">')
            for ln in lines:
                body.append(f'<li class="step">{esc(ln)}</li>')
            body.append("</ul>")
        elif len(t) > 160:
            body.append(f'<div class="card step"><p>{esc(t)}</p></div>')
        else:
            body.append(f'<p class="step">{esc(t)}</p>')

    for o, f in formulas:
        body.append(render_eq(f, stepped=True))
    for o in content_imgs[:2]:
        body.append(f'<div class="step">{render_figure(o)}</div>')
    for o in fullbleed[:1]:
        body.append(f'<div class="step">{render_figure(o, hero=True)}</div>')

    if not items and not formulas and not images:
        summary = clean_text(slide.get("slide_text_summary") or "")
        if summary:
            body.append(f'<p class="lead">{esc(summary.splitlines()[0][:120])}</p>')
        else:
            body.append('<p class="note">Empty slide</p>')

    body.append("</div>")
    return f'<section class="page">\n{chr(10).join(body)}\n</section>'


def assemble_deck(data: dict, css: str) -> str:
    chapter = data.get("chapter") or ""
    title = data.get("presentation_name") or "Lesson"
    meta = data.get("split_metadata") or {}
    part = meta.get("part_number")
    if part:
        title_full = f"{title} (Part {part})"
    else:
        title_full = title
    dims = data.get("slide_dimensions") or {}
    slide_w = float(dims.get("width_inches") or 13.3333)
    slide_h = float(dims.get("height_inches") or 7.5)

    pages = [
        build_page(s, chapter, slide_w, slide_h)
        for s in data.get("slides") or []
    ]
    kicker = chapter or title
    persistent = f"""<div id="bg" aria-hidden="true">
  <svg xmlns="http://www.w3.org/2000/svg">
    <defs>
      <pattern id="hex" width="70" height="121" patternUnits="userSpaceOnUse">
        <polygon points="35,0 70,20.2 70,60.6 35,80.8 0,60.6 0,20.2" fill="none" stroke="#ffffff" stroke-opacity="0.045" stroke-width="1.4"/>
        <polygon points="35,80.8 70,101 70,141.4 35,161.6 0,141.4 0,101" fill="none" stroke="#ffffff" stroke-opacity="0.045" stroke-width="1.4"/>
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#hex)"/>
  </svg>
</div>
<div class="kicker-tag">{esc(kicker)}</div>"""

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{esc(title_full)} — LessonForge Deck</title>
<style>
{css.strip()}
{CLASSROOM_OVERRIDES.strip()}
</style>
</head>
<body>

<!-- Persistent layers: visible on EVERY slide, OUTSIDE any .page -->
{persistent}

{chr(10).join(pages)}

<!-- Standalone fallback controller (rule 6) -->
{FALLBACK.strip()}

</body>
</html>
"""


def convert_file(src: Path, dst: Path, css: str, force: bool = False) -> tuple[str, int, int]:
    if dst.exists() and not force:
        # Skip if newer than source? Still skip unless force for resume speed
        return "skip", 0, dst.stat().st_size
    data = json.loads(src.read_text(encoding="utf-8"))
    html = assemble_deck(data, css)
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(html, encoding="utf-8")
    pages = len(data.get("slides") or [])
    return "ok", pages, len(html.encode("utf-8"))


def main() -> int:
    ap = argparse.ArgumentParser(description="JSON_split_data → LessonForge HTML")
    ap.add_argument("--in", dest="indir", default=str(DEFAULT_IN))
    ap.add_argument("--out", dest="outdir", default=str(DEFAULT_OUT))
    ap.add_argument("--chapter", default="", help="Only convert this chapter folder name")
    ap.add_argument("--limit", type=int, default=0, help="Max files (0 = all)")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--file", default="", help="Convert a single JSON path")
    args = ap.parse_args()

    if not CSS_PATH.exists():
        print("missing", CSS_PATH, file=sys.stderr)
        return 1
    css = CSS_PATH.read_text(encoding="utf-8")

    indir = Path(args.indir)
    outdir = Path(args.outdir)

    if args.file:
        files = [Path(args.file)]
    else:
        files = []
        for root, _, fs in os.walk(indir):
            if args.chapter and Path(root).name != args.chapter and args.chapter not in Path(root).parts:
                continue
            for f in fs:
                if f.endswith(".json") and f != "split_summary.json":
                    files.append(Path(root) / f)
        files.sort()

    if args.limit:
        files = files[: args.limit]

    print(f"converting {len(files)} file(s) → {outdir}")
    ok = skip = err = 0
    pages_total = 0
    bytes_total = 0

    for i, src in enumerate(files, 1):
        try:
            rel = src.relative_to(indir)
        except ValueError:
            rel = Path(src.name)
        dst = outdir / rel.with_suffix(".html")
        try:
            status, pages, nbytes = convert_file(src, dst, css, force=args.force)
            if status == "skip":
                skip += 1
            else:
                ok += 1
                pages_total += pages
                bytes_total += nbytes
            if i % 50 == 0 or status == "ok" and i <= 5:
                print(f"  [{i}/{len(files)}] {status:4} {rel}")
        except Exception as e:
            err += 1
            print(f"  [{i}/{len(files)}] ERR  {rel}: {e}", file=sys.stderr)
            if os.environ.get("JSON_TO_HTML_DEBUG"):
                traceback.print_exc()

    print(
        f"done: ok={ok} skip={skip} err={err} pages={pages_total} "
        f"size={(bytes_total/1024/1024):.1f} MB"
    )
    return 1 if err else 0


if __name__ == "__main__":
    raise SystemExit(main())
