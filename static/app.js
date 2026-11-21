const PRESETS = {
  default: {
    index_level: 23000,
    annual_rate_pct: 1.75,
    expected_ex_div_points: 0,
    market_spread: 25,
    foreign_net_short: 28000,
    bid_ask_gap: 2,
    ex_div_dates_confirmed: true,
    eval_datetime: "",
    trading_days_override: "",
    contract_type: "MTX",
    contracts: 1,
    target_exit_spread: "",
  },
  july_discount: {
    index_level: 23000,
    annual_rate_pct: 1.83,
    expected_ex_div_points: 250,
    market_spread: -240,
    foreign_net_short: 22000,
    bid_ask_gap: 2,
    ex_div_dates_confirmed: true,
    eval_datetime: "2026-07-09T10:00",
    trading_days_override: "",
    contract_type: "TX",
    contracts: 1,
    target_exit_spread: -170,
  },
  non_exdiv_golden: {
    index_level: 23000,
    annual_rate_pct: 1.75,
    expected_ex_div_points: 0,
    market_spread: 22,
    foreign_net_short: 19000,
    bid_ask_gap: 1,
    ex_div_dates_confirmed: true,
    eval_datetime: "2026-11-12T10:30",
    trading_days_override: "",
    contract_type: "MTX",
    contracts: 2,
    target_exit_spread: 65,
  },
  settlement_blackhole: {
    index_level: 23000,
    annual_rate_pct: 1.75,
    expected_ex_div_points: 0,
    market_spread: 200,
    foreign_net_short: 25000,
    bid_ask_gap: 42,
    ex_div_dates_confirmed: true,
    eval_datetime: "2026-11-18T13:18",
    trading_days_override: "",
    contract_type: "TX",
    contracts: 1,
    target_exit_spread: "",
  },
};

const FIELD_IDS = [
  "index_level",
  "annual_rate_pct",
  "expected_ex_div_points",
  "market_spread",
  "foreign_net_short",
  "bid_ask_gap",
  "ex_div_dates_confirmed",
  "eval_datetime",
  "trading_days_override",
  "contract_type",
  "contracts",
  "target_exit_spread",
];

function collectPayload() {
  const payload = {};
  for (const id of FIELD_IDS) {
    const el = document.getElementById(id);
    if (el.type === "checkbox") {
      payload[id] = el.checked;
    } else {
      payload[id] = el.value;
    }
  }
  return payload;
}

function applyPreset(name) {
  const data = PRESETS[name];
  if (!data) return;
  for (const id of FIELD_IDS) {
    const el = document.getElementById(id);
    if (el.type === "checkbox") {
      el.checked = Boolean(data[id]);
    } else {
      el.value = data[id] ?? "";
    }
  }
  runEvaluation();
}

function renderFactors(containerId, items, cssClass, prefix) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  for (const text of items) {
    const div = document.createElement("div");
    div.className = `factor-item ${cssClass}`;
    div.textContent = `${prefix} ${text}`;
    container.appendChild(div);
  }
}

async function runEvaluation() {
  const payload = collectPayload();
  const res = await fetch("/api/evaluate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    document.getElementById("signal-label").textContent = "參數錯誤";
    document.getElementById("action-summary").textContent = data.error || "請檢查輸入數值";
    return;
  }

  const banner = document.getElementById("signal-banner");
  banner.className = `signal-banner signal-${data.signal.toLowerCase()}`;
  document.getElementById("signal-label").textContent = data.signal_label;
  document.getElementById("action-summary").textContent = data.action_summary;

  const v = data.valuation;
  document.getElementById("val-theoretical").textContent = `${v.theoretical_spread} 點`;
  document.getElementById("val-formula-detail").textContent =
    `資金成本 +${v.funding_cost} － 預計除息 ${v.expected_ex_div_points}`;

  const discSign = v.discount_points >= 0 ? `低估 ${v.discount_points}` : `高估 ${Math.abs(v.discount_points)}`;
  document.getElementById("val-discount").textContent = `${discSign} 點`;
  document.getElementById("val-label").textContent = `${v.valuation_label}（市場 ${v.market_spread}）`;

  const c = data.calendar;
  document.getElementById("cal-days").textContent =
    c.is_settlement_day ? "今日結算！" : `${c.trading_days_left} 個交易日`;
  document.getElementById("cal-dates").textContent =
    `近月 ${c.near_settlement} / 遠月 ${c.far_settlement}`;

  const s = data.sizing;
  const sign = s.expected_profit_twd >= 0 ? "+" : "";
  document.getElementById("size-profit").textContent =
    `${sign}NT$ ${s.expected_profit_twd.toLocaleString()}`;
  document.getElementById("size-stress").textContent =
    `目標平倉 ${s.suggested_exit_spread} (${s.expected_gain_points}點)｜30點洗盤波動約 NT$ ${s.stress_loss_30_twd.toLocaleString()}`;

  renderFactors("factors-blockers", data.risk_factors.blockers, "factor-blocker", "⛔");
  renderFactors("factors-warnings", data.risk_factors.warnings, "factor-warning", "⚠️");
  renderFactors("factors-positives", data.risk_factors.positives, "factor-positive", "✅");

  const checklistEl = document.getElementById("checklist");
  checklistEl.innerHTML = "";
  for (const item of data.checklist) {
    const li = document.createElement("li");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    const span = document.createElement("span");
    span.textContent = item;
    li.appendChild(cb);
    li.appendChild(span);
    checklistEl.appendChild(li);
  }
}

async function fetchTwseExDiv() {
  const statusEl = document.getElementById("twse-status");
  const previewEl = document.getElementById("twse-preview");
  statusEl.textContent = "查詢中...";
  previewEl.classList.add("hidden");
  try {
    const res = await fetch("/api/twse-exdiv");
    const data = await res.json();
    if (!data.ok) {
      statusEl.textContent = data.error;
      return;
    }
    statusEl.textContent = `已取得 ${data.count} 筆證交所除權息預告資料`;
    if (data.rows.length > 0) {
      const lines = data.rows.slice(0, 12).map((r) => r.slice(0, 5).join(" | "));
      previewEl.textContent = lines.join("\n");
      previewEl.style.whiteSpace = "pre-wrap";
      previewEl.classList.remove("hidden");
    }
  } catch (err) {
    statusEl.textContent = `查詢失敗：${err}`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  for (const id of FIELD_IDS) {
    document.getElementById(id).addEventListener("input", runEvaluation);
    document.getElementById(id).addEventListener("change", runEvaluation);
  }
  document.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => applyPreset(btn.dataset.preset));
  });
  document.getElementById("btn-fetch-twse").addEventListener("click", fetchTwseExDiv);
  runEvaluation();
});
