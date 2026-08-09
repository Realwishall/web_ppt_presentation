/**
 * End-to-end check against REAL decks out of JSON_split_html, finishing with
 * the project's own gate (`tools/validate-deck.mjs`).
 *
 * The synthetic test proves the mechanics. This one proves the thing that
 * actually matters: a deck that goes into the editor and comes back out is
 * still a deck this project will ship — same slide count, same steps, no
 * editor residue, and clean through the validator.
 */
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RUNTIME = readFileSync(new URL('../src/lib/deckEditorRuntime.js', import.meta.url), 'utf8')
const UP = new URL('..', import.meta.url).pathname

const DECKS = [
  `${UP}/JSON_split_html/03 - Motion in 1D/03 - Mechanics Part 1 -06 Free fall - Bearable.html`,
  `${UP}/JSON_split_html/28 - Optics/21_-_Optics_-_05_Optics_-_Optical_instuement_part_01_slides_1-5.html`,
]

let pass = 0
const fails = []
const ok = (n, c, e = '') => {
  if (c) { pass++; console.log(`  ✓ ${n}`) } else { fails.push(`${n} ${e}`); console.log(`  ✗ ${n} ${e}`) }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const HOST = `<!doctype html><body style="margin:0;background:#000">
<iframe id="f" sandbox="allow-scripts" scrolling="no" style="width:1920px;height:1080px;border:0;display:block"></iframe>
<script>
window.__m=[];addEventListener('message',e=>__m.push(e.data));
window.__send=m=>document.getElementById('f').contentWindow.postMessage(m,'*');
window.__last=t=>{for(let i=__m.length-1;i>=0;i--)if(__m[i]&&__m[i].type===t)return __m[i];return null};
<\/script></body>`

const stats = (page, html) => page.evaluate((d) => {
  const p = new DOMParser().parseFromString(d, 'text/html')
  return {
    pages: p.querySelectorAll('.page').length,
    steps: p.querySelectorAll('.step').length,
    nested: [...p.querySelectorAll('.step')].filter((n) => n.parentElement.closest('.step')).length,
    clickable: p.querySelectorAll('.clickable').length,
    scripts: p.querySelectorAll('script').length,
    svgs: p.querySelectorAll('svg').length,
    imgs: p.querySelectorAll('img').length,
    mathml: p.querySelectorAll('math').length,
    canvases: p.querySelectorAll('canvas').length,
  }
}, html)

const run = async () => {
  const browser = await chromium.launch()
  const tmp = mkdtempSync(join(tmpdir(), 'deck-'))
  writeFileSync('/tmp/rhost.html', HOST)

  for (const file of DECKS) {
    const name = file.split('/').pop()
    console.log(`\n── ${name}`)
    const deck = readFileSync(file, 'utf8')
    const src = `${deck}\n<script data-lfe-own="1">\n${RUNTIME.replace(/<\/script/gi, '<\\/script')}\n</script>`

    const page = await browser.newPage({ viewport: { width: 1920, height: 1180 } })
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto('file:///tmp/rhost.html')
    await page.evaluate((d) => { document.getElementById('f').srcdoc = d }, src)
    await page.waitForFunction(() => window.__last('lfe-ready'), null, { timeout: 25000 })
    await wait(1600)

    const send = async (m, ms = 400) => { await page.evaluate((mm) => window.__send(mm), m); await wait(ms) }
    const last = (t) => page.evaluate((tt) => window.__last(tt), t)

    const before = await stats(page, deck)
    const ready = await last('lfe-ready')
    ok('editor booted with no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
    ok(`found all ${before.pages} slides`, ready.pages.length === before.pages,
      `runtime=${ready.pages.length} source=${before.pages}`)
    ok('step counts match the source',
      ready.pages.reduce((a, p) => a + p.stepCount, 0) === before.steps,
      `runtime=${ready.pages.reduce((a, p) => a + p.stepCount, 0)} source=${before.steps}`)

    /* Walk every slide, so the fit engine runs on all of them and any deck
       script that only breaks on slide 7 gets a chance to break. */
    let shrunk = 0
    for (let i = 0; i < ready.pages.length; i++) {
      await send({ type: 'lfe-show', index: i }, 260)
      const st = await last('lfe-state')
      if (st.fitZoom < 0.995) shrunk++
    }
    ok('every slide rendered and measured', errors.length === 0, errors.slice(0, 2).join(' | '))
    console.log(`     (${shrunk}/${ready.pages.length} slides are auto-shrunk on a 1920×1080 board)`)

    /* A real edit: select the first heading on slide 1, scale every similar
       heading in the deck, then serialize. */
    await send({ type: 'lfe-show', index: 0 }, 400)
    const target = page.frames()[1].locator('.page.__lfe-active h1, .page.__lfe-active h2, .page.__lfe-active p').first()
    const bb = await target.boundingBox().catch(() => null)
    if (bb) {
      await page.mouse.click(bb.x + Math.min(20, bb.width / 2), bb.y + bb.height / 2)
      await wait(350)
      const st = await last('lfe-state')
      ok('clicked an element on a real slide', st.selection.length === 1,
        JSON.stringify(st.selection.map((s) => s.tag)))
      ok('its size was read back', st.selection[0]?.fontVmin > 0, JSON.stringify(st.selection[0]))
      await send({ type: 'lfe-font', op: 'scale', value: 1.15, unit: 'vmin', scope: 'deck' }, 600)
    }

    await page.evaluate(() => window.__send({ type: 'lfe-doc', requestId: 'r' }))
    await wait(1200)
    const out = (await last('lfe-doc')).html
    const after = await stats(page, out)

    ok('slide count preserved', after.pages === before.pages, `${before.pages} -> ${after.pages}`)
    ok('step count preserved', after.steps === before.steps, `${before.steps} -> ${after.steps}`)
    ok('no nested steps introduced', after.nested === 0, String(after.nested))
    ok('clickables preserved', after.clickable === before.clickable, `${before.clickable} -> ${after.clickable}`)
    ok('the deck\'s own scripts survive', after.scripts === before.scripts + 0 || after.scripts >= before.scripts,
      `${before.scripts} -> ${after.scripts}`)
    ok('SVG figures preserved', after.svgs === before.svgs, `${before.svgs} -> ${after.svgs}`)
    ok('images preserved', after.imgs === before.imgs, `${before.imgs} -> ${after.imgs}`)
    ok('MathML preserved', after.mathml === before.mathml, `${before.mathml} -> ${after.mathml}`)
    ok('no editor residue', !/data-lfe|__lfe-/.test(out),
      (out.match(/data-lfe[^ >]*/) || [])[0] || (out.match(/__lfe-[\w-]*/) || [])[0] || '')
    ok('no fit zoom baked in', !/style="[^"]*zoom\s*:/.test(out))
    ok('the edit is present', /font-size:\s*[\d.]+vmin/.test(out))

    /* Finally: through the project's own gate. */
    const outFile = join(tmp, name)
    writeFileSync(outFile, out)
    let gate = ''
    let gateOk = true
    try {
      gate = execFileSync('node', [`${UP}/tools/validate-deck.mjs`, outFile], { encoding: 'utf8' })
    } catch (e) {
      gateOk = false
      gate = (e.stdout || '') + (e.stderr || '')
    }
    const errLines = gate.split('\n').filter((l) => /ERROR|FAIL/i.test(l))
    ok('passes tools/validate-deck.mjs', gateOk, errLines.slice(0, 4).join(' | ') || gate.slice(-300))

    await page.close()
  }

  await browser.close()
  console.log(`\n${'='.repeat(58)}\n${pass} passed, ${fails.length} failed`)
  if (fails.length) { fails.forEach((f) => console.log(`  FAIL: ${f}`)); process.exit(1) }
}

run().catch((e) => { console.error(e); process.exit(1) })
