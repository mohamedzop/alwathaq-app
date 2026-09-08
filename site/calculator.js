/*
  حاسبة العملات — الوثاق للصرافة
  ----------------------------------------
  تجيب الأسعار مباشرة من جدول Google Sheets عبر طريقة JSONP (وسم <script>)
  بدل fetch العادي، لأن جوجل شيتس لا يسمح بطلبات fetch من مواقع أخرى (CORS).
  هذي الطريقة تشتغل من أي موقع مستضاف فعلياً على الإنترنت (مو من ملف محلي
  على جهازك — المتصفح يمنع أي طلب خارجي وقتها بغض النظر عن الطريقة).

  شكل الجدول المتوقع (الصف الأول عناوين، يتم تجاهله تلقائياً):
  key,retail,wholesale
  USD_cash,9.285,9.270
  ...
*/

const SHEET_ID = "1zjz3SRLtyE9ELUv5AmJKI0NYEJHyuSCALaQ0-9Cgy4Y"; // معرف جدول Google Sheets الخاص بالشركة (فارغ = استخدام rates.js فقط)

document.addEventListener('DOMContentLoaded', function () {
  var currencySelect = document.getElementById('calc-currency');
  var typeSelect = document.getElementById('calc-type');
  var amountInput = document.getElementById('calc-amount');
  var resultEl = document.getElementById('calc-result');
  var rateNoteEl = document.getElementById('calc-rate-note');
  var updatedEl = document.getElementById('calc-updated');

  if (!currencySelect || !amountInput || !resultEl) return;

  var LIVE_RATES = buildFallbackRates();
  var tableCells = {};

  function buildFallbackRates() {
    if (typeof EXCHANGE_RATES === 'undefined') return {};
    var out = {};
    ['USD', 'EUR', 'VODAFONE'].forEach(function (c) {
      if (!EXCHANGE_RATES[c]) return;
      out[c + '_cash'] = { retail: EXCHANGE_RATES[c].cash, wholesale: EXCHANGE_RATES[c].cash };
      out[c + '_bank'] = { retail: EXCHANGE_RATES[c].bank, wholesale: EXCHANGE_RATES[c].bank };
      if (EXCHANGE_RATES[c].card !== undefined) {
        out[c + '_card'] = { retail: EXCHANGE_RATES[c].card, wholesale: EXCHANGE_RATES[c].card };
      }
    });
    return out;
  }

  function setUpdatedMsg(msg) {
    if (updatedEl) updatedEl.textContent = msg;
    var ratesMeta = document.getElementById('rates-updated');
    if (ratesMeta) ratesMeta.textContent = msg;
  }

  function fetchLiveRates() {
    // 1) المصدر الموثوق: خادم التطبيق (نفس النطاق) — يجلب الجدول تلقائياً يومياً
    fetch('/api/rates')
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (data) {
        if (!data.rates || Object.keys(data.rates).length === 0) throw new Error('empty');
        LIVE_RATES = data.rates;
        var when = data.updatedAt ? new Date(data.updatedAt) : null;
        var prefix = data.stale ? 'تعذّر التحديث الآن — معروضة آخر أسعار مؤكدة. ' : '';
        var whenStr = when ? 'آخر تحديث: ' + when.toLocaleString('ar-LY') : 'تُحدَّث دورياً'; 
        setUpdatedMsg(prefix + 'الأسعار محدَّثة من بوابة الوثاق — ' + whenStr);
        renderTable();
        calculate();
      })
      .catch(function () { fetchSheetViaJsonp(); });
  }

  function fetchSheetViaJsonp() {
    if (!SHEET_ID) {
      renderTable();
      calculate();
      setUpdatedMsg('الأسعار من الملف المحلي (rates.js) — لم يتم ربط جدول مباشر.');
      return;
    }

    var callbackName = '__sheetCallback_' + Date.now();
    var script = document.createElement('script');
    var finished = false;

    var timeoutId = setTimeout(function () {
      if (finished) return;
      finished = true;
      cleanup();
      renderTable();
      calculate();
      setUpdatedMsg('تعذّر جلب الجدول المباشر (انتهت المهلة) — معروضة الأسعار الاحتياطية.');
    }, 7000);

    function cleanup() {
      delete window[callbackName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[callbackName] = function (response) {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      try {
        var rows = response.table.rows;
        var parsed = {};
        rows.forEach(function (row) {
          var c = row.c;
          if (!c || !c[0] || c[0].v === null) return;
          var key = String(c[0].v).trim();
          var retail = c[1] && c[1].v !== null ? parseFloat(c[1].v) : NaN;
          var wholesale = c[2] && c[2].v !== null ? parseFloat(c[2].v) : retail;
          if (key && !isNaN(retail)) {
            parsed[key] = { retail: retail, wholesale: isNaN(wholesale) ? retail : wholesale };
          }
        });
        if (Object.keys(parsed).length > 0) {
          LIVE_RATES = parsed;
          setUpdatedMsg('الأسعار محدثة مباشرة من جدول الشركة — آخر جلب: ' + new Date().toLocaleTimeString('ar-LY'));
        } else {
          setUpdatedMsg('الجدول رجع فاضي — تحقق من شكل البيانات فيه.');
        }
      } catch (e) {
        setUpdatedMsg('صار خطأ أثناء قراءة الجدول — معروضة الأسعار الاحتياطية.');
      }
      renderTable();
      calculate();
      cleanup();
    };

    script.onerror = function () {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutId);
      renderTable();
      calculate();
      setUpdatedMsg('تعذّر جلب الجدول المباشر — معروضة الأسعار الاحتياطية. تأكد إن الجدول مشارك للعامة.');
      cleanup();
    };

    script.src = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID +
      '/gviz/tq?tqx=out:json;responseHandler:' + callbackName + '&headers=1';
    document.head.appendChild(script);
  }

  function typeLabel(t) {
    if (t === 'cash') return 'نقدي';
    if (t === 'bank') return 'حوالة بنكية';
    if (t === 'card') return 'بطاقة مصرفية';
    return t;
  }

  function currencyShortLabel(c) {
    if (c === 'USD') return 'دولار';
    if (c === 'EUR') return 'يورو';
    if (c === 'VODAFONE') return 'دينار (فودافون كاش)';
    return c;
  }

  function updateTypeOptions() {
    var currency = currencySelect.value;
    var isVodafone = currency === 'VODAFONE';
    var cardOption = typeSelect.querySelector('option[value="card"]');
    if (cardOption) cardOption.hidden = isVodafone;
    if (isVodafone && typeSelect.value === 'card') {
      typeSelect.value = 'cash';
    }
  }

  function calculate() {
    var currency = currencySelect.value;
    var type = typeSelect.value;
    var amount = parseFloat(amountInput.value);
    var entry = LIVE_RATES[currency + '_' + type];
    var rate = entry ? entry.retail : 0;

    if (!rate) {
      resultEl.textContent = '—';
      rateNoteEl.textContent = 'الأسعار لسه ما تحدثت لهذا الخيار.';
      return;
    }
    if (isNaN(amount) || amount <= 0) {
      resultEl.textContent = '—';
      rateNoteEl.textContent = 'اكتب مبلغ صحيح فوق.';
      return;
    }

    var total = amount * rate;
    resultEl.textContent = total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' د.ل';
    rateNoteEl.textContent = '1 ' + currencyShortLabel(currency) + ' (' + typeLabel(type) + ') = ' + rate.toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' د.ل';
  }

  function collectTableCells() {
    var map = {
      'USD_cash': 'rt-usd-cash', 'USD_bank': 'rt-usd-bank', 'USD_card': 'rt-usd-card',
      'EUR_cash': 'rt-eur-cash', 'EUR_bank': 'rt-eur-bank', 'EUR_card': 'rt-eur-card',
      'VODAFONE_cash': 'rt-vf-cash', 'VODAFONE_bank': 'rt-vf-bank'
    };
    Object.keys(map).forEach(function (key) {
      var retailEl = document.getElementById(map[key] + '-retail');
      var wholesaleEl = document.getElementById(map[key] + '-wholesale');
      if (retailEl || wholesaleEl) tableCells[key] = { retailEl: retailEl, wholesaleEl: wholesaleEl };
    });

    // Hero mini rate-board (single value per row, cash rate only)
    var heroMap = { 'USD_cash': 'hero-usd-cash', 'EUR_cash': 'hero-eur-cash', 'VODAFONE_cash': 'hero-vf-cash' };
    Object.keys(heroMap).forEach(function (key) {
      var el = document.getElementById(heroMap[key]);
      if (!el) return;
      if (!tableCells[key]) tableCells[key] = {};
      tableCells[key].heroEl = el;
    });
  }

  function renderTable() {
    if (Object.keys(tableCells).length === 0) collectTableCells();
    Object.keys(tableCells).forEach(function (key) {
      var cell = tableCells[key];
      var entry = LIVE_RATES[key];
      if (!entry) return;
      if (cell.retailEl) cell.retailEl.textContent = entry.retail ? entry.retail.toFixed(3) : '—.—';
      if (cell.wholesaleEl) cell.wholesaleEl.textContent = entry.wholesale ? entry.wholesale.toFixed(3) : '—.—';
      if (cell.heroEl) cell.heroEl.textContent = entry.retail ? entry.retail.toFixed(3) : '—.—';
    });
  }

  currencySelect.addEventListener('change', function () { updateTypeOptions(); calculate(); });
  typeSelect.addEventListener('change', calculate);
  amountInput.addEventListener('input', calculate);

  updateTypeOptions();
  fetchLiveRates();
});
