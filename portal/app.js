/* ══════════════════════════════════════════════════════════
   بوابة الوثاق للصرافة — واجهة الموظفين (لا تعمل إلا مع الخادم)
   ══════════════════════════════════════════════════════════ */
'use strict';

/* ---------- أدوات عامة ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const FALLBACK_TYPES = {
  buy: 'صرف — شراء عملة',
  sell: 'صرف — بيع عملة',
  local_transfer: 'حوالة داخلية',
  intl_transfer: 'حوالة دولية (تركيا / دبي)',
  voda_cash: 'فودافون كاش',
};
const CASH_CURRENCIES = ['USD', 'EUR', 'GBP', 'TRY', 'AED', 'EGP', 'TND'];
const TYPE_TAG = { buy: 'buy', sell: 'sell', local_transfer: 'transfer', intl_transfer: 'intl', voda_cash: 'voda' };

let me = null;
let meta = { txTypes: FALLBACK_TYPES, currencies: [] };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtNum(n, dec = 3) {
  const v = Number(n || 0);
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: dec });
}
function lyd(n) { return `<span class="num">${fmtNum(n)}</span> د.ل`; }
function iso(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
const today = () => iso(new Date());
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); }
function monthStart() { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1)); }
function clock(ts) { return String(ts || '').slice(11, 16); }

function toast(msg, isErr = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  $('#toast-wrap').appendChild(t);
  setTimeout(() => t.remove(), 3600);
}

/* ---------- ═══ فاتورة الزبون ═══ ---------- */
// بيانات الشركة التي تظهر على الفاتورة — عدّلها من هنا عند الحاجة
const RECEIPT_COMPANY = {
  name: 'الوثاق للصرافة',
  nameEn: 'WATHAQ EXCHANGE',
  phone: '091-0000000',
  address: 'طرابلس — ليبيا',
  footer: 'شكراً لتعاملكم معنا — فاتورة غير ضريبية',
};

const txById = new Map(); // خريطة المعاملات الظاهرة في الجداول (للطباعة من الصف)

// تحويل رقم إلى كلمات عربية (دينار/درهم) لكتابة المبلغ على الفاتورة
const AR_ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
const AR_TEENS = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const AR_TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const AR_HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];
function arUnder1000(x) {
  if (x === 0) return '';
  const h = Math.floor(x / 100);
  const r = x % 100;
  const out = [];
  if (h) out.push(AR_HUNDREDS[h]);
  if (r >= 10 && r <= 19) out.push(AR_TEENS[r - 10]);
  else if (r >= 1 && r <= 9) out.push(AR_ONES[r]);
  else if (r >= 20) {
    const t = Math.floor(r / 10), o = r % 10;
    if (t && o) out.push(AR_ONES[o] + ' و' + AR_TENS[t]);
    else out.push(AR_TENS[t]);
  }
  return out.join(' و');
}
function arGroupName(q, one, dual, few, many) {
  if (q === 1) return one;
  if (q === 2) return dual;
  if (q <= 10) return few;
  return many;
}
function arabicNumeral(v) {
  if (v === 0) return 'صفر';
  const mill = Math.floor(v / 1000000);
  const thou = Math.floor((v % 1000000) / 1000);
  const rest = v % 1000;
  const parts = [];
  const grp = (q, one, dual, few, many) => (q === 2 ? dual : arUnder1000(q) + ' ' + arGroupName(q, one, dual, few, many));
  if (mill) parts.push(grp(mill, 'مليون', 'مليونان', 'ملايين', 'مليوناً'));
  if (thou) parts.push(grp(thou, 'ألف', 'ألفان', 'آلاف', 'ألفاً'));
  if (rest) parts.push(arUnder1000(rest));
  return parts.join(' و');
}
function numToArabicWords(n) {
  const v = Math.round((Number(n) || 0) * 1000) / 1000;
  const d = Math.floor(v);
  const dh = Math.round((v - d) * 1000);
  const parts = [];
  parts.push((d > 0 ? arabicNumeral(d) : 'صفر') + ' ديناراً');
  if (dh > 0) parts.push(arabicNumeral(dh) + ' درهماً');
  return 'فقط ' + parts.join(' و') + ' لا غير';
}

const CUR_AR_NAMES = { USD: 'دولار أمريكي', EUR: 'يورو', GBP: 'جنيه إسترليني', TRY: 'ليرة تركية', AED: 'درهم إماراتي', EGP: 'جنيه مصري', TND: 'دينار تونسي', LYD: 'دينار ليبي', VODA: 'فودافون كاش' };

function receiptHtml(tx) {
  const C = RECEIPT_COMPANY;
  const dt = new Date(String(tx.created_at || '').replace(' ', 'T'));
  const dateStr = isNaN(dt) ? '—' : dt.toLocaleDateString('ar-LY') + ' — ' + dt.toLocaleTimeString('ar-LY', { hour: '2-digit', minute: '2-digit' });
  const typeLabel = (meta.txTypes && meta.txTypes[tx.tx_type]) || tx.tx_type || '—';
  const curName = CUR_AR_NAMES[tx.currency] || tx.currency;
  const idStr = '#' + String(tx.id || '').padStart(6, '0');
  return `
  <div class="receipt">
    <div class="r-head">
      <svg class="r-logo" viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="24" cy="32" r="13" fill="none" stroke="url(#rg)" stroke-width="5"/>
        <circle cx="40" cy="32" r="13" fill="none" stroke="url(#rg)" stroke-width="5"/>
        <defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#e6c878"/><stop offset=".5" stop-color="#c9a54f"/><stop offset="1" stop-color="#a8812f"/>
        </linearGradient></defs>
      </svg>
      <div class="r-name">${esc(C.name)}</div>
      <div class="r-en">${esc(C.nameEn)}</div>
      <div class="r-sub">${esc(C.address)} · ${esc(C.phone)}</div>
    </div>
    <hr class="r-div">
    <div class="r-meta"><span><b>إيصال استلام</b></span><span class="mono">${idStr}</span></div>
    <div class="r-meta"><span>التاريخ</span><span class="mono">${esc(dateStr)}</span></div>
    <div class="r-meta"><span>الموظف</span><span>${esc(tx.operator || '—')}</span></div>
    <hr class="r-div">
    <div class="r-client"><div class="lbl">العميل</div><b>${esc(tx.client_name || '—')}</b>${tx.client_phone ? `<br><span class="mono">${esc(tx.client_phone)}</span>` : ''}</div>
    <hr class="r-div">
    <table class="r-det">
      <tr><td class="k">العملية</td><td class="v" style="font-family:var(--font); font-weight:700">${esc(typeLabel)}</td></tr>
      <tr><td class="k">العملة</td><td class="v">${esc(tx.currency)} — ${esc(curName)}</td></tr>
      <tr><td class="k">المبلغ</td><td class="v">${fmtNum(tx.amount)} ${esc(tx.currency)}</td></tr>
      <tr><td class="k">سعر الصرف</td><td class="v">${fmtNum(tx.rate)} د.ل</td></tr>
    </table>
    <div class="r-total"><span class="t-lbl">الإجمالي</span><span class="t-val">${fmtNum(tx.lyd_value)} د.ل</span></div>
    <div class="r-words"><div class="w-lbl">المبلغ كتابةً</div>${numToArabicWords(tx.lyd_value)}</div>
    ${tx.note ? `<div class="r-note">ملاحظة: ${esc(tx.note)}</div>` : ''}
    <div class="r-sig">
      <div class="sig"><div class="line"></div>توقيع الموظف</div>
      <div class="sig"><div class="line"></div>توقيع العميل</div>
    </div>
    <div class="r-foot">${esc(C.footer)} — ${esc(C.name)}</div>
  </div>`;
}

