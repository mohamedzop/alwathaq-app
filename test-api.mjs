/* اختبار آلي سريع — يشغَّل والخادم شغال على 8123 */
const B = 'http://127.0.0.1:8123/api';
let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
async function req(path, { method = 'GET', body, jar } = {}) {
  const res = await fetch(B + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(jar?.cookie ? { Cookie: jar.cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  const setCookie = res.headers.get('set-cookie') || '';
  if (jar && setCookie) jar.cookie = setCookie.split(';')[0];
  return { status: res.status, data };
}

const admin = { cookie: '' }, emp = { cookie: '' };

function todayLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

console.log('— المصادقة —');
let r = await req('/login', { method: 'POST', body: { username: 'admin', password: 'admin123' }, jar: admin });
check('دخول المدير', r.status === 200 && r.data.user.role === 'manager');
r = await req('/login', { method: 'POST', body: { username: 'employee', password: 'emp123' }, jar: emp });
check('دخول الموظف', r.status === 200 && r.data.user.role === 'employee');
r = await req('/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } });
check('كلمة مرور خاطئة مرفوضة', r.status === 401);
r = await req('/me');
check('بدون جلسة → 401', r.status === 401);
r = await req('/me', { jar: admin });
check('مع الجلسة → بيانات المستخدم', r.status === 200 && r.data.user.username === 'admin');

console.log('— الصلاحيات —');
r = await req('/reports/summary', { jar: emp });
check('موظف لا يرى التقارير (403)', r.status === 403);
r = await req('/users', { jar: emp });
check('موظف لا يرى المستخدمين (403)', r.status === 403);
r = await req('/users', { method: 'POST', body: { username: 'hacker', role: 'manager', password: '123456' }, jar: emp });
check('موظف لا ينشئ مستخدمين (403)', r.status === 403);
r = await req('/transactions', { jar: emp });
check('موظف يرى المعاملات', r.status === 200 && Array.isArray(r.data.list));
r = await req('/clients', { jar: emp });
check('موظف يبحث في العملاء', r.status === 200);

console.log('— اللغة العربية (الترميز) —');
const arName = 'مكتبة الفاروق التجارية';
r = await req('/clients', { method: 'POST', body: { full_name: arName, phone: '0928001122', client_type: 'company' }, jar: admin });
const cid = r.data.client?.id;
check('إضافة عميل عربي', r.status === 201 && r.data.client.full_name === arName, JSON.stringify(r.data));
r = await req('/clients?q=' + encodeURIComponent('الفاروق'), { jar: admin });
check('البحث بالاسم العربي', r.data.clients.some((c) => c.full_name === arName));
r = await req('/transactions', { method: 'POST', body: { tx_type: 'buy', currency: 'EUR', amount: 300, rate: 10.75, client_id: cid, note: 'استبدال يورو' }, jar: admin });
check('تسجيل معاملة بملاحظة عربية', r.status === 201 && r.data.transaction.note === 'استبدال يورو' && Math.abs(r.data.transaction.lyd_value - 3225) < 1e-6);

console.log('— التحقق من المدخلات —');
r = await req('/transactions', { method: 'POST', body: { tx_type: 'sell', currency: 'USD', amount: -5, rate: 9 }, jar: admin });
check('مبلغ سالب مرفوض', r.status === 400);
r = await req('/transactions', { method: 'POST', body: { tx_type: 'sell', currency: 'XYZ', amount: 5, rate: 9 }, jar: admin });
check('عملة غير معروفة مرفوضة', r.status === 400);
r = await req('/transactions', { method: 'POST', body: { tx_type: 'sell', currency: 'USD', amount: 5, rate: 9, client_id: 99999 }, jar: admin });
check('عميل غير موجود مرفوض', r.status === 400);
r = await req('/transactions', { method: 'POST', body: { tx_type: 'nonsense', currency: 'USD', amount: 5 }, jar: admin });
check('نوع عملية غير معروف مرفوض', r.status === 400);

console.log('— التقارير والمستخدمون (مدير) —');
r = await req('/reports/summary', { jar: admin });
check('تقرير ملخص المدير', r.status === 200 && r.data.count >= 1);
r = await req('/reports/daily', { jar: admin });
check('تقرير يومي', r.status === 200 && Array.isArray(r.data.days));
r = await req('/clients/' + cid, { jar: admin });
check('سجل العميل مع تاريخ المعاملات', r.status === 200 && r.data.client.transactions.length >= 1);
r = await req('/users', { jar: admin });
check('قائمة المستخدمين', r.status === 200 && r.data.users.length >= 2);
r = await req('/users/1', { method: 'PATCH', body: { active: false }, jar: admin });
check('تعطيل الحساب الحالي مرفوض', r.status === 400);
const uname = 'teller' + Date.now().toString().slice(-6);
r = await req('/users', { method: 'POST', body: { username: uname, full_name: 'موظف ثانٍ', role: 'employee', password: 'pass1234' }, jar: admin });
const uid = r.data.user?.id;
check('إنشاء مستخدم جديد', r.status === 201);
r = await req('/users/' + uid, { method: 'PATCH', body: { role: 'manager', password: 'newpass99' }, jar: admin });
check('تعديل مستخدم (صلاحية + كلمة مرور)', r.status === 200 && r.data.user.role === 'manager');
const emp2 = { cookie: '' };
r = await req('/login', { method: 'POST', body: { username: uname, password: 'newpass99' }, jar: emp2 });
check('تسجيل الدخول بكلمة المرور الجديدة', r.status === 200);

console.log('— الأسعار (تحرير مباشر من البوابة) —');
r = await req('/rates');
check('قراءة الأسعار عامة', r.status === 200 && r.data.source === 'db' && (r.data.count || 0) >= 1);
const oldUsd = r.data.rates['USD_cash']?.retail;
r = await req('/rates', { method: 'PUT', body: { rates: { USD_cash: { retail: 9.777, wholesale: 9.700 }, EUR_bank: { retail: 10.5 } } }, jar: emp });
check('موظف يعدّل الأسعار مباشرة (PUT)', r.status === 200 && r.data.rates['USD_cash'].retail === 9.777 && r.data.rates['EUR_bank'].wholesale === 10.5);
r = await req('/rates', { method: 'PUT', body: { rates: { USD_cash: { retail: -3 } } }, jar: emp });
check('سعر غير صالح مرفوض', r.status === 400);
r = await req('/rates/import', { method: 'POST', jar: emp });
check('موظف لا يستورد من الجدول (403)', r.status === 403);
r = await req('/rates', { method: 'PUT', body: { rates: { USD_cash: { retail: oldUsd, wholesale: oldUsd - 0.01 } } }, jar: admin });
check('إرجاع السعر الأصلي', r.status === 200 && Math.abs(r.data.rates['USD_cash'].retail - oldUsd) < 1e-9);

console.log('— إقفال اليوم / الجرد (مدير) —');
r = await req('/settlement', { jar: emp });
check('موظف لا يرى الجرد (403)', r.status === 403);
const sday = todayLocal();
r = await req('/settlement?day=' + sday, { jar: admin });
check('قراءة سجل اليوم', r.status === 200 && typeof r.data.expected === 'number');
r = await req('/settlement', { method: 'POST', body: { day: sday, opening_lyd: 5000, counted_lyd: 4800, notes: 'جرد نهاية اليوم' }, jar: admin });
check('حفظ الإقفال (بداية + معدود)', r.status === 200 && r.data.register.counted_lyd === 4800 && r.data.register.opening_lyd === 5000);
check('حساب الفرق = المعدود − المتوقع', Math.abs(r.data.variance - (4800 - r.data.expected)) < 1e-6);
r = await req('/settlement/adjustments', { method: 'POST', body: { day: sday, adj_type: 'in', amount: 1000, note: 'إيداع' }, jar: admin });
check('إضافة إيداع نقدي', r.status === 200 && r.data.adjustments.some((a) => a.adj_type === 'in' && a.amount === 1000));
const adjId = r.data.adjustments[r.data.adjustments.length - 1].id;
r = await req('/settlement/adjustments/' + adjId, { method: 'DELETE', jar: admin });
check('حذف التعديل النقدي', r.status === 200 && !r.data.adjustments.some((a) => a.id === adjId));

console.log('— الخروج —');
r = await req('/logout', { method: 'POST', jar: admin });
check('تسجيل الخروج', r.status === 200);
r = await req('/me', { jar: admin });
check('الجلسة أُبطِلت بعد الخروج', r.status === 401);

console.log(`\nالنتيجة: ${pass} نجح / ${fail} فشل`);
process.exit(fail ? 1 : 0);
