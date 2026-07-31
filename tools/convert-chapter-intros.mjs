#!/usr/bin/env node
/**
 * Convert public/chapter-intros/*.html from scrolling microsites into
 * LessonForge presenter-ready single-page landing slides.
 *
 * Safe to re-run: already-converted files (single `.page`, no #about) are skipped.
 * Originals must still contain .cta-ghost / #about / sibling-chapter blocks.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, "..", "public", "chapter-intros");

const FALLBACK = `
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
      render();
    }, 250);
  });
})();
</script>`;

function extract(c, re, idx = 1) {
  const m = c.match(re);
  return m ? m[idx].trim() : "";
}

function convert(file) {
  const src = fs.readFileSync(path.join(DIR, file), "utf8");
  if (
    /<section class="page">/.test(src) &&
    !/id="about"/.test(src) &&
    /__lf-ctl/.test(src)
  ) {
    console.log("skip (already landing)", file);
    return { file, skipped: true };
  }
  const title = extract(src, /<title>([^<]+)<\/title>/i);
  const root = extract(src, /:root\s*\{([\s\S]*?)\}/);
  const badge = extract(src, /<span class="chapter-badge">([\s\S]*?)<\/span>/);
  const brand = extract(src, /<h1 class="brand">([\s\S]*?)<\/h1>/);
  const headline = extract(src, /<p class="headline">([\s\S]*?)<\/p>/);
  const tagline = extract(src, /<p class="tagline">([\s\S]*?)<\/p>/);
  const topics = [...src.matchAll(/<li>([^<]+)<\/li>/g)].map((m) => m[1].trim());

  // Per-chapter hero layout overrides sit between .cta-ghost:hover and "section {"
  let heroOverride = "";
  const ov = src.match(/\.cta-ghost:hover[^}]*\}\s*([\s\S]*?)(?=\nsection\s*\{)/);
  if (ov) {
    heroOverride = ov[1]
      .trim()
      // Original layouts targeted .hero; landing uses .wrap inside .page
      .replace(/\.hero\b/g, ".wrap")
      .replace(/min-height\s*:\s*100vh/g, "height:100%")
      // Keep column stack — drop grid (multi-child wrap would sprawl across columns)
      .replace(/display\s*:\s*grid\s*;?/gi, "display:flex;flex-direction:column;")
      .replace(/grid-template-columns\s*:[^;]+;?/gi, "")
      .replace(/align-items\s*:\s*end\s*;?/gi, "justify-content:flex-end;")
      // Drop CTA restyles — CTAs removed on landing-only slides
      .replace(/\.cta[^{]*\{[^}]*\}/g, "")
      .replace(/\.cta:hover[^{]*\{[^}]*\}/g, "");
  }

  // Harden Three.js boot for sandboxed iframe (may start at 0×0)
  three = three.replace(
    /renderer\.setSize\(innerWidth,\s*innerHeight\);\s*renderer\.setPixelRatio\(Math\.min\(devicePixelRatio,\s*2\)\);\s*wrap\.appendChild\(renderer\.domElement\);/,
    `function size(){
        const w = Math.max(wrap.clientWidth || innerWidth || 1, 1);
        const h = Math.max(wrap.clientHeight || innerHeight || 1, 1);
        renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      size();
      wrap.appendChild(renderer.domElement);`
  );
  three = three.replace(
    /addEventListener\('resize',\s*\(\)\s*=>\s*\{\s*camera\.aspect = innerWidth\/innerHeight;\s*camera\.updateProjectionMatrix\(\);\s*renderer\.setSize\(innerWidth,\s*innerHeight\);\s*\}\);/,
    `addEventListener('resize', size);`
  );

  // Three.js IIFE — from first scene script to sibling-chapter block
  let three = "";
  const t0 = src.indexOf("(function() {");
  const t1 = src.indexOf("// Sibling chapter");
  if (t0 >= 0 && t1 > t0) {
    three = src.slice(t0, t1).trim();
    // Drop mousemove (pointer-events:none in presenter; not needed for landing)
    three = three.replace(
      /addEventListener\('mousemove',\s*\(e\)\s*=>\s*\{[\s\S]*?\}\);?\s*/g,
      ""
    );
  } else {
    throw new Error(`Could not extract three.js from ${file}`);
  }

  // Accent from CSS var for topic chips
  const accent = extract(src, /--accent:\s*([^;]+);/) || "#22d3ee";
  const bg = extract(src, /--bg:\s*([^;]+);/) || "#05060f";
  const glow = extract(src, /--glow:\s*([^;]+);/) || accent;
  const muted = extract(src, /--muted:\s*([^;]+);/) || "#94a3b8";
  const text = extract(src, /--text:\s*([^;]+);/) || "#f1f5f9";
  const display = extract(src, /--display:\s*([^;]+);/) || "serif";
  const body = extract(src, /--body:\s*([^;]+);/) || "sans-serif";

  // Google fonts link (keep if present)
  const fontLink = extract(
    src,
    /(<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]+"[^>]*>)/
  );
  const fontPre =
    `<link rel="preconnect" href="https://fonts.googleapis.com"/>\n` +
    `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>\n`;

  const topicTags = topics
    .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
    .join("\n        ");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${escapeHtml(title)}</title>
