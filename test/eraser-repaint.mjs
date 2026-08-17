/* Focused test for the rewritten area/stroke eraser (§3.5).
   redraw() used to repaint the whole page every frame of an eraser drag; it
   now clears and rebuilds only the removed strokes' own boxes. That is real
   drawing logic, so it gets its own test: ink in two corners, erase one,
   prove the other is untouched — and that undo puts it back. */
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/claude/work';
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(8322, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message + '\n' + String(e.stack).split('\n').slice(0, 8).join('\n')));
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.goto('http://127.0.0.1:8322/presenter.html?lfdebug');
await page.waitForTimeout(300);

const results = [];
const ok = (n, c, x = '') => results.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`);

/* one blank page to draw on */
await page.evaluate(() => {
  postMessage({ type: 'lf-load-deck', text:
    '<!doctype html><html><body><section class="page">one</section></body></html>', name: 'blank' }, '*');
});
await page.waitForTimeout(600);

const box = await page.locator('#ink').boundingBox();
const draw = async (x0, y0, x1, y1) => {
  await page.mouse.move(box.x + x0, box.y + y0);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++)
    await page.mouse.move(box.x + x0 + (x1 - x0) * i / 10, box.y + y0 + (y1 - y0) * i / 10);
  await page.mouse.up();
  await page.waitForTimeout(60);
};

/* count opaque pixels inside a CSS-space rect of the ink canvas */
const count = (x, y, w, h) => page.evaluate(([x, y, w, h]) => {
  const c = document.getElementById('ink');
  const r = c.getBoundingClientRect();
  const sx = c.width / r.width, sy = c.height / r.height;
  const d = c.getContext('2d').getImageData(
    Math.round(x * sx), Math.round(y * sy), Math.round(w * sx), Math.round(h * sy)).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
  return n;
}, [x, y, w, h]);

await draw(200, 200, 420, 330);      // stroke A — top left
await draw(1000, 560, 1240, 700);    // stroke B — bottom right

const A0 = await count(150, 150, 340, 240);
const B0 = await count(950, 510, 360, 250);
const n0 = await page.evaluate(() => window.__lf.state.pages[0].strokes.length);
ok('two strokes recorded', n0 === 2, `strokes=${n0}`);
ok('stroke A painted', A0 > 300, `px=${A0}`);
ok('stroke B painted', B0 > 300, `px=${B0}`);

/* stroke eraser straight through A only */
await page.evaluate(() => window.__lf.setTool('eraser'));
await page.mouse.move(box.x + 260, box.y + 235);
await page.mouse.down();
for (let i = 0; i < 8; i++) await page.mouse.move(box.x + 260 + i * 16, box.y + 235 + i * 10);
await page.mouse.up();
/* Park the cursor and go back to the pen before measuring: the erasers paint
   a radius ring on the LIVE layer at the hover point, and it would otherwise
   be counted as surviving ink. */
await page.evaluate(() => window.__lf.setTool('pen'));
await page.mouse.move(box.x + 700, box.y + 880);
await page.waitForTimeout(250);

const A1 = await count(150, 150, 340, 240);
const B1 = await count(950, 510, 360, 250);
const n1 = await page.evaluate(() => window.__lf.state.pages[0].strokes.length);
ok('3.5 erased stroke is gone from the surface', A1 < A0 * 0.15, `${A0} -> ${A1}`);
ok('3.5 the OTHER stroke survives the partial repaint', B1 === B0, `${B0} -> ${B1}`);
ok('stroke removed from state', n1 === 1, `strokes=${n1}`);

/* undo still rebuilds the whole page correctly after a partial repaint */
await page.keyboard.press('Control+z');
await page.waitForTimeout(250);
const A2 = await count(150, 150, 340, 240);
const B2 = await count(950, 510, 360, 250);
const n2 = await page.evaluate(() => window.__lf.state.pages[0].strokes.length);
ok('undo restores the stroke', n2 === 2 && A2 > A0 * 0.8, `strokes=${n2} px=${A0}->${A2}`);
ok('undo leaves the other stroke alone', Math.abs(B2 - B0) < B0 * 0.05, `${B0} -> ${B2}`);

/* area eraser (destination-out against the committed buffer) still blits */
await page.evaluate(() => window.__lf.setTool('eraser-obj'));
await page.mouse.move(box.x + 1000, box.y + 560);
await page.mouse.down();
for (let i = 0; i < 12; i++) await page.mouse.move(box.x + 1000 + i * 20, box.y + 560 + i * 12);
await page.mouse.up();
await page.evaluate(() => window.__lf.setTool('pen'));
await page.mouse.move(box.x + 700, box.y + 880);
await page.waitForTimeout(250);
const B3 = await count(950, 510, 360, 250);
const A3 = await count(150, 150, 340, 240);
ok('area eraser takes ink off the board', B3 < B2 * 0.75, `${B2} -> ${B3}`);
ok('area eraser leaves the far corner alone', Math.abs(A3 - A2) < A2 * 0.05, `${A2} -> ${A3}`);

/* the entry fade is retired once it has run */
const settled = await page.evaluate(() => document.getElementById('board').classList.contains('settled'));
ok('3.5 board transition retired after the fade', settled);

/* #mediaLayer comes back when a video actually turns up, and leaves again */
const media = await page.evaluate(async () => {
  const f = document.querySelector('#deckLayer iframe');
  const before = !!document.getElementById('mediaLayer');
  window.dispatchEvent(new MessageEvent('message', {
    source: f.contentWindow,
    data: { type: 'lf-media', media: [{ provider: 'youtube', id: 'x', x: 10, y: 10, w: 320, h: 180 }] }
  }));
  await new Promise(r => setTimeout(r, 120));
  const during = !!document.getElementById('mediaLayer');
  window.dispatchEvent(new MessageEvent('message', {
    source: f.contentWindow, data: { type: 'lf-media', media: [] }
  }));
  await new Promise(r => setTimeout(r, 120));
  return { before, during, after: !!document.getElementById('mediaLayer') };
});
ok('3.5 media layer attaches for a video and detaches after',
   media.before === false && media.during === true && media.after === false, JSON.stringify(media));

console.log('\n' + results.join('\n'));
console.log('\nconsole/page errors: ' + (errors.length ? '\n  ' + errors.join('\n  ') : 'none'));
await browser.close();
server.close();
process.exit(results.some(r => r.startsWith('FAIL')) || errors.length ? 1 : 0);