function openReceipt(tx) {
  const html = receiptHtml(tx);
  $('#receipt-preview').innerHTML = html;
  $('#receipt-print').innerHTML = html;
  $('#receipt-modal').classList.remove('hidden');
}
function closeReceipt() {
  $('#receipt-modal').classList.add('hidden');
}

/* ---------- طبقة الاتصال ---------- */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* فارغ */ }
  if (res.status === 401 && !path.endsWith('/login')) {
    boot();
    throw new Error('انتهت الجلسة');
  }
  if (!res.ok) {
    const msg = data.message || data.error || 'حدث خطأ';
    throw new Error(msg);
  }
  return data;
}

/* ---------- التنقل ---------- */
const TITLES = {
  dashboard: 'لوحة اليوم',
  transactions: 'المعاملات',
  clients: 'العملاء',
  reports: 'التقارير',
  settlement: 'إقفال اليوم — الجرد النقدي',
  rates: 'الأسعار — تحرير مباشر',
  users: 'المستخدمون',
};

function showView(name) {
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  $('#page-title').textContent = TITLES[name] || '';
  const c = $('#content');
  c.innerHTML = '<div class="empty">… جارٍ التحميل</div>';
  ({ dashboard: viewDashboard, transactions: viewTransactions, clients: viewClients, reports: viewReports, settlement: viewSettlement, rates: viewRates, users: viewUsers }[name])();
}

function setMe(u) {
  me = u;
  const chip = $('#user-chip');
  const isManager = u.role === 'manager';
  chip.innerHTML = `
    <div class="avatar">${esc(u.full_name.trim().charAt(0))}</div>
    <div><b>${esc(u.full_name)}</b>
      <small><span class="badge-role ${u.role}">${isManager ? 'مدير' : 'موظف'}</span> · ${esc(u.username)}</small>
    </div>`;
  $$('.manager-only').forEach((n) => n.classList.toggle('hidden', !isManager));
  if (!isManager && ['reports', 'settlement', 'users'].includes(location.hash.slice(1))) location.hash = '#dashboard';
}

/* ---------- تسجيل الدخول / الخروج ---------- */
function showLogin() {
  $('#app-view').classList.add('hidden');
  $('#login-view').classList.remove('hidden');
  $('#login-error').classList.add('hidden');
}
function boot() {
  api('/api/me').then(({ user }) => {
    if (!user) return showLogin();
    me = user;
    setMe(user);
    $('#login-view').classList.add('hidden');
    $('#app-view').classList.remove('hidden');
    const target = ['dashboard', 'transactions', 'clients', 'reports', 'settlement', 'rates', 'users'].includes(location.hash.slice(1))
      ? location.hash.slice(1) : 'dashboard';
    showView(target);
  }).catch(() => showLogin());
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-btn');
  btn.disabled = true; btn.textContent = '…';
  $('#login-error').classList.add('hidden');
  try {
    const { user } = await api('/api/login', {
      method: 'POST',
      body: { username: $('#login-user').value.trim(), password: $('#login-pass').value },
    });
    $('#login-pass').value = '';
    setMe(user);
    $('#login-view').classList.add('hidden');
    $('#app-view').classList.remove('hidden');
    showView('dashboard');
  } catch (err) {
    const el = $('#login-error');
    el.textContent = err.message;
    el.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = 'دخول';
  }
});

$('#logout-btn').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch { /* تجاهل */ }
  me = null;
  location.hash = '';
  showLogin();
});

/* ---------- ═══ لوحة اليوم ═══ ---------- */
async function viewDashboard() {
  const d = today();
  let sumToday = null, sumWeek = null, recent = [];
  try {
    [sumToday, sumWeek, { list: recent }] = await Promise.all([
      api(`/api/summary?from=${d}&to=${d}`),
      api(`/api/summary?from=${daysAgo(6)}&to=${d}`),
      api(`/api/transactions?from=${d}&to=${d}&limit=10`),
    ]);
  } catch (err) { toast(err.message, true); return; }

  const c = $('#content');
  c.innerHTML = `
    <div class="grid-cards">
      <div class="stat-card"><div class="st-label">معاملات اليوم</div><div class="st-value">${sumToday.count}</div>
        <div class="st-sub">${recent.length ? 'آخر تحديث قبل قليل' : 'لا معاملات بعد اليوم'}</div></div>
      <div class="stat-card"><div class="st-label">إجمالي اليوم (دينار)</div><div class="st-value">${fmtNum(sumToday.lyd)}</div>
        <div class="st-sub">${sumToday.count ? 'قابل للمطابقة عبر «التقارير»' : '—'}</div></div>
      <div class="stat-card"><div class="st-label">آخر 7 أيام — معاملات</div><div class="st-value">${sumWeek.count}</div></div>
      <div class="stat-card"><div class="st-label">آخر 7 أيام — إجمالي (دينار)</div><div class="st-value">${fmtNum(sumWeek.lyd)}</div></div>
    </div>
    <div class="card">
      <div class="card-head"><h3>إجراءات سريعة</h3></div>
      <div class="quick-pills">
        <button data-goto="transactions" class="pill-act">＋ تسجيل معاملة</button>
        <button data-goto="clients" class="pill-act">بحث عن عميل</button>
        ${me.role === 'manager' ? '<button data-goto="reports" class="pill-act">تقرير اليوم</button>' : ''}
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h3>آخر معاملات اليوم</h3>
        <button class="btn-ghost" data-goto="transactions">عرض الكل ←</button></div>
      ${recent.length ? txTable(recent) : '<div class="empty">لا توجد معاملات مسجلة اليوم</div>'}
    </div>`;
  $$('.pill-act, [data-goto]').forEach((b) => b.addEventListener('click', () => { location.hash = '#' + b.dataset.goto; showView(b.dataset.goto); }));
}

