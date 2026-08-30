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
  console.log('usage: node tools/build-deck.mjs <build/deck-slug> [--out f.html] [--title T] [--kicker K | --no-kicker]');
  process.exit(argv.length ? 0 : 1);
}
const deckDir = path.resolve(argv[0]);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
};
const has = (name) => argv.indexOf(name) !== -1;

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
/* Any empty element carrying data-tex, not just <span>. It used to be span-only,
   and a `<div class="eq" data-tex="…"></div>` then survived the build as an
   EMPTY DIV — the equation vanished from the slide with nothing in the log and
   nothing for the gate to catch, because the markup was otherwise valid. The
   guard below turns that class of mistake into a build failure.             */
body = body.replace(
  /<(span|div|p|li|td|th)([^>]*?)\bdata-tex="([^"]*)"([^>]*?)>\s*<\/\1>/g,
  (whole, tag, pre, tex, post) => {
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
      return `<${tag} ${attrs}>${mathml}</${tag}>`;
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

/* A data-tex left standing means the element was not empty, or its tag is not
   one we convert — either way the formula would ship blank or as raw LaTeX.
   Fail loudly rather than let a silent hole through the gate.               */
{
  const left = [...body.matchAll(/data-tex="([^"]*)"/g)].map((m) => m[1]);
  if (left.length) {
    console.error(`${left.length} data-tex attribute(s) were not converted — `
      + `the element must be EMPTY and one of span/div/p/li/td/th:`);
    left.slice(0, 8).forEach((t) => console.error(`  ! ${t}`));
    process.exit(1);
  }
}

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
/* `--no-kicker`, or `"kicker": false` in the manifest, ships a deck with no
   corner tag at all — a chapter the teacher runs back to back does not want
   the same chapter name burned into the top-left of every board. */
const noKicker = argv.includes('--no-kicker') || manifest.kicker === false;
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

  /* Chapter motif "power": energy leaving a source at a rate. Streamlines run
     off to the right and thin as they go — the field a turbine sits in — with
     one faint rotor low-right and a transmission span along the very bottom.
     Everything lives outside the centre and the upper-left, which is the board
     the teacher writes on. The dashes creep along the streamlines through a
     CSS animation in deck-base.css (`.motif-power`), so the flow is real
     motion but costs no script and flattens in print (rules 11, 20).        */
  power: `<svg class="motif-power" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1600 900">
    <defs>
      <linearGradient id="lf-flow-a" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#f5c542" stop-opacity="0"/>
        <stop offset="0.42" stop-color="#f5c542" stop-opacity="0.30"/>
        <stop offset="1" stop-color="#f5c542" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="lf-flow-b" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#7c8cff" stop-opacity="0"/>
        <stop offset="0.48" stop-color="#7c8cff" stop-opacity="0.26"/>
        <stop offset="1" stop-color="#7c8cff" stop-opacity="0"/>
      </linearGradient>
      <radialGradient id="lf-source" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#f5c542" stop-opacity="0.20"/>
        <stop offset="0.55" stop-color="#f5c542" stop-opacity="0.06"/>
        <stop offset="1" stop-color="#f5c542" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <!-- the source the energy leaves from, far right of the writing area -->
    <circle cx="1452" cy="404" r="250" fill="url(#lf-source)"/>
    <!-- streamlines: right half only, fanning out and thinning as they go -->
    <g class="flow" fill="none" stroke-linecap="round">
      <path d="M812 128 C1030 104 1230 118 1580 84"   stroke="url(#lf-flow-a)" stroke-width="4"   stroke-dasharray="26 34"/>
      <path d="M888 214 C1108 196 1300 214 1600 182"  stroke="url(#lf-flow-b)" stroke-width="3.2" stroke-dasharray="20 30"/>
      <path d="M840 300 C1076 288 1288 314 1600 296"  stroke="url(#lf-flow-a)" stroke-width="2.6" stroke-dasharray="30 40"/>
      <path d="M910 392 C1140 388 1330 420 1600 414"  stroke="url(#lf-flow-b)" stroke-width="3.6" stroke-dasharray="24 32"/>
      <path d="M862 482 C1096 490 1300 520 1600 530"  stroke="url(#lf-flow-a)" stroke-width="2.4" stroke-dasharray="18 28"/>
      <path d="M934 570 C1160 588 1348 620 1600 640"  stroke="url(#lf-flow-b)" stroke-width="3"   stroke-dasharray="28 38"/>
    </g>
    <!-- the rotor the flow turns: three blades, low-right, never a figure -->
    <g class="rotor" stroke="#ffffff" stroke-opacity="0.075" stroke-width="9" fill="none" stroke-linecap="round">
      <circle cx="1338" cy="716" r="132"/>
      <path d="M1338 716 L1338 596"/>
      <path d="M1338 716 L1442 776"/>
      <path d="M1338 716 L1234 776"/>
    </g>
    <circle cx="1338" cy="716" r="17" fill="#f5c542" fill-opacity="0.10"/>
    <!-- the transmission span along the very bottom edge -->
    <g stroke="#ffffff" stroke-opacity="0.055" stroke-width="2.6" fill="none">
      <path d="M0 862 C260 838 520 886 780 858 C1040 830 1300 878 1600 852"/>
      <path d="M0 884 C260 860 520 900 780 878 C1040 856 1300 898 1600 876"/>
    </g>
    <path d="M0 828 H1600" stroke="#f5c542" stroke-opacity="0.05" stroke-width="1.6" stroke-dasharray="30 52"/>
  </svg>`,

  /* Chapter motif "collision": the event itself, drawn as the two things a
     collision leaves behind — the lines of approach converging on one contact
     point, and the impact ring spreading out of it. Two faint tracks come in
     from the left and low-right and meet at a node just off the writing area;
     three concentric rings sit on that node and breathe outward through a CSS
     animation in deck-base.css (`.motif-collision`), so the board carries the
     *instant* rather than a picture of two balls. A bounce train decays along
     the bottom edge (the e-chapter's other signature), and one dashed line of
     centres crosses the node. Everything is outside the centre and the upper
     left, which is where the teacher writes; print flattens the motion.     */
  collision: `<svg class="motif-collision" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1600 900">
    <defs>
      <radialGradient id="lf-impact" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#f5c542" stop-opacity="0.22"/>
        <stop offset="0.45" stop-color="#f5c542" stop-opacity="0.07"/>
        <stop offset="1" stop-color="#f5c542" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="lf-track-a" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#f5c542" stop-opacity="0"/>
        <stop offset="0.7" stop-color="#f5c542" stop-opacity="0.26"/>
        <stop offset="1" stop-color="#f5c542" stop-opacity="0.05"/>
      </linearGradient>
      <linearGradient id="lf-track-b" x1="1" y1="1" x2="0" y2="0">
        <stop offset="0" stop-color="#7c8cff" stop-opacity="0"/>
        <stop offset="0.72" stop-color="#7c8cff" stop-opacity="0.24"/>
        <stop offset="1" stop-color="#7c8cff" stop-opacity="0.05"/>
      </linearGradient>
    </defs>
    <!-- the contact point: low-right, clear of the board -->
    <circle cx="1246" cy="556" r="300" fill="url(#lf-impact)"/>
    <!-- the impact rings breathing out of it -->
    <g class="burst" fill="none" stroke="#f5c542" stroke-linecap="round">
      <circle cx="1246" cy="556" r="96"  stroke-opacity="0.16" stroke-width="3.2"/>
      <circle cx="1246" cy="556" r="168" stroke-opacity="0.10" stroke-width="2.4" stroke-dasharray="24 30"/>
      <circle cx="1246" cy="556" r="248" stroke-opacity="0.06" stroke-width="2"   stroke-dasharray="16 42"/>
    </g>
    <circle cx="1246" cy="556" r="15" fill="#f5c542" fill-opacity="0.16"/>
    <!-- the two lines of approach, converging on that node -->
    <g fill="none" stroke-linecap="round">
      <path d="M604 556 H1150"                          stroke="url(#lf-track-a)" stroke-width="4"/>
      <path d="M1592 872 C1470 782 1360 664 1290 596"    stroke="url(#lf-track-b)" stroke-width="3.4"/>
      <path d="M700 470 C900 486 1050 512 1140 534"      stroke="url(#lf-track-a)" stroke-width="2.2" stroke-dasharray="22 30"/>
    </g>
    <!-- the line of centres through the contact point -->
    <path d="M980 754 L1512 358" stroke="#ffffff" stroke-opacity="0.055"
          stroke-width="2.2" stroke-dasharray="18 26"/>
    <!-- the bounce train: h, e²h, e⁴h … decaying along the bottom edge -->
    <g class="bounce" fill="none" stroke="#ffffff" stroke-opacity="0.06"
       stroke-width="2.6" stroke-linecap="round">
      <path d="M60 884 C112 640 214 640 266 884"/>
      <path d="M266 884 C302 726 372 726 408 884"/>
      <path d="M408 884 C432 786 480 786 504 884"/>
      <path d="M504 884 C520 824 552 824 568 884"/>
      <path d="M568 884 C578 848 600 848 610 884"/>
      <path d="M610 884 C617 862 631 862 638 884"/>
    </g>
    <path d="M0 884 H760" stroke="#f5c542" stroke-opacity="0.05" stroke-width="1.6" stroke-dasharray="30 52"/>
  </svg>`,

  /* Chapter motif "inertia": the rotational-inertia chapter's signature, which
     is the definition itself — an axis, a radius, and a mass going round. One
     spin axis stands low-right; a body's rings turn about it (CSS, so it costs
     no script and flattens in print); a single point mass rides its own orbit
     at radius r with the radius drawn to it. A rod and a disc edge sit further
     out as the two bodies the chapter keeps coming back to. Right of centre
     and below the writing band throughout — texture, never information
     (rule 11).                                                               */
  inertia: `<svg class="motif-inertia" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1600 900">
    <defs>
      <radialGradient id="lf-moi-glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#7c8cff" stop-opacity="0.16"/>
        <stop offset="0.5" stop-color="#7c8cff" stop-opacity="0.05"/>
        <stop offset="1" stop-color="#7c8cff" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="lf-moi-axis" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f5c542" stop-opacity="0"/>
        <stop offset="0.28" stop-color="#f5c542" stop-opacity="0.20"/>
        <stop offset="0.78" stop-color="#f5c542" stop-opacity="0.16"/>
        <stop offset="1" stop-color="#f5c542" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <circle cx="1210" cy="512" r="330" fill="url(#lf-moi-glow)"/>
    <!-- the spin axis the whole chapter is about -->
    <path d="M1210 86 V928" stroke="url(#lf-moi-axis)" stroke-width="3.2" stroke-linecap="round"/>
    <!-- the body: rings turning about that axis, seen in perspective -->
    <g class="spin" fill="none" stroke="#7c8cff" stroke-linecap="round">
      <ellipse cx="1210" cy="512" rx="286" ry="86" stroke-opacity="0.20" stroke-width="2.6"/>
      <ellipse cx="1210" cy="512" rx="200" ry="60" stroke-opacity="0.13" stroke-width="2.2" stroke-dasharray="26 34"/>
    </g>
    <g class="spin slow" fill="none" stroke="#7c8cff" stroke-linecap="round">
      <ellipse cx="1210" cy="512" rx="352" ry="106" stroke-opacity="0.10" stroke-width="2"   stroke-dasharray="18 46"/>
      <ellipse cx="1210" cy="512" rx="116" ry="35"  stroke-opacity="0.16" stroke-width="2.4"/>
    </g>
    <!-- one point mass on its own orbit, with r drawn out to it -->
    <g class="orbit">
      <path d="M1210 512 H1462" stroke="#f5c542" stroke-opacity="0.13"
            stroke-width="2.2" stroke-dasharray="14 20"/>
      <circle cx="1462" cy="512" r="11" fill="#f5c542" fill-opacity="0.16"/>
    </g>
    <!-- the two bodies the chapter keeps returning to, further out and faint -->
    <g class="spin rev" fill="none" stroke="#ffffff" stroke-opacity="0.055" stroke-linecap="round">
      <ellipse cx="1210" cy="512" rx="430" ry="130" stroke-width="1.8" stroke-dasharray="10 58"/>
    </g>
    <g fill="none" stroke="#ffffff" stroke-opacity="0.05" stroke-linecap="round">
      <path d="M96 848 H520" stroke-width="3"/>
      <path d="M308 806 V890" stroke-width="2.2" stroke-dasharray="12 16"/>
      <ellipse cx="742" cy="846" rx="132" ry="34" stroke-width="2.2"/>
      <path d="M742 796 V896" stroke-width="2" stroke-dasharray="12 16"/>
    </g>
  </svg>`,

  /* Chapter motif "torque": the angular-momentum / torque board's signature,
     which is the cross product itself — a pivot, an arm reaching out from it,
     a force across the end of that arm, and the answer standing on the axis
     rather than lying in the plane. The arm turns about the pivot and the
     sense-arc creeps the other way (CSS only, no script), because a torque is
     a thing that *turns* something and a still lever is only a stick. A
     balance beam rocks gently at the bottom left for the rotational-
     equilibrium half of the chapter. Right of centre and low, clear of the
     writing band — texture, never information (rule 11).                     */
  torque: `<svg class="motif-torque" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1600 900">
    <defs>
      <radialGradient id="lf-tq-glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#7c8cff" stop-opacity="0.17"/>
        <stop offset="0.55" stop-color="#7c8cff" stop-opacity="0.05"/>
        <stop offset="1" stop-color="#7c8cff" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="lf-tq-axis" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f5c542" stop-opacity="0"/>
        <stop offset="0.30" stop-color="#f5c542" stop-opacity="0.22"/>
        <stop offset="0.80" stop-color="#f5c542" stop-opacity="0.14"/>
        <stop offset="1" stop-color="#f5c542" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <circle cx="1210" cy="500" r="340" fill="url(#lf-tq-glow)"/>
    <!-- the axis the answer stands on -->
    <path d="M1210 74 V916" stroke="url(#lf-tq-axis)" stroke-width="3.4" stroke-linecap="round"/>
    <path d="M1198 128 l12 -46 l12 46 z" fill="#f5c542" fill-opacity="0.16"/>
    <!-- the plane the arm sweeps, seen edge-on -->
    <g fill="none" stroke="#7c8cff" stroke-linecap="round">
      <ellipse cx="1210" cy="500" rx="312" ry="94" stroke-opacity="0.16" stroke-width="2.4"/>
      <ellipse cx="1210" cy="500" rx="196" ry="59" stroke-opacity="0.10" stroke-width="2" stroke-dasharray="20 30"/>
    </g>
    <!-- r reaching out of the pivot, with F across its end -->
    <g class="lever" fill="none" stroke-linecap="round">
      <path d="M1210 500 H1502" stroke="#f5c542" stroke-opacity="0.20" stroke-width="3"/>
      <circle cx="1502" cy="500" r="9" fill="#f5c542" fill-opacity="0.18" stroke="none"/>
      <path d="M1502 500 V386" stroke="#ffffff" stroke-opacity="0.16" stroke-width="2.8"/>
      <path d="M1490 392 l12 -34 l12 34 z" fill="#ffffff" fill-opacity="0.16" stroke="none"/>
    </g>
    <!-- the sense it turns in -->
    <g class="turn" fill="none" stroke="#56ccf2" stroke-opacity="0.13" stroke-linecap="round">
      <path d="M1210 500 m-150 0 a150 150 0 1 1 96 140" stroke-width="2.6" stroke-dasharray="16 26"/>
    </g>
    <circle cx="1210" cy="500" r="13" fill="#7c8cff" fill-opacity="0.24"/>
    <!-- rotational equilibrium, at rest and far from the pen -->
    <g fill="none" stroke="#ffffff" stroke-opacity="0.055" stroke-linecap="round">
      <path d="M392 862 l-40 44 h80 z" stroke-width="2.4"/>
      <path d="M262 792 H150" stroke-width="2" stroke-dasharray="10 18"/>
    </g>
    <g class="beam" fill="none" stroke="#ffffff" stroke-opacity="0.06" stroke-linecap="round">
      <path d="M150 806 H634" stroke-width="3.4"/>
      <rect x="176" y="774" width="46" height="32" stroke-width="2"/>
      <rect x="566" y="784" width="30" height="22" stroke-width="2"/>
    </g>
  </svg>`,

  /* Chapter motif "conserve": the conservation-of-angular-momentum board's
     signature, which is a claim about two things changing and one thing not.
     A spin axis stands low-right carrying an L arrow that NEVER changes
     length; about that axis a body turns, and two point masses ride radii
     that draw in and go out again. The turn is keyed to the pull: the spin
     keyframes are deliberately non-linear, so the body runs slowly while the
     masses are out and fast while they are in, at roughly the ratio 1/r^2
     gives. That coupling is the whole chapter, and it costs no script — CSS
     only, flattened in @media print (rule 11). A skater's trace sits far
     bottom-left as the case the class already knows. Right of centre and low,
     clear of the writing band — texture, never information.                  */
  conserve: `<svg class="motif-conserve" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1600 900">
    <defs>
      <radialGradient id="lf-cn-glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#7c8cff" stop-opacity="0.17"/>
        <stop offset="0.55" stop-color="#7c8cff" stop-opacity="0.05"/>
        <stop offset="1" stop-color="#7c8cff" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="lf-cn-axis" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#f5c542" stop-opacity="0"/>
        <stop offset="0.30" stop-color="#f5c542" stop-opacity="0.22"/>
        <stop offset="0.80" stop-color="#f5c542" stop-opacity="0.14"/>
        <stop offset="1" stop-color="#f5c542" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <circle cx="1206" cy="508" r="336" fill="url(#lf-cn-glow)"/>
    <!-- the axis, and on it the one quantity that does not move -->
    <path d="M1206 78 V922" stroke="url(#lf-cn-axis)" stroke-width="3.4" stroke-linecap="round"/>
    <!-- the head sits where the axis gradient is actually opaque, or it floats
         alone above a line nobody can see -->
    <path d="M1194 316 l12 -48 l12 48 z" fill="#f5c542" fill-opacity="0.20"/>
    <!-- the plane it turns in, seen edge-on: scaffolding, so it never moves -->
    <g fill="none" stroke="#7c8cff" stroke-linecap="round">
      <ellipse cx="1206" cy="508" rx="318" ry="96" stroke-opacity="0.15" stroke-width="2.4"/>
      <ellipse cx="1206" cy="508" rx="188" ry="57" stroke-opacity="0.09" stroke-width="2" stroke-dasharray="20 30"/>
    </g>
    <!-- the body, turning; slow while the masses are out, fast while they are in -->
    <g class="spin" fill="none" stroke="#7c8cff" stroke-linecap="round">
      <ellipse cx="1206" cy="508" rx="252" ry="76" stroke-opacity="0.18" stroke-width="2.6" stroke-dasharray="30 44"/>
    </g>
    <!-- the two masses on radii that draw in and go out again -->
    <g class="arm">
      <path d="M1206 508 H1478" stroke="#f5c542" stroke-opacity="0.14" stroke-width="2.4" stroke-dasharray="14 20"/>
      <circle cx="1478" cy="508" r="12" fill="#f5c542" fill-opacity="0.18"/>
      <path d="M1206 508 H934" stroke="#f5c542" stroke-opacity="0.14" stroke-width="2.4" stroke-dasharray="14 20"/>
      <circle cx="934" cy="508" r="12" fill="#f5c542" fill-opacity="0.18"/>
    </g>
    <circle cx="1206" cy="508" r="13" fill="#7c8cff" fill-opacity="0.24"/>
    <!-- the case the class already knows, at rest and far from the pen -->
    <g fill="none" stroke="#ffffff" stroke-opacity="0.055" stroke-linecap="round">
      <ellipse cx="286" cy="852" rx="176" ry="30" stroke-width="2.2"/>
      <path d="M286 726 V852" stroke-width="2" stroke-dasharray="12 16"/>
      <path d="M212 782 H360" stroke-width="2.2"/>
      <path d="M556 858 H812" stroke-width="2.4" stroke-dasharray="10 26"/>
    </g>
  </svg>`,

  /* Chapter motif "gravity": the field of the earth, which is the whole of
     this chapter — g standing on the radius everywhere outside, and the same
     g dying linearly to nothing on the way in. The globe low-right carries a
     polar axis and latitude rings that TURN, because half the chapter is what
     that rotation does to g; a satellite rides its orbit around it; and the
     g-r curve is drawn once, at rest, low across the left: linear out to R,
     then 1/r-squared away from it, with the kink at the surface marked.

     The curve is the one thing on the board a student could try to read, so it
     is drawn without numbers and at texture opacity — it is a silhouette of
     the graph the deck draws properly on its own slides, never a substitute
     for it (rule 11). The spin and the orbit are CSS animations on
     `.motif-gravity .spin` / `.orbit` (no script), flattened in @media print
     and under prefers-reduced-motion.                                        */
  gravity: `<svg class="motif-gravity" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1600 900">
    <defs>
      <radialGradient id="lf-gv-glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#7c8cff" stop-opacity="0.18"/>
        <stop offset="0.55" stop-color="#7c8cff" stop-opacity="0.05"/>
        <stop offset="1" stop-color="#7c8cff" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="lf-gv-axis" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#f5c542" stop-opacity="0"/>
        <stop offset="0.18" stop-color="#f5c542" stop-opacity="0.16"/>
        <stop offset="0.86" stop-color="#f5c542" stop-opacity="0.12"/>
        <stop offset="1" stop-color="#f5c542" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <circle cx="1230" cy="470" r="430" fill="url(#lf-gv-glow)"/>
    <!-- the field: every arrow on the radius, pointing at the centre -->
    <g fill="none" stroke="#7c8cff" stroke-opacity="0.15" stroke-width="2.6" stroke-linecap="round">
      <path d="M1230 130 V214"/><path d="M1230 810 V726"/>
      <path d="M890 470 H974"/><path d="M1570 470 H1486"/>
      <path d="M990 230 L1050 290"/><path d="M1470 230 L1410 290"/>
      <path d="M990 710 L1050 650"/><path d="M1470 710 L1410 650"/>
    </g>
    <g fill="#7c8cff" fill-opacity="0.16">
      <path d="M1230 226 l-11 -26 l22 0 z"/><path d="M1230 714 l-11 26 l22 0 z"/>
      <path d="M986 470 l26 -11 l0 22 z"/><path d="M1474 470 l-26 -11 l0 22 z"/>
    </g>
    <!-- the body itself: polar axis, equator, and meridians that turn -->
    <g fill="none" stroke-linecap="round">
      <path d="M1230 218 V722" stroke="#ffffff" stroke-opacity="0.10" stroke-width="2"/>
      <circle cx="1230" cy="470" r="185" stroke="#7c8cff" stroke-opacity="0.26" stroke-width="3"/>
      <ellipse cx="1230" cy="470" rx="185" ry="52" stroke="#f5c542" stroke-opacity="0.20" stroke-width="2.4"/>
      <ellipse cx="1230" cy="384" rx="164" ry="44" stroke="#ffffff" stroke-opacity="0.07" stroke-width="1.8"/>
      <ellipse cx="1230" cy="556" rx="164" ry="44" stroke="#ffffff" stroke-opacity="0.07" stroke-width="1.8"/>
      <g class="spin">
        <ellipse cx="1230" cy="470" rx="62" ry="185" stroke="#7c8cff" stroke-opacity="0.11" stroke-width="1.8"/>
        <ellipse cx="1230" cy="470" rx="132" ry="185" stroke="#7c8cff" stroke-opacity="0.08" stroke-width="1.8"/>
        <path d="M1230 285 V655" stroke="#7c8cff" stroke-opacity="0.09" stroke-width="1.8"/>
      </g>
    </g>
    <!-- something in orbit, because g does not stop at the surface -->
    <g fill="none">
      <ellipse cx="1230" cy="470" rx="296" ry="296" stroke="#ffffff" stroke-opacity="0.05"
               stroke-width="1.6" stroke-dasharray="10 20"/>
      <g class="orbit"><circle cx="1526" cy="470" r="9" fill="#f5c542" fill-opacity="0.24" stroke="none"/></g>
    </g>
    <!-- the graph the chapter is about, at rest, well below the writing band -->
    <g fill="none" stroke-linecap="round">
      <path d="M60 852 H800" stroke="url(#lf-gv-axis)" stroke-width="2.6"/>
      <path d="M60 852 V690" stroke="#f5c542" stroke-opacity="0.10" stroke-width="2.2"/>
      <path d="M60 830 L260 700" stroke="#7c8cff" stroke-opacity="0.20" stroke-width="3"/>
      <path d="M260 700 L310 747 L360 772 L420 790 L500 803 L600 812 L700 817 L780 820"
            stroke="#f5c542" stroke-opacity="0.20" stroke-width="3"/>
      <path d="M260 700 V852" stroke="#ffffff" stroke-opacity="0.06" stroke-width="1.8" stroke-dasharray="8 14"/>
    </g>
    <circle cx="260" cy="700" r="7" fill="#f5c542" fill-opacity="0.16"/>
  </svg>`,

  /* Chapter motif "rolling": the rolling chapter's own signature, which is a
     constraint — one turn of the wheel advances it by exactly one circumference,
     so the point on the rim comes back to the ground and does not slide. The
     wheel below runs that constraint honestly: `.roll` translates by 2πR
     (691px at R = 110) in exactly the time `.spin` turns 360°, so the rim dot
     rides the cycloid drawn faintly under it and touches down at each cusp.
     A wheel turning at some unrelated rate would be a picture of slipping,
     which is the one thing the chapter says does not happen here.

     CSS only (no script), flattened in @media print and under
     prefers-reduced-motion. Low across the board and mostly right of centre,
     under the writing band — texture, never information (rule 11).           */
  rolling: `<svg class="motif-rolling" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1600 900">
    <defs>
      <radialGradient id="lf-rl-glow" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#7c8cff" stop-opacity="0.16"/>
        <stop offset="0.55" stop-color="#7c8cff" stop-opacity="0.05"/>
        <stop offset="1" stop-color="#7c8cff" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="lf-rl-ground" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#f5c542" stop-opacity="0"/>
        <stop offset="0.22" stop-color="#f5c542" stop-opacity="0.18"/>
        <stop offset="0.80" stop-color="#f5c542" stop-opacity="0.14"/>
        <stop offset="1" stop-color="#f5c542" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <circle cx="900" cy="676" r="360" fill="url(#lf-rl-glow)"/>
    <!-- the ground the constraint is written against -->
    <path d="M40 790 H1580" stroke="url(#lf-rl-ground)" stroke-width="3.2" stroke-linecap="round"/>
    <!-- the path the rim point actually takes: two cycloid arches, at rest -->
    <g fill="none" stroke="#7c8cff" stroke-opacity="0.13" stroke-width="2.4" stroke-linecap="round">
      <path d="M240 790 L240 789 L240 786 L241 782 L243 775 L245 767 L249 758 L254 747 L260 735 L268 722 L278 708 L289 694 L303 680 L318 666 L335 652 L354 638 L375 625 L398 613 L421 602 L447 593 L473 585 L500 578 L528 574 L557 571 L586 570 L614 571 L643 574 L671 578 L698 585 L725 593 L750 602 L774 613 L796 625 L817 638 L836 652 L853 666 L868 680 L882 694 L893 708 L903 722 L911 735 L918 747 L923 758 L926 767 L929 775 L930 782 L931 786 L931 789 L931 790"/>
      <path d="M931 790 L931 789 L931 786 L932 782 L934 775 L936 767 L940 758 L945 747 L951 735 L959 722 L969 708 L980 694 L994 680 L1009 666 L1026 652 L1045 638 L1066 625 L1089 613 L1112 602 L1138 593 L1164 585 L1191 578 L1219 574 L1248 571 L1277 570 L1305 571 L1334 574 L1362 578 L1389 585 L1416 593 L1441 602 L1465 613 L1487 625 L1508 638 L1527 652 L1544 666 L1559 680 L1573 694 L1584 708 L1594 722 L1602 735 L1609 747 L1614 758 L1617 767 L1620 775 L1621 782 L1622 786 L1622 789 L1622 790" stroke-opacity="0.07"/>
    </g>
    <!-- the cusps: where the rim point is instantaneously at rest -->
    <g fill="#f5c542" fill-opacity="0.13">
      <circle cx="240" cy="790" r="7"/><circle cx="931" cy="790" r="7"/><circle cx="1622" cy="790" r="7"/>
    </g>
    <!-- the wheel: advances 2πR while it turns once, so it never slips -->
    <g class="roll">
      <g class="spin" fill="none" stroke-linecap="round">
        <circle cx="240" cy="680" r="110" stroke="#7c8cff" stroke-opacity="0.22" stroke-width="3"/>
        <circle cx="240" cy="680" r="64"  stroke="#7c8cff" stroke-opacity="0.11" stroke-width="2.2" stroke-dasharray="18 26"/>
        <path d="M130 680 H350" stroke="#ffffff" stroke-opacity="0.07" stroke-width="2"/>
        <path d="M240 570 V790" stroke="#ffffff" stroke-opacity="0.07" stroke-width="2"/>
        <circle cx="240" cy="790" r="10" fill="#f5c542" fill-opacity="0.30" stroke="none"/>
      </g>
    </g>
    <!-- the two bodies the chapter keeps coming back to, at rest and far left -->
    <g fill="none" stroke="#ffffff" stroke-opacity="0.05" stroke-linecap="round">
      <circle cx="196" cy="176" r="62" stroke-width="2.4"/>
      <ellipse cx="196" cy="176" rx="62" ry="19" stroke-width="1.8" stroke-dasharray="10 16"/>
      <circle cx="382" cy="196" r="42" stroke-width="2.2"/>
      <path d="M120 262 H452" stroke-width="2" stroke-dasharray="12 22"/>
    </g>
  </svg>`,

  /* Chapter motif "fluid": the pressure / density chapter's signature is a
     column of liquid, because every board in front of it is read off one — ρ is
     what fills the column and ρgh is what the column does to its own floor.

     The tank stands low-left. Its right wall carries three normal arrows that
     get longer with depth, which is the whole of ρgh and also the whole of
     "pressure pushes square-on to the surface". Those arrows are deliberately
     at REST: they describe a standing column, and an arrow that breathes reads
     as a pressure that is changing. What moves is what a liquid really does —
     the free surface swells (`.swell`) and a bubble train rises through the
     column (`.rise`).

     Low-right, the second half of the chapter: the earth's limb with air layers
     that thin upward, and a pale P–h curve falling away from the ground. The
     curve does not move — it is a graph, and a graph that drifts reads as a
     measurement changing (same reasoning as the gravity motif).

     CSS only, flattened in @media print and under prefers-reduced-motion, and
     kept out of the band the teacher writes in — texture, never information.  */
  fluid: `<svg class="motif-fluid" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1600 900">
    <defs>
      <linearGradient id="lf-fl-col" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#7c8cff" stop-opacity="0.05"/>
        <stop offset="1" stop-color="#7c8cff" stop-opacity="0.20"/>
      </linearGradient>
      <linearGradient id="lf-fl-air" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stop-color="#56ccf2" stop-opacity="0.15"/>
        <stop offset="1" stop-color="#56ccf2" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="lf-fl-floor" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#f5c542" stop-opacity="0"/>
        <stop offset="0.2" stop-color="#f5c542" stop-opacity="0.20"/>
        <stop offset="0.82" stop-color="#f5c542" stop-opacity="0.15"/>
        <stop offset="1" stop-color="#f5c542" stop-opacity="0"/>
      </linearGradient>
      <clipPath id="lf-fl-tank"><rect x="132" y="472" width="392" height="336"/></clipPath>
    </defs>

    <!-- the atmosphere, low-right: layers that thin upward off the limb -->
    <g clip-path="none">
      <path d="M980 900 A 720 720 0 0 1 1600 372 L1600 900 Z" fill="url(#lf-fl-air)"/>
      <g fill="none" stroke="#56ccf2" stroke-linecap="round">
        <path d="M1010 900 A 660 660 0 0 1 1600 452" stroke-opacity="0.13" stroke-width="2.6"/>
        <path d="M1058 900 A 560 560 0 0 1 1600 546" stroke-opacity="0.10" stroke-width="2.2"/>
        <path d="M1112 900 A 452 452 0 0 1 1600 640" stroke-opacity="0.07" stroke-width="2"/>
        <path d="M1176 900 A 340 340 0 0 1 1600 730" stroke-opacity="0.05" stroke-width="1.8"/>
      </g>
      <!-- air molecules: crowded at the ground, sparse aloft. A statement, at rest. -->
      <g fill="#ffffff">
        <g fill-opacity="0.10">
          <circle cx="1218" cy="866" r="4"/><circle cx="1302" cy="884" r="4"/>
          <circle cx="1382" cy="852" r="4"/><circle cx="1466" cy="878" r="4"/>
          <circle cx="1540" cy="846" r="4"/><circle cx="1256" cy="812" r="4"/>
          <circle cx="1350" cy="800" r="4"/><circle cx="1444" cy="818" r="4"/>
          <circle cx="1528" cy="786" r="4"/>
        </g>
        <g fill-opacity="0.07">
          <circle cx="1288" cy="726" r="3.4"/><circle cx="1402" cy="700" r="3.4"/>
          <circle cx="1512" cy="718" r="3.4"/><circle cx="1346" cy="642" r="3.4"/>
          <circle cx="1478" cy="620" r="3.4"/>
        </g>
        <g fill-opacity="0.045">
          <circle cx="1420" cy="536" r="3"/><circle cx="1544" cy="504" r="3"/>
          <circle cx="1486" cy="430" r="3"/>
        </g>
      </g>
      <!-- P against height: falls away from the ground and never reaches zero -->
      <g fill="none" stroke="#f5c542" stroke-linecap="round">
        <path d="M1104 852 V 470" stroke-opacity="0.10" stroke-width="2.2"/>
        <path d="M1104 852 H 1470" stroke-opacity="0.10" stroke-width="2.2"/>
        <path d="M1104 852 C 1150 852 1186 800 1214 716 C 1244 626 1272 546 1330 508 C 1382 476 1428 470 1466 468"
              stroke-opacity="0.16" stroke-width="3" transform="rotate(-90 1104 852)"/>
      </g>
    </g>

    <!-- the column: what ρ fills and what ρgh presses on -->
    <g clip-path="url(#lf-fl-tank)">
      <rect x="132" y="512" width="392" height="296" fill="url(#lf-fl-col)"/>
      <!-- the free surface, swelling -->
      <g class="swell">
        <path d="M36 512 q48 -13 96 0 t96 0 t96 0 t96 0 t96 0 t96 0 t96 0"
              fill="none" stroke="#7c8cff" stroke-opacity="0.28" stroke-width="3.2" stroke-linecap="round"/>
        <path d="M36 526 q48 -11 96 0 t96 0 t96 0 t96 0 t96 0 t96 0 t96 0"
              fill="none" stroke="#7c8cff" stroke-opacity="0.10" stroke-width="2.2" stroke-linecap="round"/>
      </g>
      <!-- a bubble train rising through it -->
      <g class="rise" fill="none" stroke="#ffffff" stroke-opacity="0.16" stroke-width="1.8">
        <circle cx="212" cy="792" r="7"/>
        <circle cx="318" cy="800" r="5"/>
        <circle cx="398" cy="786" r="9"/>
        <circle cx="470" cy="798" r="6"/>
      </g>
    </g>
    <!-- the vessel itself, and the floor the column stands on -->
    <g fill="none" stroke="#ffffff" stroke-opacity="0.09" stroke-width="3" stroke-linecap="round">
      <path d="M132 452 V808 H524 V452"/>
    </g>
    <path d="M60 812 H600" stroke="url(#lf-fl-floor)" stroke-width="3.2" stroke-linecap="round"/>
    <!-- normal arrows on the wall: square-on, and longer the deeper they are -->
    <g stroke="#f5c542" stroke-opacity="0.20" stroke-width="2.6" stroke-linecap="round">
      <path d="M524 576 H 566"/><path d="M524 668 H 590"/><path d="M524 764 H 626"/>
    </g>
    <g fill="#f5c542" fill-opacity="0.20">
      <path d="M566 568 l20 8 l-20 8 z"/>
      <path d="M590 660 l20 8 l-20 8 z"/>
      <path d="M626 756 l20 8 l-20 8 z"/>
    </g>
    <!-- h, marked once down the inside of the wall -->
    <g stroke="#7c8cff" stroke-opacity="0.14" stroke-width="2" stroke-linecap="round">
      <path d="M172 520 V800" stroke-dasharray="12 18"/>
    </g>
  </svg>`,

  solid: `<svg class="motif-solid" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1600 900">
    <defs>
      <linearGradient id="lf-sd-pullgrad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#f5c542" stop-opacity="0"/>
        <stop offset="0.5" stop-color="#f5c542" stop-opacity="0.22"/>
        <stop offset="1" stop-color="#f5c542" stop-opacity="0.05"/>
      </linearGradient>
      <linearGradient id="lf-sd-curve" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stop-color="#7c8cff" stop-opacity="0.05"/>
        <stop offset="0.42" stop-color="#7c8cff" stop-opacity="0.26"/>
        <stop offset="1" stop-color="#f5c542" stop-opacity="0.18"/>
      </linearGradient>
      <linearGradient id="lf-sd-elastic" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#7c8cff" stop-opacity="0.07"/>
        <stop offset="1" stop-color="#7c8cff" stop-opacity="0"/>
      </linearGradient>
    </defs>

    <!-- The lattice, low-left: the solid itself, held at the wall and pulled.
         Bonds are the springs every modulus in this chapter is an average of,
         so the whole block strains along x and springs back. -->
    <g class="strain">
      <g stroke="#7c8cff" stroke-opacity="0.16" stroke-width="2.4" stroke-linecap="round">
        <!-- rows -->
        <path d="M110 530 H 550"/><path d="M110 630 H 550"/>
        <path d="M110 730 H 550"/><path d="M110 830 H 550"/>
        <!-- columns -->
        <path d="M110 530 V 830"/><path d="M198 530 V 830"/><path d="M286 530 V 830"/>
        <path d="M374 530 V 830"/><path d="M462 530 V 830"/><path d="M550 530 V 830"/>
      </g>
      <!-- the diagonals: what makes a solid keep its SHAPE, not just its size -->
      <g stroke="#7c8cff" stroke-opacity="0.06" stroke-width="1.6">
        <path d="M110 630 L 198 530"/><path d="M198 730 L 286 630"/>
        <path d="M286 830 L 374 730"/><path d="M374 630 L 462 530"/>
        <path d="M462 730 L 550 630"/>
      </g>
      <g fill="#ffffff" fill-opacity="0.13">
        <circle cx="110" cy="530" r="6"/><circle cx="198" cy="530" r="6"/><circle cx="286" cy="530" r="6"/>
        <circle cx="374" cy="530" r="6"/><circle cx="462" cy="530" r="6"/><circle cx="550" cy="530" r="6"/>
        <circle cx="110" cy="630" r="6"/><circle cx="198" cy="630" r="6"/><circle cx="286" cy="630" r="6"/>
        <circle cx="374" cy="630" r="6"/><circle cx="462" cy="630" r="6"/><circle cx="550" cy="630" r="6"/>
        <circle cx="110" cy="730" r="6"/><circle cx="198" cy="730" r="6"/><circle cx="286" cy="730" r="6"/>
        <circle cx="374" cy="730" r="6"/><circle cx="462" cy="730" r="6"/><circle cx="550" cy="730" r="6"/>
        <circle cx="110" cy="830" r="6"/><circle cx="198" cy="830" r="6"/><circle cx="286" cy="830" r="6"/>
        <circle cx="374" cy="830" r="6"/><circle cx="462" cy="830" r="6"/><circle cx="550" cy="830" r="6"/>
      </g>
    </g>

    <!-- the wall the block is held against: the reason the pull becomes strain -->
    <g stroke="#ffffff" stroke-opacity="0.09" stroke-width="2.6" stroke-linecap="round">
      <path d="M84 496 V 864"/>
      <path d="M84 512 l-26 -22"/><path d="M84 568 l-26 -22"/><path d="M84 624 l-26 -22"/>
      <path d="M84 680 l-26 -22"/><path d="M84 736 l-26 -22"/><path d="M84 792 l-26 -22"/>
      <path d="M84 848 l-26 -22"/>
    </g>

    <!-- F/A, applied to the free face and riding out with it -->
    <g class="pull">
      <path d="M578 630 H 700" stroke="url(#lf-sd-pullgrad)" stroke-width="3.4" stroke-linecap="round"/>
      <path d="M578 730 H 700" stroke="url(#lf-sd-pullgrad)" stroke-width="3.4" stroke-linecap="round"/>
      <g fill="#f5c542" fill-opacity="0.18">
        <path d="M700 621 l24 9 l-24 9 z"/>
        <path d="M700 721 l24 9 l-24 9 z"/>
      </g>
    </g>

    <!-- Stress against strain, low-right: the one curve the whole chapter is
         read off. It does NOT move — a graph that drifts reads as a
         measurement changing. -->
    <g stroke="#f5c542" stroke-opacity="0.12" stroke-width="2.4" stroke-linecap="round">
      <path d="M1030 838 V 452"/>
      <path d="M1030 838 H 1540"/>
    </g>
    <path d="M1030 838 L 1186 596 L 1188 838 Z" fill="url(#lf-sd-elastic)"/>
    <path d="M1030 838 L 1186 596 C 1240 528 1290 506 1352 502 C 1410 498 1444 512 1470 540"
          fill="none" stroke="url(#lf-sd-curve)" stroke-width="3.4" stroke-linecap="round"/>
    <!-- the proportional limit, marked once and left alone -->
    <g stroke="#7c8cff" stroke-opacity="0.10" stroke-width="1.8" stroke-dasharray="10 14">
      <path d="M1186 596 V 838"/>
    </g>
    <g stroke="#ffffff" stroke-opacity="0.13" stroke-width="2.6" stroke-linecap="round">
      <path d="M1458 528 l24 24"/><path d="M1482 528 l-24 24"/>
    </g>
  </svg>`,

}[motif] || null;

