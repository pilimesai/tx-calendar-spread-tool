/*
 * 台指期跨月價差（吃正二轉倉豆腐）進場決策引擎 — 純前端版
 * 瀏覽器：window.SpreadEngine；Node：require('./engine.js')
 */
(function (root) {
  "use strict";

  const CONTRACT_SPECS = {
    TX: { name: "大台指 (TX)", pointValue: 200 },
    MTX: { name: "小台指 (MTX)", pointValue: 50 },
    TMF: { name: "微台指 (TMF)", pointValue: 10 },
  };

  // ---- 日期工具（一律以 UTC 計算純日期，避免時區誤差）----
  function ymd(y, m, d) {
    return new Date(Date.UTC(y, m - 1, d));
  }
  function iso(dt) {
    return dt.toISOString().slice(0, 10);
  }
  function parseIsoDate(s) {
    const [y, m, d] = s.split("-").map(Number);
    return ymd(y, m, d);
  }
  function addDays(dt, n) {
    return new Date(dt.getTime() + n * 86400000);
  }

  function thirdWednesday(year, month) {
    const first = ymd(year, month, 1);
    const daysUntilWed = (3 - first.getUTCDay() + 7) % 7; // getUTCDay: Sun=0, Wed=3
    return addDays(first, daysUntilWed + 14);
  }

  function nextMonth(year, month) {
    return month === 12 ? [year + 1, 1] : [year, month + 1];
  }

  /** start（不含）到 end（含）之間的週一～週五天數 */
  function countWeekdays(start, end) {
    let days = 0;
    for (let cur = addDays(start, 1); cur <= end; cur = addDays(cur, 1)) {
      const wd = cur.getUTCDay();
      if (wd !== 0 && wd !== 6) days++;
    }
    return days;
  }

  /** 取得台北時間的 { date: Date(UTC 純日期), hh, mm } */
  function taipeiNow(now) {
    const t = new Date((now || new Date()).getTime() + 8 * 3600000);
    return {
      date: ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()),
      hh: t.getUTCHours(),
      mm: t.getUTCMinutes(),
    };
  }

  /** 解析 "YYYY-MM-DDTHH:MM"（視為台北時間），空字串則用目前台北時間 */
  function parseEvalTime(s) {
    if (!s) return taipeiNow();
    const [dPart, tPart = "00:00"] = s.split("T");
    const [hh, mm] = tPart.split(":").map(Number);
    return { date: parseIsoDate(dPart), hh: hh || 0, mm: mm || 0 };
  }

  const r2 = (x) => Math.round(x * 100) / 100;
  const fmt = (x) => String(r2(x));
  const fmtInt = (x) => Math.round(x).toLocaleString("en-US");

  const DEFAULTS = {
    indexLevel: 23000,
    annualRatePct: 1.75,
    expectedExDivPoints: 0,
    marketSpread: 0,
    foreignNetShort: 30000,
    bidAskGap: 2,
    exDivDatesConfirmed: true,
    evalDatetime: "",
    nearSettlementOverride: "",
    tradingDaysOverride: null,
    contractType: "MTX",
    contracts: 1,
    targetExitSpread: null,
  };

  function evaluateEntry(input) {
    const inp = Object.assign({}, DEFAULTS, input || {});
    const now = parseEvalTime(inp.evalDatetime);
    const today = now.date;
    const minutes = now.hh * 60 + now.mm;

    // 1. 近月 / 遠月結算日
    let nearSettlement;
    if (inp.nearSettlementOverride) {
      nearSettlement = parseIsoDate(inp.nearSettlementOverride);
    } else {
      const y = today.getUTCFullYear();
      const m = today.getUTCMonth() + 1;
      nearSettlement = thirdWednesday(y, m);
      if (today > nearSettlement) {
        const [ny, nm] = nextMonth(y, m);
        nearSettlement = thirdWednesday(ny, nm);
      }
    }
    const [fy, fm] = nextMonth(nearSettlement.getUTCFullYear(), nearSettlement.getUTCMonth() + 1);
    const farSettlement = thirdWednesday(fy, fm);

    const tradingDaysLeft =
      inp.tradingDaysOverride !== null && inp.tradingDaysOverride !== "" && inp.tradingDaysOverride !== undefined
        ? Math.max(0, Number(inp.tradingDaysOverride))
        : countWeekdays(today, nearSettlement);
    const isSettlementDay = iso(today) === iso(nearSettlement);

    // 2. 理論價差
    const fundingCost = r2((inp.indexLevel * (inp.annualRatePct / 100)) / 12);
    const theoreticalSpread = r2(fundingCost - inp.expectedExDivPoints);
    const mispricing = r2(inp.marketSpread - theoreticalSpread);
    const discountPoints = r2(-mispricing);

    let valuationLabel;
    if (mispricing <= -15) valuationLabel = "深度折價（便宜，具安全邊際）";
    else if (mispricing < -3) valuationLabel = "微幅折價（偏便宜）";
    else if (mispricing <= 10) valuationLabel = "合理價附近";
    else valuationLabel = "溢價（昂貴，買盤已反映）";

    const nearMonth = nearSettlement.getUTCMonth() + 1;
    const isExDivSeason = [6, 7, 8, 9].includes(nearMonth) || inp.expectedExDivPoints > 0;

    const blockers = [];
    const warnings = [];
    const positives = [];

    // --- 時間與結算日尾盤 ---
    if (isSettlementDay && minutes >= 13 * 60 + 15) {
      blockers.push(
        "已進入結算日 13:15 後流動性黑洞，五檔掛單稀疏且 13:30 未平倉將強制結算近月、留下純遠月多單裸露風險，嚴禁新進場！"
      );
    } else if (isSettlementDay) {
      warnings.push("今日為結算日，正二轉倉已近尾聲，新進場空間有限，且務必於 13:00～13:15 前平倉完畢。");
    } else if (tradingDaysLeft === 1) {
      warnings.push("距離結算僅剩 1 個交易日，正二轉倉買盤可能已大量進場，需確認目前價差尚未溢價。");
    } else if (tradingDaysLeft >= 2 && tradingDaysLeft <= 5) {
      positives.push(`距離結算尚餘 ${tradingDaysLeft} 個交易日，正處於「結算前 2～5 天」黃金卡位佈局期。`);
    } else {
      warnings.push(`距離結算還有 ${tradingDaysLeft} 個交易日，過早進場資金效率較低，且除權息或籌碼變數較大。`);
    }

    // --- 五檔價差 ---
    if (inp.bidAskGap >= 15) {
      blockers.push(`委賣與委買價差達 ${fmt(inp.bidAskGap)} 點，流動性極差、滑價風險過高，不建議此時掛單進場。`);
    } else if (inp.bidAskGap > 5) {
      warnings.push(`委賣與委買價差偏寬（${fmt(inp.bidAskGap)} 點），切勿追價，務必使用 ROD 限價複式單耐心掛單。`);
    } else {
      positives.push(`五檔買賣價差緊密（${fmt(inp.bidAskGap)} 點），流動性良好。`);
    }

    // --- 折溢價 ---
    if (mispricing > 15) {
      blockers.push(
        `市場報價（${fmt(inp.marketSpread)}）已高於理論價差（${fmt(theoreticalSpread)}）達 ${fmt(mispricing)} 點，轉倉買盤已充分反映，此時追多安全邊際不足。`
      );
    } else if (mispricing > 0) {
      warnings.push(
        `市場報價微幅溢價 ${fmt(mispricing)} 點，目前進場屬於純賭「正二轉倉力道大於外資空單轉倉」，缺乏價值回歸保護。`
      );
    } else if (mispricing <= -15) {
      positives.push(`市場報價低於理論值 ${fmt(discountPoints)} 點，具備充足安全邊際，適合分批買進價差單。`);
    } else {
      positives.push(`市場報價貼近或微幅折價於理論值（折價 ${fmt(discountPoints)} 點），價位尚屬合理。`);
    }

    // --- 外資淨空單 ---
    const fns = inp.foreignNetShort;
    if (fns >= 45000 && mispricing >= -10) {
      blockers.push(
        `外資未平倉淨空單高達 ${fmtInt(fns)} 口（遠超 4 萬口警戒線），且價差折價不足（僅 ${fmt(discountPoints)} 點），外資反向轉倉（買近賣遠）可能壓垮價差。`
      );
    } else if (fns >= 40000) {
      warnings.push(
        `外資未平倉淨空單達 ${fmtInt(fns)} 口（已達 4 萬口警戒線），結算前外資反向轉倉賣壓可能壓抑價差漲幅，建議縮小部位或嚴設目標。`
      );
    } else if (fns >= 25000) {
      warnings.push(`外資淨空單為 ${fmtInt(fns)} 口，屬於中等水位，須持續追蹤結算前外資轉倉動向。`);
    } else {
      positives.push(`外資淨空單水位偏低（${fmtInt(fns)} 口），反向轉倉賣壓相對可控。`);
    }

    // --- 除權息 ---
    if (isExDivSeason && !inp.exDivDatesConfirmed) {
      warnings.push(
        "目前處於除權息影響區間，但主要權值股除息日尚未完全公告，存在「除息日跨月跳動」或「股利不如預期」的劇烈跳空風險，建議等主要權值股除息日確定後再進場。"
      );
    } else if (isExDivSeason) {
      positives.push("區間主要大型權值股除息日已正式公告，理論價差估算準確度較高。");
    }

    // 5. 燈號
    let signal, signalLabel, actionSummary;
    if (blockers.length) {
      signal = "RED";
      signalLabel = "🔴 不建議進場（觸發風控紅線）";
      actionSummary = "目前存在明確紅線風險，建議觀望或等待條件改善後再評估。";
    } else if (warnings.length >= 2 || (mispricing > 0 && warnings.length >= 1)) {
      signal = "YELLOW";
      signalLabel = "🟡 謹慎評估／小額試單";
      actionSummary =
        "部分條件未達理想或存在潛在變數，若欲參與建議以小台（MTX）或微台（TMF）輕倉分批試單，並嚴控出場時機。";
    } else {
      signal = "GREEN";
      signalLabel = "🟢 建議分批進場（具策略優勢）";
      actionSummary = "時間點、折溢價安全邊際與籌碼條件皆符合策略要求，可分批掛 ROD 限價「買進」跨月價差複式單。";
    }

    // 6. 損益
    const spec = CONTRACT_SPECS[inp.contractType] || CONTRACT_SPECS.MTX;
    const pv = spec.pointValue;
    const hasTarget = inp.targetExitSpread !== null && inp.targetExitSpread !== "" && inp.targetExitSpread !== undefined;
    const suggestedExit = hasTarget ? Number(inp.targetExitSpread) : Math.round((theoreticalSpread + 25) * 10) / 10;
    const expectedGainPoints = r2(suggestedExit - inp.marketSpread);
    const expectedProfitTwd = Math.round(expectedGainPoints * pv * inp.contracts);
    const stress30 = Math.round(30 * pv * inp.contracts);
    const stress50 = Math.round(50 * pv * inp.contracts);

    const checklist = [
      `使用券商軟體「台指期價差（複式單）」介面，選擇 ${inp.contractType} 近月／遠月組合，切勿分開單邊下單。`,
      "建倉方向選擇「買進」價差單（系統同步成交：賣出近月 ＋ 買進遠月），委託條件限用「ROD 限價單」。",
      `帳上除價差減收保證金外，至少多預留 1～2 倍緩衝資金（預估盤中 30～50 點反向洗盤波動約 NT$ ${fmtInt(stress30)} ～ NT$ ${fmtInt(stress50)}）。`,
      "結算前一天至結算日早盤正二轉倉推升時，分批掛「賣出」價差限價單停利。",
      `務必於結算日（${iso(nearSettlement)}）13:00～13:15 前全數平倉，避開 13:15 後流動性黑洞與 13:30 強制現金結算風險。`,
    ];

    return {
      signal,
      signalLabel,
      actionSummary,
      calendar: {
        evalDate: iso(today),
        nearSettlement: iso(nearSettlement),
        farSettlement: iso(farSettlement),
        tradingDaysLeft,
        isSettlementDay,
        isExDivSeason,
      },
      valuation: {
        fundingCost,
        expectedExDivPoints: inp.expectedExDivPoints,
        theoreticalSpread,
        marketSpread: inp.marketSpread,
        mispricing,
        discountPoints,
        valuationLabel,
      },
      riskFactors: { blockers, warnings, positives },
      sizing: {
        contractName: spec.name,
        pointValue: pv,
        contracts: inp.contracts,
        suggestedExitSpread: suggestedExit,
        expectedGainPoints,
        expectedProfitTwd,
        stressLoss30Twd: stress30,
        stressLoss50Twd: stress50,
      },
      checklist,
    };
  }

  const api = { CONTRACT_SPECS, thirdWednesday, countWeekdays, taipeiNow, evaluateEntry, iso, parseIsoDate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SpreadEngine = api;
})(typeof self !== "undefined" ? self : this);
