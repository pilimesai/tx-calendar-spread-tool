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