if (!motifSvg) {
  console.error(`unknown motif "${motif}" — expected one of: hex, graph, rail, well, power, collision, inertia, torque, conserve, rolling, gravity, fluid, solid`);
  process.exit(1);
}

/* ------------------------------------------ persistent WebGL backdrop -----
   A motif may ask for a 3D companion layer: a canvas sibling of .page, behind
   the motif SVG, carrying slowly turning wireframe bodies. It is decoration in
   the strict sense of rule 11 — scripts are stripped for PDF export and a room
   with no GPU never sees it, so the SVG motif above is the real backdrop and
   this only adds depth. Opt in with manifest "bg_scene": true (implied by the
   "inertia" motif) and off with --no-bg-scene.                               */
const bgScene = has('--no-bg-scene')
  ? null
  : (flag('--bg-scene') || manifest.bg_scene
     || ((motif === 'inertia' || motif === 'torque' || motif === 'conserve'
          || motif === 'rolling') ? 'inertia'
         : (motif === 'gravity' ? 'gravity'
         : (motif === 'fluid' ? 'fluid'
         : (motif === 'solid' ? 'solid' : null)))));
const bgSceneName = bgScene === true ? 'inertia' : bgScene;

const persistentLayers = `<div id="bg" aria-hidden="true">${bgSceneName ? `
  <canvas class="bg-scene" data-bg-scene="${esc(bgSceneName)}"></canvas>` : ''}
  ${motifSvg}
</div>${noKicker ? '' : `
<div class="kicker-tag">${esc(kicker)}</div>`}`;

