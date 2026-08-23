/* Inlined by build-deck.mjs inside a <script> tag whenever a deck asks for
   data-three. Authors never import this — they write data-three="…" only. */
(function(){
  var frames = [].slice.call(document.querySelectorAll('[data-three]'));
  if (!frames.length) return;
  window.addEventListener('load', function(){
    var T = window.THREE;
    if (!T || !T.WebGLRenderer) return;
    try {
      var probe = document.createElement('canvas');
      var pg = probe.getContext('webgl') || probe.getContext('experimental-webgl');
      if (!pg) return;
      /* Hand the probe's context straight back. It is never drawn into, but it
         counts against the browser's per-page context budget just the same —
         and this file's whole point is to stop spending that budget. */
      var lose = pg.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    } catch (e) { return; }

    /* ═══ SCENE LIFECYCLE ══════════════════════════════════════════════════
       Every [data-three] scene on every page used to be built here, on load,
       and then looped forever. A 44-page deck meant ten WebGLRenderers, ten
       live WebGL contexts and ten requestAnimationFrame callbacks per frame —
       for the one scene the class can actually see. Chromium evicts contexts
       past ~16 per page, so two decks open at once also meant context-loss
       churn mid-lecture; and because a sandboxed srcdoc iframe shares the
       presenter's renderer process, all ten callbacks sat on the same main
       thread as the pen.

       So a scene is built when its page becomes active, paused when it
       leaves, and disposed outright once the teacher is more than a page
       away. A disposed scene falls back to its .scene-fallback — the same
       static figure the PDF export prints — and rebuilds if the page comes
       back. Live contexts: one, sometimes two. Never ten.                  */

    /* Antialiasing is an MSAA resolve on every rendered frame. On a 4K
       classroom panel driven by an OPS stick that is real money, and at
       classroom viewing distance on a 75–86" board it buys nothing. */
    var LF_AA = ((window.innerWidth || 0) * (window.innerHeight || 0)) <= 2000000;

    /* One place that knows whether the pen is down. The host sets it via the
       lf-ink message (see deckController in presenter.html); a deck opened
       bare in a browser simply never has it set. */
    function inking(){ return !!window.__lfInkBusy; }

    /* A frame's loops, renderers and window listeners, so a scene can be
       stopped and taken apart without every startX() having to return a
       teardown of its own. */
    function slot(frame){
      if (!frame.__lf) frame.__lf = { loops: [], renderers: [], offs: [], built: false };
      return frame.__lf;
    }

    /* Replaces `(function loop(){ requestAnimationFrame(loop); … })()`.
       Three differences that matter: the tick can be paused and resumed, it
       yields the frame entirely while the pen is down, and it is cancelled
       when the scene is disposed instead of running until the tab closes. */
    function lfLoop(frame, fn){
      var s = slot(frame);
      var rec = { fn: fn, live: false, raf: 0 };
      rec.tick = function(){
        rec.raf = 0;
        if (!rec.live) return;
        rec.raf = requestAnimationFrame(rec.tick);
        if (inking()) return;          // the pen owns the thread until it lifts
        try { fn(); } catch (e) { rec.live = false; }
      };
      rec.start = function(){
        if (rec.live) return;
        rec.live = true;
        if (!rec.raf) rec.raf = requestAnimationFrame(rec.tick);
      };
      rec.stop = function(){
        rec.live = false;
        if (rec.raf){ cancelAnimationFrame(rec.raf); rec.raf = 0; }
      };
      s.loops.push(rec);
      /* A scene built by the retry path above may have lost its page while it
         was waiting for a layout. Only self-start if this really is the page
         on screen; `lastActive < 0` is the host-less fallback, where the
         IntersectionObserver decides instead. */
      if (lastActive < 0 || frame.__lfPage === lastActive) rec.start();
      return rec;
    }

    /* Registers a renderer so it can be disposed later, and is the one place
       a renderer is handed back for assignment. */
    function lfOwn(frame, renderer){
      slot(frame).renderers.push(renderer);
      return renderer;
    }

    /* window listeners a scene installs (all of them are 'resize') have to come
       off with the scene, or a disposed renderer gets resized. */
    function lfOn(frame, type, fn){
      window.addEventListener(type, fn);
      slot(frame).offs.push(function(){ window.removeEventListener(type, fn); });
    }

    function build(frame){
      var s = slot(frame);
      if (s.built) return;
      s.built = true;
      try { start(frame); }
      catch (e) { /* a dead scene must not blank the slide */ }
    }

    function resume(frame){
      var s = slot(frame);
      if (!s.built) return build(frame);
      for (var i = 0; i < s.loops.length; i++) s.loops[i].start();
    }

    function pause(frame){
      var s = frame.__lf;
      if (!s) return;
      for (var i = 0; i < s.loops.length; i++) s.loops[i].stop();
    }

    /* Give the GPU everything back. The scene shows its .scene-fallback until
       the page is next opened, which is exactly what a machine with no WebGL
       shows — so this can never leave a slide blank. */
    function destroy(frame){
      var s = frame.__lf;
      if (!s || !s.built) return;
      pause(frame);
      for (var i = 0; i < s.offs.length; i++) { try { s.offs[i](); } catch (e) {} }
      for (var j = 0; j < s.renderers.length; j++){
        var r = s.renderers[j];
        try { r.dispose(); } catch (e) {}
        try { r.forceContextLoss(); } catch (e) {}
        try { if (r.domElement && r.domElement.parentNode) r.domElement.parentNode.removeChild(r.domElement); }
        catch (e) {}
      }
      var canvases = frame.querySelectorAll('canvas');
      for (var k = 0; k < canvases.length; k++) canvases[k].remove();
      frame.classList.remove('is-live');
      frame.__lf = null;
    }

    /* ── which page a scene lives on ─────────────────────────────────────── */
    var pages = [].slice.call(document.querySelectorAll('.page'));
    function pageIndexOf(frame){
      var p = frame.closest ? frame.closest('.page') : null;
      return p ? pages.indexOf(p) : -1;
    }
    frames.forEach(function(frame){ frame.__lfPage = pageIndexOf(frame); });

    /* A page either side may stay BUILT but paused, so stepping onto it does
       not pay for a fresh renderer and a shader compile mid-sentence. HOLD is
       what may stay; CAP is what actually does — on a deck where several
       consecutive pages each carry a scene, "one page either side" is three
       live contexts, and the whole point of this file is not to spend them.
       So: the page on screen, plus at most one warm neighbour. */
    var HOLD = 1;
    var CAP = 2;
    var lastActive = -1;

    function reconcile(active){
      /* The host sweeps __lf-active across every page while it bakes a deck
         for export or for a frozen page. That is a measuring pass, not a
         teacher turning pages: reacting to it would build and dispose a
         renderer per page, and the export prints .scene-fallback regardless.
         Sit the whole sweep out — the class is not looking at this. */
      if (window.__lfBaking) return;
      if (active === lastActive) return;
      lastActive = active;

      /* Nearest first, so the budget is spent on the pages most likely to be
         asked for next. */
      var order = frames.slice().sort(function(a, b){
        var da = a.__lfPage < 0 ? 0 : Math.abs(a.__lfPage - active);
        var db = b.__lfPage < 0 ? 0 : Math.abs(b.__lfPage - active);
        return da - db;
      });

      var kept = 0;
      order.forEach(function(frame){
        var d = frame.__lfPage < 0 ? 0 : Math.abs(frame.__lfPage - active);
        if (frame.__lfPage === active){ kept++; resume(frame); return; }
        if (d <= HOLD && kept < CAP){ kept++; pause(frame); return; }
        destroy(frame);
      });
    }

    function activeIndex(){
      for (var i = 0; i < pages.length; i++)
        if (pages[i].classList.contains('__lf-active')) return i;
      return -1;
    }

    /* The host adds __lf-active; watching the class rather than listening for
       lf-show means this works under the presenter, under the deck editor, and
       under anything else that drives the same convention. */
    if (window.MutationObserver && pages.length){
      var mo = new MutationObserver(function(){
        var a = activeIndex();
        if (a >= 0) reconcile(a);
      });
      pages.forEach(function(p){ mo.observe(p, { attributes: true, attributeFilter: ['class'] }); });
    }

    /* A deck opened bare in a browser has no host, so nothing ever sets
       __lf-active and the reconcile above would never start a single scene.
       Fall back to "start what is on screen" — still lazy, still one context
       at a time in practice, but the file keeps working on its own. */
    var a0 = activeIndex();
    if (a0 >= 0) reconcile(a0);
    else setTimeout(function(){
      if (activeIndex() >= 0) return;                 // a host turned up after all
      if (!window.IntersectionObserver){ frames.forEach(build); return; }
      var io = new IntersectionObserver(function(entries){
        entries.forEach(function(en){
          if (en.isIntersecting) resume(en.target); else pause(en.target);
        });
      }, { rootMargin: '200px' });
      frames.forEach(function(frame){ io.observe(frame); });
    }, 1200);

    function start(frame){
      var w = frame.clientWidth, h = frame.clientHeight;
      /* No size yet — the page is still laying out. Retry, but drop the retry
         if the scene was disposed in the meantime, or a page the teacher has
         already left rebuilds itself behind her. */
      if (!w || !h) {
        requestAnimationFrame(function(){ if (frame.__lf && frame.__lf.built) start(frame); });
        return;
      }

      var kind = (frame.getAttribute('data-three') || 'globe').trim();
      if (kind === 'screw-gauge') { startScrewGauge(frame, w, h); return; }
      if (kind === 'solid-angle') { startSolidAngle(frame, w, h); return; }
      if (kind === 'solid-angle-cone') { startSolidAngleCone(frame, w, h); return; }
      if (kind === 'xy-independence' || kind === 'vector-rva' ||
          kind === 'tangent-normal' || kind === 'curvature-circle'){
        startPlane2D(frame, w, h, kind); return;
      }
      if (kind === 'com-vectors' || kind === 'com-cube' ||
          kind === 'com-translate' || kind === 'com-solids'){
        startCOM(frame, w, h, kind); return;
      }
      if (kind === 'work-dot'){ startWorkDot(frame, w, h); return; }
      if (kind === 'projectile-power'){ startProjectilePower(frame, w, h); return; }
      if (kind === 'impulse-wall' || kind === 'explosion-momentum' ||
          kind === 'recoil-momentum' || kind === 'collision-momentum' ||
          kind === 'restitution-e' || kind === 'newton-cradle' ||
          kind === 'bounce-decay' || kind === 'max-ke-loss' ||
          kind === 'rolling-contact'){
        startMech2D(frame, w, h, kind); return;
      }
      if (kind === 'slinky-drop' || kind === 'lift-frame' ||
          kind === 'friction-ramp'){
        startFbd2D(frame, w, h, kind); return;
      }
      if (kind === 'equilibrium-types'){ startEquilibrium(frame, w, h); return; }
      if (kind === 'normal-shift' || kind === 'toppling' || kind === 'car-topple'){
        startTopple2D(frame, w, h, kind); return;
      }
      if (kind === 'spin-top' || kind === 'cross-product' ||
          kind === 'conical-pendulum' || kind === 'torque-lever' ||
          kind === 'spin-axis'){
        startRot3D(frame, w, h, kind); return;
      }
      if (kind === 'skater-spin' || kind === 'hoberman'){
        startConserve(frame, w, h, kind); return;
      }
      if (kind === 'earth-g' || kind === 'latitude-g' || kind === 'oblate-earth'){
        startGravity(frame, w, h, kind); return;
      }
      if (kind === 'escape-speed' || kind === 'launch-direction' ||
          kind === 'angled-launch' || kind === 'kepler-areas' ||
          kind === 'kepler-t2a3'){
        startEscape(frame, w, h, kind); return;
      }
      if (kind === 'satellite-orbit' || kind === 'geo-vs-polar' ||
          kind === 'coverage-cap'){
        startSatellite(frame, w, h, kind); return;
      }
      if (kind === 'pressure-depth' || kind === 'curved-projected'){
        startFluid(frame, w, h, kind); return;
      }

      var renderer = lfOwn(frame, new T.WebGLRenderer({ alpha: true, antialias: LF_AA, powerPreference: 'high-performance' }));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      frame.appendChild(renderer.domElement);
      frame.classList.add('is-live');

      var scene = new T.Scene();
      var camera = new T.PerspectiveCamera(45, w / h, 0.1, 100);
      camera.position.set(0, 0, 5);
      var group = new T.Group();
      scene.add(group);

      if (kind === 'stars'){
        var n = 900, pos = new Float32Array(n * 3);
        for (var i = 0; i < n; i++){
          pos[i*3] = (Math.random() - 0.5) * 18;
          pos[i*3+1] = (Math.random() - 0.5) * 12;
          pos[i*3+2] = (Math.random() - 0.5) * 12;
        }
        var geo = new T.BufferGeometry();
        geo.setAttribute('position', new T.BufferAttribute(pos, 3));
        group.add(new T.Points(geo, new T.PointsMaterial({
          color: 0xf5c542, size: 0.045, transparent: true, opacity: 0.75
        })));
      } else {
        group.add(new T.LineSegments(
          new T.WireframeGeometry(new T.SphereGeometry(1.7, 24, 16)),
          new T.LineBasicMaterial({ color: 0x7c8cff, transparent: true, opacity: 0.45 })));
        group.add(new T.Mesh(
          new T.SphereGeometry(1.68, 48, 32),
          new T.MeshBasicMaterial({ color: 0x0d1020, transparent: true, opacity: 0.55 })));
      }

      function resize(){
        var nw = frame.clientWidth, nh = frame.clientHeight;
        if (!nw || !nh) return;
        camera.aspect = nw / nh; camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
      }
      lfOn(frame, 'resize', resize);
      lfLoop(frame, function loop(){
        group.rotation.y += 0.0022;
        group.rotation.x = Math.sin(Date.now() / 9000) * 0.18;
        renderer.render(scene, camera);
      });
    }


    /* ------------------------------------------------ 2D-motion plane scenes ---
       Four WebGL scenes for a "motion in a plane" deck. All four share one
       stage: an x-y plane drawn in perspective with a slow yaw, so the class
       reads it as a plane in space rather than a flat picture.

         xy-independence   a particle on a curved path with its x-shadow and
                           y-shadow sliding along the two axes — the chapter's
                           whole thesis, that 2D motion is two 1D motions
         vector-rva        r from the origin, v along the tangent, a — the
                           three vectors of a position-vector question
         tangent-normal    a fixed a resolved into a_t (along v) and a_c
                           (perpendicular to v) as the particle rounds a bend
         curvature-circle  the osculating circle riding an ellipse: tight where
                           the path bends hard, wide where it is nearly straight

       Nothing here carries an idea on its own — every frame ships a
       .scene-fallback that prints (rule 20).                                  */
    function startPlane2D(frame, w, h, kind){
      var GOLD = 0xf5c542, INDIGO = 0x7c8cff, CYAN = 0x56ccf2,
          GREEN = 0x34d399, RED = 0xfb7185, INK = 0xf4f7fb;

      var renderer = lfOwn(frame, new T.WebGLRenderer({ alpha: true, antialias: LF_AA, powerPreference: 'high-performance' }));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      frame.appendChild(renderer.domElement);
      frame.classList.add('is-live');

      var scene = new T.Scene();
      var camera = new T.PerspectiveCamera(40, w / h, 0.1, 100);
      camera.position.set(0, 0.15, 9.6);
      camera.lookAt(0, 0, 0);
      /* pull back just far enough that the whole 8x5 plane is in the box,
         whatever shape the box is — a short wide frame must not shrink the
         figure to the middle third of the board. */
      function fit(aspect){
        var t2 = Math.tan((40 * Math.PI / 180) / 2);
        camera.position.z = Math.max(3.05 / t2, 4.45 / (t2 * aspect));
      }
      fit(w / h);

      var group = new T.Group();
      scene.add(group);
      var world = new T.Group();          /* plane coords: x 0..8, y 0..5 */
      world.position.set(-4, -2.5, 0);
      group.add(world);

      var X1 = 8, Y1 = 5;

      /* squared paper, kept faint — it is texture, not information */
      var gp = [], i;
      for (i = 0; i <= X1 * 2; i++) gp.push(i / 2, 0, 0, i / 2, Y1, 0);
      for (i = 0; i <= Y1 * 2; i++) gp.push(0, i / 2, 0, X1, i / 2, 0);
      var ggeo = new T.BufferGeometry();
      ggeo.setAttribute('position', new T.Float32BufferAttribute(gp, 3));
      world.add(new T.LineSegments(ggeo, new T.LineBasicMaterial({
        color: INDIGO, transparent: true, opacity: 0.13 })));

      function line(pts, color, opacity, width){
        var g = new T.BufferGeometry().setFromPoints(pts);
        return new T.Line(g, new T.LineBasicMaterial({
          color: color, transparent: true, opacity: opacity === undefined ? 1 : opacity }));
      }

      function cone(color, size, at, dir){
        var m = new T.Mesh(new T.ConeGeometry(size, size * 2.6, 12),
          new T.MeshBasicMaterial({ color: color }));
        m.position.copy(at);
        m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.clone().normalize());
        return m;
      }

      /* an arrow that can be re-aimed every frame: unit cylinder + cone */
      function makeArrow(color, rad, opacity){
        var g = new T.Group();
        var mat = new T.MeshBasicMaterial({ color: color,
          transparent: opacity !== undefined, opacity: opacity === undefined ? 1 : opacity });
        var shaft = new T.Mesh(new T.CylinderGeometry(rad, rad, 1, 10), mat);
        var head  = new T.Mesh(new T.ConeGeometry(rad * 3, rad * 7, 14), mat);
        g.add(shaft); g.add(head);
        g.userData = { shaft: shaft, head: head, rad: rad };
        return g;
      }
      function aim(g, from, to){
        var dir = new T.Vector3().subVectors(to, from), len = dir.length();
        if (len < 0.04){ g.visible = false; return; }
        g.visible = true;
        var hl = Math.min(g.userData.rad * 7, len * 0.45);
        var sl = Math.max(len - hl, 0.001);
        g.userData.shaft.scale.set(1, sl, 1);
        g.userData.shaft.position.set(0, sl / 2, 0);
        g.userData.head.scale.set(1, hl / (g.userData.rad * 7), 1);
        g.userData.head.position.set(0, sl + hl / 2, 0);
        g.position.copy(from);
        g.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
      }

      /* classroom-size label drawn to a canvas — no webfont, no external asset */
      function label(text, css, size){
        var c = document.createElement('canvas');
        c.width = 256; c.height = 128;
        var ctx = c.getContext('2d');
        ctx.font = 'bold 74px Calibri, Candara, "Segoe UI", sans-serif';
        ctx.fillStyle = css; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, 128, 64);
        var tex = new T.CanvasTexture(c);
        tex.minFilter = T.LinearFilter;
        var m = new T.Mesh(new T.PlaneGeometry(size * 2, size),
          new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
        return m;
      }

      /* axes with arrowheads — scaffolding, drawn once */
      world.add(line([new T.Vector3(0, 0, 0), new T.Vector3(X1, 0, 0)], INK, 0.55));
      world.add(line([new T.Vector3(0, 0, 0), new T.Vector3(0, Y1, 0)], INK, 0.55));
      world.add(cone(INK, 0.09, new T.Vector3(X1, 0, 0), new T.Vector3(1, 0, 0)));
      world.add(cone(INK, 0.09, new T.Vector3(0, Y1, 0), new T.Vector3(0, 1, 0)));
      var lx = label('x', '#f4f7fb', 0.5); lx.position.set(X1 - 0.15, -0.42, 0); world.add(lx);
      var ly = label('y', '#f4f7fb', 0.5); ly.position.set(-0.42, Y1 - 0.12, 0); world.add(ly);

      /* -------------------------------------------------------- the paths -- */
      function parabola(u){ return new T.Vector3(0.5 + 7 * u, 0.35 + 4.1 * (4 * u * (1 - u)), 0); }
      function parabolaD(u){ return new T.Vector3(7, 4.1 * 4 * (1 - 2 * u), 0); }
      function hill(u){ return new T.Vector3(0.6 + 6.8 * u, 1.0 + 3.0 * Math.sin(Math.PI * u), 0); }
      function hillD(u){ return new T.Vector3(6.8, 3.0 * Math.PI * Math.cos(Math.PI * u), 0); }
      var EA = 2.7, EB = 2.05, ECX = 4.0, ECY = 2.4;
      function ellipse(th){ return new T.Vector3(ECX + EA * Math.cos(th), ECY + EB * Math.sin(th), 0); }

      function polyline(fn, n, from, to, color, opacity){
        var pts = [];
        for (var k = 0; k <= n; k++) pts.push(fn(from + (to - from) * k / n));
        return line(pts, color, opacity);
      }

      var mover = new T.Mesh(new T.SphereGeometry(0.15, 20, 14),
        new T.MeshBasicMaterial({ color: GOLD }));
      world.add(mover);

      var parts = {};      /* per-kind objects, updated in the loop */

      if (kind === 'xy-independence'){
        var TRAIL = 160;
        var tpos = new Float32Array((TRAIL + 1) * 3);
        var tgeo = new T.BufferGeometry();
        tgeo.setAttribute('position', new T.BufferAttribute(tpos, 3));
        tgeo.setDrawRange(0, 0);
        world.add(new T.Line(tgeo, new T.LineBasicMaterial({ color: GOLD })));

        var shX = new T.Mesh(new T.SphereGeometry(0.13, 16, 12),
          new T.MeshBasicMaterial({ color: CYAN }));
        var shY = new T.Mesh(new T.SphereGeometry(0.13, 16, 12),
          new T.MeshBasicMaterial({ color: INDIGO }));
        world.add(shX); world.add(shY);

        function liveLine(color, opacity){
          var g = new T.BufferGeometry();
          g.setAttribute('position', new T.BufferAttribute(new Float32Array(6), 3));
          var l = new T.Line(g, new T.LineBasicMaterial({
            color: color, transparent: true, opacity: opacity }));
          world.add(l);
          return l;
        }
        var gX = liveLine(CYAN, 0.5), gY = liveLine(INDIGO, 0.5);
        var lbX = label('x(t)', '#56ccf2', 0.44);
        var lbY = label('y(t)', '#7c8cff', 0.44);
        world.add(lbX); world.add(lbY);
        parts = { tgeo: tgeo, tpos: tpos, TRAIL: TRAIL, shX: shX, shY: shY,
                  gX: gX, gY: gY, lbX: lbX, lbY: lbY };
      }

      if (kind === 'vector-rva'){
        world.add(polyline(parabola, 90, 0, 1, INK, 0.28));
        var aR = makeArrow(INDIGO, 0.045), aV = makeArrow(GOLD, 0.05), aA = makeArrow(RED, 0.05);
        world.add(aR); world.add(aV); world.add(aA);
        var lR = label('r', '#7c8cff', 0.46),
            lV = label('v', '#f5c542', 0.46),
            lA = label('a', '#fb7185', 0.46);
        world.add(lR); world.add(lV); world.add(lA);
        parts = { aR: aR, aV: aV, aA: aA, lR: lR, lV: lV, lA: lA };
      }

      if (kind === 'tangent-normal'){
        world.add(polyline(hill, 90, 0, 1, INK, 0.3));
        var tV = makeArrow(GOLD, 0.05), tA = makeArrow(RED, 0.05),
            tT = makeArrow(GREEN, 0.045), tC = makeArrow(CYAN, 0.045);
        world.add(tV); world.add(tA); world.add(tT); world.add(tC);
        function dash(color){
          var g = new T.BufferGeometry();
          g.setAttribute('position', new T.BufferAttribute(new Float32Array(6), 3));
          var l = new T.Line(g, new T.LineBasicMaterial({
            color: color, transparent: true, opacity: 0.4 }));
          world.add(l); return l;
        }
        var d1 = dash(GREEN), d2 = dash(CYAN);
        var lv = label('v', '#f5c542', 0.44),
            la = label('a', '#fb7185', 0.44),
            lt = label('at', '#34d399', 0.44),
            lc = label('ac', '#56ccf2', 0.44);
        world.add(lv); world.add(la); world.add(lt); world.add(lc);
        parts = { tV: tV, tA: tA, tT: tT, tC: tC, d1: d1, d2: d2,
                  lv: lv, la: la, lt: lt, lc: lc };
      }

      if (kind === 'curvature-circle'){
        world.add(polyline(ellipse, 160, 0, Math.PI * 2, INK, 0.32));
        var N = 96;
        var cpos = new Float32Array((N + 1) * 3);
        var cgeo = new T.BufferGeometry();
        cgeo.setAttribute('position', new T.BufferAttribute(cpos, 3));
        world.add(new T.Line(cgeo, new T.LineBasicMaterial({
          color: INDIGO, transparent: true, opacity: 0.85 })));
        var centre = new T.Mesh(new T.SphereGeometry(0.1, 14, 10),
          new T.MeshBasicMaterial({ color: INDIGO }));
        world.add(centre);
        var rgeo = new T.BufferGeometry();
        rgeo.setAttribute('position', new T.BufferAttribute(new Float32Array(6), 3));
        world.add(new T.Line(rgeo, new T.LineBasicMaterial({
          color: CYAN, transparent: true, opacity: 0.8 })));
        var lr = label('r', '#56ccf2', 0.44);
        world.add(lr);
        parts = { cpos: cpos, cgeo: cgeo, N: N, centre: centre, rgeo: rgeo, lr: lr };
      }

      /* ------------------------------------------------------------ loop -- */
      var t0 = Date.now(), lastW = w, lastH = h;
      function setLive(geo, ax, ay, bx, by){
        var a = geo.getAttribute('position');
        a.array[0] = ax; a.array[1] = ay; a.array[2] = 0;
        a.array[3] = bx; a.array[4] = by; a.array[5] = 0;
        a.needsUpdate = true;
      }

      lfLoop(frame, function loop(){
        var nw = frame.clientWidth, nh = frame.clientHeight;
        if (!nw || !nh) return;                    /* page hidden — don't burn a GPU */
        if (nw !== lastW || nh !== lastH){
          lastW = nw; lastH = nh;
          camera.aspect = nw / nh; fit(nw / nh); camera.updateProjectionMatrix();
          renderer.setSize(nw, nh);
        }
        var t = (Date.now() - t0) / 1000;
        group.rotation.y = Math.sin(t / 7) * 0.13;
        group.rotation.x = -0.06;

        if (kind === 'xy-independence'){
          var cycle = 7.0, u = Math.min(Math.max((t % cycle) / 5.4, 0), 1);
          var P = parabola(u);
          mover.position.copy(P);
          parts.shX.position.set(P.x, 0, 0);
          parts.shY.position.set(0, P.y, 0);
          setLive(parts.gX.geometry, P.x, P.y, P.x, 0);
          setLive(parts.gY.geometry, P.x, P.y, 0, P.y);
          parts.lbX.position.set(P.x, -0.45, 0);
          parts.lbY.position.set(-0.55, P.y, 0);
          var n = Math.max(1, Math.round(u * parts.TRAIL));
          for (var q = 0; q <= n; q++){
            var Q = parabola(u * q / n);
            parts.tpos[q * 3] = Q.x; parts.tpos[q * 3 + 1] = Q.y; parts.tpos[q * 3 + 2] = 0;
          }
          parts.tgeo.setDrawRange(0, n + 1);
          parts.tgeo.getAttribute('position').needsUpdate = true;
          parts.tgeo.computeBoundingSphere();
        }

        if (kind === 'vector-rva'){
          var uu = (Math.sin(t / 3.4 - Math.PI / 2) + 1) / 2;
          var Pv = parabola(uu), D = parabolaD(uu);
          var V = D.clone().multiplyScalar(0.19);
          var A = new T.Vector3(0, -4.1 * 8, 0).multiplyScalar(0.032);
          mover.position.copy(Pv);
          aim(parts.aR, new T.Vector3(0, 0, 0), Pv);
          aim(parts.aV, Pv, Pv.clone().add(V));
          aim(parts.aA, Pv, Pv.clone().add(A));
          parts.lR.position.copy(Pv.clone().multiplyScalar(0.5).add(new T.Vector3(-0.32, 0.3, 0)));
          parts.lV.position.copy(Pv.clone().add(V).add(new T.Vector3(0.3, 0.22, 0)));
          parts.lA.position.copy(Pv.clone().add(A).add(new T.Vector3(0.34, -0.16, 0)));
        }

        if (kind === 'tangent-normal'){
          var uh = (Math.sin(t / 4.2 - Math.PI / 2) + 1) / 2;
          var Ph = hill(uh), Dh = hillD(uh).normalize();
          var Nh = new T.Vector3(-Dh.y, Dh.x, 0);
          var Av = new T.Vector3(0.62, 1.5, 0);            /* a: fixed, as on the board */
          var at = Dh.clone().multiplyScalar(Av.dot(Dh));
          var ac = Nh.clone().multiplyScalar(Av.dot(Nh));
          mover.position.copy(Ph);
          aim(parts.tV, Ph, Ph.clone().add(Dh.clone().multiplyScalar(1.5)));
          aim(parts.tA, Ph, Ph.clone().add(Av));
          aim(parts.tT, Ph, Ph.clone().add(at));
          aim(parts.tC, Ph, Ph.clone().add(ac));
          var tip = Ph.clone().add(Av);
          var ta = Ph.clone().add(at), ca = Ph.clone().add(ac);
          setLive(parts.d1.geometry, ta.x, ta.y, tip.x, tip.y);
          setLive(parts.d2.geometry, ca.x, ca.y, tip.x, tip.y);
          parts.lv.position.copy(Ph.clone().add(Dh.clone().multiplyScalar(1.75)).add(new T.Vector3(0, 0.28, 0)));
          parts.la.position.copy(tip.clone().add(new T.Vector3(0.3, 0.24, 0)));
          parts.lt.position.copy(ta.clone().add(at.clone().normalize().multiplyScalar(0.42))
            .add(new T.Vector3(0, -0.26, 0)));
          parts.lc.position.copy(ca.clone().add(ac.clone().normalize().multiplyScalar(0.42))
            .add(new T.Vector3(-0.3, 0.1, 0)));
        }

        if (kind === 'curvature-circle'){
          var th = t * 0.42;
          var Pe = ellipse(th);
          var dx = -EA * Math.sin(th), dy = EB * Math.cos(th);
          var ddx = -EA * Math.cos(th), ddy = -EB * Math.sin(th);
          var sp = Math.sqrt(dx * dx + dy * dy);
          var cross = dx * ddy - dy * ddx;
          var R = Math.abs(cross) < 1e-4 ? 40 : (sp * sp * sp) / Math.abs(cross);
          var nx = -dy / sp, ny = dx / sp;
          if (cross < 0){ nx = -nx; ny = -ny; }
          var cx = Pe.x + nx * R, cy = Pe.y + ny * R;
          mover.position.copy(Pe);
          parts.centre.position.set(cx, cy, 0);
          for (var s = 0; s <= parts.N; s++){
            var a2 = s / parts.N * Math.PI * 2;
            parts.cpos[s * 3] = cx + R * Math.cos(a2);
            parts.cpos[s * 3 + 1] = cy + R * Math.sin(a2);
            parts.cpos[s * 3 + 2] = 0;
          }
          parts.cgeo.getAttribute('position').needsUpdate = true;
          parts.cgeo.computeBoundingSphere();
          setLive(parts.rgeo, cx, cy, Pe.x, Pe.y);
          parts.lr.position.set((cx + Pe.x) / 2 + 0.24, (cy + Pe.y) / 2 + 0.2, 0);
        }

        renderer.render(scene, camera);
      });
    }

    /* ------------------------------------------------------ centre of mass ---
       Four scenes for the Centre of Mass chapter. A C.O.M. question is always
       a point in SPACE that no drawing on a flat board can put you inside of,
       so these are the four places where turning the figure earns its bytes:

         com-vectors    three point masses, the three position vectors r1 r2 r3
                        drawn from the origin, and the gold r_com the weighted
                        average actually lands on — the formula slide, in space
         com-cube       the eight-corner cube question: 8 masses on the
                        vertices of a cube of edge a, the gold C.O.M. floating
                        inside it, and the three drop-lines that give x, y, z
         com-translate  the same push, twice: through the C.O.M. the bar only
                        slides; off the C.O.M. it slides AND spins — yet the
                        gold dot still runs down one straight line. That is
                        the whole content of "translation motion only"
         com-solids     hemisphere shell, solid hemisphere, hollow cone and
                        solid cone standing side by side with the C.O.M.
                        height marked on each — why the solid cone is h/4 and
                        the hollow one h/3 is a fact about volume, and volume
                        is what a flat picture cannot show

       Nothing here carries an idea alone (rule 20): every frame ships a
       .scene-fallback with the source slide's own figure, and that is what
       prints and what a room with no WebGL sees.                              */
    function startCOM(frame, w, h, kind){
      var GOLD = 0xf5c542, GOLDS = 0xffe9a8, INDIGO = 0x7c8cff, CYAN = 0x56ccf2,
          INK = 0xf4f7fb, RED = 0xfb7185;

      var renderer = lfOwn(frame, new T.WebGLRenderer({ alpha: true, antialias: LF_AA, powerPreference: 'high-performance' }));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      frame.appendChild(renderer.domElement);
      frame.classList.add('is-live');

      var scene = new T.Scene();
      var camera = new T.PerspectiveCamera(42, w / h, 0.1, 200);
      scene.add(new T.AmbientLight(0xb8c4e0, 0.62));
      var key = new T.DirectionalLight(0xffffff, 0.78);
      key.position.set(4, 7, 6); scene.add(key);
      var rim = new T.DirectionalLight(0x9ab0ff, 0.34);
      rim.position.set(-5, 2, -5); scene.add(rim);

      var group = new T.Group();          /* the thing that turns */
      scene.add(group);

      /* ---------------------------------------------------------- helpers -- */

      /* Classroom-size label drawn to a canvas — no webfont, no external asset.
         The canvas is sized to the text (a long name must not be squeezed into
         a 2:1 box), and the plane is drawn with depthTest off so a solid body
         can never swallow the name of the thing it is.                        */
      function label(text, css, size){
        var FONT = 'bold 70px Calibri, Candara, "Segoe UI", sans-serif';
        var c = document.createElement('canvas');
        var ctx = c.getContext('2d');
        ctx.font = FONT;
        var tw = Math.max(64, Math.ceil(ctx.measureText(text).width) + 24);
        c.width = tw; c.height = 104;
        ctx = c.getContext('2d');
        ctx.font = FONT;
        ctx.fillStyle = css; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, tw / 2, 52);
        var tex = new T.CanvasTexture(c);
        tex.minFilter = T.LinearFilter;
        var m = new T.Mesh(new T.PlaneGeometry(size * (tw / 104), size),
          new T.MeshBasicMaterial({ map: tex, transparent: true,
            depthWrite: false, depthTest: false }));
        m.renderOrder = 12;
        m.userData.billboard = true;
        return m;
      }

      function seg(a, b, color, opacity, dashed){
        var g = new T.BufferGeometry().setFromPoints([a, b]);
        var mat = dashed
          ? new T.LineDashedMaterial({ color: color, transparent: true,
              opacity: opacity, dashSize: 0.13, gapSize: 0.11 })
          : new T.LineBasicMaterial({ color: color, transparent: true, opacity: opacity });
        var l = new T.Line(g, mat);
        if (dashed) l.computeLineDistances();
        return l;
      }

      /* a straight arrow built once: shaft + head, aimed from a to b */
      function arrow(a, b, color, rad, opacity, overlay){
        var g = new T.Group();
        var dir = new T.Vector3().subVectors(b, a), len = dir.length();
        if (len < 1e-4) return g;
        var mat = new T.MeshBasicMaterial({ color: color,
          transparent: true, opacity: opacity === undefined ? 1 : opacity,
          depthTest: !overlay, depthWrite: !overlay });
        if (overlay) g.renderOrder = 9;
        var hl = Math.min(rad * 7.5, len * 0.42), sl = Math.max(len - hl, 1e-3);
        var shaft = new T.Mesh(new T.CylinderGeometry(rad, rad, sl, 12), mat);
        shaft.position.set(0, sl / 2, 0);
        var head = new T.Mesh(new T.ConeGeometry(rad * 2.9, hl, 16), mat);
        head.position.set(0, sl + hl / 2, 0);
        g.add(shaft); g.add(head);
        g.position.copy(a);
        g.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
        return g;
      }

      function ball(at, r, color, opacity){
        var m = new T.Mesh(new T.SphereGeometry(r, 24, 16),
          new T.MeshPhongMaterial({ color: color, shininess: 40, specular: 0x445577,
            transparent: opacity !== undefined, opacity: opacity === undefined ? 1 : opacity }));
        m.position.copy(at);
        return m;
      }

      /* the gold C.O.M. marker: a bright core inside a soft halo, so it reads
         as "the point" from the back of the room */
      function comMarker(at, r){
        var g = new T.Group();
        g.add(new T.Mesh(new T.SphereGeometry(r, 24, 16),
          new T.MeshBasicMaterial({ color: GOLDS })));
        g.add(new T.Mesh(new T.SphereGeometry(r * 2.1, 20, 14),
          new T.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.22,
            depthWrite: false })));
        g.position.copy(at);
        return g;
      }

      function V(x, y, z){ return new T.Vector3(x, y, z); }

      var billboards = [];
      function put(mesh){ group.add(mesh); if (mesh.userData.billboard) billboards.push(mesh); return mesh; }

      /* x-y-z axes from the origin, drawn once — scaffolding, never the idea */
      function axes(lx, ly, lz, color, opacity){
        var o = V(0, 0, 0);
        group.add(seg(o, V(lx, 0, 0), color, opacity));
        group.add(seg(o, V(0, ly, 0), color, opacity));
        group.add(seg(o, V(0, 0, lz), color, opacity));
        group.add(arrow(V(lx * 0.86, 0, 0), V(lx, 0, 0), color, 0.035, Math.min(1, opacity + 0.2)));
        group.add(arrow(V(0, ly * 0.86, 0), V(0, ly, 0), color, 0.035, Math.min(1, opacity + 0.2)));
        group.add(arrow(V(0, 0, lz * 0.86), V(0, 0, lz), color, 0.035, Math.min(1, opacity + 0.2)));
        put(label('x', '#c7d2e1', 0.30)).position.set(lx + 0.24, -0.16, 0);
        put(label('y', '#c7d2e1', 0.30)).position.set(-0.20, ly + 0.22, 0);
        put(label('z', '#c7d2e1', 0.30)).position.set(0, -0.18, lz + 0.26);
      }

      var spin = 0.0024, tick = null, lookAt = V(0, 0, 0);
      var camDir = V(0, 0, 1), fitH = 2, fitW = 2;   /* half-extents to keep in frame */

      /* ------------------------------------------------------ com-vectors -- */
      if (kind === 'com-vectors'){
        axes(3.3, 2.7, 2.7, INK, 0.42);

        var pts = [
          { p: V(1.00, 1.45, 0.90), m: 1, t: 'm1' },
          { p: V(2.50, 1.90, -0.45), m: 2, t: 'm2' },
          { p: V(1.90, 0.55, 1.75), m: 1, t: 'm3' }
        ];
        var tot = 0, cx = 0, cy = 0, cz = 0;
        pts.forEach(function(q){
          tot += q.m; cx += q.m * q.p.x; cy += q.m * q.p.y; cz += q.m * q.p.z;
          group.add(arrow(V(0, 0, 0), q.p, INDIGO, 0.026, 0.9));
          group.add(ball(q.p, 0.085 + 0.045 * q.m, CYAN));
          put(label(q.t, '#9ad0ff', 0.34)).position.copy(q.p).add(V(0.30, 0.26, 0));
        });
        var C = V(cx / tot, cy / tot, cz / tot);
        group.add(arrow(V(0, 0, 0), C, GOLD, 0.040, 1));
        group.add(comMarker(C, 0.10));
        put(label('C.O.M.', '#ffe9a8', 0.30)).position.copy(C).add(V(0.10, -0.40, 0));
        /* each mass tied to the answer, so the eye sees an average, not a 4th point */
        pts.forEach(function(q){ group.add(seg(q.p, C, GOLD, 0.22, true)); });

        group.position.set(-1.55, -1.15, -0.45);
        camDir = V(3.7, 2.5, 5.0); fitH = 1.95; fitW = 2.45;
        lookAt = V(0, 0.05, 0);
      }

      /* --------------------------------------------------------- com-cube -- */
      if (kind === 'com-cube'){
        var a = 2.30;
        /* the eight corner masses of the source slide, in units of m:
           x=a side sums to 8, y=a side to 10, z=a side to 9 — exactly the
           three numerators the solution writes down                          */
        var V8 = [
          { x: 0, y: 0, z: 0, m: 4 }, { x: 1, y: 0, z: 0, m: 3 },
          { x: 0, y: 1, z: 0, m: 3 }, { x: 1, y: 1, z: 0, m: 1 },
          { x: 0, y: 0, z: 1, m: 1 }, { x: 1, y: 0, z: 1, m: 2 },
          { x: 0, y: 1, z: 1, m: 4 }, { x: 1, y: 1, z: 1, m: 2 }
        ];
        var box = new T.Mesh(new T.BoxGeometry(a, a, a),
          new T.MeshPhongMaterial({ color: 0x1a2a5e, transparent: true, opacity: 0.16,
            shininess: 20, depthWrite: false }));
        box.position.set(a / 2, a / 2, a / 2);
        group.add(box);
        var edges = new T.LineSegments(
          new T.EdgesGeometry(new T.BoxGeometry(a, a, a)),
          new T.LineBasicMaterial({ color: 0xd8e2f5, transparent: true, opacity: 0.72 }));
        edges.position.set(a / 2, a / 2, a / 2);
        group.add(edges);

        axes(a * 1.42, a * 1.34, a * 1.34, CYAN, 0.42);

        var sx = 0, sy = 0, sz = 0, sm = 0;
        V8.forEach(function(v){
          var p = V(v.x * a, v.y * a, v.z * a);
          sm += v.m; sx += v.m * p.x; sy += v.m * p.y; sz += v.m * p.z;
          group.add(ball(p, 0.085 + 0.030 * v.m, 0x6ee7a8));
          put(label(v.m === 1 ? 'm' : v.m + 'm', '#d9f7e6', 0.36))
            .position.copy(p).add(V(v.x ? 0.44 : -0.44, v.y ? 0.36 : -0.36, 0));
        });
        var Cc = V(sx / sm, sy / sm, sz / sm);
        /* the three drop lines ARE x_com, y_com, z_com */
        group.add(seg(Cc, V(Cc.x, 0, Cc.z), GOLD, 0.42, true));
        group.add(seg(V(Cc.x, 0, Cc.z), V(Cc.x, 0, 0), GOLD, 0.30, true));
        group.add(seg(V(Cc.x, 0, Cc.z), V(0, 0, Cc.z), GOLD, 0.30, true));
        var cm = comMarker(Cc, 0.155);
        cm.children.forEach(function(ch){ ch.material.depthTest = false; ch.renderOrder = 9; });
        group.add(cm);
        put(label('C.O.M.', '#ffe9a8', 0.36)).position.copy(Cc).add(V(0.92, -0.30, 0));

        group.position.set(-a / 2, -a / 2 - 0.15, -a / 2);
        camDir = V(4.1, 3.1, 5.7); fitH = 2.35; fitW = 2.85;
        lookAt = V(0, 0, 0);
        spin = 0.0021;
      }

      /* ---------------------------------------------------- com-translate -- */
      if (kind === 'com-translate'){
        spin = 0;
        var barGeo = new T.BoxGeometry(1.95, 0.19, 0.42);
        var barMat = new T.MeshPhongMaterial({ color: 0x3a5bd0, shininess: 45,
          specular: 0x8899cc });

        function rig(yy, text){
          var g = new T.Group();
          g.position.y = yy;
          var pivot = new T.Group();            /* spins about the C.O.M. */
          var bar = new T.Mesh(barGeo, barMat);
          pivot.add(bar);
          /* the C.O.M. dot rides in front of the hull, so the class can watch
             it hold its line while the bar itself tumbles */
          var dot = new T.Mesh(new T.SphereGeometry(0.135, 22, 16),
            new T.MeshBasicMaterial({ color: GOLDS, depthTest: false }));
          dot.position.z = 0.26; dot.renderOrder = 9;
          pivot.add(dot);
          var halo = new T.Mesh(new T.SphereGeometry(0.28, 20, 14),
            new T.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.22,
              depthWrite: false, depthTest: false }));
          halo.position.z = 0.26; halo.renderOrder = 8;
          pivot.add(halo);
          g.add(pivot);
          group.add(g);
          /* the straight line the C.O.M. runs down, whatever the bar does */
          group.add(seg(V(-3.35, yy, 0), V(3.35, yy, 0), GOLD, 0.26, true));
          var lb = put(label(text, '#c7d2e1', 0.36));
          lb.position.set(-1.55, yy + 0.78, 0);
          return { g: g, pivot: pivot };
        }

        var top = rig(1.05, 'at C.O.M.');
        var bot = rig(-1.05, 'off C.O.M.');

        /* the push: a red arrow that sits still and lets the bar arrive at it */
        var pushA = arrow(V(-3.05, 1.05, 0), V(-2.35, 1.05, 0), RED, 0.055, 0.95);
        var pushB = arrow(V(-3.05, -1.05 + 0.40, 0), V(-2.35, -1.05 + 0.40, 0), RED, 0.055, 0.95);
        group.add(pushA); group.add(pushB);
        put(label('F', '#fb7185', 0.34)).position.set(-2.70, 1.36, 0);
        put(label('F', '#fb7185', 0.34)).position.set(-2.70, -0.34, 0);

        camDir = V(0, 0.25, 7.0); fitH = 2.05; fitW = 3.75;
        lookAt = V(0, 0, 0);

        tick = function(t){
          var u = (t % 5.6) / 5.6;                 /* one run every 5.6 s */
          var e = u < 0.82 ? u / 0.82 : 1;         /* travel, then hold */
          var x = -2.15 + 4.3 * e;
          top.g.position.x = x;
          bot.g.position.x = x;
          bot.pivot.rotation.z = -e * Math.PI * 2.4;
          var fade = u < 0.82 ? 1 : Math.max(0, 1 - (u - 0.82) / 0.18);
          top.g.visible = bot.g.visible = fade > 0.02;
        };
      }

      /* ------------------------------------------------------- com-solids -- */
      if (kind === 'com-solids'){
        var R = 0.98, hh = 2.05, rr = 0.86;
        var shellMat = new T.MeshPhongMaterial({ color: 0xe8eefc, shininess: 60,
          specular: 0xffffff, transparent: true, opacity: 0.42, side: T.DoubleSide });
        /* the solids are glassy on purpose: the whole point of the slide is
           WHERE inside the body the point sits, so you have to see into it */
        var solidMat = new T.MeshPhongMaterial({ color: 0x3a6ad0, shininess: 42,
          specular: 0x88a0dd, transparent: true, opacity: 0.62 });

        function stand(x, mesh, comY, tag, name){
          var g = new T.Group();
          g.position.x = x;
          g.add(mesh);
          /* the C.O.M. height, as an arrow off the base — the printed answer */
          var ar = arrow(V(0, 0.02, 0), V(0, comY, 0), GOLD, 0.036, 1, true);
          g.add(ar);
          var dot = new T.Mesh(new T.SphereGeometry(0.095, 18, 12),
            new T.MeshBasicMaterial({ color: GOLDS, depthTest: false }));
          dot.position.set(0, comY, 0); dot.renderOrder = 10;
          g.add(dot);
          group.add(g);
          var lt = put(label(tag, '#ffe9a8', 0.46));
          lt.position.set(x + 0.74, comY * 0.66, 0);
          var ln = put(label(name, '#c7d2e1', 0.32));
          ln.position.set(x, -0.66, 0);
          return g;
        }

        /* hemispherical shell — C.O.M. at R/2 */
        stand(-3.70, new T.Mesh(
          new T.SphereGeometry(R, 40, 22, 0, Math.PI * 2, 0, Math.PI / 2), shellMat),
          R / 2, 'R/2', 'hollow sphere');

        /* solid hemisphere — C.O.M. at 3R/8, lower, because the mass is packed
           near the flat face */
        var solidHemi = new T.Group();
        solidHemi.add(new T.Mesh(
          new T.SphereGeometry(R, 40, 22, 0, Math.PI * 2, 0, Math.PI / 2), solidMat));
        var disc = new T.Mesh(new T.CircleGeometry(R, 40), solidMat);
        disc.rotation.x = Math.PI / 2;
        solidHemi.add(disc);
        stand(-1.24, solidHemi, 3 * R / 8, '3R/8', 'solid sphere');

        /* hollow cone — C.O.M. at h/3 */
        var hollowCone = new T.Mesh(
          new T.ConeGeometry(rr, hh, 40, 1, true), shellMat);
        hollowCone.position.y = hh / 2;
        stand(1.24, hollowCone, hh / 3, 'h/3', 'hollow cone');

        /* solid cone — C.O.M. at h/4 */
        var solidConeG = new T.Group();
        var sc = new T.Mesh(new T.ConeGeometry(rr, hh, 40), solidMat);
        sc.position.y = hh / 2;
        solidConeG.add(sc);
        stand(3.70, solidConeG, hh / 4, 'h/4', 'solid cone');

        group.position.y = -0.72;
        camDir = V(0.5, 2.2, 7.9); fitH = 1.55; fitW = 5.05;
        lookAt = V(0, 0.25, 0);
        spin = 0.0026;
      }

      /* ------------------------------------------------------------ loop --- */
      var TAN = Math.tan((42 * Math.PI / 180) / 2);
      function place(aspect){
        var d = Math.max(fitH / TAN, fitW / (TAN * aspect));
        camera.position.copy(camDir).normalize().multiplyScalar(d).add(lookAt);
        camera.lookAt(lookAt);
      }
      place(w / h);
      function resize(){
        var nw = frame.clientWidth, nh = frame.clientHeight;
        if (!nw || !nh) return;
        camera.aspect = nw / nh; camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
        place(nw / nh);
        refDist = camera.position.distanceTo(lookAt);
      }
      lfOn(frame, 'resize', resize);

      var t0 = Date.now();
      var qGroup = new T.Quaternion(), qFace = new T.Quaternion(), refDist = 1;
      refDist = camera.position.distanceTo(lookAt);
      var wp = new T.Vector3();
      lfLoop(frame, function loop(){
        var t = (Date.now() - t0) / 1000;
        if (spin){
          group.rotation.y += spin;
          group.rotation.x = Math.sin(t / 11) * 0.10;
        }
        if (tick) tick(t);
        /* labels always face the class, however far the body has turned: the
           parent's rotation is cancelled out, so a name never reads mirrored */
        if (billboards.length){
          qGroup.setFromEuler(group.rotation).invert();
          qFace.copy(qGroup).multiply(camera.quaternion);
          scene.updateMatrixWorld(true);
          for (var i = 0; i < billboards.length; i++){
            var bb = billboards[i];
            bb.quaternion.copy(qFace);
            bb.getWorldPosition(wp);
            var k = camera.position.distanceTo(wp) / refDist;
            bb.scale.setScalar(Math.max(0.55, Math.min(1.7, k)));
          }
        }
        renderer.render(scene, camera);
      });
    }

    /* ---------------------------------------------- solid angle (steradian) ---
       Sphere of radius r with a square pyramidal solid angle from the centre.
       Same Ω cuts patch A on the sphere and a larger patch A′ further out at r′.
       Slow auto-orbit; no OrbitControls (pointer-events are owned by the host). */
    function startSolidAngle(frame, w, h){
      var renderer = lfOwn(frame, new T.WebGLRenderer({ alpha: true, antialias: LF_AA, powerPreference: 'high-performance' }));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      frame.appendChild(renderer.domElement);
      frame.classList.add('is-live');

      var scene = new T.Scene();
      var camera = new T.PerspectiveCamera(42, w / h, 0.1, 100);
      camera.position.set(4.6, 2.8, 5.4);
      camera.lookAt(0.4, 0.2, 0.6);

      scene.add(new T.AmbientLight(0xb8c4e0, 0.55));
      var key = new T.DirectionalLight(0xffffff, 0.85);
      key.position.set(4, 6, 5); scene.add(key);

      var group = new T.Group();
      scene.add(group);

      var r = 2.0, rPrime = 3.35, half = 0.55;
      var origin = new T.Vector3(0, 0, 0);
      var axis = new T.Vector3(0.55, 0.35, 1).normalize();

      /* soft filled sphere (classroom blue) */
      group.add(new T.Mesh(
        new T.SphereGeometry(r, 48, 32),
        new T.MeshPhongMaterial({
          color: 0x1a3a8a, transparent: true, opacity: 0.55,
          shininess: 28, specular: 0x334466, depthWrite: false
        })));
      group.add(new T.LineSegments(
        new T.WireframeGeometry(new T.SphereGeometry(r * 1.002, 24, 16)),
        new T.LineBasicMaterial({ color: 0x7c8cff, transparent: true, opacity: 0.18 })));
      group.add(new T.Mesh(
        new T.SphereGeometry(0.06, 16, 12),
        new T.MeshBasicMaterial({ color: 0x9ad0ff })));

      /* four corner directions of the solid-angle pyramid */
      var u = new T.Vector3(), v = new T.Vector3();
      if (Math.abs(axis.y) < 0.9) u.set(0, 1, 0).cross(axis).normalize();
      else u.set(1, 0, 0).cross(axis).normalize();
      v.copy(axis).cross(u).normalize();
      var corners = [
        axis.clone().add(u.clone().multiplyScalar(half)).add(v.clone().multiplyScalar(half)).normalize(),
        axis.clone().add(u.clone().multiplyScalar(-half)).add(v.clone().multiplyScalar(half)).normalize(),
        axis.clone().add(u.clone().multiplyScalar(-half)).add(v.clone().multiplyScalar(-half)).normalize(),
        axis.clone().add(u.clone().multiplyScalar(half)).add(v.clone().multiplyScalar(-half)).normalize()
      ];

      var edgeMat = new T.LineBasicMaterial({ color: 0xd8e2f5, transparent: true, opacity: 0.9 });
      corners.forEach(function(c){
        var geo = new T.BufferGeometry().setFromPoints([
          origin, c.clone().multiplyScalar(rPrime * 1.05)
        ]);
        group.add(new T.Line(geo, edgeMat));
      });

      function greatArc(a, b, rad, segs){
        var start = a.clone().normalize(), end = b.clone().normalize();
        var rot = new T.Vector3().crossVectors(start, end).normalize();
        var ang = start.angleTo(end), pts = [];
        for (var i = 0; i <= segs; i++){
          pts.push(start.clone().applyAxisAngle(rot, (i / segs) * ang).multiplyScalar(rad));
        }
        return pts;
      }

      function addSphericalPatch(rad, fillColor, fillOpacity, edgeColor){
        var ring = [];
        for (var i = 0; i < 4; i++){
          ring = ring.concat(greatArc(corners[i], corners[(i + 1) % 4], rad, 24));
        }
        group.add(new T.Line(
          new T.BufferGeometry().setFromPoints(ring),
          new T.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.95 })));

        /* fan triangulation from the patch centre for a soft fill */
        var mid = new T.Vector3();
        corners.forEach(function(c){ mid.add(c); });
        mid.normalize().multiplyScalar(rad);
        var pos = [];
        for (var k = 0; k < 4; k++){
          var arc = greatArc(corners[k], corners[(k + 1) % 4], rad, 16);
          for (var j = 0; j < arc.length - 1; j++){
            pos.push(mid.x, mid.y, mid.z,
                     arc[j].x, arc[j].y, arc[j].z,
                     arc[j + 1].x, arc[j + 1].y, arc[j + 1].z);
          }
        }
        var g = new T.BufferGeometry();
        g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
        g.computeVertexNormals();
        group.add(new T.Mesh(g, new T.MeshBasicMaterial({
          color: fillColor, transparent: true, opacity: fillOpacity,
          side: T.DoubleSide, depthWrite: false
        })));
      }

      addSphericalPatch(r, 0x3b6fd9, 0.45, 0x8eb6ff);
      addSphericalPatch(rPrime, 0x9aa3b5, 0.28, 0xc5cad4);

      /* radius arrows r and r′ (gold accents) */
      function addRadius(len, color){
        var tip = axis.clone().multiplyScalar(len);
        group.add(new T.Line(
          new T.BufferGeometry().setFromPoints([origin, tip]),
          new T.LineBasicMaterial({ color: color })));
        var cone = new T.Mesh(
          new T.ConeGeometry(0.07, 0.22, 10),
          new T.MeshBasicMaterial({ color: color }));
        cone.position.copy(tip);
        cone.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), axis);
        group.add(cone);
      }
      addRadius(r, 0x7c8cff);
      addRadius(rPrime, 0xf5c542);

      function resize(){
        var nw = frame.clientWidth, nh = frame.clientHeight;
        if (!nw || !nh) return;
        camera.aspect = nw / nh; camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
      }
      lfOn(frame, 'resize', resize);
      lfLoop(frame, function loop(){
        group.rotation.y += 0.0035;
        renderer.render(scene, camera);
      });
    }

    /* ----------------------------------------- solid angle of a cone (sr) ---
       Sphere + right circular cone of semi-vertical angle α from the centre.
       The cone cuts a spherical cap; slow auto-orbit for the classroom.       */
    function startSolidAngleCone(frame, w, h){
      var renderer = lfOwn(frame, new T.WebGLRenderer({ alpha: true, antialias: LF_AA, powerPreference: 'high-performance' }));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      frame.appendChild(renderer.domElement);
      frame.classList.add('is-live');

      var scene = new T.Scene();
      var camera = new T.PerspectiveCamera(42, w / h, 0.1, 100);
      camera.position.set(3.8, 2.2, 4.6);
      camera.lookAt(0, 0.15, 0);

      scene.add(new T.AmbientLight(0xb8c4e0, 0.55));
      var key = new T.DirectionalLight(0xffffff, 0.9);
      key.position.set(4, 6, 5); scene.add(key);

      var group = new T.Group();
      scene.add(group);

      var r = 2.0, alpha = Math.PI / 5; /* 36° semi-vertical */
      var axis = new T.Vector3(0.35, 0.55, 1).normalize();

      group.add(new T.Mesh(
        new T.SphereGeometry(r, 48, 32),
        new T.MeshPhongMaterial({
          color: 0x1a3a8a, transparent: true, opacity: 0.42,
          shininess: 28, specular: 0x334466, depthWrite: false
        })));
      group.add(new T.LineSegments(
        new T.WireframeGeometry(new T.SphereGeometry(r * 1.002, 20, 14)),
        new T.LineBasicMaterial({ color: 0x7c8cff, transparent: true, opacity: 0.16 })));
      group.add(new T.Mesh(
        new T.SphereGeometry(0.055, 14, 12),
        new T.MeshBasicMaterial({ color: 0x9ad0ff })));

      /* cone body: apex at origin, axis along +Y then reoriented */
      var coneH = r * Math.cos(alpha);
      var coneR = r * Math.sin(alpha);
      var cone = new T.Mesh(
        new T.ConeGeometry(coneR, coneH, 48, 1, true),
        new T.MeshPhongMaterial({
          color: 0x38bdf8, transparent: true, opacity: 0.28,
          side: T.DoubleSide, depthWrite: false, shininess: 40
        }));
      /* ConeGeometry apex at +y = h/2; shift so apex sits at origin */
      cone.geometry.translate(0, -coneH / 2, 0);
      cone.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), axis);
      group.add(cone);

      /* two silhouette generators + axis */
      function perpBasis(ax){
        var u = new T.Vector3();
        if (Math.abs(ax.y) < 0.9) u.set(0, 1, 0).cross(ax).normalize();
        else u.set(1, 0, 0).cross(ax).normalize();
        return u;
      }
      var u = perpBasis(axis);
      var edgeMat = new T.LineBasicMaterial({ color: 0xd8e2f5, transparent: true, opacity: 0.95 });
      [1, -1].forEach(function(sign){
        var side = u.clone().multiplyScalar(sign * Math.sin(alpha));
        var tip = axis.clone().multiplyScalar(Math.cos(alpha)).add(side).normalize().multiplyScalar(r);
        group.add(new T.Line(
          new T.BufferGeometry().setFromPoints([new T.Vector3(0, 0, 0), tip]),
          edgeMat));
      });
      group.add(new T.Line(
        new T.BufferGeometry().setFromPoints([
          new T.Vector3(0, 0, 0), axis.clone().multiplyScalar(r)
        ]),
        new T.LineBasicMaterial({ color: 0xf5c542, transparent: true, opacity: 0.85 })));

      /* spherical cap rim (circle of angular radius α) */
      var rim = [];
      var v = new T.Vector3().crossVectors(axis, u).normalize();
      for (var i = 0; i <= 64; i++){
        var t = (i / 64) * Math.PI * 2;
        var dir = axis.clone().multiplyScalar(Math.cos(alpha))
          .add(u.clone().multiplyScalar(Math.sin(alpha) * Math.cos(t)))
          .add(v.clone().multiplyScalar(Math.sin(alpha) * Math.sin(t)))
          .normalize().multiplyScalar(r);
        rim.push(dir);
      }
      group.add(new T.Line(
        new T.BufferGeometry().setFromPoints(rim),
        new T.LineBasicMaterial({ color: 0xf2d024, transparent: true, opacity: 0.95 })));

      /* soft cap fill */
      var capPos = [];
      var pole = axis.clone().multiplyScalar(r);
      for (var k = 0; k < rim.length - 1; k++){
        capPos.push(pole.x, pole.y, pole.z,
                    rim[k].x, rim[k].y, rim[k].z,
                    rim[k + 1].x, rim[k + 1].y, rim[k + 1].z);
      }
      var capGeo = new T.BufferGeometry();
      capGeo.setAttribute('position', new T.Float32BufferAttribute(capPos, 3));
      capGeo.computeVertexNormals();
      group.add(new T.Mesh(capGeo, new T.MeshBasicMaterial({
        color: 0xf2d024, transparent: true, opacity: 0.22,
        side: T.DoubleSide, depthWrite: false
      })));

      function resize(){
        var nw = frame.clientWidth, nh = frame.clientHeight;
        if (!nw || !nh) return;
        camera.aspect = nw / nh; camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
      }
      lfOn(frame, 'resize', resize);
      lfLoop(frame, function loop(){
        group.rotation.y += 0.004;
        renderer.render(scene, camera);
      });
    }

    /* ---------------------------------------------------- screw-gauge 3D ---
       Micrometer with FLAT scale plates (perfect classroom numbering) plus
       orbit controls. Sim drives state via __sgUpdate; view via __sgOrbit /
       __sgView (wired from data-act="orbit"|"view" buttons).                 */
    function startScrewGauge(frame, w, h){
      var renderer = lfOwn(frame, new T.WebGLRenderer({ alpha: true, antialias: LF_AA, powerPreference: 'high-performance' }));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      renderer.domElement.style.display = 'block';
      frame.appendChild(renderer.domElement);
      frame.classList.add('is-live');

      var scene = new T.Scene();
      var camera = new T.PerspectiveCamera(30, w / h, 0.05, 100);

      /* camera targets — lerped for view presets */
      var cam = {
        x: 0.2, y: 1.85, z: 9.0,
        lx: 0.35, ly: 0.2, lz: 0
      };
      var camGoal = { x: cam.x, y: cam.y, z: cam.z, lx: cam.lx, ly: cam.ly, lz: cam.lz };
      function snapCam(){
        camera.position.set(cam.x, cam.y, cam.z);
        camera.lookAt(cam.lx, cam.ly, cam.lz);
      }
      snapCam();

      scene.add(new T.AmbientLight(0xd8deee, 0.62));
      var key = new T.DirectionalLight(0xfff4e0, 1.0);
      key.position.set(5, 8, 7); scene.add(key);
      var rim = new T.DirectionalLight(0x8ea0ff, 0.4);
      rim.position.set(-6, 2, -4); scene.add(rim);
      var jawLight = new T.PointLight(0xffe6a8, 0.5, 8);
      jawLight.position.set(-1.6, 1.2, 2.2); scene.add(jawLight);

      var ground = new T.Mesh(
        new T.CircleGeometry(4.4, 48),
        new T.MeshBasicMaterial({ color: 0x0a0c16, transparent: true, opacity: 0.5 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -2.1;
      scene.add(ground);

      function mat(color, shin, spec){
        return new T.MeshPhongMaterial({ color: color, shininess: shin, specular: spec || 0x778899 });
      }
      var chrome = mat(0xe8eef6, 110, 0xb0c0d0);
      var steel = mat(0xb8c4d4, 70, 0x8899aa);
      var steelDark = mat(0x7a8799, 55, 0x556677);
      var frameMat = mat(0x5c6a82, 45, 0x334455);
      var accent = mat(0xc0392b, 40, 0x662211);
      var copper = mat(0xd4894a, 75, 0xaa6633);
      var glassMat = new T.MeshPhongMaterial({
        color: 0x7ec8e3, shininess: 120, specular: 0xffffff,
        transparent: true, opacity: 0.55, side: T.DoubleSide
      });
      var ballMat = mat(0xd5dde8, 140, 0xffffff);

      /* orbit pivot — teacher rotates the whole instrument with buttons */
      var orbit = new T.Group();
      orbit.rotation.order = 'YXZ';
      scene.add(orbit);
      var view = { yaw: -0.28, pitch: 0.10 };
      function applyOrbit(){
        orbit.rotation.y = view.yaw;
        orbit.rotation.x = view.pitch;
      }
      applyOrbit();

      var root = new T.Group();
      root.position.set(0.1, 0.1, 0);
      orbit.add(root);

      var AXIS_Y = 0.42;
      var ANVIL_FACE = -2.05;
      var GAP_SCALE = 0.38;
      var SLEEVE_LEN = 2.55;
      var SLEEVE_R = 0.40;
      var THIMBLE_R = 0.50;
      var FACE_R = 0.26;
      var sleeveStart = 0.20;

      function cyl(rt, rb, len, seg, material){
        return new T.Mesh(new T.CylinderGeometry(rt, rb, len, seg), material);
      }
      function layX(mesh){ mesh.rotation.z = Math.PI / 2; }
      function addBox(parent, sx, sy, sz, x, y, z, material){
        var m = new T.Mesh(new T.BoxGeometry(sx, sy, sz), material);
        m.position.set(x, y, z);
        parent.add(m);
        return m;
      }

      /* ---------- frame ---------- */
      var frameG = new T.Group(); root.add(frameG);
      addBox(frameG, 0.55, 1.35, 0.55, ANVIL_FACE - 0.55, AXIS_Y - 0.35, 0, frameMat);
      addBox(frameG, 0.70, 1.55, 0.60, 0.55, AXIS_Y - 0.55, 0, frameMat);
      var bow = new T.Mesh(new T.TorusGeometry(1.55, 0.28, 16, 48, Math.PI), frameMat);
      bow.rotation.z = Math.PI / 2; bow.rotation.y = Math.PI / 2;
      bow.position.set((ANVIL_FACE - 0.2 + 0.55) / 2, AXIS_Y - 1.75, 0);
      frameG.add(bow);
      addBox(frameG, 2.6, 0.42, 0.55, (ANVIL_FACE + 0.4) / 2, AXIS_Y - 0.95, 0, frameMat);

      /* ---------- anvil ---------- */
      var anvilBody = cyl(FACE_R * 0.95, FACE_R * 0.95, 0.70, 32, chrome);
      layX(anvilBody); anvilBody.position.set(ANVIL_FACE - 0.38, AXIS_Y, 0); root.add(anvilBody);
      var anvilFace = cyl(FACE_R, FACE_R, 0.05, 48, chrome);
      layX(anvilFace); anvilFace.position.set(ANVIL_FACE - 0.02, AXIS_Y, 0); root.add(anvilFace);
      var anvilDisc = new T.Mesh(
        new T.CircleGeometry(FACE_R * 0.92, 48),
        new T.MeshPhongMaterial({ color: 0xf4f7fb, shininess: 160, specular: 0xffffff })
      );
      anvilDisc.position.set(ANVIL_FACE + 0.005, AXIS_Y, 0);
      anvilDisc.rotation.y = Math.PI / 2; root.add(anvilDisc);

      /* ---------- plain metal sleeve + red datum ---------- */
      var sleeve = cyl(SLEEVE_R, SLEEVE_R, SLEEVE_LEN, 48, steel);
      layX(sleeve);
      sleeve.position.set(sleeveStart + SLEEVE_LEN / 2, AXIS_Y, 0);
      root.add(sleeve);
      var collar = cyl(SLEEVE_R + 0.06, SLEEVE_R + 0.02, 0.22, 32, steelDark);
      layX(collar); collar.position.set(sleeveStart + 0.05, AXIS_Y, 0); root.add(collar);
      var lock = cyl(0.48, 0.48, 0.22, 8, steelDark);
      layX(lock); lock.position.set(sleeveStart - 0.18, AXIS_Y, 0); root.add(lock);
      addBox(root, SLEEVE_LEN * 0.92, 0.016, 0.016,
        sleeveStart + SLEEVE_LEN / 2, AXIS_Y, SLEEVE_R + 0.008, accent);

      /* ===== FLAT main-scale plate — perfect numbering for the board ===== */
      var mainScaleMap = makeMainScalePlate();
      var mainScale = new T.Mesh(
        new T.PlaneGeometry(SLEEVE_LEN * 0.95, 0.72),
        new T.MeshBasicMaterial({ map: mainScaleMap, transparent: true })
      );
      mainScale.position.set(
        sleeveStart + SLEEVE_LEN / 2,
        AXIS_Y + SLEEVE_R + 0.42,
        SLEEVE_R + 0.04
      );
      root.add(mainScale);
      /* small leader line from plate down to sleeve datum */
      addBox(root, 0.012, 0.28, 0.012,
        sleeveStart + SLEEVE_LEN / 2, AXIS_Y + SLEEVE_R + 0.14, SLEEVE_R + 0.03, accent);

      /* ---------- moving spindle / thimble ---------- */
      var moving = new T.Group(); root.add(moving);

      var spindleLen = 2.85;
      var spindle = cyl(0.175, 0.175, spindleLen, 28, chrome);
      layX(spindle); spindle.position.set(spindleLen / 2, AXIS_Y, 0); moving.add(spindle);
      var spindleFace = cyl(FACE_R, FACE_R, 0.05, 48, chrome);
      layX(spindleFace); spindleFace.position.set(0.02, AXIS_Y, 0); moving.add(spindleFace);
      var spindleDisc = new T.Mesh(
        new T.CircleGeometry(FACE_R * 0.92, 48),
        new T.MeshPhongMaterial({ color: 0xf4f7fb, shininess: 160, specular: 0xffffff })
      );
      spindleDisc.position.set(-0.01, AXIS_Y, 0);
      spindleDisc.rotation.y = -Math.PI / 2; moving.add(spindleDisc);

      for (var ti = 0; ti < 18; ti++){
        var ring = new T.Mesh(new T.TorusGeometry(0.185, 0.022, 8, 20), steelDark);
        ring.rotation.y = Math.PI / 2;
        ring.position.set(0.55 + ti * 0.085, AXIS_Y, 0);
        moving.add(ring);
      }

      var thimbleSpin = new T.Group();
      thimbleSpin.position.set(0, AXIS_Y, 0);
      moving.add(thimbleSpin);

      var thimbleLen = 1.70;
      var thimbleLocalX = sleeveStart + SLEEVE_LEN * 0.55 + thimbleLen / 2;
      var thimble = cyl(THIMBLE_R * 0.96, THIMBLE_R, thimbleLen, 48, steel);
      layX(thimble); thimble.position.set(thimbleLocalX, 0, 0); thimbleSpin.add(thimble);
      var bevel = cyl(THIMBLE_R * 0.96, SLEEVE_R + 0.02, 0.10, 48, steelDark);
      layX(bevel); bevel.position.set(thimbleLocalX - thimbleLen / 2 - 0.02, 0, 0); thimbleSpin.add(bevel);

      for (var k = 0; k < 28; k++){
        var ang = (k / 28) * Math.PI * 2;
        var ridge = new T.Mesh(new T.BoxGeometry(0.55, 0.032, 0.032), steelDark);
        ridge.position.set(
          thimbleLocalX + 0.15,
          Math.sin(ang) * (THIMBLE_R + 0.008),
          Math.cos(ang) * (THIMBLE_R + 0.008)
        );
        ridge.rotation.x = ang;
        thimbleSpin.add(ridge);
      }

      var ratchet = cyl(0.30, 0.34, 0.58, 12, steelDark);
      layX(ratchet); ratchet.position.set(thimbleLocalX + thimbleLen / 2 + 0.35, AXIS_Y, 0); moving.add(ratchet);
      for (var rg = 0; rg < 4; rg++){
        addBox(moving, 0.025, 0.48, 0.10,
          thimbleLocalX + thimbleLen / 2 + 0.18 + rg * 0.09, AXIS_Y, 0.22, frameMat);
      }
      var ratchetCap = cyl(0.22, 0.28, 0.18, 16, steel);
      layX(ratchetCap); ratchetCap.position.set(thimbleLocalX + thimbleLen / 2 + 0.72, AXIS_Y, 0); moving.add(ratchetCap);

      moving.position.x = ANVIL_FACE;

      /* ===== FLAT circular-scale window (fixed to instrument front) =====
         Numbers stay crisp; texture redraws so the CSR sits on the red line. */
      var circCanvas = document.createElement('canvas');
      circCanvas.width = 512; circCanvas.height = 1024;
      var circTex = new T.CanvasTexture(circCanvas);
      circTex.minFilter = T.LinearFilter;
      circTex.magFilter = T.LinearFilter;
      var circMat = new T.MeshBasicMaterial({ map: circTex, transparent: true });
      var circPlate = new T.Mesh(new T.PlaneGeometry(0.95, 1.85), circMat);
      /* sits just in front of the thimble bevel — readable on the board */
      circPlate.position.set(
        sleeveStart + SLEEVE_LEN * 0.72,
        AXIS_Y,
        THIMBLE_R + 0.55
      );
      root.add(circPlate);

      var circTitle = makeTextSprite('Circular scale', {
        w: 512, h: 96, font: 'bold 44px Calibri, Segoe UI, sans-serif',
        color: '#f5c542', pw: 0.95, ph: 0.18
      });
      circTitle.position.set(
        sleeveStart + SLEEVE_LEN * 0.72,
        AXIS_Y + 1.05,
        THIMBLE_R + 0.56
      );
      root.add(circTitle);

      var mainTitle = makeTextSprite('Main scale (mm)', {
        w: 640, h: 96, font: 'bold 44px Calibri, Segoe UI, sans-serif',
        color: '#f5c542', pw: 1.4, ph: 0.18
      });
      mainTitle.position.set(
        sleeveStart + SLEEVE_LEN / 2,
        AXIS_Y + SLEEVE_R + 0.85,
        SLEEVE_R + 0.05
      );
      root.add(mainTitle);

      /* ---------- specimens ---------- */
      var specimen = new T.Group(); root.add(specimen);
      var wireMesh = cyl(0.12, 0.12, 1.55, 24, copper);
      wireMesh.position.set(0, AXIS_Y, 0); specimen.add(wireMesh);
      var wireTop = new T.Mesh(new T.SphereGeometry(0.12, 12, 8), copper);
      wireTop.position.set(0, AXIS_Y + 0.75, 0); specimen.add(wireTop);
      var wireBot = new T.Mesh(new T.SphereGeometry(0.12, 12, 8), copper);
      wireBot.position.set(0, AXIS_Y - 0.75, 0); specimen.add(wireBot);
      var plateMesh = addBox(specimen, 0.3, 1.15, 0.95, 0, AXIS_Y, 0, glassMat);
      var plateEdge = addBox(specimen, 0.32, 1.15, 0.04, 0, AXIS_Y, 0.48,
        new T.MeshPhongMaterial({ color: 0xc5eef8, shininess: 80, transparent: true, opacity: 0.7 }));
      var ballMesh = new T.Mesh(new T.SphereGeometry(0.4, 48, 32), ballMat);
      ballMesh.position.set(0, AXIS_Y, 0); specimen.add(ballMesh);
      wireMesh.visible = wireTop.visible = wireBot.visible = false;
      plateMesh.visible = plateEdge.visible = false;
      ballMesh.visible = false;

      var tgt = { gap: 0.84, reading: 0.84, csr: 34, thick: 0.84, name: 'Thin wire', divs: 50 };
      var cur = { gap: 0.84, rot: 0 };
      var lastCsrDrawn = -999;

      function drawCircScale(csr, divs){
        divs = divs || 50;
        csr = ((Math.round(csr) % divs) + divs) % divs;
        if (csr === lastCsrDrawn && divs === tgt.divs) return;
        lastCsrDrawn = csr;
        var ctx = circCanvas.getContext('2d');
        var W = circCanvas.width, H = circCanvas.height;
        ctx.clearRect(0, 0, W, H);

        /* card background */
        ctx.fillStyle = 'rgba(18, 24, 40, 0.92)';
        roundRect(ctx, 8, 8, W - 16, H - 16, 28);
        ctx.fill();
        ctx.strokeStyle = 'rgba(245,197,66,0.45)';
        ctx.lineWidth = 4;
        roundRect(ctx, 8, 8, W - 16, H - 16, 28);
        ctx.stroke();

        /* sleeve stub on the left */
        ctx.fillStyle = '#c9d3e1';
        ctx.fillRect(24, H * 0.35, W * 0.28, H * 0.30);
        ctx.strokeStyle = '#c0392b';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(24, H * 0.5);
        ctx.lineTo(W * 0.34, H * 0.5);
        ctx.stroke();

        /* thimble body */
        ctx.fillStyle = '#b3c0d2';
        ctx.fillRect(W * 0.32, 40, W * 0.60, H - 80);

        var span = 4;
        var gap = (H - 160) / (span * 2);
        var midY = H * 0.5;
        var x0 = W * 0.36;

        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        for (var k = -span; k <= span; k++){
          var d = (((csr + k) % divs) + divs) % divs;
          var y = midY - k * gap;
          var major = d % 5 === 0;
          var here = k === 0;
          ctx.strokeStyle = here ? '#c0392b' : '#1a2433';
          ctx.lineWidth = here ? 7 : (major ? 5 : 3);
          ctx.beginPath();
          ctx.moveTo(x0, y);
          ctx.lineTo(x0 + (major || here ? 110 : 70), y);
          ctx.stroke();
          if (major || here){
            ctx.fillStyle = here ? '#c0392b' : '#1a2433';
            ctx.font = 'bold ' + (here ? 64 : 52) + 'px Calibri, Segoe UI, sans-serif';
            ctx.fillText(String(d), x0 + 125, y);
          }
        }

        /* highlight chip */
        ctx.fillStyle = 'rgba(192,57,43,0.12)';
        ctx.fillRect(x0 - 8, midY - gap * 0.55, W * 0.55, gap * 1.1);

        circTex.needsUpdate = true;
      }

      function applyVisual(){
        var g = Math.max(0, cur.gap) * GAP_SCALE;
        moving.position.x = ANVIL_FACE + g;
        thimbleSpin.rotation.x = -cur.rot;

        /* circular plate stays aligned with the thimble front as jaws open */
        circPlate.position.x = sleeveStart + SLEEVE_LEN * 0.55 + g + 0.15;
        circTitle.position.x = circPlate.position.x;

        drawCircScale(tgt.csr, tgt.divs);

        var thick = Math.max(0, tgt.thick);
        var show = thick > 0.001;
        specimen.visible = show;
        if (!show) return;

        specimen.position.x = ANVIL_FACE + g / 2;
        var name = (tgt.name || '').toLowerCase();
        var isWire = name.indexOf('wire') >= 0;
        var isPlate = name.indexOf('plate') >= 0 || name.indexOf('glass') >= 0;
        var isBall = name.indexOf('ball') >= 0;
        if (!isWire && !isPlate && !isBall) isWire = true;

        wireMesh.visible = wireTop.visible = wireBot.visible = isWire;
        plateMesh.visible = plateEdge.visible = isPlate;
        ballMesh.visible = isBall;

        var diam = Math.max(0.06, g);
        if (isWire){
          var r = diam / 2;
          wireMesh.geometry.dispose();
          wireMesh.geometry = new T.CylinderGeometry(r, r, 1.55, 28);
          wireTop.geometry.dispose();
          wireTop.geometry = new T.SphereGeometry(r, 14, 10);
          wireBot.geometry.dispose();
          wireBot.geometry = new T.SphereGeometry(r, 14, 10);
          wireTop.position.set(0, AXIS_Y + 0.75, 0);
          wireBot.position.set(0, AXIS_Y - 0.75, 0);
          wireMesh.position.set(0, AXIS_Y, 0);
        }
        if (isPlate){
          plateMesh.scale.set(Math.max(0.08, diam), 1, 1);
          plateEdge.scale.set(Math.max(0.08, diam) * 1.05, 1, 1);
          plateMesh.position.set(0, AXIS_Y, 0);
          plateEdge.position.set(0, AXIS_Y, 0.48);
        }
        if (isBall){
          ballMesh.geometry.dispose();
          ballMesh.geometry = new T.SphereGeometry(diam / 2, 48, 32);
          ballMesh.position.set(0, AXIS_Y, 0);
        }
      }

      frame.__sgUpdate = function(s){
        if (!s) return;
        if (typeof s.gap === 'number') tgt.gap = Math.max(0, s.gap);
        if (typeof s.reading === 'number') tgt.reading = s.reading;
        if (typeof s.csr === 'number') { tgt.csr = s.csr; lastCsrDrawn = -999; }
        if (typeof s.thick === 'number') tgt.thick = Math.max(0, s.thick);
        if (typeof s.name === 'string') tgt.name = s.name;
        if (typeof s.divs === 'number' && s.divs > 0) tgt.divs = s.divs;
      };

      frame.__sgOrbit = function(dyaw, dpitch){
        view.yaw += dyaw || 0;
        view.pitch = clamp(view.pitch + (dpitch || 0), -0.75, 0.85);
        applyOrbit();
      };

      frame.__sgView = function(name){
        name = (name || 'reset').toLowerCase();
        if (name === 'left') { view.yaw -= 0.35; applyOrbit(); return; }
        if (name === 'right') { view.yaw += 0.35; applyOrbit(); return; }
        if (name === 'up') { view.pitch = clamp(view.pitch + 0.2, -0.75, 0.85); applyOrbit(); return; }
        if (name === 'down') { view.pitch = clamp(view.pitch - 0.2, -0.75, 0.85); applyOrbit(); return; }
        if (name === 'jaws'){
          view.yaw = -0.95; view.pitch = 0.22; applyOrbit();
          setCam( -1.2, 1.4, 6.2, -1.4, 0.35, 0 );
          return;
        }
        if (name === 'scales'){
          view.yaw = 0.05; view.pitch = 0.02; applyOrbit();
          setCam( 1.4, 1.2, 5.4, 1.3, 0.4, 0.4 );
          return;
        }
        /* reset / overall */
        view.yaw = -0.28; view.pitch = 0.10; applyOrbit();
        setCam( 0.2, 1.85, 9.0, 0.35, 0.2, 0 );
      };

      function setCam(x, y, z, lx, ly, lz){
        camGoal.x = x; camGoal.y = y; camGoal.z = z;
        camGoal.lx = lx; camGoal.ly = ly; camGoal.lz = lz;
      }
      function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

      try {
        var rig = frame.closest('[data-sim="screw-gauge"]');
        if (rig && typeof rig.__sgRefresh === 'function') rig.__sgRefresh();
      } catch (e) {}

      applyVisual();

      function resize(){
        var nw = frame.clientWidth, nh = frame.clientHeight;
        if (!nw || !nh) return;
        camera.aspect = nw / nh; camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
      }
      lfOn(frame, 'resize', resize);

      lfLoop(frame, function loop(){
        cur.gap += (tgt.gap - cur.gap) * 0.2;
        var targetRot = (tgt.csr / Math.max(1, tgt.divs)) * Math.PI * 2;
        var d = targetRot - cur.rot;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        cur.rot += d * 0.24;

        cam.x += (camGoal.x - cam.x) * 0.12;
        cam.y += (camGoal.y - cam.y) * 0.12;
        cam.z += (camGoal.z - cam.z) * 0.12;
        cam.lx += (camGoal.lx - cam.lx) * 0.12;
        cam.ly += (camGoal.ly - cam.ly) * 0.12;
        cam.lz += (camGoal.lz - cam.lz) * 0.12;
        snapCam();

        applyVisual();
        renderer.render(scene, camera);
      });

      /* ---------- texture / sprite helpers ---------- */
      function makeMainScalePlate(){
        var c = document.createElement('canvas');
        c.width = 1536; c.height = 384;
        var ctx = c.getContext('2d');
        ctx.clearRect(0, 0, c.width, c.height);

        ctx.fillStyle = 'rgba(18, 24, 40, 0.92)';
        roundRect(ctx, 6, 6, c.width - 12, c.height - 12, 24);
        ctx.fill();
        ctx.strokeStyle = 'rgba(245,197,66,0.45)';
        ctx.lineWidth = 4;
        roundRect(ctx, 6, 6, c.width - 12, c.height - 12, 24);
        ctx.stroke();

        /* scale body */
        var pad = 48;
        var yMid = c.height * 0.58;
        ctx.fillStyle = '#d5dde8';
        roundRect(ctx, pad, yMid - 55, c.width - pad * 2, 110, 12);
        ctx.fill();

        /* red datum */
        ctx.strokeStyle = '#c0392b';
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(pad + 10, yMid);
        ctx.lineTo(c.width - pad - 10, yMid);
        ctx.stroke();

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (var mm = 0; mm <= 6; mm++){
          var x = pad + 40 + mm * ((c.width - pad * 2 - 80) / 6);
          ctx.strokeStyle = '#1a2433';
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.moveTo(x, yMid);
          ctx.lineTo(x, yMid - 48);
          ctx.stroke();
          ctx.fillStyle = '#f4f7fb';
          ctx.font = 'bold 72px Calibri, Segoe UI, sans-serif';
          ctx.fillText(String(mm), x, yMid - 95);
          if (mm < 6){
            var hx = x + ((c.width - pad * 2 - 80) / 12);
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(hx, yMid);
            ctx.lineTo(hx, yMid + 40);
            ctx.stroke();
          }
        }
        var tex = new T.CanvasTexture(c);
        tex.minFilter = T.LinearFilter;
        tex.magFilter = T.LinearFilter;
        tex.anisotropy = 8;
        return tex;
      }

      function makeTextSprite(text, opt){
        var c = document.createElement('canvas');
        c.width = opt.w; c.height = opt.h;
        var ctx = c.getContext('2d');
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.fillStyle = opt.color;
        ctx.font = opt.font;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, c.width / 2, c.height / 2);
        var tex = new T.CanvasTexture(c);
        tex.minFilter = T.LinearFilter;
        var m = new T.Mesh(
          new T.PlaneGeometry(opt.pw, opt.ph),
          new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
        );
        return m;
      }

      function roundRect(ctx, x, y, w, h, r){
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
      }
    }

    /* ------------------------------------------------------------- work ------
       `data-three="work-dot"`. The one thing a still figure cannot show about
       W = F·s: that the answer is the SHADOW of F on s, and that the shadow
       flips sense as the angle opens past 90 degrees. A gold F swings slowly
       around the fixed indigo s; the green segment on s is F cos(theta), and
       the readout under it reads +ve / 0 / -ve as the projection crosses the
       tail. Nothing here carries an idea alone (rule 20) — the frame ships a
       .scene-fallback with the same figure drawn flat, and that is what prints
       and what a room with no WebGL sees.                                     */
    function startWorkDot(frame, w, h){
      var GOLD = 0xf5c542, INDIGO = 0x7c8cff, GREEN = 0x34d399,
          RED = 0xfb7185, INK = 0xf4f7fb;

      var renderer = lfOwn(frame, new T.WebGLRenderer({ alpha: true, antialias: LF_AA, powerPreference: 'high-performance' }));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      frame.appendChild(renderer.domElement);
      frame.classList.add('is-live');

      var scene = new T.Scene();
      var camera = new T.PerspectiveCamera(40, w / h, 0.1, 100);
      camera.position.set(0, 0.1, 9);
      camera.lookAt(0, 0, 0);
      function fit(aspect){
        var t2 = Math.tan((40 * Math.PI / 180) / 2);
        camera.position.z = Math.max(2.75 / t2, 5.3 / (t2 * aspect));
      }
      fit(w / h);

      var group = new T.Group();
      scene.add(group);
      var world = new T.Group();
      world.position.set(-3.2, -1.75, 0);  /* the whole figure, centred in the box */
      group.add(world);

      function line(pts, color, opacity){
        var g = new T.BufferGeometry().setFromPoints(pts);
        return new T.Line(g, new T.LineBasicMaterial({
          color: color, transparent: true,
          opacity: opacity === undefined ? 1 : opacity }));
      }
      function makeArrow(color, rad){
        var g = new T.Group();
        var mat = new T.MeshBasicMaterial({ color: color });
        var shaft = new T.Mesh(new T.CylinderGeometry(rad, rad, 1, 12), mat);
        var head  = new T.Mesh(new T.ConeGeometry(rad * 3, rad * 7, 16), mat);
        g.add(shaft); g.add(head);
        g.userData = { shaft: shaft, head: head, rad: rad, mat: mat };
        return g;
      }
      function aim(g, from, to){
        var dir = new T.Vector3().subVectors(to, from), len = dir.length();
        if (len < 0.05){ g.visible = false; return; }
        g.visible = true;
        var hl = Math.min(g.userData.rad * 7, len * 0.42);
        var sl = Math.max(len - hl, 0.001);
        g.userData.shaft.scale.set(1, sl, 1);
        g.userData.shaft.position.set(0, sl / 2, 0);
        g.userData.head.scale.set(1, hl / (g.userData.rad * 7), 1);
        g.userData.head.position.set(0, sl + hl / 2, 0);
        g.position.copy(from);
        g.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
      }
      function label(text, css, size){
        var c = document.createElement('canvas');
        c.width = 512; c.height = 128;
        var ctx = c.getContext('2d');
        ctx.font = 'bold 74px Calibri, Candara, "Segoe UI", sans-serif';
        ctx.fillStyle = css; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, 256, 64);
        var tex = new T.CanvasTexture(c);
        tex.minFilter = T.LinearFilter;
        var m = new T.Mesh(new T.PlaneGeometry(size * 4, size),
          new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
        m.userData = { redraw: function(txt, colour){
          ctx.clearRect(0, 0, 512, 128);
          ctx.fillStyle = colour; ctx.fillText(txt, 256, 64);
          tex.needsUpdate = true;
        } };
        return m;
      }

      var O = new T.Vector3(0, 0, 0);
      var S = new T.Vector3(7.2, 0, 0);          /* the displacement, fixed */
      var FLEN = 3.4;

      /* the line s runs along, drawn past both ends: the projection needs a
         road to land on even when the angle is obtuse */
      world.add(line([new T.Vector3(-2, 0, 0), new T.Vector3(8.4, 0, 0)], INK, 0.22));

      var aS = makeArrow(INDIGO, 0.055);
      var aF = makeArrow(GOLD, 0.06);
      world.add(aS); world.add(aF);
      aim(aS, O, S);

      /* the projection: a fat segment on the line, plus the dropped dashed
         perpendicular from the tip of F down onto it */
      var projGeo = new T.BufferGeometry();
      projGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(6), 3));
      var projLine = new T.Line(projGeo, new T.LineBasicMaterial({ color: GREEN }));
      world.add(projLine);
      var projTube = new T.Mesh(new T.CylinderGeometry(0.045, 0.045, 1, 10),
        new T.MeshBasicMaterial({ color: GREEN }));
      world.add(projTube);
      var dropGeo = new T.BufferGeometry();
      dropGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(6), 3));
      world.add(new T.Line(dropGeo, new T.LineBasicMaterial({
        color: INK, transparent: true, opacity: 0.34 })));

      /* the angle arc between s and F, redrawn every frame */
      var ARC = 36;
      var arcPos = new Float32Array((ARC + 1) * 3);
      var arcGeo = new T.BufferGeometry();
      arcGeo.setAttribute('position', new T.BufferAttribute(arcPos, 3));
      world.add(new T.Line(arcGeo, new T.LineBasicMaterial({
        color: INK, transparent: true, opacity: 0.55 })));

      var lF = label('F', '#f5c542', 0.5);
      var lS = label('s', '#7c8cff', 0.5);
      var lT = label('θ', '#f4f7fb', 0.44);
      var lP = label('F cos θ', '#34d399', 0.42);
      var lW = label('W  +ve', '#34d399', 0.5);
      world.add(lF); world.add(lS); world.add(lT); world.add(lP); world.add(lW);
      lS.position.set(S.x * 0.62, -0.62, 0);
      lW.position.set(3.2, 3.95, 0);

      var t0 = Date.now(), lastW = w, lastH = h, lastBand = null;

      lfLoop(frame, function loop(){
        var nw = frame.clientWidth, nh = frame.clientHeight;
        if (!nw || !nh) return;                 /* page hidden — don't burn a GPU */
        if (nw !== lastW || nh !== lastH){
          lastW = nw; lastH = nh;
          camera.aspect = nw / nh; fit(nw / nh); camera.updateProjectionMatrix();
          renderer.setSize(nw, nh);
        }
        var t = (Date.now() - t0) / 1000;
        group.rotation.y = Math.sin(t / 8) * 0.11;
        group.rotation.x = -0.05;

        /* theta sweeps 8 deg -> 172 deg and back, slowly, so the class has time
           to watch the shadow shrink through zero and turn around */
        var u = 0.5 - 0.5 * Math.cos(t * 0.42);
        var th = (8 + 164 * u) * Math.PI / 180;
        var tip = new T.Vector3(FLEN * Math.cos(th), FLEN * Math.sin(th), 0);
        aim(aF, O, tip);
        lF.position.set(tip.x + 0.42, tip.y + 0.3, 0);

        var px = FLEN * Math.cos(th);           /* the projection, signed */
        var a = projGeo.getAttribute('position');
        a.array[0] = 0; a.array[1] = 0; a.array[2] = 0;
        a.array[3] = px; a.array[4] = 0; a.array[5] = 0;
        a.needsUpdate = true;
        var len = Math.abs(px);
        projTube.visible = len > 0.06;
        projTube.scale.set(1, Math.max(len, 0.001), 1);
        projTube.rotation.z = Math.PI / 2;
        projTube.position.set(px / 2, 0, 0);

        var d = dropGeo.getAttribute('position');
        d.array[0] = tip.x; d.array[1] = tip.y; d.array[2] = 0;
        d.array[3] = px;    d.array[4] = 0;     d.array[5] = 0;
        d.needsUpdate = true;

        for (var k = 0; k <= ARC; k++){
          var ang = th * k / ARC;
          arcPos[k * 3]     = 1.3 * Math.cos(ang);
          arcPos[k * 3 + 1] = 1.3 * Math.sin(ang);
          arcPos[k * 3 + 2] = 0;
        }
        arcGeo.getAttribute('position').needsUpdate = true;
        arcGeo.computeBoundingSphere();
        lT.position.set(1.82 * Math.cos(th / 2), 1.82 * Math.sin(th / 2), 0);
        lP.position.set(px / 2, -0.62, 0);
        lP.visible = len > 0.25;

        /* the readout only redraws when the sign actually changes — a canvas
           texture rebuilt every frame is the one thing that makes this scene
           expensive */
        var band = px > 0.12 ? 'p' : (px < -0.12 ? 'n' : 'z');
        if (band !== lastBand){
          lastBand = band;
          if (band === 'p'){ lW.userData.redraw('W  +ve', '#34d399');
                             projTube.material.color.setHex(GREEN);
                             projLine.material.color.setHex(GREEN); }
          else if (band === 'n'){ lW.userData.redraw('W  −ve', '#fb7185');
                             projTube.material.color.setHex(RED);
                             projLine.material.color.setHex(RED); }
          else { lW.userData.redraw('W = 0', '#f4f7fb');
                 projTube.material.color.setHex(0xf4f7fb);
                 projLine.material.color.setHex(0xf4f7fb); }
        }

        renderer.render(scene, camera);
      });
    }

    /* --------------------------------------------------- projectile power --
       `data-three="projectile-power"`. The power of gravity on a projectile.
       A still figure can draw the arc, v and mg; what it cannot show is that
       P = F·v = -mg·v_y runs -ve on the way up, passes through exactly zero at
       the crest (v is horizontal there, so gravity's shadow on it vanishes),
       and comes back +ve on the way down — and that plotted against time this
       is a STRAIGHT LINE through the crest, which is the whole of the P-t
       graph question. So the scene flies the particle, resolves v into its
       horizontal and vertical parts at the dot, and draws the P-t line
       underneath as the flight happens, with a marker riding it.

       Geometry only — no lesson text lives in the canvas beyond the axis
       names and the sign readout, and the frame ships a .scene-fallback with
       the source slide's own arc, which is what prints (rules 11, 20).      */
    function startProjectilePower(frame, w, h){
      var GOLD = 0xf5c542, INDIGO = 0x7c8cff, GREEN = 0x34d399,
          RED = 0xfb7185, INK = 0xf4f7fb;

      var renderer = lfOwn(frame, new T.WebGLRenderer({ alpha: true, antialias: LF_AA, powerPreference: 'high-performance' }));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      frame.appendChild(renderer.domElement);
      frame.classList.add('is-live');

      var scene = new T.Scene();
      var camera = new T.PerspectiveCamera(40, w / h, 0.1, 100);
      camera.position.set(0, 0, 12);
      camera.lookAt(0, 0, 0);
      function fit(aspect){
        var t2 = Math.tan((40 * Math.PI / 180) / 2);
        camera.position.z = Math.max(4.15 / t2, 6.1 / (t2 * aspect));
      }
      fit(w / h);

      var group = new T.Group();
      scene.add(group);
      var world = new T.Group();
      world.position.set(0, 0.15, 0);
      group.add(world);

      function line(pts, color, opacity){
        var g = new T.BufferGeometry().setFromPoints(pts);
        return new T.Line(g, new T.LineBasicMaterial({
          color: color, transparent: true,
          opacity: opacity === undefined ? 1 : opacity }));
      }
      function makeArrow(color, rad){
        var g = new T.Group();
        var mat = new T.MeshBasicMaterial({ color: color });
        var shaft = new T.Mesh(new T.CylinderGeometry(rad, rad, 1, 12), mat);
        var head  = new T.Mesh(new T.ConeGeometry(rad * 3, rad * 7, 16), mat);
        g.add(shaft); g.add(head);
        g.userData = { shaft: shaft, head: head, rad: rad, mat: mat };
        return g;
      }
      function aim(g, from, to){
        var dir = new T.Vector3().subVectors(to, from), len = dir.length();
        if (len < 0.06){ g.visible = false; return; }
        g.visible = true;
        var hl = Math.min(g.userData.rad * 7, len * 0.42);
        var sl = Math.max(len - hl, 0.001);
        g.userData.shaft.scale.set(1, sl, 1);
        g.userData.shaft.position.set(0, sl / 2, 0);
        g.userData.head.scale.set(1, hl / (g.userData.rad * 7), 1);
        g.userData.head.position.set(0, sl + hl / 2, 0);
        g.position.copy(from);
        g.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
      }
      function label(text, css, size){
        var c = document.createElement('canvas');
        c.width = 512; c.height = 128;
        var ctx = c.getContext('2d');
        ctx.font = 'bold 74px Calibri, Candara, "Segoe UI", sans-serif';
        ctx.fillStyle = css; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, 256, 64);
        var tex = new T.CanvasTexture(c);
        tex.minFilter = T.LinearFilter;
        var m = new T.Mesh(new T.PlaneGeometry(size * 4, size),
          new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
        m.userData = { redraw: function(txt, colour){
          ctx.clearRect(0, 0, 512, 128);
          ctx.fillStyle = colour; ctx.fillText(txt, 256, 64);
          tex.needsUpdate = true;
        } };
        return m;
      }

      /* the flight: x runs -5 -> 5, y is the parabola 4*4u(1-u) */
      var X0 = -5, X1 = 5, HMAX = 3.3;
      function px(u){ return X0 + (X1 - X0) * u; }
      function py(u){ return 4 * HMAX * u * (1 - u); }

      /* ground, and the arc drawn as a faint dotted road the dot then runs */
      world.add(line([new T.Vector3(X0 - 0.7, 0, 0), new T.Vector3(X1 + 0.7, 0, 0)], INK, 0.24));
      var arcPts = [];
      for (var i = 0; i <= 96; i++) arcPts.push(new T.Vector3(px(i / 96), py(i / 96), 0));
      world.add(line(arcPts, INK, 0.30));

      /* the P-t axes underneath — scaffolding, drawn once and never animated */
      var GY = -2.55, GH = 1.15;                 /* t-axis height, half-span   */
      world.add(line([new T.Vector3(X0, GY - GH - 0.35, 0),
                      new T.Vector3(X0, GY + GH + 0.35, 0)], INK, 0.42));
      world.add(line([new T.Vector3(X0 - 0.35, GY, 0),
                      new T.Vector3(X1 + 0.5, GY, 0)], INK, 0.42));

      /* the P-t line itself, revealed as far as the flight has got */
      var LN = 64;
      var linePos = new Float32Array((LN + 1) * 3);
      var lineGeo = new T.BufferGeometry();
      lineGeo.setAttribute('position', new T.BufferAttribute(linePos, 3));
      world.add(new T.Line(lineGeo, new T.LineBasicMaterial({ color: GOLD })));

      var body = new T.Mesh(new T.SphereGeometry(0.17, 20, 16),
        new T.MeshBasicMaterial({ color: GOLD }));
      world.add(body);
      var pen = new T.Mesh(new T.SphereGeometry(0.11, 16, 12),
        new T.MeshBasicMaterial({ color: GOLD }));
      world.add(pen);

      var aV  = makeArrow(GOLD, 0.055);          /* v, tangent to the path     */
      var aG  = makeArrow(INDIGO, 0.055);        /* mg, always straight down   */
      var aVy = makeArrow(GREEN, 0.045);         /* the vertical part of v     */
      world.add(aV); world.add(aG); world.add(aVy);

      /* the dashed rectangle closing v_x and v_y back onto v */
      var boxGeo = new T.BufferGeometry();
      boxGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(12), 3));
      world.add(new T.Line(boxGeo, new T.LineBasicMaterial({
        color: INK, transparent: true, opacity: 0.30 })));

      var lV  = label('v', '#f5c542', 0.66);
      var lG  = label('mg', '#7c8cff', 0.60);
      var lVy = label('vy', '#34d399', 0.56);
      var lP  = label('P', '#f4f7fb', 0.58);
      var lT  = label('t', '#f4f7fb', 0.58);
      var lR  = label('P = −ve', '#fb7185', 1.05);
      world.add(lV); world.add(lG); world.add(lVy); world.add(lP); world.add(lT); world.add(lR);
      lP.position.set(X0 - 0.66, GY + GH + 0.34, 0);
      lT.position.set(X1 + 0.62, GY - 0.48, 0);
      lR.position.set(2.6, GY + GH + 1.02, 0);

      var t0 = Date.now(), lastW = w, lastH = h, lastBand = null;

      lfLoop(frame, function loop(){
        var nw = frame.clientWidth, nh = frame.clientHeight;
        if (!nw || !nh) return;                  /* page hidden — spare the GPU */
        if (nw !== lastW || nh !== lastH){
          lastW = nw; lastH = nh;
          camera.aspect = nw / nh; fit(nw / nh); camera.updateProjectionMatrix();
          renderer.setSize(nw, nh);
        }
        var t = (Date.now() - t0) / 1000;
        group.rotation.y = Math.sin(t / 9) * 0.09;
        group.rotation.x = -0.04;

        /* one flight every 9 s, with a beat of stillness on the ground */
        var cyc = (t % 9) / 9;
        var u = Math.min(Math.max((cyc - 0.06) / 0.82, 0), 1);

        var X = px(u), Y = py(u);
        var at = new T.Vector3(X, Y, 0);
        body.position.copy(at);

        /* v from the tangent, scaled small enough to stay inside the box */
        var vx = (X1 - X0), vy = 4 * HMAX * (1 - 2 * u);
        var k = 0.105;
        var tip = new T.Vector3(X + vx * k, Y + vy * k, 0);
        aim(aV, at, tip);
        lV.position.set(tip.x + 0.44, tip.y + 0.30, 0);

        aim(aG, at, new T.Vector3(X, Y - 1.15, 0));
        lG.position.set(X + 0.72, Y - 0.86, 0);

        /* the vertical part of v — the only part gravity can see */
        var vyTip = new T.Vector3(X, Y + vy * k, 0);
        aim(aVy, at, vyTip);
        lVy.position.set(X - 0.46, Y + vy * k * 0.55, 0);
        lVy.visible = Math.abs(vy * k) > 0.42;

        var b = boxGeo.getAttribute('position');
        b.array[0] = vyTip.x; b.array[1] = vyTip.y; b.array[2] = 0;
        b.array[3] = tip.x;   b.array[4] = tip.y;   b.array[5] = 0;
        b.array[6] = X + vx * k; b.array[7] = Y;    b.array[8] = 0;
        b.array[9] = X;       b.array[10] = Y;      b.array[11] = 0;
        b.needsUpdate = true;

        /* P = -mg.v_y : straight line in t, zero at the crest */
        for (var j = 0; j <= LN; j++){
          var uu = Math.min(j / LN, u);
          linePos[j * 3]     = px(uu);
          linePos[j * 3 + 1] = GY + GH * (2 * uu - 1);
          linePos[j * 3 + 2] = 0;
        }
        lineGeo.getAttribute('position').needsUpdate = true;
        lineGeo.computeBoundingSphere();
        pen.position.set(X, GY + GH * (2 * u - 1), 0);

        var band = u < 0.47 ? 'n' : (u > 0.53 ? 'p' : 'z');
        if (band !== lastBand){
          lastBand = band;
          if (band === 'n'){ lR.userData.redraw('P = −ve', '#fb7185');
                             aVy.userData.mat.color.setHex(RED); }
          else if (band === 'p'){ lR.userData.redraw('P = +ve', '#34d399');
                             aVy.userData.mat.color.setHex(GREEN); }
          else { lR.userData.redraw('P = 0', '#f4f7fb');
                 aVy.userData.mat.color.setHex(INK); }
        }

        renderer.render(scene, camera);
      });
    }

    /* ------------------------------------------------ mechanics scenes 2D --
       Two scenes for the Laws-of-Motion / momentum decks. Both draw geometry
       only — no lesson text lives in the canvas, and every frame carries a
       .scene-fallback that prints (rule 20).

         impulse-wall        a ball reflecting off a wall at data-angle degrees
                             FROM THE NORMAL, with p, p' drawn tail-to-tail and
                             Dp = p' - p closing them. The one thing a still
                             figure cannot show: the tangential part survives,
                             only the normal part reverses, so Dp always lies
                             along the normal however the ball comes in.
         explosion-momentum  a body at rest bursting into three fragments whose
                             momentum vectors close on themselves: p1 + p2 = -p3.
         recoil-momentum     a gun at rest fires a bullet: the bullet's p and the
                             gun's -p grow together out of one origin and always
                             cancel. A still figure can draw the two arrows but
                             not the fact that they are BORN together out of zero.
         collision-momentum  two bodies meet and leave with different velocities
                             while the tail-to-tip sum underneath them keeps the
                             same length through the collision — the one thing
                             "momentum is conserved" means and a still figure
                             has to assert rather than show.

       Three more for the Collision deck. Each exists because the thing being
       taught is a comparison across a *repeated event*, which no still figure
       can hold:

         restitution-e       the same head-on collision run three times over, at
                             e = 1, e = 0.5 and e = 0. Under the track, the
                             approach speed (fixed) and the separation speed
                             (shrinking) are drawn as two bars, so e is read off
                             as the ratio of one bar to the other and the bar
                             collapses to nothing exactly when the two bodies
                             leave stuck together. e is a definition about two
                             speeds, and both speeds only exist across time.
         newton-cradle       five balls on cords. One is lifted and released and
                             exactly one leaves the far end; then two are lifted
                             and exactly two leave. The whole "warning for the
                             pendulum case" slide is that the answer is not one
                             ball at u/2 — which is a claim about what happens,
                             not about what the apparatus looks like.
         bounce-decay        a ball dropped from h bouncing with e, leaving a
                             faint marker at each apex, so the heights h, e2h,
                             e4h … stand as a visible geometric progression.
                             The GP is the slide; the GP is made of successive
                             bounces.
    */
    function startMech2D(frame, w, h, kind){
      var GOLD = 0xf5c542, INDIGO = 0x7c8cff, CYAN = 0x56ccf2,
          GREEN = 0x34d399, INK = 0xf4f7fb;

      var renderer = lfOwn(frame, new T.WebGLRenderer({ alpha: true, antialias: LF_AA, powerPreference: 'high-performance' }));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      frame.appendChild(renderer.domElement);
      frame.classList.add('is-live');

      var scene = new T.Scene();
      var camera = new T.PerspectiveCamera(40, w / h, 0.1, 100);
      camera.position.set(0, 0, 9.6);
      camera.lookAt(0, 0, 0);
      function fit(aspect){
        var t2 = Math.tan((40 * Math.PI / 180) / 2);
        camera.position.z = Math.max(2.9 / t2, 4.35 / (t2 * aspect));
      }
      fit(w / h);

      var world = new T.Group();
      world.position.set(-4, -2.5, 0);          /* plane coords: x 0..8, y 0..5 */
      scene.add(world);

      function line(pts, color, opacity){
        var g = new T.BufferGeometry().setFromPoints(pts);
        return new T.Line(g, new T.LineBasicMaterial({
          color: color, transparent: true, opacity: opacity === undefined ? 1 : opacity }));
      }
      function dashed(a, b, color, opacity, dash){
        var g = new T.Group(), d = dash || 0.22,
            v = new T.Vector3().subVectors(b, a), len = v.length(), n = v.clone().normalize();
        for (var s = 0; s < len; s += d * 2){
          g.add(line([a.clone().addScaledVector(n, s),
                      a.clone().addScaledVector(n, Math.min(s + d, len))], color, opacity));
        }
        return g;
      }
      function arrow(color, rad, opacity){
        var g = new T.Group();
        var mat = new T.MeshBasicMaterial({ color: color, transparent: true,
          opacity: opacity === undefined ? 1 : opacity });
        var shaft = new T.Mesh(new T.CylinderGeometry(rad, rad, 1, 10), mat);
        var head  = new T.Mesh(new T.ConeGeometry(rad * 3, rad * 7, 14), mat);
        g.add(shaft); g.add(head);
        g.userData = { shaft: shaft, head: head, rad: rad, mat: mat };
        return g;
      }
      function aim(g, from, to){
        var dir = new T.Vector3().subVectors(to, from), len = dir.length();
        if (len < 0.05){ g.visible = false; return; }
        g.visible = true;
        var hl = Math.min(g.userData.rad * 7, len * 0.45);
        var sl = Math.max(len - hl, 0.001);
        g.userData.shaft.scale.set(1, sl, 1);
        g.userData.shaft.position.set(0, sl / 2, 0);
        g.userData.head.scale.set(1, hl / (g.userData.rad * 7), 1);
        g.userData.head.position.set(0, sl + hl / 2, 0);
        g.position.copy(from);
        g.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
      }
      function label(text, css, size){
        var c = document.createElement('canvas');
        c.width = 256; c.height = 128;
        var ctx = c.getContext('2d');
        ctx.font = 'bold 76px Calibri, Candara, "Segoe UI", sans-serif';
        ctx.fillStyle = css; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, 128, 64);
        var tex = new T.CanvasTexture(c);
        tex.minFilter = T.LinearFilter;
        var m = new T.Mesh(new T.PlaneGeometry(size * 2, size),
          new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
        return m;
      }
      function dot(color, r){
        return new T.Mesh(new T.SphereGeometry(r || 0.14, 18, 12),
          new T.MeshBasicMaterial({ color: color }));
      }
      function fade(objs, o){
        objs.forEach(function(m){
          if (!m) return;
          m.visible = o > 0.02;
          m.traverse(function(c){
            if (c.material){ c.material.transparent = true; c.material.opacity = o; }
          });
        });
      }

      var live = [];        /* things whose opacity the loop drives */
      var tick = null;

      /* ------------------------------------------------------ impulse-wall -- */
      if (kind === 'impulse-wall'){
        var deg = parseFloat(frame.getAttribute('data-angle'));
        if (!isFinite(deg)) deg = 60;
        var th = Math.max(0, Math.min(80, deg)) * Math.PI / 180;

        var WX = 6.5, P = new T.Vector3(WX, 2.9, 0);
        world.add(line([new T.Vector3(WX, 0.5, 0), new T.Vector3(WX, 4.7, 0)], INK, 0.85));
        for (var yy = 0.5; yy <= 4.7; yy += 0.34){          /* hatching behind it */
          world.add(line([new T.Vector3(WX, yy, 0),
                          new T.Vector3(WX + 0.34, yy + 0.34, 0)], INDIGO, 0.5));
        }
        world.add(dashed(new T.Vector3(WX - 2.9, P.y, 0), new T.Vector3(WX, P.y, 0), INK, 0.4));

        /* the normal is horizontal (the dashed line), so th opens off it */
        var dIn  = new T.Vector3(Math.cos(th), -Math.sin(th), 0);
        var dOut = new T.Vector3(-Math.cos(th), -Math.sin(th), 0);
        var LEG = 2.6;
        var A = P.clone().addScaledVector(dIn, -LEG);
        var B = P.clone().addScaledVector(dOut, LEG);

        world.add(dashed(A, P, INK, 0.22, 0.16));
        world.add(dashed(P, B, INK, 0.22, 0.16));

        var ball = dot(GOLD, 0.17); world.add(ball);
        var vIn  = arrow(GOLD, 0.055);  world.add(vIn);
        var vOut = arrow(GOLD, 0.055);  world.add(vOut);

        /* the triad: p and p' tail to tail, Dp closing them */
        var O = new T.Vector3(2.05, 1.55, 0), S = 1.75;
        var pI = arrow(GOLD, 0.062),  pF = arrow(INDIGO, 0.062), dP = arrow(GREEN, 0.07);
        world.add(pI); world.add(pF); world.add(dP);
        var tipI = O.clone().addScaledVector(dIn, S);
        var tipF = O.clone().addScaledVector(dOut, S);
        aim(pI, O, tipI); aim(pF, O, tipF); aim(dP, tipI, tipF);
        var lI = label('p', '#f5c542', 0.44), lF = label('p′', '#9fb4ff', 0.44),
            lD = label('Δp', '#34d399', 0.5);
        lI.position.copy(tipI).add(new T.Vector3(0.26, -0.2, 0));
        lF.position.copy(tipF).add(new T.Vector3(-0.3, -0.2, 0));
        lD.position.copy(tipI).lerp(tipF, 0.5).add(new T.Vector3(0, 0.36, 0));
        world.add(lI); world.add(lF); world.add(lD);
        var triad = [pI, pF, dP, lI, lF, lD];
        fade(triad, 0);
        fade([vOut], 0);

        tick = function(t){
          var T0 = 6.4, u = (t % T0) / T0;
          var seg;
          if (u < 0.34){                                  /* coming in */
            seg = u / 0.34;
            ball.position.copy(A).lerp(P, seg);
            aim(vIn, ball.position.clone().addScaledVector(dIn, -1.15), ball.position);
            vIn.visible = true;
            fade([vOut], 0); fade(triad, 0);
          } else if (u < 0.72){                           /* going out */
            seg = (u - 0.34) / 0.38;
            ball.position.copy(P).lerp(B, seg);
            vIn.visible = false;
            fade([vOut], 1);
            aim(vOut, ball.position.clone().addScaledVector(dOut, -1.15), ball.position);
            fade(triad, Math.min(1, seg * 2.6));
          } else {                                        /* hold on the triad */
            ball.position.copy(B);
            vIn.visible = false;
            fade([vOut], 1);
            aim(vOut, B.clone().addScaledVector(dOut, -1.15), B);
            fade(triad, Math.max(0, 1 - Math.max(0, (u - 0.92) / 0.08)));
          }
        };
      }

      /* ------------------------------------------------ explosion-momentum -- */
      if (kind === 'explosion-momentum'){
        var C = new T.Vector3(3.5, 2.3, 0);
        var v1 = new T.Vector3(2.35, 0, 0);                /* p1, to the right   */
        var v2 = new T.Vector3(0, 1.85, 0);                /* p2, at right angles */
        var vR = new T.Vector3().addVectors(v1, v2);       /* their resultant     */
        var v3 = vR.clone().multiplyScalar(-1);            /* p3 closes the sum   */

        var g1 = dashed(C.clone().add(v1), C.clone().add(vR), INK, 0.3);
        var g2 = dashed(C.clone().add(v2), C.clone().add(vR), INK, 0.3);
        world.add(g1); world.add(g2);
        var res = arrow(INK, 0.045, 0.42); world.add(res);
        aim(res, C, C.clone().add(vR));

        var a1 = arrow(GOLD, 0.062), a2 = arrow(CYAN, 0.062), a3 = arrow(INDIGO, 0.07);
        world.add(a1); world.add(a2); world.add(a3);
        aim(a1, C, C.clone().add(v1));
        aim(a2, C, C.clone().add(v2));
        aim(a3, C, C.clone().add(v3));

        var l1 = label('p₁', '#f5c542', 0.46),
            l2 = label('p₂', '#8fdcff', 0.46),
            l3 = label('p₃', '#9fb4ff', 0.46);
        l1.position.copy(C).add(v1).add(new T.Vector3(0.16, 0.34, 0));
        l2.position.copy(C).add(v2).add(new T.Vector3(0.38, 0.14, 0));
        l3.position.copy(C).add(v3).add(new T.Vector3(-0.16, -0.34, 0));
        world.add(l1); world.add(l2); world.add(l3);

        var body = dot(INK, 0.2); body.position.copy(C); world.add(body);
        var f1 = dot(GOLD, 0.14), f2 = dot(CYAN, 0.14), f3 = dot(INDIGO, 0.18);
        world.add(f1); world.add(f2); world.add(f3);
        var vecs = [a1, a2, a3, l1, l2, l3, res, g1, g2];
        fade(vecs, 0);

        tick = function(t){
          var T0 = 6.0, u = (t % T0) / T0, k;
          if (u < 0.22){                                   /* the body, at rest */
            body.visible = true;
            body.scale.setScalar(1 + 0.06 * Math.sin(t * 5));
            f1.visible = f2.visible = f3.visible = false;
            fade(vecs, 0);
          } else {
            body.visible = false;
            f1.visible = f2.visible = f3.visible = true;
            k = Math.min(1, (u - 0.22) / 0.42);
            k = 1 - Math.pow(1 - k, 3);
            f1.position.copy(C).addScaledVector(v1, k);
            f2.position.copy(C).addScaledVector(v2, k);
            f3.position.copy(C).addScaledVector(v3, k);
            fade(vecs, Math.min(1, k * 1.6) * (1 - Math.max(0, (u - 0.93) / 0.07)));
          }
        };
      }

      /* an outline rectangle, drawn as a closed line loop (geometry only) */
      function boxOutline(cx, cy, bw, bh, color, opacity){
        var x0 = cx - bw / 2, x1 = cx + bw / 2, y0 = cy - bh / 2, y1 = cy + bh / 2;
        return line([new T.Vector3(x0, y0, 0), new T.Vector3(x1, y0, 0),
                     new T.Vector3(x1, y1, 0), new T.Vector3(x0, y1, 0),
                     new T.Vector3(x0, y0, 0)], color, opacity);
      }
      function ground(y, x0, x1){
        var g = new T.Group();
        g.add(line([new T.Vector3(x0, y, 0), new T.Vector3(x1, y, 0)], INDIGO, 0.95));
        for (var gx = x0 + 0.2; gx <= x1; gx += 0.44){
          g.add(line([new T.Vector3(gx, y, 0),
                      new T.Vector3(gx - 0.3, y - 0.3, 0)], INDIGO, 0.34));
        }
        return g;
      }

      /* --------------------------------------------------- recoil-momentum -- */
      if (kind === 'recoil-momentum'){
        var GY = 1.0;
        world.add(ground(GY, 0.5, 7.6));

        var X0 = 3.55;                                   /* where both start   */
        var gun = new T.Group();                         /* breech + barrel    */
        gun.add(boxOutline(-0.5, GY + 0.44, 1.5, 0.6, INK, 0.85));
        gun.add(boxOutline(0.62, GY + 0.5, 0.9, 0.2, INK, 0.85));
        gun.add(line([new T.Vector3(-1.1, GY + 0.14, 0),
                      new T.Vector3(-0.62, GY - 0.02, 0)], INK, 0.6));
        gun.position.set(X0, 0, 0);
        world.add(gun);

        var slug = dot(GOLD, 0.13);
        world.add(slug);

        /* the two momenta, born together out of one origin */
        var O2 = new T.Vector3(3.9, 3.55, 0), K = 1.55;
        var hub = dot(GREEN, 0.075); hub.position.copy(O2); world.add(hub);
        var pB = arrow(GOLD, 0.062), pG = arrow(INDIGO, 0.062);
        world.add(pB); world.add(pG);
        var lB = label('p', '#f5c542', 0.44), lG = label('−p', '#9fb4ff', 0.5),
            lS = label('Σp = 0', '#34d399', 0.62);
        lS.position.copy(O2).add(new T.Vector3(0, -0.62, 0));
        world.add(lB); world.add(lG); world.add(lS);
        var triadR = [pB, pG, lB, lG, hub, lS];
        fade(triadR, 0);

        tick = function(t){
          var T0 = 6.2, u = (t % T0) / T0, k;
          if (u < 0.2){                                  /* both at rest       */
            gun.position.x = X0;
            slug.position.set(X0 + 1.12, GY + 0.5, 0);
            fade(triadR, 0);
          } else {
            k = Math.min(1, (u - 0.2) / 0.5);
            k = 1 - Math.pow(1 - k, 3);
            gun.position.x = X0 - 0.85 * k;              /* light kick back    */
            slug.position.set(X0 + 1.12 + 3.05 * k, GY + 0.5, 0);
            var s = Math.min(1, k * 1.5) * K;
            aim(pB, O2, O2.clone().add(new T.Vector3(s, 0, 0)));
            aim(pG, O2, O2.clone().add(new T.Vector3(-s, 0, 0)));
            lB.position.copy(O2).add(new T.Vector3(s + 0.34, 0.3, 0));
            lG.position.copy(O2).add(new T.Vector3(-s - 0.42, 0.3, 0));
            fade(triadR, Math.min(1, k * 2.2) * (1 - Math.max(0, (u - 0.93) / 0.07)));
          }
        };
      }

      /* ------------------------------------------------ collision-momentum -- */
      if (kind === 'collision-momentum'){
        var LY = 3.45, MEET = 4.0;
        world.add(dashed(new T.Vector3(0.6, LY, 0), new T.Vector3(7.5, LY, 0), INK, 0.16, 0.18));

        /* m1 = 1, m2 = 2 · u1 = +2.4, u2 = −0.6 · v1 = −1.6, v2 = +1.4     */
        var U1 = 2.4, U2 = -0.6, V1 = -1.6, V2 = 1.4, R1 = 0.26, R2 = 0.4;
        var b1 = dot(GOLD, R1), b2 = dot(INDIGO, R2);
        world.add(b1); world.add(b2);
        var m1L = label('m₁', '#f5c542', 0.4), m2L = label('m₂', '#9fb4ff', 0.4);
        world.add(m1L); world.add(m2L);
        var w1 = arrow(GOLD, 0.05), w2 = arrow(INDIGO, 0.05);
        world.add(w1); world.add(w2);

        /* the tail-to-tip sum, underneath, in the same gold as the answer */
        var OB = new T.Vector3(1.5, 1.75, 0), SC = 0.78;
        var q1 = arrow(GOLD, 0.055), q2 = arrow(INDIGO, 0.055), qT = arrow(GREEN, 0.07);
        world.add(q1); world.add(q2); world.add(qT);
        var lq1 = label('p₁', '#f5c542', 0.4), lq2 = label('p₂', '#9fb4ff', 0.4),
            lqT = label('Σp', '#34d399', 0.44);
        world.add(lq1); world.add(lq2); world.add(lqT);
        var TOT = 1 * U1 + 2 * U2;                        /* = 1.2, and stays  */
        var OT = OB.clone().add(new T.Vector3(0, -0.72, 0));
        aim(qT, OT, OT.clone().add(new T.Vector3(TOT * SC, 0, 0)));
        lqT.position.copy(OT).add(new T.Vector3(TOT * SC + 0.4, 0, 0));

        function sum(p1, p2){
          var t1 = OB.clone().add(new T.Vector3(p1 * SC, 0, 0));
          aim(q1, OB, t1);
          aim(q2, t1, t1.clone().add(new T.Vector3(p2 * SC, 0, 0)));
          lq1.position.copy(OB).lerp(t1, 0.5).add(new T.Vector3(0, 0.38, 0));
          lq2.position.copy(t1).add(new T.Vector3(p2 * SC / 2, -0.4, 0));
        }

        tick = function(t){
          var T0 = 7.4, u = (t % T0) / T0, s, x1, x2, a1v, a2v;
          if (u < 0.42){                                  /* coming together   */
            s = u / 0.42;
            x1 = MEET - (R1 + R2) - U1 * 1.05 * (1 - s);
            x2 = MEET + (R1 + R2) - U2 * 1.05 * (1 - s);
            a1v = U1; a2v = U2;
          } else if (u < 0.5){                            /* contact           */
            x1 = MEET - (R1 + R2); x2 = MEET + (R1 + R2);
            a1v = 0; a2v = 0;
          } else {                                        /* leaving           */
            s = Math.min(1, (u - 0.5) / 0.42);
            x1 = MEET - (R1 + R2) + V1 * 1.15 * s;
            x2 = MEET + (R1 + R2) + V2 * 1.15 * s;
            a1v = V1; a2v = V2;
          }
          b1.position.set(x1, LY, 0); b2.position.set(x2, LY, 0);
          m1L.position.set(x1, LY - 0.62, 0);
          m2L.position.set(x2, LY - 0.72, 0);
          if (a1v === 0){ w1.visible = false; w2.visible = false; }
          else {
            aim(w1, new T.Vector3(x1, LY + 0.62, 0),
                    new T.Vector3(x1 + a1v * 0.42, LY + 0.62, 0));
            aim(w2, new T.Vector3(x2, LY + 0.62, 0),
                    new T.Vector3(x2 + a2v * 0.42, LY + 0.62, 0));
          }
          sum(u < 0.46 ? U1 : V1, u < 0.46 ? 2 * U2 : 2 * V2);
        };
      }

      /* ----------------------------------------------------- restitution-e --
         The same head-on collision at e = 1, 0.5, 0. Equal masses, so
         v1 = ((1-e)u1 + (1+e)u2)/2 and v2 = ((1+e)u1 + (1-e)u2)/2, which makes
         the separation speed exactly e times the approach speed. Two bars
         under the track carry those two speeds: the top one never changes, the
         bottom one shrinks with e and vanishes at e = 0 — which is the moment
         the two bodies leave together. That ratio is the definition, and it
         cannot be drawn without running the event more than once.           */
      if (kind === 'restitution-e'){
        var RLY = 3.65, RMEET = 4.0, RU1 = 2.2, RU2 = -1.0, RR1 = 0.28, RR2 = 0.34;
        var ES = [1, 0.5, 0];
        world.add(dashed(new T.Vector3(0.6, RLY, 0), new T.Vector3(7.5, RLY, 0), INK, 0.16, 0.18));

        var rb1 = dot(GOLD, RR1), rb2 = dot(INDIGO, RR2);
        world.add(rb1); world.add(rb2);
        var rl1 = label('m', '#f5c542', 0.5), rl2 = label('m', '#9fb4ff', 0.5);
        world.add(rl1); world.add(rl2);
        var rw1 = arrow(GOLD, 0.05), rw2 = arrow(INDIGO, 0.05);
        world.add(rw1); world.add(rw2);

        /* the two speed bars — approach on top, separation under it */
        var BX = 1.35, BSC = 1.34, BYA = 1.62, BYS = 0.92;
        var barA = arrow(CYAN, 0.062), barS = arrow(GREEN, 0.062);
        world.add(barA); world.add(barS);
        var laA = label('app', '#56ccf2', 0.62), laS = label('sep', '#34d399', 0.62),
            laE = label('e = 1', '#f5c542', 0.86);
        world.add(laA); world.add(laS); world.add(laE);
        /* top-left, clear of the bars — the app label ends near x = 6.2 */
        laE.position.set(1.15, 4.62, 0);
        var APP = RU1 - RU2;                              /* fixed at 3.2      */
        aim(barA, new T.Vector3(BX, BYA, 0), new T.Vector3(BX + APP * BSC, BYA, 0));
        laA.position.set(BX + APP * BSC + 0.72, BYA, 0);

        tick = function(t){
          var LEG = 6.2, idx = Math.floor((t / LEG) % 3), u = ((t % LEG) / LEG);
          var e = ES[idx];
          var v1 = ((1 - e) * RU1 + (1 + e) * RU2) / 2;
          var v2 = ((1 + e) * RU1 + (1 - e) * RU2) / 2;
          var gap = RR1 + RR2, x1, x2, a1v, a2v;
          if (u < 0.40){
            var s = u / 0.40;
            x1 = RMEET - gap - RU1 * 1.15 * (1 - s);
            x2 = RMEET + gap - RU2 * 1.15 * (1 - s);
            a1v = RU1; a2v = RU2;
          } else if (u < 0.48){
            x1 = RMEET - gap; x2 = RMEET + gap; a1v = 0; a2v = 0;
          } else {
            var s2 = Math.min(1, (u - 0.48) / 0.42);
            x1 = RMEET - gap + v1 * 1.25 * s2;
            x2 = RMEET + gap + v2 * 1.25 * s2;
            a1v = v1; a2v = v2;
          }
          /* at e = 0 they travel together — keep them touching, not overlapping */
          if (e === 0 && u >= 0.48){ x1 = x2 - gap; }
          rb1.position.set(x1, RLY, 0); rb2.position.set(x2, RLY, 0);
          rl1.position.set(x1, RLY - 0.58, 0);
          rl2.position.set(x2, RLY - 0.64, 0);
          if (!a1v && !a2v){ rw1.visible = false; rw2.visible = false; }
          else {
            aim(rw1, new T.Vector3(x1, RLY + 0.62, 0),
                     new T.Vector3(x1 + a1v * 0.46, RLY + 0.62, 0));
            aim(rw2, new T.Vector3(x2, RLY + 0.62, 0),
                     new T.Vector3(x2 + a2v * 0.46, RLY + 0.62, 0));
          }
          /* the separation bar only means anything after they have left */
          var sep = (u < 0.48) ? 0 : (v2 - v1);
          if (sep < 0.04){ barS.visible = false; laS.visible = false; }
          else {
            barS.visible = true; laS.visible = true;
            aim(barS, new T.Vector3(BX, BYS, 0), new T.Vector3(BX + sep * BSC, BYS, 0));
            laS.position.set(BX + sep * BSC + 0.72, BYS, 0);
          }
          var want = 'e = ' + (e === 0.5 ? '0.5' : e);
          if (laE.userData.txt !== want){
            laE.userData.txt = want;
            world.remove(laE);
            laE = label(want, '#f5c542', 0.86);
            laE.userData.txt = want;
            laE.position.set(1.15, 4.62, 0);
            world.add(laE);
          }
        };
      }

      /* ------------------------------------------------------ newton-cradle --
         Five equal balls on cords. One is lifted and released and exactly one
         leaves the far end at the same speed; then two are lifted and exactly
         two leave. The slide this pairs with is a warning against answering
         "one ball at u/2", and the answer is an event, not an apparatus.    */
      if (kind === 'newton-cradle'){
        var TOPY = 4.62, CORD = 2.5, BR = 0.36, SPACE = 0.73, CX0 = 4 - 2 * SPACE;
        var A0 = 0.6;                                     /* swing amplitude   */

        /* the rig — scaffolding, drawn once */
        world.add(line([new T.Vector3(CX0 - 1.15, TOPY, 0),
                        new T.Vector3(CX0 + 4 * SPACE + 1.15, TOPY, 0)], INK, 0.42));
        world.add(line([new T.Vector3(CX0 - 1.15, TOPY, 0),
                        new T.Vector3(CX0 - 1.15, TOPY - CORD - 0.95, 0)], INK, 0.3));
        world.add(line([new T.Vector3(CX0 + 4 * SPACE + 1.15, TOPY, 0),
                        new T.Vector3(CX0 + 4 * SPACE + 1.15, TOPY - CORD - 0.95, 0)], INK, 0.3));
        world.add(line([new T.Vector3(CX0 - 1.45, TOPY - CORD - 0.95, 0),
                        new T.Vector3(CX0 + 4 * SPACE + 1.45, TOPY - CORD - 0.95, 0)], INK, 0.3));

        var ncBalls = [], ncCords = [];
        for (var bi = 0; bi < 5; bi++){
          var bb = dot(bi === 2 ? INDIGO : INDIGO, BR);
          world.add(bb); ncBalls.push(bb);
          var cg = line([new T.Vector3(0, 0, 0), new T.Vector3(0, -1, 0)], INK, 0.34);
          world.add(cg); ncCords.push(cg);
        }
        function ncPlace(i, th){
          var px = CX0 + i * SPACE, x = px + CORD * Math.sin(th),
              y = TOPY - CORD * Math.cos(th);
          ncBalls[i].position.set(x, y, 0);
          ncCords[i].geometry.setFromPoints([new T.Vector3(px, TOPY, 0),
                                             new T.Vector3(x, y, 0)]);
          ncCords[i].geometry.attributes.position.needsUpdate = true;
        }

        tick = function(t){
          var CYC = 12.4, u = (t % CYC) / CYC;
          var n, s;
          if (u < 0.46){ n = 1; s = u / 0.46; }
          else if (u < 0.5){ n = 1; s = 1; }
          else if (u < 0.96){ n = 2; s = (u - 0.5) / 0.46; }
          else { n = 2; s = 1; }
          var lt = 0, rt = 0, q = Math.PI / 2;
          if (s < 0.25)      { lt = -A0 * Math.cos((s / 0.25) * q); }
          else if (s < 0.5)  { rt =  A0 * Math.sin(((s - 0.25) / 0.25) * q); }
          else if (s < 0.75) { rt =  A0 * Math.cos(((s - 0.5) / 0.25) * q); }
          else               { lt = -A0 * Math.sin(((s - 0.75) / 0.25) * q); }
          for (var i = 0; i < 5; i++){
            var th = 0;
            if (i < n) th = lt;
            else if (i >= 5 - n) th = rt;
            ncPlace(i, th);
            ncBalls[i].material.color.setHex((i < n || i >= 5 - n) ? GOLD : INDIGO);
          }
        };
      }

      /* -------------------------------------------------------- bounce-decay --
         A ball dropped from h bouncing with e, leaving a faint marker at every
         apex. The markers are the geometric progression h, e2h, e4h … standing
         still on the board while the ball keeps making the next term.       */
      if (kind === 'bounce-decay'){
        var GY = 1.05, H0 = 3.55, EE = 0.74, G = 6.0, NB = 7;
        var t0 = Math.sqrt(2 * H0 / G), v0 = G * t0;
        var legs = [t0], apex = [];
        for (var k = 1; k <= NB; k++){
          legs.push(2 * Math.pow(EE, k) * t0);
          apex.push(H0 * Math.pow(EE, 2 * k));
        }
        var TT = legs.reduce(function(a, b){ return a + b; }, 0);
        var X0 = 1.05, X1 = 7.3;
        world.add(line([new T.Vector3(0.6, GY, 0), new T.Vector3(7.6, GY, 0)], INK, 0.55));

        /* apex markers — static, so the printed fallback carries the same idea */
        var acc = legs[0];
        for (var k2 = 0; k2 < NB; k2++){
          var ta = acc + legs[k2 + 1] / 2;
          var ax = X0 + (X1 - X0) * (ta / TT), ay = GY + apex[k2];
          world.add(dashed(new T.Vector3(0.72, ay, 0), new T.Vector3(ax, ay, 0),
                           GOLD, 0.16, 0.14));
          var mk = dot(GOLD, 0.075); mk.position.set(ax, ay, 0);
          mk.material.transparent = true; mk.material.opacity = 0.65;
          world.add(mk);
          acc += legs[k2 + 1];
        }
        world.add(dashed(new T.Vector3(0.72, GY + H0, 0), new T.Vector3(X0, GY + H0, 0),
                         INK, 0.24, 0.14));
        var bd = dot(INDIGO, 0.24); world.add(bd);

        tick = function(t){
          var CYC = TT + 1.15, tau = (t % CYC);
          if (tau > TT) tau = TT;
          var x = X0 + (X1 - X0) * (tau / TT), y;
          if (tau < legs[0]){
            y = GY + H0 - 0.5 * G * tau * tau;
          } else {
            var rest = tau - legs[0], j = 1;
            while (j <= NB && rest > legs[j]){ rest -= legs[j]; j++; }
            if (j > NB){ y = GY; }
            else {
              var vk = Math.pow(EE, j) * v0;
              y = GY + vk * rest - 0.5 * G * rest * rest;
            }
          }
          bd.position.set(x, Math.max(GY, y), 0);
        };
      }

      /* ------------------------------------------------------ max-ke-loss --
         The instant the formula is about.  m and 2m meet through a spring:
         the spring compresses, the two velocities close on each other, and at
         MAXIMUM COMPRESSION they are equal - that is the moment the whole of
         the convertible kinetic energy is sitting in the spring.  Under the
         track the total KE stands as one bar in two parts: an indigo part that
         is the kinetic energy of the centre of mass, which no interaction can
         ever touch, and a gold part, exactly 1/2 mu (u2 - u1)^2, which drains
         into the green spring bar and comes back.  The maximum possible loss
         is the whole of the gold part and nothing more, and a still figure can
         assert that but cannot show it.                                      */
      if (kind === 'max-ke-loss'){
        var M1 = 1, M2 = 2, MT = M1 + M2, MU = M1 * M2 / MT;
        var UREL = 2.2, VCM = M1 * UREL / MT;
        var KS = 0.5;                                 /* display speed scale  */
        var W1 = 0.78, H1 = 0.60, W2 = 1.05, H2 = 0.78;
        var KGY = 3.35, L0 = 1.5;
        var D0 = L0 + W1 / 2 + W2 / 2;                /* centre gap at touch  */
        var TA = 0.9, TB = 2.6, TC = 2.8, TH = 1.3;   /* approach / squeeze / leave / hold */
        var OM = Math.PI / TB, CYC = TA + TB + TC + TH;
        var XCM0 = 3.4;                               /* centre of mass at touch */

        function slab(bw, bh, color){
          var g = new T.Group();
          g.add(new T.Mesh(new T.PlaneGeometry(bw, bh),
            new T.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.3 })));
          g.add(line([new T.Vector3(-bw / 2, -bh / 2, 0), new T.Vector3(bw / 2, -bh / 2, 0),
                      new T.Vector3(bw / 2, bh / 2, 0), new T.Vector3(-bw / 2, bh / 2, 0),
                      new T.Vector3(-bw / 2, -bh / 2, 0)], color, 0.95));
          return g;
        }
        function bar(color, op){
          var m = new T.Mesh(new T.PlaneGeometry(1, 0.3),
            new T.MeshBasicMaterial({ color: color, transparent: true,
              opacity: op === undefined ? 0.8 : op }));
          m.userData.put = function(x0, wid, y){
            m.visible = wid > 0.012;
            m.scale.x = Math.max(wid, 0.001);
            m.position.set(x0 + Math.max(wid, 0.001) / 2, y, 0);
          };
          return m;
        }

        /* the shared stage is sized for a 16:9 board; this figure is short and
           wide, so lift it to fill the frame it is given */
        var KSC = 1.16;
        world.scale.set(KSC, KSC, KSC);
        world.position.set(-4 * KSC, -2.5 * KSC, 0);

        world.add(line([new T.Vector3(0.55, KGY, 0), new T.Vector3(7.7, KGY, 0)], INK, 0.55));

        var kb1 = slab(W1, H1, GOLD), kb2 = slab(W2, H2, INDIGO);
        world.add(kb1); world.add(kb2);
        var kl1 = label('m', '#f5c542', 0.46), kl2 = label('2m', '#9fb4ff', 0.52);
        world.add(kl1); world.add(kl2);
        var kv1 = arrow(GOLD, 0.048), kv2 = arrow(INDIGO, 0.048);
        world.add(kv1); world.add(kv2);

        /* the spring - a zig-zag whose points are rewritten every frame */
        var ZN = 26, zpts = [];
        for (var zi = 0; zi <= ZN; zi++) zpts.push(new T.Vector3(0, KGY + 0.3, 0));
        var zgeo = new T.BufferGeometry().setFromPoints(zpts);
        world.add(new T.Line(zgeo, new T.LineBasicMaterial({
          color: INK, transparent: true, opacity: 0.9 })));

        /* the energy bars */
        var BX = 1.0, BSC = 2.35, BYK = 1.62, BYP = 0.72;
        var barCM = bar(INDIGO, 0.72), barMU = bar(GOLD, 0.9), barPE = bar(GREEN, 0.9);
        world.add(barCM); world.add(barMU); world.add(barPE);
        var KECM = 0.5 * MT * VCM * VCM, KEMU = 0.5 * MU * UREL * UREL;
        var lCM = label('C.M.', '#9fb4ff', 0.6), lMU = label('lost', '#f5c542', 0.56),
            lPE = label('P.E.', '#34d399', 0.58);
        world.add(lCM); world.add(lMU); world.add(lPE);
        lCM.position.set(BX + KECM * BSC * 0.5, BYK + 0.46, 0);
        world.add(dashed(new T.Vector3(BX, BYK - 0.32, 0),
                         new T.Vector3(BX + (KECM + KEMU) * BSC, BYK - 0.32, 0), INK, 0.2, 0.14));

        /* the marker that fires at maximum compression */
        var kMark = dashed(new T.Vector3(0, 0, 0), new T.Vector3(0, 1, 0), GOLD, 0.55, 0.16);
        world.add(kMark);

        tick = function(t){
          var u = t % CYC, d, xcm, vrel;
          if (u < TA){                                   /* approach          */
            vrel = UREL;
            d = D0 + KS * UREL * (TA - u);
            xcm = XCM0 - KS * VCM * (TA - u);
          } else if (u < TA + TB){                       /* in contact        */
            var tau = u - TA;
            vrel = UREL * Math.cos(OM * tau);
            d = D0 - KS * (UREL / OM) * Math.sin(OM * tau);
            xcm = XCM0 + KS * VCM * tau;
          } else if (u < TA + TB + TC){                  /* leaving           */
            var tc = u - TA - TB;
            vrel = -UREL;
            d = D0 + KS * UREL * tc;
            xcm = XCM0 + KS * VCM * (TB + tc);
          } else {                                       /* hold, then reset  */
            vrel = -UREL;
            d = D0 + KS * UREL * TC;
            xcm = XCM0 + KS * VCM * (TB + TC);
          }

          var x1 = xcm - (M2 / MT) * d, x2 = xcm + (M1 / MT) * d;
          kb1.position.set(x1, KGY + H1 / 2, 0);
          kb2.position.set(x2, KGY + H2 / 2, 0);
          kl1.position.set(x1, KGY + H1 / 2, 0.01);
          kl2.position.set(x2, KGY + H2 / 2, 0.01);

          /* the spring: attached to 2m, free end never past the face of m */
          var anchor = x2 - W2 / 2, face = x1 + W1 / 2;
          var len = Math.min(L0, Math.max(anchor - face, 0.18));
          var free = anchor - len, zy = KGY + 0.3, amp = 0.17 + 0.14 * (L0 - len);
          var zp = zgeo.getAttribute('position');
          for (var zj = 0; zj <= ZN; zj++){
            var f = zj / ZN;
            zp.array[zj * 3] = free + len * f;
            zp.array[zj * 3 + 1] = zy + ((zj === 0 || zj === ZN) ? 0
                                    : (zj % 2 ? amp : -amp));
            zp.array[zj * 3 + 2] = 0;
          }
          zp.needsUpdate = true;
          zgeo.computeBoundingSphere();

          /* velocities, drawn above each body */
          var v1 = VCM + (M2 / MT) * vrel, v2 = VCM - (M1 / MT) * vrel;
          var ay = KGY + 1.24;
          aim(kv1, new T.Vector3(x1, ay, 0), new T.Vector3(x1 + v1 * 0.5, ay, 0));
          aim(kv2, new T.Vector3(x2, ay, 0), new T.Vector3(x2 + v2 * 0.5, ay, 0));

          /* the bars: the indigo part never moves, the gold part is the loss */
          var conv = 0.5 * MU * vrel * vrel, pe = KEMU - conv;
          barCM.userData.put(BX, KECM * BSC, BYK);
          barMU.userData.put(BX + KECM * BSC, conv * BSC, BYK);
          barPE.userData.put(BX, pe * BSC, BYP);
          lMU.position.set(BX + KECM * BSC + Math.max(conv * BSC, 0.3) / 2, BYK + 0.46, 0);
          lMU.visible = conv * BSC > 0.5;
          lPE.position.set(BX + pe * BSC + 0.62, BYP, 0);
          lPE.visible = pe * BSC > 0.4;

          /* at maximum compression the two arrows are the same length: say so */
          var atMax = Math.abs(vrel) < 0.1 * UREL;
          kMark.visible = atMax;
          if (atMax) kMark.position.set(0, 0, 0);
          kMark.children.forEach(function(seg){ seg.visible = atMax; });
          if (atMax){
            var mx = (x1 + x2) / 2;
            kMark.position.set(mx - 0.0, KGY + 1.42, 0);
            kMark.scale.set(1, 1, 1);
          }
        };
      }

      /* --------------------------------------------------- rolling-contact --
         The whole of rolling motion in one figure: the wheel advances by
         exactly one circumference per turn, so the rim point rides the cycloid
         drawn under it — and its own velocity arrow, v + ω x r, GROWS from
         nothing at the ground to 2v at the crest and dies back to nothing at
         the next cusp. Two things a still figure cannot carry: that the contact
         point is instantaneously at rest even though the body is moving, and
         that the top is going twice as fast as the centre at the same instant.
         Everything the class must be able to read is also on the slide in HTML
         (rule 20) — this only shows it happening.                            */
      if (kind === 'rolling-contact'){
        var RGY = 1.05, RR = 1.12, RCY = RGY + RR, RX0 = 1.15, RV = 1.05;
        var RSPAN = 2 * Math.PI * RR * 2;            /* two full turns across */
        world.add(line([new T.Vector3(0.3, RGY, 0),
                        new T.Vector3(7.7, RGY, 0)], INK, 0.7));

        /* the path the rim point actually takes — drawn once, and at rest */
        var cyc = [];
        for (var ci = 0; ci <= 260; ci++){
          var cth = (ci / 260) * (RSPAN / RR);
          cyc.push(new T.Vector3(RX0 + RR * cth - RR * Math.sin(cth),
                                 RCY - RR * Math.cos(cth), 0));
        }
        world.add(line(cyc, INDIGO, 0.32));

        var wheel = new T.Group();
        wheel.position.set(RX0, RCY, 0);
        world.add(wheel);
        var rimPts = [];
        for (var ri = 0; ri <= 72; ri++){
          rimPts.push(new T.Vector3(RR * Math.cos(ri / 72 * Math.PI * 2),
                                    RR * Math.sin(ri / 72 * Math.PI * 2), 0));
        }
        wheel.add(line(rimPts, INDIGO, 0.95));
        wheel.add(line([new T.Vector3(-RR, 0, 0), new T.Vector3(RR, 0, 0)], INK, 0.26));
        wheel.add(line([new T.Vector3(0, -RR, 0), new T.Vector3(0, RR, 0)], INK, 0.26));
        var rimDot = dot(GOLD, 0.13); rimDot.position.set(0, -RR, 0); wheel.add(rimDot);

        var cDot = dot(GREEN, 0.12);  world.add(cDot);
        var hubDot = dot(INDIGO, 0.1); world.add(hubDot);

        var aTop = arrow(GOLD, 0.05), aCen = arrow(CYAN, 0.05), aRim = arrow(GOLD, 0.045);
        world.add(aTop); world.add(aCen); world.add(aRim);
        var lTop = label('2v', '#f5c542', 0.42), lCen = label('v', '#56ccf2', 0.36),
            lBot = label('0', '#34d399', 0.36);
        world.add(lTop); world.add(lCen); world.add(lBot);

        tick = function(t){
          var s = (RV * t) % RSPAN, th = s / RR, x = RX0 + s;
          wheel.position.x = x;
          wheel.rotation.z = -th;                  /* rolling right = clockwise */
          hubDot.position.set(x, RCY, 0);
          cDot.position.set(x, RGY, 0);
          aim(aTop, new T.Vector3(x, RCY + RR, 0), new T.Vector3(x + 1.86, RCY + RR, 0));
          aim(aCen, new T.Vector3(x, RCY, 0),      new T.Vector3(x + 0.93, RCY, 0));
          lTop.position.set(x + 2.16, RCY + RR, 0);
          lCen.position.set(x + 1.20, RCY, 0);
          lBot.position.set(x, RGY - 0.36, 0);
          /* the rim point's own velocity — zero at the cusp, 2v at the crest */
          var px = x - RR * Math.sin(th), py = RCY - RR * Math.cos(th);
          aim(aRim, new T.Vector3(px, py, 0),
                    new T.Vector3(px + (1 - Math.cos(th)) * 0.93,
                                  py + Math.sin(th) * 0.93, 0));
        };
      }

      function resize(){
        var nw = frame.clientWidth, nh = frame.clientHeight;
        if (!nw || !nh) return;
        camera.aspect = nw / nh; camera.updateProjectionMatrix();
        fit(nw / nh);
        renderer.setSize(nw, nh);
      }
      lfOn(frame, 'resize', resize);

      var t0 = Date.now();
      lfLoop(frame, function loop(){
        if (tick) tick((Date.now() - t0) / 1000);
        renderer.render(scene, camera);
      });
      return live;
    }

    /* ======================================================== FBD scenes ====
       Three scenes for the "FBD and forces in mechanics" board. Each exists
       because the still figure on the source slide cannot show the one thing
       the slide is about:

         slinky-drop    the bottom of a released slinky does not move until the
                        compression wave reaches it — spring force cannot change
                        instantly. A photograph of a slinky proves nothing.
         lift-frame     the same hanging mass in the ground frame and in the
                        lift frame, side by side, with ma appearing only in the
                        accelerating frame and the answer T = mg + ma agreeing.
         friction-ramp  friction tracking an applied force exactly, up to the
                        limiting value, then dropping to kinetic as the block
                        breaks away — with the fr–F graph drawing itself as it
                        happens. That graph IS the case study.

       Same conventions as startMech2D: a flat x 0..8 / y 0..5 world, canvas
       labels, cylinder+cone arrows, and a `.scene-fallback` in the markup that
       carries the still version for print and for a room with no WebGL.       */
    function startFbd2D(frame, w, h, kind){
      var GOLD = 0xf5c542, INDIGO = 0x7c8cff, CYAN = 0x56ccf2,
          GREEN = 0x34d399, RED = 0xf87171, INK = 0xf4f7fb;

      var renderer = lfOwn(frame, new T.WebGLRenderer({ alpha: true, antialias: LF_AA, powerPreference: 'high-performance' }));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      frame.appendChild(renderer.domElement);
      frame.classList.add('is-live');

      var scene = new T.Scene();
      var camera = new T.PerspectiveCamera(40, w / h, 0.1, 100);
      camera.position.set(0, 0, 9.6);
      camera.lookAt(0, 0, 0);
      function fit(aspect){
        var t2 = Math.tan((40 * Math.PI / 180) / 2);
        camera.position.z = Math.max(2.9 / t2, 4.35 / (t2 * aspect));
      }
      fit(w / h);

      var world = new T.Group();
      world.position.set(-4, -2.5, 0);
      scene.add(world);

      function line(pts, color, opacity){
        var g = new T.BufferGeometry().setFromPoints(pts);
        return new T.Line(g, new T.LineBasicMaterial({
          color: color, transparent: true, opacity: opacity === undefined ? 1 : opacity }));
      }
      function dashed(a, b, color, opacity, dash){
        var g = new T.Group(), d = dash || 0.2,
            v = new T.Vector3().subVectors(b, a), len = v.length(), n = v.clone().normalize();
        for (var s = 0; s < len; s += d * 2){
          g.add(line([a.clone().addScaledVector(n, s),
                      a.clone().addScaledVector(n, Math.min(s + d, len))], color, opacity));
        }
        return g;
      }
      function arrow(color, rad, opacity){
        var g = new T.Group();
        var mat = new T.MeshBasicMaterial({ color: color, transparent: true,
          opacity: opacity === undefined ? 1 : opacity });
        var shaft = new T.Mesh(new T.CylinderGeometry(rad, rad, 1, 10), mat);
        var head  = new T.Mesh(new T.ConeGeometry(rad * 3, rad * 7, 14), mat);
        g.add(shaft); g.add(head);
        g.userData = { shaft: shaft, head: head, rad: rad, mat: mat };
        return g;
      }
      function aim(g, from, to){
        var dir = new T.Vector3().subVectors(to, from), len = dir.length();
        if (len < 0.05){ g.visible = false; return; }
        g.visible = true;
        var hl = Math.min(g.userData.rad * 7, len * 0.45);
        var sl = Math.max(len - hl, 0.001);
        g.userData.shaft.scale.set(1, sl, 1);
        g.userData.shaft.position.set(0, sl / 2, 0);
        g.userData.head.scale.set(1, hl / (g.userData.rad * 7), 1);
        g.userData.head.position.set(0, sl + hl / 2, 0);
        g.position.copy(from);
        g.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
      }
      function label(text, css, size){
        var c = document.createElement('canvas');
        c.width = 256; c.height = 128;
        var ctx = c.getContext('2d');
        ctx.font = 'bold 68px Calibri, Candara, "Segoe UI", sans-serif';
        ctx.fillStyle = css; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, 128, 64);
        var tex = new T.CanvasTexture(c);
        tex.minFilter = T.LinearFilter;
        return new T.Mesh(new T.PlaneGeometry(size * 2, size),
          new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      }
      function box(cx, cy, bw, bh, color, opacity){
        var g = new T.Group();
        g.add(new T.Mesh(new T.PlaneGeometry(bw, bh),
          new T.MeshBasicMaterial({ color: color, transparent: true,
            opacity: opacity === undefined ? 0.34 : opacity })));
        g.add(line([new T.Vector3(-bw/2, -bh/2, 0), new T.Vector3( bw/2, -bh/2, 0),
                    new T.Vector3( bw/2,  bh/2, 0), new T.Vector3(-bw/2,  bh/2, 0),
                    new T.Vector3(-bw/2, -bh/2, 0)], color, 0.95));
        g.position.set(cx, cy, 0);
        return g;
      }

      var tick = null;

      /* ------------------------------------------------------ slinky-drop -- */
      if (kind === 'slinky-drop'){
        var NC = 22, TOPY = 4.55, XL = 2.35, XR = 5.65;
        world.add(line([new T.Vector3(XL - 0.9, TOPY + 0.12, 0),
                        new T.Vector3(XL + 0.9, TOPY + 0.12, 0)], INK, 0.75));
        for (var hx = -0.9; hx < 0.9; hx += 0.3){
          world.add(line([new T.Vector3(XL + hx, TOPY + 0.12, 0),
                          new T.Vector3(XL + hx + 0.24, TOPY + 0.4, 0)], INDIGO, 0.5));
        }
        world.add(line([new T.Vector3(XR - 0.9, TOPY + 0.12, 0),
                        new T.Vector3(XR + 0.9, TOPY + 0.12, 0)], INK, 0.3));

        /* a coil is one line whose vertices we re-space every frame */
        function coil(x0, color){
          var pts = [];
          for (var i = 0; i <= NC * 12; i++) pts.push(new T.Vector3(x0, 0, 0));
          var g = new T.BufferGeometry().setFromPoints(pts);
          var m = new T.Line(g, new T.LineBasicMaterial({ color: color, transparent: true, opacity: 0.9 }));
          world.add(m);
          return m;
        }
        var cA = coil(XL, INK), cB = coil(XR, GOLD);
        var bA = box(XL, 0, 0.62, 0.34, INDIGO), bB = box(XR, 0, 0.62, 0.34, GOLD);
        world.add(bA); world.add(bB);
        var gLine = dashed(new T.Vector3(0.6, 0, 0), new T.Vector3(7.4, 0, 0), GREEN, 0.5, 0.16);
        world.add(gLine);

        var lA = label('held', '#9fb4ff', 0.42), lB = label('released', '#f5c542', 0.42);
        lA.position.set(XL, TOPY - 0.42, 0); lB.position.set(XR, TOPY - 0.42, 0);
        world.add(lA); world.add(lB);
        var lNote = label('bottom has not moved', '#34d399', 0.42);
        lNote.position.set(4.0, 0.42, 0); lNote.visible = false; world.add(lNote);

        /* stretched at rest: coil spacing grows towards the top, because the
           top coils carry the weight of everything below them */
        function shape(topY, botY, squash){
          var out = [], n = NC * 12, span = topY - botY;
          for (var i = 0; i <= n; i++){
            var u = i / n;                                  /* 0 top -> 1 bottom */
            var s = u * u;                                  /* rest profile */
            var f = squash <= 0 ? s : (u <= squash ? u * u * 0.06 / Math.max(squash, 0.001)
                                                   : s - (squash * squash) * 0.94);
            out.push(Math.max(0, Math.min(1, f)));
          }
          return out;
        }
        tick = function(t){
          var T0 = 1.1, T1 = 3.0, CY = 1.3;            /* cycle: hang, fall, hold */
          var u = (t % CY === 0 ? 0 : t) % (T1 + 1.0);
          var topDrop = 0, front = 0;
          if (u > T0){
            var k = Math.min((u - T0) / (T1 - T0), 1);
            front = k;                                  /* wave front, 0..1 down */
            topDrop = k * k * 3.0;
          }
          [[cA, XL, 0], [cB, XR, front]].forEach(function(row){
            var mesh = row[0], x0 = row[1], sq = row[2];
            var top = TOPY - (mesh === cB ? topDrop : 0), bot = 0.55;
            var prof = shape(top, bot, sq);
            var pos = mesh.geometry.attributes.position, n = prof.length - 1;
            for (var i = 0; i <= n; i++){
              var y = top - prof[i] * (top - bot);
              var ph = (i / n) * NC * Math.PI * 2;
              pos.setXYZ(i, x0 + Math.sin(ph) * 0.30, y, 0);
            }
            pos.needsUpdate = true;
            mesh.geometry.computeBoundingSphere();
            if (mesh === cB) bB.position.set(x0, 0.42, 0);
          });
          bA.position.set(XL, 0.42, 0);
          lB.position.set(XR, TOPY - topDrop - 0.42, 0);
          lNote.visible = front > 0.12 && front < 0.92;
        };
      }

      /* ------------------------------------------------------- lift-frame -- */
      if (kind === 'lift-frame'){
        var CX = [2.1, 5.9], CW = 2.5, CH = 3.5, CYm = 2.5;
        var cages = [], bobs = [], arT = [], arG = [], arP = [];
        [0, 1].forEach(function(i){
          var cage = new T.Group();
          cage.add(line([new T.Vector3(-CW/2, -CH/2, 0), new T.Vector3(-CW/2, CH/2, 0),
                         new T.Vector3( CW/2,  CH/2, 0), new T.Vector3( CW/2, -CH/2, 0),
                         new T.Vector3(-CW/2, -CH/2, 0)], INK, 0.8));
          cage.add(line([new T.Vector3(0, CH/2, 0), new T.Vector3(0, 0.35, 0)], INDIGO, 0.9));
          var bob = box(0, 0, 0.52, 0.5, INDIGO, 0.5);
          bob.position.set(0, 0.1, 0); cage.add(bob);
          cage.position.set(CX[i], CYm, 0);
          world.add(cage); cages.push(cage); bobs.push(bob);
          var aT = arrow(GOLD, 0.05), aG = arrow(CYAN, 0.05);
          cage.add(aT); cage.add(aG); arT.push(aT); arG.push(aG);
          aim(aT, new T.Vector3(0, 0.35, 0), new T.Vector3(0, 1.35, 0));
          aim(aG, new T.Vector3(0, -0.15, 0), new T.Vector3(0, -1.15, 0));
          var lT = label('T', '#f5c542', 0.4), lG = label('mg', '#56ccf2', 0.42);
          lT.position.set(0.42, 1.05, 0); lG.position.set(0.5, -0.95, 0);
          cage.add(lT); cage.add(lG);
          if (i === 1){
            var aP = arrow(RED, 0.05); cage.add(aP); arP.push(aP);
            aim(aP, new T.Vector3(0.62, -0.15, 0), new T.Vector3(0.62, -1.05, 0));
            var lP = label('ma', '#f87171', 0.42);
            lP.position.set(1.15, -0.85, 0); cage.add(lP);
          }
          var head = label(i === 0 ? 'ground frame' : 'lift frame',
                           i === 0 ? '#9fb4ff' : '#f5c542', 0.44);
          head.position.set(CX[i], 4.72, 0); world.add(head);
          var ans = label('T = mg + ma', '#34d399', 0.46);
          ans.position.set(CX[i], 0.36, 0); world.add(ans);
        });
        var aArr = arrow(GREEN, 0.055); world.add(aArr);
        aim(aArr, new T.Vector3(7.45, 2.0, 0), new T.Vector3(7.45, 3.2, 0));
        var aLab = label('a', '#34d399', 0.42);
        aLab.position.set(7.45, 3.6, 0); world.add(aLab);

        tick = function(t){
          /* the ground-frame cage rises; the lift-frame cage is drawn at rest,
             which is exactly the point of moving into it */
          var s = (Math.sin(t * 0.7) * 0.5 + 0.5);
          cages[0].position.y = CYm + s * 0.55;
          cages[1].position.y = CYm;
          bobs[0].position.y = 0.1;
        };
      }

      /* ----------------------------------------------------- friction-ramp -- */
      if (kind === 'friction-ramp'){
        var GY = 3.9, BX0 = 1.5, BW = 1.05, BH = 0.72;
        world.add(line([new T.Vector3(0.5, GY, 0), new T.Vector3(4.3, GY, 0)], INK, 0.8));
        for (var gx = 0.5; gx < 4.25; gx += 0.28){
          world.add(line([new T.Vector3(gx, GY, 0),
                          new T.Vector3(gx - 0.2, GY - 0.24, 0)], INDIGO, 0.45));
        }
        var blk = box(BX0, GY + BH/2, BW, BH, INDIGO, 0.42); world.add(blk);
        var aF = arrow(GOLD, 0.05), aFr = arrow(RED, 0.05);
        world.add(aF); world.add(aFr);
        var lF = label('F', '#f5c542', 0.4), lFr = label('fr', '#f87171', 0.4);
        world.add(lF); world.add(lFr);

        /* the graph: axes are scaffolding, the trace draws itself */
        var OX = 5.0, OY = 0.75, GW = 2.9, GH = 3.6, LIM = 0.62, KIN = 0.46;
        world.add(line([new T.Vector3(OX, OY, 0), new T.Vector3(OX, OY + GH, 0)], INK, 0.8));
        world.add(line([new T.Vector3(OX, OY, 0), new T.Vector3(OX + GW, OY, 0)], INK, 0.8));
        world.add(dashed(new T.Vector3(OX, OY + GH * LIM, 0),
                         new T.Vector3(OX + GW, OY + GH * LIM, 0), GOLD, 0.35, 0.15));
        var lY = label('fr', '#f4f7fb', 0.38), lX = label('F', '#f4f7fb', 0.38);
        lY.position.set(OX - 0.42, OY + GH, 0); lX.position.set(OX + GW + 0.3, OY - 0.05, 0);
        world.add(lY); world.add(lX);
        var lLim = label('limiting', '#f5c542', 0.42);
        lLim.position.set(OX + GW * 0.42, OY + GH * LIM + 0.34, 0); world.add(lLim);
        var lSt = label('static', '#9fb4ff', 0.4), lKi = label('kinetic', '#f87171', 0.4);
        lSt.position.set(OX + GW * 0.3, OY - 0.44, 0);
        lKi.position.set(OX + GW * 0.78, OY - 0.44, 0);
        world.add(lSt); world.add(lKi);

        var NPTS = 160, tpts = [];
        for (var i = 0; i < NPTS; i++) tpts.push(new T.Vector3(OX, OY, 0));
        var trace = new T.Line(new T.BufferGeometry().setFromPoints(tpts),
          new T.LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.95 }));
        world.add(trace);

        function frOf(u){ return u <= LIM ? u : KIN; }   /* the whole physics */

        tick = function(t){
          var CY2 = 5.2, u = (t % CY2) / CY2;            /* applied force 0..1 */
          var fr = frOf(u), moving = u > LIM;

          var bx = BX0 + (moving ? (u - LIM) / (1 - LIM) * 1.55 : 0);
          blk.position.x = bx;
          var tip = bx + BW/2;
          aim(aF,  new T.Vector3(tip, GY + BH * 0.62, 0),
                   new T.Vector3(tip + 0.35 + u * 1.15, GY + BH * 0.62, 0));
          aim(aFr, new T.Vector3(bx - BW/2, GY + 0.1, 0),
                   new T.Vector3(bx - BW/2 - 0.35 - fr * 1.5, GY + 0.1, 0));
          lF.position.set(tip + 0.6 + u * 1.15, GY + BH * 1.05, 0);
          lFr.position.set(bx - BW/2 - 0.7 - fr * 1.5, GY - 0.28, 0);

          var pos = trace.geometry.attributes.position;
          for (var k = 0; k < NPTS; k++){
            var uk = Math.min(k / (NPTS - 1), u);
            pos.setXYZ(k, OX + GW * uk, OY + GH * frOf(uk), 0);
          }
          pos.needsUpdate = true;
          trace.geometry.computeBoundingSphere();
        };
      }

      function resize(){
        var nw = frame.clientWidth, nh = frame.clientHeight;
        if (!nw || !nh) return;
        camera.aspect = nw / nh; camera.updateProjectionMatrix();
        fit(nw / nh);
        renderer.setSize(nw, nh);
      }
      lfOn(frame, 'resize', resize);

      var tf0 = Date.now();
      lfLoop(frame, function loop(){
        if (tick) tick((Date.now() - tf0) / 1000);
        renderer.render(scene, camera);
      });
    }


    /* ===================================================== topple scenes ====
       Three scenes for the "shifting of normal reaction / toppling" board.
       Each exists because the still figure on the source slide cannot show the
       one thing the slide is actually about:

         normal-shift  the normal reaction is a DISTRIBUTION, not an arrow. As
                       the applied force grows the pressure under the base skews
                       and the resultant N walks towards the leading edge. The
                       source slide draws two frozen states side by side and
                       asks the class to imagine the walk; here they watch it.
         toppling      a body tips at the exact instant the toppling moment
                       passes the restoring moment. Two bars under the block —
                       gold F·l growing, indigo mg·b/2 fixed — and the block
                       leaves the floor on the frame the gold bar crosses the
                       indigo one. The inequality and the event are one thing.
         car-topple    the same law with speed as the variable: mv²/r × b/2
                       against mg × l/2, the inner wheels lifting when the
                       gold bar wins. "Body will over turn" is a prediction
                       about an event, so it needs the event.

       Same conventions as startFbd2D — a flat x 0..8 / y 0..5 world, canvas
       labels, cylinder+cone arrows, and a `.scene-fallback` in the markup that
       carries the still version for print and for a room with no WebGL.      */
    function startTopple2D(frame, w, h, kind){
      var GOLD = 0xf5c542, INDIGO = 0x7c8cff, CYAN = 0x56ccf2, INK = 0xf4f7fb;

      var renderer = lfOwn(frame, new T.WebGLRenderer({ alpha: true, antialias: LF_AA, powerPreference: 'high-performance' }));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      frame.appendChild(renderer.domElement);
      frame.classList.add('is-live');

      var scene = new T.Scene();
      var camera = new T.PerspectiveCamera(40, w / h, 0.1, 100);
      camera.position.set(0, 0, 9.6);
      camera.lookAt(0, 0, 0);
      function fit(aspect){
        var t2 = Math.tan((40 * Math.PI / 180) / 2);
        camera.position.z = Math.max(2.9 / t2, 4.35 / (t2 * aspect));
      }
      fit(w / h);

      var world = new T.Group();
      world.position.set(-4, -2.5, 0);
      scene.add(world);

      function line(pts, color, opacity){
        var g = new T.BufferGeometry().setFromPoints(pts);
        return new T.Line(g, new T.LineBasicMaterial({
          color: color, transparent: true, opacity: opacity === undefined ? 1 : opacity }));
      }
      function dashed(a, b, color, opacity, dash){
        var g = new T.Group(), d = dash || 0.2,
            v = new T.Vector3().subVectors(b, a), len = v.length(), n = v.clone().normalize();
        for (var s = 0; s < len; s += d * 2){
          g.add(line([a.clone().addScaledVector(n, s),
                      a.clone().addScaledVector(n, Math.min(s + d, len))], color, opacity));
        }
        return g;
      }
      function arrow(color, rad, opacity){
        var g = new T.Group();
        var mat = new T.MeshBasicMaterial({ color: color, transparent: true,
          opacity: opacity === undefined ? 1 : opacity });
        var shaft = new T.Mesh(new T.CylinderGeometry(rad, rad, 1, 10), mat);
        var head  = new T.Mesh(new T.ConeGeometry(rad * 3, rad * 7, 14), mat);
        g.add(shaft); g.add(head);
        g.userData = { shaft: shaft, head: head, rad: rad, mat: mat };
        return g;
      }
      function aim(g, from, to){
        var dir = new T.Vector3().subVectors(to, from), len = dir.length();
        if (len < 0.05){ g.visible = false; return; }
        g.visible = true;
        var hl = Math.min(g.userData.rad * 7, len * 0.45);
        var sl = Math.max(len - hl, 0.001);
        g.userData.shaft.scale.set(1, sl, 1);
        g.userData.shaft.position.set(0, sl / 2, 0);
        g.userData.head.scale.set(1, hl / (g.userData.rad * 7), 1);
        g.userData.head.position.set(0, sl + hl / 2, 0);
        g.position.copy(from);
        g.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
      }
      function label(text, css, size){
        var c = document.createElement('canvas');
        c.width = 512; c.height = 128;
        var ctx = c.getContext('2d');
        ctx.font = 'bold 64px Calibri, Candara, "Segoe UI", sans-serif';
        ctx.fillStyle = css; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, 256, 64);
        var tex = new T.CanvasTexture(c);
        tex.minFilter = T.LinearFilter;
        var m = new T.Mesh(new T.PlaneGeometry(size * 4, size),
          new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
        m.userData.retext = function(txt, col){
          ctx.clearRect(0, 0, 512, 128);
          ctx.fillStyle = col || css;
          ctx.fillText(txt, 256, 64);
          tex.needsUpdate = true;
        };
        return m;
      }
      /* a rectangle drawn about its OWN centre, so a parent group can pivot it
         about a corner without the fill and the outline drifting apart */
      function slab(bw, bh, color, opacity){
        var g = new T.Group();
        g.add(new T.Mesh(new T.PlaneGeometry(bw, bh),
          new T.MeshBasicMaterial({ color: color, transparent: true,
            opacity: opacity === undefined ? 0.30 : opacity })));
        g.add(line([new T.Vector3(-bw/2, -bh/2, 0), new T.Vector3( bw/2, -bh/2, 0),
                    new T.Vector3( bw/2,  bh/2, 0), new T.Vector3(-bw/2,  bh/2, 0),
                    new T.Vector3(-bw/2, -bh/2, 0)], color, 0.95));
        return g;
      }
      function floor(x0, x1, y, tone){
        var g = new T.Group();
        g.add(line([new T.Vector3(x0, y, 0), new T.Vector3(x1, y, 0)], tone || INK, 0.8));
        for (var gx = x0 + 0.1; gx < x1; gx += 0.3){
          g.add(line([new T.Vector3(gx, y, 0),
                      new T.Vector3(gx - 0.2, y - 0.24, 0)], INDIGO, 0.45));
        }
        return g;
      }
      /* the two moment bars: gold = what turns the body, indigo = what holds
         it. The body leaves the floor exactly when gold passes indigo, so the
         inequality on the slide and the event on screen are the same fact. */
      function bars(x0, y0, span, goldName, holdName){
        var g = new T.Group();
        g.add(line([new T.Vector3(x0, y0 - 0.34, 0),
                    new T.Vector3(x0, y0 + 0.5, 0)], INK, 0.45));
        var hold = new T.Mesh(new T.PlaneGeometry(1, 0.2),
          new T.MeshBasicMaterial({ color: INDIGO, transparent: true, opacity: 0.75 }));
        var turn = new T.Mesh(new T.PlaneGeometry(1, 0.2),
          new T.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.9 }));
        g.add(hold); g.add(turn);
        var lh = label(holdName, '#9fb4ff', 0.34), lt = label(goldName, '#f5c542', 0.34);
        g.add(lh); g.add(lt);
        lh.position.set(x0 + span * 0.5, y0 - 0.28, 0);
        lt.position.set(x0 + span * 0.5, y0 + 0.5, 0);
        g.userData.set = function(uTurn, uHold){
          var wt = Math.max(span * uTurn, 0.001), wh = Math.max(span * uHold, 0.001);
          turn.scale.set(wt, 1, 1); turn.position.set(x0 + wt / 2, y0 + 0.24, 0);
          hold.scale.set(wh, 1, 1); hold.position.set(x0 + wh / 2, y0 - 0.02, 0);
        };
        return g;
      }

      var tick = null;

      /* ----------------------------------------------------- normal-shift -- */
      if (kind === 'normal-shift'){
        var GY = 1.55, BX = 3.15, BW = 2.3, BH = 2.3, NARR = 15;
        world.add(floor(0.5, 6.2, GY));
        var blk = slab(BW, BH, INDIGO, 0.26);
        blk.position.set(BX, GY + BH / 2, 0);
        world.add(blk);
        var lm = label('m', '#cfd8e8', 0.4);
        lm.position.set(BX - 0.05, GY + BH * 0.72, 0); world.add(lm);

        /* the pressure distribution — one short arrow per strip of the base */
        var strips = [];
        for (var i = 0; i < NARR; i++){
          var a = arrow(INK, 0.026, 0.7); world.add(a); strips.push(a);
        }
        var aF = arrow(GOLD, 0.05); world.add(aF);
        var lF = label('F', '#f5c542', 0.42); world.add(lF);
        var aN = arrow(CYAN, 0.055); world.add(aN);
        var lN = label('N', '#56ccf2', 0.4); world.add(lN);
        var cen = dashed(new T.Vector3(BX, GY - 0.7, 0),
                         new T.Vector3(BX, GY + BH + 0.35, 0), INK, 0.28, 0.14);
        world.add(cen);
        var lCen = label('centre', '#8ea0bd', 0.36);
        lCen.position.set(BX, GY + BH + 0.62, 0); world.add(lCen);
        var lRead = label('N through the centre', '#34d399', 0.42);
        lRead.position.set(4.0, 0.55, 0); world.add(lRead);

        tick = function(t){
          var CY = 6.4, p = (t % CY) / CY;
          var u = p < 0.5 ? p * 2 : (1 - p) * 2;          /* 0 -> 1 -> 0 */
          u = u * u * (3 - 2 * u);                        /* ease */

          /* the resultant walks from the centre towards the leading edge */
          var xN = BX + u * (BW / 2 - 0.16);
          aim(aN, new T.Vector3(xN, GY - 0.02, 0), new T.Vector3(xN, GY + BH * 0.62, 0));
          lN.position.set(xN + 0.34, GY + BH * 0.36, 0);

          /* the distribution that resultant is the resultant OF */
          for (var k = 0; k < NARR; k++){
            var s = (k + 0.5) / NARR;                     /* 0 left -> 1 right */
            var x = BX - BW / 2 + s * BW;
            var wgt = 1 + u * 2.4 * (s - 0.5) * 2;        /* skews with u */
            var len = Math.max(0.12, 0.34 * wgt);
            aim(strips[k], new T.Vector3(x, GY - len, 0), new T.Vector3(x, GY - 0.02, 0));
          }

          /* F presses down on the far top corner, exactly as the slide draws it */
          var fl = 0.25 + u * 1.05;
          aim(aF, new T.Vector3(BX + BW / 2 - 0.2, GY + BH + fl, 0),
                  new T.Vector3(BX + BW / 2 - 0.2, GY + BH + 0.06, 0));
          lF.position.set(BX + BW / 2 + 0.62, GY + BH + fl * 0.75, 0);

          if (lRead.userData.retext){
            if (u < 0.08) lRead.userData.retext('N through the centre', '#34d399');
            else if (u > 0.88) lRead.userData.retext('N at the leading edge', '#f5c542');
            else lRead.userData.retext('N has shifted', '#56ccf2');
          }
        };
      }

      /* --------------------------------------------------------- toppling -- */
      if (kind === 'toppling'){
        var TGY = 1.75, TBW = 1.5, TBH = 2.5, PX = 4.55;   /* pivot = right foot */
        world.add(floor(1.4, 6.6, TGY));
        var pivot = new T.Group();
        pivot.position.set(PX, TGY, 0);
        world.add(pivot);
        var body = slab(TBW, TBH, INDIGO, 0.28);
        body.position.set(-TBW / 2, TBH / 2, 0);
        pivot.add(body);
        var aFt = arrow(GOLD, 0.05); pivot.add(aFt);
        var lFt = label('F', '#f5c542', 0.42); pivot.add(lFt);
        var aW = arrow(CYAN, 0.05); pivot.add(aW);
        var lW = label('mg', '#56ccf2', 0.44); pivot.add(lW);
        aim(aW, new T.Vector3(-TBW / 2, TBH / 2, 0), new T.Vector3(-TBW / 2, -0.55, 0));
        lW.position.set(-TBW / 2 - 0.62, -0.2, 0);
        var mgLine = dashed(new T.Vector3(-TBW / 2, TBH / 2, 0),
                            new T.Vector3(-TBW / 2, -1.5, 0), CYAN, 0.3, 0.13);
        pivot.add(mgLine);
        var dotG = new T.Mesh(new T.CircleGeometry(0.11, 20),
          new T.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.95 }));
        pivot.add(dotG);
        var lPiv = label('pivot', '#f5c542', 0.34);
        lPiv.position.set(PX + 0.62, TGY - 0.36, 0); world.add(lPiv);
        var bar = bars(0.9, 0.62, 2.6, 'F l', 'mg b/2'); world.add(bar);
        var verdict = label('stable', '#34d399', 0.46);
        verdict.position.set(5.6, 0.72, 0); world.add(verdict);

        tick = function(t){
          var CY = 6.0, p = (t % CY) / CY;
          var u = p < 0.72 ? p / 0.72 : 1;                /* applied force 0..1 */
          if (p > 0.94) u = Math.max(0, (1 - p) / 0.06);  /* snap back, then re-run */
          var TIP = 0.62;                                 /* F l = mg b/2 here */
          var over = Math.max(0, u - TIP) / (1 - TIP);
          var ang = -over * over * 0.62;                  /* it turns, it does not jump */

          pivot.rotation.z = ang;
          var fl = 0.4 + u * 1.5;
          aim(aFt, new T.Vector3(-TBW / 2 - 0.06 - fl, TBH - 0.12, 0),
                   new T.Vector3(-TBW / 2 - 0.06,      TBH - 0.12, 0));
          lFt.position.set(-TBW / 2 - 0.5 - fl, TBH + 0.34, 0);

          bar.userData.set(u, TIP);
          if (verdict.userData.retext){
            if (over > 0.02) verdict.userData.retext('topples', '#f87171');
            else if (u > TIP - 0.06) verdict.userData.retext('on the point', '#f5c542');
            else verdict.userData.retext('stable', '#34d399');
          }
        };
      }

      /* ------------------------------------------------------- car-topple -- */
      if (kind === 'car-topple'){
        var RGY = 1.7, CBW = 1.9, CBH = 2.0, RPX = 4.6;   /* pivot = outer wheel */
        world.add(floor(1.2, 6.9, RGY));
        var car = new T.Group();
        car.position.set(RPX, RGY, 0);
        world.add(car);
        var hull = slab(CBW, CBH, INDIGO, 0.3);
        hull.position.set(-CBW / 2, CBH / 2 + 0.34, 0);
        car.add(hull);
        [-CBW + 0.28, -0.28].forEach(function(wx){
          var wheel = new T.Mesh(new T.CircleGeometry(0.24, 22),
            new T.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.32 }));
          wheel.position.set(wx, 0.24, 0); car.add(wheel);
        });
        var aC = arrow(GOLD, 0.05); car.add(aC);
        var lC = label('mv²/r', '#f5c542', 0.46); car.add(lC);
        var aG2 = arrow(CYAN, 0.05); car.add(aG2);
        var lG2 = label('mg', '#56ccf2', 0.44); car.add(lG2);
        aim(aG2, new T.Vector3(-CBW / 2, CBH / 2 + 0.34, 0), new T.Vector3(-CBW / 2, -0.5, 0));
        lG2.position.set(-CBW / 2 - 0.6, -0.16, 0);
        var lTrack = label('l', '#cfd8e8', 0.34);
        lTrack.position.set(-CBW / 2, CBH + 0.72, 0); car.add(lTrack);
        var lHigh = label('b', '#cfd8e8', 0.34);
        lHigh.position.set(-CBW - 0.42, CBH / 2 + 0.34, 0); car.add(lHigh);
        var bar2 = bars(0.9, 0.62, 2.6, 'mv²/r × b/2', 'mg × l/2'); world.add(bar2);
        var verd2 = label('will not over turn', '#34d399', 0.46);
        verd2.position.set(5.7, 0.72, 0); world.add(verd2);
        var lV = label('v', '#f5c542', 0.4);
        lV.position.set(1.0, 4.5, 0); world.add(lV);

        tick = function(t){
          var CY = 6.4, p = (t % CY) / CY;
          var u = p < 0.72 ? p / 0.72 : 1;
          if (p > 0.94) u = Math.max(0, (1 - p) / 0.06);
          var TIP2 = 0.6;
          var over2 = Math.max(0, u - TIP2) / (1 - TIP2);
          car.rotation.z = -over2 * over2 * 0.5;

          var cl = 0.4 + u * 1.6;
          aim(aC, new T.Vector3(-CBW / 2,      CBH / 2 + 0.34, 0),
                  new T.Vector3(-CBW / 2 + cl, CBH / 2 + 0.34, 0));
          lC.position.set(-CBW / 2 + cl + 0.9, CBH / 2 + 0.72, 0);

          bar2.userData.set(u, TIP2);
          if (verd2.userData.retext){
            if (over2 > 0.02) verd2.userData.retext('will over turn', '#f87171');
            else verd2.userData.retext('will not over turn', '#34d399');
          }
          if (lV.userData.retext){
            lV.userData.retext('v = ' + Math.round(20 + u * 55) + ' km/h', '#f5c542');
          }
        };
      }

      function resize(){
        var nw = frame.clientWidth, nh = frame.clientHeight;
        if (!nw || !nh) return;
        camera.aspect = nw / nh; camera.updateProjectionMatrix();
        fit(nw / nh);
        renderer.setSize(nw, nh);
      }
      lfOn(frame, 'resize', resize);

      var tt0 = Date.now();
      lfLoop(frame, function loop(){
        if (tick) tick((Date.now() - tt0) / 1000);
        renderer.render(scene, camera);
      });
    }


    /* ================================================ equilibrium-types ====
       Three surfaces side by side — a bowl, a dome, a horizontal plane — each
       with a bead sitting exactly at its equilibrium point. Every cycle the
       bead is nudged the SAME small distance off each one and let go:

         bowl   it swings back through the minimum and damps down to rest
         dome   it creeps away, faster and faster, and leaves the crest
         plane  it slides across and simply stops where it was put

       The source slide draws the three surfaces as still pictures, and a still
       picture cannot show the one thing the definitions are about: what the
       body does AFTER it is displaced. Same nudge, three different endings —
       that is the whole slide, and it needs the event.

       Conventions follow startFbd2D: flat x 0..8 / y 0..5 world, canvas
       labels, no lesson text inside the canvas beyond the three names the
       source itself prints. The markup carries a .scene-fallback with the
       still version for print and for a room with no WebGL (rule 20).        */
    function startEquilibrium(frame, w, h){
      var GOLD = 0xf5c542, INDIGO = 0x7c8cff, INK = 0xf4f7fb, GREEN = 0x34d399,
          RED = 0xf87171;

      var renderer = lfOwn(frame, new T.WebGLRenderer({ alpha: true, antialias: LF_AA, powerPreference: 'high-performance' }));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      frame.appendChild(renderer.domElement);
      frame.classList.add('is-live');

      var scene = new T.Scene();
      var camera = new T.PerspectiveCamera(40, w / h, 0.1, 100);
      camera.position.set(0, 0, 9.6);
      camera.lookAt(0, 0, 0);

      /* The figure is three panels in a row, so a short wide box should spread
         them out rather than shrink the whole thing into the middle third.
         fit() sets the distance from the CONTENT height (about 3.4 units), and
         layout() then pushes the outer two panels to whatever width that
         distance actually gives us. */
      var HALF_H = 1.78, t2 = Math.tan((40 * Math.PI / 180) / 2);
      function fit(aspect){
        camera.position.z = Math.max(HALF_H / t2, 1.35 / (t2 * aspect));
      }
      fit(w / h);

      var world = new T.Group();
      scene.add(world);

      function line(pts, color, opacity, width){
        var g = new T.BufferGeometry().setFromPoints(pts);
        return new T.Line(g, new T.LineBasicMaterial({
          color: color, transparent: true, linewidth: width || 1,
          opacity: opacity === undefined ? 1 : opacity }));
      }
      function dashedV(x, y0, y1, color, opacity){
        var g = new T.Group();
        for (var s = y0; s < y1; s += 0.26){
          g.add(line([new T.Vector3(x, s, 0),
                      new T.Vector3(x, Math.min(s + 0.13, y1), 0)], color, opacity));
        }
        return g;
      }
      function label(text, css, size, px){
        var c = document.createElement('canvas');
        c.width = 256; c.height = 128;
        var ctx = c.getContext('2d');
        ctx.font = 'bold ' + (px || 62) + 'px Calibri, Candara, "Segoe UI", sans-serif';
        ctx.fillStyle = css; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, 128, 64);
        var tex = new T.CanvasTexture(c);
        tex.minFilter = T.LinearFilter;
        return new T.Mesh(new T.PlaneGeometry(size * 2, size),
          new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      }

      /* one panel = a surface y(d) measured from its own centre, plus the bead
         that rides it. d is the bead's displacement from the equilibrium.
         Every panel is its own group, so layout() only moves the group. */
      var HALF = 1.02, NUDGE = 0.5, DEPTH = 0.86;
      var panels = [
        { name: 'Stable',   tint: GREEN,
          y: function(d){ return -0.35 + DEPTH * (d * d) / (HALF * HALF); } },
        { name: 'Unstable', tint: RED,
          y: function(d){ return  0.51 - DEPTH * (d * d) / (HALF * HALF); } },
        { name: 'Neutral',  tint: INDIGO,
          y: function(){ return 0.05; } }
      ];

      panels.forEach(function(p){
        p.group = new T.Group();
        world.add(p.group);

        var pts = [];
        for (var i = 0; i <= 48; i++){
          var d = -HALF + (2 * HALF) * i / 48;
          pts.push(new T.Vector3(d, p.y(d), 0));
        }
        p.group.add(line(pts, INK, 0.8));

        /* the equilibrium point itself, marked once and never moved */
        p.group.add(dashedV(0, p.y(0) - 0.9, p.y(0) - 0.18, INDIGO, 0.32));

        p.bead = new T.Mesh(new T.CircleGeometry(0.145, 24),
          new T.MeshBasicMaterial({ color: p.tint, transparent: true, opacity: 0.95 }));
        p.group.add(p.bead);
        p.halo = new T.Mesh(new T.CircleGeometry(0.28, 24),
          new T.MeshBasicMaterial({ color: p.tint, transparent: true, opacity: 0.15 }));
        p.group.add(p.halo);

        var lab = label(p.name, '#f4f7fb', 0.6, 56);
        lab.position.set(0, 1.5, 0);
        p.group.add(lab);

        /* the same nudge on all three, so the class sees the input is
           identical and only the response differs */
        p.nudge = new T.Group();
        p.nudge.add(line([new T.Vector3(0, 0, 0), new T.Vector3(NUDGE, 0, 0)], GOLD, 0.9));
        var head = new T.Mesh(new T.CircleGeometry(0.09, 3),
          new T.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.9 }));
        head.rotation.z = -Math.PI / 2;
        head.position.set(NUDGE, 0, 0);
        p.nudge.add(head);
        p.nudge.position.y = p.y(0) + 0.44;
        p.group.add(p.nudge);
      });

      /* spread the three panels across whatever width the box actually gives,
         but never so far apart that they stop reading as one figure */
      function layout(aspect){
        var halfW = camera.position.z * t2 * aspect;
        var gap = Math.min(Math.max(halfW * 0.66, 1.35), 4.6);
        panels[0].group.position.x = -gap;
        panels[1].group.position.x = 0;
        panels[2].group.position.x = gap;
      }
      layout(w / h);

      var CYCLE = 5.4, T_HOLD = 0.8, T_PUSH = 1.4;

      function displacement(kind, t){
        /* t seconds since release */
        if (kind === 0){                    /* stable — damped return */
          return NUDGE * Math.cos(3.1 * t) * Math.exp(-0.62 * t);
        }
        if (kind === 1){                    /* unstable — runs away */
          return Math.min(NUDGE * Math.exp(0.85 * t), HALF + 1.4);
        }
        return NUDGE;                       /* neutral — stays put */
      }

      function resize(){
        var nw = frame.clientWidth, nh = frame.clientHeight;
        if (!nw || !nh) return;
        camera.aspect = nw / nh; camera.updateProjectionMatrix();
        fit(nw / nh);
        layout(nw / nh);
        renderer.setSize(nw, nh);
      }
      lfOn(frame, 'resize', resize);

      var t0 = Date.now();
      lfLoop(frame, function loop(){
        var t = ((Date.now() - t0) / 1000) % CYCLE;

        /* phase 1: at rest.  phase 2: pushed aside.  phase 3: released. */
        var d0, showNudge;
        if (t < T_HOLD){ d0 = 0; showNudge = false; }
        else if (t < T_PUSH){ d0 = NUDGE * (t - T_HOLD) / (T_PUSH - T_HOLD); showNudge = true; }
        else { d0 = null; showNudge = false; }

        panels.forEach(function(p, i){
          p.nudge.visible = showNudge;
          var d = d0 === null ? displacement(i, t - T_PUSH) : d0;
          var off = Math.abs(d) > HALF;                 /* left the surface */
          var y = off ? p.y(HALF) - (Math.abs(d) - HALF) * 1.35 : p.y(d);
          var fade = off ? Math.max(0, 1 - (Math.abs(d) - HALF) * 0.8) : 1;
          p.bead.position.set(d, y + 0.145, 0);
          p.halo.position.copy(p.bead.position);
          p.halo.material.opacity = 0.15 * fade;
          p.bead.material.opacity = 0.95 * fade;
        });

        renderer.render(scene, camera);
      });
    }

    /* ------------------------------------------------- rotation 3D scenes ---
       Four scenes for the angular-momentum / torque board. All four say the
       same thing, and it is the one thing a still figure cannot: the answer to
       a cross product does not lie in the plane you drew it in — it STANDS on
       that plane — and its length lives on sin(theta).

         spin-top          a top on its point, L drawn along the axle, the axle
                           itself walking slowly round the vertical
         cross-product     r and v in a plane, L = r x v standing perpendicular,
                           v swinging so |L| = m r v sin(theta) opens and shuts
         conical-pendulum  the bob going round: about the ring's centre B, L
                           stands still on the axis; about the apex A it leans
                           and precesses — the whole of that slide
         torque-lever      a spanner on a nut: r along the shaft, F swinging at
                           its tip, tau standing on the pivot in the sense the
                           spanner turns

       Every frame ships a .scene-fallback that prints (rules 11, 20).       */
    function startRot3D(frame, w, h, kind){
      var GOLD = 0xf5c542, INDIGO = 0x7c8cff, CYAN = 0x56ccf2, INK = 0xf4f7fb;

      var renderer = lfOwn(frame, new T.WebGLRenderer({ alpha: true, antialias: LF_AA, powerPreference: 'high-performance' }));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      frame.appendChild(renderer.domElement);
      frame.classList.add('is-live');

      var scene = new T.Scene();
      var camera = new T.PerspectiveCamera(40, w / h, 0.1, 100);
      /* Aim at the middle of what the scene actually draws and pull back only
         far enough to hold it — a scene that sits as a stamp in the middle of
         a classroom-sized box is worse than no scene at all. */
      var AIM  = (kind === 'conical-pendulum') ? 2.15 : (kind === 'spin-top' ? 1.80 : (kind === 'spin-axis' ? 0.80 : 0.85));
      var HALF = (kind === 'conical-pendulum') ? 2.45 : (kind === 'spin-top' ? 2.05 : (kind === 'spin-axis' ? 2.00 : 1.45));
      var WIDE = (kind === 'conical-pendulum') ? 2.10 : (kind === 'spin-top' ? 2.20 : (kind === 'spin-axis' ? 1.95 : 2.45));
      function fit(aspect){
        var t2 = Math.tan((40 * Math.PI / 180) / 2);
        camera.position.set(0, AIM + HALF * 0.34,
          Math.max(HALF * 1.04 / t2, WIDE * 1.04 / (t2 * aspect)));
        camera.lookAt(0, AIM, 0);
      }
      fit(w / h);

      var group = new T.Group();          /* everything that yaws */
      scene.add(group);

      function mat(c, o){ return new T.LineBasicMaterial({ color: c, transparent: true, opacity: o }); }
      function line(pts, color, opacity){
        return new T.Line(new T.BufferGeometry().setFromPoints(pts), mat(color, opacity === undefined ? 1 : opacity));
      }
      function dashRing(y, r, color, opacity, n){
        var pts = [], k;
        for (k = 0; k <= n; k++) pts.push(new T.Vector3(r * Math.cos(k / n * Math.PI * 2), y, r * Math.sin(k / n * Math.PI * 2)));
        return line(pts, color, opacity);
      }
      /* an arrow that can be re-aimed every frame: unit cylinder + cone */
      function makeArrow(color, rad, opacity){
        var g = new T.Group();
        var m = new T.MeshBasicMaterial({ color: color,
          transparent: opacity !== undefined, opacity: opacity === undefined ? 1 : opacity });
        var shaft = new T.Mesh(new T.CylinderGeometry(rad, rad, 1, 10), m);
        var head  = new T.Mesh(new T.ConeGeometry(rad * 3, rad * 7, 14), m);
        g.add(shaft); g.add(head);
        g.userData = { shaft: shaft, head: head, rad: rad };
        return g;
      }
      function aim(g, from, to){
        var dir = new T.Vector3().subVectors(to, from), len = dir.length();
        if (len < 0.05){ g.visible = false; return; }
        g.visible = true;
        var hl = Math.min(g.userData.rad * 7, len * 0.45);
        var sl = Math.max(len - hl, 0.001);
        g.userData.shaft.scale.set(1, sl, 1);
        g.userData.shaft.position.set(0, sl / 2, 0);
        g.userData.head.scale.set(1, hl / (g.userData.rad * 7), 1);
        g.userData.head.position.set(0, sl + hl / 2, 0);
        g.position.copy(from);
        g.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
      }
      /* classroom-size label on a canvas — no webfont, no external asset */
      function label(text, css, size){
        var F = 72, c = document.createElement('canvas');
        var ctx = c.getContext('2d');
        ctx.font = 'bold ' + F + 'px Calibri, Candara, "Segoe UI", sans-serif';
        var tw = Math.max(40, Math.ceil(ctx.measureText(text).width));
        c.width = tw + 28; c.height = Math.round(F * 1.5);
        ctx = c.getContext('2d');
        ctx.font = 'bold ' + F + 'px Calibri, Candara, "Segoe UI", sans-serif';
        ctx.fillStyle = css; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, c.width / 2, c.height / 2);
        var tex = new T.CanvasTexture(c);
        tex.minFilter = T.LinearFilter;
        return new T.Mesh(new T.PlaneGeometry(size * c.width / c.height, size),
          new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      }
      /* Labels live on the scene root and are re-placed every frame from a
         point in the FIGURE's own space, so they never turn edge-on as the
         stage yaws. Anchors are written in group coordinates (that is where
         the geometry is authored), so the loop pushes each one through
         group.matrixWorld before placing the sprite — without that a scene
         whose group is offset or yawing leaves its labels behind the thing
         they name. */
      var bills = [];
      function tag(text, css, size, at){
        var m = label(text, css, size);
        scene.add(m);
        bills.push({ m: m, at: at });
        return m;
      }

      var spin = 0, prec = 0, tick = null;

      /* ------------------------------------------------------- spin-top --- */
      if (kind === 'spin-top'){
        group.add(dashRing(0, 2.15, INDIGO, 0.16, 64));
        group.add(line([new T.Vector3(0, 0, 0), new T.Vector3(0, 3.5, 0)], INK, 0.16));

        var lean = new T.Group();                 /* the axle's tilt */
        lean.rotation.z = 0.30;
        var precG = new T.Group();                /* the axle walking round */
        precG.add(lean); group.add(precG);

        var spinG = new T.Group(); lean.add(spinG);
        var coneGeo = new T.ConeGeometry(0.92, 1.45, 18);
        var shell = new T.Mesh(coneGeo, new T.MeshBasicMaterial({
          color: 0x0d1020, transparent: true, opacity: 0.72, side: T.DoubleSide }));
        shell.rotation.x = Math.PI; shell.position.y = 0.725; spinG.add(shell);
        var wire = new T.LineSegments(new T.WireframeGeometry(coneGeo), mat(INDIGO, 0.34));
        wire.rotation.x = Math.PI; wire.position.y = 0.725; spinG.add(wire);
        var rim = new T.Mesh(new T.TorusGeometry(0.92, 0.045, 8, 40),
          new T.MeshBasicMaterial({ color: INDIGO, transparent: true, opacity: 0.8 }));
        rim.rotation.x = Math.PI / 2; rim.position.y = 1.45; spinG.add(rim);
        var stem = new T.Mesh(new T.CylinderGeometry(0.045, 0.045, 1.0, 10),
          new T.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.7 }));
        stem.position.y = 1.95; spinG.add(stem);
        var flag = new T.Mesh(new T.BoxGeometry(0.62, 0.05, 0.05),
          new T.MeshBasicMaterial({ color: GOLD }));
        flag.position.set(0.31, 1.45, 0); spinG.add(flag);   /* so the spin is visible */

        var arrL = makeArrow(GOLD, 0.055); lean.add(arrL);
        aim(arrL, new T.Vector3(0, 1.1, 0), new T.Vector3(0, 3.35, 0));
        var tipL = new T.Vector3(), pL = new T.Vector3(0, 3.62, 0);
        tag('L', '#f5c542', 0.42, function(){ return pL.clone().applyMatrix4(lean.matrixWorld); });

        tick = function(t){
          spin += 0.16; prec += 0.006;
          spinG.rotation.y = spin;
          precG.rotation.y = prec;
          group.rotation.y = Math.sin(t / 7) * 0.22;
        };
      }

      /* --------------------------------------------- conical-pendulum ----- */
      if (kind === 'conical-pendulum'){
        var AY = 3.05, BY = 0.85, RR = 1.45;
        group.add(line([new T.Vector3(0, AY, 0), new T.Vector3(0, -0.15, 0)], INK, 0.22));
        group.add(dashRing(BY, RR, INK, 0.5, 72));
        var k;
        for (k = 0; k < 24; k++){                 /* the cone the string sweeps */
          var a = k / 24 * Math.PI * 2;
          group.add(line([new T.Vector3(0, AY, 0),
            new T.Vector3(RR * Math.cos(a), BY, RR * Math.sin(a))], INDIGO, 0.10));
        }
        var dotA = new T.Mesh(new T.SphereGeometry(0.075, 16, 12), new T.MeshBasicMaterial({ color: INK }));
        dotA.position.set(0, AY, 0); group.add(dotA);
        var dotB = new T.Mesh(new T.SphereGeometry(0.065, 16, 12), new T.MeshBasicMaterial({ color: INK }));
        dotB.position.set(0, BY, 0); group.add(dotB);
        tag('A', '#f4f7fb', 0.34, function(){ return new T.Vector3(-0.32, AY + 0.22, 0); });
        tag('B', '#f4f7fb', 0.34, function(){ return new T.Vector3(-0.30, BY - 0.02, 0); });

        var bob = new T.Mesh(new T.SphereGeometry(0.155, 22, 16), new T.MeshBasicMaterial({ color: GOLD }));
        group.add(bob);
        var cord = line([new T.Vector3(0, AY, 0), new T.Vector3(RR, BY, 0)], INK, 0.62);
        group.add(cord);

        var arrB = makeArrow(GOLD, 0.05);  group.add(arrB);      /* L about B — fixed */
        var arrA = makeArrow(CYAN, 0.05);  group.add(arrA);      /* L about A — leans */
        aim(arrB, new T.Vector3(0, BY, 0), new T.Vector3(0, BY + 1.5, 0));
        var aTip = new T.Vector3();
        tag('L about B', '#f5c542', 0.32, function(){ return new T.Vector3(0.68, BY + 1.62, 0); });
        tag('L about A', '#56ccf2', 0.32, function(){
          return aTip.clone().add(new T.Vector3(0, 0.30, 0).addScaledVector(
            aTip.clone().sub(new T.Vector3(0, AY, 0)).setY(0).normalize(), 0.42)); });

        tick = function(t){
          var ps = t * 0.9;
          /* x -> -z, so omega (and L about B) comes out along +y: the bob turns
             anticlockwise seen from above, which is the sense the arrow shows. */
          var P = new T.Vector3(RR * Math.cos(ps), BY, -RR * Math.sin(ps));
          bob.position.copy(P);
          cord.geometry.setFromPoints([new T.Vector3(0, AY, 0), P]);
          cord.geometry.attributes.position.needsUpdate = true;
          /* L about A = r x p, r from A to the bob, p along the tangent.
             It leans off the vertical by the same angle the string makes, and
             it walks round with the bob — which is the point of the slide. */
          var r = P.clone().sub(new T.Vector3(0, AY, 0));
          var v = new T.Vector3(-Math.sin(ps), 0, -Math.cos(ps));
          var L = new T.Vector3().crossVectors(r, v).normalize().multiplyScalar(1.5);
          var base = new T.Vector3(0, AY, 0);
          aTip.copy(base).add(L);
          aim(arrA, base, aTip);
          group.rotation.y = Math.sin(t / 9) * 0.20;
        };
      }

      /* ------------------------------------------------------ spin-axis --- */
      /* A disc on its axle, turning, with omega drawn ALONG the axle in the
         right-hand sense. It is the one fact every "about axis of rotation"
         line on this board depends on and the one a still figure cannot
         carry: omega does not lie in the plane the disc is spinning in — it
         stands on it. data-sense="cw" reverses both the turn and the arrow. */
      if (kind === 'spin-axis'){
        var sense = (frame.getAttribute('data-sense') || 'ccw').trim() === 'cw' ? -1 : 1;
        var RD = 1.30, YC = 0.85;

        var hub = new T.Group(); hub.position.y = YC; group.add(hub);

        /* the disc: a filled face kept dark so the wireframe reads, plus its
           rim and a pair of spokes so the turn is actually visible */
        var face = new T.Mesh(new T.CircleGeometry(RD, 56),
          new T.MeshBasicMaterial({ color: 0x0d1020, transparent: true, opacity: 0.72,
                                    side: T.DoubleSide }));
        face.rotation.x = -Math.PI / 2; hub.add(face);

        var rimPts = [], kk, NR = 72;
        for (kk = 0; kk <= NR; kk++)
          rimPts.push(new T.Vector3(RD * Math.cos(kk / NR * Math.PI * 2), 0,
                                    RD * Math.sin(kk / NR * Math.PI * 2)));
        hub.add(line(rimPts, INDIGO, 0.9));
        hub.add(dashRing(0, RD * 0.62, INDIGO, 0.34, 48));
        for (kk = 0; kk < 4; kk++){
          var aa = kk * Math.PI / 2;
          hub.add(line([new T.Vector3(0, 0, 0),
                        new T.Vector3(RD * Math.cos(aa), 0, RD * Math.sin(aa))],
                       INK, kk === 0 ? 0.85 : 0.24));
        }

        /* the axle it turns on — a thin line right through the disc */
        group.add(line([new T.Vector3(0, YC - 1.55, 0), new T.Vector3(0, YC + 1.95, 0)],
                       INK, 0.30));

        /* omega, standing on the plane */
        var arrW = makeArrow(GOLD, 0.055); group.add(arrW);
        aim(arrW, new T.Vector3(0, YC, 0), new T.Vector3(0, YC + sense * 1.62, 0));

        /* the sense it turns in, as an arc riding just above the disc */
        var senseArc = line([new T.Vector3(0,0,0)], CYAN, 0.8); group.add(senseArc);
        var sp2 = [], n3 = 40;
        for (kk = 0; kk <= n3; kk++){
          var a3 = sense * (kk / n3) * Math.PI * 1.42;
          sp2.push(new T.Vector3(RD * 0.44 * Math.cos(a3), YC + 0.30, -RD * 0.44 * Math.sin(a3)));
        }
        senseArc.geometry.setFromPoints(sp2);

        tag('omega', '#f5c542', 0.34,
            function(){ return new T.Vector3(0.62, YC + sense * 1.62 + sense * 0.16, 0); });
        tag('axis of rotation', '#f4f7fb', 0.26,
            function(){ return new T.Vector3(0, YC - 1.72, 0); });

        tick = function(t){
          hub.rotation.y = sense * t * 1.15;
          group.rotation.y = 0.38 + Math.sin(t / 9) * 0.20;
        };
      }

      /* ------------------------------- cross-product / torque-lever ------- */
      if (kind === 'cross-product' || kind === 'torque-lever'){
        var isTau = (kind === 'torque-lever');
        var RX = 2.0, i2, j2, gp = [];
        for (i2 = -3; i2 <= 3; i2++){             /* the plane you drew it in */
          gp.push(i2 * 0.6, 0, -1.8, i2 * 0.6, 0, 1.8);
          gp.push(-1.8, 0, i2 * 0.6, 1.8, 0, i2 * 0.6);
        }
        var gg = new T.BufferGeometry();
        gg.setAttribute('position', new T.Float32BufferAttribute(gp, 3));
        var plane = new T.LineSegments(gg, mat(INDIGO, 0.14));
        plane.position.x = 0.6; group.add(plane);
        group.position.x = -1.25;          /* the figure lives on +x — recentre it */

        if (isTau){                                /* a spanner on its nut */
          var nut = new T.Mesh(new T.CylinderGeometry(0.28, 0.28, 0.18, 6),
            new T.MeshBasicMaterial({ color: INDIGO, transparent: true, opacity: 0.85 }));
          nut.position.y = 0.03; group.add(nut);
          var shaft2 = new T.Mesh(new T.BoxGeometry(RX + 0.35, 0.08, 0.24),
            new T.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.30 }));
          shaft2.position.set((RX + 0.35) / 2 - 0.1, 0.03, 0); group.add(shaft2);
        } else {
          var orig = new T.Mesh(new T.SphereGeometry(0.075, 16, 12), new T.MeshBasicMaterial({ color: INK }));
          group.add(orig);
          var bod = new T.Mesh(new T.SphereGeometry(0.135, 20, 14), new T.MeshBasicMaterial({ color: INDIGO }));
          bod.position.set(RX, 0, 0); group.add(bod);
        }

        var arrR = makeArrow(INDIGO, 0.05); group.add(arrR);
        aim(arrR, new T.Vector3(0, 0, 0), new T.Vector3(RX, 0, 0));
        var arrF = makeArrow(INK, 0.05);    group.add(arrF);
        var arrT = makeArrow(GOLD, 0.058);  group.add(arrT);
        var arc  = line([new T.Vector3(0,0,0), new T.Vector3(0,0,0)], CYAN, 0.75); group.add(arc);

        var tTip = new T.Vector3(0, 1, 0), fTip = new T.Vector3();
        tag('r', '#7c8cff', 0.36, function(){ return new T.Vector3(RX * 0.5, 0.02, 0.34); });
        tag(isTau ? 'F' : 'v', '#f4f7fb', 0.36, function(){ return fTip.clone().add(new T.Vector3(0, 0.26, 0)); });
        tag(isTau ? 'torque' : 'L', '#f5c542', 0.34, function(){ return tTip.clone().add(new T.Vector3(0, 0.26, 0)); });

        tick = function(t){
          /* theta opens 15 deg -> 165 deg and shuts again, so the class watches
             the perpendicular answer grow, peak at 90 and die back. */
          var th = (Math.PI / 180) * (90 - 75 * Math.cos(t * 0.42));
          var dir = new T.Vector3(Math.cos(th), 0, -Math.sin(th));
          var base = new T.Vector3(RX, 0, 0);
          fTip.copy(base).add(dir.clone().multiplyScalar(1.35));
          aim(arrF, base, fTip);
          var mag = 1.9 * Math.abs(Math.sin(th)) + 0.06;
          tTip.set(0, mag, 0);
          aim(arrT, new T.Vector3(0, 0, 0), tTip);
          var pts = [], k2, n2 = 26;              /* the angle between them */
          for (k2 = 0; k2 <= n2; k2++){
            var a2 = th * k2 / n2;
            pts.push(new T.Vector3(RX + 0.72 * Math.cos(a2), 0.005, -0.72 * Math.sin(a2)));
          }
          arc.geometry.setFromPoints(pts);
          arc.geometry.attributes.position.needsUpdate = true;
          group.rotation.y = 0.42 + Math.sin(t / 8) * 0.22;
        };
      }

      function resize(){
        var nw = frame.clientWidth, nh = frame.clientHeight;
        if (!nw || !nh) return;
        camera.aspect = nw / nh; camera.updateProjectionMatrix();
        fit(nw / nh);
        renderer.setSize(nw, nh);
      }
      lfOn(frame, 'resize', resize);

      var t0 = Date.now();
      lfLoop(frame, function loop(){
        var t = (Date.now() - t0) / 1000;
        if (tick) tick(t);
        group.updateMatrixWorld(true);
        for (var b = 0; b < bills.length; b++){
          bills[b].m.position.copy(bills[b].at()).applyMatrix4(group.matrixWorld);
          bills[b].m.quaternion.copy(camera.quaternion);
        }
        renderer.render(scene, camera);
      });
    }

    /* ---------------------------------------- conservation-of-L 3D scenes ---
       Two scenes for the "no external torque, so L is constant" board. They
       stand in for the two lecture-demo clips the source deck embedded as
       local .mov files — a self-contained single-file deck cannot carry a
       36 MB video, and a video cannot be written on.

         skater-spin   the turntable demo: a body on a stool with a mass in
                       each hand. The arms draw in and go out again. Nothing
                       pushes it; it speeds up anyway.
         hoberman      the same law on a body that changes its own size: a
                       sphere of rings that breathes in and out as it turns.

       The physics is integrated, not faked: I is recomputed from the current
       radius every frame and omega is L / I, so the turn rate on screen is the
       one the formula gives. The three bars underneath are the whole reason
       these are scenes and not pictures — I falls, omega rises, and the bar
       for L = I omega NEVER MOVES. A still figure can assert that a product is
       constant; only the event can show it.

       Rules 7, 11 and 20 still hold: the frame ships a .scene-fallback, that
       is what prints and what a room with no WebGL sees, and no slide depends
       on anything in here.                                                  */
    function startConserve(frame, w, h, kind){
      var GOLD = 0xf5c542, INDIGO = 0x7c8cff, CYAN = 0x56ccf2, INK = 0xf4f7fb;
      var isSkater = (kind === 'skater-spin');

      var renderer = lfOwn(frame, new T.WebGLRenderer({ alpha: true, antialias: LF_AA, powerPreference: 'high-performance' }));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      frame.appendChild(renderer.domElement);
      frame.classList.add('is-live');

      var scene = new T.Scene();
      var camera = new T.PerspectiveCamera(40, w / h, 0.1, 100);
      var AIM = 0.42, HALF = 2.30, WIDE = 2.70;
      function fit(aspect){
        var t2 = Math.tan((40 * Math.PI / 180) / 2);
        camera.position.set(0, AIM + HALF * 0.26,
          Math.max(HALF * 1.04 / t2, WIDE * 1.04 / (t2 * aspect)));
        camera.lookAt(0, AIM, 0);
      }
      fit(w / h);

      var group = new T.Group();          /* everything that yaws */
      scene.add(group);
      var spinG = new T.Group();          /* everything that turns about the axis */
      group.add(spinG);

      function mat(c, o){ return new T.LineBasicMaterial({ color: c, transparent: true, opacity: o }); }
      function line(pts, color, opacity){
        return new T.Line(new T.BufferGeometry().setFromPoints(pts), mat(color, opacity === undefined ? 1 : opacity));
      }
      function ring(r, color, opacity, n){
        var pts = [], k;
        n = n || 64;
        for (k = 0; k <= n; k++) pts.push(new T.Vector3(r * Math.cos(k / n * Math.PI * 2), 0, r * Math.sin(k / n * Math.PI * 2)));
        return line(pts, color, opacity);
      }
      function solid(c, o){
        return new T.MeshBasicMaterial({ color: c, transparent: true, opacity: o === undefined ? 1 : o });
      }
      function makeArrow(color, rad){
        var g = new T.Group();
        var m = solid(color);
        var shaft = new T.Mesh(new T.CylinderGeometry(rad, rad, 1, 10), m);
        var head  = new T.Mesh(new T.ConeGeometry(rad * 3, rad * 7, 14), m);
        g.add(shaft); g.add(head);
        g.userData = { shaft: shaft, head: head, rad: rad };
        return g;
      }
      function aim(g, from, to){
        var dir = new T.Vector3().subVectors(to, from), len = dir.length();
        if (len < 0.05){ g.visible = false; return; }
        g.visible = true;
        var hl = Math.min(g.userData.rad * 7, len * 0.45);
        var sl = Math.max(len - hl, 0.001);
        g.userData.shaft.scale.set(1, sl, 1);
        g.userData.shaft.position.set(0, sl / 2, 0);
        g.userData.head.scale.set(1, hl / (g.userData.rad * 7), 1);
        g.userData.head.position.set(0, sl + hl / 2, 0);
        g.position.copy(from);
        g.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
      }
      /* classroom-size label on a canvas — no webfont, no external asset */
      function label(text, css, size){
        var F = 72, c = document.createElement('canvas');
        var ctx = c.getContext('2d');
        ctx.font = 'bold ' + F + 'px Calibri, Candara, "Segoe UI", sans-serif';
        var tw = Math.max(40, Math.ceil(ctx.measureText(text).width));
        c.width = tw + 28; c.height = Math.round(F * 1.5);
        ctx = c.getContext('2d');
        ctx.font = 'bold ' + F + 'px Calibri, Candara, "Segoe UI", sans-serif';
        ctx.fillStyle = css; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, c.width / 2, c.height / 2);
        var tex = new T.CanvasTexture(c);
        tex.minFilter = T.LinearFilter;
        return new T.Mesh(new T.PlaneGeometry(size * c.width / c.height, size),
          new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      }
      /* Labels that ride the figure: re-placed every frame from a point in the
         yawing group's own space, so they never turn edge-on. Anchors must be
         written in GROUP coordinates — a point taken off something inside
         spinG has to be pushed through spinG.matrix first, or the label sits
         at the angle the body started from and the mass turns out from under
         its own name. */
      var bills = [];
      function tag(text, css, size, at){
        var m = label(text, css, size);
        scene.add(m);
        bills.push({ m: m, at: at });
        return m;
      }
      /* Labels that belong to the read-out, not to the figure. They sit in the
         scene root at a fixed point — a bar chart that swings with the stage is
         unreadable — but they still face the camera, or they foreshorten. */
      var flatBills = [];
      function fixedTag(text, css, size, x, y){
        var m = label(text, css, size);
        m.position.set(x, y, 0.42);
        scene.add(m);
        flatBills.push(m);
        return m;
      }

      /* ------------------------------------------------ the turning body --- */
      var RMAX = 1.52, RMIN = 0.46, IHUB, ballG;

      group.add(line([new T.Vector3(0, -0.30, 0), new T.Vector3(0, 2.62, 0)], INK, 0.26));

      if (isSkater){
        /* the stool it stands on — this is what makes "no external torque"
           believable: the class can see nothing is holding it */
        var TT = 0.92;
        var plate = new T.Mesh(new T.CircleGeometry(TT, 48), solid(0x0d1020, 0.78));
        plate.rotation.x = -Math.PI / 2; spinG.add(plate);
        spinG.add(ring(TT, INDIGO, 0.85));
        spinG.add(ring(TT * 0.55, INDIGO, 0.28, 40));
        var kk;
        for (kk = 0; kk < 6; kk++){
          var aa = kk * Math.PI / 3;
          spinG.add(line([new T.Vector3(0, 0.002, 0),
                          new T.Vector3(TT * Math.cos(aa), 0.002, TT * Math.sin(aa))],
                         INK, kk === 0 ? 0.75 : 0.18));
        }
        var pedestal = new T.Mesh(new T.CylinderGeometry(0.10, 0.20, 0.30, 12), solid(INK, 0.20));
        pedestal.position.y = -0.16; group.add(pedestal);

        /* the body */
        var torso = new T.Mesh(new T.CylinderGeometry(0.20, 0.26, 1.02, 16), solid(INDIGO, 0.55));
        torso.position.y = 0.55; spinG.add(torso);
        var head = new T.Mesh(new T.SphereGeometry(0.165, 20, 14), solid(INK, 0.62));
        head.position.y = 1.26; spinG.add(head);

        /* the two masses, on arms that draw in */
        var armY = 0.92;
        var armL = line([new T.Vector3(0, armY, 0), new T.Vector3(-RMAX, armY, 0)], INK, 0.70);
        var armR = line([new T.Vector3(0, armY, 0), new T.Vector3( RMAX, armY, 0)], INK, 0.70);
        spinG.add(armL); spinG.add(armR);
        var mL = new T.Mesh(new T.SphereGeometry(0.16, 20, 14), solid(GOLD));
        var mR = new T.Mesh(new T.SphereGeometry(0.16, 20, 14), solid(GOLD));
        spinG.add(mL); spinG.add(mR);

        IHUB = 0.62;                        /* body + stool, never changes */
        var MARM = 1.00;                    /* 2 x m, folded into one number */
        ballG = { setR: function(R){
          mL.position.set(-R, armY, 0);
          mR.position.set( R, armY, 0);
          armL.geometry.setFromPoints([new T.Vector3(0, armY, 0), new T.Vector3(-R, armY, 0)]);
          armR.geometry.setFromPoints([new T.Vector3(0, armY, 0), new T.Vector3( R, armY, 0)]);
          armL.geometry.attributes.position.needsUpdate = true;
          armR.geometry.attributes.position.needsUpdate = true;
        }, inertia: function(R){ return IHUB + MARM * R * R; } };

      } else {
        /* the folding sphere: rings at unit radius, the whole cage scaled.
           Each meridian gets its OWN holder group for its longitude, because a
           mesh carrying both rotation.x and rotation.y composes them in one
           Euler and the great circles do not come out evenly spaced. */
        var cage = new T.Group(); spinG.add(cage); cage.position.y = 0.98;
        var lat = [0, 0.42, -0.42, 0.74, -0.74], li;
        for (li = 0; li < lat.length; li++){
          var yy = lat[li], rr = Math.sqrt(Math.max(1 - yy * yy, 0.02));
          var rg = ring(rr, li === 0 ? CYAN : INDIGO, li === 0 ? 0.85 : 0.42, 56);
          rg.position.y = yy; cage.add(rg);
        }
        var lon;
        for (lon = 0; lon < 6; lon++){
          var holder = new T.Group();
          holder.rotation.y = lon * Math.PI / 6;
          var mer = ring(1, lon % 2 ? INDIGO : GOLD, lon % 2 ? 0.34 : 0.30, 56);
          mer.rotation.x = Math.PI / 2;
          holder.add(mer); cage.add(holder);
        }
        /* one node marked, so the turn is visible even when the cage is small */
        var node = new T.Mesh(new T.SphereGeometry(0.085, 16, 12), solid(GOLD));
        node.position.set(1, 0, 0); cage.add(node);

        ballG = { setR: function(R){ cage.scale.setScalar(R * 0.86); },
                  inertia: function(R){ return 0.16 + 0.92 * R * R; } };
      }

      /* L, standing on the axis — drawn once and never touched again, because
         that is the entire claim the slide is making */
      var arrL = makeArrow(GOLD, 0.055); group.add(arrL);
      aim(arrL, new T.Vector3(0, 1.62, 0), new T.Vector3(0, 2.52, 0));
      tag('L', '#f5c542', 0.34, function(){ return new T.Vector3(0.30, 2.62, 0); });

      /* ------------------------------------------------------- the bars --- */
      var X0 = -1.05, BW = 2.35, BY = [-0.62, -1.02, -1.42];
      function bar(color, y, z, opacity){
        var m = new T.Mesh(new T.PlaneGeometry(1, 0.145),
          new T.MeshBasicMaterial({ color: color, transparent: true,
                                    opacity: opacity === undefined ? 0.92 : opacity,
                                    side: T.DoubleSide, depthWrite: false }));
        m.position.set(X0, y, z);
        scene.add(m);
        return m;
      }
      function setBar(m, frac){
        var len = Math.max(BW * frac, 0.004);
        m.scale.x = len;
        m.position.x = X0 + len / 2;
      }
      /* the scale each bar is read against — laid down FIRST and set behind, so
         a translucent track never washes over the bar it is measuring */
      var ti;
      for (ti = 0; ti < 3; ti++) setBar(bar(INK, BY[ti], 0.34, 0.09), 1);
      var bI = bar(INDIGO, BY[0], 0.40),
          bW = bar(CYAN,   BY[1], 0.40),
          bL = bar(GOLD,   BY[2], 0.40);

      fixedTag('I',             '#7c8cff', 0.26, X0 - 0.30, BY[0]);
      fixedTag('omega',         '#56ccf2', 0.24, X0 - 0.46, BY[1]);
      fixedTag('L = I x omega', '#f5c542', 0.24, X0 - 0.86, BY[2]);

      /* ------------------------------------------------------ the motion --- */
      /* One cycle: hold out, draw in, hold in, let out. Linear in r, so the
         speeding-up the class sees is entirely the 1/I in omega. */
      var CYCLE = 13.0, L0 = null, ang = 0, last = null;
      function radiusAt(t){
        var p = (t % CYCLE) / CYCLE;
        if (p < 0.20) return RMAX;
        if (p < 0.38) return RMAX - (RMAX - RMIN) * (p - 0.20) / 0.18;
        if (p < 0.62) return RMIN;
        if (p < 0.80) return RMIN + (RMAX - RMIN) * (p - 0.62) / 0.18;
        return RMAX;
      }

      var IMAX = ballG.inertia(RMAX), IMIN = ballG.inertia(RMIN);
      /* Pick L so the FAST end of the cycle is watchable rather than dizzying:
         omega_max = L/IMIN, and the sphere's I falls further than the skater's,
         so it needs the smaller L to land at the same top speed (~0.6 rev/s). */
      L0 = IMAX * (isSkater ? 1.05 : 0.62);

      function resize(){
        var nw = frame.clientWidth, nh = frame.clientHeight;
        if (!nw || !nh) return;
        camera.aspect = nw / nh; camera.updateProjectionMatrix();
        fit(nw / nh);
        renderer.setSize(nw, nh);
      }
      lfOn(frame, 'resize', resize);

      var t0 = Date.now();
      lfLoop(frame, function loop(){
        var t = (Date.now() - t0) / 1000;
        var R = radiusAt(t);
        var I = ballG.inertia(R);
        var om = L0 / I;

        /* integrate, so a paused scene resumes where it stopped instead of
           jumping to wherever a t*omega formula would have put it */
        var dt = last === null ? 0 : Math.min(t - last, 0.1);
        last = t;
        ang += om * dt;

        ballG.setR(R);
        spinG.rotation.y = ang;
        group.rotation.y = 0.34 + Math.sin(t / 11) * 0.16;

        setBar(bI, I / IMAX);
        setBar(bW, IMIN / I);
        setBar(bL, (I * om) / L0);       /* I x omega over L — identically 1 */

        group.updateMatrixWorld(true);
        var b;
        for (b = 0; b < bills.length; b++){
          bills[b].m.position.copy(bills[b].at()).applyMatrix4(group.matrixWorld);
          bills[b].m.quaternion.copy(camera.quaternion);
        }
        for (b = 0; b < flatBills.length; b++) flatBills[b].quaternion.copy(camera.quaternion);
        renderer.render(scene, camera);
      });
    }


    /* ═══════════════════════════════ gravitation scenes ═══════════════════
       Three WebGL figures for the "variation of g" chapter. Each exists only
       because the still figure on the source slide cannot carry the thing the
       board is actually about:

         earth-g       g walked from the centre outward — the SAME point passes
                       through both regimes, rising linearly to the surface and
                       falling as 1/r² beyond it, with the g-r curve filling in
                       underneath as it goes. A still graph asserts the kink at
                       r = R; this shows the probe arriving at it.
         latitude-g    the rotation board: a bead walks from the equator to the
                       pole while mω²r — which depends on the distance to the
                       AXIS, not to the centre — shrinks to nothing, and g_eff
                       grows. "Max at the pole, min at the equator" is a claim
                       about a journey, so it needs the journey.
         oblate-earth  the shape term: the sphere and the real, flattened earth
                       drawn on the same centre, so the 21 km of extra equatorial
                       radius is a gap you can see rather than a number.

       Geometry and axis names only — no lesson text lives in the canvas, every
       frame ships a .scene-fallback carrying the same figure flat, and that is
       what prints and what a room with no WebGL sees (rules 11, 20).         */
    function startGravity(frame, w, h, kind){
      var GOLD = 0xf5c542, INDIGO = 0x7c8cff, GREEN = 0x34d399,
          RED = 0xfb7185, INK = 0xf4f7fb;

      var renderer = lfOwn(frame, new T.WebGLRenderer({ alpha: true, antialias: LF_AA, powerPreference: 'high-performance' }));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      frame.appendChild(renderer.domElement);
      frame.classList.add('is-live');

      var scene = new T.Scene();
      var camera = new T.PerspectiveCamera(40, w / h, 0.1, 100);
      camera.position.set(0, 0, 12);
      camera.lookAt(0, 0, 0);
      var HALF = (kind === 'earth-g') ? 3.05 : (kind === 'latitude-g' ? 2.85 : 2.35);
      var WIDE = (kind === 'earth-g') ? 3.55 : (kind === 'latitude-g' ? 3.05 : 2.60);
      function fit(aspect){
        var t2 = Math.tan((40 * Math.PI / 180) / 2);
        camera.position.z = Math.max(HALF / t2, WIDE / (t2 * aspect));
      }
      fit(w / h);

      var group = new T.Group();
      scene.add(group);

      function line(pts, color, opacity){
        return new T.Line(new T.BufferGeometry().setFromPoints(pts),
          new T.LineBasicMaterial({ color: color, transparent: true,
            opacity: opacity === undefined ? 1 : opacity }));
      }
      function dashed(pts, color, opacity){
        var l = line(pts, color, opacity);
        l.material.dispose();
        l.material = new T.LineDashedMaterial({ color: color, transparent: true,
          opacity: opacity === undefined ? 1 : opacity, dashSize: 0.13, gapSize: 0.1 });
        l.computeLineDistances();
        return l;
      }
      function arrow(color, rad){
        var g = new T.Group();
        var mat = new T.MeshBasicMaterial({ color: color });
        var shaft = new T.Mesh(new T.CylinderGeometry(rad, rad, 1, 12), mat);
        var head  = new T.Mesh(new T.ConeGeometry(rad * 3, rad * 7, 16), mat);
        g.add(shaft); g.add(head);
        g.userData = { shaft: shaft, head: head, rad: rad };
        return g;
      }
      function aim(g, from, to){
        var dir = new T.Vector3().subVectors(to, from), len = dir.length();
        if (len < 0.06){ g.visible = false; return; }
        g.visible = true;
        var hl = Math.min(g.userData.rad * 7, len * 0.44);
        var sl = Math.max(len - hl, 0.001);
        g.userData.shaft.scale.set(1, sl, 1);
        g.userData.shaft.position.set(0, sl / 2, 0);
        g.userData.head.scale.set(1, hl / (g.userData.rad * 7), 1);
        g.userData.head.position.set(0, sl + hl / 2, 0);
        g.position.copy(from);
        g.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
      }
      function label(text, css, size){
        var c = document.createElement('canvas');
        c.width = 512; c.height = 128;
        var ctx = c.getContext('2d');
        ctx.font = 'bold 74px Calibri, Candara, "Segoe UI", sans-serif';
        ctx.fillStyle = css; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, 256, 64);
        var tex = new T.CanvasTexture(c);
        tex.minFilter = T.LinearFilter;
        return new T.Mesh(new T.PlaneGeometry(size * 4, size),
          new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      }
      function sphere(r, colour, opacity, seg){
        return new T.LineSegments(
          new T.WireframeGeometry(new T.SphereGeometry(r, seg || 22, Math.round((seg || 22) * 0.6))),
          new T.LineBasicMaterial({ color: colour, transparent: true, opacity: opacity }));
      }
      /* The construction — bead, vectors, dashed radius, labels — is ABOUT the
         body, not inside it. Depth-testing it against the globe buries half of
         every arrow the moment the bead swings to the far side, so the whole
         construction is drawn on top of the sphere unconditionally. This is a
         figure, not a rendering: the class needs to see mg and mω²r whatever
         the globe happens to be doing behind them. */
      function onTop(obj, order){
        obj.renderOrder = order === undefined ? 10 : order;
        obj.traverse(function(n){
          if (!n.material) return;
          var ms = Array.isArray(n.material) ? n.material : [n.material];
          for (var i = 0; i < ms.length; i++){ ms[i].depthTest = false; ms[i].depthWrite = false; }
          n.renderOrder = obj.renderOrder;
        });
        return obj;
      }

      /* ------------------------------------------------------- earth-g ---- */
      if (kind === 'earth-g'){
        var R = 1.10, C = new T.Vector3(-2.85, 1.30, 0);
        var body = new T.Group();
        body.position.copy(C);
        group.add(body);
        body.add(sphere(R, INDIGO, 0.30, 20));
        body.add(new T.Mesh(new T.SphereGeometry(R * 0.995, 40, 26),
          new T.MeshBasicMaterial({ color: 0x0d1020, transparent: true, opacity: 0.60 })));

        /* the radius the probe walks, drawn out to 4R so the road exists first */
        group.add(line([C, new T.Vector3(C.x + 4 * R, C.y, 0)], INK, 0.20));
        var probe = onTop(new T.Mesh(new T.SphereGeometry(0.085, 14, 10),
          new T.MeshBasicMaterial({ color: GREEN })));
        group.add(probe);
        var gArrow = onTop(arrow(GOLD, 0.055));
        group.add(gArrow);

        /* the graph, at rest, with its axes and the surface marked */
        var GX = -2.95, GY = -2.60, GW = 5.9, GH = 1.95, GR = 0.25 * GW;  /* R at 1/4 span */
        group.add(line([new T.Vector3(GX, GY, 0), new T.Vector3(GX + GW, GY, 0)], INK, 0.34));
        group.add(line([new T.Vector3(GX, GY, 0), new T.Vector3(GX, GY + GH, 0)], INK, 0.34));
        var curve = [];
        var i, rr, gg;
        for (i = 0; i <= 40; i++){                      /* inside: g ∝ r      */
          rr = i / 40;
          curve.push(new T.Vector3(GX + rr * GR, GY + rr * GH, 0));
        }
        for (i = 1; i <= 90; i++){                      /* outside: g ∝ 1/r²  */
          rr = 1 + (i / 90) * 3;                        /* r/R from 1 to 4    */
          gg = 1 / (rr * rr);
          curve.push(new T.Vector3(GX + rr * GR, GY + gg * GH, 0));
        }
        group.add(line(curve, GOLD, 0.55));
        group.add(dashed([new T.Vector3(GX + GR, GY, 0), new T.Vector3(GX + GR, GY + GH, 0)], INK, 0.26));
        var mark = new T.Mesh(new T.SphereGeometry(0.075, 14, 10),
          new T.MeshBasicMaterial({ color: GREEN }));
        group.add(mark);

        var lR = label('R', '#f4f7fb', 0.36);
        var lr = label('r', '#f4f7fb', 0.36);
        var lg = label('g', '#f5c542', 0.36);
        group.add(lR); group.add(lr); group.add(lg);
        lR.position.set(GX + GR, GY - 0.28, 0);
        lr.position.set(GX + GW - 0.1, GY - 0.28, 0);
        lg.position.set(GX - 0.32, GY + GH, 0);

        var t0 = Date.now(), lastW = w, lastH = h;
        lfLoop(frame, function loop(){
          var nw = frame.clientWidth, nh = frame.clientHeight;
          if (!nw || !nh) return;
          if (nw !== lastW || nh !== lastH){
            lastW = nw; lastH = nh;
            camera.aspect = nw / nh; fit(nw / nh); camera.updateProjectionMatrix();
            renderer.setSize(nw, nh);
          }
          var t = (Date.now() - t0) / 1000;
          body.rotation.y += 0.004;
          group.rotation.y = Math.sin(t / 9) * 0.10;

          /* the probe walks 0 → 4R and back, slowly */
          var u = 0.5 - 0.5 * Math.cos(t * 0.30);
          var x = u * 4;                                  /* r/R              */
          var gN = x <= 1 ? x : 1 / (x * x);              /* g/g_surface      */
          var P = new T.Vector3(C.x + x * R, C.y, 0);
          probe.position.copy(P);
          aim(gArrow, P, new T.Vector3(P.x - gN * 1.45 * R, C.y, 0));
          mark.position.set(GX + x * GR, GY + gN * GH, 0);
          renderer.render(scene, camera);
        });
        lfOn(frame, 'resize', function(){});
        return;
      }

      /* ---------------------------------------------------- latitude-g ---- */
      if (kind === 'latitude-g'){
        var Re = 1.02;
        var tilt = new T.Group();
        tilt.rotation.z = 0.24;                    /* the axis, leant a little */
        tilt.position.y = 0.42;
        group.add(tilt);

        var spinG = new T.Group();
        tilt.add(spinG);
        spinG.add(sphere(Re, INDIGO, 0.26, 22));
        spinG.add(new T.Mesh(new T.SphereGeometry(Re * 0.995, 40, 26),
          new T.MeshBasicMaterial({ color: 0x0d1020, transparent: true, opacity: 0.62 })));

        /* the axis: everything on this board is measured from it, not from
           the centre, which is the one thing students get wrong */
        tilt.add(line([new T.Vector3(0, -Re * 1.42, 0), new T.Vector3(0, Re * 1.42, 0)], INK, 0.36));
        var eq = [];
        for (var e = 0; e <= 72; e++){
          var a = e / 72 * Math.PI * 2;
          eq.push(new T.Vector3(Re * Math.cos(a), 0, Re * Math.sin(a)));
        }
        tilt.add(line(eq, GOLD, 0.28));

        var bead = onTop(new T.Mesh(new T.SphereGeometry(0.11, 14, 10),
          new T.MeshBasicMaterial({ color: GREEN })));
        tilt.add(bead);
        var aMg  = onTop(arrow(INK, 0.050));   /* mg, at the centre           */
        var aCen = onTop(arrow(RED, 0.050));   /* mω²r, away from the AXIS    */
        var aEff = onTop(arrow(GOLD, 0.062));  /* what is left: g_eff         */
        tilt.add(aMg); tilt.add(aCen); tilt.add(aEff);
        var rDash = onTop(dashed([new T.Vector3(), new T.Vector3()], RED, 0.55));
        tilt.add(rDash);

        /* the latitude circle the bead is currently on, redrawn each frame */
        var RING = 60;
        var ringPos = new Float32Array((RING + 1) * 3);
        var ringGeo = new T.BufferGeometry();
        ringGeo.setAttribute('position', new T.BufferAttribute(ringPos, 3));
        tilt.add(new T.Line(ringGeo, new T.LineBasicMaterial({
          color: INDIGO, transparent: true, opacity: 0.34 })));

        /* g_eff as one bar, so "max at the pole" is a length, not a claim */
        var BX = -2.15, BY = -2.30, BW = 4.3;
        group.add(line([new T.Vector3(BX, BY - 0.16, 0), new T.Vector3(BX, BY + 0.16, 0)], INK, 0.30));
        group.add(line([new T.Vector3(BX, BY, 0), new T.Vector3(BX + BW, BY, 0)], INK, 0.16));
        var bar = new T.Mesh(new T.PlaneGeometry(1, 0.17),
          new T.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.72 }));
        group.add(bar);

        var lTh  = label('θ', '#f4f7fb', 0.36);
        var lMg  = label('mg', '#f4f7fb', 0.36);
        var lCen = label('mω²r', '#fb7185', 0.36);
        var lEff = label('g', '#f5c542', 0.36);
        onTop(lTh, 12); onTop(lMg, 12); onTop(lCen, 12); onTop(lEff, 12);
        tilt.add(lTh); tilt.add(lMg); tilt.add(lCen); tilt.add(lEff);
        var lBar = label('g at this latitude', '#f5c542', 0.30);
        group.add(lBar);
        lBar.position.set(BX + BW * 0.5, BY - 0.42, 0);

        var t1 = Date.now(), lw1 = w, lh1 = h;
        lfLoop(frame, function loop(){
          var nw = frame.clientWidth, nh = frame.clientHeight;
          if (!nw || !nh) return;
          if (nw !== lw1 || nh !== lh1){
            lw1 = nw; lh1 = nh;
            camera.aspect = nw / nh; fit(nw / nh); camera.updateProjectionMatrix();
            renderer.setSize(nw, nh);
          }
          var t = (Date.now() - t1) / 1000;
          spinG.rotation.y += 0.010;
          group.rotation.y = Math.sin(t / 10) * 0.09;

          /* the bead walks equator → pole → equator */
          var u = 0.5 - 0.5 * Math.cos(t * 0.26);
          var th = u * (Math.PI / 2) * 0.94;              /* latitude θ       */
          var ct = Math.cos(th), st = Math.sin(th);
          var P = new T.Vector3(Re * ct, Re * st, 0);
          bead.position.copy(P);

          /* mg points at the centre, always the same length. mω²r points away
             from the AXIS — horizontally, in the plane of the figure — and its
             length goes as r = R cos θ, so it dies at the pole. g_eff is the
             honest sum of the two, which is why it leans off the vertical
             everywhere except at the equator and the pole. The centrifugal term
             is drawn far larger than 0.34 % of g, or nothing would be visible;
             the bar underneath is the one that carries the real proportion. */
          var MG = 1.38, CEN = 0.68 * ct;
          var uMg = new T.Vector3(-P.x, -P.y, 0).normalize();
          var mgV  = uMg.clone().multiplyScalar(MG);
          var cenV = new T.Vector3(CEN, 0, 0);
          var effV = mgV.clone().add(cenV);
          aim(aMg,  P, new T.Vector3(P.x + mgV.x,  P.y + mgV.y,  0));
          aim(aCen, P, new T.Vector3(P.x + cenV.x, P.y + cenV.y, 0));
          aim(aEff, P, new T.Vector3(P.x + effV.x, P.y + effV.y, 0));
          var cen = CEN;

          var axP = rDash.geometry.getAttribute('position');
          axP.array[0] = 0;   axP.array[1] = P.y; axP.array[2] = 0;
          axP.array[3] = P.x; axP.array[4] = P.y; axP.array[5] = 0;
          axP.needsUpdate = true;
          rDash.computeLineDistances();

          for (var k = 0; k <= RING; k++){
            var ang = k / RING * Math.PI * 2;
            ringPos[k*3]   = Re * ct * Math.cos(ang);
            ringPos[k*3+1] = Re * st;
            ringPos[k*3+2] = Re * ct * Math.sin(ang);
          }
          ringGeo.getAttribute('position').needsUpdate = true;
          ringGeo.computeBoundingSphere();

          /* labels ride OFF their arrows, along the local perpendicular, so a
             three-vector junction never stacks three words on one point */
          var perp = new T.Vector3(-uMg.y, uMg.x, 0);
          lTh.position.set(P.x * 0.44 + perp.x * 0.34, P.y * 0.44 + perp.y * 0.34, 0.03);
          lMg.position.set(P.x + mgV.x * 0.60 - perp.x * 0.40,
                           P.y + mgV.y * 0.60 - perp.y * 0.40, 0.03);
          lCen.position.set(P.x + cen + 0.66, P.y + 0.30, 0.03);
          lCen.visible = cen > 0.12;
          lEff.position.set(P.x + effV.x * 0.70 + perp.x * 0.42,
                            P.y + effV.y * 0.70 + perp.y * 0.42, 0.03);

          /* the bar: g_eff = g − ω²R cos²θ, drawn from a suppressed zero so the
             0.34 % the earth actually manages is visible at all */
          var frac = 0.55 + 0.45 * (1 - ct * ct);
          bar.scale.set(BW * frac, 1, 1);
          bar.position.set(BX + BW * frac / 2, BY, 0);
          renderer.render(scene, camera);
        });
        lfOn(frame, 'resize', function(){});
        return;
      }

      /* -------------------------------------------------- oblate-earth ---- */
      var Rs = 1.45, FLAT = 0.16;                 /* exaggerated, and labelled so */
      var sph = new T.Group();
      group.add(sph);

      var trueEarth = new T.Mesh(new T.SphereGeometry(Rs, 34, 22),
        new T.MeshBasicMaterial({ color: 0x0d1020, transparent: true, opacity: 0.66 }));
      trueEarth.scale.set(1 + FLAT, 1 - FLAT * 0.72, 1 + FLAT);
      sph.add(trueEarth);
      var trueWire = sphere(Rs, INDIGO, 0.34, 22);
      trueWire.scale.set(1 + FLAT, 1 - FLAT * 0.72, 1 + FLAT);
      sph.add(trueWire);

      /* the perfect sphere it is NOT, on the same centre */
      var ideal = [];
      for (var q = 0; q <= 96; q++){
        var b = q / 96 * Math.PI * 2;
        ideal.push(new T.Vector3(Rs * Math.cos(b), Rs * Math.sin(b), 0));
      }
      group.add(dashed(ideal, INK, 0.40));

      group.add(line([new T.Vector3(0, -Rs * 1.45, 0), new T.Vector3(0, Rs * 1.45, 0)], INK, 0.30));

      /* the gap itself: equatorial radius against polar radius */
      var aEq = onTop(arrow(GOLD, 0.042)), aPo = onTop(arrow(GREEN, 0.042));
      group.add(aEq); group.add(aPo);
      aim(aEq, new T.Vector3(0, 0, 0), new T.Vector3(Rs * (1 + FLAT), 0, 0));
      aim(aPo, new T.Vector3(0, 0, 0), new T.Vector3(0, Rs * (1 - FLAT * 0.72), 0));
      group.add(dashed([new T.Vector3(Rs, 0.0, 0), new T.Vector3(Rs, -0.9, 0)], INK, 0.28));
      group.add(dashed([new T.Vector3(Rs * (1 + FLAT), 0.0, 0), new T.Vector3(Rs * (1 + FLAT), -0.9, 0)], INK, 0.28));
      var gap = new T.Mesh(new T.PlaneGeometry(Rs * FLAT, 0.05),
        new T.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.85 }));
      gap.position.set(Rs * (1 + FLAT / 2), -0.78, 0);
      group.add(gap);

      var lEq = label('equator', '#f5c542', 0.30);
      var lPo = label('pole', '#34d399', 0.30);
      var lGap = label('21 km more', '#f5c542', 0.30);
      onTop(lEq, 12); onTop(lPo, 12); onTop(lGap, 12);
      group.add(lEq); group.add(lPo); group.add(lGap);
      lEq.position.set(Rs * 0.62, 0.30, 0.02);
      lPo.position.set(-0.62, Rs * 0.92, 0.02);
      lGap.position.set(Rs * (1 + FLAT / 2) + 0.30, -1.16, 0.02);

      var t2s = Date.now(), lw2 = w, lh2 = h;
      lfLoop(frame, function loop(){
        var nw = frame.clientWidth, nh = frame.clientHeight;
        if (!nw || !nh) return;
        if (nw !== lw2 || nh !== lh2){
          lw2 = nw; lh2 = nh;
          camera.aspect = nw / nh; fit(nw / nh); camera.updateProjectionMatrix();
          renderer.setSize(nw, nh);
        }
        var t = (Date.now() - t2s) / 1000;
        sph.rotation.y += 0.006;
        group.rotation.y = Math.sin(t / 12) * 0.07;
        renderer.render(scene, camera);
      });
      lfOn(frame, 'resize', function(){});
    }

    /* ====================================================================
       Escape-speed scenes — the three boards the Escape Speed chapter needs
       and a still figure cannot carry.

       escape-speed     three bodies leave the same planet along three
                        different radii at 0.8 v_e, 1.0 v_e and 1.4 v_e. The
                        slow one turns round at n²R/(1−n²) and comes home,
                        the middle one crawls outward forever with its arrow
                        shrinking toward nothing, the fast one leaves with
                        v_inf = v_e√(n²−1) still on it. "Escape" is a
                        statement about what happens after the launch, so it
                        needs the launch.
       launch-direction the direction board: the SAME arrow length in every
                        direction out of one point — v_e does not care which
                        way you point — while the earth's own ωR is added to
                        the eastward one and is largest at the equator.
       angled-launch    a real Kepler arc from a launch at θ to the horizon:
                        the speed at the top is NOT zero, and r×v holds it to
                        v R cos θ = v_top (R + h).
       ==================================================================== */
    function startEscape(frame, w, h, kind){
      var GOLD = 0xf5c542, INDIGO = 0x7c8cff, GREEN = 0x34d399,
          RED = 0xfb7185, INK = 0xf4f7fb;

      var renderer = lfOwn(frame, new T.WebGLRenderer({ alpha: true, antialias: LF_AA, powerPreference: 'high-performance' }));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      frame.appendChild(renderer.domElement);
      frame.classList.add('is-live');

      var scene = new T.Scene();
      var camera = new T.PerspectiveCamera(40, w / h, 0.1, 200);
      camera.position.set(0, 0, 14);
      camera.lookAt(0, 0, 0);
      var HALF = (kind === 'escape-speed') ? 3.30 : (kind === 'angled-launch' ? 2.85 : 2.30);
      var WIDE = (kind === 'escape-speed') ? 3.70 : (kind === 'angled-launch' ? 3.40 : 3.05);
      function fit(aspect){
        var t2 = Math.tan((40 * Math.PI / 180) / 2);
        camera.position.z = Math.max(HALF / t2, WIDE / (t2 * aspect));
      }
      fit(w / h);

      var group = new T.Group();
      scene.add(group);

      function line(pts, color, opacity){
        return new T.Line(new T.BufferGeometry().setFromPoints(pts),
          new T.LineBasicMaterial({ color: color, transparent: true,
            opacity: opacity === undefined ? 1 : opacity }));
      }
      function dashed(pts, color, opacity){
        var l = line(pts, color, opacity);
        l.material.dispose();
        l.material = new T.LineDashedMaterial({ color: color, transparent: true,
          opacity: opacity === undefined ? 1 : opacity, dashSize: 0.11, gapSize: 0.09 });
        l.computeLineDistances();
        return l;
      }
      function arrow(color, rad){
        var g = new T.Group();
        var mat = new T.MeshBasicMaterial({ color: color });
        var shaft = new T.Mesh(new T.CylinderGeometry(rad, rad, 1, 12), mat);
        var head  = new T.Mesh(new T.ConeGeometry(rad * 3, rad * 7, 16), mat);
        g.add(shaft); g.add(head);
        g.userData = { shaft: shaft, head: head, rad: rad };
        return g;
      }
      function aim(g, from, to){
        var dir = new T.Vector3().subVectors(to, from), len = dir.length();
        if (len < 0.05){ g.visible = false; return; }
        g.visible = true;
        var hl = Math.min(g.userData.rad * 7, len * 0.44);
        var sl = Math.max(len - hl, 0.001);
        g.userData.shaft.scale.set(1, sl, 1);
        g.userData.shaft.position.set(0, sl / 2, 0);
        g.userData.head.scale.set(1, hl / (g.userData.rad * 7), 1);
        g.userData.head.position.set(0, sl + hl / 2, 0);
        g.position.copy(from);
        g.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
      }
      /* Auto-width: a fixed 512-wide canvas silently CLIPS anything longer than
         about seven characters, which is how a caption ends up reading
         "e v in every direc" on the board. Measure first, then size. */
      var LBL_FONT = 'bold 70px Calibri, Candara, "Segoe UI", sans-serif';
      function label(text, css, size){
        var c = document.createElement('canvas');
        var ctx = c.getContext('2d');
        ctx.font = LBL_FONT;
        var wpx = Math.max(96, Math.ceil(ctx.measureText(text).width) + 28);
        c.width = wpx; c.height = 128;
        ctx = c.getContext('2d');
        ctx.font = LBL_FONT;
        ctx.fillStyle = css; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, wpx / 2, 64);
        var tex = new T.CanvasTexture(c);
        tex.minFilter = T.LinearFilter;
        return new T.Mesh(new T.PlaneGeometry(size * (wpx / 128), size),
          new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      }
      function sphere(r, colour, opacity, seg){
        return new T.LineSegments(
          new T.WireframeGeometry(new T.SphereGeometry(r, seg || 22, Math.round((seg || 22) * 0.6))),
          new T.LineBasicMaterial({ color: colour, transparent: true, opacity: opacity }));
      }
      function planet(r, tone){
        var g = new T.Group();
        g.add(sphere(r, tone === undefined ? INDIGO : tone, 0.30, 22));
        g.add(new T.Mesh(new T.SphereGeometry(r * 0.995, 44, 28),
          new T.MeshBasicMaterial({ color: 0x0d1020, transparent: true, opacity: 0.62 })));
        return g;
      }
      /* The construction is ABOUT the bodies, not inside them — depth-testing
         an arrow against the globe buries it the moment the body swings
         behind. Figures are drawn on top unconditionally. */
      function onTop(obj, order){
        obj.renderOrder = order === undefined ? 10 : order;
        obj.traverse(function(n){
          if (!n.material) return;
          var ms = Array.isArray(n.material) ? n.material : [n.material];
          for (var i = 0; i < ms.length; i++){ ms[i].depthTest = false; ms[i].depthWrite = false; }
          n.renderOrder = obj.renderOrder;
        });
        return obj;
      }
      /* A trail that is rewritten in place — allocating a BufferGeometry per
         frame is what makes a classroom laptop drop to 8 fps. */
      function trail(colour, opacity, cap){
        var pos = new Float32Array(cap * 3);
        var geo = new T.BufferGeometry();
        geo.setAttribute('position', new T.BufferAttribute(pos, 3));
        geo.setDrawRange(0, 0);
        var l = new T.Line(geo, new T.LineBasicMaterial({ color: colour,
          transparent: true, opacity: opacity }));
        l.userData = { n: 0, cap: cap, pos: pos, geo: geo };
        l.userData.push = function(v){
          var u = l.userData;
          if (u.n >= u.cap) return;
          u.pos[u.n * 3] = v.x; u.pos[u.n * 3 + 1] = v.y; u.pos[u.n * 3 + 2] = v.z;
          u.n++;
          u.geo.setDrawRange(0, u.n);
          u.geo.attributes.position.needsUpdate = true;
          u.geo.computeBoundingSphere();
        };
        l.userData.clear = function(){
          l.userData.n = 0; geo.setDrawRange(0, 0);
        };
        return l;
      }

      /* ---------------------------------------------------- escape-speed --- */
      if (kind === 'escape-speed'){
        var R = 1.00;                         /* planet radius, in scene units */
        var CY = -1.50;                       /* it sits low; the sky is the board */
        var CAP = 3.00;                       /* how far out we can still see    */
        var home = new T.Vector3(0, CY, 0);

        var earth = planet(R);
        earth.position.copy(home);
        group.add(earth);
        /* one meridian set, so the planet reads as a body and not a disc */
        var mer = new T.Group();
        earth.add(mer);

        /* v_e = √(2GM/R). Work in units where GM = 1 and R is the radius
           above, so v_e = √(2/R) and v(r) = v_e √(n² − 1 + R/r) exactly.  */
        var MU = 1.0, VE = Math.sqrt(2 * MU / R);

        var RUNS = [
          { n: 0.80, colour: RED,   tag: '0.8 v', sub: 'e', deg:  32 },
          { n: 1.00, colour: GOLD,  tag: 'v',     sub: 'e', deg:   0 },
          { n: 1.40, colour: GREEN, tag: '1.4 v', sub: 'e', deg: -32 }
        ];
        var runs = [];
        for (var ri = 0; ri < RUNS.length; ri++){
          var spec = RUNS[ri];
          var a = spec.deg * Math.PI / 180;
          var dir = new T.Vector3(Math.sin(a), Math.cos(a), 0);
          var tr = trail(spec.colour, 0.55, 900);
          group.add(tr);
          var dot = onTop(new T.Mesh(new T.SphereGeometry(0.095, 14, 10),
            new T.MeshBasicMaterial({ color: spec.colour })), 11);
          group.add(dot);
          var arw = onTop(arrow(spec.colour, 0.044), 12);
          group.add(arw);
          var lab = label(spec.tag + (spec.sub ? 'ₑ' : ''),
            '#' + spec.colour.toString(16).padStart(6, '0'), 0.26);
          onTop(lab, 13); group.add(lab);
          /* the turning point of the slow one, drawn once and left standing —
             that ring IS the max-height formula n²R/(1−n²)                */
          var apo = null;
          if (spec.n < 1){
            var rmax = R / (1 - spec.n * spec.n);
            var pts = [];
            for (var k = -26; k <= 26; k++){
              var ang = a + k / 26 * 0.55;
              pts.push(new T.Vector3(home.x + rmax * Math.sin(ang),
                                     home.y + rmax * Math.cos(ang), 0));
            }
            apo = dashed(pts, spec.colour, 0.42);
            onTop(apo, 9); group.add(apo);
          }
          runs.push({ spec: spec, dir: dir, r: R, v: spec.n * VE, sign: 1,
                      tr: tr, dot: dot, arw: arw, lab: lab, apo: apo, done: false });
        }

        var caption = label('escape is what happens after the launch', '#8ea0b8', 0.22);
        onTop(caption, 13); group.add(caption);
        caption.position.set(0, CY - R - 0.42, 0.02);

        /* The planet sits low and the flight runs up the board, so the useful
           content is NOT centred on the origin. Shift the whole group instead
           of widening the camera, or the figure ends up a thumbnail in one
           corner of its own frame. */
        group.position.y = -((CY - R - 0.62) + (CY + CAP + 0.45)) / 2;
        HALF = ((CY + CAP + 0.45) - (CY - R - 0.62)) / 2 * 1.06;
        WIDE = (CAP * Math.sin(32 * Math.PI / 180) + 0.85) * 1.06;
        fit(w / h);

        function resetRuns(){
          for (var i = 0; i < runs.length; i++){
            var rr = runs[i];
            rr.r = R; rr.v = rr.spec.n * VE; rr.sign = 1; rr.done = false;
            rr.tr.userData.clear();
          }
        }

        var tPrev = Date.now(), holdFor = 0;
        lfLoop(frame, function loop(){
          var nw = frame.clientWidth, nh = frame.clientHeight;
          if (!nw || !nh) return;
          if (nw !== w || nh !== h){
            w = nw; h = nh;
            camera.aspect = nw / nh; fit(nw / nh); camera.updateProjectionMatrix();
            renderer.setSize(nw, nh);
          }
          var now = Date.now();
          var dt = Math.min((now - tPrev) / 1000, 0.05);
          tPrev = now;
          earth.rotation.y += 0.004;

          if (holdFor > 0){
            holdFor -= dt;
            if (holdFor <= 0) resetRuns();
          } else {
            var allDone = true;
            for (var i = 0; i < runs.length; i++){
              var rr = runs[i];
              if (!rr.done){
                allDone = false;
                /* energy integral, not a force step: v(r) is exact at every r
                   so the slow body turns round precisely at n²R/(1−n²)     */
                var k = rr.spec.n * rr.spec.n - 1 + R / rr.r;
                if (k <= 0){ rr.sign = -1; k = 1e-4; }
                rr.v = VE * Math.sqrt(k);
                rr.r += rr.sign * rr.v * dt * 0.20;
                if (rr.r <= R){ rr.r = R; rr.done = true; }
                if (rr.r >= CAP + 0.35){ rr.done = true; }
              }
              var p = new T.Vector3().copy(rr.dir).multiplyScalar(rr.r).add(home);
              rr.dot.position.copy(p);
              rr.dot.visible = rr.r <= CAP + 0.30;
              rr.tr.userData.push(p);
              /* the arrow IS the speed — it shrinks toward nothing on the
                 v_e run and settles on v_inf for the fast one            */
              var len = 0.16 + 0.66 * (rr.v / VE);
              aim(rr.arw, p, new T.Vector3().copy(rr.dir)
                .multiplyScalar(rr.sign > 0 ? len : -len).add(p));
              rr.arw.visible = rr.dot.visible;
              rr.lab.position.copy(new T.Vector3().copy(rr.dir)
                .multiplyScalar(Math.min(rr.r, CAP) + 0.34).add(home));
              rr.lab.position.z = 0.02;
              rr.lab.visible = rr.dot.visible;
            }
            if (allDone) holdFor = 1.6;
          }
          renderer.render(scene, camera);
        });
        lfOn(frame, 'resize', function(){});
        return;
      }

      /* ------------------------------------------------- launch-direction --- */
      if (kind === 'launch-direction'){
        var Rd = 1.05;
        var tilt = new T.Group();
        tilt.rotation.z = 0.22;
        group.add(tilt);
        var spin = new T.Group();
        tilt.add(spin);
        spin.add(planet(Rd));

        tilt.add(line([new T.Vector3(0, -Rd * 1.40, 0), new T.Vector3(0, Rd * 1.40, 0)], INK, 0.32));
        var eqp = [];
        for (var e = 0; e <= 80; e++){
          var ea = e / 80 * Math.PI * 2;
          eqp.push(new T.Vector3(Rd * Math.cos(ea), 0, Rd * Math.sin(ea)));
        }
        spin.add(line(eqp, GOLD, 0.30));

        /* The fan: ONE point, five directions, ONE length — v_e does not know
           which way the nose is pointing. It is drawn at the top of the globe
           and in the plane of the screen; a fan around the equator points its
           arrows straight down the lens and reads as a single blob. */
        var P = new T.Vector3(0, Rd, 0);
        var FAN = [-56, -28, 0, 28, 56];
        for (var f = 0; f < FAN.length; f++){
          var fa = FAN[f] * Math.PI / 180;
          var dirv = new T.Vector3(Math.sin(fa), Math.cos(fa), 0);
          var arw = onTop(arrow(INK, 0.034), 12);
          tilt.add(arw);
          aim(arw, P, new T.Vector3().copy(dirv).multiplyScalar(0.74).add(P));
        }
        var same = label('same vₑ every way', '#f4f7fb', 0.24);
        onTop(same, 13); tilt.add(same);
        same.position.set(0.05, Rd + 1.02, 0.02);

        /* The bonus the earth hands you: ωR, east, biggest at the equator */
        var eastA = onTop(arrow(GREEN, 0.046), 12); tilt.add(eastA);
        var westA = onTop(arrow(RED, 0.040), 12);   tilt.add(westA);
        aim(eastA, new T.Vector3(Rd * 0.02, 0, Rd), new T.Vector3(Rd * 0.80, 0, Rd));
        aim(westA, new T.Vector3(-Rd * 0.02, 0, Rd), new T.Vector3(-Rd * 0.52, 0, Rd));
        var lE = label('+ ωR  west → east', '#34d399', 0.24);
        var lW = label('− ωR', '#fb7185', 0.24);
        onTop(lE, 13); onTop(lW, 13); tilt.add(lE); tilt.add(lW);
        lE.position.set(Rd * 1.02, -0.34, Rd + 0.02);
        lW.position.set(-Rd * 0.72, -0.34, Rd + 0.02);

        /* the same bonus, at latitude — shorter, because r = R cos φ       */
        var latY = Rd * Math.sin(52 * Math.PI / 180),
            latR = Rd * Math.cos(52 * Math.PI / 180);
        var latA = onTop(arrow(GREEN, 0.030), 12); tilt.add(latA);
        aim(latA, new T.Vector3(0, latY, latR), new T.Vector3(latR * 0.62, latY, latR));


        var tls = Date.now();
        lfLoop(frame, function loop(){
          var nw = frame.clientWidth, nh = frame.clientHeight;
          if (!nw || !nh) return;
          if (nw !== w || nh !== h){
            w = nw; h = nh;
            camera.aspect = nw / nh; fit(nw / nh); camera.updateProjectionMatrix();
            renderer.setSize(nw, nh);
          }
          var t = (Date.now() - tls) / 1000;
          spin.rotation.y += 0.010;
          group.rotation.y = Math.sin(t / 11) * 0.06;
          renderer.render(scene, camera);
        });
        lfOn(frame, 'resize', function(){});
        return;
      }

      /* ------------------------------------------------------ kepler-areas ---
         Kepler's second law as the event it actually is. A real orbit —
         dν/dt = L/r² integrated every frame, never a constant sweep — so the
         body genuinely races through perihelion and genuinely crawls at
         aphelion. Two wedges of EQUAL AREA stand on the board, one at each
         end of the major axis: the near one short and fat, the far one long
         and thin. The one thing the source slide's two shaded triangles
         cannot carry is that the planet spends the SAME time inside each of
         them, which is the whole of the law — so a clock bar under each wedge
         fills while the body is inside it, and the two bars finish level.  */
      if (kind === 'kepler-areas'){
        var aK = 1.00, eK = 0.55, MUK = 1.0;
        var pK = aK * (1 - eK * eK);
        var LK = Math.sqrt(MUK * pK);                 /* per unit mass       */
        var TK = 2 * Math.PI * Math.sqrt(aK * aK * aK / MUK);
        function rK(nu){ return pK / (1 + eK * Math.cos(nu)); }
        var SCK = 1.45;                               /* scene units per a   */
        var CK  = new T.Vector3(0, 0.28, 0);          /* the sun, at a focus */
        function ptK(nu){
          var r = rK(nu) * SCK;
          return new T.Vector3(CK.x + r * Math.cos(nu), CK.y + r * Math.sin(nu), 0);
        }

        /* the orbit itself */
        var orbPts = [];
        for (var oi = 0; oi <= 220; oi++) orbPts.push(ptK(oi / 220 * Math.PI * 2));
        group.add(onTop(line(orbPts, INK, 0.42), 8));

        /* the sun */
        var sun = onTop(new T.Mesh(new T.SphereGeometry(0.115, 20, 14),
          new T.MeshBasicMaterial({ color: GOLD })), 11);
        sun.position.copy(CK); group.add(sun);
        group.add(onTop(dashed([ptK(0), ptK(Math.PI)], INK, 0.22), 8));

        /* Two wedges of the same area. Kepler's own construction: pick the
           same Δt at each apse and let the integrator say how far the body
           gets. Δν is solved by stepping the real rate, so the areas are
           equal by construction rather than by drawing them that way.     */
        /* Sweep HALF the interval each way from the apse, not the whole of it
           forward — a forward sweep re-centred on the apse is a different
           region and the two areas then differ by 60 %, which is the one
           thing this figure may not get wrong.                             */
        var DT = TK / 14;
        function halfSweep(nu0k){
          var nu = nu0k, t = 0, dtI = TK / 40000, half = DT / 2;
          while (t < half){ var rr0 = rK(nu); nu += (LK / (rr0 * rr0)) * dtI; t += dtI; }
          return nu - nu0k;
        }
        function wedge(nuA, nuB, colour, opacity){
          var verts = [], N = 40;
          for (var k = 0; k < N; k++){
            var n1 = nuA + (nuB - nuA) * k / N, n2 = nuA + (nuB - nuA) * (k + 1) / N;
            var p1 = ptK(n1), p2 = ptK(n2);
            verts.push(CK.x, CK.y, 0, p1.x, p1.y, 0, p2.x, p2.y, 0);
          }
          var g = new T.BufferGeometry();
          g.setAttribute('position', new T.BufferAttribute(new Float32Array(verts), 3));
          var m = new T.Mesh(g, new T.MeshBasicMaterial({ color: colour,
            transparent: true, opacity: opacity, side: T.DoubleSide }));
          return onTop(m, 7);
        }
        var halfNear = halfSweep(0), halfFar = halfSweep(Math.PI);
        var nearA = -halfNear, nearB = halfNear;              /* about ν = 0  */
        var farA = Math.PI - halfFar, farB = Math.PI + halfFar;

        var wNear = wedge(nearA, nearB, GOLD, 0.16);   group.add(wNear);
        var wFar  = wedge(farA,  farB,  INDIGO, 0.16); group.add(wFar);
        var wNearLit = wedge(nearA, nearB, GOLD, 0.42);   group.add(wNearLit);
        var wFarLit  = wedge(farA,  farB,  INDIGO, 0.42); group.add(wFarLit);
        wNearLit.visible = false; wFarLit.visible = false;

        var lNear = label('A', '#f5c542', 0.30);
        var lFar  = label('A', '#7c8cff', 0.30);
        onTop(lNear, 13); onTop(lFar, 13); group.add(lNear); group.add(lFar);
        var pN = ptK(0), pF = ptK(Math.PI);
        lNear.position.set(CK.x + (pN.x - CK.x) * 0.55, CK.y + (pN.y - CK.y) * 0.55 - 0.30, 0.02);
        lFar.position.set(CK.x + (pF.x - CK.x) * 0.52, CK.y + (pF.y - CK.y) * 0.52 + 0.32, 0.02);

        /* the two clock bars — same length when both are full */
        var BARW = 1.15, BARY = -1.42, BARH = 0.085;
        function bar(x0, colour, opacity){
          var m = new T.Mesh(new T.PlaneGeometry(1, BARH),
            new T.MeshBasicMaterial({ color: colour, transparent: true, opacity: opacity }));
          m.userData = { x0: x0 };
          return onTop(m, 9);
        }
        function setBar(m, frac){
          var wpx = Math.max(0.0001, BARW * frac);
          m.scale.set(wpx, 1, 1);
          m.position.set(m.userData.x0 + wpx / 2, BARY, 0.02);
        }
        var trackN = bar(-BARW - 0.10, INK, 0.16), trackF = bar(0.10, INK, 0.16);
        group.add(trackN); group.add(trackF); setBar(trackN, 1); setBar(trackF, 1);
        var fillN = bar(-BARW - 0.10, GOLD, 0.85), fillF = bar(0.10, INDIGO, 0.85);
        group.add(fillN); group.add(fillF); setBar(fillN, 0); setBar(fillF, 0);
        var lBar = label('same area  ⇒  same time', '#8ea0b8', 0.22);
        onTop(lBar, 13); group.add(lBar);
        lBar.position.set(0, BARY - 0.30, 0.02);

        var bodyK = onTop(new T.Mesh(new T.SphereGeometry(0.085, 16, 12),
          new T.MeshBasicMaterial({ color: INK })), 12);
        group.add(bodyK);
        var radK = onTop(line([CK, ptK(0)], INK, 0.55), 10);
        group.add(radK);

        /* Centre what is actually drawn. The sun sits at a focus, so the orbit
           is badly off-centre about it, and the clock bars hang below — a
           camera pointed at the origin puts the figure in one corner. */
        HALF = 1.85; WIDE = 2.05; fit(w / h);
        group.position.set(0.50, 0.13, 0);

        /* One lap in about 25 s of board time — slow enough that the crawl at
           aphelion reads as a crawl rather than as a stall.                 */
        var RATE = TK / 25;
        var nuK = nearA, tpK = Date.now(), tN = 0, tF = 0;
        lfLoop(frame, function loop(){
          var nw = frame.clientWidth, nh = frame.clientHeight;
          if (!nw || !nh) return;
          if (nw !== w || nh !== h){
            w = nw; h = nh;
            camera.aspect = nw / nh; fit(nw / nh); camera.updateProjectionMatrix();
            renderer.setSize(nw, nh);
          }
          var now = Date.now(), dt = Math.min((now - tpK) / 1000, 0.05); tpK = now;
          if (!inking()){
            var rr2 = rK(nuK);
            nuK += (LK / (rr2 * rr2)) * dt * RATE;
            if (nuK >= nearA + Math.PI * 2){
              nuK = nearA; tN = 0; tF = 0;               /* one clean lap    */
            }
            /* "inside the wedge" as an angular distance from the apse, so it
               cannot break where the anomaly wraps through 2π.             */
            function near(x, c){
              var d = (x - c) % (Math.PI * 2);
              if (d >  Math.PI) d -= Math.PI * 2;
              if (d < -Math.PI) d += Math.PI * 2;
              return Math.abs(d);
            }
            var inN = near(nuK, 0) <= halfNear;
            var inF = near(nuK, Math.PI) <= halfFar;
            if (inN) tN = Math.min(DT, tN + dt * RATE);
            if (inF) tF = Math.min(DT, tF + dt * RATE);
            wNearLit.visible = inN; wFarLit.visible = inF;
            setBar(fillN, tN / DT); setBar(fillF, tF / DT);
          }
          var P2 = ptK(nuK);
          bodyK.position.copy(P2);
          radK.geometry.setFromPoints([CK, P2]);
          radK.geometry.attributes.position.needsUpdate = true;
          renderer.render(scene, camera);
        });
        lfOn(frame, 'resize', function(){});
        return;
      }

      /* ------------------------------------------------------- kepler-t2a3 ---
         Kepler's third law, run rather than plotted. Three bodies on three
         circles of radius a, 1.6a and 2.5a, each turning at ω = √(GM/a³) —
         so the outer one visibly crawls and the ratio of the laps you can
         count on the board is exactly the ratio the formula gives. A T²–a³
         line plotted on a still slide asserts the relation; this is the
         relation happening.                                                */
      if (kind === 'kepler-t2a3'){
        var MU3 = 1.0;
        var RADII = [0.72, 1.15, 1.80];
        var TONE  = [GOLD, INDIGO, GREEN];
        var NAME  = ['a', '1.6 a', '2.5 a'];
        var star = onTop(new T.Mesh(new T.SphereGeometry(0.14, 20, 14),
          new T.MeshBasicMaterial({ color: GOLD })), 12);
        group.add(star);
        var bodies3 = [];
        for (var s3 = 0; s3 < RADII.length; s3++){
          var rr3 = RADII[s3], ring = [];
          for (var c3 = 0; c3 <= 140; c3++){
            var ca = c3 / 140 * Math.PI * 2;
            ring.push(new T.Vector3(rr3 * Math.cos(ca), rr3 * Math.sin(ca), 0));
          }
          group.add(onTop(line(ring, TONE[s3], 0.30), 8));
          var d3 = onTop(new T.Mesh(new T.SphereGeometry(0.085, 16, 12),
            new T.MeshBasicMaterial({ color: TONE[s3] })), 12);
          group.add(d3);
          var l3 = label(NAME[s3], '#' + TONE[s3].toString(16).padStart(6, '0'), 0.24);
          onTop(l3, 13); group.add(l3);
          l3.position.set(0, rr3 + 0.20, 0.02);
          bodies3.push({ r: rr3, w: Math.sqrt(MU3 / (rr3 * rr3 * rr3)), dot: d3, th: -Math.PI / 2 });
        }
        var l3c = label('ω = √(GM / a³)   ⇒   T² ∝ a³', '#8ea0b8', 0.22);
        onTop(l3c, 13); group.add(l3c);
        l3c.position.set(0, -2.16, 0.02);

        HALF = 2.35; WIDE = 2.60; fit(w / h);

        var tp3 = Date.now();
        lfLoop(frame, function loop(){
          var nw = frame.clientWidth, nh = frame.clientHeight;
          if (!nw || !nh) return;
          if (nw !== w || nh !== h){
            w = nw; h = nh;
            camera.aspect = nw / nh; fit(nw / nh); camera.updateProjectionMatrix();
            renderer.setSize(nw, nh);
          }
          var now3 = Date.now(), dt3 = Math.min((now3 - tp3) / 1000, 0.05); tp3 = now3;
          for (var b3 = 0; b3 < bodies3.length; b3++){
            var B = bodies3[b3];
            if (!inking()) B.th += B.w * dt3 * 0.42;
            B.dot.position.set(B.r * Math.cos(B.th), B.r * Math.sin(B.th), 0);
          }
          renderer.render(scene, camera);
        });
        lfOn(frame, 'resize', function(){});
        return;
      }

      /* ---------------------------------------------------- angled-launch --- */
      /* A real Kepler arc. GM = 1, R = 1 inside the maths; the scene is scaled
         to fit afterwards. Launch speed n·v_e at θ from the local horizontal.
         The two things the slide claims and a still figure cannot show: the
         speed at the top is not zero, and r×v holds it to v R cos θ.       */
      var Rp = 1.0, MU2 = 1.0, VE2 = Math.sqrt(2 * MU2 / Rp);
      var nLaunch = 0.80, thDeg = 42, th = thDeg * Math.PI / 180;
      var v0 = nLaunch * VE2;
      var L  = Rp * v0 * Math.cos(th);                 /* per unit mass       */
      var EN = v0 * v0 / 2 - MU2 / Rp;                 /* specific energy     */
      var aSemi = -MU2 / (2 * EN);
      var ecc = Math.sqrt(Math.max(0, 1 + 2 * EN * L * L / (MU2 * MU2)));
      var pSemi = L * L / MU2;
      function rOf(nu){ return pSemi / (1 + ecc * Math.cos(nu)); }
      /* true anomaly at launch (ascending branch) */
      var cosNu0 = (pSemi / Rp - 1) / ecc;
      cosNu0 = Math.max(-1, Math.min(1, cosNu0));
      var nu0 = -Math.acos(cosNu0);                    /* negative = climbing */
      var rApo = rOf(Math.PI), hMax = rApo - Rp;
      var vTop = L / rApo;

      var SC = 1.55 / Rp;                              /* scene units per R   */
      var focus = new T.Vector3(0, -1.05, 0);          /* planet centre       */
      /* the orbit is drawn in a frame where periapsis is along +x; rotate it
         so the launch point sits on the left shoulder of the globe          */
      var ROT = 2.15;
      function pointAt(nu){
        var r = rOf(nu);
        var x = r * Math.cos(nu), y = r * Math.sin(nu);
        var c = Math.cos(ROT), s = Math.sin(ROT);
        return new T.Vector3(focus.x + (x * c - y * s) * SC,
                             focus.y + (x * s + y * c) * SC, 0);
      }
      function velAt(nu){
        /* dr/dnu and r dnu/dt give the velocity direction without a solver  */
        var r = rOf(nu);
        var vr = MU2 / L * ecc * Math.sin(nu);
        var vt = L / r;
        var ur = new T.Vector3(Math.cos(nu), Math.sin(nu), 0);
        var ut = new T.Vector3(-Math.sin(nu), Math.cos(nu), 0);
        var v = new T.Vector3().copy(ur).multiplyScalar(vr)
          .add(new T.Vector3().copy(ut).multiplyScalar(vt));
        var c = Math.cos(ROT), s = Math.sin(ROT);
        return { dir: new T.Vector3(v.x * c - v.y * s, v.x * s + v.y * c, 0).normalize(),
                 mag: v.length() };
      }

      var pl = planet(Rp * SC, INDIGO);
      pl.children[0].material.opacity = 0.18;      /* the globe is context here */
      pl.position.copy(focus);
      group.add(pl);

      var arcPts = [];
      for (var q = 0; q <= 160; q++){
        arcPts.push(pointAt(nu0 + (Math.PI - nu0) * q / 160));
      }
      group.add(onTop(line(arcPts, INDIGO, 0.40), 8));

      /* Frame what is drawn. The apogee of a real Kepler arc is 2.3 R out and
         off to one side, so a camera centred on the origin buries the whole
         figure behind the planet. Fit the arc's own bounding box. */
      var bx0 = focus.x - Rp * SC, bx1 = focus.x + Rp * SC,
          by0 = focus.y - Rp * SC, by1 = focus.y + Rp * SC;
      for (var bi = 0; bi < arcPts.length; bi++){
        bx0 = Math.min(bx0, arcPts[bi].x); bx1 = Math.max(bx1, arcPts[bi].x);
        by0 = Math.min(by0, arcPts[bi].y); by1 = Math.max(by1, arcPts[bi].y);
      }
      by0 -= 0.52;                                   /* room for the caption */
      group.position.set(-(bx0 + bx1) / 2, -(by0 + by1) / 2, 0);
      HALF = (by1 - by0) / 2 * 1.08;
      WIDE = (bx1 - bx0) / 2 * 1.08;
      fit(w / h);

      var P0 = pointAt(nu0), PA = pointAt(Math.PI);
      /* the two radii the angular-momentum line is written about */
      group.add(onTop(dashed([focus, P0], INK, 0.28), 8));
      group.add(onTop(dashed([focus, PA], INK, 0.28), 8));
      /* the local horizontal at the launch point — θ is measured from it */
      var outward = new T.Vector3().subVectors(P0, focus).normalize();
      var horiz = new T.Vector3(-outward.y, outward.x, 0);
      group.add(onTop(dashed([new T.Vector3().copy(P0).addScaledVector(horiz, -0.42),
                              new T.Vector3().copy(P0).addScaledVector(horiz, 0.62)], INK, 0.34), 8));

      var body = onTop(new T.Mesh(new T.SphereGeometry(0.075, 14, 10),
        new T.MeshBasicMaterial({ color: GOLD })), 11);
      group.add(body);
      var vArw = onTop(arrow(GOLD, 0.038), 12); group.add(vArw);
      var tTrail = trail(GOLD, 0.5, 700); group.add(tTrail);

      var lTh = label('θ', '#f4f7fb', 0.26);
      var lV  = label('v', '#f5c542', 0.26);
      var lTop = label('v_top ≠ 0', '#34d399', 0.26);
      var lH  = label('h', '#7c8cff', 0.24);
      var lCons = label('v R cos θ  =  v_top (R + h)', '#8ea0b8', 0.24);
      onTop(lTh, 13); onTop(lV, 13); onTop(lTop, 13); onTop(lH, 13); onTop(lCons, 13);
      group.add(lTh); group.add(lV); group.add(lTop); group.add(lH); group.add(lCons);
      lTh.position.set(P0.x + horiz.x * 0.34 + outward.x * 0.30,
                       P0.y + horiz.y * 0.34 + outward.y * 0.30, 0.02);
      lTop.position.set(PA.x + 0.62, PA.y + 0.20, 0.02);
      lH.position.set((PA.x + focus.x) / 2 - 0.28, (PA.y + focus.y) / 2, 0.02);
      lCons.position.set((bx0 + bx1) / 2, by0 + 0.26, 0.02);

      var vTopArw = onTop(arrow(GREEN, 0.038), 12); group.add(vTopArw);
      var vt0 = velAt(Math.PI);
      aim(vTopArw, PA, new T.Vector3().copy(vt0.dir)
        .multiplyScalar(0.16 + 0.52 * (vt0.mag / v0)).add(PA));

      var nu = nu0, tp = Date.now(), pause = 0;
      lfLoop(frame, function loop(){
        var nw = frame.clientWidth, nh = frame.clientHeight;
        if (!nw || !nh) return;
        if (nw !== w || nh !== h){
          w = nw; h = nh;
          camera.aspect = nw / nh; fit(nw / nh); camera.updateProjectionMatrix();
          renderer.setSize(nw, nh);
        }
        var now = Date.now(), dt = Math.min((now - tp) / 1000, 0.05); tp = now;
        if (pause > 0){
          pause -= dt;
          if (pause <= 0){ nu = nu0; tTrail.userData.clear(); }
        } else {
          /* dnu/dt = L / r² — the real thing, so it crawls at the top      */
          var r = rOf(nu);
          nu += (L / (r * r)) * dt * 0.55;
          if (nu >= Math.PI){ nu = Math.PI; pause = 1.5; }
        }
        var P = pointAt(nu);
        body.position.copy(P);
        tTrail.userData.push(P);
        var vv = velAt(nu);
        aim(vArw, P, new T.Vector3().copy(vv.dir)
          .multiplyScalar(0.14 + 0.52 * (vv.mag / v0)).add(P));
        lV.position.set(P.x + vv.dir.x * 0.62 + 0.10, P.y + vv.dir.y * 0.62 + 0.14, 0.02);
        group.rotation.y = 0;
        renderer.render(scene, camera);
      });
      lfOn(frame, 'resize', function(){});
    }


    /* ══════════════════════════ satellite scenes ══════════════════════════
       Three WebGL figures for the "Satellite" board. Each exists only because
       the still figure on the source slide cannot carry the thing the slide is
       actually claiming:

         satellite-orbit  the answer to "why doesn't it fall". The pull is
                          always at the centre and the speed is always across
                          it, so the body never gets any nearer — drawn as
                          Newton's own construction: the straight line the
                          satellite WOULD travel in the next instant, and the
                          little green fall from the end of it back onto the
                          orbit. A still arrow-pair asserts "it is falling";
                          this shows the fall, and shows it never arriving.
         geo-vs-polar     the two satellite types side by side on two earths
                          turning at the SAME rate: the polar one crosses both
                          poles many times while the earth turns once, the
                          geostationary one hangs over one marked point and
                          rides round with it. "Appears stationary" is a
                          statement about two motions matching, so it needs
                          both motions.
         coverage-cap     the coverage board: as the satellite is walked out
                          from the surface, the tangent lines slide round, the
                          max latitude theta opens, and the spherical cap it
                          can see grows with it. cos(theta) = R/d becomes a
                          thing that happens rather than a formula.

       Geometry and axis names only — no lesson text lives in the canvas, every
       frame ships a .scene-fallback carrying the same figure flat, and that is
       what prints and what a room with no WebGL sees (rules 11, 20).         */
    function startSatellite(frame, w, h, kind){
      var GOLD = 0xf5c542, INDIGO = 0x7c8cff, GREEN = 0x34d399, INK = 0xf4f7fb;

      var renderer = lfOwn(frame, new T.WebGLRenderer({ alpha: true, antialias: LF_AA, powerPreference: 'high-performance' }));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      frame.appendChild(renderer.domElement);
      frame.classList.add('is-live');

      var scene = new T.Scene();
      var camera = new T.PerspectiveCamera(40, w / h, 0.1, 100);
      camera.position.set(0, 0, 12);
      camera.lookAt(0, 0, 0);
      var HALF = (kind === 'geo-vs-polar') ? 1.78 : (kind === 'coverage-cap' ? 1.32 : 2.72);
      var WIDE = (kind === 'geo-vs-polar') ? 4.25 : (kind === 'coverage-cap' ? 2.45 : 3.05);
      function fit(aspect){
        var t2 = Math.tan((40 * Math.PI / 180) / 2);
        camera.position.z = Math.max(HALF / t2, WIDE / (t2 * aspect));
      }
      fit(w / h);

      var group = new T.Group();
      scene.add(group);

      function line(pts, color, opacity){
        return new T.Line(new T.BufferGeometry().setFromPoints(pts),
          new T.LineBasicMaterial({ color: color, transparent: true,
            opacity: opacity === undefined ? 1 : opacity }));
      }
      function dashed(pts, color, opacity, dash){
        var l = line(pts, color, opacity);
        l.material.dispose();
        l.material = new T.LineDashedMaterial({ color: color, transparent: true,
          opacity: opacity === undefined ? 1 : opacity,
          dashSize: dash || 0.12, gapSize: (dash || 0.12) * 0.8 });
        l.computeLineDistances();
        return l;
      }
      function ring(radius, color, opacity, seg){
        var pts = [], n = seg || 128, i;
        for (i = 0; i <= n; i++){
          var a = (i / n) * Math.PI * 2;
          pts.push(new T.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0));
        }
        return dashed(pts, color, opacity, 0.09);
      }
      function arrow(color, rad){
        var g = new T.Group();
        var mat = new T.MeshBasicMaterial({ color: color });
        var shaft = new T.Mesh(new T.CylinderGeometry(rad, rad, 1, 12), mat);
        var head  = new T.Mesh(new T.ConeGeometry(rad * 3, rad * 7, 16), mat);
        g.add(shaft); g.add(head);
        g.userData = { shaft: shaft, head: head, rad: rad };
        return g;
      }
      function aim(g, from, to){
        var dir = new T.Vector3().subVectors(to, from), len = dir.length();
        if (len < 0.06){ g.visible = false; return; }
        g.visible = true;
        var hl = Math.min(g.userData.rad * 7, len * 0.44);
        var sl = Math.max(len - hl, 0.001);
        g.userData.shaft.scale.set(1, sl, 1);
        g.userData.shaft.position.set(0, sl / 2, 0);
        g.userData.head.scale.set(1, hl / (g.userData.rad * 7), 1);
        g.userData.head.position.set(0, sl + hl / 2, 0);
        g.position.copy(from);
        g.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.normalize());
      }
      function label(text, css, size){
        var c = document.createElement('canvas');
        c.width = 512; c.height = 128;
        var ctx = c.getContext('2d');
        ctx.font = 'bold 74px Calibri, Candara, "Segoe UI", sans-serif';
        ctx.fillStyle = css; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, 256, 64);
        var tex = new T.CanvasTexture(c);
        tex.minFilter = T.LinearFilter;
        return new T.Mesh(new T.PlaneGeometry(size * 4, size),
          new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      }
      function globe(r, colour, opacity, seg){
        var g = new T.Group();
        g.add(new T.LineSegments(
          new T.WireframeGeometry(new T.SphereGeometry(r, seg || 20, Math.round((seg || 20) * 0.6))),
          new T.LineBasicMaterial({ color: colour, transparent: true, opacity: opacity })));
        g.add(new T.Mesh(new T.SphereGeometry(r * 0.994, 40, 26),
          new T.MeshBasicMaterial({ color: 0x0d1020, transparent: true, opacity: 0.72 })));
        return g;
      }
      /* The construction is ABOUT the body, not inside it: depth-testing the
         arrows against the sphere buries half of every one of them the moment
         the satellite swings behind. This is a figure, not a rendering. */
      function onTop(obj, order){
        obj.renderOrder = order === undefined ? 10 : order;
        obj.traverse(function(n){
          if (!n.material) return;
          var ms = Array.isArray(n.material) ? n.material : [n.material];
          for (var i = 0; i < ms.length; i++){ ms[i].depthTest = false; ms[i].depthWrite = false; }
          n.renderOrder = obj.renderOrder;
        });
        return obj;
      }
      function resized(){
        var nw = frame.clientWidth, nh = frame.clientHeight;
        if (!nw || !nh) return false;
        if (nw !== w || nh !== h){
          w = nw; h = nh;
          camera.aspect = nw / nh; fit(nw / nh); camera.updateProjectionMatrix();
          renderer.setSize(nw, nh);
        }
        return true;
      }

      /* -------------------------------------------- satellite-orbit ------ */
      if (kind === 'satellite-orbit'){
        var R = 1.24, RO = 2.02, DPHI = 0.50;
        var earth = globe(R, INDIGO, 0.30, 22);
        group.add(earth);
        group.add(ring(RO, INK, 0.26));

        var sat = onTop(new T.Mesh(new T.SphereGeometry(0.075, 14, 10),
          new T.MeshBasicMaterial({ color: GOLD })));
        group.add(sat);

        var vArw = onTop(arrow(GOLD, 0.036));   group.add(vArw);
        var fArw = onTop(arrow(INDIGO, 0.036)); group.add(fArw);
        var dropArw = onTop(arrow(GREEN, 0.028)); group.add(dropArw);

        /* the straight line it would have travelled — rebuilt every frame,
           because it is a claim about THIS instant, not a fixed decoration  */
        var straight = onTop(dashed([new T.Vector3(), new T.Vector3()], INK, 0.80, 0.14), 9);
        group.add(straight);

        var lv = label('v', '#f5c542', 0.44);
        var lf = label('F', '#a8b4ff', 0.44);
        onTop(lv, 12); onTop(lf, 12);
        group.add(lv); group.add(lf);

        var t0 = Date.now();
        lfLoop(frame, function loop(){
          if (!resized()) return;
          var t = (Date.now() - t0) / 1000;
          earth.rotation.y += 0.004;
          group.rotation.y = Math.sin(t / 11) * 0.06;

          var phi = t * 0.42;
          var cp = Math.cos(phi), sp = Math.sin(phi);
          var P = new T.Vector3(cp * RO, sp * RO, 0);
          var tan = new T.Vector3(-sp, cp, 0);            /* direction of v   */
          var inw = new T.Vector3(-cp, -sp, 0);           /* direction of F   */
          sat.position.copy(P);

          aim(vArw, P, new T.Vector3().copy(tan).multiplyScalar(0.62).add(P));
          aim(fArw, P, new T.Vector3().copy(inw).multiplyScalar(0.62).add(P));
          lv.position.set(P.x + tan.x * 0.52 + inw.x * -0.34,
                          P.y + tan.y * 0.52 + inw.y * -0.34, 0.02);
          lf.position.set(P.x + inw.x * 0.80 + tan.x * -0.26,
                          P.y + inw.y * 0.80 + tan.y * -0.26, 0.02);

          /* S = where the tangent meets the radius one DPHI further round;
             Q = where the orbit actually is then. S -> Q is the fall.       */
          var S = new T.Vector3().copy(tan).multiplyScalar(RO * Math.tan(DPHI)).add(P);
          var Q = new T.Vector3(Math.cos(phi + DPHI) * RO, Math.sin(phi + DPHI) * RO, 0);
          straight.geometry.setFromPoints([P, S]);
          straight.computeLineDistances();
          aim(dropArw, S, Q);

          renderer.render(scene, camera);
        });
        lfOn(frame, 'resize', function(){});
        return;
      }

      /* ------------------------------------------------ geo-vs-polar ----- */
      if (kind === 'geo-vs-polar'){
        var Rp = 0.82, XL = -2.15, XR = 2.15;

        /* left — polar: the orbit plane contains the spin axis            */
        var lHub = new T.Group(); lHub.position.x = XL; lHub.rotation.x = -0.50; group.add(lHub);
        var lSpin = globe(Rp, INDIGO, 0.28, 22); lHub.add(lSpin);
        var polarRing = ring(1.45, INK, 0.34); lHub.add(polarRing);
        var pAxis = line([new T.Vector3(0, -1.32, 0), new T.Vector3(0, 1.32, 0)], INK, 0.22);
        lHub.add(pAxis);
        var pSat = onTop(new T.Mesh(new T.SphereGeometry(0.075, 14, 10),
          new T.MeshBasicMaterial({ color: GOLD })));
        lHub.add(pSat);

        /* right — geostationary: equatorial ring, and one marked point on
           the surface that the satellite never leaves the sky above        */
        var rHub = new T.Group(); rHub.position.x = XR; rHub.rotation.x = -0.50; group.add(rHub);
        var rSpin = globe(Rp, INDIGO, 0.28, 22); rHub.add(rSpin);
        var eqRing = ring(1.85, INK, 0.34);
        eqRing.rotation.x = Math.PI / 2;                 /* into the equator */
        rHub.add(eqRing);
        var rAxis = line([new T.Vector3(0, -1.32, 0), new T.Vector3(0, 1.32, 0)], INK, 0.22);
        rHub.add(rAxis);
        var gSat = onTop(new T.Mesh(new T.SphereGeometry(0.075, 14, 10),
          new T.MeshBasicMaterial({ color: GOLD })));
        rHub.add(gSat);
        var city = onTop(new T.Mesh(new T.SphereGeometry(0.062, 12, 10),
          new T.MeshBasicMaterial({ color: GREEN })));
        rHub.add(city);
        var tether = onTop(line([new T.Vector3(), new T.Vector3()], GREEN, 0.80), 9);
        rHub.add(tether);

        var lPolar = label('Polar', '#f4f7fb', 0.34);
        var lGeo   = label('Geostationary', '#f4f7fb', 0.34);
        onTop(lPolar, 12); onTop(lGeo, 12);
        lPolar.position.set(XL, 1.48, 0.04);
        lGeo.position.set(XR, 1.48, 0.04);
        group.add(lPolar); group.add(lGeo);

        var t1 = Date.now();
        lfLoop(frame, function loop(){
          if (!resized()) return;
          var t = (Date.now() - t1) / 1000;
          var day = t * 0.42;                     /* both earths, one rate   */
          lSpin.rotation.y = day;
          rSpin.rotation.y = day;
          group.rotation.y = Math.sin(t / 13) * 0.05;

          /* polar satellite: many turns per day, over both poles            */
          var a = t * 2.2;
          pSat.position.set(Math.sin(a) * 1.45, Math.cos(a) * 1.45, 0);

          /* geostationary: the same angle as the ground point, always       */
          var g = day;
          city.position.set(Math.cos(g) * Rp, 0, -Math.sin(g) * Rp);
          gSat.position.set(Math.cos(g) * 1.85, 0, -Math.sin(g) * 1.85);
          tether.geometry.setFromPoints([city.position, gSat.position]);

          renderer.render(scene, camera);
        });
        lfOn(frame, 'resize', function(){});
        return;
      }

      /* ------------------------------------------------- coverage-cap ---- */
      if (kind === 'coverage-cap'){
        var Rc = 1.00;
        group.position.x = -1.05;            /* the figure lives 0..3.2 in x */
        var earthC = globe(Rc, INDIGO, 0.26, 24);
        group.add(earthC);

        /* the visible cap, a spherical zone cut at the tangent latitude     */
        var capMat = new T.MeshBasicMaterial({ color: GOLD, transparent: true,
          opacity: 0.30, side: T.DoubleSide, depthWrite: false });
        var cap = new T.Mesh(new T.SphereGeometry(Rc * 1.004, 48, 32, 0, Math.PI * 2, 0, 0.6), capMat);
        cap.rotation.z = -Math.PI / 2;              /* pole of the cap -> +x  */
        group.add(cap);
        var rim = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3()]),
          new T.LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.85 }));
        group.add(rim);

        var satC = onTop(new T.Mesh(new T.SphereGeometry(0.062, 14, 10),
          new T.MeshBasicMaterial({ color: GOLD })));
        group.add(satC);

        var ray1 = onTop(line([new T.Vector3(), new T.Vector3()], INK, 0.70), 9);
        var ray2 = onTop(line([new T.Vector3(), new T.Vector3()], INK, 0.70), 9);
        group.add(ray1); group.add(ray2);
        var radius = onTop(line([new T.Vector3(), new T.Vector3()], GOLD, 0.85), 9);
        group.add(radius);
        var dLine = onTop(dashed([new T.Vector3(), new T.Vector3()], INK, 0.45, 0.10), 9);
        group.add(dLine);
        var arc = onTop(line([new T.Vector3()], GREEN, 0.85), 9);
        group.add(arc);

        var lR = label('R', '#f5c542', 0.36);
        var lD = label('d', '#f4f7fb', 0.36);
        var lTh = label('θ', '#34d399', 0.36);
        onTop(lR, 12); onTop(lD, 12); onTop(lTh, 12);
        group.add(lR); group.add(lD); group.add(lTh);

        var t2s = Date.now();
        lfLoop(frame, function loop(){
          if (!resized()) return;
          var t = (Date.now() - t2s) / 1000;
          earthC.rotation.y += 0.003;
          group.rotation.y = Math.sin(t / 12) * 0.14;

          var u = 0.5 - 0.5 * Math.cos(t * 0.34);
          var d = 1.36 + u * 1.72;                     /* the satellite walks out */
          var th = Math.acos(Rc / d);                  /* cos(theta) = R / d      */

          var S = new T.Vector3(d, 0, 0);
          satC.position.copy(S);
          var Tp = new T.Vector3(Math.cos(th) * Rc,  Math.sin(th) * Rc, 0);
          var Tm = new T.Vector3(Math.cos(th) * Rc, -Math.sin(th) * Rc, 0);
          ray1.geometry.setFromPoints([S, Tp]);
          ray2.geometry.setFromPoints([S, Tm]);
          radius.geometry.setFromPoints([new T.Vector3(0, 0, 0), Tp]);
          dLine.geometry.setFromPoints([new T.Vector3(0, 0, 0), S]);
          dLine.computeLineDistances();

          /* the cap itself: half-angle theta about the +x axis              */
          cap.geometry.dispose();
          cap.geometry = new T.SphereGeometry(Rc * 1.004, 48, 32, 0, Math.PI * 2, 0, th);
          var rimPts = [], i, n = 72;
          for (i = 0; i <= n; i++){
            var a2 = (i / n) * Math.PI * 2;
            rimPts.push(new T.Vector3(Math.cos(th) * Rc,
              Math.sin(th) * Rc * Math.cos(a2), Math.sin(th) * Rc * Math.sin(a2)));
          }
          rim.geometry.setFromPoints(rimPts);

          var arcPts = [];
          for (i = 0; i <= 24; i++){
            var a3 = (i / 24) * th;
            arcPts.push(new T.Vector3(Math.cos(a3) * 0.42, Math.sin(a3) * 0.42, 0));
          }
          arc.geometry.setFromPoints(arcPts);

          lR.position.set(Tp.x * 0.52 - 0.10, Tp.y * 0.52 + 0.16, 0.02);
          lD.position.set(d * 0.55, -0.20, 0.02);
          lTh.position.set(Math.cos(th / 2) * 0.60, Math.sin(th / 2) * 0.60, 0.02);

          renderer.render(scene, camera);
        });
        lfOn(frame, 'resize', function(){});
        return;
      }
    }

    /* ---------------------------------------------------- fluid scenes ------
       Two scenes for the pressure / density board, each carrying the one thing
       its source slide asserts and a still figure cannot show.

         pressure-depth     a probe walks down a standing column. Its four
                            arrows — up, down and both sides — grow TOGETHER
                            and stay equal, while the bar underneath fills in
                            step with the depth line. So the class watches two
                            facts arrive at once: pressure at a point pushes the
                            same in every direction, and its size is ρgh. A
                            still figure can draw either one; it cannot show
                            that they are the same picture.

         curved-projected   the "use projected area" slide, run. Uniform
                            pressure lands normal to a curved surface, so its
                            arrows fan; the surface then flattens into its own
                            projection and the arrows come round to parallel —
                            and the resultant arrow underneath NEVER CHANGES
                            LENGTH through the whole morph. The slide asserts
                            that the answer is P × (projected area); this is
                            that assertion happening.

       Both ship a .scene-fallback that prints (rules 11, 20).                */
    function startFluid(frame, w, h, kind){
      var GOLD = 0xf5c542, INDIGO = 0x7c8cff, CYAN = 0x56ccf2, INK = 0xf4f7fb;

      var renderer = lfOwn(frame, new T.WebGLRenderer({ alpha: true, antialias: LF_AA, powerPreference: 'high-performance' }));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      frame.appendChild(renderer.domElement);
      frame.classList.add('is-live');

      var scene = new T.Scene();
      var camera = new T.PerspectiveCamera(40, w / h, 0.1, 100);
      camera.position.set(0, 0, 9);
      camera.lookAt(0, 0, 0);

      var HALF_H = kind === 'curved-projected' ? 1.72 : 2.30;
      var HALF_W = kind === 'curved-projected' ? 3.30 : 2.60;
      var t2 = Math.tan((40 * Math.PI / 180) / 2);
      function fit(aspect){
        camera.position.z = Math.max(HALF_H / t2, HALF_W / (t2 * aspect));
      }
      fit(w / h);

      var world = new T.Group();
      scene.add(world);

      function line(pts, color, opacity){
        return new T.Line(new T.BufferGeometry().setFromPoints(pts),
          new T.LineBasicMaterial({ color: color, transparent: true,
            opacity: opacity === undefined ? 1 : opacity }));
      }
      function label(text, css, size, px){
        var c = document.createElement('canvas');
        c.width = 256; c.height = 128;
        var ctx = c.getContext('2d');
        ctx.font = 'bold ' + (px || 58) + 'px Calibri, Candara, "Segoe UI", sans-serif';
        ctx.fillStyle = css; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, 128, 64);
        var tex = new T.CanvasTexture(c);
        tex.minFilter = T.LinearFilter;
        var m = new T.Mesh(new T.PlaneGeometry(size * 2, size),
          new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
        m.userData.redraw = function(next){
          ctx.clearRect(0, 0, 256, 128);
          ctx.fillText(next, 128, 64);
          tex.needsUpdate = true;
        };
        return m;
      }
      /* One arrow, re-aimed every frame from an origin, a direction and a
         length. Same rig every other 2D scene in this file uses: a cylinder
         shaft and a cone head, both pointing +y, turned onto the direction by
         a quaternion — so the head always sits ON the tip whatever the angle. */
      function arrow(color, opacity, rad){
        var g = new T.Group(), r = rad || 0.030;
        var mat = new T.MeshBasicMaterial({ color: color, transparent: true,
          opacity: opacity === undefined ? 1 : opacity });
        var shaft = new T.Mesh(new T.CylinderGeometry(r, r, 1, 10), mat);
        var head  = new T.Mesh(new T.ConeGeometry(r * 3, r * 7, 14), mat);
        g.add(shaft); g.add(head);
        g.userData.set = function(ox, oy, dx, dy, len){
          if (len < 0.04){ g.visible = false; return; }
          g.visible = true;
          var d = new T.Vector3(dx, dy, 0);
          d.normalize();
          var hl = Math.min(r * 7, len * 0.45);
          var sl = Math.max(len - hl, 0.001);
          shaft.scale.set(1, sl, 1);           shaft.position.set(0, sl / 2, 0);
          head.scale.set(1, hl / (r * 7), 1);  head.position.set(0, sl + hl / 2, 0);
          g.position.set(ox, oy, 0.01);
          g.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d);
        };
        return g;
      }

      /* ═══ pressure at a point, walked down the column ═══════════════════ */
      if (kind === 'pressure-depth'){
        var LEFT = -1.55, RIGHT = 1.55, TOP = 1.35, FLOOR = -1.55;

        /* the vessel — scaffolding, drawn once */
        world.add(line([new T.Vector3(LEFT, TOP + 0.42, 0), new T.Vector3(LEFT, FLOOR, 0),
                        new T.Vector3(RIGHT, FLOOR, 0), new T.Vector3(RIGHT, TOP + 0.42, 0)], INK, 0.55));

        /* the liquid, and the free surface on top of it */
        var body = new T.Mesh(new T.PlaneGeometry(RIGHT - LEFT, TOP - FLOOR),
          new T.MeshBasicMaterial({ color: INDIGO, transparent: true, opacity: 0.13 }));
        body.position.set(0, (TOP + FLOOR) / 2, -0.02);
        world.add(body);
        var surf = line([new T.Vector3(LEFT, TOP, 0), new T.Vector3(RIGHT, TOP, 0)], INDIGO, 0.62);
        world.add(surf);

        /* the wall's own normal arrows: square-on, longer the deeper they are.
           At rest — they describe a standing column. */
        var wall = [];
        for (var wi = 0; wi < 4; wi++){
          var wy = TOP - (wi + 1) * (TOP - FLOOR) / 4.6;
          var wl = 0.22 + (TOP - wy) * 0.42;
          var wa = arrow(GOLD, 0.34);
          wa.userData.set(RIGHT, wy, 1, 0, wl);
          world.add(wa);
          wall.push(wa);
        }

        /* the depth line, and the probe that walks down it */
        var hLine = line([new T.Vector3(LEFT + 0.30, TOP, 0),
                          new T.Vector3(LEFT + 0.30, TOP, 0)], CYAN, 0.55);
        world.add(hLine);
        var hLab = label('h', '#56ccf2', 0.44, 54);
        world.add(hLab);

        var probe = new T.Mesh(new T.CircleGeometry(0.11, 22),
          new T.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.95 }));
        world.add(probe);
        var halo = new T.Mesh(new T.CircleGeometry(0.22, 22),
          new T.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.16 }));
        world.add(halo);

        /* four arrows out of the probe. They are always the same length as each
           other — that equality IS the fact. */
        var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        var spokes = DIRS.map(function(){
          var a = arrow(GOLD, 0.9); world.add(a); return a;
        });

        /* the bar: P read off as a length, so "grows with depth" is visible
           without a number the class has to trust */
        var BAR_Y = FLOOR - 0.55, BAR_L = 2.9;
        world.add(line([new T.Vector3(-BAR_L / 2, BAR_Y, 0),
                        new T.Vector3(BAR_L / 2, BAR_Y, 0)], INK, 0.22));
        var bar = new T.Mesh(new T.PlaneGeometry(1, 0.15),
          new T.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.8 }));
        world.add(bar);
        var pLab = label('P = ρgh', '#f5c542', 0.50, 52);
        pLab.position.set(0, BAR_Y - 0.46, 0);
        world.add(pLab);

        function resizeA(){
          var nw = frame.clientWidth, nh = frame.clientHeight;
          if (!nw || !nh) return;
          camera.aspect = nw / nh; camera.updateProjectionMatrix();
          fit(nw / nh); renderer.setSize(nw, nh);
        }
        lfOn(frame, 'resize', resizeA);

        var t0 = Date.now(), CYCLE = 9.0;
        lfLoop(frame, function loop(){
          var t = ((Date.now() - t0) / 1000) % CYCLE;
          /* down, hold at the bottom, back up — so the class sees it both ways */
          var u;
          if (t < 4.2)      u = t / 4.2;
          else if (t < 5.4) u = 1;
          else if (t < 8.2) u = 1 - (t - 5.4) / 2.8;
          else              u = 0;

          var y = TOP - u * (TOP - FLOOR - 0.18);
          var depth = TOP - y;
          var len = 0.16 + depth * 0.46;

          probe.position.set(0.10, y, 0.02);
          halo.position.copy(probe.position);
          for (var i = 0; i < 4; i++){
            spokes[i].userData.set(0.10 + DIRS[i][0] * 0.12, y + DIRS[i][1] * 0.12,
              DIRS[i][0], DIRS[i][1], len);
          }

          hLine.geometry.setFromPoints([new T.Vector3(LEFT + 0.30, TOP, 0),
                                        new T.Vector3(LEFT + 0.30, y, 0)]);
          hLab.position.set(LEFT + 0.62, (TOP + y) / 2, 0.02);
          hLab.material.opacity = Math.min(depth * 2.4, 1);

          var f = depth / (TOP - FLOOR - 0.18);
          bar.scale.x = Math.max(f * BAR_L, 0.001);
          bar.position.set(-BAR_L / 2 + f * BAR_L / 2, BAR_Y, 0.01);

          renderer.render(scene, camera);
        });
        return;
      }

      /* ═══ the curved surface flattening into its own projection ═════════ */
      var R = 1.18, N = 13, CX = -1.55;
      /* the surface, as a function of the morph parameter m: m = 0 is the
         semicircle, m = 1 is the flat plate it projects onto */
      function pointAt(i, m){
        var a = -Math.PI / 2 + (i / (N - 1)) * Math.PI;      /* -90° … +90° */
        var x = CX + Math.cos(a) * R * (1 - m);
        var y = Math.sin(a) * R;
        return { x: x, y: y, nx: (1 - m) * Math.cos(a) + m, ny: (1 - m) * Math.sin(a) };
      }

      var surface = line([new T.Vector3(CX, -R, 0), new T.Vector3(CX, R, 0)], INK, 0.75);
      world.add(surface);
      var chord = line([new T.Vector3(CX, -R, 0), new T.Vector3(CX, R, 0)], INDIGO, 0.22);
      world.add(chord);

      var fan = [];
      for (var k = 0; k < N; k++) { var a2 = arrow(GOLD, 0.55); world.add(a2); fan.push(a2); }

      /* the answer, drawn once and never allowed to change */
      var RES_Y = -R - 0.62, RES_L = 1.55;
      var res = arrow(CYAN, 0.95);
      res.userData.set(CX - RES_L / 2, RES_Y, 1, 0, RES_L);
      world.add(res);
      var resLab = label('F = P × A', '#56ccf2', 0.50, 50);
      resLab.position.set(CX, RES_Y - 0.44, 0);
      world.add(resLab);

      /* the projected area itself, standing to the right as the thing the
         curved surface is being traded for */
      var PX = 1.75;
      world.add(line([new T.Vector3(PX, -R, 0), new T.Vector3(PX, R, 0)], INK, 0.75));
      var flatFan = [];
      for (var k2 = 0; k2 < N; k2++){
        var a3 = arrow(GOLD, 0.30);
        a3.userData.set(PX - 0.62, -R + (k2 / (N - 1)) * 2 * R, 1, 0, 0.56);
        world.add(a3); flatFan.push(a3);
      }
      var projLab = label('projected area', '#f4f7fb', 0.46, 40);
      projLab.position.set(PX, R + 0.42, 0);
      world.add(projLab);
      var tie = line([new T.Vector3(CX + 0.30, 0, 0), new T.Vector3(PX - 0.90, 0, 0)], GOLD, 0.22);
      world.add(tie);

      function resizeB(){
        var nw = frame.clientWidth, nh = frame.clientHeight;
        if (!nw || !nh) return;
        camera.aspect = nw / nh; camera.updateProjectionMatrix();
        fit(nw / nh); renderer.setSize(nw, nh);
      }
      lfOn(frame, 'resize', resizeB);

      var tB = Date.now(), CYC = 10.0;
      lfLoop(frame, function loop(){
        var t = ((Date.now() - tB) / 1000) % CYC;
        var m;                                   /* 0 = curved, 1 = flattened */
        if (t < 1.4)      m = 0;
        else if (t < 4.4) m = (t - 1.4) / 3.0;
        else if (t < 6.2) m = 1;
        else if (t < 8.6) m = 1 - (t - 6.2) / 2.4;
        else              m = 0;
        m = m * m * (3 - 2 * m);                 /* ease, so it reads as a fold */

        var pts = [];
        for (var i = 0; i < N; i++){
          var p = pointAt(i, m);
          pts.push(new T.Vector3(p.x, p.y, 0));
          /* the arrow lands ON the surface, pointing along its own normal */
          fan[i].userData.set(p.x - p.nx * 0.62, p.y - p.ny * 0.62, p.nx, p.ny, 0.56);
        }
        surface.geometry.setFromPoints(pts);
        renderer.render(scene, camera);
      });
    }

  });
})();
