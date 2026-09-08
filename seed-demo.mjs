/* تنظيف بيانات الاختبار + زرع بيانات تجريبية واقعية (يتطلب إيقاف الخادم)
   التشغيل:  node seed-demo.mjs   (والخادم متوقف) */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
mkdirSync(path.join(__dirname, 'data'), { recursive: true });
const db = new DatabaseSync(path.join(__dirname, 'data', 'alwathaq.db'));

db.exec('PRAGMA foreign_keys = ON;');
// مسح بيانات التجارب
db.exec('DELETE FROM transactions; DELETE FROM clients;');
db.exec("DELETE FROM users WHERE username NOT IN ('admin','employee');");

const now = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const daysAgo = (n, hhmm) => {
  const d = new Date(Date.now() - n * 86400000);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${hhmm}:00`;
};

const insClient = db.prepare('INSERT INTO clients (full_name, phone, id_number, client_type, notes) VALUES (?,?,?,?,?)');
const c1 = Number(insClient.run('محمد العائب', '091-1234567', '123456', 'individual', '').lastInsertRowid);
const c2 = Number(insClient.run('سالمة المبروك', '092-7654321', '234567', 'individual', 'عميلة متكررة — حوالات أسبوعية').lastInsertRowid);
const c3 = Number(insClient.run('شركة الأمانة للاستيراد', '091-3332211', '445566', 'company', 'تعامل بالجملة — دولار ويورو').lastInsertRowid);

const insTx = db.prepare(`INSERT INTO transactions
  (tx_type, currency, amount, rate, lyd_value, client_id, client_name, client_phone, user_id, note, created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
const tx = (t) => {
  t.rate = t.rate || 0;
  t.lyd = Math.round(t.amount * (t.rate || 1) * 1000) / 1000;
  insTx.run(t.type, t.cur, t.amount, t.rate, t.lyd,
    t.cid ?? null, t.name ?? '', t.phone ?? '', t.user ?? 1, t.note ?? '', t.at);
};

tx({ type: 'sell', cur: 'USD', amount: 1000, rate: 9.52, cid: c1, user: 2, at: daysAgo(0, '09:15') });
tx({ type: 'buy', cur: 'EUR', amount: 1500, rate: 10.75, cid: c2, user: 1, at: daysAgo(0, '10:40') });
tx({ type: 'local_transfer', cur: 'LYD', amount: 3000, rate: 1, cid: c3, user: 1, note: 'حوالة إلى بنك التجارة', at: daysAgo(0, '12:05') });
tx({ type: 'voda_cash', cur: 'VODA', amount: 250, rate: 1, cid: c2, user: 2, at: daysAgo(0, '12:50') });
tx({ type: 'intl_transfer', cur: 'LYD', amount: 1200, rate: 1, cid: c1, user: 2, note: 'حوالة إلى تركيا', at: daysAgo(0, '14:10') });
tx({ type: 'sell', cur: 'USD', amount: 700, rate: 9.48, cid: c1, user: 2, at: daysAgo(2, '17:30') });
tx({ type: 'buy', cur: 'GBP', amount: 400, rate: 12.6, cid: c2, user: 1, at: daysAgo(3, '11:00') });
tx({ type: 'sell', cur: 'EUR', amount: 800, rate: 10.6, cid: c3, user: 1, at: daysAgo(5, '10:20') });

console.log('تم زرع بيانات تجريبية نظيفة: 3 عملاء و 8 معاملات موزعة على 6 أيام.');
db.close();