/* The runtime for that canvas. Self-contained, no-op when the canvas is
   absent, when three.js failed to inline, or when WebGL is unavailable; it
   guards a zero-size canvas by waiting a frame, re-sizes on resize, and it
   stops rendering while the tab is hidden. Nothing on a slide depends on it
   (rules 7, 11, 20).                                                         */
const bgSceneFx = !bgSceneName ? '' : `<script>
(function(){
  var cv = document.querySelector('canvas.bg-scene');
  if (!cv) return;
  var SCENE = (cv.getAttribute('data-bg-scene') || 'inertia').trim();
  window.addEventListener('load', function(){
    var T = window.THREE;
    if (!T || !T.WebGLRenderer) return;                       // lib missing -> silent
    var reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    function start(){
      var w = cv.clientWidth, h = cv.clientHeight;
      if (!w || !h) { requestAnimationFrame(start); return; } // zero-size guard
      var renderer;
      try {
        renderer = new T.WebGLRenderer({ canvas: cv, alpha: true, antialias: true });
      } catch (e) { return; }                                 // no WebGL -> silent
      try {
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(w, h, false);

        var scene  = new T.Scene();
        var camera = new T.PerspectiveCamera(42, w / h, 0.1, 200);
        camera.position.set(0, 3.4, 26);
        camera.lookAt(0, 0, 0);

        var INDIGO = 0x7c8cff, GOLD = 0xf5c542;
        function mat(c, o){
          return new T.LineBasicMaterial({ color: c, transparent: true, opacity: o });
        }
        function wire(geo, c, o){
          return new T.LineSegments(new T.WireframeGeometry(geo), mat(c, o));
        }

        /* The four bodies the chapter is built on. Each turns about ITS OWN
           axis, because that is the only thing the picture has to say. They
           live right of centre and low, clear of the writing area.          */
        var bodies = [];
        function add(obj, pos, spin, tilt){
          obj.position.set(pos[0], pos[1], pos[2]);
          obj.rotation.x = tilt;
          scene.add(obj);
          bodies.push({ o: obj, s: spin });
        }
        if (SCENE === 'gravity'){
          /* The gravitation chapter's bodies: the earth itself, the ring its
             satellite runs on, and two smaller spheres further out. Each turns
             about its own axis; the ring is laid flat around the earth so the
             backdrop reads as a body with something going round it, which is
             what every board in front of it is about.                       */
          add(wire(new T.SphereGeometry(4.2, 26, 16), INDIGO, 0.20),
              [14.0, -2.6, -12], 0.06, 0);                                   // earth
          add(wire(new T.TorusGeometry(6.6, 0.06, 5, 72), GOLD, 0.13),
              [14.0, -2.6, -12], 0.10, Math.PI / 2 - 0.34);                  // orbit
          add(wire(new T.SphereGeometry(1.5, 14, 10), INDIGO, 0.13),
              [-13.5, -6.4, -15], 0.09, 0);                                  // moon
          add(wire(new T.SphereGeometry(2.1, 16, 10), INDIGO, 0.10),
              [-1.5, -9.4, -18], 0.05, 0);                                   // far body
        } else if (SCENE === 'solid'){
          /* The elasticity chapter's bodies, and each one is a slide in this
             deck: the rod a tension is applied along, the cylinder a torque
             twists, the lattice cube every modulus is an average over, and the
             beam that sags. Each turns about its own axis; none of them means
             anything — the motif SVG is the real backdrop and this is only
             depth behind it (rules 7, 11, 20).                              */
          add(wire(new T.CylinderGeometry(0.9, 0.9, 9.0, 20, 1), INDIGO, 0.20),
              [-13.4, -4.4, -13], 0.10, Math.PI / 2 - 0.30);                   // the rod under tension
          add(wire(new T.BoxGeometry(4.6, 4.6, 4.6, 3, 3, 3), INDIGO, 0.15),
              [14.2, -3.2, -13], 0.06, 0.42);                                  // the lattice cell
          add(wire(new T.CylinderGeometry(1.8, 1.8, 4.4, 22, 3), GOLD, 0.12),
              [-1.6, -9.2, -12], 0.13, 0.24);                                  // the twisted shaft
          add(wire(new T.TorusGeometry(6.2, 0.10, 4, 40, 1.15), INDIGO, 0.09),
              [15.0, -8.8, -16], 0.04, Math.PI / 2 - 0.10);                    // the sagging beam
        } else if (SCENE === 'fluid'){
          /* The pressure / density chapter's bodies. A tall wireframe cylinder
             is the liquid column ρgh is written about; the flat plate is the
             area a thrust is divided by; the sphere is the envelope of air the
             atmospheric half of the chapter is about. Each turns about its own
             axis and none of them means anything — the motif SVG is the real
             backdrop and this is only depth behind it (rules 7, 11, 20).     */
          add(wire(new T.CylinderGeometry(2.4, 2.4, 6.6, 26, 1), INDIGO, 0.22),
              [-13.2, -4.6, -13], 0.09, 0.08);                               // liquid column
          add(wire(new T.BoxGeometry(6.8, 0.18, 6.8, 3, 1, 3), GOLD, 0.13),
              [-1.8, -9.0, -11], 0.07, 0.30);                                // the area
          add(wire(new T.SphereGeometry(4.0, 24, 14), INDIGO, 0.16),
              [14.2, -3.0, -13], 0.05, 0);                                   // air envelope
          add(wire(new T.SphereGeometry(5.4, 20, 12), INDIGO, 0.07),
              [14.2, -3.0, -13], 0.03, 0);                                   // its outer shell
        } else {
        add(wire(new T.TorusGeometry(3.1, 0.10, 6, 64), INDIGO, 0.30),
            [13.5, -1.4, -10], 0.16, Math.PI / 2 - 0.42);                    // ring
        add(wire(new T.CylinderGeometry(2.5, 2.5, 0.34, 34, 1), INDIGO, 0.22),
            [-13.0, -5.2, -14], 0.11, 0.40);                                 // disc
        add(wire(new T.BoxGeometry(7.4, 0.26, 0.26), GOLD, 0.16),
            [-2.0, -8.6, -9], 0.09, 0.22);                                   // rod
        add(wire(new T.SphereGeometry(2.4, 18, 12), INDIGO, 0.15),
            [15.5, -8.4, -16], 0.07, 0);                                     // shell
        }

        function resize(){
          var nw = cv.clientWidth, nh = cv.clientHeight;
          if (!nw || !nh) return;
          camera.aspect = nw / nh; camera.updateProjectionMatrix();
          renderer.setSize(nw, nh, false);
        }
        window.addEventListener('resize', resize);

        var t0 = performance.now();
        function frame(now){
          requestAnimationFrame(frame);
          if (document.hidden) return;
          var dt = Math.min((now - t0) / 1000, 0.05); t0 = now;
          if (!reduce){
            for (var i = 0; i < bodies.length; i++) bodies[i].o.rotation.y += bodies[i].s * dt;
            camera.position.x = Math.sin(now / 24000) * 1.5;
            camera.lookAt(0, 0, 0);
          }
          renderer.render(scene, camera);
        }
        requestAnimationFrame(frame);
      } catch (e) { /* a broken backdrop must never blank a slide */ }
    }
    start();
  });
})();
</script>`;

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
if (bgSceneName) libsAsked.add('three');       // the persistent WebGL backdrop

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

<!-- Persistent WebGL backdrop (no-op without canvas.bg-scene) -->
${bgSceneFx}

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
