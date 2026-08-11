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
  });
})();
