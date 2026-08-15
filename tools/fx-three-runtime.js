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
      if (!(probe.getContext('webgl') || probe.getContext('experimental-webgl'))) return;
    } catch (e) { return; }

    frames.forEach(function(frame){
      try { start(frame); } catch (e) { /* a dead scene must not blank the slide */ }
    });

    function start(frame){
      var w = frame.clientWidth, h = frame.clientHeight;
      if (!w || !h) { requestAnimationFrame(function(){ start(frame); }); return; }

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
          kind === 'bounce-decay'){
        startMech2D(frame, w, h, kind); return;
      }
      if (kind === 'slinky-drop' || kind === 'lift-frame' ||
          kind === 'friction-ramp'){
        startFbd2D(frame, w, h, kind); return;
      }
      if (kind === 'equilibrium-types'){ startEquilibrium(frame, w, h); return; }

      var renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
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
      window.addEventListener('resize', resize);
      (function loop(){
        requestAnimationFrame(loop);
        group.rotation.y += 0.0022;
        group.rotation.x = Math.sin(Date.now() / 9000) * 0.18;
        renderer.render(scene, camera);
      })();
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

      var renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
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

      (function loop(){
        requestAnimationFrame(loop);
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
      })();
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

      var renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
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
      window.addEventListener('resize', resize);

      var t0 = Date.now();
      var qGroup = new T.Quaternion(), qFace = new T.Quaternion(), refDist = 1;
      refDist = camera.position.distanceTo(lookAt);
      var wp = new T.Vector3();
      (function loop(){
        requestAnimationFrame(loop);
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
      })();
    }

    /* ---------------------------------------------- solid angle (steradian) ---
       Sphere of radius r with a square pyramidal solid angle from the centre.
       Same Ω cuts patch A on the sphere and a larger patch A′ further out at r′.
       Slow auto-orbit; no OrbitControls (pointer-events are owned by the host). */
    function startSolidAngle(frame, w, h){
      var renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
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
      window.addEventListener('resize', resize);
      (function loop(){
        requestAnimationFrame(loop);
        group.rotation.y += 0.0035;
        renderer.render(scene, camera);
      })();
    }

    /* ----------------------------------------- solid angle of a cone (sr) ---
       Sphere + right circular cone of semi-vertical angle α from the centre.
       The cone cuts a spherical cap; slow auto-orbit for the classroom.       */
    function startSolidAngleCone(frame, w, h){
      var renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
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
      window.addEventListener('resize', resize);
      (function loop(){
        requestAnimationFrame(loop);
        group.rotation.y += 0.004;
        renderer.render(scene, camera);
      })();
    }

    /* ---------------------------------------------------- screw-gauge 3D ---
       Micrometer with FLAT scale plates (perfect classroom numbering) plus
       orbit controls. Sim drives state via __sgUpdate; view via __sgOrbit /
       __sgView (wired from data-act="orbit"|"view" buttons).                 */
    function startScrewGauge(frame, w, h){
      var renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
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
      window.addEventListener('resize', resize);

      (function loop(){
        requestAnimationFrame(loop);
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
      })();

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

      var renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
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

      (function loop(){
        requestAnimationFrame(loop);
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
      })();
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

      var renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
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

      (function loop(){
        requestAnimationFrame(loop);
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
      })();
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

      var renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
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

      function resize(){
        var nw = frame.clientWidth, nh = frame.clientHeight;
        if (!nw || !nh) return;
        camera.aspect = nw / nh; camera.updateProjectionMatrix();
        fit(nw / nh);
        renderer.setSize(nw, nh);
      }
      window.addEventListener('resize', resize);

      var t0 = Date.now();
      (function loop(){
        requestAnimationFrame(loop);
        if (tick) tick((Date.now() - t0) / 1000);
        renderer.render(scene, camera);
      })();
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

      var renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
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
      window.addEventListener('resize', resize);

      var tf0 = Date.now();
      (function loop(){
        requestAnimationFrame(loop);
        if (tick) tick((Date.now() - tf0) / 1000);
        renderer.render(scene, camera);
      })();
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

      var renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
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
      window.addEventListener('resize', resize);

      var t0 = Date.now();
      (function loop(){
        requestAnimationFrame(loop);
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
      })();
    }

  });
})();
