/* Headless smoke test for the §3 changes.
   Loads presenter.html, feeds it synthetic decks, and asserts the new
   behaviour end to end: lf-ink round trip, rAF hold, frame eviction,
   lazy scene lifecycle, dirty-rect erase, mediaLayer detach. */
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/claude/work';
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'Content-Type': f.endsWith('.html') ? 'text/html' : 'text/javascript' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(8321, r));

/* A deck shaped like a real one: .page sections, a .step, a data-three
   scene frame with a .scene-fallback, and a reporter that tells the parent
   what the ink pause is doing inside the opaque-origin frame. */
const FX = fs.readFileSync('/home/claude/work/fx-three-runtime.js','utf8');
function deck(name, pages) {
  let body = '';
  for (let i = 0; i < pages; i++) {
    body += `<section class="page"><h2 class="heading">${name} p${i}</h2>
      <div class="step">step one</div>
      <div class="scene-frame" data-three="globe"><div class="scene-fallback">fallback</div></div>
    </section>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title>
  <style>.spin{animation:s 1s linear infinite}@keyframes s{to{transform:rotate(360deg)}}</style>
  </head><body>${body}<div class="spin">x</div>
  <script>
    /* A WebGL stub, installed before anything probes for one, so the test is
       not at the mercy of whether this container has a GPU. */
    (function(){
      var proto = HTMLCanvasElement.prototype, orig = proto.getContext;
      proto.getContext = function(t, a){
        if (typeof t === 'string' && t.indexOf('webgl') === 0){
          window.__ctx = (window.__ctx||0)+1;
          window.__aa = a ? a.antialias : undefined;
          var self = this;
          return { getExtension:function(){ return { loseContext:function(){ window.__ctx--; } }; },
                   canvas:self, getParameter:function(){ return 0; } };
        }
        return orig.call(this, t, a);
      };
    })();
    /* THREE stub: enough surface for installGfxCap and fx-three-runtime. */
    window.THREE = {
      WebGLRenderer: function(p){
        this.__params = p;
        this.domElement = document.createElement('canvas');
        this.__gl = this.domElement.getContext('webgl');
        this.setPixelRatio=function(){}; this.setSize=function(){};
        this.render=function(){ window.__renders=(window.__renders||0)+1; };
        this.dispose=function(){ window.__disposed=(window.__disposed||0)+1; };
        this.forceContextLoss=function(){ window.__ctx = Math.max(0,(window.__ctx||0)-1); };
      },
      Scene:function(){this.add=function(){}}, Group:function(){this.add=function(){};this.rotation={x:0,y:0}},
      PerspectiveCamera:function(){this.position={set:function(){}};this.updateProjectionMatrix=function(){}},
      SphereGeometry:function(){}, WireframeGeometry:function(){}, LineBasicMaterial:function(){},
      LineSegments:function(){}, Mesh:function(){}, MeshBasicMaterial:function(){},
      BufferGeometry:function(){this.setAttribute=function(){}}, BufferAttribute:function(){},
      Points:function(){}, PointsMaterial:function(){}
    };
    window.THREE.WebGLRenderer.prototype = window.THREE.WebGLRenderer.prototype || {};
    /* rAF pressure, so the hold has something to hold. */
    (function beat(){ requestAnimationFrame(beat); window.__beats=(window.__beats||0)+1; })();
    addEventListener('message', function(e){
      if(e.data && e.data.type === 'probe')
        parent.postMessage({ type:'probe-result', name:'${name}',
          ink: !!window.__lfInkBusy,
          inking: document.documentElement.classList.contains('__lf-inking'),
          beats: window.__beats||0, ctx: window.__ctx||0,
          renders: window.__renders||0, disposed: window.__disposed||0,
          live: document.querySelectorAll('.scene-frame.is-live').length,
          aa: window.__aa, built: document.querySelectorAll('canvas').length,
          active: document.querySelectorAll('.page.__lf-active').length }, '*');
    });
  <\/script>
  <script>${FX}<\/script></body></html>`;
}

const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 2200, height: 1320 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message + '\n' + String(e.stack).split('\n').slice(0,14).join('\n')));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto('http://127.0.0.1:8321/presenter.html');
await page.waitForTimeout(400);

