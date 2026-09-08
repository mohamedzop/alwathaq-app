document.addEventListener('DOMContentLoaded', function () {
  var hero = document.querySelector('.hero-3d');
  if (!hero) return;
  var glow = document.createElement('div');
  glow.className = 'cursor-glow';
  hero.appendChild(glow);

  hero.addEventListener('mousemove', function (e) {
    var rect = hero.getBoundingClientRect();
    glow.style.left = (e.clientX - rect.left) + 'px';
    glow.style.top = (e.clientY - rect.top) + 'px';
    glow.style.opacity = '1';
  });

  hero.addEventListener('mouseleave', function () {
    glow.style.opacity = '0';
  });
});


