// 執行：node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const { thirdWednesday, evaluateEntry, iso } = require("../engine.js");

test("每月第三個週三", () => {
  assert.equal(iso(thirdWednesday(2026, 11)), "2026-11-18");
  assert.equal(iso(thirdWednesday(2026, 7)), "2026-07-15");
  assert.equal(iso(thirdWednesday(2027, 1)), "2027-01-20");
});

test("7月除息低估：依35天結算間隔理論 -209.73、報價 -240、結算前 4 天 → 綠燈", () => {
  const r = evaluateEntry({
    indexLevel: 23000,
    annualRatePct: 1.826,
    expectedExDivPoints: 250,
    marketSpread: -240,
    foreignNetShort: 22000,
    bidAskGap: 2,
    evalDatetime: "2026-07-09T10:00",
    contractType: "TX",
    targetExitSpread: -170,
  });
  assert.equal(r.signal, "GREEN");
  assert.equal(r.calendar.settlementGapDays, 35);
  assert.equal(r.valuation.fundingCost, 40.27);
  assert.equal(r.valuation.theoreticalSpread, -209.73);
  assert.ok(r.valuation.discountPoints > 30);
  assert.equal(r.calendar.tradingDaysLeft, 4);
  assert.equal(r.sizing.expectedGainPoints, 70);
  assert.equal(r.sizing.expectedProfitTwd, 14000);
});

test("報價 -170 高估 45 點 → 紅燈", () => {
  const r = evaluateEntry({
    indexLevel: 23000,
    annualRatePct: 1.826,
    expectedExDivPoints: 250,
    marketSpread: -170,
    foreignNetShort: 22000,
    evalDatetime: "2026-07-14T10:00",
  });
  assert.equal(r.signal, "RED");
  assert.ok(r.riskFactors.blockers.some((b) => b.includes("高於理論價差")));
});

test("結算日 13:18 流動性黑洞 → 紅燈且至少兩條紅線", () => {
  const r = evaluateEntry({
    marketSpread: 200,
    foreignNetShort: 25000,
    bidAskGap: 42,
    evalDatetime: "2026-11-18T13:18",
  });
  assert.equal(r.signal, "RED");
  assert.ok(r.calendar.isSettlementDay);
  assert.ok(r.riskFactors.blockers.length >= 2);
});

test("外資淨空單 46,000 口且折價不足 → 紅燈", () => {
  const r = evaluateEntry({
    marketSpread: 35,
    foreignNetShort: 46000,
    evalDatetime: "2026-11-12T10:00",
  });
  assert.equal(r.signal, "RED");
  assert.ok(r.riskFactors.blockers.some((b) => b.includes("外資未平倉淨空單")));
});

test("結算日過後自動換到下個月", () => {
  const r = evaluateEntry({ evalDatetime: "2026-11-21T09:00" });
  assert.equal(r.calendar.nearSettlement, "2026-12-16");
  assert.equal(r.calendar.farSettlement, "2027-01-20");
});

test("結構化體檢輸出：綠燈情境回傳 5 項全通過與黃金卡位期", () => {
  const r = evaluateEntry({
    indexLevel: 23000,
    annualRatePct: 1.826,
    expectedExDivPoints: 250,
    marketSpread: -240,
    foreignNetShort: 22000,
    bidAskGap: 2,
    evalDatetime: "2026-07-09T10:00",
  });
  assert.equal(r.signalShort, "可以分批進場");
  assert.equal(r.calendar.phaseLabel, "黃金卡位期");
  assert.equal(r.checks.length, 5);
  assert.ok(r.checks.every((c) => c.status === "pass"));
  assert.ok(r.valuation.plainSummary.includes("便宜"));
});

test("結構化體檢輸出：高估與高空單紅燈情境精確標記 block", () => {
  const r = evaluateEntry({
    indexLevel: 35800,
    annualRatePct: 1.75,
    expectedExDivPoints: 0,
    marketSpread: 133,
    foreignNetShort: 97863,
    bidAskGap: 2,
    evalDatetime: "2026-11-21T10:00",
  });
  assert.equal(r.signalShort, "先別進場");
  const byId = Object.fromEntries(r.checks.map((c) => [c.id, c]));
  assert.equal(byId.valuation.status, "block");
  assert.equal(byId.chips.status, "block");
  assert.equal(byId.exdiv.status, "pass");
});

