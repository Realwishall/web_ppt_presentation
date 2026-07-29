#!/usr/bin/env node
/**
 * Phase 5 — assembly.  Deterministic, so rules 1, 6, 8 and 12 of
 * public/deck-authoring-prompt.md are structurally guaranteed: the author
 * never writes boilerplate, therefore the author can never get it wrong.
 *
 *   node tools/build-deck.mjs build/<deck-slug>            # fragments/ -> deck.html
 *   node tools/build-deck.mjs build/<slug> --out path.html
 *   node tools/build-deck.mjs build/<slug> --title "…" --kicker "…"
 *
 * Input   build/<slug>/fragments/*.html   batches of <section class="page"> only
 *         build/<slug>/manifest.json      slide count of record (from extract.py)
 * Output  a single self-contained .html
 *
 * Math: any <span class="eq" data-tex="…"> is converted to **MathML at build
 * time**. Nothing math-related ships as script, because rule 11 strips every
 * <script> for PDF export — which is exactly why the current decks export with
 * blank equations.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

/* ------------------------------------------------------------------ args -- */
const argv = process.argv.slice(2);
if (!argv.length || argv.includes('--help')) {
  console.log('usage: node tools/build-deck.mjs <build/deck-slug> [--out f.html] [--title T] [--kicker K]');
  process.exit(argv.length ? 0 : 1);
}
const deckDir = path.resolve(argv[0]);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
};

const TOOLS = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

/* ---------------------------------------------------------------- inputs -- */
const manifestPath = path.join(deckDir, 'manifest.json');
const manifest = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  : {};

const fragDir = path.join(deckDir, 'fragments');
if (!fs.existsSync(fragDir)) {
  console.error(`no fragments/ in ${deckDir} — run the render pass (P3) first`);
  process.exit(1);
}

const fragFiles = fs.readdirSync(fragDir)
  .filter((f) => f.endsWith('.html'))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

if (!fragFiles.length) {
  console.error(`fragments/ is empty in ${deckDir}`);
  process.exit(1);
}

let body = fragFiles
  .map((f) => fs.readFileSync(path.join(fragDir, f), 'utf8').trim())
  .join('\n\n');

/* Fragments must be page sections and nothing else — catch a model that
   slipped in its own <style>/<script>/<head> despite the prompt. */
for (const tag of ['<style', '<script', '<head', '<!doctype', '<html', '<body']) {
  if (body.toLowerCase().includes(tag)) {
    console.error(`fragment contains "${tag}" — fragments must be <section class="page"> only`);
    process.exit(1);
  }
}

const pageCount = (body.match(/<section[^>]*class="[^"]*\bpage\b/g) || []).length;
if (!pageCount) {
  console.error('no <section class="page"> found in fragments');
  process.exit(1);
}

/* ----------------------------------------------------------------- media --
   Fragments reference extracted images as <img data-media="media/img-001.jpg">
   so they stay readable and diffable. The build inlines them as data-URIs,
   because the deck ships as a single file and a relative path would break
   (rule 2). Only genuinely photographic content should use this — diagrams are
   rebuilt as inline SVG.                                                     */
const MIME = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', gif: 'gif', webp: 'webp' };
let mediaCount = 0;
let mediaBytes = 0;

body = body.replace(/<img([^>]*?)\sdata-media="([^"]+)"([^>]*?)>/g, (whole, pre, rel, post) => {
  const file = path.join(deckDir, rel);
  if (!fs.existsSync(file)) {
    console.error(`  ! media not found: ${rel}`);
    process.exitCode = 3;
    return whole;
  }
  const mime = MIME[path.extname(file).slice(1).toLowerCase()];
  if (!mime) {
    console.error(`  ! unsupported media type: ${rel}`);
    process.exitCode = 3;
    return whole;
  }
  const buf = fs.readFileSync(file);
  if (buf.length > 260 * 1024) {
    console.error(`  ! ${rel} is ${(buf.length / 1024).toFixed(0)} KB — too large to inline. `
      + `Run: python tools/optimize-media.py ${path.relative(process.cwd(), deckDir)} `
      + `--only ${path.basename(rel)}   then point the fragment at media/opt/`);
    process.exitCode = 3;
    return whole;
  }
  mediaCount += 1;
  mediaBytes += buf.length;
  const attrs = (pre + post).replace(/\s*data-media="[^"]*"/, '').trim();
  return `<img ${attrs} src="data:image/${mime};base64,${buf.toString('base64')}">`;
});

/* ------------------------------------------------------------------ math --
   KaTeX in MathML mode: no runtime JS, no web fonts to embed, native
   rendering, and it inherits the deck's Cambria Math stack (rule 17).       */
