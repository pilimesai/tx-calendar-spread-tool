/* 介面邏輯：讀取盤後資料、收集參數、呼叫 SpreadEngine、渲染視覺化儀表板 */
(function () {
  "use strict";

  const { evaluateEntry, parseIsoDate, iso } = window.SpreadEngine;
  const STORAGE_KEY = "tx-spread-inputs-v2";

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
  const STATUS_TEXT = { block: "紅線", warn: "注意", pass: "通過" };
  const STATUS_RANK = { block: 0, warn: 1, pass: 2 };
  const SIGNAL_ICON = { GREEN: "🟢", YELLOW: "🟡", RED: "🔴" };

  let market = null;
  const checkedSteps = new Set();
  const $ = (id) => document.getElementById(id);

  function syncContractButtons(value) {
    $("contractType").value = value;
    document.querySelectorAll(".seg-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.contract === value);
    });
  }

  function setForm(values) {
    for (const k of FIELDS) {
      const el = $(k);
      const v = values[k] ?? BASE[k];
      if (el.type === "checkbox") el.checked = Boolean(v);
      else el.value = v;
    }
    syncContractButtons(values.contractType || BASE.contractType);
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
    } catch (_) { /* 無痕模式忽略 */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function money(n) {
    return `${n >= 0 ? "+" : "-"}NT$ ${Math.abs(n).toLocaleString("en-US")}`;
  }

  function renderGauge(v) {
    $("gauge-plain").textContent = v.plainSummary;
    $("gauge-mid-label").textContent = `理論合理價 ${v.theoreticalSpread}`;
    $("gauge-formula").textContent =
      `理論價 ${v.theoreticalSpread} = 資金利息 +${v.fundingCost} − 預計除息 ${v.expectedExDivPoints}`;

    // -60 ~ +60 點對應 4% ~ 96%
    const clamped = Math.max(-60, Math.min(60, v.mispricing));
    const pct = 50 + (clamped / 60) * 46;
    const pin = $("gauge-pin");
    pin.style.left = `${pct}%`;

    // 接近左右邊緣時調整標籤對齊，避免在 375px 手機上被截斷
    const lbl = $("gauge-pin-label");
    lbl.textContent = `市場 ${v.marketSpread}`;
    if (pct < 18) pin.style.transform = "translateX(-15%)";
    else if (pct > 82) pin.style.transform = "translateX(-85%)";
    else pin.style.transform = "translateX(-50%)";
  }

  function renderChecks(checks) {
    const box = $("checks-list");
    box.innerHTML = "";
    const sorted = checks.slice().sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);

    for (const item of sorted) {
      const row = document.createElement("div");
      row.className = `check-row ${item.status}`;

      const head = document.createElement("div");
      head.className = "check-head";

      const left = document.createElement("div");
      left.className = "check-left";
      const title = document.createElement("span");
      title.className = "check-title";
      title.textContent = item.title;
      const metric = document.createElement("span");
      metric.className = "check-metric";
      metric.textContent = item.metric;
      left.append(title, metric);

      const badges = document.createElement("div");
      badges.className = "check-badges";
      const sub = document.createElement("span");
      sub.className = "sub-badge";
      sub.textContent = item.badge;
      const tag = document.createElement("span");
      tag.className = `status-tag ${item.status}`;
      tag.textContent = STATUS_TEXT[item.status];
      badges.append(sub, tag);

      head.append(left, badges);

      const summary = document.createElement("div");
      summary.className = "check-summary";
      summary.textContent = item.summary;

      row.append(head, summary);
      box.appendChild(row);
    }
  }

  function renderChecklist(items) {
    const ul = $("checklist");
    ul.innerHTML = "";
    items.forEach((text, idx) => {
      const li = document.createElement("li");
      const label = document.createElement("label");
      label.className = "checklist-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = checkedSteps.has(idx);
      if (cb.checked) label.classList.add("done");

      cb.addEventListener("change", () => {
        if (cb.checked) checkedSteps.add(idx);
        else checkedSteps.delete(idx);
        label.classList.toggle("done", cb.checked);
        updateChecklistProgress(items.length);
      });

      const sp = document.createElement("span");
      sp.textContent = text;
      label.append(cb, sp);
      li.appendChild(label);
      ul.appendChild(li);
    });
    updateChecklistProgress(items.length);
  }

  function updateChecklistProgress(total) {
    const pill = $("checklist-progress");
    pill.textContent = `已完成 ${checkedSteps.size} / ${total}`;
    pill.classList.toggle("done", checkedSteps.size === total && total > 0);
  }

  function renderSimAndAdvanced(inp) {
    const simBanner = $("sim-banner");
    if (inp.evalDatetime) {
      $("sim-banner-text").textContent = `🧪 目前為模擬情境（${inp.evalDatetime.replace("T", " ")}）`;
      simBanner.classList.remove("hidden");
    } else {
      simBanner.classList.add("hidden");
    }

    const hasCustomAdv =
      Number($("annualRatePct").value) !== BASE.annualRatePct ||
      $("evalDatetime").value !== "" ||
      $("nearSettlementOverride").value !== "" ||
      $("targetExitSpread").value !== "" ||
      !$("exDivDatesConfirmed").checked;
    $("adv-badge").classList.toggle("hidden", !hasCustomAdv);
  }

  function render() {
    const inp = readForm();
    const r = evaluateEntry(inp);
    save();
    renderSimAndAdvanced(inp);

    const sigCls = `sig-${r.signal.toLowerCase()}`;
    $("signal-banner").className = `signal-banner ${sigCls}`;
    $("signal-dot").textContent = SIGNAL_ICON[r.signal];
    $("signal-short").textContent = r.signalShort;
    $("signal-label").textContent = r.signalLabel.replace(/^[🟢🟡🔴]\s*/, "");
    $("action-summary").textContent = r.actionSummary;

    // 統計膠囊
    const counts = { block: 0, warn: 0, pass: 0 };
    r.checks.forEach((c) => counts[c.status]++);
    const heroCounts = $("hero-counts");
    heroCounts.innerHTML = "";
    for (const [cls, text] of [
      ["block", `⛔ ${counts.block} 紅線`],
      ["warn", `⚠️ ${counts.warn} 注意`],
      ["pass", `✅ ${counts.pass} 通過`],
    ]) {
      if (cls === "block" && counts.block === 0) continue;
      const sp = document.createElement("span");
      sp.className = `h-pill ${cls}`;
      sp.textContent = text;
      heroCounts.appendChild(sp);
    }

    const v = r.valuation;
    const c = r.calendar;
    const s = r.sizing;

    // 手機頂部即時迷你燈號列
    const mini = $("live-mini-bar");
    mini.className = `live-mini-bar ${sigCls}`;
    const diffWord = v.mispricing > 0 ? `貴了 ${v.mispricing} 點` : `便宜 ${v.discountPoints} 點`;
    const dayWord = c.isSettlementDay ? "今日結算" : `剩 ${c.tradingDaysLeft} 交易日`;
    $("mini-signal-text").textContent = `${SIGNAL_ICON[r.signal]} ${r.signalShort} ・ ${diffWord} ・ ${dayWord}`;

    renderGauge(v);

    // 4 張指標卡
    $("m-theory").textContent = `${v.theoreticalSpread} 點`;
    $("m-theory-sub").textContent = `利息 +${v.fundingCost} − 除息 ${v.expectedExDivPoints}`;

    const disc = $("m-disc");
    disc.textContent = v.mispricing > 0 ? `貴了 ${v.mispricing} 點` : `便宜 ${v.discountPoints} 點`;
    disc.className = `m-value ${v.mispricing > 0 ? "neg" : "pos"}`;
    $("m-disc-sub").textContent = `市場報價 ${v.marketSpread}｜${v.valuationLabel}`;

    $("m-days").textContent = c.isSettlementDay ? "今日結算！" : `剩 ${c.tradingDaysLeft} 交易日`;
    $("m-phase").textContent = c.phaseLabel;
    $("m-days-sub").textContent = `近 ${c.nearSettlement}｜遠 ${c.farSettlement}`;

    const p = $("m-profit");
    p.textContent = s.expectedProfitTwd >= 0 ? `預計賺 ${money(s.expectedProfitTwd)}` : `預估虧 ${money(s.expectedProfitTwd)}`;
    p.className = `m-value ${s.expectedProfitTwd >= 0 ? "pos" : "neg"}`;
    $("m-profit-sub").textContent =
      `目標平倉 ${s.suggestedExitSpread}（${s.expectedGainPoints} 點）｜30點洗盤波動 ±NT$ ${s.stressLoss30Twd.toLocaleString("en-US")}`;

    renderChecks(r.checks);
    renderChecklist(r.checklist);
    renderExDiv(c.nearSettlement, c.farSettlement);
  }

  function renderExDiv(nearIso, farIso) {
    const box = $("exdiv-list");
    const win = $("exdiv-window");
    const pill = $("exdiv-count");
    box.innerHTML = "";
    if (!market || !Array.isArray(market.exdiv)) {
      pill.textContent = "-- 檔";
      win.textContent = "尚無除權息預告資料。";
      return;
    }
    const start = iso(new Date(parseIsoDate(nearIso).getTime() + 86400000));
    const rows = market.exdiv.filter((x) => x.date >= start && x.date <= farIso);
    pill.textContent = `${rows.length} 檔`;
    win.textContent = `區間：${start} ～ ${farIso}（證交所目前已公告者）`;

    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.style.padding = "8px 0";
      empty.textContent = "此區間目前沒有已公告除權息的股票。";
      box.appendChild(empty);
      return;
    }

    for (const x of rows) {
      const d = document.createElement("div");
      d.className = "exdiv-item";
      const cash = x.cash_dividend == null ? "待公告" : `現金 ${x.cash_dividend}`;
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
      ["近月結算價", tx.near_price != null ? tx.near_price.toLocaleString("en-US") : "--"],
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
    $("nearSettlementOverride").value = "";
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

    document.querySelectorAll(".seg-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        syncContractButtons(btn.dataset.contract);
        render();
      });
    });

    document.querySelectorAll("[data-preset]").forEach((b) =>
      b.addEventListener("click", () => {
        const key = b.dataset.preset;
        if (key === "reset") checkedSteps.clear();
        setForm(key === "reset" ? BASE : PRESETS[key]);
        render();
      })
    );

    $("btn-apply-market").addEventListener("click", applyMarket);
    $("btn-refresh-market").addEventListener("click", async () => {
      await fetchMarket();
      render();
    });
    $("btn-exit-sim").addEventListener("click", () => {
      $("evalDatetime").value = "";
      $("nearSettlementOverride").value = "";
      if (market) applyMarket();
      else render();
    });

    render();
    await fetchMarket();
    if (!saved && market) applyMarket();
    else render();
  });
})();
