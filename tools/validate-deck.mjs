#!/usr/bin/env node
/**
 * QA gate.  Every rule that a tired model silently drops is checked here,
 * mechanically, on every deck.
 *
 *   node tools/validate-deck.mjs <deck.html> [--expect 47] [--manifest build/x/manifest.json]
 *   node tools/validate-deck.mjs "path/to/html_files/*.html"      # glob / folder
 *   node tools/validate-deck.mjs <deck.html> --json
 *
 * Exit 0 = pass (warnings allowed), 1 = at least one ERROR.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const MAX_KB = 800;             // above this a deck is dumping slide screenshots
const MIN_STEPS_PER_PAGE = 2.0; // measured over CONTENT pages only (see below)
const GALLERY_RATIO = 0.5;      // images per page at which it's a screenshot gallery
const IMG_SHARE_WARN = 0.60;    // base64 share that's worth a look, not a failure

/* Pages that legitimately have nothing to reveal — a section divider or a
   full-bleed photo hook. Counting these in the step-density average punishes
   decks for having title slides, so they're excluded from the denominator. */
function isContentPage(html) {
  const hasTitleOnly = /class="[^"]*\bwrap[^"]*\bcenter\b/.test(html)
    && !/<(?:p|li|td|table|div class="g-row")/.test(html);
  const bodyish = (html.match(/<(?:p|li|td|h3|div class="(?:eq|line|option|callout))/g) || []).length;
  return !hasTitleOnly && bodyish > 0;
}

/* ------------------------------------------------------------------ args -- */
const argv = process.argv.slice(2);
if (!argv.length || argv.includes('--help')) {
  console.log('usage: node tools/validate-deck.mjs <deck.html|folder> [--expect N] [--manifest m.json] [--json]');
  process.exit(argv.length ? 0 : 1);
}
const asJson = argv.includes('--json');
const flag = (n) => { const i = argv.indexOf(n); return i !== -1 && argv[i + 1] ? argv[i + 1] : null; };
const expectFlag = flag('--expect') ? parseInt(flag('--expect'), 10) : null;
const manifestFlag = flag('--manifest');

const inputs = argv.filter((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--expect'
  && argv[argv.indexOf(a) - 1] !== '--manifest');

const files = [];
for (const inp of inputs) {
  const p = path.resolve(inp);
  if (!fs.existsSync(p)) { console.error(`not found: ${inp}`); continue; }
  if (fs.statSync(p).isDirectory()) {
    for (const f of fs.readdirSync(p)) if (f.endsWith('.html')) files.push(path.join(p, f));
  } else files.push(p);
}
if (!files.length) { console.error('no html files to check'); process.exit(1); }

/* ------------------------------------------------------------- the rules -- */
function validate(file) {
  const src = fs.readFileSync(file, 'utf8');
  const bytes = Buffer.byteLength(src, 'utf8');
  const errors = [];
  const warnings = [];
  const E = (m) => errors.push(m);
  const W = (m) => warnings.push(m);

  /* -- structure (rule 1, 8) -------------------------------------------- */
  const pages = (src.match(/<section[^>]*class="[^"]*\bpage\b/g) || []).length;
  if (!pages) E('no <section class="page"> blocks');

  const styleBlock = (src.match(/<style[\s\S]*?<\/style>/gi) || []).join('\n');
  if (/\.page[^{}]*\{[^}]*(display\s*:\s*none|opacity\s*:\s*0(?!\.)|visibility\s*:\s*hidden)/i.test(styleBlock))
    E('CSS hides .page — deck renders blank outside the host (rule 1)');

  if (/\.step[^{}]*\{[^}]*(opacity\s*:\s*0(?!\.)|visibility\s*:\s*hidden)/i.test(styleBlock)
      && !/@media\s+print/i.test(styleBlock.match(/\.step[^{}]*\{[^}]*\}/i)?.[0] || ''))
    W('CSS sets opacity/visibility on .step — the host controls those (rule 4)');

  if (!/html\s*,\s*body\s*\{[^}]*height\s*:\s*100%/i.test(styleBlock))
    E('missing html,body{height:100%} (rule 8)');

  /* -- fallback controller (rule 6) ------------------------------------- */
  if (!src.includes('__lf-ctl'))
    E('standalone fallback controller missing — file is blank when previewed (rule 6)');

  /* -- sandbox constraints (rule 2, 3) ---------------------------------- */
  const banned = [
    [/\blocalStorage\b/, 'localStorage'], [/\bsessionStorage\b/, 'sessionStorage'],
    [/\bindexedDB\b/i, 'indexedDB'], [/document\.cookie/, 'document.cookie'],
    [/\balert\s*\(/, 'alert()'], [/\bconfirm\s*\(/, 'confirm()'],
    [/\bwindow\.open\s*\(/, 'window.open()'], [/<form\b/i, '<form>'],
    [/<input\b/i, '<input>'], [/<textarea\b/i, '<textarea>'], [/<select\b/i, '<select>'],
  ];
  for (const [re, name] of banned) if (re.test(src)) E(`uses ${name} — blocked in the sandboxed iframe (rules 2, 3)`);

  /* -- reserved names (rule 12) ----------------------------------------- */
  const lfNames = src.match(/(?:class|id)="[^"]*__lf-(?!ctl)[\w-]+/g);
  if (lfNames) E(`uses reserved __lf- name: ${lfNames[0]}`);
  if (/postMessage\s*\(\s*\{\s*type\s*:\s*['"]lf-/.test(src)) E('postMessages a reserved lf- type (rule 12)');

  /* -- external / local assets (rule 2) --------------------------------- */
  const relAssets = (src.match(/(?:src|href)="(?!https?:|data:|#|mailto:)[^"]+"/g) || [])
    .filter((s) => !/xmlns/.test(s));
  if (relAssets.length) E(`local/relative asset path — the file ships alone: ${relAssets[0]}`);

  const cdn = (src.match(/<script[^>]+src="https?:\/\/[^"]+"/g) || []);
  if (cdn.length) E(`loads a CDN script (${cdn[0].match(/https?:\/\/[^/]+/)[0]}) — scripts are STRIPPED in PDF export, so anything it renders comes out blank (rule 11)`);
  if (/<link[^>]+href="https?:/i.test(src)) W('loads an external stylesheet — fails with no classroom network (rule 2)');
  if (/MathJax/i.test(src)) E('MathJax present — equations will be blank in PDF export; pre-render with data-tex instead (rule 11)');

  /* -- size / screenshot dumping ---------------------------------------- */
  const b64 = src.match(/data:image\/\w+;base64,([A-Za-z0-9+/=]+)/g) || [];
  const b64Bytes = b64.reduce((a, s) => a + s.length, 0);
  const share = bytes ? b64Bytes / bytes : 0;
  const kb = bytes / 1024;
  if (kb > MAX_KB) E(`${kb.toFixed(0)} KB exceeds the ${MAX_KB} KB budget — almost always embedded slide screenshots`);

  /* The gallery signal is images-PER-PAGE, not byte share: a handful of genuine
     photographs in a long deck is fine, one image on every page is a paste-up.
     Byte share alone punishes a deck for having a few high-res photos. */
  if (pages && b64.length >= pages * GALLERY_RATIO && b64.length > 3)
    E(`${b64.length} images across ${pages} pages — roughly one per slide, so this is a screenshot gallery, not a conversion`);
  else if (share > IMG_SHARE_WARN)
    W(`${(share * 100).toFixed(0)}% of the file is base64 (${b64.length} image(s) / ${pages} pages) — fine if these are genuine photographs, not if they are slide captures`);

  /* -- stepping (rules 16, 17) ------------------------------------------ */
  const steps = (src.match(/class="[^"]*\bstep\b/g) || []).length;
  const pageBlocks = src.match(/<section[^>]*class="[^"]*\bpage\b[\s\S]*?<\/section>/g) || [];
  const contentPages = pageBlocks.filter(isContentPage);
  const nContent = contentPages.length || pages;
  const perPage = nContent ? steps / nContent : 0;

  if (nContent && perPage < MIN_STEPS_PER_PAGE)
    E(`only ${steps} steps across ${nContent} content pages (${perPage.toFixed(1)}/page) — content is being dumped whole (rule 16)`);

  /* A content page with no reveal at all is nearly always an oversight. */
  const flat = contentPages
    .map((p, i) => [i, (p.match(/class="[^"]*\bstep\b/g) || []).length])
    .filter(([, n]) => n === 0);
  if (flat.length)
    E(`${flat.length} content page(s) have no .step at all — everything appears at once (rule 16)`);

  if (/<tr[^>]*class="[^"]*\bstep\b/.test(src))
    E('a <tr> carries .step — this project steps each <td> instead (rule 17)');

  for (const row of src.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g) || []) {
    if (/<th\b/.test(row)) continue;
    const firstCell = row.match(/<td\b[^>]*>/);
    if (firstCell && /\bstep\b/.test(firstCell[0]))
      { E("a row's first cell is stepped — label cells stay visible as row headers (rule 17)"); break; }
  }

  /* -- label / definition pairing (rule 17) ------------------------------ */
  for (const gr of src.match(/<div[^>]*class="[^"]*\bg-row\b[^"]*"[\s\S]*?<\/div>/g) || []) {
    const label = gr.match(/class="[^"]*\blabel\b[^"]*"/);
    if (label && /\bstep\b/.test(label[0]))
      { E('a .label is stepped — term and definition must not reveal together (rule 17)'); break; }
  }
  for (const q of src.match(/class="[^"]*\bq\b[^"]*"/g) || []) {
    if (/\bstep\b/.test(q)) { E('a question (.q) is stepped — questions stay visible, answers step (rule 17)'); break; }
  }

  /* -- branding (rule 17) ------------------------------------------------ */
  if (/class="[^"]*(logo|brand|watermark|badge-pw)/i.test(src)) E('a logo / brand element is present (rule 17)');

  /* -- interactivity (rule 3) -------------------------------------------- */
  const handlers = (src.match(/<[^>]+onclick=/g) || []);
  const unclickable = handlers.filter((h) => !/\bclickable\b/.test(h));
  if (unclickable.length) E(`${unclickable.length} onclick handler(s) not marked class="clickable" — clicks never reach them (rule 3)`);
  if (/:hover[^{]*\{[^}]*(display|visibility|opacity)/.test(styleBlock))
    W(':hover controls visibility — hover never fires during teaching (rule 3)');

  /* -- print block (rule 11) --------------------------------------------- */
  if (!/@media\s+print/i.test(styleBlock)) E('no @media print block — PDF export will show unrevealed steps (rule 11)');

  /* -- design system drift ----------------------------------------------- */
  const inlineStyles = (src.match(/\sstyle="[^"]*"/g) || []).length;
  if (inlineStyles > pages) W(`${inlineStyles} inline style attributes across ${pages} pages — should live in deck-base.css`);
  const styleBlocks = (src.match(/<style/gi) || []).length;
  if (styleBlocks > 1) W(`${styleBlocks} <style> blocks — the design system expects exactly one`);

  /* -- slide count of record --------------------------------------------- */
  let expected = expectFlag;
  if (!expected && manifestFlag && fs.existsSync(manifestFlag))
    expected = JSON.parse(fs.readFileSync(manifestFlag, 'utf8')).slide_count;
  if (expected && pages !== expected)
    E(`${pages} pages but the source deck has ${expected} slides — ${expected - pages} lost`);

  return {
    file: path.basename(file),
    pages, contentPages: nContent, steps, kb: +kb.toFixed(0),
    images: b64.length, imgShare: +(share * 100).toFixed(0),
    stepsPerPage: +perPage.toFixed(1),
    errors, warnings,
    pass: errors.length === 0,
  };
}

/* ---------------------------------------------------------------- report -- */
const results = files.map(validate);

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const r of results) {
    const mark = r.pass ? (r.warnings.length ? 'WARN' : 'PASS') : 'FAIL';
    console.log(`\n${mark}  ${r.file}`);
    console.log(`      ${r.pages} pages (${r.contentPages} content) · ${r.steps} steps ` +
                `(${r.stepsPerPage}/content page) · ${r.kb} KB · ${r.images} images (${r.imgShare}%)`);
    for (const e of r.errors) console.log(`      ERROR  ${e}`);
    for (const w of r.warnings) console.log(`      warn   ${w}`);
  }
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
}

process.exit(results.some((r) => !r.pass) ? 1 : 0);