test("依兩次結算日實際間隔天數計算資金成本（28天 vs 35天）", () => {
  const r28 = evaluateEntry({
    indexLevel: 35886,
    annualRatePct: 1.75,
    expectedExDivPoints: 0,
    evalDatetime: "2026-11-12T10:00",
  });
  assert.equal(r28.calendar.nearSettlement, "2026-11-18");
  assert.equal(r28.calendar.farSettlement, "2026-12-16");
  assert.equal(r28.calendar.settlementGapDays, 28);
  assert.equal(r28.valuation.fundingCost, 48.18);

  const r35 = evaluateEntry({
    indexLevel: 35886,
    annualRatePct: 1.75,
    expectedExDivPoints: 0,
    evalDatetime: "2026-11-21T10:00",
  });
  assert.equal(r35.calendar.nearSettlement, "2026-12-16");
  assert.equal(r35.calendar.farSettlement, "2027-01-20");
  assert.equal(r35.calendar.settlementGapDays, 35);
  assert.equal(r35.valuation.fundingCost, 60.22);
});

test("雙軌價位：2026 回檔卡位（高於理論但低於 MA10 且籌碼比達標）→ 綠燈", () => {
  const r = evaluateEntry({
    indexLevel: 34000,
    annualRatePct: 1.75,
    expectedExDivPoints: 18,
    marketSpread: 97,
    ma10Spread: 100.1,
    trustNetLong: 36571,
    foreignNetShort: 40958,
    bidAskGap: 2,
    evalDatetime: "2026-03-11T10:00",
  });
  const byId = Object.fromEntries(r.checks.map((c) => [c.id, c]));
  assert.equal(r.signal, "GREEN");
  assert.equal(byId.valuation.badge, "回檔買點");
  assert.equal(byId.chips.status, "pass");
  assert.equal(r.valuation.entryType, "pullback");
});

test("雙軌價位：2026 過熱追高（超漲 MA10 超過過熱上限）→ 紅燈", () => {
  const r = evaluateEntry({
    indexLevel: 44600,
    annualRatePct: 1.75,
    expectedExDivPoints: 85,
    marketSpread: 157,
    ma10Spread: 130.6,
    trustNetLong: 82383,
    foreignNetShort: 86633,
    bidAskGap: 2,
    evalDatetime: "2026-08-12T10:00",
  });
  const byId = Object.fromEntries(r.checks.map((c) => [c.id, c]));
  assert.equal(r.signal, "RED");
  assert.equal(byId.valuation.status, "block");
  assert.equal(byId.valuation.badge, "過熱追高");
  assert.equal(r.valuation.overheatCap, 18);
});

test("籌碼拔河：2026/11 雙十萬口對決（投信 10.19萬 vs 外資 10.43萬，比值 0.98）→ 綠燈", () => {
  const r = evaluateEntry({
    indexLevel: 44136,
    annualRatePct: 1.75,
    expectedExDivPoints: 0,
    marketSpread: 14,
    ma10Spread: 90.1,
    trustNetLong: 101870,
    foreignNetShort: 104271,
    bidAskGap: 2,
    evalDatetime: "2026-11-11T10:00",
  });
  const byId = Object.fromEntries(r.checks.map((c) => [c.id, c]));
  assert.equal(r.signal, "GREEN");
  assert.equal(byId.chips.status, "pass");
  assert.equal(r.chips.chipRatio, 0.98);
});

test("籌碼拔河：外資大幅壓制（投信 2萬 vs 外資 5萬，無折價保護）→ 紅燈", () => {
  const r = evaluateEntry({
    indexLevel: 35000,
    annualRatePct: 1.75,
    expectedExDivPoints: 0,
    marketSpread: 55,
    ma10Spread: 60,
    trustNetLong: 20000,
    foreignNetShort: 50000,
    bidAskGap: 2,
    evalDatetime: "2026-11-12T10:00",
  });
  const byId = Object.fromEntries(r.checks.map((c) => [c.id, c]));
  assert.equal(r.signal, "RED");
  assert.equal(byId.chips.status, "block");
  assert.equal(byId.chips.badge, "外資壓制");
});
