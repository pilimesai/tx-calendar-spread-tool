"""
台指期跨月價差（吃正二轉倉豆腐）進場決策引擎
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import date, datetime, time, timedelta
from typing import Literal


ContractType = Literal["TX", "MTX", "TMF"]

CONTRACT_SPECS: dict[ContractType, dict[str, int | str]] = {
    "TX": {"name": "大台指 (TX)", "point_value": 200},
    "MTX": {"name": "小台指 (MTX)", "point_value": 50},
    "TMF": {"name": "微台指 (TMF)", "point_value": 10},
}


def third_wednesday(year: int, month: int) -> date:
    """計算指定年月的第三個星期三（台指期預設結算日）。"""
    first_day = date(year, month, 1)
    # weekday(): Monday=0, Tuesday=1, Wednesday=2
    days_until_wed = (2 - first_day.weekday()) % 7
    first_wed = first_day + timedelta(days=days_until_wed)
    return first_wed + timedelta(days=14)


def next_month_ym(year: int, month: int) -> tuple[int, int]:
    """回傳下一個月的 (year, month)。"""
    if month == 12:
        return year + 1, 1
    return year, month + 1


def count_weekdays(start_date: date, end_date: date) -> int:
    """計算 start_date (不含) 到 end_date (含) 之間的工作日數量（週一至週五）。"""
    if end_date <= start_date:
        return 0
    days = 0
    cur = start_date + timedelta(days=1)
    while cur <= end_date:
        if cur.weekday() < 5:
            days += 1
        cur += timedelta(days=1)
    return days


@dataclass
class EvaluationInput:
    # 市場與理論價差參數
    index_level: float = 23000.0            # 加權指數 / 台指期點位
    annual_rate_pct: float = 1.75           # 無風險年利率 (%)
    expected_ex_div_points: float = 0.0     # 近月結算隔天～遠月結算日 預計除息蒸發點數 (正數代表蒸發點數)
    market_spread: float = 0.0              # 市場實際跨月價差報價 (遠月 - 近月)

    # 籌碼與流動性參數
    foreign_net_short: int = 30000          # 外資台指期未平倉淨空單口數 (正數代表淨空單)
    bid_ask_gap: float = 2.0                # 價差單五檔委賣與委買價差 (點)
    ex_div_dates_confirmed: bool = True     # 除權息季主要權值股除息日是否已正式公告

    # 時間與結算日參數
    eval_datetime: str = ""                 # ISO 格式時間字串，留空則使用目前時間
    near_settlement_override: str = ""      # 手動指定近月結算日 (YYYY-MM-DD)，用於國定假日順延
    trading_days_override: int | None = None  # 手動覆寫距離結算交易日數

    # 部位與損益試算參數
    contract_type: ContractType = "MTX"     # TX / MTX / TMF
    contracts: int = 1                      # 口數（組數）
    target_exit_spread: float | None = None # 預期平倉價差（若未填則自動以理論值+轉倉溢價估算）


def evaluate_entry(inp: EvaluationInput) -> dict:
    """執行跨月價差進場評估，回傳完整分析與決策結果。"""
    now = (
        datetime.fromisoformat(inp.eval_datetime)
        if inp.eval_datetime
        else datetime.now()
    )
    today = now.date()
    cur_time = now.time()

    # 1. 決定近月與遠月結算日
    if inp.near_settlement_override:
        near_settlement = date.fromisoformat(inp.near_settlement_override)
    else:
        near_settlement = third_wednesday(today.year, today.month)
        if today > near_settlement:
            ny, nm = next_month_ym(today.year, today.month)
            near_settlement = third_wednesday(ny, nm)

    fy, fm = next_month_ym(near_settlement.year, near_settlement.month)
    far_settlement = third_wednesday(fy, fm)

    if inp.trading_days_override is not None:
        trading_days_left = max(0, inp.trading_days_override)
    else:
        trading_days_left = count_weekdays(today, near_settlement)

    is_settlement_day = (today == near_settlement)

    # 2. 理論跨月價差計算
    funding_cost = round(inp.index_level * (inp.annual_rate_pct / 100.0) / 12.0, 2)
    theoretical_spread = round(funding_cost - inp.expected_ex_div_points, 2)
    mispricing = round(inp.market_spread - theoretical_spread, 2)
    # 折價為負值（便宜），溢價為正值（昂貴）
    discount_points = round(-mispricing, 2)

    if mispricing <= -15:
        valuation_label = "深度折價（便宜，具安全邊際）"
    elif mispricing < -3:
        valuation_label = "微幅折價（偏便宜）"
    elif mispricing <= 10:
        valuation_label = "合理價附近"
    else:
        valuation_label = "溢價（昂貴，買盤已反映）"

    # 3. 季節判斷（6~9 月為除權息旺季）
    is_ex_div_season = near_settlement.month in (6, 7, 8, 9) or inp.expected_ex_div_points > 0

    # 4. 檢核規則（紅線阻斷 / 黃燈警示 / 綠燈加分）
    blockers: list[str] = []
    warnings: list[str] = []
    positives: list[str] = []

    # --- 流動性與結算日尾盤風險 ---
    if is_settlement_day and cur_time >= time(13, 15):
        blockers.append(
            "已進入結算日 13:15 後流動性黑洞，五檔掛單稀疏且 13:30 未平倉將強制結算近月留下純遠月多單裸露風險，嚴禁新進場！"
        )
    elif is_settlement_day:
        warnings.append(
            "今日為結算日，正二轉倉已近尾聲，新進場空間有限，且務必於 13:00～13:15 前平倉完畢。"
        )
    elif trading_days_left == 1:
        warnings.append(
            "距離結算僅剩 1 個交易日，正二轉倉買盤可能已大量進場，需確認目前價差尚未溢價。"
        )
    elif 2 <= trading_days_left <= 5:
        positives.append(
            f"距離結算尚餘 {trading_days_left} 個交易日，正處於「結算前 2～5 天」黃金卡位佈局期。"
        )
    else:
        warnings.append(
            f"距離結算還有 {trading_days_left} 個交易日，過早進場資金效率較低，且除權息或籌碼變數較大。"
        )

    # --- 五檔價差（滑價風險） ---
    if inp.bid_ask_gap >= 15:
        blockers.append(
            f"委賣與委買價差達 {inp.bid_ask_gap:g} 點，流動性極差、滑價風險過高，不建議此時掛單進場。"
        )
    elif inp.bid_ask_gap > 5:
        warnings.append(
            f"委賣與委買價差偏寬（{inp.bid_ask_gap:g} 點），切勿追價，務必使用 ROD 限價複式單耐心掛單。"
        )
    else:
        positives.append(f"五檔買賣價差緊密（{inp.bid_ask_gap:g} 點），流動性良好。")

    # --- 理論價差與折溢價評估 ---
    if mispricing > 15:
        blockers.append(
            f"市場報價（{inp.market_spread:g}）已高於理論價差（{theoretical_spread:g}）達 {mispricing:g} 點，轉倉買盤已充分反映，此時追多安全邊際不足。"
        )
    elif mispricing > 0:
        warnings.append(
            f"市場報價微幅溢價 {mispricing:g} 點，目前進場屬於純賭「正二轉倉力道大於外資空單轉倉」，缺乏價值回歸保護。"
        )
    elif mispricing <= -15:
        positives.append(
            f"市場報價低於理論值 {discount_points:g} 點，具備充足安全邊際，適合分批買進價差單。"
        )
    else:
        positives.append(
            f"市場報價貼近或微幅折價於理論值（折價 {discount_points:g} 點），價位尚屬合理。"
        )

    # --- 外資未平倉淨空單 ---
    if inp.foreign_net_short >= 45000 and mispricing >= -10:
        blockers.append(
            f"外資未平倉淨空單高達 {inp.foreign_net_short:,} 口（遠超 4 萬口警戒線），且價差折價不足（僅 {discount_points:g} 點），外資反向轉倉（買近賣遠）可能壓垮價差。"
        )
    elif inp.foreign_net_short >= 40000:
        warnings.append(
            f"外資未平倉淨空單達 {inp.foreign_net_short:,} 口（已達 4 萬口警戒線），結算前外資反向轉倉賣壓可能壓抑價差漲幅，建議縮小部位或嚴設目標。"
        )
    elif inp.foreign_net_short >= 25000:
        warnings.append(
            f"外資淨空單為 {inp.foreign_net_short:,} 口，屬於中等水位，須持續追蹤結算前外資轉倉動向。"
        )
    else:
        positives.append(
            f"外資淨空單水位偏低（{inp.foreign_net_short:,} 口），反向轉倉賣壓相對可控。"
        )

    # --- 除權息季風險 ---
    if is_ex_div_season and not inp.ex_div_dates_confirmed:
        warnings.append(
            "目前處於除權息影響區間，但主要權值股除息日尚未完全公告，存在「除息日跨月跳動」或「股利不如預期」的劇烈跳空風險，建議等主要權值股除息日確定後再進場。"
        )
    elif is_ex_div_season and inp.ex_div_dates_confirmed:
        positives.append("區間主要大型權值股除息日已正式公告，理論價差估算準確度較高。")

    # 5. 最終決策燈號
    if blockers:
        signal = "RED"
        signal_label = "🔴 不建議進場（觸發風控紅線）"
        action_summary = "目前存在明確紅線風險，建議觀望或等待條件改善後再評估。"
    elif len(warnings) >= 2 or (mispricing > 0 and len(warnings) >= 1):
        signal = "YELLOW"
        signal_label = "🟡 謹慎評估／小額試單"
        action_summary = "部分條件未達理想或存在潛在變數，若欲參與建議以小台（MTX）或微台（TMF）輕倉分批試單，並嚴控出場時機。"
    else:
        signal = "GREEN"
        signal_label = "🟢 建議分批進場（具策略優勢）"
        action_summary = "時間點、折溢價安全邊際與籌碼條件皆符合策略要求，可分批掛 ROD 限價「買進」跨月價差複式單。"

    # 6. 損益與目標價試算
    spec = CONTRACT_SPECS[inp.contract_type]
    point_value = int(spec["point_value"])
    suggested_exit = (
        inp.target_exit_spread
        if inp.target_exit_spread is not None
        else round(theoretical_spread + 25.0, 1)
    )
    expected_gain_points = round(suggested_exit - inp.market_spread, 2)
    expected_profit_twd = round(expected_gain_points * point_value * inp.contracts)
    stress_loss_30_twd = round(30 * point_value * inp.contracts)
    stress_loss_50_twd = round(50 * point_value * inp.contracts)

    # 7. 實戰下單檢核清單
    checklist = [
        f"使用券商軟體「台指期價差（複式單）」介面，選擇 {inp.contract_type} 近月／遠月組合，切勿分開單邊下單。",
        "建倉方向選擇「買進」價差單（系統同步成交：賣出近月 ＋ 買進遠月），委託條件限用「ROD 限價單」。",
        f"帳上除價差減收保證金外，至少多預留 1～2 倍緩衝資金（預估盤中 30～50 點反向洗盤波動約 NT$ {stress_loss_30_twd:,} ～ NT$ {stress_loss_50_twd:,}）。",
        "結算前一天至結算日早盤正二轉倉推升時，分批掛「賣出」價差限價單停利。",
        f"務必於結算日（{near_settlement.isoformat()}）13:00～13:15 前全數平倉，避開 13:15 後流動性黑洞與 13:30 強制現金結算風險。",
    ]

    return {
        "signal": signal,
        "signal_label": signal_label,
        "action_summary": action_summary,
        "calendar": {
            "eval_date": today.isoformat(),
            "near_settlement": near_settlement.isoformat(),
            "far_settlement": far_settlement.isoformat(),
            "trading_days_left": trading_days_left,
            "is_settlement_day": is_settlement_day,
            "is_ex_div_season": is_ex_div_season,
        },
        "valuation": {
            "funding_cost": funding_cost,
            "expected_ex_div_points": inp.expected_ex_div_points,
            "theoretical_spread": theoretical_spread,
            "market_spread": inp.market_spread,
            "mispricing": mispricing,
            "discount_points": discount_points,
            "valuation_label": valuation_label,
        },
        "risk_factors": {
            "blockers": blockers,
            "warnings": warnings,
            "positives": positives,
        },
        "sizing": {
            "contract_name": spec["name"],
            "point_value": point_value,
            "contracts": inp.contracts,
            "suggested_exit_spread": suggested_exit,
            "expected_gain_points": expected_gain_points,
            "expected_profit_twd": expected_profit_twd,
            "stress_loss_30_twd": stress_loss_30_twd,
            "stress_loss_50_twd": stress_loss_50_twd,
        },
        "checklist": checklist,
    }
