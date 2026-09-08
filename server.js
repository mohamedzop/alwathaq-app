/* =========================================================================
 * الوثاق للصرافة — تطبيق واحد متكامل
 * الموقع العام (site/) + بوابة الموظفين (portal/) + قاعدة بيانات SQLite
 *
 * التشغيل:  node server.js            (ثم افتح http://localhost:8123)
 * يعتمد فقط على مكتبات Node المدمجة — بدون npm install.
 * ========================================================================= */
import http from 'node:http';
import { mkdirSync } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = (() => { const p = Number(process.env.PORT); return Number.isInteger(p) && p > 0 ? p : 8123; })();
const SITE_DIR = path.join(__dirname, 'site');
const PORTAL_DIR = path.join(__dirname, 'portal');
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'alwathaq.db');

/* ------------------------------------------------------------------ *
 *  قاعدة البيانات — الإنشاء والجداول
 * ------------------------------------------------------------------ */
mkdirSync(path.dirname(DB_PATH), { recursive: true }); // تأكد وجود مجلد القرص الدائم
mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  full_name     TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('manager','employee')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS clients (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name   TEXT NOT NULL,
  phone       TEXT NOT NULL DEFAULT '',
  id_number   TEXT NOT NULL DEFAULT '',
  client_type TEXT NOT NULL DEFAULT 'individual' CHECK (client_type IN ('individual','company')),
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_type      TEXT NOT NULL CHECK (tx_type IN ('buy','sell','local_transfer','intl_transfer','voda_cash')),
  currency     TEXT NOT NULL,
  amount       REAL NOT NULL CHECK (amount >= 0),
  rate         REAL NOT NULL DEFAULT 0,
  lyd_value    REAL NOT NULL DEFAULT 0,
  client_id    INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  client_name  TEXT NOT NULL DEFAULT '',
  client_phone TEXT NOT NULL DEFAULT '',
  user_id      INTEGER NOT NULL REFERENCES users(id),
  note         TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_tx_created ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_tx_client  ON transactions(client_id);
CREATE INDEX IF NOT EXISTS idx_tx_user    ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_idnum  ON clients(id_number);

-- إقفال اليوم / مطابقة النقد (سجل يومي + حركات تعديل نقدية)
CREATE TABLE IF NOT EXISTS cash_days (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  day         TEXT NOT NULL UNIQUE,               -- YYYY-MM-DD
  opening_lyd REAL NOT NULL DEFAULT 0,            -- النقد المتوفر صباحاً (د.ل)
  counted_lyd REAL,                               -- النقد المعدود عند الإقفال (د.ل) — فارغ = لم يُقفل
  closed_at   TEXT,
  notes       TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS cash_adjustments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  day        TEXT NOT NULL REFERENCES cash_days(day) ON DELETE CASCADE,
  adj_type   TEXT NOT NULL CHECK (adj_type IN ('in','out')),
  amount     REAL NOT NULL CHECK (amount > 0),
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_cash_adj_day ON cash_adjustments(day);

-- أسعار الصرف الحالية (تُحرَّر من بوابة الموظفين — المصدر الأساسي)
CREATE TABLE IF NOT EXISTS rates (
  key        TEXT PRIMARY KEY,
  retail     REAL NOT NULL DEFAULT 0,
  wholesale  REAL NOT NULL DEFAULT 0,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- إعدادات وبيانات وصفية بسيطة (مثال: آخر استيراد من جدول الشركة)
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
`);

/* ------------------------------------------------------------------ *
 *  كلمات المرور (scrypt) وزرع أول مستخدمين
 * ------------------------------------------------------------------ */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `${salt}$${hash}`;
}
function verifyPassword(pw, stored) {
  try {
    const [salt, hash] = String(stored).split('$');
    const candidate = crypto.scryptSync(String(pw), salt, 64);
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), candidate);
  } catch {
    return false;
  }
}

function seedUsers() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count === 0) {
    const ins = db.prepare(
      'INSERT INTO users (username, full_name, password_hash, role) VALUES (?,?,?,?)'
    );
    ins.run('admin', 'مدير النظام', hashPassword('admin123'), 'manager');
    ins.run('employee', 'موظف الصرافة', hashPassword('emp123'), 'employee');
    console.log('──────────────────────────────────────────────');
    console.log('  تم إنشاء قاعدة البيانات وحسابات أولية (غيّرها فوراً):');
    console.log('  المدير   → admin   / admin123   (صلاحية كاملة)');
    console.log('  موظف     → employee / emp123     (تسجيل معاملات فقط)');
    console.log('──────────────────────────────────────────────');
  }
}
seedUsers();

if (process.argv.includes('--reset-db')) {
  db.exec('DROP TABLE IF EXISTS cash_adjustments; DROP TABLE IF EXISTS cash_days; DROP TABLE IF EXISTS transactions; DROP TABLE IF EXISTS clients; DROP TABLE IF EXISTS users; DROP TABLE IF EXISTS rates; DROP TABLE IF EXISTS meta;');
  console.log('تم مسح قاعدة البيانات. أعد تشغيل الخادم لإعادة إنشائها.');
  process.exit(0);
}

/* ------------------------------------------------------------------ *
 *  القوائم الثابتة (أنواع العمليات والعملات)
 * ------------------------------------------------------------------ */
const TX_TYPES = {
  buy:            'صرف — شراء عملة',
  sell:           'صرف — بيع عملة',
  local_transfer: 'حوالة داخلية',
  intl_transfer:  'حوالة دولية (تركيا / دبي)',
  voda_cash:      'فودافون كاش',
};
const CURRENCIES = ['USD', 'EUR', 'GBP', 'TRY', 'AED', 'EGP', 'TND', 'LYD', 'VODA'];

/* ------------------------------------------------------------------ *
 *  أسعار الصرف — تُحرَّر مباشرة من بوابة الموظفين (قاعدة البيانات)
 *  ------------------------------------------------------------------
 *  قاعدة البيانات (جدول rates) هي المصدر الأساسي للأسعار المعروضة في
 *  الموقع العام (/api/rates) والحاسبة. يعدّلها الموظفون المخوّلون من
 *  داخل البوابة مباشرة — بدون فتح Google Sheets.
 *
 *  جدول الشركة اختياري الآن: زر «استيراد من الجدول» (مدير فقط) يجلب
 *  الأسعار دفعة واحدة، ويُستخدم أيضاً لزرع الأسعار أول مرة عند تشغيل
 *  نظام فارغ. يمكن تغيير الجدول عبر متغير البيئة RATES_SHEET_ID.
 *
 *  شكل الجدول المتوقع (الصف الأول عناوين، يُتجاهل):
 *    key,retail,wholesale
 *    USD_cash,9.285,9.270
 * ------------------------------------------------------------------ */
const RATES_SHEET_ID = process.env.RATES_SHEET_ID || "1zjz3SRLtyE9ELUv5AmJKI0NYEJHyuSCALaQ0-9Cgy4Y";
const RATES_SHEET_URL = `https://docs.google.com/spreadsheets/d/${RATES_SHEET_ID}/export?format=csv`;

/*
  ── أسعار الصرف: قاعدة البيانات هي المصدر الأساسي ──
  الأسعار تُحرَّر مباشرة من بوابة الموظفين (لا حاجة لفتح Google Sheets).
  جدول الشركة اختياري الآن: يُستخدم فقط كأداة «استيراد لمرة واحدة» من
  قبل المدير، ولزرع الأسعار أول مرة عند بدء تشغيل نظام فارغ.

  المفاتيح المعروفة (شكلها ثابت ومتوافق مع الموقع العام):
    USD_cash, USD_bank, USD_card, EUR_cash, EUR_bank, EUR_card,
    VODAFONE_cash, VODAFONE_bank ...
*/
const FALLBACK_RATES = {
  USD_cash:       { retail: 9.24,  wholesale: 9.20 },
  USD_bank:       { retail: 8.90,  wholesale: 8.86 },
  USD_card:       { retail: 8.65,  wholesale: 8.60 },
  EUR_cash:       { retail: 10.73, wholesale: 10.68 },
  EUR_bank:       { retail: 10.30, wholesale: 10.25 },
  EUR_card:       { retail: 10.00, wholesale: 9.95 },
  VODAFONE_cash:  { retail: 1.00,  wholesale: 1.00 },
  VODAFONE_bank:  { retail: 1.00,  wholesale: 1.00 },
};

function getMeta(k, def = null) {
  const r = db.prepare('SELECT v FROM meta WHERE k = ?').get(k);
  return r ? r.v : def;
}
function setMeta(k, v) {
  db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v);
}

function loadRatesFromDb() {
  const rows = db.prepare('SELECT key, retail, wholesale, updated_at FROM rates ORDER BY key').all();
  const rates = {};
  let updatedAt = null;
  for (const r of rows) {
    rates[r.key] = { retail: r.retail, wholesale: r.wholesale };
    if (!updatedAt || r.updated_at > updatedAt) updatedAt = r.updated_at;
  }
  return { rates, updatedAt };
}

function saveRates(ratesObj, userId) {
  const stmt = db.prepare(`INSERT INTO rates (key, retail, wholesale, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET retail = excluded.retail, wholesale = excluded.wholesale,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at`);
  const now = localNow();
  let saved = 0;
  for (const [key, r] of Object.entries(ratesObj)) {
    const retail = num(r && r.retail);
    if (!(retail > 0)) continue;
    const wholesale = num(r && r.wholesale);
    stmt.run(String(key), retail, wholesale > 0 ? wholesale : retail, userId, now);
    saved++;
  }
  return saved;
}

function parseRatesCsv(text) {
  const rates = {};
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  lines.slice(1).forEach((line) => { // الصف الأول عناوين
    const cols = line.split(',');
    if (cols.length < 2) return;
    const key = (cols[0] || '').trim();
    const retail = parseFloat((cols[1] || '').trim());
    const wholesale = cols[2] ? parseFloat((cols[2] || '').trim()) : retail;
    if (key && Number.isFinite(retail) && retail > 0) {
      rates[key] = { retail, wholesale: Number.isFinite(wholesale) && wholesale > 0 ? wholesale : retail };
    }
  });
  return rates;
}

async function fetchSheetRates() {
  const res = await fetch(RATES_SHEET_URL, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('sheet http ' + res.status);
  const rates = parseRatesCsv(await res.text());
  if (Object.keys(rates).length === 0) throw new Error('empty sheet');
  return rates;
}

function ratesView() {
  const { rates, updatedAt } = loadRatesFromDb();
  const importedAt = getMeta('rates_imported_at');
  return {
    rates,
    updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
    fetchedAt: importedAt ? new Date(importedAt).toISOString() : null,
    stale: false,
    lastError: null,
    source: 'db',
    manual: true,
    ttlMinutes: null,
    count: Object.keys(rates).length,
  };
}

// زرع أولي: إن كانت قاعدة الأسعار فارغة (نظام جديد) نجلب الجدول مرة واحدة،
// وإلا نستخدم الأسعار الاحتياطية — حتى لا تظهر الأسعار فارغة أبداً.
async function seedRatesIfEmpty() {
  const { rates } = loadRatesFromDb();
  if (Object.keys(rates).length > 0) return;
  let seed = FALLBACK_RATES;
  try {
    const s = await fetchSheetRates();
    seed = s;
    console.log('تم استيراد الأسعار من جدول الشركة (' + Object.keys(s).length + ' سعر)');
  } catch (err) {
    console.log('تعذّر الوصول لجدول الشركة عند الزرع الأولي — استخدمت الأسعار الاحتياطية: ' + String((err && err.message) || err));
  }
  const n = saveRates(seed, null);
  setMeta('rates_imported_at', localNow());
  console.log('زرعت ' + n + ' سعراً في قاعدة البيانات (مصدر الأسعار الآن: بوابة الموظفين)');
}
seedRatesIfEmpty(); // لا يمنع الإقلاع — يتم في الخلفية

/* ------------------------------------------------------------------ *
 *  الجلسات
 * ------------------------------------------------------------------ */
const sessions = new Map(); // token -> { userId, expires }
const SESSION_TTL = 12 * 60 * 60 * 1000; // 12 ساعة

function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { userId, expires: Date.now() + SESSION_TTL });
  return token;
}
function getSessionUser(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expires) { sessions.delete(token); return null; }
  return s.userId;
}
const COOKIE_NAME = 'aw_session';

