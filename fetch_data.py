"""
抓取盤後公開資料，產生 data/market.json 供網頁（GitHub Pages）讀取。
由 GitHub Actions 每個交易日盤後自動執行，也可在本機手動執行：python fetch_data.py

資料來源：
- 期交所 OpenAPI：台指期（TX）各月份結算價 → 近／遠月價差
- 期交所 OpenAPI：三大法人台指期未平倉 → 外資淨空單
- 證交所：除權除息預告表（TWT48U）
"""

from __future__ import annotations

import json
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

TPE = timezone(timedelta(hours=8))
OUT = Path(__file__).resolve().parent / "data" / "market.json"
UA = {"User-Agent": "Mozilla/5.0 (tx-calendar-spread-tool)", "Accept": "application/json"}

TAIFEX_FUT = "https://openapi.taifex.com.tw/v1/DailyMarketReportFut"
TAIFEX_INST = "https://openapi.taifex.com.tw/v1/MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate"
TWSE_EXDIV = "https://www.twse.com.tw/rwd/zh/exRight/TWT48U?response=json"


def get_json(url: str):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8-sig"))


def to_num(s):
    try:
        return float(str(s).replace(",", ""))
    except (TypeError, ValueError):
        return None


def fetch_tx() -> dict:
    rows = get_json(TAIFEX_FUT)
    tx = [
        r for r in rows
        if r.get("Contract") == "TX"
        and r.get("TradingSession") == "一般"
        and re.fullmatch(r"\d{6}", str(r.get("ContractMonth(Week)", "")))
    ]
    tx.sort(key=lambda r: r["ContractMonth(Week)"])
    if len(tx) < 2:
        raise RuntimeError("期交所資料中找不到兩個以上的台指期月份合約")

    def price(r):
        return to_num(r.get("SettlementPrice")) or to_num(r.get("Last"))

    near, far = tx[0], tx[1]
    near_p, far_p = price(near), price(far)
    return {
        "date": near.get("Date"),
        "near_month": near["ContractMonth(Week)"],
        "far_month": far["ContractMonth(Week)"],
        "near_price": near_p,
        "far_price": far_p,
        "spread": round(far_p - near_p, 2) if near_p and far_p else None,
    }


def fetch_foreign() -> dict:
    rows = get_json(TAIFEX_INST)
    for r in rows:
        if r.get("ContractCode") == "臺股期貨" and r.get("Item") == "外資及陸資":
            net = int(to_num(r.get("OpenInterest(Net)")) or 0)
            return {"date": r.get("Date"), "oi_net": net, "net_short": max(0, -net)}
    raise RuntimeError("期交所資料中找不到外資台指期未平倉")


def roc_to_iso(s: str) -> str | None:
    m = re.match(r"(\d+)年(\d+)月(\d+)日", s or "")
    if not m:
        return None
    y, mo, d = (int(x) for x in m.groups())
    return f"{y + 1911:04d}-{mo:02d}-{d:02d}"


def fetch_exdiv() -> list[dict]:
    payload = get_json(TWSE_EXDIV)
    out = []
    for row in payload.get("data", []) or []:
        date_iso = roc_to_iso(row[0])
        if not date_iso:
            continue
        cash = to_num(row[7])
        out.append({
            "date": date_iso,
            "code": row[1],
            "name": row[2],
            "type": row[3],
            "cash_dividend": cash,  # None 代表「待公告」
        })
    out.sort(key=lambda r: (r["date"], r["code"]))
    return out


def main() -> int:
    old = {}
    if OUT.exists():
        try:
            old = json.loads(OUT.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            old = {}

    result = {"generated_at": datetime.now(TPE).isoformat(timespec="seconds"), "errors": []}
    for key, fn in (("tx", fetch_tx), ("foreign", fetch_foreign), ("exdiv", fetch_exdiv)):
        try:
            result[key] = fn()
        except Exception as exc:  # 單一來源失敗時保留舊資料
            result["errors"].append(f"{key}: {exc}")
            if key in old:
                result[key] = old[key]

    if (
        OUT.exists()
        and len(result["errors"]) < 3
        and all(result.get(k) == old.get(k) for k in ("tx", "foreign", "exdiv"))
    ):
        print("Data unchanged, skipping write")
        return 0

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k != "exdiv"}, ensure_ascii=False, indent=1))
    print(f"exdiv rows: {len(result.get('exdiv', []))}")
    return 0 if len(result["errors"]) < 3 else 1


if __name__ == "__main__":
    sys.exit(main())