function txTable(rows) {
  const L = meta.txTypes;
  rows.forEach((t) => txById.set(t.id, t));
  return `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>الوقت</th><th>العملية</th><th>العميل</th><th>العملة</th><th>المبلغ</th><th>القيمة د.ل</th><th>الموظف</th><th></th></tr></thead>
    <tbody>${rows.map((t) => `
      <tr>
        <td class="mono">${clock(t.created_at)}</td>
        <td><span class="tag ${TYPE_TAG[t.tx_type] || ''}">${esc(L[t.tx_type] || t.tx_type)}</span></td>
        <td>${esc(t.client_name || '—')}${t.client_phone ? `<br><small class="mono">${esc(t.client_phone)}</small>` : ''}</td>
        <td><span class="tag cur">${esc(t.currency)}</span></td>
        <td class="num">${fmtNum(t.amount)}</td>
        <td class="num">${fmtNum(t.lyd_value)}</td>
        <td>${esc(t.operator || '—')}</td>
        <td><button type="button" class="rx-print" data-id="${t.id}" title="طباعة الفاتورة">🖨️</button></td>
      </tr>`).join('')}
    </tbody></table></div>`;
}

/* ---------- ═══ المعاملات ═══ ---------- */
let txState = { from: today(), to: today(), type: '', q: '' };