let katex = null;
for (const spec of [
  'katex',                                                        // resolved from tools/
  pathToFileURL(path.join(process.cwd(), 'node_modules/katex/dist/katex.mjs')).href,
  pathToFileURL(path.join(TOOLS, '..', 'node_modules/katex/dist/katex.mjs')).href,
]) {
  try {
    katex = (await import(spec)).default;
    break;
  } catch {
    /* try the next location */
  }
}
/* optional — decks using only .frac/.radical markup never need it */

let texCount = 0;
let texFailed = 0;
body = body.replace(
  /<span([^>]*?)\bdata-tex="([^"]*)"([^>]*?)>\s*<\/span>/g,
  (whole, pre, tex, post) => {
    texCount += 1;
    const raw = tex
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    if (!katex) { texFailed += 1; return whole; }
    try {
      const display = /\bdisplay\b/.test(pre + post);
      const mathml = katex.renderToString(raw, {
        output: 'mathml', throwOnError: true, displayMode: display, strict: false,
      });
      const attrs = (pre + post).replace(/\s*data-tex="[^"]*"/, '').trim();
      return `<span ${attrs}>${mathml}</span>`;
    } catch (e) {
      texFailed += 1;
      console.warn(`  ! LaTeX failed: ${raw}  (${e.message.split('\n')[0]})`);
      return whole;
    }
  },
);
/* KaTeX wraps MathML in a .katex span with an HTML fallback; in mathml mode
   it emits <math> directly inside a small wrapper — strip the wrapper so our
   own `math{}` rule in deck-base.css applies cleanly. */
body = body.replace(/<span class="katex">\s*(<math[\s\S]*?<\/math>)\s*<\/span>/g, '$1');

/* ------------------------------------------------------------------- css -- */
const css = fs.readFileSync(path.join(TOOLS, 'deck-base.css'), 'utf8');

/* Guard the one CSS mistake that makes a deck render blank (rule 1). */
if (/\.page\s*\{[^}]*(display\s*:\s*none|opacity\s*:\s*0|visibility\s*:\s*hidden)/.test(css)) {
  console.error('deck-base.css hides .page — that makes every deck blank outside the host');
  process.exit(1);
}

/* -------------------------------------------------------------- metadata -- */
const prettyFromSlug = (manifest.slug || path.basename(deckDir))
  .replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const title = flag('--title') || manifest.source_name?.replace(/\.pptx$/i, '') || prettyFromSlug;
const kicker = flag('--kicker')
  || (manifest.chapter && manifest.chapter !== '?'
      ? manifest.chapter.replace(/^\d+\s*-\s*/, '').trim()
      : title);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* --------------------------------------------------- persistent layers ----
   Siblings of .page (rule 1). Inline SVG, no external assets (rule 2).      */
const persistentLayers = `<div id="bg" aria-hidden="true">
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
<div class="kicker-tag">${esc(kicker)}</div>`;

/* ------------------------------------------- standalone fallback (rule 6) -- */
const fallback = `<script>
(function(){
  window.addEventListener('load', function(){
    setTimeout(function(){
      if (document.getElementById('__lf-ctl')) return;      // host present -> stand down
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
</script>`;

/* --------------------------------------------------- box zoom sentinels ---
   A focus box gets THREE distinct presses: grow, then its content, then shrink
   — and only after it has shrunk does the next box start. The host reveals
   .step elements in document order, one per press, so "grow" and "shrink" each
   have to BE a step. Authors shouldn't hand-write those markers, so the build
   wraps every .info-box that has content steps in a pair of zero-size sentinel
   steps: one before its content, one after.

   Zero-size, NOT display:none — the fx observer reads visibility from the
   computed opacity, and a display:none element has no offsetParent to test. */
const BOX_ZOOM = '<i class="step box-zoom" aria-hidden="true"></i>';

function injectBoxZoom(src) {
  const openRe = /<div\b[^>]*\bclass="[^"]*\binfo-box\b[^"]*"[^>]*>/g;
  let out = '', last = 0, count = 0, m;

  while ((m = openRe.exec(src))) {
    const afterOpen = m.index + m[0].length;

    /* walk to this div's matching close, so nested markup can't fool us */
    const tagRe = /<div\b[^>]*>|<\/div>/g;
    tagRe.lastIndex = afterOpen;
    let depth = 1, close = -1, t;
    while ((t = tagRe.exec(src))) {
      depth += t[0] === '</div>' ? -1 : 1;
      if (depth === 0) { close = t.index; break; }
    }
    if (close === -1) continue;                       // unbalanced — leave it alone

    const inner = src.slice(afterOpen, close);
    if (/\bbox-zoom\b/.test(inner)) continue;         // author already instrumented it
    if (!/class="[^"]*\bstep\b/.test(inner)) continue; // nothing to reveal, nothing to zoom

    out += src.slice(last, afterOpen) + BOX_ZOOM + inner + BOX_ZOOM;
    last = close;
    count += 1;
    openRe.lastIndex = close;
  }
  out += src.slice(last);
  return { html: out, count };
}

