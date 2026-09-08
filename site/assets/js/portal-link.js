/* رابط «دخول الموظفين» — يظهر فقط عندما يقدّم تطبيق الوثاق المتكامل الصفحة
   (أي عندما يتوفر /api) حتى لا يظهر على النسخة الثابتة GitHub Pages. */
(function () {
  fetch('/api/health', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error('static'); return r.json(); })
    .then(function () {
      var host = document.querySelector('.foot-bottom');
      if (!host || document.querySelector('.staff-link')) return;
      var a = document.createElement('a');
      a.href = '/portal';
      a.className = 'staff-link';
      a.textContent = 'دخول الموظفين';
      a.setAttribute('aria-label', 'بوابة الموظفين — تسجيل الدخول');
      host.appendChild(a);
    })
    .catch(function () { /* نسخة ثابتة — لا نضيف الرابط */ });
})();
