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
   Siblings of .page (rule 1). Inline SVG, no external assets (rule 2).

   The motif is the chapter's quiet signature behind every slide. `hex` is the
   default (the PW deck backdrop); `graph` is for chapters whose subject IS the
   graph — squared paper, one pale axis pair bottom-left, one rising curve.
   Choose with manifest `"motif"` or --motif. It never carries information
   (rule 11) and never sits where the teacher writes (centre / upper-left).   */
const motif = (flag('--motif') || manifest.motif || 'hex').toLowerCase();

const motifSvg = {
  hex: `<svg xmlns="http://www.w3.org/2000/svg">
    <defs>
      <pattern id="hex" width="70" height="121" patternUnits="userSpaceOnUse">
        <polygon points="35,0 70,20.2 70,60.6 35,80.8 0,60.6 0,20.2" fill="none" stroke="#ffffff" stroke-opacity="0.045" stroke-width="1.4"/>
        <polygon points="35,80.8 70,101 70,141.4 35,161.6 0,141.4 0,101" fill="none" stroke="#ffffff" stroke-opacity="0.045" stroke-width="1.4"/>
      </pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#hex)"/>
  </svg>`,

  graph: `<svg class="motif-graph" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1600 900">
    <defs>
      <pattern id="lf-grid-fine" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M40 0H0V40" fill="none" stroke="#9fb4ff" stroke-opacity="0.055" stroke-width="1"/>
      </pattern>
      <pattern id="lf-grid-major" width="200" height="200" patternUnits="userSpaceOnUse">
        <rect width="200" height="200" fill="url(#lf-grid-fine)"/>
        <path d="M200 0H0V200" fill="none" stroke="#9fb4ff" stroke-opacity="0.10" stroke-width="1.4"/>
      </pattern>
      <linearGradient id="lf-curve-ink" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stop-color="#f5c542" stop-opacity="0.02"/>
        <stop offset="0.55" stop-color="#f5c542" stop-opacity="0.30"/>
        <stop offset="1" stop-color="#7c8cff" stop-opacity="0.16"/>
      </linearGradient>
      <linearGradient id="lf-curve-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f5c542" stop-opacity="0.055"/>
        <stop offset="1" stop-color="#f5c542" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect width="1600" height="900" fill="url(#lf-grid-major)"/>
    <g stroke="#f5c542" stroke-opacity="0.13" stroke-width="2.4" stroke-linecap="round">
      <path d="M120 820 V 210"/>
      <path d="M120 820 H 1500"/>
    </g>
    <path d="M120 820 C 470 812 700 700 900 520 C 1090 350 1250 268 1470 232 L 1470 820 Z" fill="url(#lf-curve-fill)"/>
    <path d="M120 820 C 470 812 700 700 900 520 C 1090 350 1250 268 1470 232" fill="none" stroke="url(#lf-curve-ink)" stroke-width="3.2" stroke-linecap="round"/>
    <path d="M660 820 C 860 800 1010 690 1140 500 C 1250 340 1340 262 1470 214" fill="none" stroke="#7c8cff" stroke-opacity="0.10" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="14 20"/>
  </svg>`,

  rail: `<svg class="motif-rail" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1600 900">
    <defs>
      <linearGradient id="lf-streak-a" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#f5c542" stop-opacity="0"/>
        <stop offset="0.62" stop-color="#f5c542" stop-opacity="0.26"/>
        <stop offset="1" stop-color="#f5c542" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="lf-streak-b" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#7c8cff" stop-opacity="0"/>
        <stop offset="0.58" stop-color="#7c8cff" stop-opacity="0.22"/>
        <stop offset="1" stop-color="#7c8cff" stop-opacity="0"/>
      </linearGradient>
      <pattern id="lf-sleepers" width="52" height="130" patternUnits="userSpaceOnUse">
        <path d="M26 0 V130" stroke="#ffffff" stroke-opacity="0.05" stroke-width="9"/>
      </pattern>
    </defs>
    <!-- long-exposure streaks: right half only, clear of the writing area -->
    <g stroke-linecap="round">
      <path d="M900 108  H1580" stroke="url(#lf-streak-a)" stroke-width="4"/>
      <path d="M1050 176 H1560" stroke="url(#lf-streak-b)" stroke-width="3"/>
      <path d="M960 246  H1610" stroke="url(#lf-streak-a)" stroke-width="2.6"/>
      <path d="M1140 318 H1580" stroke="url(#lf-streak-b)" stroke-width="3.4"/>
      <path d="M1020 392 H1560" stroke="url(#lf-streak-a)" stroke-width="2.2"/>
    </g>
    <!-- the track, low across the whole board -->
    <rect x="0" y="742" width="1600" height="96" fill="url(#lf-sleepers)"/>
    <g stroke="#ffffff" stroke-opacity="0.11" stroke-width="3.6" stroke-linecap="round">
      <path d="M0 754 H1600"/>
      <path d="M0 826 H1600"/>
    </g>
    <path d="M0 790 H1600" stroke="#f5c542" stroke-opacity="0.055" stroke-width="1.6" stroke-dasharray="34 46"/>
  </svg>`,

  well: `<svg class="motif-well" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1600 900">
    <defs>
      <linearGradient id="lf-well-ink" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#f5c542" stop-opacity="0.05"/>
        <stop offset="0.45" stop-color="#f5c542" stop-opacity="0.26"/>
        <stop offset="1" stop-color="#7c8cff" stop-opacity="0.14"/>
      </linearGradient>
      <linearGradient id="lf-well-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#7c8cff" stop-opacity="0"/>
        <stop offset="1" stop-color="#7c8cff" stop-opacity="0.055"/>
      </linearGradient>
      <radialGradient id="lf-well-bead">
        <stop offset="0" stop-color="#f5c542" stop-opacity="0.34"/>
        <stop offset="1" stop-color="#f5c542" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <!-- the potential landscape, kept to the low-right quadrant: the centre and
         upper-left are where the teacher writes, so nothing goes there -->
    <path d="M560 690 C 700 690 760 832 880 832 C 1020 832 1080 588 1240 588 C 1370 588 1440 690 1590 726 L 1590 900 L 560 900 Z"
          fill="url(#lf-well-fill)"/>
    <path d="M560 690 C 700 690 760 832 880 832 C 1020 832 1080 588 1240 588 C 1370 588 1440 690 1590 726"
          fill="none" stroke="url(#lf-well-ink)" stroke-width="3.4" stroke-linecap="round"/>
    <!-- the bead sitting in the minimum, and the crest it is not on -->
    <circle cx="880" cy="832" r="44" fill="url(#lf-well-bead)"/>
    <circle cx="880" cy="832" r="11" fill="#f5c542" fill-opacity="0.24"/>
    <circle cx="1240" cy="588" r="9" fill="none" stroke="#7c8cff" stroke-opacity="0.22" stroke-width="2.4"/>
    <!-- the level each one sits at, dashed back to a pale axis -->
    <g stroke="#9fb4ff" stroke-opacity="0.08" stroke-width="1.6" stroke-dasharray="12 18">
      <path d="M566 832 H880"/>
      <path d="M566 588 H1240"/>
    </g>
    <path d="M566 548 V872" stroke="#f5c542" stroke-opacity="0.075" stroke-width="2.4" stroke-linecap="round"/>
  </svg>`,

}[motif] || null;