async function viewTransactions() {
  await loadTxMeta();
  const c = $('#content');
  const types = meta.txTypes;
  c.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>تسجيل معاملة جديدة</h3></div>
      <form id="tx-form">
        <div class="form-row" style="margin-bottom:12px">
          <label>نوع العملية
            <select id="tx-type" required>${Object.entries(types).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
          </label>
          <label>العملة
            <select id="tx-cur"></select>
          </label>
          <label>المبلغ
            <input type="number" id="tx-amount" min="0" step="any" required placeholder="0.00">
          </label>
          <label>السعر (د.ل)
            <input type="number" id="tx-rate" step="any" placeholder="مثال 9.25">
          </label>
          <label>القيمة بالدينار
            <input type="text" id="tx-lyd" readonly placeholder="تُحسب تلقائياً">
          </label>
        </div>
        <div class="form-row-2" style="margin-bottom:12px">
          <div style="position:relative">
            <label>بحث عن عميل مسجل</label>
            <input type="text" id="tx-client-q" placeholder="اكتب الاسم أو الهاتف…" autocomplete="off">
            <div id="tx-suggest" class="suggest hidden"></div>
            <div id="tx-client-chip" style="margin-top:6px"></div>
          </div>
          <label>أو اسم العميل (غير مسجل / عابر)
            <input type="text" id="tx-client-name" placeholder="الاسم الكامل" autocomplete="off">
          </label>
          <label>هاتف العميل
            <input type="text" id="tx-client-phone" placeholder="09…" class="mono">
          </label>
        </div>
        <label>ملاحظة (اختياري)
          <input type="text" id="tx-note" placeholder="مثال: فئة 20/50 دولار…">
        </label>
        <div style="display:flex; gap:10px; align-items:center; margin-top:14px">
          <button class="btn-gold" style="width:auto; padding:9px 26px" type="submit">حفظ المعاملة</button>
          <span class="form-hint">تُحفظ فوراً في قاعدة البيانات مع اسم الموظف المسجّل</span>
        </div>
      </form>
    </div>
    <div class="card">
      <div class="card-head"><h3>سجل المعاملات</h3>
        <div class="filters">
          <div class="f-item"><label>من</label><input type="date" id="f-from" value="${txState.from}"></div>
          <div class="f-item"><label>إلى</label><input type="date" id="f-to" value="${txState.to}"></div>
          <div class="f-item"><label>النوع</label>
            <select id="f-type"><option value="">الكل</option>${Object.entries(types).map(([k, v]) => `<option value="${k}" ${txState.type === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
          </div>
          <div class="f-item"><label>بحث</label><input type="text" id="f-q" value="${esc(txState.q)}" placeholder="اسم / هاتف عميل"></div>
          <button class="btn-ghost" id="f-apply" type="button">عرض</button>
          <button class="btn-ghost" id="f-reset" type="button">اليوم</button>
        </div>
      </div>
      <div id="tx-list"><div class="empty">…</div></div>
    </div>`;
  syncCurrencySelect($('#tx-type').value);
  bindTxForm();
  refreshTxList();
}

async function loadTxMeta() {
  try {
    const d = await api('/api/transactions?limit=1');
    meta = { txTypes: d.txTypes || FALLBACK_TYPES, currencies: d.currencies || [] };
  } catch { /* تبقى الافتراضية */ }
}

function syncCurrencySelect(type) {
  const cur = $('#tx-cur');
  const rate = $('#tx-rate');
  const isCash = type === 'buy' || type === 'sell';
  const isVoda = type === 'voda_cash';
  if (isCash) {
    cur.innerHTML = CASH_CURRENCIES.map((x) => `<option>${x}</option>`).join('');
    cur.disabled = false;
    rate.value = ''; rate.disabled = false;
    rate.placeholder = 'مثال 9.25';
  } else {
    const only = isVoda ? 'VODA' : 'LYD';
    cur.innerHTML = `<option>${only}</option>`;
    cur.disabled = true;
    rate.value = '1'; rate.disabled = true;
  }
  updateLydPreview();
}

function updateLydPreview() {
  const type = $('#tx-type')?.value;
  const amount = parseFloat($('#tx-amount')?.value);
  const rate = parseFloat($('#tx-rate')?.value);
  const out = $('#tx-lyd');
  if (!out) return;
  if (Number.isFinite(amount) && amount > 0 && Number.isFinite(rate) && rate > 0) {
    out.value = fmtNum(amount * rate);
  } else out.value = '';
}

let txClient = null;
function bindTxForm() {
  const typeSel = $('#tx-type');
  typeSel.addEventListener('change', () => syncCurrencySelect(typeSel.value));
  ['tx-amount', 'tx-rate'].forEach((id) => $(`#${id}`).addEventListener('input', updateLydPreview));

  // اقتراحات العملاء
  let deb = null;
  $('#tx-client-q').addEventListener('input', (e) => {
    clearTimeout(deb);
    deb = setTimeout(async () => {
      const q = e.target.value.trim();
      const box = $('#tx-suggest');
      if (q.length < 2) { box.classList.add('hidden'); box.innerHTML = ''; return; }
      try {
        const { clients } = await api('/api/clients?q=' + encodeURIComponent(q));
        if (clients.length === 0) {
          box.innerHTML = '<div class="empty" style="padding:10px">لا يوجد عميل بهذا الاسم — اكتبه في حقل «أو اسم العميل»</div>';
        } else {
          box.innerHTML = clients.map((cl) => `
            <button type="button" data-cid="${cl.id}" data-name="${esc(cl.full_name)}" data-phone="${esc(cl.phone)}">
              ${esc(cl.full_name)} <small>${esc(cl.phone || '—')}</small></button>`).join('');
        }
        box.classList.remove('hidden');
        $$('button[data-cid]', box).forEach((b) => b.addEventListener('click', () => {
          txClient = { id: b.dataset.cid, name: b.dataset.name, phone: b.dataset.phone };
          $('#tx-client-q').value = '';
          box.classList.add('hidden');
          $('#tx-client-name').value = txClient.name;
          $('#tx-client-phone').value = txClient.phone;
          $('#tx-client-chip').innerHTML = `<span class="chip-selected">✓ ${esc(txClient.name)} — عميل مسجّل
            <button type="button" id="tx-client-clear" title="إلغاء">✕</button></span>`;
          $('#tx-client-clear').addEventListener('click', () => { txClient = null; $('#tx-client-chip').innerHTML = ''; });
        }));
      } catch { /* تجاهل */ }
    }, 300);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#tx-client-q') && !e.target.closest('#tx-suggest')) {
      $('#tx-suggest')?.classList.add('hidden');
    }
  }, { once: false });

  $('#tx-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = parseFloat($('#tx-amount').value);
    const rate = parseFloat($('#tx-rate').value);
    const body = {
      tx_type: $('#tx-type').value,
      currency: $('#tx-cur').value,
      amount,
      rate: Number.isFinite(rate) && rate > 0 ? rate : 0,
      note: $('#tx-note').value.trim(),
    };
    if (txClient) body.client_id = Number(txClient.id);
    body.client_name = ($('#tx-client-name').value || '').trim();
    body.client_phone = ($('#tx-client-phone').value || '').trim();
    if (!body.client_name) { toast('أدخل اسم العميل', true); return; }
    if (!Number.isFinite(amount) || amount <= 0) { toast('أدخل مبلغاً صحيحاً', true); return; }
    try {
      const { transaction } = await api('/api/transactions', { method: 'POST', body });
      toast('✓ تم حفظ المعاملة');
      $('#tx-amount').value = ''; $('#tx-rate').value = ''; $('#tx-note').value = '';
      $('#tx-lyd').value = '';
      if (!txClient) { $('#tx-client-name').value = ''; $('#tx-client-phone').value = ''; }
      refreshTxList();
      openReceipt(transaction); // عرض فاتورة الزبون مباشرة بعد الحفظ
    } catch (err) { toast(err.message, true); }
  });

  $('#f-apply').addEventListener('click', refreshTxList);
  $('#f-reset').addEventListener('click', () => {
    txState = { from: today(), to: today(), type: '', q: '' };
    $('#f-from').value = txState.from; $('#f-to').value = txState.to;
    $('#f-type').value = ''; $('#f-q').value = '';
    refreshTxList();
  });
}

async function refreshTxList() {
  txState.from = $('#f-from').value || today();
  txState.to = $('#f-to').value || today();
  txState.type = $('#f-type').value || '';
  txState.q = $('#f-q').value.trim();
  const params = new URLSearchParams({ from: txState.from, to: txState.to, limit: '200' });
  if (txState.type) params.set('type', txState.type);
  if (txState.q) params.set('q', txState.q);
  try {
    const { list } = await api('/api/transactions?' + params.toString());
    $('#tx-list').innerHTML = list.length
      ? `${txTable(list)}<div style="padding:8px 4px 0" class="form-hint">${list.length} معاملة</div>`
      : '<div class="empty">لا توجد معاملات في هذا النطاق</div>';
  } catch (err) { toast(err.message, true); }
}

/* ---------- ═══ العملاء ═══ ---------- */
let clientQuery = '';
async function viewClients() {
  const c = $('#content');
  c.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>بحث عن عميل</h3>
        <button class="btn-ghost gold" id="toggle-add-client">＋ إضافة عميل جديد</button>
      </div>
      <div class="search-row">
        <input type="text" id="client-q" value="${esc(clientQuery)}" placeholder="ابحث بالاسم أو رقم الهاتف أو رقم الهوية…">
        <button class="btn-ghost" id="client-search">بحث</button>
      </div>
      <div id="add-client-card" class="hidden card" style="margin-top:14px; border-style:dashed">
        <h4 style="margin-bottom:10px">عميل جديد</h4>
        <form id="add-client-form" class="form-row-2">
          <label>الاسم الكامل *<input type="text" id="nc-name" required></label>
          <label>الهاتف<input type="text" id="nc-phone" class="mono"></label>
          <label>رقم الهوية / الجواز<input type="text" id="nc-idnum"></label>
          <label>النوع<select id="nc-type"><option value="individual">فرد</option><option value="company">شركة / مؤسسة</option></select></label>
          <label>ملاحظات<input type="text" id="nc-notes"></label>
          <button class="btn-gold" style="width:auto; align-self:end; padding:9px 22px" type="submit">حفظ العميل</button>
        </form>
      </div>
    </div>
    <div id="client-results"><div class="card"><div class="empty">اكتب للبحث…</div></div></div>`;

  $('#toggle-add-client').addEventListener('click', () => {
    const box = $('#add-client-card');
    box.classList.toggle('hidden');
    if (!box.classList.contains('hidden')) $('#nc-name').focus();
  });
  $('#client-search').addEventListener('click', refreshClients);
  $('#client-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') refreshClients(); });
  $('#add-client-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/clients', {
        method: 'POST',
        body: {
          full_name: $('#nc-name').value, phone: $('#nc-phone').value,
          id_number: $('#nc-idnum').value, client_type: $('#nc-type').value,
          notes: $('#nc-notes').value,
        },
      });
      toast('✓ تمت إضافة العميل');
      e.target.reset();
      $('#add-client-card').classList.add('hidden');
      refreshClients();
    } catch (err) { toast(err.message, true); }
  });
  if (clientQuery) refreshClients();
}

async function refreshClients() {
  clientQuery = $('#client-q').value.trim();
  const box = $('#client-results');
  box.innerHTML = '<div class="card"><div class="empty">…</div></div>';
  try {
    const { clients } = await api('/api/clients?q=' + encodeURIComponent(clientQuery));
    if (!clients.length) { box.innerHTML = '<div class="card"><div class="empty">لا يوجد عميل مطابق</div></div>'; return; }
    box.innerHTML = `<div class="card"><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>الاسم</th><th>الهاتف</th><th>رقم الهوية</th><th>النوع</th><th>أُضيف</th><th></th></tr></thead><tbody>
      ${clients.map((cl) => `<tr>
        <td><b>${esc(cl.full_name)}</b></td>
        <td class="mono">${esc(cl.phone || '—')}</td>
        <td class="mono">${esc(cl.id_number || '—')}</td>
        <td>${cl.client_type === 'company' ? 'شركة' : 'فرد'}</td>
        <td class="mono">${String(cl.created_at || '').slice(0, 10)}</td>
        <td><button class="btn-ghost btn-sm" data-client="${cl.id}">السجل الكامل</button></td>
      </tr>`).join('')}</tbody></table></div></div>`;
    $$('[data-client]').forEach((b) => b.addEventListener('click', () => clientProfile(b.dataset.client)));
  } catch (err) { toast(err.message, true); }
}

async function clientProfile(id) {
  $('#content').innerHTML = '<div class="card"><div class="empty">… جارٍ التحميل</div></div>';
  try {
    const { client } = await api('/api/clients/' + id);
    const types = meta.txTypes;
    const totalLyd = client.transactions.reduce((s, t) => s + t.lyd_value, 0);
    const c = $('#content');
    c.innerHTML = `
      <div class="card">
        <div class="card-head">
          <div><h3>${esc(client.full_name)}</h3>
            <p class="card-sub">${esc(client.phone || '—')} · هوية: ${esc(client.id_number || '—')} · ${client.client_type === 'company' ? 'شركة' : 'فرد'}
            ${client.notes ? '· ' + esc(client.notes) : ''}</p>
          </div>
          <button class="btn-ghost" id="back-clients">← رجوع للبحث</button>
        </div>
        <div class="grid-cards" style="margin-bottom:0">
          <div class="stat-card"><div class="st-label">عدد المعاملات</div><div class="st-value">${client.transactions.length}</div></div>
          <div class="stat-card"><div class="st-label">إجمالي القيمة (د.ل)</div><div class="st-value">${fmtNum(totalLyd)}</div></div>
        </div>
      </div>
      <div class="card"><h3 style="margin-bottom:12px">سجل معاملاته</h3>
        ${client.transactions.length ? txTable(client.transactions) : '<div class="empty">لا توجد معاملات لهذا العميل بعد</div>'}
      </div>`;
    $('#back-clients').addEventListener('click', viewClients);
  } catch (err) { toast(err.message, true); }
}

/* ---------- ═══ التقارير (مدير) ═══ ---------- */
let repRange = { from: today(), to: today() };

async function viewReports() {
  const c = $('#content');
  c.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>نطاق التقرير</h3>
        <div class="quick-pills" id="rep-presets">
          <button data-r="today">اليوم</button>
          <button data-r="7">آخر 7 أيام</button>
          <button data-r="month">هذا الشهر</button>
        </div>
      </div>
      <div class="filters">
        <div class="f-item"><label>من</label><input type="date" id="r-from" value="${repRange.from}"></div>
        <div class="f-item"><label>إلى</label><input type="date" id="r-to" value="${repRange.to}"></div>
        <button class="btn-ghost" id="r-apply" type="button">عرض التقرير</button>
        <button class="btn-ghost gold" id="r-csv" type="button">⭳ تصدير CSV (Excel)</button>
        <button class="btn-ghost" id="r-print" type="button">🖨 طباعة</button>
      </div>
    </div>
    <div id="rep-body"><div class="card"><div class="empty">…</div></div></div>`;

  $('#rep-presets').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const r = b.dataset.r;
    repRange = r === 'today' ? { from: today(), to: today() }
      : r === '7' ? { from: daysAgo(6), to: today() }
      : { from: monthStart(), to: today() };
    $('#r-from').value = repRange.from; $('#r-to').value = repRange.to;
    refreshReport();
  });
  $('#r-apply').addEventListener('click', () => {
    repRange = { from: $('#r-from').value || today(), to: $('#r-to').value || today() };
    refreshReport();
  });
  $('#r-print').addEventListener('click', () => window.print());
  refreshReport();
}

