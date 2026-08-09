/**
 * Headless verification of the deck-editor runtime.
 *
 * Runs the real runtime inside a real sandboxed iframe in real Chromium, at a
 * real 1920x1080 board — because every claim this feature makes ("the size you
 * read is the size the class sees") is a claim about layout, and layout cannot
 * be unit-tested with a fake DOM.
 */
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'

const RUNTIME = readFileSync(new URL('../src/lib/deckEditorRuntime.js', import.meta.url), 'utf8')

/* A deck written the way the house style asks for: clamp() sizes, a .wrap,
   steps as flex siblings on slide 2, and a deliberately overflowing slide 3. */
const DECK = `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}
  html,body{margin:0;height:100%;background:#080a14;color:#e2e8f0;
    font-family:Calibri,system-ui,sans-serif}
  .page{height:100%;padding:4vmin}
  .wrap{height:100%;display:flex;flex-direction:column;gap:2vmin}
  h2.heading{margin:0;font-size:clamp(26px,6.2vmin,66px)}
  p.body{margin:0;font-size:clamp(19px,3.7vmin,42px);line-height:1.5}
  .eq{font-size:clamp(21px,4.4vmin,50px)}
  .term-row{display:flex;gap:2vmin}
  .term-card{flex:1;padding:2vmin;background:#111827;font-size:3vmin}
  .tall p{font-size:6vmin;line-height:1.9;margin:0 0 1.2vmin}
</style></head><body>

<section class="page"><div class="wrap">
  <h2 class="heading">Newton's second law</h2>
  <p class="body" id="b1">Force is the rate of change of momentum.</p>
  <p class="body" id="b2">Mass is constant for the bodies we treat here.</p>
  <p class="eq step" id="e1">F = dp/dt</p>
  <p class="eq step" id="e2">F = ma</p>
</div></section>

<section class="page"><div class="wrap">
  <h2 class="heading">Three terms</h2>
  <div class="term-row">
    <div class="term-card step" id="t1">First</div>
    <div class="term-card step" id="t2">Second</div>
    <div class="term-card step" id="t3">Third</div>
  </div>
</div></section>

<section class="page"><div class="wrap tall">
  <h2 class="heading">Overflowing on purpose</h2>
  <p>Line one of a slide that was written far too long for the board it lands on.</p>
  <p>Line two of a slide that was written far too long for the board it lands on.</p>
  <p>Line three of a slide that was written far too long for the board it lands on.</p>
  <p>Line four of a slide that was written far too long for the board it lands on.</p>
  <p>Line five of a slide that was written far too long for the board it lands on.</p>
  <p>Line six of a slide that was written far too long for the board it lands on.</p>
  <p>Line seven of a slide that was written far too long for the board it lands on.</p>
</div></section>
</body></html>`

const SRCDOC = `${DECK}\n<script data-lfe-own="1">\n${RUNTIME.replace(/<\/script/gi, '<\\/script')}\n</script>`

const HOST = `<!doctype html><html><head><style>
  html,body{margin:0;background:#000}
  iframe{width:1920px;height:1080px;border:0;display:block}
</style></head><body>
<iframe id="f" sandbox="allow-scripts" scrolling="no"></iframe>
<script>
  window.__msgs = [];
  window.__ready = null;
  window.addEventListener('message', (e) => {
    window.__msgs.push(e.data);
    if (e.data && e.data.type === 'lfe-ready') window.__ready = e.data;
  });
  window.__send = (m) => document.getElementById('f').contentWindow.postMessage(m, '*');
  window.__last = (t) => {
    for (let i = window.__msgs.length - 1; i >= 0; i--)
      if (window.__msgs[i] && window.__msgs[i].type === t) return window.__msgs[i];
    return null;
  };
<\/script></body></html>`