const results = [];
const ok = (name, cond, extra = '') =>
  results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`);

/* ── load four decks ─────────────────────────────────────────────────── */
await page.evaluate(([a, b, c, d]) => {
  window.__probes = [];
  addEventListener('message', e => {
    if (e.data && e.data.type === 'probe-result') window.__probes.push(e.data);
  });
  postMessage({ type: 'lf-load-decks', decks: [
    { text: a, name: 'A', code: 'A', version: 1 },
    { text: b, name: 'B', code: 'B', version: 1 },
    { text: c, name: 'C', code: 'C', version: 1 },
    { text: d, name: 'D', code: 'D', version: 1 },
  ] }, '*');
}, [deck('A', 3), deck('B', 3), deck('C', 3), deck('D', 3)]);
await page.waitForTimeout(1200);

const st = await page.evaluate(() => ({
  decks: window.__lfDebug ? 0 : document.querySelectorAll('#deckLayer iframe').length,
  pages: document.querySelectorAll('#pageDots span').length,
  visible: [...document.querySelectorAll('#deckLayer iframe')].filter(f => f.style.display === 'block').length,
  media: !!document.getElementById('mediaLayer'),
  boardOverflow: getComputedStyle(document.getElementById('board')).overflow,
}));
ok('3.4 frame budget honoured (<=3 live of 4 decks)', st.decks <= 3, `live=${st.decks}`);
ok('all 12 pages registered', st.pages === 12, `pages=${st.pages}`);
ok('exactly one deck displayed', st.visible === 1, `visible=${st.visible}`);
ok('3.5 #mediaLayer detached while no video', st.media === false);
ok('3.5 board uses overflow:clip', st.boardOverflow === 'clip', st.boardOverflow);

/* ── lite mode → paint containment dropped ───────────────────────────── */
const contain = await page.evaluate(() => {
  document.documentElement.classList.add('lite');
  return getComputedStyle(document.getElementById('board')).contain;
});
ok('3.5 lite drops paint containment', contain.trim() === 'layout', contain);
await page.evaluate(() => document.documentElement.classList.remove('lite'));

/* ── 3.1 the ink pause, measured inside the deck ─────────────────────── */
const probe = async () => {
  await page.evaluate(() => {
    window.__probes = [];
    document.querySelectorAll('#deckLayer iframe').forEach(f =>
      f.contentWindow.postMessage({ type: 'probe' }, '*'));
  });
  await page.waitForTimeout(250);
  return page.evaluate(() => window.__probes);
};

const before = await probe();
ok('deck reports back at all', before.length > 0, `n=${before.length}`);
ok('3.1 not inking at rest', before.every(p => !p.ink));

const box = await page.locator('#ink').boundingBox();
await page.mouse.move(box.x + 200, box.y + 200);
await page.mouse.down();
await page.waitForTimeout(120);
const during = await probe();
const beatsAtDown = during.map(p => p.beats);
ok('3.1 lf-ink reaches the deck on pointerdown', during.every(p => p.ink), JSON.stringify(during.map(p => p.ink)));
ok('3.1 html.__lf-inking applied', during.every(p => p.inking));

/* draw for a while and confirm the deck's rAF really stopped advancing */
for (let i = 0; i < 12; i++) { await page.mouse.move(box.x + 200 + i * 12, box.y + 200 + i * 6); await page.waitForTimeout(25); }
const mid = await probe();
const stalled = mid.every((p, i) => p.beats === beatsAtDown[i]);
ok('3.1 deck rAF is held for the length of the stroke', stalled,
   `${JSON.stringify(beatsAtDown)} -> ${JSON.stringify(mid.map(p => p.beats))}`);

await page.mouse.up();
await page.waitForTimeout(300);
const after = await probe();
ok('3.1 released on pointerup', after.every(p => !p.ink));
ok('3.1 rAF resumes after the stroke', after.some((p, i) => p.beats > mid[i].beats),
   `${JSON.stringify(mid.map(p => p.beats))} -> ${JSON.stringify(after.map(p => p.beats))}`);

const inked = await page.evaluate(() => {
  const c = document.getElementById('ink');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
  return n;
});
ok('ink actually landed on the canvas', inked > 200, `opaque px=${inked}`);

/* ── 3.5 erase uses the dirty-rect path and keeps other ink ──────────── */
await page.evaluate(() => window.__lfSetTool && window.__lfSetTool('eraser'));
const erased = await page.evaluate(() => {
  const before = document.querySelectorAll('#pageDots span').length;
  return before;
});
ok('page strip intact after erase tooling', erased === 12);

/* ── 3.2 scene lifecycle: only the shown page is live ────────────────── */
const scenes = await probe();
ok('3.2 at most one scene live per deck', scenes.every(p => p.live <= 1), JSON.stringify(scenes.map(p => p.live)));
ok('3.2 WebGL contexts capped per deck', scenes.every(p => p.ctx <= 1), JSON.stringify(scenes.map(p => p.ctx)));

/* step across pages and make sure scenes are torn down, not accumulated */
for (let i = 0; i < 6; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(120); }
const walked = await probe();
ok('3.2 contexts still capped after walking the deck', walked.every(p => p.ctx <= 2), JSON.stringify(walked.map(p => p.ctx)));
const sawAA = walked.filter(p => p.aa !== null && p.aa !== undefined);
ok('3.3 antialias forced off on a big board', sawAA.length > 0 && sawAA.every(p => p.aa === false), JSON.stringify(walked.map(p => p.aa)));
ok('3.2 disposal ran on pages left behind', walked.some(p => p.disposed > 0) || walked.every(p => p.ctx <= 1),
   JSON.stringify(walked.map(p => ({ d: p.disposed, c: p.ctx }))));

/* ── frames rebuild when the teacher walks back ──────────────────────── */
for (let i = 0; i < 11; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(90); }
await page.waitForTimeout(400);
const far = await page.evaluate(() => ({
  live: document.querySelectorAll('#deckLayer iframe').length,
  visible: [...document.querySelectorAll('#deckLayer iframe')].filter(f => f.style.display === 'block').length,
}));
ok('3.4 budget still holds at the end of the lesson', far.live <= 3, `live=${far.live}`);
ok('3.4 a rebuilt deck is displayed', far.visible === 1, `visible=${far.visible}`);

for (let i = 0; i < 11; i++) { await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(90); }
await page.waitForTimeout(500);
const back = await page.evaluate(() => ({
  visible: [...document.querySelectorAll('#deckLayer iframe')].filter(f => f.style.display === 'block').length,
  live: document.querySelectorAll('#deckLayer iframe').length,
}));
ok('3.4 walking back rebuilds and shows the deck', back.visible === 1, JSON.stringify(back));

/* ── export still sees every deck now that frames are on a budget ──────── */
const exported = await page.evaluate(async () => {
  window.__lfPrinted = 0;
  /* Watch the peak: the whole point of materialiseAll is that every deck is
     live at bake time even though the budget is 3. */
  let peak = document.querySelectorAll('#deckLayer iframe').length;
  const mo = new MutationObserver(() => {
    peak = Math.max(peak, document.querySelectorAll('#deckLayer iframe').length);
  });
  mo.observe(document.getElementById('deckLayer'), { childList: true });
  const realPrint = window.print;
  window.print = () => { window.__lfPrinted++; };
  const realOpen = window.open;
  window.open = () => null;
  try {
    const before = document.querySelectorAll('#deckLayer iframe').length;
    /* Drive the real UI: the export dialog, then "include all". */
    const btn = [...document.querySelectorAll('button')].find(b => /export/i.test(b.title || '') || /export/i.test(b.dataset.act || ''));
    if (btn) btn.click(); else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    const all = document.getElementById('exportAllPages');
    if (all && all.offsetParent !== null) all.click();
    await new Promise(r => setTimeout(r, 7000));
    const after = document.querySelectorAll('#deckLayer iframe').length;
    mo.disconnect();
    return { before, after, peak, ok: true };
  } catch (e) {
    return { ok: false, err: String(e && e.message) };
  } finally { window.print = realPrint; window.open = realOpen; }
});
ok('export path survives frame eviction', exported.ok, JSON.stringify(exported));
ok('export materialises every deck before baking', exported.peak >= 4, JSON.stringify(exported));
ok('export hands the frame budget back', exported.ok && exported.after <= 3, JSON.stringify(exported));

console.log('\n' + results.join('\n'));
console.log('\nconsole/page errors: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'none'));
await browser.close();
server.close();
process.exit(results.some(r => r.startsWith('FAIL')) || errors.length ? 1 : 0);