let lastReport = null;
async function refreshReport() {
  const box = $('#rep-body');
  box.innerHTML = '<div class="card"><div class="empty">…</div></div>';
  const q = `from=${repRange.from}&to=${repRange.to}`;
  try {
    const [sum, daily] = await Promise.all([api('/api/reports/summary?' + q), api('/api/reports/daily?' + q)]);
    lastReport = { sum, days: daily.days };
    const types = meta.txTypes;
    const typeRows = Object.keys(sum.byType).map((k) => {
      const b = sum.byType[k];
      const curDetail = Object.entries(b.currencies).map(([cur, c2]) =>
        `${cur}: ${c2.count} عملية (${fmtNum(c2.lyd)} د.ل)`).join(' · ');
      return `<tr>
        <td><span class="tag ${TYPE_TAG[k]}">${esc(types[k] || k)}</span></td>
        <td class="num">${b.count}</td>
        <td class="num">${fmtNum(b.lyd)}</td>
        <td style="font-size:12px; color:var(--ink-soft)">${esc(curDetail)}</td>
      </tr>`;
    }).join('');

    box.innerHTML = `
      <div class="grid-cards" style="margin-top:18px">
        <div class="stat-card"><div class="st-label">عدد المعاملات</div><div class="st-value">${sum.count}</div></div>
        <div class="stat-card"><div class="st-label">إجمالي القيمة (د.ل)</div><div class="st-value">${fmtNum(sum.lyd)}</div></div>
        <div class="stat-card"><div class="st-label">النطاق</div><div style="font-size:13px; padding-top:6px">${repRange.from} ← ${repRange.to}</div></div>
      </div>
      <div class="card"><h3>ملخص حسب نوع العملية</h3>
        ${typeRows ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>النوع</th><th>العدد</th><th>إجمالي د.ل</th><th>تفصيل العملات</th></tr></thead><tbody>${typeRows}</tbody></table></div>`
        : '<div class="empty">لا توجد معاملات في هذا النطاق</div>'}
      </div>
      <div class="card"><h3>توزيع يومي</h3>
        ${daily.days.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>اليوم</th><th>العدد</th><th>إجمالي د.ل</th><th>التفصيل</th></tr></thead><tbody>
          ${daily.days.map((d2) => `<tr>
            <td class="mono">${d2.day}</td><td class="num">${d2.count}</td><td class="num">${fmtNum(d2.lyd)}</td>
            <td style="font-size:12px; color:var(--ink-soft)">${Object.entries(d2.types).map(([k, v]) => `${esc(types[k] || k)}×${v.count}`).join(' · ')}</td>
          </tr>`).join('')}</tbody></table></div>`
        : '<div class="empty">لا بيانات يومية</div>'}
      </div>`;
  } catch (err) { toast(err.message, true); }
}

