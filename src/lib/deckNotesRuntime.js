/* eslint-disable */
/**
 * NOTES-MODE DECK RUNTIME  (imported with `?raw` — never executed as a module)
 *
 * The read-only twin of the presenter's `deckController`. It is injected into
 * the sandboxed deck iframe of /notes and does exactly three things:
 *
 *   1. shows one `.page` at a time and reveals its `.step`s one by one,
 *   2. runs the same auto-fit engine the presenter uses, so the slide the
 *      teacher takes notes against is laid out identically to the one they
 *      will teach (a deck sizes itself in vmin/clamp — a differently sized
 *      frame is a genuinely different slide),
 *   3. forwards every keystroke to the host.
 *
 * (3) is what makes "type while you present" work. The deck lives in a
 * cross-origin sandbox, so a key pressed while the slide has focus never
 * reaches the React note box on its own — the host would look dead the moment
 * the teacher clicked a slide. Forwarding lets the host re-aim the character
 * at the note box and keep the caret where the teacher expects it.
 *
 * Nothing here mutates the deck's own markup, so a deck opened in notes mode
 * is never at risk of being saved back changed.
 */
(function () {
  var PREFIX = 'lfn-'

  /* ── presentation CSS ───────────────────────────────────────────────────
     One page on screen, steps hidden until revealed, and no scrollbar ever:
     a slide is a fixed frame, not a document. Injected from here rather than
     shipped as a second srcdoc chunk so the host only has to glue two things
     together (the deck, and this file). */
  var CSS = ''
    + '.page{display:none!important}'
    + '.page.__lf-active{display:block!important}'
    + '.page .step{opacity:0!important;transform:translateY(14px);transition:opacity .35s ease,transform .35s ease}'
    + '.page .step.__lf-on{opacity:1!important;transform:none}'
    + '.clickable{pointer-events:auto!important;cursor:pointer}'
    + '[data-video] iframe{visibility:hidden!important}'
    + 'html,body{overflow:hidden!important;height:100%!important;max-height:100%!important}'
    + 'html,body,.page,.page *{scrollbar-width:none!important;-ms-overflow-style:none!important}'
    + '::-webkit-scrollbar{width:0!important;height:0!important;display:none!important}'
    + '.wrap.__lf-fitted{max-height:none!important}'
  try {
    var st = document.createElement('style')
    st.id = '__lfn-ctl'
    st.textContent = CSS
    document.head.appendChild(st)
  } catch (err) { /* a deck with no <head> still shows, just unstyled by us */ }

  /* ── steps + page switching ─────────────────────────────────────────── */
  function pages() { return document.querySelectorAll('.page') }

  function pageTitle(pg, i) {
    var el = pg.querySelector('h1,h2,.title,.heading')
    var t = el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : ''
    if (!t) {
      // No heading (house style: a page only gets one if the source slide had
      // one) — fall back to the first run of real text on the slide.
      var body = (pg.textContent || '').replace(/\s+/g, ' ').trim()
      t = body.slice(0, 60)
    }
    return t || 'Slide ' + (i + 1)
  }

  function report(index, step) {
    var ps = pages()
    var act = ps[index]
    parent.postMessage({
      type: PREFIX + 'state',
      index: index,
      step: step,
      stepCount: act ? act.querySelectorAll('.step').length : 0,
      count: ps.length,
    }, '*')
  }

  var cur = 0
  var curStep = 0

  function show(i, step) {
    var ps = pages()
    if (!ps.length) return
    cur = Math.max(0, Math.min(ps.length - 1, i | 0))
    var act = ps[cur]
    var steps = act.querySelectorAll('.step')
    curStep = Math.max(0, Math.min(steps.length, step | 0))
    for (var k = 0; k < ps.length; k++) ps[k].classList.toggle('__lf-active', k === cur)
    for (var s = 0; s < steps.length; s++) steps[s].classList.toggle('__lf-on', s < curStep)
    scheduleFit()
    report(cur, curStep)
  }

  /** One press = one idea: reveal the next step, and only then turn the page. */
  function advance(dir) {
    var ps = pages()
    if (!ps.length) return
    var steps = ps[cur].querySelectorAll('.step').length
    if (dir > 0) {
      if (curStep < steps) show(cur, curStep + 1)
      else if (cur < ps.length - 1) show(cur + 1, 0)
    } else {
      if (curStep > 0) show(cur, curStep - 1)
      else if (cur > 0) {
        var prevSteps = ps[cur - 1].querySelectorAll('.step').length
        show(cur - 1, prevSteps)
      }
    }
  }

  /** Whole-slide jump, ignoring steps (PageUp / PageDown, clicker, rail). */
  function jump(dir) {
    var ps = pages()
    var next = cur + (dir > 0 ? 1 : -1)
    if (next < 0 || next >= ps.length) return
    show(next, dir > 0 ? 0 : ps[next].querySelectorAll('.step').length)
  }

  /* ── auto-fit (same engine as the presenter) ────────────────────────── */
  var LF_GROW_MAX = 1
  var LF_SHRINK_MIN = 0.32
  var fitRaf = 0
  var fitTimers = []

  function baseStyle(el) {
    if (el.__lfBase === undefined) el.__lfBase = el.getAttribute('style') || ''
    return el.__lfBase
  }
  function clearFit(el) {
    var b = baseStyle(el)
    if (b) el.setAttribute('style', b); else el.removeAttribute('style')
    el.classList.remove('__lf-fitted')
  }
  function applyFit(el, k) {
    el.classList.add('__lf-fitted')
    el.style.zoom = k
  }
  function hardenScroll(el) {
    var cs = window.getComputedStyle(el)
    if (/auto|scroll/.test(cs.overflowY + ' ' + cs.overflowX)) el.style.overflow = 'hidden'
  }
  function fitSig(page, wrap) {
    return page.clientHeight + ':' + wrap.offsetHeight + ':' + wrap.scrollHeight
      + ':' + (wrap.style.zoom || '') + ':' + window.innerWidth + 'x' + window.innerHeight
  }
  function fitPage(page) {
    if (!page || document.body.hasAttribute('data-lf-nofit')) return
    var wrap = page.querySelector('.wrap')
    if (!wrap) return
    var sig = fitSig(page, wrap)
    if (wrap.__lfSig === sig) return
    clearFit(wrap)
    var pageH = page.clientHeight
    var availH = wrap.offsetHeight
    if (pageH && availH < pageH * 0.6) availH = Math.max(availH, pageH - wrap.offsetTop)
    if (!(availH > 8)) return
    var k = 1
    for (var pass = 0; pass < 4; pass++) {
      wrap.style.height = 'auto'
      wrap.style.maxHeight = 'none'
      var natural = Math.max(wrap.scrollHeight, wrap.offsetHeight)
      wrap.style.height = ''
      wrap.style.maxHeight = ''
      if (!(natural > 0)) break
      var want = Math.min(LF_GROW_MAX, Math.max(LF_SHRINK_MIN, availH / natural))
      if (!isFinite(want) || want <= 0) break
      var next = k + (want - k) * 0.85
      if (Math.abs(next - k) < 0.004) { k = next; break }
      k = next
      applyFit(wrap, k)
    }
    if (Math.abs(k - 1) < 0.005) clearFit(wrap); else applyFit(wrap, k)
    for (var guard = 0; guard < 3; guard++) {
      if (wrap.scrollHeight - wrap.clientHeight <= 1) break
      k = Math.max(LF_SHRINK_MIN, k * (wrap.clientHeight / wrap.scrollHeight) * 0.99)
      applyFit(wrap, k)
    }
    hardenScroll(wrap)
    hardenScroll(page)
    wrap.__lfSig = fitSig(page, wrap)
  }
  function fitActive() {
    try { fitPage(document.querySelector('.page.__lf-active')) } catch (err) { /* never blank a slide */ }
  }
  function scheduleFit() {
    fitActive()
    if (fitRaf) cancelAnimationFrame(fitRaf)
    fitRaf = requestAnimationFrame(fitActive)
    for (var i = 0; i < fitTimers.length; i++) clearTimeout(fitTimers[i])
    fitTimers = [80, 260, 650, 1300].map(function (d) { return setTimeout(fitActive, d) })
  }

  /* ── keyboard: the deck never keeps a keystroke to itself ───────────── */
  var NAV = {
    ArrowRight: 1, ArrowLeft: 1, ArrowDown: 1, ArrowUp: 1,
    PageDown: 1, PageUp: 1, Home: 1, End: 1, ' ': 1, Spacebar: 1,
    Enter: 1, Backspace: 1, Escape: 1, Tab: 1,
  }
  document.addEventListener('keydown', function (e) {
    // A deck may bind keys of its own (the fixed-canvas decks use 1–7 and +/-
    // for a text-size level). Those still run: only the keys the host owns are
    // cancelled here, everything else is forwarded *and* left alone.
    parent.postMessage({
      type: PREFIX + 'key',
      key: e.key,
      ctrl: !!(e.ctrlKey || e.metaKey),
      shift: !!e.shiftKey,
      alt: !!e.altKey,
    }, '*')
    // Ctrl/Cmd combinations are left alone on purpose — Ctrl+C inside a slide
    // must keep copying.
    if (NAV[e.key] && !(e.ctrlKey || e.metaKey)) e.preventDefault()
    else setTimeout(scheduleFit, 0)
  }, true)

  /* ── host messages ──────────────────────────────────────────────────── */
  window.addEventListener('message', function (e) {
    var d = e.data || {}
    if (d.type === PREFIX + 'show') show(d.index, d.step || 0)
    else if (d.type === PREFIX + 'advance') advance(d.dir)
    else if (d.type === PREFIX + 'jump') jump(d.dir)
    else if (d.type === PREFIX + 'refit') scheduleFit()
  })

  /* ── late layout: fonts, images, resize ─────────────────────────────── */
  window.addEventListener('resize', scheduleFit)
  window.addEventListener('orientationchange', scheduleFit)
  if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleFit)
  if (window.ResizeObserver) {
    try { new ResizeObserver(scheduleFit).observe(document.documentElement) } catch (err) { /* ignore */ }
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleFit).catch(function () {})
  document.addEventListener('load', function (e) {
    var t = e.target
    if (t && (t.tagName === 'IMG' || t.tagName === 'IFRAME')) scheduleFit()
  }, true)
  document.addEventListener('click', function () { setTimeout(scheduleFit, 0) }, true)

  function sendPages() {
    var ps = pages()
    var metas = []
    for (var i = 0; i < ps.length; i++) {
      metas.push({
        index: i,
        title: pageTitle(ps[i], i),
        stepCount: ps[i].querySelectorAll('.step').length,
      })
    }
    parent.postMessage({ type: PREFIX + 'ready', pages: metas }, '*')
  }

  sendPages()
  show(0, 0)
  // Titles and step counts can change once a deck's own script has run, but the
  // slide the teacher is on must NOT — re-announcing the pages here while
  // calling show(0,0) again would throw them back to slide 1 the moment a late
  // image landed.
  window.addEventListener('load', function () { scheduleFit(); sendPages(); report(cur, curStep) })
})()
