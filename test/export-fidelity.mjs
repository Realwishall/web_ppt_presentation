/* Export fidelity + cost regression test.
   usage: node export-fidelity.mjs [file.html] [decks] [pagesPerDeck]

   Guards the bug where the deck-frame budget (MAX_LIVE_DECKS) evicted the
   very frames the export had just materialised: the bake then sat out its
   timeout and fell back to authored deck.text for those decks — five seconds
   slower, and printing them at authored size because text has never had a
   layout pass and so carries no per-page zoom.

   The load-bearing assertion is liveDocs === deck count. */
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const FILE = process.argv[2] || 'presenter.html';
const NDECKS = +(process.argv[3] || 6);
const NPAGES = +(process.argv[4] || 8);
const ROOT = '/home/claude/work';

const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(8323, r));

/* ~120 KB of filler per deck so parse cost is not free, like the real thing */
const FILLER = 'var __pad = "' + 'x'.repeat(120000) + '";';
const deck = (name) => {
  let body = '';
  for (let i = 0; i < NPAGES; i++)
    body += `<section class="page"><h2 class="heading">${name} ${i}</h2>
      <div class="wrap"><div class="step">a</div><div class="step">b</div>
      <div class="scene-frame" data-three="globe"><div class="scene-fallback">f</div></div></div>
    </section>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title></head>
    <body>${body}<script>${FILLER}<\/script></body></html>`;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(`http://127.0.0.1:8323/${FILE}?lfdebug`);
await page.waitForTimeout(400);

await page.evaluate(([texts]) => {
  postMessage({ type: 'lf-load-decks', decks: texts.map((t, i) => ({
    text: t, name: 'D' + i, code: 'D' + i, version: 1 })) }, '*');
}, [Array.from({ length: NDECKS }, (_, i) => deck('D' + i))]);
await page.waitForTimeout(2500);

/* walk to the end so early decks are genuinely cold under the new budget */
for (let i = 0; i < NDECKS * NPAGES - 1; i++) { await page.keyboard.press('ArrowRight'); }
await page.waitForTimeout(1200);

const out = await page.evaluate(async () => {
  const realOpen = window.open;
  window.open = () => null;
  /* exportPDF finishes by appending a print iframe and calling print() inside
     IT — so the top window's print() is never touched. Watch for that frame
     and treat its load event as "the PDF is ready". */
  let printed = 0, printFrame = null;
  const bodyMo = new MutationObserver(muts => {
    muts.forEach(m => [...m.addedNodes].forEach(n => {
      if (n.tagName === 'IFRAME' && !printFrame){
        printFrame = n;
        n.addEventListener('load', () => { printed++; });
      }
    }));
  });
  bodyMo.observe(document.body, { childList: true });
  /* How many decks actually answered with their LIVE dom. Anything short of
     the deck count means the bake silently fell back to authored deck.text —
     no layout pass, so no per-page zoom, so slides print oversized. */
  let liveDocs = 0;
  addEventListener('message', e => {
    if (e.data && e.data.type === 'lf-export-doc' && e.data.html) liveDocs++;
  });
  let peak = document.querySelectorAll('#deckLayer iframe').length;
  const mo = new MutationObserver(() => {
    peak = Math.max(peak, document.querySelectorAll('#deckLayer iframe').length);
  });
  mo.observe(document.getElementById('deckLayer'), { childList: true });

  const t0 = performance.now();
  const btn = [...document.querySelectorAll('button')].find(b => /export/i.test(b.title || ''));
  if (btn) btn.click(); else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  const all = document.getElementById('exportAllPages');
  if (all && all.offsetParent !== null) all.click();

  /* the print frame is the last thing built — wait for print() or give up */
  const deadline = performance.now() + 45000;
  while (!printed && performance.now() < deadline) await new Promise(r => setTimeout(r, 100));
  const ms = performance.now() - t0;
  mo.disconnect();
  bodyMo.disconnect(); window.open = realOpen;
  return { ms: Math.round(ms), printed, peak, liveDocs,
           live: document.querySelectorAll('#deckLayer iframe').length };
});

const results = [];
const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`);

ok('export reaches the print stage', out.printed === 1, `printed=${out.printed}`);
ok('every deck is baked from its LIVE document, not authored text',
   out.liveDocs === NDECKS, `liveDocs=${out.liveDocs}/${NDECKS}`);
ok('eviction is held open for the bake', out.peak >= NDECKS, `peak=${out.peak}`);
ok('the frame budget closes again afterwards', out.live <= 3, `liveAfter=${out.live}`);
ok('export does not stall on a frameReady timeout', out.ms < 5000, `${out.ms}ms`);
ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

console.log(`\n${FILE} — ${NDECKS} decks, ${NDECKS * NPAGES} pages, export ${out.ms}ms`);
console.log(results.join('\n'));
await browser.close();
server.close();
process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
