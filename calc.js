/*
 * 計算ロジック（画面に依存しない関数だけをまとめています）
 * ブラウザでは window.Calc、Node.js では require して使えます。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const TAX = 1.1; // 消費税10％
  const CARD_PERCENT = 3.2; // オンラインカード決済の手数料率（税抜・％）

  const trunc2 = n => Math.floor((n + 1e-10) * 100) / 100;
  const toCount = v => Math.max(0, Math.floor(Number(v) || 0));
  const monthCounts = d => ({
    work: toCount(d && d.work),
    cancel: toCount(d && d.cancel),
    review: toCount(d && d.review),
  });

  // 請求金額 x に対する手数料の内訳
  function feeBreakdown(x, p) {
    const platform = Math.floor(Math.max(x * p.rate / 100, p.minimum) * TAX + 1e-9);
    let payment = 0;
    let volume = 0;
    if (p.method === 'card') {
      payment = Math.round(x * CARD_PERCENT / 100 * TAX);
      volume = Math.floor(Math.max(0, x - platform - payment) * 0.0022 / 1.0022 + 1e-9);
    } else if (p.method === 'ato') {
      payment = Math.round(x * 0.045);
    }
    const reserve = Math.round(x * 10 / 110 * p.taxRate / 100);
    return { platform, payment, volume, reserve, net: x - platform - payment - volume - reserve };
  }

  // 手数料を引いた後に手元へ残る割合（0以下なら逆算できない）
  function feeMargin(p) {
    const extra = p.method === 'card' ? 3.52 + 0.22 : p.method === 'ato' ? 4.5 : 0;
    return 1 - (p.rate * TAX + p.taxRate / 11 + extra) / 100;
  }

  // 希望手取りを得るのに必要な請求金額。計算できなければ null
  function solveInvoice(target, p) {
    if (feeMargin(p) <= 0) return null;
    let lo = 0;
    let hi = Math.max(1, target + 2200 + Math.ceil(target * 0.45));
    while (feeBreakdown(hi, p).net < target && hi < 1e12) hi *= 2;
    if (feeBreakdown(hi, p).net < target) return null;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (feeBreakdown(mid, p).net >= target) hi = mid;
      else lo = mid + 1;
    }
    // 端数処理で1円単位の上下が起きるため、少し手前も確認する
    for (let x = Math.max(0, lo - 200); x < lo; x++) {
      if (feeBreakdown(x, p).net >= target) return x;
    }
    return lo;
  }

  function computeFee({ mode, amount, rate, minimum, method, taxRate }) {
    if (!(amount > 0)) return { hasAmount: false };
    const p = { rate, minimum, method, taxRate };
    let invoice = amount;
    if (mode === 'reverse') {
      const solved = solveInvoice(amount, p);
      if (solved === null) return { hasAmount: true, possible: false };
      invoice = solved;
    }
    return { hasAmount: true, possible: true, invoice, ...feeBreakdown(invoice, p) };
  }

  // counts は [★1, ★2, ★3, ★4, ★5] の件数
  function ratingStats(counts) {
    const n = counts.reduce((a, b) => a + b, 0);
    const sum = counts.reduce((a, b, i) => a + b * (i + 1), 0);
    const avg = n ? sum / n : 0;
    const shown = n ? trunc2(avg) : 0;
    const next = n ? Math.min(5, Math.round((shown + 0.01) * 100) / 100) : 0;
    let needed = null;
    if (n && shown < 5) {
      if (next === 5) needed = sum === 5 * n ? 0 : null;
      else needed = Math.max(0, Math.ceil((next * n - sum) / (5 - next) - 1e-9));
    }
    return { n, sum, avg, shown, next, needed };
  }

  function monthRate(d, isCancel) {
    if (isCancel) {
      const total = d.work + d.cancel;
      return total ? d.cancel / total * 100 : 0;
    }
    return d.work ? d.review / d.work * 100 : 0;
  }

  function neededForGoal(d, isCancel, goal) {
    if (!(goal > 0 && goal <= 100)) return null;
    if (isCancel) return Math.max(0, Math.ceil(d.cancel * 100 / goal - (d.work + d.cancel) - 1e-9));
    if (goal < 100) return Math.max(0, Math.ceil((goal * d.work - 100 * d.review) / (100 - goal) - 1e-9));
    return d.review === d.work ? 0 : null;
  }

  function yearSummary(months, year, isCancel) {
    const total = { work: 0, cancel: 0, review: 0 };
    const rows = [];
    for (let m = 1; m <= 12; m++) {
      const d = monthCounts(months && months[`${year}-${String(m).padStart(2, '0')}`]);
      total.work += d.work;
      total.cancel += d.cancel;
      total.review += d.review;
      rows.push({ month: m, rate: monthRate(d, isCancel) });
    }
    return { ...total, rate: monthRate(total, isCancel), rows };
  }

  return { feeBreakdown, feeMargin, solveInvoice, computeFee, ratingStats, monthRate, neededForGoal, yearSummary, monthCounts };
});
