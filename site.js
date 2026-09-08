/* أدوات تحسين عامة — الوثاق للصرافة
   ==================================
   - تكرار شريط الأسعار لحركة مستمرة سلسة
   - ظل الهيدر عند التمرير + زر العودة للأعلى
   - ميلان ثلاثي الأبعاد للبطاقات مع لمعان ذهبي يتبع الماوس
   - معرض صور بنافذة عرض كبيرة (lightbox) */
(function () {
  'use strict';

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* 1) شريط الأسعار — ننسخ المحتوى مرة واحدة عشان الحركة تلتف بسلاسة */
  (function ticker() {
    var track = document.querySelector('.ticker-track');
    if (!track) return;
    var group = track.querySelector('.ticker-group');
    if (!group) return;
    track.appendChild(group.cloneNode(true));
  })();

  /* 2) الهيدر + زر العودة للأعلى */
  var header = document.querySelector('.site-header');
  var toTop = document.querySelector('.to-top');

  function onScroll() {
    if (header) header.classList.toggle('scrolled', window.scrollY > 8);
    if (toTop) toTop.classList.toggle('show', window.scrollY > 520);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  if (toTop) {
    toTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    });
  }

  /* 3) ميلان ثلاثي الأبعاد + لمعان يتبع الماوس */
  if (!reduced && window.matchMedia('(hover: hover)').matches) {
    var tiltSel = '.service-card, .mini-service-card, .calc-card, .mini-photo, .rate-board, .photo-card';
    document.querySelectorAll(tiltSel).forEach(function (el) {
      if (el.classList.contains('tilt')) return;
      el.classList.add('tilt');

      el.addEventListener('mousemove', function (e) {
        var r = el.getBoundingClientRect();
        if (r.width === 0) return;
        var px = (e.clientX - r.left) / r.width;
        var py = (e.clientY - r.top) / r.height;
        var rx = (0.5 - py) * 9;
        var ry = (px - 0.5) * 9;
        el.style.transform =
          'translateY(-5px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg) scale(1.02)';
        el.style.setProperty('--gx', (px * 100).toFixed(1) + '%');
        el.style.setProperty('--gy', (py * 100).toFixed(1) + '%');
      });

      el.addEventListener('mouseleave', function () {
        el.style.transform = '';
      });
    });
  }

  /* 4) معرض الصور — نافذة عرض كبيرة */
  (function lightbox() {
    var links = document.querySelectorAll('a[data-lightbox]');
    if (!links.length) return;

    var box = document.createElement('div');
    box.className = 'lightbox';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.innerHTML =
      '<button type="button" class="lb-close" aria-label="إغلاق العرض">✕</button><img src="" alt="عرض الصورة">';
    document.body.appendChild(box);

    var img = box.querySelector('img');
    var close = box.querySelector('.lb-close');

    function open(href) {
      img.src = href;
      box.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
    function closeLb() {
      box.classList.remove('open');
      document.body.style.overflow = '';
      img.src = '';
    }

    links.forEach(function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        open(a.getAttribute('href'));
      });
    });
    close.addEventListener('click', closeLb);
    box.addEventListener('click', function (e) {
      if (e.target === box) closeLb();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeLb();
    });
  })();
})();