${fontLink ? fontPre + fontLink : ""}
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<style>
:root {
${root}
}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; margin: 0; overflow: hidden; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--body);
}

/* Persistent 3D layer — OUTSIDE .page */
#canvas-wrap {
  position: fixed; inset: 0; z-index: 0;
  background: radial-gradient(ellipse at 50% 30%, color-mix(in srgb, var(--glow) 13%, transparent), transparent 60%), var(--bg);
}
#canvas-wrap canvas { display: block; width: 100% !important; height: 100% !important; }
.vignette {
  position: fixed; inset: 0; z-index: 1; pointer-events: none;
  background: radial-gradient(ellipse at center, transparent 40%, color-mix(in srgb, var(--bg) 80%, transparent) 100%);
}

/* Single landing slide */
.page {
  position: relative; z-index: 2;
  height: 100%; box-sizing: border-box;
  overflow: hidden;
  background: transparent;
  color: var(--text);
  font-family: var(--body);
}
.wrap {
  height: 100%; box-sizing: border-box;
  display: flex; flex-direction: column; justify-content: flex-end;
  padding: 6vmin 7vw 8vmin;
  max-width: 72ch;
  position: relative; z-index: 2;
}
.chapter-badge {
  font-size: clamp(12px, 1.8vmin, 18px);
  letter-spacing: 0.25em; text-transform: uppercase;
  color: var(--accent); margin-bottom: 1.2vmin; display: block;
  animation: fadeUp 1s ease both;
}
.brand {
  font-family: var(--display);
  color: var(--text);
  text-shadow: 0 2px 40px var(--bg), 0 0 80px var(--bg);
  animation: fadeUp 1s 0.15s ease both;
  margin: 0;
}
.headline {
  animation: fadeUp 1s 0.3s ease both;
  margin: 0;
}
.tagline {
  margin-top: 1.6vmin; color: var(--muted);
  font-size: clamp(14px, 2.2vmin, 22px); max-width: 40ch;
  animation: fadeUp 1s 0.45s ease both;
}
.strip {
  display: flex; flex-wrap: wrap; gap: 1.2vmin;
  margin-top: 3.5vmin; max-width: 70ch;
  animation: fadeUp 1s 0.6s ease both;
}
.tag {
  padding: 1vmin 2vmin; border-radius: 999px;
  font-size: clamp(12px, 1.9vmin, 18px); font-weight: 600;
  color: var(--text);
  border: 1px solid color-mix(in srgb, var(--muted) 35%, transparent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}
.hint {
  margin-top: 3vmin;
  font-size: clamp(12px, 1.8vmin, 16px);
  color: var(--muted); letter-spacing: 0.04em;
  animation: fadeUp 1s 0.75s ease both;
}

/* Per-chapter hero typography overrides */
${heroOverride}

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(24px); }
  to { opacity: 1; transform: translateY(0); }
}
@media print {
  #canvas-wrap, .vignette, .hint { display: none !important; }
  .page { background: var(--bg) !important; }
  .chapter-badge, .brand, .headline, .tagline, .strip { opacity: 1 !important; transform: none !important; animation: none !important; }
}
</style>
</head>
<body>

<!-- Persistent background siblings (OUTSIDE .page) -->
<div id="canvas-wrap"></div>
<div class="vignette"></div>

<!-- ===== Single chapter landing slide ===== -->
<section class="page">
  <div class="wrap">
    <span class="chapter-badge">${escapeHtml(badge)}</span>
    <h1 class="brand">${brand}</h1>
    <p class="headline">${headline}</p>
    <p class="tagline">${tagline}</p>
    ${
      topicTags
        ? `<div class="strip">
        ${topicTags}
      </div>`
        : ""
    }
    <p class="hint no-print">Press <b>Next</b> to begin the chapter</p>
  </div>
</section>

<script>
${three}
</script>
${FALLBACK}
</body>
</html>
`;

  fs.writeFileSync(path.join(DIR, file), html, "utf8");
  return { file, brand: brand.replace(/<[^>]+>/g, ""), topics: topics.length };
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".html"));
let done = 0, skipped = 0;
for (const f of files) {
  try {
    const r = convert(f);
    if (r.skipped) skipped++;
    else {
      done++;
      console.log("OK", f);
    }
  } catch (e) {
    console.error("FAIL", f, e.message);
    process.exitCode = 1;
  }
}
console.log(`\nConverted ${done}, skipped ${skipped}, total ${files.length}.`);
