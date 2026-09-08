/* الوثاق للصرافة — مشهد WebGL ثلاثي الأبعاد للقسم الرئيسي
   =========================================================
   حلقتان ذهبيتان متشابكتان (شعار الشركة ثلاثي الأبعاد) + عملات ذهبية
   عائمة + جزيئات متلألئة، مع تفاعل بسيط مع حركة الماوس.

   - يعتمد على three.js (assets/js/three.min.js)
   - لو تعذّر WebGL لأي سبب، القسم الرئيسي يبقى شغال بالتأثيرات
     الـ CSS الموجودة أصلاً (الخطة الاحتياطية).
   - يحترم تفضيل "تقليل الحركة" في النظام. */

(function () {
  'use strict';

  var hero = document.querySelector('.hero-3d');
  if (!hero) return;

  // تفضيل تقليل الحركة → نرسم المشهد مرة واحدة كصورة ثابتة (بدون حركة)
  var staticMode = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var THREE = window.THREE;
  if (!THREE) return;

  var canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = 'webgl-canvas';

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    });
  } catch (e) {
    return; // فشل WebGL — نترك التأثيرات الـ CSS
  }

  hero.appendChild(canvas);
  hero.classList.add('has-webgl');

  // نخفي شعار الحلقات الـ CSS لأن النسخة ثلاثية الأبعاد هي اللي بتظهر
  var cssRings = hero.querySelector('.rings-3d');
  if (cssRings) cssRings.style.display = 'none';

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 9.6);

  /* ---- إضاءة ---- */
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));

  var keyLight = new THREE.DirectionalLight(0xffe9c0, 1.15);
  keyLight.position.set(5, 6, 7);
  scene.add(keyLight);

  var goldLight = new THREE.PointLight(0xc9a54f, 0.9, 40);
  goldLight.position.set(-6, 3, 4);
  scene.add(goldLight);

  var tealLight = new THREE.PointLight(0x1b6b5a, 0.45, 40);
  tealLight.position.set(4, -3, 5);
  scene.add(tealLight);

  /* ---- مادة ذهبية ---- */
  function goldMaterial(variant) {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(0.115, 0.78, 0.52 + variant * 0.1),
      metalness: 0.88,
      roughness: 0.24,
      emissive: 0x8a6a1c,
      emissiveIntensity: 0.12
    });
  }

  /* ---- الحلقتان المتشابكتان (الشعار) ---- */
  var ringsGroup = new THREE.Group();

  function makeRing(offsetX) {
    var ring = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.088, 28, 110), goldMaterial(0));
    ring.position.x = offsetX;
    return ring;
  }

  var ringA = makeRing(-0.72);
  var ringB = makeRing(0.72);
  ringB.rotation.y = Math.PI / 2; // الحلقة الثانية موازية للأولى لكن معكوسة قليلاً
  ringsGroup.add(ringA, ringB);

  var ringsSpin = new THREE.Group();
  ringsSpin.add(ringsGroup);
  ringsSpin.position.set(0, 1.35, -1.2);
  scene.add(ringsSpin);

  /* ---- عملات ذهبية عائمة ---- */
  var coins = [];
  var coinGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.1, 48);
  for (var i = 0; i < 16; i++) {
    var mat = goldMaterial((i % 4) / 5 - 0.2);
    var coin = new THREE.Mesh(coinGeo, mat);
    coin.position.set(
      -6.4 + Math.random() * 12.8,
      -2.8 + Math.random() * 6.6,
      -4.5 - Math.random() * 3.5
    );
    coin.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    var data = {
      mesh: coin,
      spin: 0.12 + Math.random() * 0.3,
      phase: Math.random() * Math.PI * 2,
      baseY: coin.position.y,
      amp: 0.12 + Math.random() * 0.2
    };
    coins.push(data);
    scene.add(coin);
  }

  /* ---- جزيئات متلألئة ---- */
  var SPARK_COUNT = 380;
  var sparkPos = new Float32Array(SPARK_COUNT * 3);
  var sparkVel = new Float32Array(SPARK_COUNT);
  for (var s = 0; s < SPARK_COUNT; s++) {
    sparkPos[s * 3] = -7 + Math.random() * 14;
    sparkPos[s * 3 + 1] = -3.4 + Math.random() * 7.6;
    sparkPos[s * 3 + 2] = -5 + Math.random() * 5;
    sparkVel[s] = 0.12 + Math.random() * 0.35;
  }
  var sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  var sparkMat = new THREE.PointsMaterial({
    color: 0xd9b75f,
    size: 0.075,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  var sparks = new THREE.Points(sparkGeo, sparkMat);
  scene.add(sparks);

  /* ---- تفاعل الماوس (تأثير منظوري خفيف) ---- */
  var mouse = { x: 0, y: 0 };
  var target = { x: 0, y: 0 };
  var isTouch = 'ontouchstart' in window;

  if (!isTouch && !staticMode) {
    hero.addEventListener('mousemove', function (e) {
      var rect = hero.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    });
    hero.addEventListener('mouseleave', function () {
      mouse.x = 0;
      mouse.y = 0;
    });
  }

  /* ---- التحكم بالمقاسات ---- */
  function resize() {
    var w = hero.clientWidth;
    var h = hero.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  /* ---- إيقاف الرسم لما القسم خارج الشاشة (توفير للأداء) ---- */
  var running = true;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      running = entries[0].isIntersecting;
    }, { threshold: 0.02 }).observe(hero);
  }

  /* ---- حلقة الرسم ---- */
  var clock = new THREE.Clock();
  var rafId = null;

  // وضع ثابت (تقليل الحركة): نرسم إطاراً واحداً فقط بوضعية جاهزة
  function renderStatic() {
    ringsGroup.rotation.y = 0.6;
    ringsGroup.rotation.x = 0.3;
    ringA.rotation.z = 1.1;
    ringB.rotation.z = -1.1;
    for (var i = 0; i < coins.length; i++) {
      coins[i].mesh.rotation.x = 0.8 + i * 0.2;
      coins[i].mesh.rotation.y = 0.4 + i * 0.3;
    }
    renderer.render(scene, camera);
  }
  if (staticMode) {
    renderStatic();
  } else {
    animate();
  }

  function animate() {
    if (running) {
      var t = clock.getElapsedTime();

      target.x += (mouse.x - target.x) * 0.04;
      target.y += (mouse.y - target.y) * 0.04;

      camera.position.x = target.x * 1.1;
      camera.position.y = -target.y * 0.75;
      camera.lookAt(0, 0.6, -1);

      // الحلقتان — دوران دائم
      ringsGroup.rotation.y = t * 0.55;
      ringsGroup.rotation.x = Math.sin(t * 0.35) * 0.32;
      ringA.rotation.z = t * 0.9;
      ringB.rotation.z = -t * 0.9;
      ringsSpin.position.x = target.x * 0.55;
      ringsSpin.position.y = 1.35 - target.y * 0.4;

      // العملات — دوران وطفو
      for (var i = 0; i < coins.length; i++) {
        var c = coins[i];
        c.mesh.rotation.y += c.spin * 0.016;
        c.mesh.rotation.x += c.spin * 0.008;
        c.mesh.position.y = c.baseY + Math.sin(t * 0.9 + c.phase) * c.amp;
      }

      // الجزيئات — صعود بطيء مع إعادة تدوير
      var pos = sparkGeo.attributes.position.array;
      for (var s = 0; s < SPARK_COUNT; s++) {
        pos[s * 3 + 1] += sparkVel[s] * 0.008;
        if (pos[s * 3 + 1] > 4.2) {
          pos[s * 3 + 1] = -3.4;
          pos[s * 3] = -7 + Math.random() * 14;
        }
      }
      sparkGeo.attributes.position.needsUpdate = true;

      renderer.render(scene, camera);
    }
    rafId = requestAnimationFrame(animate);
  }

  // تنظيف بسيط لو الصفحة اختفت (نادر، لكن احتياط)
  window.addEventListener('pagehide', function () {
    if (rafId) cancelAnimationFrame(rafId);
    renderer.dispose();
  });
})();