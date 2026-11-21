/* 介面邏輯：讀取盤後資料、收集參數、呼叫 SpreadEngine、渲染結果 */
(function () {
  "use strict";

  const { evaluateEntry, parseIsoDate, iso } = window.SpreadEngine;
  const STORAGE_KEY = "tx-spread-inputs-v1";

  const BASE = {
    indexLevel: 23000,
    annualRatePct: 1.75,
    expectedExDivPoints: 0,
    marketSpread: 25,
    foreignNetShort: 28000,
    bidAskGap: 2,
    exDivDatesConfirmed: true,
    evalDatetime: "",
    nearSettlementOverride: "",
    contractType: "MTX",
    contracts: 1,
    targetExitSpread: "",
  };

  const PRESETS = {
    july_discount: Object.assign({}, BASE, {
      annualRatePct: 1.83, expectedExDivPoints: 250, marketSpread: -240, foreignNetShort: 22000,
      evalDatetime: "2026-07-09T10:00", contractType: "TX", targetExitSpread: -170,
    }),
    non_exdiv_golden: Object.assign({}, BASE, {
      marketSpread: 22, foreignNetShort: 19000, bidAskGap: 1,
      evalDatetime: "2026-11-12T10:30", contracts: 2, targetExitSpread: 65,
    }),
    settlement_blackhole: Object.assign({}, BASE, {
      marketSpread: 200, foreignNetShort: 25000, bidAskGap: 42,
      evalDatetime: "2026-11-18T13:18", contractType: "TX",
    }),
  };

  const FIELDS = Object.keys(BASE);
  const NUMERIC = new Set([
    "indexLevel", "annualRatePct", "expectedExDivPoints", "marketSpread",
    "foreignNetShort", "bidAskGap", "contracts",
  ]);

  let market = null;
  const $ = (id) => document.getElementById(id);

  function setForm(values) {
    for (const k of FIELDS) {
      const el = $(k);
      const v = values[k] ?? BASE[k];
      if (el.type === "checkbox") el.checked = Boolean(v);
      else el.value = v;
    }
  }

  function readForm() {
    const out = {};
    for (const k of FIELDS) {
      const el = $(k);
      if (el.type === "checkbox") out[k] = el.checked;
      else if (NUMERIC.has(k)) out[k] = el.value === "" ? BASE[k] : Number(el.value);
      else out[k] = el.value;
    }
    out.contracts = Math.max(1, Math.round(out.contracts || 1));
    out.targetExitSpread = out.targetExitSpread === "" ? null : Number(out.targetExitSpread);
    return out;
  }

  function save() {
    try {
      const v = {};
      for (const k of FIELDS) {
        const el = $(k);
        v[k] = el.type === "checkbox" ? el.checked : el.value;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    } catch (_) { /* 無痕模式等情況忽略 */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function factors(id, items, cls, icon) {
    const box = $(id);
    box.innerHTML = "";
    for (const t of items) {
      const d = document.createElement("div");
      d.className = `factor ${cls}`;
      d.textContent = `${icon} ${t}`;
      box.appendChild(d);
    }
  }

  function money(n) {
    return `${n >= 0 ? "+" : "-"}NT$ ${Math.abs(n).toLocaleString("en-US")}`;
  }

  function render() {
    const r = evaluateEntry(readForm());
    save();

    $("signal-banner").className = `signal-banner sig-${r.signal.toLowerCase()}`;
    $("signal-label").textContent = r.signalLabel;
    $("action-summary").textContent = r.actionSummary;

    const v = r.valuation;
    $("m-theory").textContent = `${v.theoreticalSpread} 點`;
    $("m-theory-sub").textContent = `資金成本 +${v.fundingCost} − 除息 ${v.expectedExDivPoints}`;

    const disc = $("m-disc");
    disc.textContent = v.discountPoints >= 0 ? `低估 ${v.discountPoints}` : `高估 ${Math.abs(v.discountPoints)}`;
    disc.className = `m-value ${v.discountPoints >= 0 ? "pos" : "neg"}`;
    $("m-disc-sub").textContent = `${v.valuationLabel}｜市場 ${v.marketSpread}`;

    const c = r.calendar;
    $("m-days").textContent = c.isSettlementDay ? "今日結算！" : `${c.tradingDaysLeft} 交易日`;
    $("m-days-sub").textContent = `近月 ${c.nearSettlement}｜遠月 ${c.farSettlement}`;

    const s = r.sizing;
    const p = $("m-profit");
    p.textContent = money(s.expectedProfitTwd);
    p.className = `m-value ${s.expectedProfitTwd >= 0 ? "pos" : "neg"}`;
    $("m-profit-sub").textContent =
      `${s.contracts} 組 ${s.contractName}｜目標 ${s.suggestedExitSpread}（${s.expectedGainPoints} 點）`;

    factors("f-blockers", r.riskFactors.blockers, "blocker", "⛔");
    factors("f-warnings", r.riskFactors.warnings, "warning", "⚠️");
    factors("f-positives", r.riskFactors.positives, "positive", "✅");

    const ul = $("checklist");
    ul.innerHTML = "";
    for (const item of r.checklist) {
      const li = document.createElement("li");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      const sp = document.createElement("span");
      sp.textContent = item;
      li.append(cb, sp);
      ul.appendChild(li);
    }

    renderExDiv(c.nearSettlement, c.farSettlement);
  }

  function renderExDiv(nearIso, farIso) {
    const box = $("exdiv-list");
    const win = $("exdiv-window");
    box.innerHTML = "";
    if (!market || !Array.isArray(market.exdiv)) {
      win.textContent = "尚無除權息預告資料。";
      return;
    }
    const start = iso(new Date(parseIsoDate(nearIso).getTime() + 86400000));
    const rows = market.exdiv.filter((x) => x.date >= start && x.date <= farIso);
    win.textContent = `區間：${start} ～ ${farIso}，共 ${rows.length} 檔（證交所目前已公告者）`;
    for (const x of rows) {
      const d = document.createElement("div");
      d.className = "exdiv-item";
      const cash = x.cash_dividend == null ? "待公告" : `現金 ${x.cash_dividend}`;
      d.innerHTML = "";
      for (const [cls, txt] of [["d", x.date.slice(5)], ["n", `${x.code} ${x.name}（${x.type}）`], ["c", cash]]) {
        const s = document.createElement("span");
        s.className = cls;
        s.textContent = txt;
        d.appendChild(s);
      }
      box.appendChild(d);
    }
  }

  function renderMarket() {
    const box = $("market-summary");
    const status = $("data-status");
    if (!market) {
      box.textContent = "無法載入盤後資料，請手動輸入參數。";
      status.textContent = "⚠️ 盤後資料載入失敗";
      status.className = "data-status err";
      return;
    }
    const tx = market.tx || {};
    const fo = market.foreign || {};
    const fmtD = (d) => (d && d.length === 8 ? `${d.slice(0, 4)}/${d.slice(4, 6)}/${d.slice(6)}` : d || "--");
    const items = [
      ["資料日期", fmtD(tx.date)],
      [`近遠月價差 ${tx.near_month?.slice(4) || ""}/${tx.far_month?.slice(4) || ""}`, tx.spread ?? "--"],
      ["近月結算價", tx.near_price ?? "--"],
      ["外資台指淨空單", fo.net_short != null ? fo.net_short.toLocaleString("en-US") + " 口" : "--"],
    ];
    box.className = "market-summary";
    box.innerHTML = "";
    for (const [k, v] of items) {
      const d = document.createElement("div");
      d.className = "kv";
      const kk = document.createElement("div");
      kk.className = "k";
      kk.textContent = k;
      const vv = document.createElement("div");
      vv.className = "v";
      vv.textContent = v;
      d.append(kk, vv);
      box.appendChild(d);
    }
    status.textContent = `✅ 盤後資料 ${fmtD(tx.date)}`;
    status.className = "data-status ok";
  }

  function applyMarket() {
    if (!market) return;
    const tx = market.tx || {};
    const fo = market.foreign || {};
    if (tx.near_price) $("indexLevel").value = Math.round(tx.near_price);
    if (tx.spread != null) $("marketSpread").value = tx.spread;
    if (fo.net_short != null) $("foreignNetShort").value = fo.net_short;
    $("evalDatetime").value = "";
    render();
  }

  async function fetchMarket() {
    try {
      const res = await fetch(`data/market.json?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      market = await res.json();
    } catch (_) {
      market = null;
    }
    renderMarket();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const saved = load();
    setForm(saved || BASE);

    for (const k of FIELDS) {
      $(k).addEventListener("input", render);
      $(k).addEventListener("change", render);
    }
    document.querySelectorAll("[data-preset]").forEach((b) =>
      b.addEventListener("click", () => {
        setForm(b.dataset.preset === "reset" ? BASE : PRESETS[b.dataset.preset]);
        render();
      })
    );
    $("btn-apply-market").addEventListener("click", applyMarket);
    $("btn-refresh-market").addEventListener("click", async () => {
      await fetchMarket();
      render();
    });

    render();
    await fetchMarket();
    if (!saved && market) applyMarket(); // 第一次開啟自動帶入盤後資料
    else render();
  });
})();
