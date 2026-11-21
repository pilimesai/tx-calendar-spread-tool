// 執行：node --test tests/
const test = require("node:test");
const assert = require("node:assert/strict");
const { thirdWednesday, evaluateEntry, iso } = require("../engine.js");

test("每月第三個週三", () => {
  assert.equal(iso(thirdWednesday(2026, 11)), "2026-11-18");
  assert.equal(iso(thirdWednesday(2026, 7)), "2026-07-15");
  assert.equal(iso(thirdWednesday(2027, 1)), "2027-01-20");
});

test("7月除息低估：理論 -215、報價 -240、結算前 4 天 → 綠燈", () => {
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
  assert.ok(Math.abs(r.valuation.theoreticalSpread + 215) < 0.5);
  assert.ok(r.valuation.discountPoints > 24);
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
