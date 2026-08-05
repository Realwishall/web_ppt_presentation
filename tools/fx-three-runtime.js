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