$('#content').addEventListener('click', (e) => {
  const btn = e.target.closest('#r-csv');
  if (!btn) return;
  exportCsv();
});
function exportCsv() {
  if (!lastReport) return;
  const types = meta.txTypes;
  const rows = [['النوع', 'العملة', 'العدد', 'المبلغ', 'القيمة د.ل']];
  for (const r of lastReport.sum.rows || []) {
    rows.push([types[r.tx_type] || r.tx_type, r.currency, r.cnt, r.total_amount, r.total_lyd]);
  }
  const data = '\uFEFF' + rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'text/csv;charset=utf-8' }));
  a.download = `تقرير-الوثاق-${repRange.from}-${repRange.to}.csv`;
  a.click();
}

/* ---------- ═══ المستخدمون (مدير) ═══ ---------- */
async function viewUsers() {
  const c = $('#content');
  c.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>إضافة مستخدم</h3></div>
      <form id="add-user-form" class="form-row-2">
        <label>الاسم الكامل *<input type="text" id="nu-name" required></label>
        <label>اسم المستخدم *<input type="text" id="nu-username" required placeholder="3 أحرف فأكثر" class="mono"></label>
        <label>الصلاحية<select id="nu-role"><option value="employee">موظف — تسجيل معاملات فقط</option><option value="manager">مدير — كل الصلاحيات والتقارير</option></select></label>
        <label>كلمة المرور *<input type="text" id="nu-pass" required minlength="6" placeholder="6 أحرف على الأقل"></label>
        <button class="btn-gold" style="width:auto; align-self:end; padding:9px 24px" type="submit">إنشاء الحساب</button>
      </form>
    </div>
    <div class="card"><h3>المستخدمون الحاليون</h3><div id="users-list"><div class="empty">…</div></div></div>`;

  $('#add-user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/users', {
        method: 'POST',
        body: {
          full_name: $('#nu-name').value, username: $('#nu-username').value.trim(),
          role: $('#nu-role').value, password: $('#nu-pass').value,
        },
      });
      toast('✓ تم إنشاء الحساب');
      e.target.reset();
      refreshUsers();
    } catch (err) { toast(err.message, true); }
  });
  refreshUsers();
}

async function refreshUsers() {
  const box = $('#users-list');
  try {
    const { users } = await api('/api/users');
    box.innerHTML = users.map((u) => `
      <div class="user-row" data-uid="${u.id}">
        <div style="width:180px"><div class="u-name">${esc(u.full_name)}</div><div class="u-user">@${esc(u.username)}</div></div>
        <select class="u-role" style="width:110px" ${u.id === me.id ? 'disabled title="لا يمكن تغيير صلاحية حسابك الحالي"' : ''}>
          <option value="employee" ${u.role === 'employee' ? 'selected' : ''}>موظف</option>
          <option value="manager" ${u.role === 'manager' ? 'selected' : ''}>مدير</option>
        </select>
        <label style="display:flex; gap:6px; align-items:center; margin:0; font-weight:600; width:110px">
          <input type="checkbox" class="u-active" ${u.active ? 'checked' : ''} ${u.id === me.id ? 'disabled' : ''} style="width:auto">
          مفعّل
        </label>
        <div class="spacer"></div>
        <span class="badge-role ${u.role}" style="font-size:11px">${u.role === 'manager' ? 'مدير' : 'موظف'}</span>
        <button class="btn-ghost btn-sm u-pass">🔑 كلمة مرور جديدة</button>
      </div>`).join('') || '<div class="empty">لا مستخدمين</div>';

    $$('.user-row').forEach((row) => {
      const id = row.dataset.uid;
      const sel = $('.u-role', row);
      const chk = $('.u-active', row);
      sel?.addEventListener('change', async () => {
        try { await api('/api/users/' + id, { method: 'PATCH', body: { role: sel.value } }); toast('✓ تم تحديث الصلاحية'); refreshUsers(); }
        catch (err) { toast(err.message, true); refreshUsers(); }
      });
      chk?.addEventListener('change', async () => {
        try { await api('/api/users/' + id, { method: 'PATCH', body: { active: chk.checked } }); toast(chk.checked ? '✓ تم التفعيل' : 'تم التعطيل'); refreshUsers(); }
        catch (err) { toast(err.message, true); refreshUsers(); }
      });
      $('.u-pass', row)?.addEventListener('click', async () => {
        const pw = prompt(`كلمة مرور جديدة للمستخدم: ${$('.u-name', row).textContent}`);
        if (!pw) return;
        try { await api('/api/users/' + id, { method: 'PATCH', body: { password: pw } }); toast('✓ تم تغيير كلمة المرور'); }
        catch (err) { toast(err.message, true); }
      });
    });
  } catch (err) { toast(err.message, true); }
}

/* ---------- ═══ إقفال اليوم / الجرد النقدي (مدير) ═══ ---------- */
let setDay = today();

async function viewSettlement() {
  const c = $('#content');
  c.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>يوم الإقفال</h3>
        <div class="filters">
          <div class="f-item"><label>اليوم</label><input type="date" id="s-day" value="${setDay}"></div>
          <button class="btn-ghost" id="s-load" type="button">عرض</button>
        </div>
      </div>
    </div>
    <div id="s-body"><div class="card"><div class="empty">… جارٍ التحميل</div></div></div>`;
  $('#s-day').addEventListener('change', () => { setDay = $('#s-day').value || today(); refreshSettlement(); });
  $('#s-load').addEventListener('click', () => { setDay = $('#s-day').value || today(); refreshSettlement(); });
  refreshSettlement();
}

