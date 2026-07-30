#!/usr/bin/env node
/**
 * Vendor bundler — turns the npm packages into single, script-tag-able files
 * that tools/build-deck.mjs can INLINE into a deck.
 *
 *   node tools/make-vendor.mjs
 *
 * Why this exists: a deck is one self-contained .html that runs in
 * `<iframe sandbox="allow-scripts">` with no network guarantee, and rule 11 of
 * public/deck-authoring-prompt.md forbids CDN scripts (they are stripped on PDF
 * export, and the classroom may be offline). So every library ships INLINE.
 *
 *   animejs  → tools/vendor/anime.umd.min.js   (already a UMD bundle, copied)
 *   three    → tools/vendor/three.iife.min.js  (assembled here)
 *
 * three ships ESM only (`three.module.min.js` imports from `three.core.min.js`),
 * so this script wraps each file in its own IIFE — separate scopes, because both
 * are minified down to one-letter identifiers and would collide if concatenated —
 * and re-exports the union as `globalThis.THREE`.
 *
 * Re-run after `npm i animejs three` or a version bump. The output files are
 * committed so a deck build never needs the network.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(TOOLS, '..');
const OUT = path.join(TOOLS, 'vendor');
fs.mkdirSync(OUT, { recursive: true });

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const write = (name, src) => {
  fs.writeFileSync(path.join(OUT, name), src, 'utf8');
  console.log(`  ${name.padEnd(24)} ${(Buffer.byteLength(src) / 1024).toFixed(0)} KB`);
};

/* ------------------------------------------------------------- anime.js -- */
/* The UMD bundle already attaches to `globalThis.anime` when there is no
   module system — nothing to assemble, just carry it into vendor/.          */
write('anime.umd.min.js', read('node_modules/animejs/dist/bundles/anime.umd.min.js'));

/* ---------------------------------------------------------------- three -- */
const core = read('node_modules/three/build/three.core.min.js');
const mod = read('node_modules/three/build/three.module.min.js');

/** Every `export{Foo as Bar}from"./three.core.min.js"` → [[fromCore, exported], …].
    These re-export a core symbol without ever binding it locally, so they have
    to be resolved against the core bundle, not against a local identifier.    */
function takeReExports(src) {
  const pairs = [];
  const body = src.replace(/export\s*\{([^}]*)\}\s*from\s*["'][^"']+["']\s*;?/g, (_, list) => {
    for (const item of list.split(',').map((s) => s.trim()).filter(Boolean)) {
      const [imported, exported] = item.split(/\s+as\s+/).map((x) => x.trim());
      pairs.push([imported, exported || imported]);
    }
    return '';
  });
  return { body, pairs };
}

/** Every `export{a as Foo,b}` in the file → [[local, exported], …], body stripped.
    (There is more than one: the builds re-export in several chunks.)          */
function takeExports(src) {
  const pairs = [];
  const body = src.replace(/export\s*\{([^}]*)\}\s*;?/g, (_, list) => {
    for (const item of list.split(',').map((s) => s.trim()).filter(Boolean)) {
      const [local, exported] = item.split(/\s+as\s+/).map((x) => x.trim());
      pairs.push([local, exported || local]);
    }
    return '';
  });
  if (!pairs.length) throw new Error('no export{} found — the three build layout changed');
  return { body, pairs };
}

/** Every `import{Foo as a}from"…"` → [[imported, local], …], body stripped. */
function takeImports(src) {
  const pairs = [];
  const body = src.replace(/import\s*\{([^}]*)\}\s*from\s*["'][^"']+["']\s*;?/g, (_, list) => {
    for (const item of list.split(',').map((s) => s.trim()).filter(Boolean)) {
      const [imported, local] = item.split(/\s+as\s+/).map((x) => x.trim());
      pairs.push([imported, local || imported]);
    }
    return '';
  });
  if (!pairs.length) throw new Error('no import{} from the core build found — layout changed');
  return { body, pairs };
}

const cRe = takeReExports(core);
const c = takeExports(cRe.body);
const mRe = takeReExports(mod);
const m0 = takeImports(mRe.body);
const m1 = takeExports(m0.body);

const coreIife =
  `var __three_core=(function(){\n${c.body}\nreturn {${c.pairs.map(([l, e]) => `${e}:${l}`).join(',')}};\n})();`;

const modIife =
  `var THREE=(function(__c){\n` +
  `const ${m0.pairs.map(([imported, local]) => `${local}=__c.${imported}`).join(',')};\n` +
  `${m1.body}\n` +
  `return Object.assign({},__c,{${mRe.pairs.map(([from, e]) => `${e}:__c.${from}`).join(',')}},` +
  `{${m1.pairs.map(([l, e]) => `${e}:${l}`).join(',')}});\n` +
  `})(__three_core);`;

write('three.iife.min.js',
  `/* three.js r${JSON.parse(read('node_modules/three/package.json')).version} — IIFE bundle assembled by tools/make-vendor.mjs */\n` +
  `(function(g){"use strict";\n${coreIife}\n${modIife}\ng.THREE=THREE;})(typeof globalThis!=="undefined"?globalThis:self);\n`);

/* -------------------------------------------------------------- smoke ---- */
const vendored = fs.readFileSync(path.join(OUT, 'three.iife.min.js'), 'utf8');
const g = { self: {} };
// eslint-disable-next-line no-new-func
new Function('globalThis', 'self', 'window', 'document', vendored)(g, g, undefined, undefined);
const ok = g.THREE && typeof g.THREE.Scene === 'function' && typeof g.THREE.WebGLRenderer === 'function';
console.log(ok ? `  three smoke test OK (r${g.THREE.REVISION}, ${Object.keys(g.THREE).length} exports)`
                : '  three smoke test FAILED');
if (!ok) process.exit(1);
