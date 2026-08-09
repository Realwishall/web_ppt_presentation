/* eslint-disable no-undef, no-empty */
/**
 * DECK EDITOR RUNTIME — runs INSIDE the deck's sandboxed iframe.
 *
 * This file is never imported as a module. `deckEditFrame.js` pulls it in with
 * Vite's `?raw` loader and appends it to the deck's own HTML as the srcdoc of
 * an `<iframe sandbox="allow-scripts">` — exactly the way `presenter.html`
 * appends its `deckController`. So: no imports, no exports, no optional
 * chaining on `parent`, and everything talks to the host over postMessage.
 *
 * Why the editor lives in here at all, rather than in React next to the board:
 * a deck sizes itself with `vmin` / `clamp()` and its own inline CSS, and the
 * only place those resolve correctly is a viewport that is the real board size.
 * Measuring or rewriting a font size from outside the frame would be measuring
 * the wrong box — which is the "trial and error" problem this feature exists
 * to kill.
 *
 * ── Contract with the presenter ──────────────────────────────────────────────
 * The presenter reveals `.step` elements in DOM order
 * (`steps[k].classList.toggle("__lf-on", k < step)`), and counts one press per
 * `.step`. Two consequences this runtime is built around:
 *   • Re-ordering an animation step means moving the element in the DOM.
 *   • A `.step` inside another `.step` is invalid (the deck gate rejects it).
 *
 * ── Messages IN (host → frame) ───────────────────────────────────────────────
 *   lfe-show            {index}                     switch slide
 *   lfe-reveal          {count}                     -1 = reveal every step
 *   lfe-mode            {mode:'select'|'text'}
 *   lfe-pick            {uid, additive, range}      programmatic selection
 *   lfe-select-similar  {scope:'page'|'deck', matchSize}
 *   lfe-clear
 *   lfe-font            {op:'scale'|'set', value, unit, scope}
 *   lfe-space           {prop:'lineHeight'|'letterSpacing'|'margin'|'padding', delta, scope}
 *   lfe-delete          {scope}
 *   lfe-step-set        {on:boolean, scope}
 *   lfe-step-group      {}
 *   lfe-step-move       {from, to, preserveLayout}
 *   lfe-autofit         {}
 *   lfe-undo | lfe-redo
 *   lfe-html            {requestId}                 serialize for save
 *   lfe-refit
 *
 * ── Messages OUT (frame → host) ──────────────────────────────────────────────
 *   lfe-ready  {pages:[{title, stepCount}]}
 *   lfe-state  {…}   the single source of truth for every sidebar control
 *   lfe-doc    {requestId, html}
 */