async function refreshSettlement() {
  const box = $('#s-body');
  box.innerHTML = '<div class="card"><div class="empty">…</div></div>';
  let d;
  try { d = await api('/api/settlement?day=' + setDay); }
  catch (err) { box.innerHTML = `<div class="card"><div class="empty">${esc(err.message)}</div></div>`; return; }

  const reg = d.register;
  const closed = reg.counted_lyd != null;
  const sign = (n) => (n > 0 ? '+' : '') + fmtNum(n);
  const varCls = d.variance == null ? '' : (Math.abs(d.variance) < 0.005 ? 'ok' : (d.variance > 0 ? 'pos' : 'neg'));
  const varTxt = d.variance == null ? 'لم يُقفل بعد' : `${sign(d.variance)} د.ل ${Math.abs(d.variance) < 0.005 ? '(مطابق ✓)' : (d.variance > 0 ? 'زيادة' : 'عجز')}`;

  const types = meta.txTypes;
  const byTypeRows = Object.keys(d.tx.byType).map((k) => {
    const b = d.tx.byType[k];
    const eff = (TX_EFFECT_SIGN[k] || 0) === -1 ? 'صادر' : 'وارد';
    return `<tr><td><span class="tag ${TYPE_TAG[k]}">${esc(types[k] || k)}</span></td>
      <td class="num">${b.count}</td><td class="num">${fmtNum(b.lyd)}</td><td>${eff}</td></tr>`;
  }).join('');
  const curRows = d.tx.byCurrency.map((r) =>
    `<tr><td><span class="tag cur">${esc(r.currency)}</span></td><td class="num">${fmtNum(r.in)}</td><td class="num">${fmtNum(r.out)}</td><td class="num">${r.count}</td></tr>`).join('');

  box.innerHTML = `
    <div class="grid-cards" style="margin-top:18px">
      <div class="stat-card"><div class="st-label">معاملات اليوم</div><div class="st-value">${d.tx.count}</div>
        <div class="st-sub">الأثر النقدي: ${sign(d.tx.effect)} د.ل</div></div>
      <div class="stat-card"><div class="st-label">النقد المتوقع (محسوب)</div><div class="st-value">${fmtNum(d.expected)}</div>
        <div class="st-sub">رصيد بداية + معاملات + تعديلات</div></div>
      <div class="stat-card"><div class="st-label">النقد المعدود</div><div class="st-value">${closed ? fmtNum(reg.counted_lyd) : '—'}</div>
        <div class="st-sub">${closed ? 'أُقفل الساعة ' + (reg.closed_at || '').slice(11, 16) : 'لم يُقفل بعد'}</div></div>
      <div class="stat-card"><div class="st-label">الفرق</div><div class="st-value ${varCls}">${varTxt}</div>
        <div class="st-sub">المعدود − المتوقع</div></div>
    </div>

    <div class="card">
      <div class="card-head"><h3>سجل اليوم (دينار نقدي)</h3></div>
      <form id="s-reg-form" class="form-row-2">
        <label>رصيد البداية (د.ل)<input type="number" id="s-opening" step="any" min="0" value="${fmtNum(reg.opening_lyd, 2)}"></label>
        <label>النقد المعدود عند الإقفال (د.ل)
          <input type="number" id="s-counted" step="any" min="0" value="${closed ? fmtNum(reg.counted_lyd, 2) : ''}" placeholder="أدخل ما عُدّ فعلاً">
        </label>
        <label>ملاحظات<input type="text" id="s-notes" value="${esc(reg.notes)}" placeholder="مثال: أُودع مبلغ في البنك…"></label>
        <div style="display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap">
          <button class="btn-gold" type="submit" style="width:auto; padding:9px 24px">${closed ? 'تحديث السجل' : 'حفظ / إقفال اليوم'}</button>
          ${closed ? '<button type="button" class="btn-ghost" id="s-reopen">↺ إلغاء الإقفال</button>' : ''}
        </div>
      </form>
      <p class="form-hint" style="margin-top:10px">المتوقع = رصيد البداية + أثر المعاملات + الإيداعات − السحوبات. عند حفظ النقد المعدود يُقفل اليوم ويُحسب الفرق.</p>
    </div>

    <div class="card">
      <div class="card-head"><h3>تعديلات نقدية (إيداعات / سحوبات)</h3>
        <button class="btn-ghost btn-sm" id="s-toggle-adj">＋ إضافة</button></div>
      <div id="s-adj-add" class="hidden" style="margin-bottom:12px">
        <form id="s-adj-form" class="form-row-2">
          <label>النوع<select id="s-adj-type"><option value="in">إيداع (زيادة الصندوق)</option><option value="out">سحب (نقص الصندوق)</option></select></label>
          <label>المبلغ (د.ل)<input type="number" id="s-adj-amount" step="any" min="0" required></label>
          <label>البيان<input type="text" id="s-adj-note" placeholder="مثال: تحويل إلى البنك"></label>
          <button class="btn-gold" type="submit" style="width:auto; align-self:end; padding:9px 22px">حفظ</button>
        </form>
      </div>
      ${d.adjustments.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>النوع</th><th>المبلغ (د.ل)</th><th>البيان</th><th>الوقت</th><th></th></tr></thead><tbody>
        ${d.adjustments.map((a) => `<tr>
          <td><span class="tag ${a.adj_type === 'in' ? 'buy' : 'sell'}">${a.adj_type === 'in' ? 'إيداع' : 'سحب'}</span></td>
          <td class="num">${a.adj_type === 'in' ? '+' : '−'}${fmtNum(a.amount)}</td>
          <td>${esc(a.note || '—')}</td><td class="mono">${clock(a.created_at)}</td>
          <td><button class="btn-ghost btn-sm" data-adj="${a.id}">حذف</button></td>
        </tr>`).join('')}</tbody></table></div>`
      : '<div class="empty" style="padding:12px">لا توجد تعديلات — أضف أي إيداع أو سحب نقدي خارج المعاملات.</div>'}
    </div>

    <div class="grid-cards">
      <div class="card" style="margin:0"><h3>تفصيل المعاملات (الأثر النقدي)</h3>
        ${byTypeRows ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>النوع</th><th>العدد</th><th>القيمة د.ل</th><th>الأثر</th></tr></thead><tbody>${byTypeRows}</tbody></table></div>` : '<div class="empty">لا معاملات</div>'}
      </div>
      <div class="card" style="margin:0"><h3>حركة العملات (وارد / صادر)</h3>
        ${curRows ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>العملة</th><th>وارد</th><th>صادر</th><th>عدد</th></tr></thead><tbody>${curRows}</tbody></table></div>` : '<div class="empty">لا معاملات</div>'}
      </div>
    </div>`;

  // ربط الأحداث
  $('#s-reg-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const counted = $('#s-counted').value;
    try {
      await api('/api/settlement', {
        method: 'POST',
        body: {
          day: setDay,
          opening_lyd: parseFloat($('#s-opening').value) || 0,
          counted_lyd: counted === '' ? null : parseFloat(counted),
          notes: $('#s-notes').value.trim(),
        },
      });
      toast('✓ تم حفظ سجل اليوم');
      refreshSettlement();
    } catch (err) { toast(err.message, true); }
  });
  $('#s-reopen')?.addEventListener('click', async () => {
    try { await api('/api/settlement', { method: 'POST', body: { day: setDay, counted_lyd: null } }); toast('تم إلغاء الإقفال'); refreshSettlement(); }
    catch (err) { toast(err.message, true); }
  });
  $('#s-toggle-adj').addEventListener('click', () => $('#s-adj-add').classList.toggle('hidden'));
  $('#s-adj-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/settlement/adjustments', {
        method: 'POST',
        body: {
          day: setDay, adj_type: $('#s-adj-type').value,
          amount: parseFloat($('#s-adj-amount').value) || 0,
          note: $('#s-adj-note').value.trim(),
        },
      });
      toast('✓ تمت الإضافة');
      e.target.reset();
      $('#s-adj-add').classList.add('hidden');
      refreshSettlement();
    } catch (err) { toast(err.message, true); }
  });
  $$('[data-adj]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('حذف هذا التعديل النقدي؟')) return;
    try { await api('/api/settlement/adjustments/' + b.dataset.adj, { method: 'DELETE' }); toast('تم الحذف'); refreshSettlement(); }
    catch (err) { toast(err.message, true); }
  }));
}

// إشارة الأثر النقدي لكل نوع (وارد/صادر) — نفس القاعدة في الخادم
const TX_EFFECT_SIGN = { buy: -1, sell: 1, local_transfer: 1, intl_transfer: 1, voda_cash: 1 };

/* ---------- ═══ الأسعار — تحرير مباشر (أي موظف مخوّل) ═══ ---------- */
const RATE_KEY_LABELS = {
  USD_cash: 'دولار أمريكي — نقدي', USD_bank: 'دولار أمريكي — حوالة بنكية', USD_card: 'دولار أمريكي — بطاقة',
  EUR_cash: 'يورو — نقدي', EUR_bank: 'يورو — حوالة بنكية', EUR_card: 'يورو — بطاقة',
  VODAFONE_cash: 'فودافون كاش — من نقدي', VODAFONE_bank: 'فودافون كاش — من حوالة',
};
const isManager = () => me && me.role === 'manager';

async function viewRates() {
  const c = $('#content');
  c.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>أسعار الصرف — تحرير مباشر</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-gold" id="rt-save" type="button">💾 حفظ الأسعار</button>
          <button class="btn-ghost manager-only" id="rt-import" type="button">⬇ استيراد من جدول الشركة</button>
        </div></div>
      <p class="form-hint">غيّر الأسعار هنا وسيظهر التعديل فوراً في الموقع العام والحاسبة عبر <span class="mono">/api/rates</span> — لا حاجة لفتح Google Sheets. كل رقم = كم دينار ليبي (د.ل) مقابل وحدة واحدة من العملة.</p>
    </div>
    <div id="rt-body"><div class="card"><div class="empty">… جارٍ التحميل</div></div></div>`;
  $('#rt-save').addEventListener('click', saveRatesFromForm);
  const imp = $('#rt-import');
  if (imp && !isManager()) imp.classList.add('hidden'); // الاستيراد من الجدول للمدير فقط
  if (imp) imp.addEventListener('click', async () => {
    if (!confirm('استيراد أسعار جدول الشركة سيستبدل الأسعار الحالية بالكامل. متابعة؟')) return;
    const btn = imp; btn.disabled = true; btn.textContent = '… جارٍ الاستيراد';
    try {
      renderRates(await api('/api/rates/import', { method: 'POST' }));
      toast('✓ تم استيراد الأسعار من الجدول');
    } catch (err) { toast(err.message, true); }
    finally { btn.disabled = false; btn.textContent = '⬇ استيراد من جدول الشركة'; }
  });
  loadRates();
}

