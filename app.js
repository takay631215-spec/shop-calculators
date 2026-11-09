/* クラマ出店者計算アプリ：画面まわり（計算ロジックは calc.js） */
(() => {
  'use strict';

  const CALC = window.Calc;
  const APP_TITLE = 'クラマ出店者計算アプリ';
  const APP_ID = 'merchant-calculators';
  const KEY = 'merchant_calcs_v1';
  const RESUME_MS = 30 * 60 * 1000; // 30分以上離れたらホームに戻る

  const TITLES = {
    home: [APP_TITLE, '数字を入れるだけ。登録不要・端末内保存'],
    fee: ['手取り計算機', '手数料の差引・請求金額の逆算'],
    cancel: ['キャンセル率', '月ごとの実績を管理'],
    review: ['口コミ率', '月ごとの実績を管理'],
    rating: ['星評価', '星別件数を記録して次の評価を予測'],
    settings: ['設定・バックアップ', '端末内データの保存と復元'],
  };
  const PAGES = Object.keys(TITLES);

  const $ = sel => document.querySelector(sel);
  const view = $('#view');

  /* ---------- 小さな関数 ---------- */
  const pad2 = n => String(n).padStart(2, '0');
  const ymKey = (y, m) => `${y}-${pad2(m)}`;
  const currentKey = () => {
    const now = new Date();
    return ymKey(now.getFullYear(), now.getMonth() + 1);
  };
  const numOr = (v, fb) => (v === '' || v == null || !Number.isFinite(Number(v)) ? fb : Number(v));
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const toCount = v => Math.max(0, Math.floor(numOr(v, 0)));
  const addCommas = s => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const yen = n => Math.round(n).toLocaleString('ja-JP') + '円';
  const pct = n => n.toFixed(2) + '%';
  const card = (title, html) => `<section class="card"><h2>${title}</h2>${html}</section>`;
  const statLine = (label, value) => `<div class="statline"><span>${label}</span><b>${value}</b></div>`;
  const minus = n => `− ${yen(n)}`;
  const countText = n => `${n.toLocaleString('ja-JP')}件`;

  /* ---------- 数字の入力 ----------
   * type="number" は全角数字やカンマを受け付けず、入力途中の値が空になるため
   * 普通のテキスト欄にして、欄の文字から数字を読み取って計算する。
   * 打っている最中に欄の文字を書き換えると日本語入力やスマホのキーボードが
   * 誤動作するので、見た目（半角・カンマ）を整えるのは欄を離れたときだけ。
   */
  const toHalf = s => s
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.')
    .replace(/[\s　,，]/g, '');
  const cleanInt = s => toHalf(s).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  const cleanDec = s => {
    const m = toHalf(s).replace(/[^0-9.]/g, '').match(/^(\d*)(?:\.(\d{0,2}))?/);
    const int = m[1].replace(/^0+(?=\d)/, '');
    return m[2] !== undefined ? `${int}.${m[2]}` : int;
  };
  const cleanFor = (s, kind) => (kind === 'int' ? cleanInt(s) : cleanDec(s));
  const parseClean = c => {
    if (c === '') return null;
    const n = Number(c);
    return Number.isFinite(n) ? n : null;
  };
  const fmtValue = (n, kind) => (kind === 'int' ? addCommas(String(Math.trunc(n))) : String(n));

  function setErr(el, msg) {
    el.classList.toggle('invalid', !!msg);
    el.setAttribute('aria-invalid', String(!!msg));
    const box = el.closest('[data-wrap]')?.querySelector('.err');
    if (box) {
      box.textContent = msg;
      box.hidden = !msg;
    }
  }

  function numInput({ field, kind, text, cls = '', label = '' }) {
    return `<input type="text" inputmode="${kind === 'int' ? 'numeric' : 'decimal'}" autocomplete="off" enterkeyhint="done" data-num="${kind}" data-field="${field}" value="${text}"${cls ? ` class="${cls}"` : ''}${label ? ` aria-label="${label}"` : ''}>`;
  }

  function numField({ field, kind, label, value }) {
    return `<label class="field" data-wrap><span>${label}</span>${numInput({ field, kind, text: fmtValue(value, kind) })}<small class="err" hidden></small></label>`;
  }

  function countRow(field, label, value) {
    return `
      <div class="count-row" data-wrap>
        <div class="row">
          <span class="left">${label}</span>
          <div class="stepper">
            <button type="button" class="minus" data-step="-1" data-field="${field}" aria-label="${label}を1件減らす">−</button>
            ${numInput({ field, kind: 'int', text: fmtValue(value, 'int'), cls: 'count-input', label })}
            <span class="unit">件</span>
            <button type="button" data-step="1" data-field="${field}" aria-label="${label}を1件増やす">＋</button>
          </div>
        </div>
        <small class="err" hidden></small>
      </div>`;
  }

  /* ---------- 保存 ---------- */
  function defaultState() {
    const now = new Date();
    return {
      rating: [0, 0, 0, 0, 0],
      months: {},
      goals: { cancel: 5, review: 80 },
      feeRate: 20,
      minimum: 2000,
      feeMode: 'deduct',
      paymentMethod: 'base',
      taxEnabled: false,
      taxReserveRate: 100,
      page: 'home',
      lastActiveAt: 0,
      year: now.getFullYear(),
      month: ymKey(now.getFullYear(), now.getMonth() + 1),
    };
  }

  function goalOr(v, fallback) {
    const n = numOr(v, fallback);
    return n > 0 && n <= 100 ? n : fallback;
  }

  // 保存データや復元ファイルの中身を、使える形に整える
  function sanitize(raw) {
    const d = defaultState();
    const r = raw && typeof raw === 'object' ? raw : {};
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(r.month) ? r.month : d.month;
    return {
      rating: Array.isArray(r.rating) && r.rating.length === 5 ? r.rating.map(toCount) : d.rating,
      months: r.months && typeof r.months === 'object' ? r.months : {},
      goals: { cancel: goalOr(r.goals?.cancel, d.goals.cancel), review: goalOr(r.goals?.review, d.goals.review) },
      feeRate: clamp(numOr(r.feeRate, d.feeRate), 0, 90),
      minimum: toCount(numOr(r.minimum, d.minimum)),
      feeMode: 'deduct', // 起動時は常に「手数料を引く」から
      paymentMethod: ['base', 'card', 'ato'].includes(r.paymentMethod) ? r.paymentMethod : 'base',
      taxEnabled: r.taxEnabled === true,
      taxReserveRate: clamp(numOr(r.taxReserveRate, d.taxReserveRate), 0, 100),
      page: PAGES.includes(r.page) ? r.page : 'home',
      lastActiveAt: numOr(r.lastActiveAt, 0),
      year: Number(month.slice(0, 4)),
      month,
    };
  }

  const isIdle = lastActiveAt => {
    const idle = Date.now() - lastActiveAt;
    return !(idle >= 0 && idle <= RESUME_MS);
  };

  function loadState() {
    let raw = {};
    try {
      raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    } catch {
      raw = {};
    }
    const s = sanitize(raw);
    if (isIdle(s.lastActiveAt)) s.page = 'home';
    return s;
  }

  function saveState() {
    state.lastActiveAt = Date.now();
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      toast('保存できません。容量や設定をご確認ください');
    }
  }

  let state = loadState();
  let feeAmount = ''; // 金額は計算にだけ使い、保存しない
  let lastQuick = null; // ホームの「今日の記録」を1回分取り消すための控え
  let toastTimer = 0;

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  const monthData = () => CALC.monthCounts(state.months[state.month]);
  const setMonth = patch => {
    state.months[state.month] = { ...monthData(), ...patch };
  };

  /* ---------- 入力欄ごとの読み書き ---------- */
  function committedValue(field) {
    const d = monthData();
    switch (field) {
      case 'feeRate': return state.feeRate;
      case 'minimum': return state.minimum;
      case 'taxReserveRate': return state.taxReserveRate;
      case 'goalCancel': return state.goals.cancel;
      case 'goalReview': return state.goals.review;
      case 'workCount': return d.work;
      case 'cancelCount': return d.cancel;
      case 'reviewCount': return d.review;
      default: return state.rating[Number(field.slice(4)) - 1]; // star1〜star5
    }
  }

  function checkField(field, n) {
    const d = monthData();
    switch (field) {
      case 'feeRate': return n <= 90 ? '' : '0〜90％で入力してください';
      case 'taxReserveRate': return n <= 100 ? '' : '0〜100％で入力してください';
      case 'goalCancel':
      case 'goalReview': return n > 0 && n <= 100 ? '' : '0より大きく100以下で入力してください';
      case 'workCount': return n >= d.review ? '' : '作業件数が口コミ件数を下回ります';
      case 'reviewCount': return n <= d.work ? '' : '口コミ件数は作業件数以下にしてください';
      default: return '';
    }
  }

  function commitField(field, n) {
    switch (field) {
      case 'feeRate': state.feeRate = n; break;
      case 'minimum': state.minimum = n; break;
      case 'taxReserveRate': state.taxReserveRate = n; break;
      case 'goalCancel': state.goals.cancel = n; break;
      case 'goalReview': state.goals.review = n; break;
      case 'workCount': setMonth({ work: n }); break;
      case 'cancelCount': setMonth({ cancel: n }); break;
      case 'reviewCount': setMonth({ review: n }); break;
      default: state.rating[Number(field.slice(4)) - 1] = n;
    }
    saveState();
  }

  function onNumInput(el) {
    const field = el.dataset.field;
    const clean = cleanFor(el.value, el.dataset.num);
    if (field === 'feeAmount') {
      feeAmount = clean;
      renderOut();
      return;
    }
    const n = parseClean(clean);
    if (n === null) { // 打ち直しの途中。空欄のまま離れたら元の値に戻す
      setErr(el, '');
      return;
    }
    const err = checkField(field, n);
    // 作業件数は「120」と打つ途中の「1」でも口コミ件数を下回るので、打っている間は赤くしない
    setErr(el, field === 'workCount' ? '' : err);
    if (!err) {
      commitField(field, n);
      renderOut();
    }
  }

  function onNumBlur(el) {
    const field = el.dataset.field;
    if (field === 'feeAmount') {
      feeAmount = cleanInt(el.value);
      el.value = addCommas(feeAmount);
      renderOut();
      return;
    }
    const kind = el.dataset.num;
    const n = parseClean(cleanFor(el.value, kind));
    const err = n === null ? '' : checkField(field, n);
    if (n === null || err) {
      el.value = fmtValue(committedValue(field), kind);
      if (err) toast(err);
    } else {
      el.value = fmtValue(n, kind);
    }
    setErr(el, '');
  }

  function stepField(btn) {
    const field = btn.dataset.field;
    const next = Math.max(0, committedValue(field) + Number(btn.dataset.step));
    const err = checkField(field, next);
    if (err) {
      toast(err);
      return;
    }
    commitField(field, next);
    const input = view.querySelector(`input[data-field="${field}"]`);
    if (input) {
      input.value = fmtValue(next, 'int');
      setErr(input, '');
    }
    renderOut();
  }

  /* ---------- 各画面 ---------- */
  const miniRow = (items, cls = '') => `<span class="minis ${cls}">${items.map(([label, value]) => `<span class="mini"><small>${label}</small><b>${value}</b></span>`).join('')}</span>`;

  // ホームの1枚分。ボタンの中に置くので span だけで組む
  function dashCard({ page, icon, title, label, value, note = '', rows }) {
    return `
      <button type="button" class="dash-card" data-go="${page}">
        <span class="dash-head"><span class="emoji">${icon}</span><strong>${title}</strong><span class="chev" aria-hidden="true">›</span></span>
        <span class="dash-main"><small>${label}</small><b>${value}</b>${note ? `<small>${note}</small>` : ''}</span>
        ${rows.join('')}
      </button>`;
  }

  function feeDash() {
    const res = feeResult();
    const method = { base: '通常のみ', card: 'カード', ato: 'ATO' }[state.paymentMethod];
    const settings = [['支払い方法', method], ['手数料率', `${state.feeRate}％`], ['最低手数料', yen(state.minimum)]];
    let label = '手取り目安';
    let value = '—';
    let note = '金額を入力すると表示されます';
    let figures = [];
    if (res.hasAmount && !res.possible) {
      label = '必要な請求金額';
      value = '計算不可';
      note = '';
    } else if (res.hasAmount) {
      const reverse = state.feeMode === 'reverse';
      label = reverse ? '必要な請求金額（概算）' : '手取り目安';
      value = yen(reverse ? res.invoice : res.net);
      note = '';
      figures = [[reverse ? '手取り目安' : '請求金額', yen(reverse ? res.net : res.invoice)], ['くらま手数料', minus(res.platform)]];
      if (state.paymentMethod !== 'base') figures.push(['決済手数料', minus(res.payment + res.volume)]);
      if (state.taxEnabled) figures.push(['納税用に確保', minus(res.reserve)]);
    }
    return dashCard({ page: 'fee', icon: '💴', title: '手取り計算機', label, value, note, rows: [miniRow([...figures, ...settings])] });
  }

  // 「今月」は対象年月の選択に関係なく、実際の今月を表示する
  function monthDash(isCancel) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const key = isCancel ? 'cancel' : 'review';
    const name = isCancel ? 'キャンセル' : '口コミ';
    const d = CALC.monthCounts(state.months[ymKey(year, month)]);
    const goal = state.goals[key];
    const needed = CALC.neededForGoal(d, isCancel, goal);
    const annual = CALC.yearSummary(state.months, year, isCancel);
    return dashCard({
      page: key,
      icon: isCancel ? '📅' : '⭐',
      title: `${name}率`,
      label: `${month}月の${name}率`,
      value: pct(CALC.monthRate(d, isCancel)),
      note: needed === null ? '目標には到達できません' : `目標まで${isCancel ? 'キャンセルなし作業' : '口コミ付き作業'} あと${countText(needed)}`,
      rows: [
        miniRow([['作業件数', countText(d.work)], [`${name}件数`, countText(d[key])], ['目標', `${goal}％`]]),
        miniRow([[`${year}年の率`, pct(annual.rate)], ['年間の作業', countText(annual.work)], [`年間の${name}`, countText(annual[key])]]),
      ],
    });
  }

  function ratingDash() {
    const { n, avg, shown, next, needed } = CALC.ratingStats(state.rating);
    const note = n === 0 ? '件数を入力すると表示されます'
      : shown >= 5 ? '最高評価です'
        : needed === null ? '次の0.01には到達できません'
          : `次の0.01アップまで ★5 あと${countText(needed)}`;
    return dashCard({
      page: 'rating',
      icon: '🌟',
      title: '星評価',
      label: '平均評価',
      value: n ? shown.toFixed(2) : '—',
      note,
      rows: [
        miniRow([['口コミ合計', countText(n)], ['実際の平均', n ? avg.toFixed(5) : '—'], ['次の評価', n && shown < 5 ? next.toFixed(2) : '—']]),
        miniRow([5, 4, 3, 2, 1].map(star => [`★${star}`, state.rating[star - 1].toLocaleString('ja-JP')]), 'five'),
      ],
    });
  }

  function dashHtml() {
    return feeDash() + monthDash(true) + monthDash(false) + ratingDash();
  }

  function quickCard() {
    const month = Number(currentKey().slice(5));
    return card('今日の記録', `
      <p class="hint quick-lead">${month}月の件数に1タップで追加します。</p>
      <div class="quick-row">
        <button type="button" class="quick-btn" data-quick="work">作業 ＋1</button>
        <button type="button" class="quick-btn" data-quick="cancel">キャンセル ＋1</button>
      </div>
      <p class="hint quick-lead">口コミが届いたら星の数をタップ（口コミ件数と星別件数を同時に＋1）</p>
      <div class="quick-stars">${[5, 4, 3, 2, 1].map(star => `<button type="button" class="quick-btn" data-quick="star${star}" aria-label="星${star}の口コミを1件追加">★${star}</button>`).join('')}</div>
      <p class="quick-msg" role="status" hidden><span></span><button type="button" data-action="undo">取り消す</button></p>`);
  }

  function showQuickMsg(text) {
    const box = $('.quick-msg');
    if (!box) return;
    box.firstElementChild.textContent = text;
    box.hidden = !text;
  }

  // 作業・キャンセル・口コミを、画面を移動せず今月に＋1する
  function quickAdd(kind) {
    const key = currentKey();
    const saved = state.months[key];
    lastQuick = { key, month: saved ? { ...saved } : null, rating: [...state.rating] };
    const d = CALC.monthCounts(saved);
    let message;
    if (kind === 'work') {
      d.work += 1;
      message = `作業を追加しました（今月 ${countText(d.work)}）`;
    } else if (kind === 'cancel') {
      d.cancel += 1;
      message = `キャンセルを追加しました（今月 ${countText(d.cancel)}）`;
    } else {
      const star = Number(kind.slice(4));
      state.rating[star - 1] += 1;
      if (d.review < d.work) {
        d.review += 1;
        message = `★${star}の口コミを追加しました（今月 ${countText(d.review)}）`;
      } else {
        message = `★${star}を追加しました。口コミ件数は作業件数を超えるので増やしていません`;
      }
    }
    state.months[key] = d;
    saveState();
    renderOut();
    showQuickMsg(message);
  }

  function undoQuick() {
    if (!lastQuick) return;
    const { key, month, rating } = lastQuick;
    if (month) state.months[key] = month;
    else delete state.months[key];
    state.rating = rating;
    lastQuick = null;
    saveState();
    renderOut();
    showQuickMsg('');
    toast('取り消しました');
  }

  function homeView() {
    return `
      ${quickCard()}
      <div class="dash" id="dash"></div>
      <p class="hint">カードをタップすると入力画面が開きます。数字はこの端末に保存されます。売上金額は計算だけで履歴に残さず、ページを閉じると消えます。</p>
      ${card('はじめて使う方へ', `
        <p><strong>LINE内のブラウザではなく、Safari・Chromeなどで開いてください。</strong></p>
        <p>① LINEのメニューから「ブラウザで開く」<br>② 通常のブラウザでこのページを開く<br>③ ホーム画面に追加して使うと便利です</p>
        <p class="hint">iPhone：Safariの共有メニュー →「ホーム画面に追加」<br>Android：Chromeのメニュー →「ホーム画面に追加」</p>
        <p class="hint">記録は使用するブラウザ・端末ごとに保存されます。別のブラウザに切り替えると記録は引き継がれません。</p>`)}`;
  }

  function switchButtons(attr, options, current) {
    return `<div class="switch">${options.map(([value, label]) => `<button type="button" data-${attr}="${value}" class="${value === current ? 'active' : ''}" aria-pressed="${value === current}">${label}</button>`).join('')}</div>`;
  }

  function feeView() {
    const m = state.paymentMethod;
    const reverse = state.feeMode === 'reverse';
    const option = (value, label) => `<option value="${value}"${m === value ? ' selected' : ''}>${label}</option>`;
    const methodHint = m === 'card'
      ? `<p class="note"><strong>カード手数料は高い方の3.2％（税抜）で自動計算しています。</strong> カードブランドは選択不要です。実際の決済手数料はカードの種類によって低くなる場合があります。</p>
         <p class="hint">カード決済手数料には消費税10％を加算。Stripe Connectボリューム費用は0.2％（税抜）の概算です。振込手数料は税込275円／振込で、1件ごとの計算には含めていません。</p>`
      : m === 'ato'
        ? '<p class="hint">ATO後払いの決済手数料4.5％で概算。別途、振込手数料は税抜500円／振込で、1件ごとの計算には含めていません。</p>'
        : '';
    // 金額のすぐ下に結果を置く（スマホのキーボードが出ていても見えるように）
    return `
      <section class="card">
        ${switchButtons('mode', [['deduct', '手数料を引く'], ['reverse', '手取りから逆算']], state.feeMode)}
        <div class="twocol">
          <label class="field" data-wrap>
            <span>${reverse ? '希望する手取り（円）' : '請求金額（税込・円）'}</span>
            ${numInput({ field: 'feeAmount', kind: 'int', text: addCommas(feeAmount) })}
          </label>
          <label class="field"><span>支払い方法</span>
            <select data-pay>${option('base', '通常のみ')}${option('card', 'カード決済')}${option('ato', '後払い（ATO）')}</select>
          </label>
        </div>
      </section>
      <div id="fee-out"></div>
      ${card('手数料の設定', `
        ${methodHint}
        <div class="twocol">
          ${numField({ field: 'feeRate', kind: 'dec', label: 'くらま手数料率（％）', value: state.feeRate })}
          ${numField({ field: 'minimum', kind: 'int', label: '最低手数料（税抜・円）', value: state.minimum })}
        </div>
        <p class="hint">くらま手数料の初期値は20％、最低2,000円（税抜）。手数料に消費税10％を加算します。</p>
        <h3 class="section-title">消費税の納税分（概算）</h3>
        ${switchButtons('tax', [['off', '考慮しない'], ['on', '考慮する']], state.taxEnabled ? 'on' : 'off')}
        ${state.taxEnabled ? numField({ field: 'taxReserveRate', kind: 'dec', label: '売上に含まれる消費税から確保する割合（％）', value: state.taxReserveRate }) : ''}
        <p class="hint">確保額＝税込の請求金額 × 10/110 × 設定割合（初期値100％）。仕入税額控除や課税方式を反映していないため、実際の納税額とは異なります。</p>`)}`;
  }

  function feeResult() {
    return CALC.computeFee({
      mode: state.feeMode,
      amount: Number(feeAmount) || 0,
      rate: state.feeRate,
      minimum: state.minimum,
      method: state.paymentMethod,
      taxRate: state.taxEnabled ? state.taxReserveRate : 0,
    });
  }

  function feeOut() {
    const res = feeResult();
    if (!res.hasAmount) return card('計算結果', '<p class="hint">金額を入力すると計算結果が表示されます。</p>');
    if (!res.possible) {
      return card('計算結果', '<div class="result"><small>必要な請求金額（概算）</small><strong>計算不可</strong><p>今の手数料率などの設定では、希望する手取り額を確保できません。</p></div>');
    }
    const reverse = state.feeMode === 'reverse';
    const lines = [statLine('請求金額', yen(res.invoice)), statLine('くらま手数料（税込・概算）', minus(res.platform))];
    if (state.paymentMethod === 'card') {
      lines.push(statLine('カード決済手数料（税込・概算）', minus(res.payment)));
      lines.push(statLine('Stripe Connect費用（税込・概算）', minus(res.volume)));
    } else if (state.paymentMethod === 'ato') {
      lines.push(statLine('ATO決済手数料（概算）', minus(res.payment)));
    }
    lines.push(statLine('各種手数料差引後', yen(res.invoice - res.platform - res.payment - res.volume)));
    if (state.taxEnabled) {
      lines.push(statLine('売上に含まれる消費税（10/110・参考）', yen(Math.round(res.invoice * 10 / 110))));
      lines.push(statLine('消費税納税用に確保（概算）', minus(res.reserve)));
    }
    lines.push(statLine('最終的な手取り目安', yen(res.net)));
    return card('計算結果', `
      <div class="result"><small>${reverse ? '必要な請求金額（概算）' : '差引後の手取り目安'}</small><strong>${yen(reverse ? res.invoice : res.net)}</strong></div>
      ${lines.join('')}
      <p class="hint">振込手数料は入金ごとに発生するため含めていません。決済手数料の端数処理などで実際の入金明細とは差が生じる場合があります。</p>`);
  }

  function monthView(isCancel) {
    const name = isCancel ? 'キャンセル' : '口コミ';
    const d = monthData();
    const monthNum = Number(state.month.slice(5));
    const thisYear = new Date().getFullYear();
    const years = [...new Set([...Array.from({ length: 11 }, (_, i) => thisYear - 5 + i), state.year])].sort((a, b) => a - b);
    return `
      ${card(`${monthNum}月の件数`, `
        <div class="twocol">
          <label class="field"><span>年</span><select data-ym="year">${years.map(y => `<option value="${y}"${y === state.year ? ' selected' : ''}>${y}年</option>`).join('')}</select></label>
          <label class="field"><span>月</span><select data-ym="month">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}"${i + 1 === monthNum ? ' selected' : ''}>${i + 1}月</option>`).join('')}</select></label>
        </div>
        ${countRow('workCount', '作業件数', d.work)}
        ${countRow(isCancel ? 'cancelCount' : 'reviewCount', `${name}件数`, isCancel ? d.cancel : d.review)}
        ${numField({ field: isCancel ? 'goalCancel' : 'goalReview', kind: 'dec', label: `目標${name}率（％）`, value: state.goals[isCancel ? 'cancel' : 'review'] })}
        <p class="hint">直接入力か＋／−で変更でき、自動で保存されます。過去の月も選んで修正できます。</p>`)}
      <div id="month-out"></div>
      <div id="annual-out"></div>`;
  }

  function monthOut() {
    const isCancel = state.page === 'cancel';
    const name = isCancel ? 'キャンセル' : '口コミ';
    const d = monthData();
    const rate = CALC.monthRate(d, isCancel);
    const needed = CALC.neededForGoal(d, isCancel, state.goals[isCancel ? 'cancel' : 'review']);
    return card(`${Number(state.month.slice(5))}月の結果`, `
      <div class="result"><small>${name}率</small><strong>${pct(rate)}</strong></div>
      <div class="result"><small>目標までに必要な${isCancel ? 'キャンセルなし作業' : '口コミ付き作業'}</small><strong>${needed === null ? '到達不可' : `${needed.toLocaleString('ja-JP')}件`}</strong></div>
      <p class="hint">${isCancel ? 'キャンセル率＝キャンセル件数÷（作業件数＋キャンセル件数）' : '口コミ率＝口コミ件数÷作業件数'}。目標達成の試算は、今後${isCancel ? 'キャンセルが発生しない' : 'すべての追加作業に口コミが付く'}場合です。</p>`);
  }

  function annualOut() {
    const isCancel = state.page === 'cancel';
    const name = isCancel ? 'キャンセル' : '口コミ';
    const y = CALC.yearSummary(state.months, state.year, isCancel);
    return card(`${state.year}年の集計`, `
      <div class="result"><small>年間${name}率</small><strong>${pct(y.rate)}</strong></div>
      ${statLine('作業件数', `${y.work.toLocaleString('ja-JP')}件`)}
      ${statLine(`${name}件数`, `${(isCancel ? y.cancel : y.review).toLocaleString('ja-JP')}件`)}
      <h3 class="section-title">月別一覧</h3>
      ${y.rows.map(r => statLine(`${r.month}月`, pct(r.rate))).join('')}`);
  }

  function ratingView() {
    return `
      ${card('口コミの星別件数', `
        <p class="hint">数字を直接入力するか、＋／−で増減できます。入力内容は自動で保存されます。</p>
        ${[5, 4, 3, 2, 1].map(star => countRow(`star${star}`, `★${star}`, state.rating[star - 1])).join('')}`)}
      <div id="rating-out"></div>`;
  }

  function ratingOut() {
    const { n, avg, shown, next, needed } = CALC.ratingStats(state.rating);
    const message = n === 0 ? '件数を入力'
      : shown >= 5 ? '最高評価'
        : needed === null ? '到達不可'
          : `★5 あと${needed.toLocaleString('ja-JP')}件`;
    return card('現在の評価', `
      <div class="result"><small>平均評価（小数第3位以下切り捨て）</small><strong>${n ? shown.toFixed(2) : '—'}</strong><p>口コミ合計 ${n.toLocaleString('ja-JP')}件</p></div>
      ${statLine('実際の平均', n ? avg.toFixed(5) : '—')}
      ${statLine('次の評価', n && shown < 5 ? next.toFixed(2) : '—')}
      <div class="result"><small>次の0.01アップまで</small><strong>${message}</strong></div>
      <p class="hint">全口コミを同じ重みで単純平均する計算です。サービス側の独自集計とは異なる場合があります。</p>`);
  }

  function settingsView() {
    return `
      ${card('バックアップ', `
        <p class="hint">端末のデータ消去や機種変更に備え、JSONファイルを保存してください。</p>
        <button type="button" class="btn full" data-action="export">JSONバックアップを保存</button>
        <label class="field spaced"><span>JSONファイルから復元</span><input id="import" type="file" accept="application/json,.json"></label>
        <p class="note">復元すると現在の保存内容を上書きします。先にバックアップを取ってください。</p>`)}
      ${card('データの取り扱い', `
        <p class="hint">すべてこの端末のブラウザ内に保存します。外部送信・会員登録・広告・AI機能はありません。</p>
        <button type="button" class="btn danger full" data-action="reset">全データを初期化</button>`)}`;
  }

  const VIEWS = {
    home: homeView,
    fee: feeView,
    cancel: () => monthView(true),
    review: () => monthView(false),
    rating: ratingView,
    settings: settingsView,
  };

  // 結果の部分だけを書き換える（入力欄は触らないのでカーソルもキーボードも動かない）
  function renderOut() {
    const set = (sel, html) => {
      const el = $(sel);
      if (el) el.innerHTML = html;
    };
    if (state.page === 'home') set('#dash', dashHtml());
    if (state.page === 'fee') set('#fee-out', feeOut());
    if (state.page === 'cancel' || state.page === 'review') {
      set('#month-out', monthOut());
      set('#annual-out', annualOut());
    }
    if (state.page === 'rating') set('#rating-out', ratingOut());
  }

  function render() {
    const [title, sub] = TITLES[state.page];
    $('#heading').textContent = title;
    $('#subhead').textContent = sub;
    $('#home').hidden = state.page === 'home';
    $('#settingsBtn').hidden = state.page === 'settings';
    document.title = state.page === 'home' ? APP_TITLE : `${title}｜${APP_TITLE}`;
    view.innerHTML = VIEWS[state.page]();
    renderOut();
  }

  function go(page) {
    state.page = page;
    lastQuick = null;
    // ホームの「今月」と入力画面の月を揃える（先月のまま記録してしまうのを防ぐ）
    if (page === 'cancel' || page === 'review') {
      state.month = currentKey();
      state.year = Number(state.month.slice(0, 4));
    }
    saveState();
    render();
    window.scrollTo(0, 0);
  }

  /* ---------- バックアップ ---------- */
  function exportBackup() {
    const blob = new Blob([JSON.stringify({ app: APP_ID, version: 1, data: state }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${APP_TITLE}_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importBackup(file) {
    try {
      const parsed = JSON.parse(await file.text());
      const ok = parsed && parsed.app === APP_ID && parsed.version === 1 && Array.isArray(parsed.data?.rating) && parsed.data.rating.length === 5;
      if (!ok) throw new Error('unsupported');
      if (!confirm('現在のデータを上書きして復元しますか？')) return;
      state = sanitize(parsed.data);
      go('home');
      toast('復元しました');
    } catch {
      toast('対応していないJSONファイルです');
    }
  }

  function resetAll() {
    if (!confirm('すべての記録を削除しますか？この操作は取り消せません。')) return;
    state = defaultState();
    feeAmount = '';
    go('home');
    toast('初期化しました');
  }

  /* ---------- イベント ---------- */
  $('#home').addEventListener('click', () => go('home'));
  $('#settingsBtn').addEventListener('click', () => go('settings'));

  view.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const { go: page, mode, tax, step, action, quick } = btn.dataset;
    if (page) go(page);
    else if (quick) quickAdd(quick);
    else if (action === 'undo') undoQuick();
    else if (mode) {
      state.feeMode = mode;
      saveState();
      render();
    } else if (tax) {
      state.taxEnabled = tax === 'on';
      saveState();
      render();
    } else if (step) stepField(btn);
    else if (action === 'export') exportBackup();
    else if (action === 'reset') resetAll();
  });

  view.addEventListener('change', e => {
    const el = e.target;
    if (el.matches('[data-pay]')) {
      state.paymentMethod = el.value;
      saveState();
      render();
    } else if (el.matches('[data-ym]')) {
      if (el.dataset.ym === 'year') {
        state.year = Number(el.value);
        state.month = ymKey(state.year, Number(state.month.slice(5)));
      } else {
        state.month = ymKey(state.year, Number(el.value));
      }
      saveState();
      render();
    } else if (el.id === 'import' && el.files && el.files[0]) {
      importBackup(el.files[0]);
      el.value = '';
    }
  });

  // 日本語入力の変換中（未確定）でも、その時点の数字で計算する
  view.addEventListener('input', e => {
    if (e.target.matches('[data-num]')) onNumInput(e.target);
  });
  view.addEventListener('compositionend', e => {
    if (e.target.matches('[data-num]')) onNumInput(e.target);
  });
  // タップしたら全選択して、そのまま打ち直せるようにする（iPhoneは select() が効かないことがある）
  view.addEventListener('focusin', e => {
    const el = e.target;
    if (!el.matches('[data-num]')) return;
    setTimeout(() => {
      if (document.activeElement === el) el.setSelectionRange(0, el.value.length);
    }, 0);
  });
  view.addEventListener('focusout', e => {
    if (e.target.matches('[data-num]')) onNumBlur(e.target);
  });
  view.addEventListener('keydown', e => {
    // 変換を確定するEnter（isComposing または keyCode 229）では欄を離れない
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229 || !e.target.matches('[data-num]')) return;
    // 件数の欄はEnterで次の欄へ進み、続けて打てるようにする
    const counts = [...view.querySelectorAll('.count-input')];
    const next = counts[counts.indexOf(e.target) + 1];
    if (e.target.matches('.count-input') && next) next.focus();
    else e.target.blur();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      saveState();
    } else if (isIdle(state.lastActiveAt)) {
      state.page = 'home';
      saveState();
      render();
      window.scrollTo(0, 0);
    }
  });
  window.addEventListener('pagehide', saveState);

  saveState();
  render();
})();