/* ------------------------------------------------------------------ *
 *  أدوات صغيرة
 * ------------------------------------------------------------------ */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm':  'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.txt':  'text/plain; charset=utf-8',
  '.xml':  'application/xml',
  '.map':  'application/json',
  '.pdf':  'application/pdf',
};

function num(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function asBool(v) {
  return v === true || v === 1 || v === '1' || v === 'true';
}
function cleanDateStr(v) {
  // يقبل YYYY-MM-DD فقط
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null;
}

/* ------------------------------------------------------------------ *
 *  معالجة الطلبات — (صغير بلا اعتماديات خارجية)
 * ------------------------------------------------------------------ */
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1024 * 1024) { reject(new Error('body too large')); req.destroy(); return; }
      data += c;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...extraHeaders,
  });
  res.end(body);
}

const setCookieHeader = (token) =>
  `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}`;

function clearCookieHeader() {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

/* ------------------------------------------------------------------ *
 *  طبقة الوصول للبيانات
 * ------------------------------------------------------------------ */
const dbUsers = {
  byUsername: (u) => db.prepare('SELECT * FROM users WHERE username = ?').get(u),
  byId: (id) => db.prepare('SELECT id, username, full_name, role, active, created_at FROM users WHERE id = ?').get(id),
  list: () => db.prepare('SELECT id, username, full_name, role, active, created_at FROM users ORDER BY role, full_name').all(),
  create(u) {
    const r = db.prepare('INSERT INTO users (username, full_name, password_hash, role) VALUES (?,?,?,?)')
      .run(u.username, u.full_name, hashPassword(u.password), u.role);
    return db.prepare('SELECT last_insert_rowid() AS id').get().id;
  },
  update(id, u) {
    const cur = this.byId(id);
    if (!cur) return 0;
    const full_name = (u.full_name === undefined ? cur.full_name : String(u.full_name));
    const role = (u.role === undefined ? cur.role : u.role);
    const active = (u.active === undefined ? cur.active : (asBool(u.active) ? 1 : 0));
    if (u.password) {
      db.prepare('UPDATE users SET full_name=?, role=?, active=?, password_hash=? WHERE id=?')
        .run(full_name, role, active, hashPassword(u.password), id);
    } else {
      db.prepare('UPDATE users SET full_name=?, role=?, active=? WHERE id=?')
        .run(full_name, role, active, id);
    }
    return db.prepare('SELECT changes() AS c').get().c;
  },
};

function listTransactions(f) {
  const where = [];
  const p = [];
  if (f.from) { where.push('date(t.created_at) >= date(?)'); p.push(f.from); }
  if (f.to)   { where.push('date(t.created_at) <= date(?)'); p.push(f.to); }
  if (f.tx_type) { where.push('t.tx_type = ?'); p.push(f.tx_type); }
  if (f.currency) { where.push('t.currency = ?'); p.push(f.currency); }
  if (f.client_id) { where.push('t.client_id = ?'); p.push(f.client_id); }
  if (f.q) {
    where.push('(t.client_name LIKE ? OR t.client_phone LIKE ?)');
    p.push(`%${f.q}%`, `%${f.q}%`);
  }
  const limit = Math.min(Math.max(num(f.limit, 100), 1), 500);
  const sql = `SELECT t.*,
               CASE WHEN t.client_name <> '' THEN t.client_name ELSE COALESCE(c.full_name, '') END AS client_name,
               CASE WHEN t.client_phone <> '' THEN t.client_phone ELSE COALESCE(c.phone, '') END AS client_phone,
               u.full_name AS operator
               FROM transactions t
               LEFT JOIN users u ON u.id = t.user_id
               LEFT JOIN clients c ON c.id = t.client_id
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY t.created_at DESC, t.id DESC
               LIMIT ?`;
  return db.prepare(sql).all(...p, limit);
}

function searchClients(q, limit = 20) {
  if (q) {
    const like = `%${q}%`;
    return db.prepare(`SELECT * FROM clients
                       WHERE full_name LIKE ? OR phone LIKE ? OR id_number LIKE ?
                       ORDER BY full_name LIMIT ?`).all(like, like, like, limit);
  }
  return db.prepare('SELECT * FROM clients ORDER BY created_at DESC LIMIT ?').all(limit);
}

function clientWithHistory(id) {
  const c = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  if (!c) return null;
  c.transactions = db.prepare(`SELECT t.*,
                               CASE WHEN t.client_name <> '' THEN t.client_name ELSE c2.full_name END AS client_name,
                               CASE WHEN t.client_phone <> '' THEN t.client_phone ELSE c2.phone END AS client_phone,
                               u.full_name AS operator
                               FROM transactions t
                               LEFT JOIN users u ON u.id = t.user_id
                               LEFT JOIN clients c2 ON c2.id = t.client_id
                               WHERE t.client_id = ? ORDER BY t.created_at DESC, t.id DESC LIMIT 200`).all(id);
  return c;
}

function createClient(c) {
  const r = db.prepare('INSERT INTO clients (full_name, phone, id_number, client_type, notes) VALUES (?,?,?,?,?)')
    .run(String(c.full_name || '').trim(), String(c.phone || '').trim(),
         String(c.id_number || '').trim(), c.client_type === 'company' ? 'company' : 'individual',
         String(c.notes || '').trim());
  return db.prepare('SELECT last_insert_rowid() AS id').get().id;
}

function createTransaction(t, userId) {
  const rate = num(t.rate);
  const amount = num(t.amount);
  const lyd = rate > 0 ? amount * rate : amount;
  const r = db.prepare(`INSERT INTO transactions
      (tx_type, currency, amount, rate, lyd_value, client_id, client_name, client_phone, user_id, note)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(t.tx_type, String(t.currency || '').toUpperCase(), amount, rate, lyd,
         t.client_id ? num(t.client_id) : null,
         String(t.client_name || '').trim(), String(t.client_phone || '').trim(),
         userId, String(t.note || '').trim());
  const id = db.prepare('SELECT last_insert_rowid() AS id').get().id;
  return db.prepare(`SELECT t.*,
                     CASE WHEN t.client_name <> '' THEN t.client_name ELSE COALESCE(c.full_name, '') END AS client_name,
                     CASE WHEN t.client_phone <> '' THEN t.client_phone ELSE COALESCE(c.phone, '') END AS client_phone,
                     u.full_name AS operator
                     FROM transactions t
                     LEFT JOIN users u ON u.id = t.user_id
                     LEFT JOIN clients c ON c.id = t.client_id WHERE t.id = ?`).get(id);
}

function summaryReport(from, to) {
  const where = [];
  const p = [];
  if (from) { where.push('date(created_at) >= date(?)'); p.push(from); }
  if (to)   { where.push('date(created_at) <= date(?)'); p.push(to); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(`SELECT tx_type, currency, COUNT(*) AS cnt, COALESCE(SUM(amount),0) AS total_amount,
                                  COALESCE(SUM(lyd_value),0) AS total_lyd
                           FROM transactions ${w} GROUP BY tx_type, currency`).all(...p);
  const byType = {};
  let count = 0, lyd = 0;
  for (const r of rows) {
    count += r.cnt; lyd += r.total_lyd;
    byType[r.tx_type] = byType[r.tx_type] || { count: 0, lyd: 0, currencies: {} };
    byType[r.tx_type].count += r.cnt;
    byType[r.tx_type].lyd += r.total_lyd;
    byType[r.tx_type].currencies[r.currency] = {
      count: r.cnt, amount: r.total_amount, lyd: r.total_lyd,
    };
  }
  return { rows, byType, count, lyd };
}

function dailyReport(from, to) {
  const where = [];
  const p = [];
  if (from) { where.push('date(created_at) >= date(?)'); p.push(from); }
  if (to)   { where.push('date(created_at) <= date(?)'); p.push(to); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(`SELECT date(created_at) AS day, tx_type, COUNT(*) AS cnt,
                                  COALESCE(SUM(amount),0) AS amount, COALESCE(SUM(lyd_value),0) AS lyd
                           FROM transactions ${w} GROUP BY day, tx_type ORDER BY day DESC`).all(...p);
  const days = {};
  for (const r of rows) {
    if (!days[r.day]) days[r.day] = { day: r.day, count: 0, lyd: 0, types: {} };
    days[r.day].count += r.cnt;
    days[r.day].lyd += r.lyd;
    days[r.day].types[r.tx_type] = { count: r.cnt, lyd: r.lyd };
  }
  return Object.values(days).sort((a, b) => (a.day < b.day ? 1 : -1));
}

/* ------------------------------------------------------------------ *
 *  إقفال اليوم / مطابقة النقد (جرد يومي)
 *  ------------------------------------------------------------------
 *  الأثر النقدي (بالدينار) لكل نوع عملية على صندوق الدينار:
 *    buy            شراء عملة أجنبية من العميل → دينار يخرج   (−lyd_value)
 *    sell           بيع عملة أجنبية للعميل       → دينار يدخل  (+lyd_value)
 *    local/intl     حوالات                        → دينار يدخل  (+lyd_value)
 *    voda_cash      فودافون كاش                  → دينار يدخل  (+lyd_value)
 * ------------------------------------------------------------------ */
const TX_CASH_EFFECT = { buy: -1, sell: 1, local_transfer: 1, intl_transfer: 1, voda_cash: 1 };

function localNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function localToday() {
  return localNow().slice(0, 10);
}

function getOrCreateDay(day) {
  let reg = db.prepare('SELECT * FROM cash_days WHERE day = ?').get(day);
  if (!reg) {
    db.prepare('INSERT INTO cash_days (day) VALUES (?)').run(day);
    reg = db.prepare('SELECT * FROM cash_days WHERE day = ?').get(day);
  }
  return reg;
}

function computeSettlement(day) {
  const register = getOrCreateDay(day);
  const adjustments = db.prepare('SELECT * FROM cash_adjustments WHERE day = ? ORDER BY created_at, id').all(day);
  const txs = db.prepare('SELECT tx_type, currency, amount, lyd_value FROM transactions WHERE date(created_at) = ?').all(day);

  let effect = 0, inLyd = 0, outLyd = 0;
  const byType = {};
  const byCur = {};
  const curRow = (c) => { if (!byCur[c]) byCur[c] = { currency: c, in: 0, out: 0, count: 0 }; return byCur[c]; };

  for (const t of txs) {
    byType[t.tx_type] = byType[t.tx_type] || { count: 0, lyd: 0 };
    byType[t.tx_type].count += 1;
    byType[t.tx_type].lyd += t.lyd_value;
    effect += (TX_CASH_EFFECT[t.tx_type] || 0) * t.lyd_value;

    if (t.tx_type === 'buy') { curRow(t.currency).in += t.amount; curRow(t.currency).count += 1; outLyd += t.lyd_value; }
    else if (t.tx_type === 'sell') { curRow(t.currency).out += t.amount; curRow(t.currency).count += 1; inLyd += t.lyd_value; }
    else if (t.tx_type === 'voda_cash') { curRow('LYD').in += t.lyd_value; curRow('LYD').count += 1; inLyd += t.lyd_value; }
    else { curRow('LYD').in += t.amount; curRow('LYD').count += 1; inLyd += t.amount; } // تحويلات
  }

  const adjIn = adjustments.filter((a) => a.adj_type === 'in').reduce((s, a) => s + a.amount, 0);
  const adjOut = adjustments.filter((a) => a.adj_type === 'out').reduce((s, a) => s + a.amount, 0);
  const expected = (register.opening_lyd || 0) + effect + adjIn - adjOut;
  const variance = register.counted_lyd != null ? register.counted_lyd - expected : null;

  return {
    register,
    adjustments,
    adjIn,
    adjOut,
    tx: { count: txs.length, effect, inLyd, outLyd, byType, byCurrency: Object.values(byCur) },
    expected,
    variance,
  };
}

/* ------------------------------------------------------------------ *
 *  طبقة المصادقة والتحكم بالدور
 * ------------------------------------------------------------------ */
function authUser(req) {
  const cookies = parseCookies(req);
  const userId = getSessionUser(cookies[COOKIE_NAME]);
  return userId ? dbUsers.byId(userId) : null;
}
function requireAuth(req, res, role) {
  const user = authUser(req);
  if (!user || !asBool(user.active)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return null;
  }
  if (role === 'manager' && user.role !== 'manager') {
    sendJson(res, 403, { error: 'forbidden', message: 'هذه الصلاحية للمدير فقط' });
    return null;
  }
  return user;
}

// محاولات دخول فاشلة — تباطؤ بسيط
const loginAttempts = new Map();
function throttle(key) {
  const now = Date.now();
  const rec = loginAttempts.get(key) || { n: 0, until: 0 };
  if (now < rec.until) return true;
  if (now > rec.until + 15 * 60 * 1000) rec.n = 0;
  return false;
}
function noteFail(key) {
  const rec = loginAttempts.get(key) || { n: 0, until: 0 };
  rec.n += 1;
  if (rec.n >= 5) rec.until = Date.now() + 60 * 1000;
  loginAttempts.set(key, rec);
}

/* ------------------------------------------------------------------ *
 *  ملفات ثابتة
 * ------------------------------------------------------------------ */
async function serveStatic(root, urlPath, res) {
  let decoded = decodeURIComponent(urlPath);
  let rel = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  if (rel === '.' || rel === '') rel = 'index.html';
  let full = path.join(root, rel);
  if (!full.startsWith(path.resolve(root))) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }
  try {
    const st = await stat(full);
    if (st.isDirectory()) full = path.join(full, 'index.html');
  } catch { /* not found below */ }
  try {
    const data = await readFile(full);
    const ext = path.extname(full).toLowerCase();
    const longCache = ['.jpg', '.jpeg', '.png', '.webp', '.ico', '.woff', '.woff2', '.ttf'].includes(ext);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': data.length,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': longCache ? 'public, max-age=86400' : 'no-cache',
    });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'not_found' });
  }
}

/* ------------------------------------------------------------------ *
 *  الراوتر الرئيسي
 * ------------------------------------------------------------------ */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = req.method;
  const ip = req.socket.remoteAddress || '';

  try {
    /* ---- JSON API ---- */
    if (pathname.startsWith('/api/')) {
      const route = pathname.slice(5); // بعد /api/
      const parts = route.split('/').filter(Boolean);

      // GET /api/health — بدون مصادقة (يستخدمه الموقع العام ليكتشف البوابة)
      if (method === 'GET' && route === 'health') {
        return sendJson(res, 200, { ok: true, app: 'alwathaq', time: new Date().toISOString() });
      }

      // GET /api/rates — أسعار اليوم (عامة، بدون مصادقة): الموقع العام يفضّلها
      if (method === 'GET' && route === 'rates') {
        return sendJson(res, 200, ratesView());
      }

      // POST /api/kit/export — أداة مطور فقط (تُفعَّل عبر KIT_EXPORT=1): يحفظ PNGs داخل assets/brand
      if (process.env.KIT_EXPORT === '1' && method === 'POST' && route === 'kit/export') {
        let body;
        try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return sendJson(res, 400, { error: 'bad_json' }); }
        const name = String(body.file || '');
        if (!/^[a-z0-9_-]+\.png$/.test(name)) return sendJson(res, 400, { error: 'bad_name' });
        const m = /^data:image\/png;base64,(.+)$/.exec(String(body.dataUrl || ''));
        if (!m) return sendJson(res, 400, { error: 'bad_data' });
        const buf = Buffer.from(m[1], 'base64');
        if (buf.length < 50 || buf.length > 3 * 1024 * 1024) return sendJson(res, 400, { error: 'bad_size' });
        const dest = path.join(SITE_DIR, 'assets', 'brand', name);
        if (!dest.startsWith(path.resolve(SITE_DIR, 'assets', 'brand'))) return sendJson(res, 403, { error: 'forbidden' });
        await writeFile(dest, buf);
        return sendJson(res, 200, { ok: true, file: name, bytes: buf.length });
      }

      // POST /api/login
      if (method === 'POST' && route === 'login') {
        if (throttle(ip)) return sendJson(res, 429, { error: 'rate_limited', message: 'محاولات كثيرة — انتظر دقيقة' });
        let body;
        try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return sendJson(res, 400, { error: 'bad_json' }); }
        const user = dbUsers.byUsername(String(body.username || '').trim());
        if (!user || !verifyPassword(body.password || '', user.password_hash) || !asBool(user.active)) {
          noteFail(ip);
          return sendJson(res, 401, { error: 'bad_credentials', message: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
        }
        const token = createSession(user.id);
        return sendJson(res, 200, { user: { id: user.id, username: user.username, full_name: user.full_name, role: user.role } },
          { 'Set-Cookie': setCookieHeader(token) });
      }

      // POST /api/logout
      if (method === 'POST' && route === 'logout') {
        const cookies = parseCookies(req);
        sessions.delete(cookies[COOKIE_NAME]);
        return sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearCookieHeader() });
      }

      // GET /api/me
      if (method === 'GET' && route === 'me') {
        const user = authUser(req);
        if (!user) return sendJson(res, 401, { error: 'unauthorized' });
        return sendJson(res, 200, { user });
      }

      /* ---- ما بعد هذا يتطلب تسجيل الدخول ---- */
      const user = requireAuth(req, res);
      if (!user) return;

      // GET /api/summary?from&to — ملخص أي دور
      if (method === 'GET' && route === 'summary') {
        const from = cleanDateStr(url.searchParams.get('from'));
        const to = cleanDateStr(url.searchParams.get('to'));
        return sendJson(res, 200, summaryReport(from, to));
      }

      // المعاملات
      if (parts[0] === 'transactions' && parts.length === 1) {
        if (method === 'GET') {
          return sendJson(res, 200, {
            list: listTransactions({
              from: cleanDateStr(url.searchParams.get('from')),
              to: cleanDateStr(url.searchParams.get('to')),
              tx_type: url.searchParams.get('type'),
              currency: url.searchParams.get('currency'),
              client_id: url.searchParams.get('client_id'),
              q: url.searchParams.get('q'),
              limit: url.searchParams.get('limit'),
            }),
            txTypes: TX_TYPES,
            currencies: CURRENCIES,
          });
        }
        if (method === 'POST') {
          let body;
          try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return sendJson(res, 400, { error: 'bad_json' }); }
          if (!TX_TYPES[body.tx_type]) return sendJson(res, 400, { error: 'bad_tx_type' });
          if (!CURRENCIES.includes(String(body.currency || '').toUpperCase())) return sendJson(res, 400, { error: 'bad_currency' });
          if (!(num(body.amount) > 0)) return sendJson(res, 400, { error: 'bad_amount', message: 'أدخل مبلغاً صحيحاً أكبر من صفر' });
          if (body.client_id) {
            const exists = db.prepare('SELECT id FROM clients WHERE id = ?').get(num(body.client_id));
            if (!exists) return sendJson(res, 400, { error: 'unknown_client' });
          }
          if (!body.client_id && !String(body.client_name || '').trim()) {
            return sendJson(res, 400, { error: 'need_client', message: 'اختر عميلاً أو اكتب اسمه' });
          }
          const tx = createTransaction(body, user.id);
          return sendJson(res, 201, { transaction: tx });
        }
      }

      // العملاء
      if (parts[0] === 'clients' && parts.length >= 1) {
        if (method === 'GET' && parts.length === 1) {
          return sendJson(res, 200, { clients: searchClients(url.searchParams.get('q') || '') });
        }
        if (method === 'POST' && parts.length === 1) {
          let body;
          try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return sendJson(res, 400, { error: 'bad_json' }); }
          if (!String(body.full_name || '').trim()) return sendJson(res, 400, { error: 'need_name', message: 'اسم العميل مطلوب' });
          const id = createClient(body);
          return sendJson(res, 201, { client: db.prepare('SELECT * FROM clients WHERE id = ?').get(id) });
        }
        if (method === 'GET' && parts.length === 2) {
          const c = clientWithHistory(num(parts[1]));
          if (!c) return sendJson(res, 404, { error: 'not_found' });
          return sendJson(res, 200, { client: c });
        }
      }

      // PUT /api/rates — تحرير الأسعار مباشرة (أي موظف مخوّل — بدون Google Sheets)
      if (method === 'PUT' && parts.length === 1 && parts[0] === 'rates') {
        let body;
        try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return sendJson(res, 400, { error: 'bad_json' }); }
        const rates = body.rates;
        if (!rates || typeof rates !== 'object' || Object.keys(rates).length === 0) {
          return sendJson(res, 400, { error: 'bad_rates', message: 'أرسل الأسعار المراد حفظها' });
        }
        const clean = {};
        for (const [key, r] of Object.entries(rates)) {
          if (!/^[A-Za-z0-9_]{1,32}$/.test(String(key))) continue;
          const retail = num(r && r.retail);
          if (!(retail > 0)) continue;
          const wholesale = num(r && r.wholesale);
          clean[key] = { retail, wholesale: wholesale > 0 ? wholesale : retail };
        }
        if (Object.keys(clean).length === 0) {
          return sendJson(res, 400, { error: 'bad_rates', message: 'لا توجد أسعار صالحة للحفظ' });
        }
        saveRates(clean, user.id);
        return sendJson(res, 200, ratesView());
      }

      /* ---- ما بعد هذا للمدير فقط ---- */
      const manager = requireAuth(req, res, 'manager');
      if (!manager) return;

      // التقارير
      if (parts[0] === 'reports') {
        const from = cleanDateStr(url.searchParams.get('from'));
        const to = cleanDateStr(url.searchParams.get('to'));
        if (parts[1] === 'summary') return sendJson(res, 200, summaryReport(from, to));
        if (parts[1] === 'daily') return sendJson(res, 200, { days: dailyReport(from, to) });
      }

      // استيراد الأسعار من جدول الشركة (مدير فقط) — POST /api/rates/import
      // استيراد لمرة واحدة: يجلب كل أسعار الجدول ويكتبها في قاعدة البيانات
      // (يتجاوز أي تعديل يدوي سابق). التعديل اليومي يتم يدوياً من البوابة.
      if (method === 'POST' && parts.length === 2 && parts[0] === 'rates' && parts[1] === 'import') {
        try {
          const s = await fetchSheetRates();
          const n = saveRates(s, user.id);
          setMeta('rates_imported_at', localNow());
          console.log('استيراد أسعار من الجدول: ' + n + ' سعر بواسطة ' + user.username);
          return sendJson(res, 200, ratesView());
        } catch (err) {
          return sendJson(res, 502, { error: 'sheet_fetch_failed', message: 'تعذّر الوصول لجدول الشركة: ' + String((err && err.message) || err) });
        }
      }

      // إقفال اليوم / الجرد النقدي
      if (parts[0] === 'settlement') {
        if (method === 'GET' && parts.length === 1) {
          const day = cleanDateStr(url.searchParams.get('day')) || localToday();
          return sendJson(res, 200, computeSettlement(day));
        }
        if (method === 'POST' && parts.length === 1) {
          let body;
          try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return sendJson(res, 400, { error: 'bad_json' }); }
          const day = cleanDateStr(body.day) || localToday();
          const reg = getOrCreateDay(day);
          const opening = body.opening_lyd !== undefined && body.opening_lyd !== '' ? num(body.opening_lyd) : reg.opening_lyd;
          let counted = reg.counted_lyd;
          let closed_at = reg.closed_at;
          if ('counted_lyd' in body) {
            if (body.counted_lyd === null || body.counted_lyd === '') { counted = null; closed_at = null; }
            else { counted = num(body.counted_lyd); closed_at = localNow(); }
          }
          const notes = body.notes !== undefined ? String(body.notes || '').trim() : reg.notes;
          db.prepare('UPDATE cash_days SET opening_lyd=?, counted_lyd=?, closed_at=?, notes=?, updated_at=? WHERE day=?')
            .run(opening, counted, closed_at, notes, localNow(), day);
          return sendJson(res, 200, computeSettlement(day));
        }
        // POST /api/settlement/adjustments
        if (method === 'POST' && parts.length === 2 && parts[1] === 'adjustments') {
          let body;
          try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return sendJson(res, 400, { error: 'bad_json' }); }
          const day = cleanDateStr(body.day) || localToday();
          getOrCreateDay(day);
          if (!['in', 'out'].includes(body.adj_type)) return sendJson(res, 400, { error: 'bad_adj_type' });
          if (!(num(body.amount) > 0)) return sendJson(res, 400, { error: 'bad_amount', message: 'أدخل مبلغاً أكبر من صفر' });
          db.prepare('INSERT INTO cash_adjustments (day, adj_type, amount, note) VALUES (?,?,?,?)')
            .run(day, body.adj_type, num(body.amount), String(body.note || '').trim());
          return sendJson(res, 200, computeSettlement(day));
        }
        // DELETE /api/settlement/adjustments/:id
        if (method === 'DELETE' && parts.length === 3 && parts[1] === 'adjustments') {
          const id = num(parts[2]);
          const row = db.prepare('SELECT day FROM cash_adjustments WHERE id = ?').get(id);
          if (!row) return sendJson(res, 404, { error: 'not_found' });
          db.prepare('DELETE FROM cash_adjustments WHERE id = ?').run(id);
          return sendJson(res, 200, computeSettlement(row.day));
        }
      }

      // المستخدمون
      if (parts[0] === 'users') {
        if (method === 'GET' && parts.length === 1) return sendJson(res, 200, { users: dbUsers.list() });
        if (method === 'POST' && parts.length === 1) {
          let body;
          try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return sendJson(res, 400, { error: 'bad_json' }); }
          const username = String(body.username || '').trim();
          if (!username || !body.password) return sendJson(res, 400, { error: 'fields', message: 'اسم المستخدم وكلمة المرور مطلوبان' });
          if (username.length < 3) return sendJson(res, 400, { error: 'username_short' });
          if (dbUsers.byUsername(username)) return sendJson(res, 409, { error: 'exists', message: 'اسم المستخدم موجود مسبقاً' });
          if (!['manager', 'employee'].includes(body.role)) return sendJson(res, 400, { error: 'bad_role' });
          const id = dbUsers.create({ username, full_name: body.full_name, role: body.role, password: body.password });
          return sendJson(res, 201, { user: dbUsers.byId(id) });
        }
        if (method === 'PATCH' && parts.length === 2) {
          let body;
          try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return sendJson(res, 400, { error: 'bad_json' }); }
          const id = num(parts[1]);
          const target = dbUsers.byId(id);
          if (!target) return sendJson(res, 404, { error: 'not_found' });
          if (id === manager.id && asBool(body.active) === false) {
            return sendJson(res, 400, { error: 'cannot_disable_self', message: 'لا يمكنك تعطيل حسابك الحالي' });
          }
          if (body.password && String(body.password).length < 6) {
            return sendJson(res, 400, { error: 'password_short', message: 'كلمة المرور 6 أحرف على الأقل' });
          }
          dbUsers.update(id, {
            full_name: body.full_name,
            role: body.role,
            active: body.active,
            password: body.password,
          });
          return sendJson(res, 200, { user: dbUsers.byId(id) });
        }
      }

      return sendJson(res, 404, { error: 'api_not_found' });
    }

    /* ---- بوابة الموظفين ---- */
    if (pathname === '/portal' || pathname.startsWith('/portal/')) {
      const rest = pathname.slice('/portal'.length) || '/';
      const cookies = parseCookies(req);
      const userId = getSessionUser(cookies[COOKIE_NAME]);
      const user = userId ? dbUsers.byId(userId) : null;
      if ((!user || !asBool(user.active)) && rest !== '/login.html') {
        // يسمح بملفات البوابة الثابتة لكن الواجهة نفسها ستتحقق من الجلسة
      }
      if (rest === '' || rest === '/') {
        res.writeHead(302, { Location: '/portal/index.html' });
        return res.end();
      }
      return serveStatic(PORTAL_DIR, rest, res);
    }

    /* ---- الموقع العام ---- */
    if (pathname === '/') return serveStatic(SITE_DIR, '/index.html', res);
    return serveStatic(SITE_DIR, pathname, res);
  } catch (err) {
    console.error('Error:', err);
    try { sendJson(res, 500, { error: 'internal_error' }); } catch { /* socket closed */ }
  }
});

server.listen(PORT, () => {
  console.log('──────────────────────────────────────────────');
  console.log(`  الوثاق للصرافة — التطبيق شغال`);
  console.log(`  الموقع العام:     http://localhost:${PORT}`);
  console.log(`  بوابة الموظفين:   http://localhost:${PORT}/portal`);
  console.log(`  قاعدة البيانات:   ${DB_PATH}`);
  console.log('──────────────────────────────────────────────');
});