async function saveRatesFromForm() {
  const rows = $$('#rt-rows tr[data-key]');
  if (!rows.length) return;
  const rates = {};
  let bad = 0;
  rows.forEach((tr) => {
    const retail = parseFloat(tr.querySelector('.rt-retail').value);
    const wholesale = parseFloat(tr.querySelector('.rt-wholesale').value);
    if (!(retail > 0)) { bad++; return; }
    rates[tr.dataset.key] = { retail, wholesale: wholesale > 0 ? wholesale : retail };
  });
  if (bad) return toast('تحقق من الأسعار — كل سعر يجب أن يكون رقماً أكبر من صفر', true);
  const btn = $('#rt-save');
  btn.disabled = true; btn.textContent = '… جارٍ الحفظ';
  try {
    renderRates(await api('/api/rates', { method: 'PUT', body: { rates } }));
    toast('✓ تم حفظ الأسعار — الموقع العام محدَّث الآن');
  } catch (err) { toast(err.message, true); }
  finally { btn.disabled = false; btn.textContent = '💾 حفظ الأسعار'; }
}

async function loadRates() {
  const box = $('#rt-body');
  box.innerHTML = '<div class="card"><div class="empty">…</div></div>';
  try { renderRates(await api('/api/rates')); }
  catch (err) { box.innerHTML = `<div class="card"><div class="empty">${esc(err.message)}</div></div>`; }
}

function renderRates(d) {
  const box = $('#rt-body');
  const when = (ts) => ts ? new Date(ts).toLocaleString('ar-LY') : '—';
  const keys = Object.keys(d.rates || {});
  box.innerHTML = `
    <div class="grid-cards" style="margin-top:18px">
      <div class="stat-card"><div class="st-label">المصدر</div><div style="padding-top:6px"><span class="tag buy">قاعدة البيانات — تحرير مباشر ✓</span></div></div>
      <div class="stat-card"><div class="st-label">عدد الأسعار</div><div class="st-value" style="font-size:17px">${d.count ?? keys.length} سعر</div></div>
      <div class="stat-card"><div class="st-label">آخر تحديث (بوابة الموظفين)</div><div class="st-value" style="font-size:17px">${when(d.updatedAt)}</div></div>
      <div class="stat-card"><div class="st-label">آخر استيراد من الجدول</div><div class="st-value" style="font-size:17px">${when(d.fetchedAt)}</div></div>
    </div>
    <div class="card">
      <h3 style="margin-bottom:12px">تعديل الأسعار (قطاعي / جملة)</h3>
      ${keys.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>العملة</th><th>قطاعي (نقدي/بيع)</th><th>جملة (بالجملة)</th></tr></thead><tbody id="rt-rows">
        ${keys.map((k) => `
          <tr data-key="${esc(k)}">
            <td><span class="tag cur">${esc(RATE_KEY_LABELS[k] || k)}</span> <span class="mono" style="opacity:.6">${esc(k)}</span></td>
            <td><input class="rt-retail rt-inp" type="number" step="any" min="0" inputmode="decimal" value="${d.rates[k].retail}"></td>
            <td><input class="rt-wholesale rt-inp" type="number" step="any" min="0" inputmode="decimal" value="${d.rates[k].wholesale}"></td>
          </tr>`).join('')}
      </tbody></table></div>`
      : '<div class="empty">لا توجد أسعار بعد — استورد من الجدول أو أضف أسعاراً</div>'}
    </div>`;
}

/* ---------- الفاتورة: إغلاق / طباعة / طباعة من الصف ---------- */
$('#receipt-close')?.addEventListener('click', closeReceipt);
$('#receipt-modal')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeReceipt(); });
$('#receipt-print')?.addEventListener('click', () => {
  document.body.classList.add('printing');
  window.print();
  document.body.classList.remove('printing');
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('.rx-print');
  if (!b) return;
  const tx = txById.get(Number(b.dataset.id));
  if (tx) openReceipt(tx);
});

/* ---------- التنقل العام ---------- */
$$('.nav-item').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
window.addEventListener('hashchange', () => {
  if (!me) return;
  const v = location.hash.slice(1);
  if (TITLES[v]) showView(v);
});

/* ---------- انطلاقة ---------- */
boot();