(function () {
  'use strict';

  /* ════════════════════════════════════════════════════════════════════════
     0. HOUSEKEEPING
     Everything this runtime adds to the document is tagged `data-lfe-own`
     and is stripped again before the HTML is handed back to be saved.
     ════════════════════════════════════════════════════════════════════════ */

  var OWN = 'data-lfe-own';
  var UID = 'data-lfe-uid';
  var uidSeq = 0;
  var post = function (m) { try { parent.postMessage(m, '*'); } catch (e) {} };

  function own(el) { el.setAttribute(OWN, '1'); return el; }

  function uidOf(el) {
    if (!el || el.nodeType !== 1) return null;
    var u = el.getAttribute(UID);
    if (!u) { u = 'e' + (++uidSeq); el.setAttribute(UID, u); }
    return u;
  }
  function byUid(u) { return u ? document.querySelector('[' + UID + '="' + u + '"]') : null; }

  var pages = function () { return Array.prototype.slice.call(document.querySelectorAll('.page')); };
  var activePage = function () { return document.querySelector('.page.__lfe-active'); };

  /* ════════════════════════════════════════════════════════════════════════
     1. EDITOR CHROME (injected CSS)
     Deliberately drawn INSIDE the frame: the board is CSS-scaled by the host,
     so an overlay painted out there would need the scale applied by hand and
     would drift by a pixel on every resize. In here, outlines scale with the
     slide for free and land exactly on the element.
     ════════════════════════════════════════════════════════════════════════ */

  var chrome = own(document.createElement('style'));
  chrome.textContent = [
    /* Paging + steps: same rules the presenter injects, so what you edit is */
    /* laid out byte-for-byte the way it will be taught.                     */
    '.page{display:none!important}',
    '.page.__lfe-active{display:block!important;opacity:1!important}',
    '.page .step{opacity:.28!important;transition:none!important;transform:none!important}',
    '.page .step.__lfe-on{opacity:1!important;visibility:visible!important}',
    'html,body{overflow:hidden!important;height:100%!important;max-height:100%!important}',
    'html,body,.page,.page *{scrollbar-width:none!important;-ms-overflow-style:none!important}',
    '::-webkit-scrollbar{width:0!important;height:0!important;display:none!important}',
    '.wrap.__lfe-fitted{max-height:none!important}',
    /* Motion off while editing — a slide that is still animating cannot be
       measured, and a looping figure next to a font-size button is noise.

       transition-duration MUST be 0s here, not the 1ms the presenter uses.
       `transition-property` defaults to `all`, so a non-zero duration makes
       EVERY property transition — font-size included. getComputedStyle then
       reports the interpolated (i.e. old) size for that millisecond, and this
       whole panel reads back the value it just replaced: a bump appears to do
       nothing, and auto-fit measures a slide it has already shrunk. Animations
       stay at 1ms so a keyframe with fill-mode:forwards still lands. */
    'html.__lfe-still *,html.__lfe-still *::before,html.__lfe-still *::after{',
    'animation-duration:1ms!important;animation-delay:0s!important;',
    'animation-iteration-count:1!important;',
    'transition-duration:0s!important;transition-delay:0s!important;}',

    /* selection + hover affordances */
    '[' + UID + '].__lfe-hot{outline:2px dashed rgba(129,140,248,.9)!important;outline-offset:2px!important;cursor:pointer!important}',
    '[' + UID + '].__lfe-sel{outline:2.5px solid #6366f1!important;outline-offset:2px!important;',
    'background-image:linear-gradient(rgba(99,102,241,.16),rgba(99,102,241,.16))!important}',
    '[' + UID + '].__lfe-kin{outline:2px dotted rgba(244,114,182,.95)!important;outline-offset:2px!important}',
    '[' + UID + '].__lfe-edit{outline:2.5px solid #22c55e!important;outline-offset:2px!important;',
    'background-image:linear-gradient(rgba(34,197,94,.12),rgba(34,197,94,.12))!important;cursor:text!important}',
    /* Step badge — sits on the element, numbered in reveal order.           */
    '.__lfe-badge{position:absolute;z-index:2147483000;pointer-events:none;',
    'font:600 11px/1 ui-sans-serif,system-ui,sans-serif;color:#fff;background:#7c3aed;',
    'padding:3px 6px;border-radius:999px;box-shadow:0 1px 4px rgba(0,0,0,.5);transform:translate(-50%,-115%)}',
    '.__lfe-marquee{position:fixed;z-index:2147483001;border:1.5px solid #6366f1;',
    'background:rgba(99,102,241,.14);pointer-events:none;border-radius:3px}',
    /* The host paints no cursor of its own — this frame owns the pointer.   */
    'html.__lfe-picking,html.__lfe-picking body{cursor:crosshair!important}',
  ].join('\n');
  document.head ? document.head.appendChild(chrome) : document.documentElement.appendChild(chrome);
  document.documentElement.classList.add('__lfe-still');

  var badgeLayer = own(document.createElement('div'));
  badgeLayer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000';
  var marquee = own(document.createElement('div'));
  marquee.className = '__lfe-marquee';
  marquee.style.display = 'none';

  function mountLayers() {
    if (!document.body) return;
    if (!badgeLayer.parentNode) document.body.appendChild(badgeLayer);
    if (!marquee.parentNode) document.body.appendChild(marquee);
  }

  /* ════════════════════════════════════════════════════════════════════════
     2. AUTO-FIT — a faithful copy of the presenter's engine
     Not shared code, and that is a deliberate trade. `presenter.html` is one
     self-contained static file that the live board loads; refactoring its
     controller into a module would put the teaching engine at risk to serve
     the editor. The rule is: this block is a MIRROR. If the presenter's fit
     changes, change it here in the same commit, or the editor stops predicting
     the board — which is the whole point of the feature.
     ════════════════════════════════════════════════════════════════════════ */

  var GROW_MAX = 1;      /* never enlarge: the authored size is the ceiling */
  var SHRINK_MIN = 0.32; /* floor, so a runaway page still shows something  */
  var fitRaf = 0, fitTimers = [];
  var lastFit = { zoom: 1, overflow: 0 };

  function baseStyle(el) {
    if (el.__lfeBase === undefined) el.__lfeBase = el.getAttribute('style') || '';
    return el.__lfeBase;
  }
  function clearFit(el) {
    var b = baseStyle(el);
    if (b) el.setAttribute('style', b); else el.removeAttribute('style');
    el.classList.remove('__lfe-fitted');
  }
  function applyFit(el, k) { el.classList.add('__lfe-fitted'); el.style.zoom = k; }
  function hardenScroll(el) {
    var cs = window.getComputedStyle(el);
    if (/auto|scroll/.test(cs.overflowY + ' ' + cs.overflowX)) el.style.overflow = 'hidden';
  }

  function fitPage(page) {
    if (!page) return 1;
    var wrap = page.querySelector('.wrap');
    if (!wrap) return 1;
    clearFit(wrap);
    /* Layout pixels only — never a client rect. A deck may already sit under
       a scale of its own, and a rect would hand that back baked in. */
    var pageH = page.clientHeight;
    var availH = wrap.offsetHeight;
    if (pageH && availH < pageH * 0.6) availH = Math.max(availH, pageH - wrap.offsetTop);
    if (!(availH > 8)) return 1;

    var k = 1;
    for (var pass = 0; pass < 4; pass++) {
      wrap.style.height = 'auto';
      wrap.style.maxHeight = 'none';
      var natural = Math.max(wrap.scrollHeight, wrap.offsetHeight);
      wrap.style.height = '';
      wrap.style.maxHeight = '';
      if (!(natural > 0)) break;
      var want = Math.min(GROW_MAX, Math.max(SHRINK_MIN, availH / natural));
      if (!isFinite(want) || want <= 0) break;
      var next = k + (want - k) * 0.85;              /* damped: don't ring */
      if (Math.abs(next - k) < 0.004) { k = next; break; }
      k = next;
      applyFit(wrap, k);
    }
    if (Math.abs(k - 1) < 0.005) { clearFit(wrap); k = 1; } else applyFit(wrap, k);

    for (var guard = 0; guard < 3; guard++) {
      if (wrap.scrollHeight - wrap.clientHeight <= 1) break;
      k = Math.max(SHRINK_MIN, k * (wrap.clientHeight / wrap.scrollHeight) * 0.99);
      applyFit(wrap, k);
    }
    hardenScroll(wrap);
    hardenScroll(page);
    lastFit = { zoom: k, overflow: Math.max(0, wrap.scrollHeight - wrap.clientHeight) };
    return k;
  }

  function fitActive() { try { return fitPage(activePage()); } catch (e) { return 1; } }

  function scheduleFit(quiet) {
    fitActive();
    if (fitRaf) cancelAnimationFrame(fitRaf);
    fitRaf = requestAnimationFrame(function () { fitActive(); placeBadges(); if (!quiet) emit(); });
    for (var i = 0; i < fitTimers.length; i++) clearTimeout(fitTimers[i]);
    fitTimers = [80, 260, 650].map(function (d) {
      return setTimeout(function () { fitActive(); placeBadges(); if (!quiet) emit(); }, d);
    });
  }

  /* ════════════════════════════════════════════════════════════════════════
     3. FONT-SIZE MATH
     The hard part. Two things fight you:
       • Decks author sizes as `clamp(19px,3.7vmin,42px)`, so there is no plain
         number to add to.
       • The fit engine may have a `zoom` on the ancestor `.wrap`, and browsers
         disagree about whether getComputedStyle().fontSize hands that back.
     Both are solved by measuring instead of assuming: drop a probe with a
     KNOWN font-size next to the element and see what the browser reports. The
     ratio is whatever scaling is in force, whatever caused it.
     ════════════════════════════════════════════════════════════════════════ */

  /* Probing costs a DOM insert and a forced style recalc, and a marquee
     selection asks for it once per element per state emit — hundreds of times
     on a "select all similar in the deck". Elements overwhelmingly share a
     parent, and the answer only depends on the parent, so a cache keyed on it
     collapses that to a handful. Set ONLY around read-only passes (`emit`)
     and cleared straight after: during a mutation the DOM is moving and a
     cached scale would be a lie. */
  var scaleCache = null;

  function renderScale(el) {
    var host = el.parentElement || el;
    if (scaleCache) {
      var hit = scaleCache.get(host);
      if (hit !== undefined) return hit;
    }
    var probe = own(document.createElement('span'));
    probe.style.cssText = 'position:absolute!important;visibility:hidden!important;font-size:100px!important;line-height:0!important';
    host.appendChild(probe);
    var k = parseFloat(window.getComputedStyle(probe).fontSize) / 100;
    probe.parentNode.removeChild(probe);
    k = (k && isFinite(k) && k > 0) ? k : 1;
    if (scaleCache) scaleCache.set(host, k);
    return k;
  }

  var vminUnit = function () { return Math.min(window.innerWidth, window.innerHeight) / 100; };

  /** The element's font size as the AUTHOR would have written it — i.e. with
   *  every runtime zoom divided back out. */
  function authoredPx(el) {
    var shown = parseFloat(window.getComputedStyle(el).fontSize) || 0;
    return shown / renderScale(el);
  }

  function parentAuthoredPx(el) {
    var p = el.parentElement;
    return p ? authoredPx(p) : 16;
  }

  function round(n, d) { var f = Math.pow(10, d); return Math.round(n * f) / f; }

  /** Write `px` (an authored, unzoomed pixel size) onto the element in the
   *  unit the teacher asked for. `vmin` is the default because it is what the
   *  authoring contract asks for — a size that follows the board. */
  function writeFont(el, px, unit) {
    if (unit === 'px') { el.style.fontSize = round(px, 1) + 'px'; return; }
    if (unit === 'em') {
      var pp = parentAuthoredPx(el) || 16;
      el.style.fontSize = round(px / pp, 3) + 'em';
      return;
    }
    el.style.fontSize = round(px / vminUnit(), 3) + 'vmin';
  }

  function fontInfo(el) {
    var px = authoredPx(el);
    return { px: round(px, 1), vmin: round(px / vminUnit(), 2) };
  }

  /* ════════════════════════════════════════════════════════════════════════
     4. SELECTION + "ALL SIMILAR"
     "Similar" is tag + class signature, because that is what a deck's own CSS
     keys off — restyling every `.eq` on the slide is the edit the teacher
     actually wants. Font size is an optional extra key for decks where one
     class is used at two deliberate sizes.
     ════════════════════════════════════════════════════════════════════════ */

  var sel = [];                       /* uids, in click order */
  var mode = 'select';                /* 'select' | 'text' */

  var SKIP = /^(__lfe-|__lf-)/;
  function classSig(el) {
    var out = [];
    for (var i = 0; i < el.classList.length; i++) {
      var c = el.classList[i];
      if (SKIP.test(c) || c === 'step') continue;      /* step is state, not identity */
      out.push(c);
    }
    return out.sort().join('.');
  }
  function signature(el) { return el.tagName.toLowerCase() + '|' + classSig(el); }

  function similarTo(el, scope, matchSize) {
    var root = scope === 'deck' ? document : (el.closest('.page') || document);
    var sig = signature(el);
    var size = matchSize ? Math.round(authoredPx(el)) : null;
    var all = root.querySelectorAll(el.tagName.toLowerCase());
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var n = all[i];
      if (n.hasAttribute(OWN) || n.closest('[' + OWN + ']')) continue;
      if (signature(n) !== sig) continue;
      if (size !== null && Math.abs(Math.round(authoredPx(n)) - size) > 1) continue;
      out.push(n);
    }
    return out;
  }

  /** Every element the current command should act on. */
  function targets(scope) {
    var picked = sel.map(byUid).filter(Boolean);
    if (!picked.length) return [];
    if (scope === 'element' || !scope) return picked;
    if (scope === 'selection') return picked;
    var seen = [], out = [];
    picked.forEach(function (el) {
      similarTo(el, scope === 'deck' ? 'deck' : 'page', simMatchSize).forEach(function (n) {
        if (seen.indexOf(n) < 0) { seen.push(n); out.push(n); }
      });
    });
    return out;
  }
  var simMatchSize = false;

  function paint() {
    document.querySelectorAll('.__lfe-sel,.__lfe-kin').forEach(function (n) {
      n.classList.remove('__lfe-sel', '__lfe-kin');
    });
    var picked = sel.map(byUid).filter(Boolean);
    /* Show the blast radius before the teacher commits: everything that a  */
    /* "similar" command would hit gets a dotted pink outline.              */
    if (picked.length === 1) {
      similarTo(picked[0], 'page', simMatchSize).forEach(function (n) { n.classList.add('__lfe-kin'); });
    }
    picked.forEach(function (n) { n.classList.remove('__lfe-kin'); n.classList.add('__lfe-sel'); });
  }

  /* ════════════════════════════════════════════════════════════════════════
     5. UNDO / REDO
     Snapshot-per-command over the active page's innerHTML. Coarse on purpose:
     a diff engine would be a week of work and a font bump is cheap to store,
     while "I broke the slide, get it back" has to be instant and total.
     Selection is restored by uid, which survives because uids live in the
     markup that was snapshotted.
     ════════════════════════════════════════════════════════════════════════ */

  var undoStack = [], redoStack = [], DEPTH = 60;
  /* Monotonic edit counter. The host uses it, not the undo depth, to decide
     whether the document differs from what was last saved: undoing back to the
     start is still a change if a save happened in between. */
  var rev = 0;

  function snapshot() {
    var p = activePage();
    if (!p) return null;
    return { uid: uidOf(p), html: p.innerHTML, sel: sel.slice() };
  }
  function restore(s) {
    if (!s) return;
    var p = byUid(s.uid);
    if (!p) return;
    p.innerHTML = s.html;
    sel = s.sel.filter(function (u) { return !!byUid(u); });
  }
  /** Wrap a mutation so it is undoable. Returns whatever `fn` returns. */
  function commit(label, fn) {
    var before = snapshot();
    var r = fn();
    if (r === false) return false;                 /* command declined — no entry */
    if (before) {
      undoStack.push(before);
      if (undoStack.length > DEPTH) undoStack.shift();
      redoStack.length = 0;
      lastLabel = label;
      rev++;
    }
    after();
    return r;
  }
  var lastLabel = '';

  function undo() {
    if (!undoStack.length) return;
    var now = snapshot();
    restore(undoStack.pop());
    if (now) redoStack.push(now);
    rev++;
    after();
  }
  function redo() {
    if (!redoStack.length) return;
    var now = snapshot();
    restore(redoStack.pop());
    if (now) undoStack.push(now);
    rev++;
    after();
  }

  /** Everything that must happen after the DOM changed, in the right order. */
  function after() {
    revealSteps(revealCount);
    paint();
    scheduleFit(true);
    placeBadges();
    emit();
  }

  /* ════════════════════════════════════════════════════════════════════════
     6. ANIMATION STEPS
     A step IS an element carrying `class="step"`. The presenter reveals them
     in DOM order, so:
       • create  → add the class (refusing a nested step, which the gate bans)
       • delete  → remove the class; the element stays, it just stops waiting
       • reorder → move the element in the DOM
     Reordering therefore moves the element ON THE SLIDE too. When the steps
     share a flex/grid parent we can have it both ways: move in the DOM for
     reveal order, then write `order:` back so the layout does not budge.
     ════════════════════════════════════════════════════════════════════════ */

  var revealCount = -1;   /* -1 = reveal everything (the editing default) */

  function stepsOf(page) {
    return page ? Array.prototype.slice.call(page.querySelectorAll('.step')) : [];
  }

  function revealSteps(n) {
    revealCount = n;
    var p = activePage();
    if (!p) return;
    var st = stepsOf(p);
    for (var i = 0; i < st.length; i++) st[i].classList.toggle('__lfe-on', n < 0 || i < n);
  }

  function setStep(on, scope) {
    var list = targets(scope);
    if (!list.length) return false;
    var refused = 0;
    list.forEach(function (el) {
      if (on) {
        /* Rule 19 of the authoring contract, enforced here so a bad deck can */
        /* never be authored in the first place: no `.step` inside a `.step`. */
        if (el.closest('.step') && el.closest('.step') !== el) { refused++; return; }
        if (el.querySelector('.step')) { refused++; return; }
        if (!el.closest('.page')) { refused++; return; }
        el.classList.add('step');
      } else {
        el.classList.remove('step');
        el.classList.remove('__lfe-on');
      }
    });
    if (refused) note(refused + ' element' + (refused === 1 ? '' : 's') +
      ' skipped — a step may not sit inside or contain another step.');
    return true;
  }

  /** Several selected elements → one press. Wraps them in a `div.step`,
   *  which is the only way the presenter can reveal a group at once. */
  function groupStep() {
    var list = sel.map(byUid).filter(Boolean);
    if (list.length < 2) { note('Select two or more elements to group them into one step.'); return false; }
    var parent = list[0].parentNode;
    for (var i = 1; i < list.length; i++) {
      if (list[i].parentNode !== parent) {
        note('Grouping needs elements that share the same parent.');
        return false;
      }
    }
    if (parent.closest && parent.closest('.step')) { note('That group would sit inside another step.'); return false; }
    /* Keep them in document order, not click order. */
    list.sort(function (a, b) {
      return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
    });
    var box = document.createElement('div');
    box.className = 'step';
    parent.insertBefore(box, list[0]);
    list.forEach(function (el) { el.classList.remove('step'); box.appendChild(el); });
    sel = [uidOf(box)];
    return true;
  }

  function moveStep(from, to, preserveLayout) {
    var p = activePage();
    var st = stepsOf(p);
    if (from === to || from < 0 || to < 0 || from >= st.length || to >= st.length) return false;

    var moving = st[from];
    var siblings = null, visualOrder = null;
    /* Snapshot the on-screen order of the flex/grid row we are about to     */
    /* disturb, so it can be pinned back afterwards.                         */
    if (preserveLayout) {
      var par = moving.parentElement;
      var same = st.every(function (n) { return n.parentElement === par; });
      var disp = par ? window.getComputedStyle(par).display : '';
      if (same && /flex|grid/.test(disp)) {
        siblings = Array.prototype.slice.call(par.children).filter(function (n) { return !n.hasAttribute(OWN); });
        visualOrder = siblings.slice();
      }
    }

    var next = st.slice();
    next.splice(to, 0, next.splice(from, 1)[0]);
    /* Re-lay the steps in their new order, anchored on the first one's slot. */
    var anchor = st[0];
    var parentNode = anchor.parentNode;
    var okSameParent = next.every(function (n) { return n.parentNode === parentNode; });
    if (okSameParent) {
      var marker = document.createComment('lfe');
      parentNode.insertBefore(marker, anchor);
      next.forEach(function (n) { parentNode.insertBefore(n, marker); });
      parentNode.removeChild(marker);
    } else {
      /* Steps spread across different parents: the only meaningful move is  */
      /* to place the dragged element beside its new neighbour.              */
      var ref = st[to];
      if (to > from) ref.parentNode.insertBefore(moving, ref.nextSibling);
      else ref.parentNode.insertBefore(moving, ref);
    }

    if (visualOrder) {
      visualOrder.forEach(function (n, i) { n.style.order = String(i + 1); });
      note('Reveal order changed; the slide layout was pinned with CSS order.');
    }
    return true;
  }

  /* ════════════════════════════════════════════════════════════════════════
     7. COMMANDS
     ════════════════════════════════════════════════════════════════════════ */

  function scaleFont(list, factor, unit) {
    list.forEach(function (el) {
      var px = authoredPx(el);
      if (!(px > 0)) return;
      writeFont(el, Math.min(400, Math.max(4, px * factor)), unit);
    });
  }

  function setFont(list, value, unit) {
    list.forEach(function (el) {
      var px = unit === 'vmin' ? value * vminUnit()
        : unit === 'em' ? value * (parentAuthoredPx(el) || 16)
          : value;
      writeFont(el, Math.min(400, Math.max(4, px)), unit);
    });
  }

  var SPACE_UNIT = { lineHeight: 0.05, letterSpacing: 0.01, margin: 0.25, padding: 0.25 };

  function nudgeSpace(list, prop, delta) {
    list.forEach(function (el) {
      var cs = window.getComputedStyle(el);
      var k = renderScale(el);
      if (prop === 'lineHeight') {
        var lh = parseFloat(cs.lineHeight) / k;
        var fs = authoredPx(el) || 16;
        var ratio = isFinite(lh) && fs ? lh / fs : 1.4;
        el.style.lineHeight = round(Math.max(0.6, ratio + delta * SPACE_UNIT.lineHeight), 3);
      } else if (prop === 'letterSpacing') {
        var ls = parseFloat(cs.letterSpacing);
        if (!isFinite(ls)) ls = 0;
        el.style.letterSpacing = round(ls / k + delta * SPACE_UNIT.letterSpacing * (authoredPx(el) || 16), 2) + 'px';
      } else {
        /* margin / padding move in em so they keep following the font size. */
        var cur = parseFloat(cs[prop === 'margin' ? 'marginBottom' : 'paddingBottom']) / k || 0;
        var em = (authoredPx(el) || 16);
        var nextV = Math.max(0, cur / em + delta * SPACE_UNIT[prop]);
        if (prop === 'margin') el.style.marginBottom = round(nextV, 3) + 'em';
        else el.style.padding = round(nextV, 3) + 'em';
      }
    });
  }

  function removeEls(list) {
    if (!list.length) return false;
    var pageGone = list.some(function (el) { return el.classList.contains('page'); });
    if (pageGone) { note('Use the slide list to remove a whole slide.'); return false; }
    list.forEach(function (el) { if (el.parentNode) el.parentNode.removeChild(el); });
    sel = [];
    return true;
  }

  /** One-click fix for "the board is shrinking my slide".
   *  The fit engine already knows the answer — it is applying zoom `k`. Bake
   *  that k into the authored sizes ONCE, on the outermost elements that
   *  actually carry text, so nested sizes are not multiplied twice. */
  function autoFit(unit) {
    var p = activePage();
    if (!p) return false;
    var k = fitPage(p);
    if (k >= 0.995) { note('This slide already fits — nothing to shrink.'); return false; }
    var list = topLevelText(p);
    if (!list.length) { note('No text elements found to shrink on this slide.'); return false; }
    scaleFont(list, k * 0.985, unit);              /* a hair under, for wrap drift */
    /* Re-solve and take a second, gentler pass if the re-wrap moved the mark. */
    var k2 = fitPage(p);
    if (k2 < 0.985) scaleFont(topLevelText(p), k2 * 0.99, unit);
    note('Shrunk this slide to fit — it now renders at its authored size.');
    return true;
  }

  /** Elements holding real text of their own, with no ancestor already in the
   *  set — so scaling the set scales every character exactly once. */
  function topLevelText(page) {
    var all = Array.prototype.slice.call(page.querySelectorAll('*'));
    var hits = all.filter(function (el) {
      if (el.hasAttribute(OWN)) return false;
      if (/^(SCRIPT|STYLE|CANVAS|SVG|IMG|VIDEO|BR)$/.test(el.tagName)) return false;
      if (el.closest('svg')) return false;
      for (var i = 0; i < el.childNodes.length; i++) {
        var n = el.childNodes[i];
        if (n.nodeType === 3 && n.nodeValue.trim()) return true;
      }
      return false;
    });
    return hits.filter(function (el) {
      return !hits.some(function (o) { return o !== el && o.contains(el); });
    });
  }

  /* ════════════════════════════════════════════════════════════════════════
     8. POINTER — click to select, shift to add, drag empty space to marquee
     Every deck event is swallowed in select mode. A deck ships its own click
     handlers (`.clickable` reveals answers, figures re-lay themselves out) and
     a stray one mid-edit would change the slide under the teacher's hands.
     ════════════════════════════════════════════════════════════════════════ */

  var EDITABLE_SKIP = /^(HTML|BODY|SCRIPT|STYLE|LINK|META|HEAD)$/;

  function pickAt(x, y) {
    var el = document.elementFromPoint(x, y);
    while (el && el.nodeType === 1) {
      if (el.hasAttribute && el.hasAttribute(OWN)) return null;
      if (EDITABLE_SKIP.test(el.tagName) || el.classList.contains('page')) return null;
      /* Never hand back something inside an <svg>: its children are not */
      /* independently styleable in the way this panel implies.          */
      if (el.tagName === 'svg' || !el.closest('svg')) return el;
      el = el.closest('svg');
    }
    return null;
  }

  var down = null, marqueeOn = false;

  function onDown(e) {
    if (mode === 'text') return;
    e.preventDefault(); e.stopPropagation();
    down = { x: e.clientX, y: e.clientY, add: e.shiftKey || e.ctrlKey || e.metaKey, t: Date.now() };
    var el = pickAt(e.clientX, e.clientY);
    marqueeOn = !el;
    if (marqueeOn) {
      marquee.style.display = 'block';
      marquee.style.left = e.clientX + 'px'; marquee.style.top = e.clientY + 'px';
      marquee.style.width = '0px'; marquee.style.height = '0px';
    }
  }

  function onMove(e) {
    if (mode === 'text') return;
    if (!down) {
      var hot = pickAt(e.clientX, e.clientY);
      document.querySelectorAll('.__lfe-hot').forEach(function (n) { n.classList.remove('__lfe-hot'); });
      if (hot && !hot.classList.contains('__lfe-sel')) { uidOf(hot); hot.classList.add('__lfe-hot'); }
      return;
    }
    if (!marqueeOn) return;
    var x = Math.min(down.x, e.clientX), y = Math.min(down.y, e.clientY);
    marquee.style.left = x + 'px'; marquee.style.top = y + 'px';
    marquee.style.width = Math.abs(e.clientX - down.x) + 'px';
    marquee.style.height = Math.abs(e.clientY - down.y) + 'px';
  }

  function onUp(e) {
    if (mode === 'text' || !down) { down = null; return; }
    e.preventDefault(); e.stopPropagation();
    var moved = Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y);

    if (marqueeOn && moved > 6) {
      var box = {
        l: Math.min(down.x, e.clientX), r: Math.max(down.x, e.clientX),
        t: Math.min(down.y, e.clientY), b: Math.max(down.y, e.clientY),
      };
      var hits = marqueeHits(box);
      var next = down.add ? sel.slice() : [];
      hits.forEach(function (el) { var u = uidOf(el); if (next.indexOf(u) < 0) next.push(u); });
      sel = next;
    } else if (!marqueeOn) {
      var el2 = pickAt(e.clientX, e.clientY);
      if (el2) {
        var u2 = uidOf(el2);
        if (down.add) {
          var at = sel.indexOf(u2);
          if (at >= 0) sel.splice(at, 1); else sel.push(u2);
        } else sel = [u2];
      } else if (!down.add) sel = [];
    }
    marquee.style.display = 'none';
    down = null; marqueeOn = false;
    paint(); emit();
  }

  /** Marquee picks the OUTERMOST element fully inside the box — dragging over
   *  a paragraph should give you the paragraph, not its four `<b>` runs. */
  function marqueeHits(box) {
    var page = activePage();
    if (!page) return [];
    var all = Array.prototype.slice.call(page.querySelectorAll('*'));
    var inside = all.filter(function (el) {
      if (el.hasAttribute(OWN) || el.closest('[' + OWN + ']')) return false;
      if (EDITABLE_SKIP.test(el.tagName) || el.closest('svg') === el) return false;
      var r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return false;
      return r.left >= box.l - 1 && r.right <= box.r + 1 && r.top >= box.t - 1 && r.bottom <= box.b + 1;
    });
    return inside.filter(function (el) {
      return !inside.some(function (o) { return o !== el && o.contains(el); });
    });
  }

  /* ── Inline text editing ─────────────────────────────────────────────────
     Double-click turns the element contenteditable. Committed on blur or
     Escape, and pushed through `commit` so it lands on the undo stack like
     any other edit. Text mode also lifts the pointer blockade above, because
     a caret needs the browser's own mouse handling. */
  var editing = null, editingBefore = null;

  function startTextEdit(el) {
    if (!el || editing === el) return;
    stopTextEdit();
    editing = el;
    editingBefore = snapshot();
    el.classList.add('__lfe-edit');
    el.setAttribute('contenteditable', 'true');
    el.focus();
    mode = 'text';
    emit();
  }
  function stopTextEdit() {
    if (!editing) return;
    var el = editing, before = editingBefore;
    editing = null; editingBefore = null;
    el.removeAttribute('contenteditable');
    el.classList.remove('__lfe-edit');
    mode = 'select';
    if (before) {
      undoStack.push(before);
      if (undoStack.length > DEPTH) undoStack.shift();
      redoStack.length = 0;
      rev++;
    }
    after();
  }

  document.addEventListener('dblclick', function (e) {
    var el = pickAt(e.clientX, e.clientY);
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    startTextEdit(el);
  }, true);

  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerup', onUp, true);
  /* Belt and braces: a deck's own listeners sit on click, not pointer. */
  ['click', 'mousedown', 'mouseup', 'submit'].forEach(function (t) {
    document.addEventListener(t, function (e) {
      if (mode === 'text') return;
      if (e.target && e.target.hasAttribute && e.target.hasAttribute(OWN)) return;
      e.preventDefault(); e.stopPropagation();
    }, true);
  });

  document.addEventListener('keydown', function (e) {
    if (mode === 'text') {
      if (e.key === 'Escape') { e.preventDefault(); stopTextEdit(); }
      return;
    }
    var meta = e.ctrlKey || e.metaKey;
    if (meta && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    } else if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!sel.length) return;
      e.preventDefault();
      commit('delete', function () { return removeEls(targets('element')); });
    } else if (e.key === 'Escape') { sel = []; paint(); emit(); }
  }, true);

  /* ════════════════════════════════════════════════════════════════════════
     9. STEP BADGES
     ════════════════════════════════════════════════════════════════════════ */

  function placeBadges() {
    mountLayers();
    badgeLayer.textContent = '';
    var p = activePage();
    if (!p) return;
    stepsOf(p).forEach(function (el, i) {
      var r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      var b = own(document.createElement('span'));
      b.className = '__lfe-badge';
      b.textContent = String(i + 1);
      b.style.left = (r.left + 14) + 'px';
      b.style.top = r.top + 'px';
      badgeLayer.appendChild(b);
    });
  }

  /* ════════════════════════════════════════════════════════════════════════
     10. STATE OUT
     ════════════════════════════════════════════════════════════════════════ */

  var noteText = '';
  function note(t) { noteText = t; }

  function label(el) {
    var t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (t.length > 46) t = t.slice(0, 46) + '…';
    if (!t) t = '<' + el.tagName.toLowerCase() + '>';
    return t;
  }

  function describe(el) {
    var f = fontInfo(el);
    return {
      uid: uidOf(el),
      tag: el.tagName.toLowerCase(),
      classes: classSig(el).split('.').filter(Boolean),
      text: label(el),
      isStep: el.classList.contains('step'),
      fontPx: f.px,
      fontVmin: f.vmin,
      inlineFont: el.style.fontSize || '',
    };
  }

  function emit() {
    scaleCache = new Map();          /* read-only pass — safe to memoise */
    var p = activePage();
    var picked = sel.map(byUid).filter(Boolean);
    var one = picked.length === 1 ? picked[0] : null;
    post({
      type: 'lfe-state',
      index: pages().indexOf(p),
      mode: mode,
      selection: picked.map(describe),
      similarOnPage: one ? similarTo(one, 'page', simMatchSize).length : 0,
      similarInDeck: one ? similarTo(one, 'deck', simMatchSize).length : 0,
      steps: stepsOf(p).map(function (el) {
        return { uid: uidOf(el), tag: el.tagName.toLowerCase(), text: label(el), selected: sel.indexOf(uidOf(el)) >= 0 };
      }),
      stepParentIsFlex: stepFlexHint(p),
      reveal: revealCount,
      fitZoom: round(lastFit.zoom, 3),
      overflow: Math.round(lastFit.overflow),
      rev: rev,
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      lastLabel: lastLabel,
      note: noteText,
      board: { w: window.innerWidth, h: window.innerHeight, vmin: round(vminUnit(), 3) },
    });
    scaleCache = null;
    noteText = '';
  }

  function stepFlexHint(p) {
    var st = stepsOf(p);
    if (st.length < 2) return false;
    var par = st[0].parentElement;
    if (!par || !st.every(function (n) { return n.parentElement === par; })) return false;
    return /flex|grid/.test(window.getComputedStyle(par).display);
  }

  /* ════════════════════════════════════════════════════════════════════════
     11. SERIALIZE — hand back a deck file, not an editor session
     Every trace of this runtime comes out: our nodes, our attributes, our
     classes, and the `zoom` the fit engine parked on `.wrap`. What is left is
     the author's document plus the edits.
     ════════════════════════════════════════════════════════════════════════ */

  function serialize() {
    var clone = document.documentElement.cloneNode(true);
    clone.className = (clone.className || '').replace(/__lfe?-[\w-]+/g, '').trim();
    clone.removeAttribute('style');

    clone.querySelectorAll('[' + OWN + ']').forEach(function (n) { n.remove(); });
    clone.querySelectorAll('[' + UID + ']').forEach(function (n) { n.removeAttribute(UID); });
    clone.querySelectorAll('[contenteditable]').forEach(function (n) { n.removeAttribute('contenteditable'); });

    clone.querySelectorAll('*').forEach(function (n) {
      if (n.classList && n.classList.length) {
        var drop = [];
        for (var i = 0; i < n.classList.length; i++) {
          if (/^__lfe?-/.test(n.classList[i])) drop.push(n.classList[i]);
        }
        drop.forEach(function (c) { n.classList.remove(c); });
        if (!n.classList.length) n.removeAttribute('class');
      }
      /* The fit zoom is a runtime measurement, never part of the document. */
      if (n.style && n.style.zoom) n.style.zoom = '';
      if (n.hasAttribute('style') && !n.getAttribute('style').trim()) n.removeAttribute('style');
    });

    var head = clone.querySelector('head');
    if (head && !head.innerHTML.trim() && !clone.querySelector('body').innerHTML.trim()) return '';

    var doctype = document.doctype ? '<!DOCTYPE ' + document.doctype.name + '>\n' : '<!DOCTYPE html>\n';
    return doctype + clone.outerHTML;
  }

  /* ════════════════════════════════════════════════════════════════════════
     12. HOST BRIDGE
     ════════════════════════════════════════════════════════════════════════ */

  function show(i) {
    var ps = pages();
    if (!ps.length) return;
    i = Math.max(0, Math.min(ps.length - 1, i));
    ps.forEach(function (p, k) { p.classList.toggle('__lfe-active', k === i); });
    sel = [];
    revealSteps(revealCount);
    paint();
    scheduleFit(true);
    placeBadges();
    emit();
  }

  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (!d.type || d.type.indexOf('lfe-') !== 0) return;

    switch (d.type) {
      case 'lfe-show': show(d.index); break;
      case 'lfe-reveal': revealSteps(d.count); placeBadges(); emit(); break;
      case 'lfe-mode':
        if (d.mode === 'select') stopTextEdit();
        else { mode = d.mode; emit(); }
        break;
      case 'lfe-pick': {
        var el = byUid(d.uid);
        if (!el) break;
        if (d.additive) {
          var at = sel.indexOf(d.uid);
          if (at >= 0) sel.splice(at, 1); else sel.push(d.uid);
        } else sel = [d.uid];
        try { el.scrollIntoView({ block: 'nearest' }); } catch (err) {}
        paint(); emit();
        break;
      }
      case 'lfe-match-size': simMatchSize = !!d.on; paint(); emit(); break;
      case 'lfe-select-similar': {
        var seed = sel.map(byUid).filter(Boolean)[0];
        if (!seed) break;
        sel = similarTo(seed, d.scope || 'page', simMatchSize).map(uidOf);
        paint(); emit();
        break;
      }
      case 'lfe-select-all': {
        var p0 = activePage();
        if (!p0) break;
        sel = topLevelText(p0).map(uidOf);
        paint(); emit();
        break;
      }
      case 'lfe-clear': sel = []; paint(); emit(); break;

      case 'lfe-font':
        commit('font', function () {
          var list = targets(d.scope);
          if (!list.length) { note('Select an element first.'); return false; }
          if (d.op === 'set') setFont(list, d.value, d.unit || 'vmin');
          else scaleFont(list, d.value, d.unit || 'vmin');
          return true;
        });
        break;

      case 'lfe-space':
        commit('spacing', function () {
          var list = targets(d.scope);
          if (!list.length) { note('Select an element first.'); return false; }
          nudgeSpace(list, d.prop, d.delta);
          return true;
        });
        break;

      case 'lfe-delete':
        commit('delete', function () {
          var list = targets(d.scope);
          if (!list.length) { note('Select an element first.'); return false; }
          return removeEls(list);
        });
        break;

      case 'lfe-step-set':
        commit(d.on ? 'add step' : 'remove step', function () { return setStep(d.on, d.scope); });
        break;

      case 'lfe-step-group':
        commit('group step', function () { return groupStep(); });
        break;

      case 'lfe-step-move':
        commit('reorder step', function () { return moveStep(d.from, d.to, d.preserveLayout !== false); });
        break;

      case 'lfe-autofit':
        commit('auto-fit', function () { return autoFit(d.unit || 'vmin'); });
        break;

      case 'lfe-undo': undo(); break;
      case 'lfe-redo': redo(); break;
      case 'lfe-refit': scheduleFit(); break;
      case 'lfe-doc':
        post({ type: 'lfe-doc', requestId: d.requestId, html: serialize() });
        break;
      default: break;
    }
  });

  /* ── boot ──────────────────────────────────────────────────────────────── */
  function boot() {
    mountLayers();
    var ps = pages();
    post({
      type: 'lfe-ready',
      pages: ps.map(function (p, i) {
        var h = p.querySelector('h1,h2,h3');
        return {
          index: i,
          title: h ? label(h) : 'Slide ' + (i + 1),
          stepCount: p.querySelectorAll('.step').length,
        };
      }),
    });
    show(0);
  }

  window.addEventListener('resize', function () { scheduleFit(); });
  if (window.ResizeObserver) {
    try { new ResizeObserver(function () { scheduleFit(true); placeBadges(); }).observe(document.documentElement); } catch (e) {}
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { scheduleFit(); }).catch(function () {});
  window.addEventListener('load', function () { scheduleFit(); placeBadges(); });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