/* ── tiny assertion harness ─────────────────────────────────────────────── */
let pass = 0
const fails = []
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fails.push(`${name} ${extra}`); console.log(`  ✗ ${name} ${extra}`) }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const run = async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1920, height: 1180 } })
  writeFileSync('/tmp/host.html', HOST)
  await page.goto('file:///tmp/host.html')
  await page.evaluate((doc) => { document.getElementById('f').srcdoc = doc }, SRCDOC)
  await page.waitForFunction(() => window.__ready, null, { timeout: 15000 })
  await wait(700)

  const send = (m) => page.evaluate((mm) => window.__send(mm), m)
  const last = (t) => page.evaluate((tt) => window.__last(tt), t)
  const step = async (m, ms = 320) => { await send(m); await wait(ms) }
  const frame = () => page.frames()[1]

  /* ── 1. boot ─────────────────────────────────────────────────────────── */
  console.log('\n1. boot + slide inventory')
  const ready = await page.evaluate(() => window.__ready)
  ok('found 3 slides', ready.pages.length === 3, JSON.stringify(ready.pages.map((p) => p.index)))
  ok('slide 1 reports 2 steps', ready.pages[0].stepCount === 2)
  ok('slide 2 reports 3 steps', ready.pages[1].stepCount === 3)
  ok('titles come from the headings', ready.pages[0].title.includes('Newton'))

  /* ── 2. selection by real click ──────────────────────────────────────── */
  console.log('\n2. click selection')
  const box = await frame().locator('#b1').boundingBox()
  await page.mouse.click(box.x + 20, box.y + box.height / 2)
  await wait(300)
  let st = await last('lfe-state')
  ok('one element selected', st.selection.length === 1, JSON.stringify(st.selection))
  ok('it is the paragraph', st.selection[0].tag === 'p')
  ok('classes reported', st.selection[0].classes.includes('body'))

  /* The board is 1920x1080, so 1vmin = 10.8px and clamp(19px,3.7vmin,42px)
     resolves to 39.96px = 3.7vmin. The runtime must read that back exactly,
     which is the whole "no more guessing at clamp()" claim. */
  ok('authored px read correctly', near(st.selection[0].fontPx, 39.96, 0.6), `got ${st.selection[0].fontPx}`)
  ok('vmin derived correctly', near(st.selection[0].fontVmin, 3.7, 0.05), `got ${st.selection[0].fontVmin}`)
  ok('similar-on-page count', st.similarOnPage === 2, `got ${st.similarOnPage}`)

  /* ── 3. font scaling, single element ─────────────────────────────────── */
  console.log('\n3. typography — single element')
  await step({ type: 'lfe-font', op: 'scale', value: 1.1, unit: 'vmin', scope: 'element' })
  st = await last('lfe-state')
  ok('bumped by 10%', near(st.selection[0].fontVmin, 4.07, 0.05), `got ${st.selection[0].fontVmin}`)
  ok('written as vmin', /vmin$/.test(st.selection[0].inlineFont), st.selection[0].inlineFont)
  ok('the sibling was NOT touched',
    (await frame().locator('#b2').getAttribute('style')) === null)

  await step({ type: 'lfe-undo' })
  st = await last('lfe-state')
  ok('undo restores the size', near(st.selection[0].fontVmin, 3.7, 0.05), `got ${st.selection[0].fontVmin}`)
  await step({ type: 'lfe-redo' })
  st = await last('lfe-state')
  ok('redo re-applies it', near(st.selection[0].fontVmin, 4.07, 0.05), `got ${st.selection[0].fontVmin}`)
  await step({ type: 'lfe-undo' })

  /* ── 4. font scaling, all similar ────────────────────────────────────── */
  console.log('\n4. typography — all similar on the slide')
  await step({ type: 'lfe-font', op: 'scale', value: 1.25, unit: 'vmin', scope: 'page' })
  const b1 = await frame().locator('#b1').getAttribute('style')
  const b2 = await frame().locator('#b2').getAttribute('style')
  ok('first .body scaled', /font-size/.test(b1 || ''), String(b1))
  ok('second .body scaled too', /font-size/.test(b2 || ''), String(b2))
  ok('the .eq elements were left alone',
    (await frame().locator('#e1').getAttribute('style')) === null)
  await step({ type: 'lfe-undo' })

  /* ── 5. exact set + unit switch ──────────────────────────────────────── */
  console.log('\n5. exact size + px unit')
  await step({ type: 'lfe-font', op: 'set', value: 60, unit: 'px', scope: 'element' })
  st = await last('lfe-state')
  ok('set to 60px', near(st.selection[0].fontPx, 60, 0.6), `got ${st.selection[0].fontPx}`)
  ok('written as px', /px$/.test(st.selection[0].inlineFont), st.selection[0].inlineFont)
  await step({ type: 'lfe-undo' })

  /* ── 6. steps: create, remove ────────────────────────────────────────── */
  console.log('\n6. animation steps — create / remove')
  await step({ type: 'lfe-step-set', on: true, scope: 'element' })
  st = await last('lfe-state')
  ok('slide now has 3 steps', st.steps.length === 3, `got ${st.steps.length}`)
  ok('the new step is last in reveal order', st.steps[0].text.includes('Force'),
    JSON.stringify(st.steps.map((s) => s.text)))
  await step({ type: 'lfe-step-set', on: false, scope: 'element' })
  st = await last('lfe-state')
  ok('back to 2 steps', st.steps.length === 2, `got ${st.steps.length}`)

  /* A step inside a step is what the deck gate rejects — refuse it here. */
  await step({ type: 'lfe-show', index: 0 })
  const eqBox = await frame().locator('#e1').boundingBox()
  await page.mouse.click(eqBox.x + 10, eqBox.y + eqBox.height / 2)
  await wait(250)
  await step({ type: 'lfe-step-group' })
  st = await last('lfe-state')
  ok('grouping one element is refused', st.steps.length === 2, `got ${st.steps.length}`)

  /* ── 7. steps: reorder, layout pinned ────────────────────────────────── */
  console.log('\n7. animation steps — reorder')
  await step({ type: 'lfe-show', index: 1 })
  st = await last('lfe-state')
  ok('flex parent detected', st.stepParentIsFlex === true)
  const before = await frame().evaluate(() =>
    [...document.querySelectorAll('.term-card')].map((n) => n.id))
  await step({ type: 'lfe-step-move', from: 2, to: 0, preserveLayout: true })
  st = await last('lfe-state')
  const domOrder = await frame().evaluate(() =>
    [...document.querySelectorAll('.term-card')].map((n) => n.id))
  ok('reveal order changed', domOrder[0] === 't3' && before[0] === 't1', domOrder.join(','))
  ok('sequencer reflects it', st.steps[0].text === 'Third', JSON.stringify(st.steps.map((s) => s.text)))
  const visual = await frame().evaluate(() =>
    [...document.querySelectorAll('.term-card')]
      .map((n) => ({ id: n.id, x: n.getBoundingClientRect().left }))
      .sort((a, b) => a.x - b.x).map((n) => n.id))
  ok('but the slide layout did NOT move', visual.join(',') === before.join(','),
    `visual=${visual.join(',')} expected=${before.join(',')}`)
  await step({ type: 'lfe-undo' })
  const restored = await frame().evaluate(() =>
    [...document.querySelectorAll('.term-card')].map((n) => n.id))
  ok('undo restores DOM order', restored.join(',') === before.join(','), restored.join(','))

  /* ── 8. delete ───────────────────────────────────────────────────────── */
  console.log('\n8. element deletion')
  await step({ type: 'lfe-show', index: 0 })
  const delBox = await frame().locator('#b2').boundingBox()
  await page.mouse.click(delBox.x + 10, delBox.y + delBox.height / 2)
  await wait(250)
  await step({ type: 'lfe-delete', scope: 'element' })
  ok('element is gone', (await frame().locator('#b2').count()) === 0)
  await step({ type: 'lfe-undo' })
  ok('undo brings it back', (await frame().locator('#b2').count()) === 1)

  /* ── 9. fit meter + auto-fix ─────────────────────────────────────────── */
  console.log('\n9. fit meter and auto-fix')
  await step({ type: 'lfe-show', index: 2 }, 900)
  st = await last('lfe-state')
  ok('overflowing slide reported as shrunk', st.fitZoom < 0.98, `zoom=${st.fitZoom}`)
  const zoomBefore = st.fitZoom
  await step({ type: 'lfe-autofit', unit: 'vmin' }, 900)
  st = await last('lfe-state')
  ok('auto-fix brings it back to full size', st.fitZoom > 0.985,
    `${zoomBefore} -> ${st.fitZoom}`)
  const scaled = await frame().evaluate(() =>
    [...document.querySelectorAll('.tall p')].filter((n) => /vmin/.test(n.style.fontSize)).length)
  ok('sizes were baked in vmin, not px', scaled >= 7, `got ${scaled}`)
  await step({ type: 'lfe-undo' }, 700)

  /* ── 10. serialization ───────────────────────────────────────────────── */
  console.log('\n10. serialization back to a deck file')
  await step({ type: 'lfe-show', index: 0 })
  const b3 = await frame().locator('#b1').boundingBox()
  await page.mouse.click(b3.x + 10, b3.y + b3.height / 2)
  await wait(250)
  await step({ type: 'lfe-font', op: 'scale', value: 1.2, unit: 'vmin', scope: 'element' })
  await send({ type: 'lfe-doc', requestId: 'r1' })
  await wait(500)
  const doc = (await last('lfe-doc')).html

  ok('no editor uids leak out', !/data-lfe-uid/.test(doc))
  ok('no editor nodes leak out', !/data-lfe-own/.test(doc))
  ok('no editor classes leak out', !/__lfe-/.test(doc))
  ok('no host classes leak out', !/__lf-/.test(doc))
  ok('no fit zoom baked in', !/zoom\s*:/.test(doc), (doc.match(/zoom[^;]*/) || [''])[0])
  ok('slides survive', (doc.match(/class="page"/g) || []).length === 3)
  ok('steps survive', /class="[^"]*\bstep\b/.test(doc))
  ok('the edit survives', /font-size:\s*4\.4\d*vmin/.test(doc),
    (doc.match(/font-size:[^;"]*/g) || []).join(' | '))
  ok('the deck\'s own CSS survives', /clamp\(19px,3\.7vmin,42px\)/.test(doc))
  ok('it is a loadable document', doc.startsWith('<!DOCTYPE html>'))

  /* Round-trip: what came out must load again, unchanged in shape. */
  const roundTrip = await page.evaluate((d) => {
    const p = new DOMParser().parseFromString(d, 'text/html')
    return {
      pages: p.querySelectorAll('.page').length,
      steps: p.querySelectorAll('.step').length,
      nested: [...p.querySelectorAll('.step')].filter((n) => n.parentElement.closest('.step')).length,
    }
  }, doc)
  ok('round-trips to 3 slides', roundTrip.pages === 3, JSON.stringify(roundTrip))
  ok('round-trips to 5 steps', roundTrip.steps === 5, JSON.stringify(roundTrip))
  ok('no nested steps (the gate rule)', roundTrip.nested === 0)

  await browser.close()

  console.log(`\n${'='.repeat(58)}`)
  console.log(`${pass} passed, ${fails.length} failed`)
  if (fails.length) { fails.forEach((f) => console.log(`  FAIL: ${f}`)); process.exit(1) }
}

run().catch((e) => { console.error(e); process.exit(1) })