const zoomed = injectBoxZoom(body);
body = zoomed.html;

/* ------------------------------------------------- box spotlight (fx) -----
   A box is enlarged between its two sentinel steps and only then:

     press 1  opening sentinel  -> box grows to 120%, everything else dims
     press 2… content steps     -> its lines appear inside the enlarged box
     press N  closing sentinel  -> box settles back to 100%, dimming clears
     press N+1                  -> the NEXT box's opening sentinel, and so on

   So grow and shrink are each their own press and the box stays big for
   exactly as long as the teacher is on it. Stepping backwards walks it back.

   Visibility is read from the COMPUTED opacity, which works both under the host
   (injected !important CSS) and under the rule-6 fallback (inline style). The
   class goes on the .info-box, never on the .step, whose opacity and transform
   the host owns. No-op for decks with no .info-box.                          */
const revealFx = `<script>
(function(){
  window.addEventListener('load', function(){
    var boxes = [].slice.call(document.querySelectorAll('.info-box'));
    if (!boxes.length) return;

    function shown(el){
      if (!el.offsetParent && !el.offsetHeight) return false;   // hidden page
      return parseFloat(getComputedStyle(el).opacity || '1') > 0.5;
    }
    function marks(box){
      try { return box.querySelectorAll(':scope > .box-zoom'); }
      catch (e) { return box.querySelectorAll('.box-zoom'); }
    }
    /* 'shut' -> not reached yet | 'open' -> holding the floor | 'done' -> shrunk */
    function state(box){
      var z = marks(box);
      if (z.length < 2){                     // uninstrumented box: open on any step
        var st = box.querySelectorAll('.step');
        for (var i = 0; i < st.length; i++) if (shown(st[i])) return 'open';
        return 'shut';
      }
      if (shown(z[z.length - 1])) return 'done';
      if (shown(z[0]))            return 'open';
      return 'shut';
    }

    var current = null;
    function sync(){
      var next = null;
      for (var i = 0; i < boxes.length; i++)
        if (state(boxes[i]) === 'open') next = boxes[i];
      if (next === current) return;          // also stops our own class writes
                                             // from re-entering the observer
      var page = (next || current) ? (next || current).closest('.page') : null;
      if (current) current.classList.remove('is-active');
      if (next)    next.classList.add('is-active');
      if (page)    page.classList.toggle('has-focus', !!next);
      current = next;
    }

    setTimeout(function(){                   // after host/fallback has hidden pages
      sync();
      try {
        new MutationObserver(sync).observe(document.body,
          { attributes:true, subtree:true, attributeFilter:['style','class'] });
      } catch (e) { /* no observer -> the lf-show hook below still works */ }
    }, 700);
    window.addEventListener('message', function(e){
      if (e && e.data && e.data.type === 'lf-show') setTimeout(sync, 40);
    });
  });
})();
</script>`;

/* -------------------------------------------------------------- assemble -- */
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} — LessonForge Deck</title>
<style>
${css.trim()}
</style>
</head>
<body>

<!-- Persistent layers: visible on EVERY slide, OUTSIDE any .page (rule 1) -->
${persistentLayers}

${body}

<!-- Box spotlight on reveal (no-op without .info-box) -->
${revealFx}

<!-- Standalone fallback controller (rule 6) — LAST -->
${fallback}

</body>
</html>
`;

const outPath = flag('--out') || path.join(deckDir, `${manifest.slug || path.basename(deckDir)}.html`);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html, 'utf8');

/* ----------------------------------------------------------------- report -- */
const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(0);
const stepCount = (html.match(/class="[^"]*\bstep\b/g) || []).length;
const expected = manifest.slide_count;

console.log(`built ${outPath}`);
console.log(`  pages ${pageCount}${expected ? ` / ${expected} source slides` : ''}` +
            `   steps ${stepCount}   size ${kb} KB   fragments ${fragFiles.length}`);
if (mediaCount) {
  console.log(`  media ${mediaCount} image(s) inlined, ${(mediaBytes / 1024).toFixed(0)} KB raw`);
}
if (zoomed.count) {
  console.log(`  zoom  ${zoomed.count} focus box(es) instrumented (grow / content / shrink)`);
}
if (texCount) {
  console.log(`  latex ${texCount} converted to MathML` +
              (texFailed ? `, ${texFailed} FAILED` : '') +
              (katex ? '' : '  (katex not installed — run: npm i -D katex)'));
}
if (expected && pageCount !== expected) {
  console.error(`  !! page count ${pageCount} != source slide count ${expected}`);
  process.exit(2);
}