if (!motifSvg) {
  console.error(`unknown motif "${motif}" — expected one of: hex, graph, rail, well`);
  process.exit(1);
}

const persistentLayers = `<div id="bg" aria-hidden="true">
  ${motifSvg}
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

/* ---------------------------------------------------- vendored libraries --
   animejs and three ship INLINE or not at all: a deck runs in
   `<iframe sandbox="allow-scripts">` with no guaranteed network, and rule 11
   fails any CDN <script>. tools/make-vendor.mjs prepares the two bundles.

   Inlining is OPT-IN and automatic: a lib is only carried if the deck's markup
   actually asks for it (`data-anime=` / `data-three=`), or the manifest lists it
   in "libs". A text deck stays 50 KB.

   Everything they drive is DECORATION. Scripts are stripped for PDF export, so
   a slide must still teach with the animation missing (rules 7, 11).         */
const VENDOR_FILES = { anime: 'anime.umd.min.js', three: 'three.iife.min.js' };
const libsAsked = new Set(Array.isArray(manifest.libs) ? manifest.libs : []);
if (/\bdata-anime\s*=/.test(body)) libsAsked.add('anime');
if (/\bdata-three\s*=/.test(body)) libsAsked.add('three');

let vendorScripts = '';
let vendorBytes = 0;
for (const lib of libsAsked) {
  const file = VENDOR_FILES[lib] && path.join(TOOLS, 'vendor', VENDOR_FILES[lib]);
  if (!file || !fs.existsSync(file)) {
    console.error(`  ! no vendored build for "${lib}" — run: node tools/make-vendor.mjs`);
    process.exitCode = 3;
    continue;
  }
  /* a bundle may carry the literal "</script" inside a string; escape it so it
     cannot close our own tag */
  const src = fs.readFileSync(file, 'utf8').replace(/<\/script/gi, '<\\/script');
  vendorBytes += Buffer.byteLength(src, 'utf8');
  vendorScripts += `\n<!-- vendored ${lib} — inlined, never a CDN (rule 11) -->\n`
    + `<script data-vendor="${lib}">\n${src}\n</script>\n`;
}

/* --------------------------------------------------------- anime.js (fx) ---
   Authors never write JS — a fragment is page sections only. They write a
   `data-anime` preset on an element and this runtime plays it ONCE, the moment
   that element first becomes visible (same computed-opacity test as the other
   fx, so it works under the host and under the rule-6 fallback).

     data-anime="draw"   an <svg>: its strokes draw themselves on
     data-anime="count"  a number: counts up to the printed value
     data-anime="pulse"  one gentle attention pulse
     data-anime="float"  slow, endless bob (decorative marks only)

   NEVER applied to a `.step` itself: the host owns .step opacity and transform
   with !important, so the preset goes on something INSIDE the stepped wrapper
   (the <svg> in a stepped figure, the number in a stepped line).             */
const animeFx = `<script>
(function(){
  if (!document.querySelector('[data-anime]')) return;
  window.addEventListener('load', function(){
    var A = window.anime;
    if (!A || typeof A.animate !== 'function') return;      // lib missing -> silent
    var nodes = [].slice.call(document.querySelectorAll('[data-anime]'));
    var played = [];

    function visible(el){
      if (!el.offsetParent && !el.offsetHeight) return false;      // hidden page
      var n = el;
      while (n && n.nodeType === 1){
        if (parseFloat(getComputedStyle(n).opacity || '1') < 0.5) return false;
        n = n.parentElement;
      }
      return true;
    }
    function stroked(svg){
      return [].slice.call(svg.querySelectorAll('path,line,polyline,polygon,circle,ellipse,rect'))
        .filter(function(s){
          var st = getComputedStyle(s).stroke;
          return st && st !== 'none' && st !== 'rgba(0, 0, 0, 0)';
        });
    }
    function draw(el){
      var svg = el.tagName && el.tagName.toLowerCase() === 'svg' ? el : el.querySelector('svg');
      if (!svg) return;
      var items = stroked(svg).filter(function(s){
        var len = 0;
        try { len = s.getTotalLength ? s.getTotalLength() : 0; } catch (e) { len = 0; }
        if (!len) return false;
        s.style.strokeDasharray  = len + ' ' + len;
        s.style.strokeDashoffset = len;
        return true;
      });
      if (!items.length) return;
      A.animate(items, {
        strokeDashoffset: 0, duration: 850, ease: 'inOut(2)',
        delay: A.stagger ? A.stagger(70) : 0,
        onComplete: function(){
          items.forEach(function(s){ s.style.strokeDasharray = ''; s.style.strokeDashoffset = ''; });
        }
      });
    }
    function count(el){
      var text = el.textContent || '';
      var target = parseFloat(text.replace(/[^0-9.\\-]/g, ''));
      if (isNaN(target)) return;
      var tail = text.replace(/^[^0-9.\\-]*[0-9.\\-]+/, '');
      var head = (text.match(/^[^0-9.\\-]*/) || [''])[0];
      var dp = (String(target).split('.')[1] || '').length;
      var o = { v: 0 };
      A.animate(o, { v: target, duration: 900, ease: 'out(3)', onUpdate: function(){
        el.textContent = head + o.v.toFixed(dp) + tail;
      }});
    }
    function pulse(el){ A.animate(el, { scale: [1, 1.06, 1], duration: 700, ease: 'inOut(2)' }); }
    function float(el){ A.animate(el, { y: [0, -6, 0], duration: 4200, loop: true, ease: 'inOut(2)' }); }

    var presets = { draw: draw, count: count, pulse: pulse, float: float };

    function sync(){
      nodes.forEach(function(el){
        if (played.indexOf(el) !== -1 || !visible(el)) return;
        var run = presets[(el.getAttribute('data-anime') || '').trim()];
        played.push(el);
        if (!run) return;
        if (el.classList.contains('step') && run !== draw && run !== count) return;
        try { run(el); } catch (e) { /* a broken preset must never blank a slide */ }
      });
    }

    setTimeout(function(){
      sync();
      try {
        new MutationObserver(sync).observe(document.body,
          { attributes: true, subtree: true, attributeFilter: ['style', 'class'] });
      } catch (e) { /* the lf-show hook below still fires */ }
    }, 700);
    window.addEventListener('message', function(e){
      if (e && e.data && e.data.type === 'lf-show') setTimeout(sync, 40);
    });
  });
})();
</script>`;

/* ------------------------------------------------------------ three (fx) ---
   `<div class="scene-frame" data-three="globe|stars|screw-gauge">` gets a WebGL
   scene, sized to the box, initialised after load with a zero-size guard, a
   WebGL feature-detect and try/catch (rule 7). It renders BLANK in PDF export,
   so the frame must always contain a `.scene-fallback` — inline SVG or a
   sentence — which stays put and is what prints.

     data-three="globe"         wireframe sphere, slow spin
     data-three="stars"         drifting point field
     data-three="solid-angle"   sphere + pyramidal solid angle (Ω = A/r²)
     data-three="solid-angle-cone"  cone of semi-vertical angle α on a sphere
     data-three="screw-gauge"   procedural micrometer; driven by the sim engine
                                via frame.__sgUpdate when nested in [data-sim]  */
const threeFxSrc = fs.readFileSync(path.join(TOOLS, 'fx-three-runtime.js'), 'utf8')
  .replace(/<\/script/gi, '<\\/script');
const threeFx = `<!-- three.js scenes (no-op without [data-three]) -->\n<script>\n${threeFxSrc}\n</script>`;

/* ------------------------------------------------- spotlight marks (fx) ---
   `<p class="step" data-lights="q">` lights every `[data-lit~="q"]` on the same
   page the moment that step is revealed, and unlights it on the way back. Used
   by the .eq.spot statement: the class hears the definition and simultaneously
   sees the word it names catch fire.

   Visibility is read from the COMPUTED opacity, exactly like the box
   spotlight — so it works under the host's !important CSS and under the rule-6
   fallback's inline styles alike. Scripts are stripped for PDF export, where
   @media print in deck-base.css forces every mark lit instead. No-op for decks
   with no [data-lights].                                                      */
const lightsFx = `<script>
(function(){
  window.addEventListener('load', function(){
    var cues = [].slice.call(document.querySelectorAll('[data-lights]'));
    if (!cues.length) return;

    function shown(el){
      if (!el.offsetParent && !el.offsetHeight) return false;   // hidden page
      return parseFloat(getComputedStyle(el).opacity || '1') > 0.5;
    }
    function sync(){
      cues.forEach(function(cue){
        var on = shown(cue);
        var scope = cue.closest('.page') || document;
        cue.getAttribute('data-lights').split(/\\s+/).forEach(function(key){
          if (!key) return;
          var hits = scope.querySelectorAll('[data-lit~="' + key + '"]');
          for (var i = 0; i < hits.length; i++) hits[i].classList.toggle('is-lit', on);
        });
      });
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

/* --------------------------------------------------- screw gauge sim (fx) --
   `<div class="sim" data-sim="screw-gauge" data-pitch=".5" data-divisions="50">`
   turns the inline SVG the author already drew into a working micrometer, and
   — when a nested `[data-three="screw-gauge"]` scene is live — also drives the
   procedural Three.js model via `frame.__sgUpdate`.

   Authors write no JS (fragments are page sections only), so the whole rig is
   declared with data attributes:

     [data-sg-move="scale"|"jaw"]  a <g> that slides right as the jaws open;
                                   data-u = px per mm in that view
     .sg-csr-ticks                 the thimble's circular scale; data-x/-y are
                                   the tick origin, data-gap the pitch between
                                   divisions, data-span how many each side
     .sg-object                    the specimen between the jaws (width = its
                                   thickness x data-u)
     [data-act]                    a .sim-btn: obj | ze | turn | close | open
                                   | orbit | view
                                   orbit: data-yaw / data-pitch (radians)
                                   view:  data-val = reset|scales|jaws|left|right|up|down
     [data-out]                    a read-out cell the engine rewrites

   The SVG in the fragment is drawn AT THE START STATE and is complete on its
   own: scripts are stripped for PDF export (rule 11), so the printed slide
   still shows a real instrument sitting on a real, readable measurement. This
   engine only moves it. No-op for decks with no [data-sim].                  */
const simFx = `<script>
(function(){
  var rigs = [].slice.call(document.querySelectorAll('[data-sim="screw-gauge"]'));
  if (!rigs.length) return;
  window.addEventListener('load', function(){
    rigs.forEach(function(r){
      try { init(r); } catch (e) { /* a dead rig must never blank the slide */ }
    });
  });

  var NS = 'http://www.w3.org/2000/svg';
  var UI = "Calibri, Candara, 'Segoe UI', sans-serif";
  var MINUS = '−';

  function num(el, name, dflt){
    if (!el) return dflt;
    var v = parseFloat(el.getAttribute(name));
    return isNaN(v) ? dflt : v;
  }

  function init(root){
    var pitch  = num(root, 'data-pitch', 0.5);
    var divs   = Math.round(num(root, 'data-divisions', 50));
    var lc     = pitch / divs;
    var dp     = lc < 0.005 ? 3 : 2;
    var maxPos = Math.round(num(root, 'data-open-max', 6) / lc);
    var slack  = Math.round(num(root, 'data-open-gap', 1.2) / lc);

    var movers  = [].slice.call(root.querySelectorAll('[data-sg-move]'));
    var ticks   = root.querySelector('.sg-csr-ticks');
    var objRect = root.querySelector('.sg-object');
    var objTag  = root.querySelector('.sg-object-label');

    var tkX = num(ticks, 'data-x', 156);
    var tkY = num(ticks, 'data-y', 470);
    var tkG = num(ticks, 'data-gap', 22);
    var tkN = Math.round(num(ticks, 'data-span', 4));
    var objU = num(objRect, 'data-u', 40);

    var objBtns = [].slice.call(root.querySelectorAll('[data-act="obj"]'));
    var zeBtns  = [].slice.call(root.querySelectorAll('[data-act="ze"]'));

    var on0 = root.querySelector('[data-act="obj"].is-on');
    var on1 = root.querySelector('[data-act="ze"].is-on');
    var st = {
      t:    num(on0, 'data-thick', 0),
      name: (on0 && on0.getAttribute('data-name')) || '',
      ze:   Math.round(num(on1, 'data-val', 0)),
      pos:  0
    };

    function contact(){ return Math.round(st.t / lc) + st.ze; }
    function clamp(p){ return Math.max(contact(), Math.min(maxPos, p)); }
    st.pos = contact();

    function mm(v){ return (v < 0 ? MINUS : '') + Math.abs(v).toFixed(dp) + ' mm'; }
    function out(key, text){
      var cells = root.querySelectorAll('[data-out="' + key + '"]');
      for (var i = 0; i < cells.length; i++) cells[i].textContent = text;
    }
    function mark(group, hit){
      group.forEach(function(b){ b.classList.toggle('is-on', b === hit); });
    }

    function drawTicks(csr){
      if (!ticks) return;
      while (ticks.firstChild) ticks.removeChild(ticks.firstChild);
      for (var k = -tkN; k <= tkN; k++){
        var d = (((csr + k) % divs) + divs) % divs;
        var y = tkY - k * tkG;
        var major = d % 5 === 0;
        var here = k === 0;
        var ln = document.createElementNS(NS, 'line');
        ln.setAttribute('x1', tkX);
        ln.setAttribute('y1', y);
        ln.setAttribute('x2', tkX + (major || here ? 54 : 34));
        ln.setAttribute('y2', y);
        ln.setAttribute('stroke', here ? '#c0392b' : '#16202f');
        ln.setAttribute('stroke-width', here ? 5 : (major ? 4 : 2.6));
        ln.setAttribute('stroke-linecap', 'round');
        ticks.appendChild(ln);
        if (major || here){
          var tx = document.createElementNS(NS, 'text');
          tx.setAttribute('x', tkX + 66);
          tx.setAttribute('y', y + 9);
          tx.setAttribute('font-family', UI);
          tx.setAttribute('font-size', '26');
          tx.setAttribute('font-weight', '700');
          tx.setAttribute('fill', here ? '#c0392b' : '#16202f');
          tx.textContent = d;
          ticks.appendChild(tx);
        }
      }
    }

    function render(){
      var R    = st.pos * lc;                       // what the scales indicate
      var zeMm = st.ze * lc;
      var gap  = Math.max(0, R - zeMm);             // the true jaw opening
      var csr  = ((st.pos % divs) + divs) % divs;
      var msr  = R >= 0 ? Math.floor(R / pitch + 1e-9) * pitch : 0;

      movers.forEach(function(g){
        var v = g.getAttribute('data-sg-move') === 'jaw' ? gap : R;
        g.setAttribute('transform',
          'translate(' + (v * num(g, 'data-u', 58)).toFixed(2) + ',0)');
      });
      if (objRect){
        objRect.setAttribute('width', Math.max(0, st.t * objU).toFixed(2));
        objRect.setAttribute('opacity', st.t > 0 ? '1' : '0');
      }
      if (objTag){
        objTag.setAttribute('opacity', st.t > 0 ? '1' : '0');
        objTag.textContent = st.name;
      }
      drawTicks(csr);

      out('pitch', pitch.toFixed(dp) + ' mm');
      out('divs',  String(divs));
      out('lc',    mm(lc));
      out('object', st.t > 0 ? st.name : 'nothing (jaws closed)');
      out('msr',   R >= 0 ? mm(msr) : mm(0));
      out('csr',   csr + ' ' + '×' + ' ' + lc.toFixed(dp) + ' = ' + mm(csr * lc));
      out('obs',   mm(R));
      out('ze',    st.ze === 0 ? 'nil'
                 : (st.ze > 0 ? '+' : MINUS) + Math.abs(st.ze) + ' div = '
                   + (st.ze > 0 ? '+' : MINUS) + Math.abs(st.ze * lc).toFixed(dp) + ' mm');
      out('true',  mm(R - zeMm));

      var note;
      if (R < 0){
        note = 'The thimble has not even reached the main-scale zero: the circular zero sits '
             + Math.abs(st.ze) + ' divisions ABOVE the line, so the reading is '
             + MINUS + '(' + divs + ' ' + MINUS + ' ' + csr + ') ' + '×' + ' L.C.';
      } else if (st.pos > contact()){
        note = 'Jaws still open by ' + mm(gap - st.t) + ' more than the object — keep closing.';
      } else if (st.t > 0){
        note = 'The ratchet is slipping: the jaws are just gripping the ' + st.name + '.';
      } else {
        note = st.ze === 0
          ? 'Jaws closed on nothing and the scales read zero — no zero error.'
          : 'Jaws closed on nothing, yet the scales do not read zero — this IS the zero error.';
      }
      out('note', note);

      /* drive a nested Three.js micrometer, if the fragment asked for one */
      var frame3d = root.querySelector('[data-three="screw-gauge"]');
      if (frame3d && typeof frame3d.__sgUpdate === 'function'){
        try {
          frame3d.__sgUpdate({
            gap: gap,
            reading: R,
            csr: csr,
            thick: st.t,
            name: st.name || '',
            ze: st.ze,
            pitch: pitch,
            divs: divs,
            lc: lc
          });
        } catch (e) { /* 3D is decoration — never break the panel */ }
      }
    }

    function act(btn){
      var a = btn.getAttribute('data-act');
      if (a === 'obj'){
        st.t = num(btn, 'data-thick', 0);
        st.name = btn.getAttribute('data-name') || '';
        mark(objBtns, btn);
        st.pos = clamp(contact() + slack);
      } else if (a === 'ze'){
        var was = contact();
        st.ze = Math.round(num(btn, 'data-val', 0));
        mark(zeBtns, btn);
        st.pos = clamp(st.pos + (contact() - was));
      } else if (a === 'turn'){
        st.pos = clamp(st.pos + Math.round(num(btn, 'data-val', 0)));
      } else if (a === 'close'){
        st.pos = contact();
      } else if (a === 'open'){
        st.pos = clamp(contact() + slack);
      } else if (a === 'orbit' || a === 'view'){
        var frame3d = root.querySelector('[data-three="screw-gauge"]');
        if (frame3d){
          try {
            if (a === 'orbit' && typeof frame3d.__sgOrbit === 'function'){
              frame3d.__sgOrbit(num(btn, 'data-yaw', 0), num(btn, 'data-pitch', 0));
            } else if (a === 'view' && typeof frame3d.__sgView === 'function'){
              frame3d.__sgView(btn.getAttribute('data-val') || 'reset');
            }
          } catch (e) {}
        }
        return; /* view-only — do not re-render scale readouts */
      }
      render();
    }

    [].slice.call(root.querySelectorAll('[data-act]')).forEach(function(btn){
      btn.addEventListener('click', function(){ act(btn); });
    });

    root.__sgRefresh = render;
    render();
  }
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
${vendorScripts}
<!-- Box spotlight on reveal (no-op without .info-box) -->
${revealFx}

<!-- Mark spotlight on reveal (no-op without [data-lights]) -->
${lightsFx}

<!-- anime.js presets on reveal (no-op without [data-anime]) -->
${animeFx}

${threeFx}

<!-- Screw-gauge instrument (no-op without [data-sim="screw-gauge"]) -->
${simFx}

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
if (libsAsked.size) {
  console.log(`  libs  ${[...libsAsked].join(', ')} inlined, ${(vendorBytes / 1024).toFixed(0)} KB `
              + `(decoration only — blank in PDF export)`);
}
if (texCount) {
  console.log(`  latex ${texCount} converted to MathML` +
              (texFailed ? `, ${texFailed} FAILED` : '') +
              (katex ? '' : '  (katex not installed — run: npm i -D katex)'));
}
/* A declared merge folds several morph frames into one page; a declared split
   opens a two-up board into one page per question. Both are conversions, not
   losses, and validate-deck.mjs accounts for them the same way — so the build
   has to as well, or a legitimately split deck can never be assembled. */
const mergedCount = Array.isArray(manifest.merged_slides) ? manifest.merged_slides.length : 0;
const splitExtra = (Array.isArray(manifest.split_slides) ? manifest.split_slides : [])
  .reduce((a, s) => a + Math.max(0, (Number(s.into) || 2) - 1), 0);
const accounted = pageCount + mergedCount - splitExtra;
if (mergedCount || splitExtra) {
  console.log(`  count ${pageCount} pages${mergedCount ? ` + ${mergedCount} declared merge(s)` : ''}` +
              `${splitExtra ? ` - ${splitExtra} declared split page(s)` : ''} = ${accounted}`);
}
if (expected && accounted !== expected) {
  console.error(`  !! page count ${pageCount} != source slide count ${expected}` +
                (mergedCount || splitExtra ? ` (after declared merges/splits: ${accounted})` : ''));
  process.exit(2);
}
