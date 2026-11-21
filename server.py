"""
台指期跨月價差進場決策工具 - 本地 Web 伺服器（零第三方套件依賴）
啟動方式：python server.py
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from decision_engine import EvaluationInput, evaluate_entry


ROOT_DIR = Path(__file__).resolve().parent
STATIC_DIR = ROOT_DIR / "static"


class SpreadToolHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def log_message(self, format: str, *args: Any) -> None:
        # 簡潔輸出請求紀錄
        print(f"[HTTP] {self.address_string()} - {format % args}")

    def _send_json(self, payload: dict[str, Any], status: int = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        if self.path != "/api/evaluate":
            self._send_json({"error": "Not found"}, status=HTTPStatus.NOT_FOUND)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length)
            data = json.loads(raw.decode("utf-8")) if raw else {}

            inp = EvaluationInput(
                index_level=float(data.get("index_level", 23000)),
                annual_rate_pct=float(data.get("annual_rate_pct", 1.75)),
                expected_ex_div_points=float(data.get("expected_ex_div_points", 0)),
                market_spread=float(data.get("market_spread", 0)),
                foreign_net_short=int(data.get("foreign_net_short", 30000)),
                bid_ask_gap=float(data.get("bid_ask_gap", 2)),
                ex_div_dates_confirmed=bool(data.get("ex_div_dates_confirmed", True)),
                eval_datetime=str(data.get("eval_datetime", "")),
                near_settlement_override=str(data.get("near_settlement_override", "")),
                trading_days_override=(
                    int(data["trading_days_override"])
                    if data.get("trading_days_override") not in (None, "")
                    else None
                ),
                contract_type=data.get("contract_type", "MTX"),
                contracts=max(1, int(data.get("contracts", 1))),
                target_exit_spread=(
                    float(data["target_exit_spread"])
                    if data.get("target_exit_spread") not in (None, "")
                    else None
                ),
            )
            result = evaluate_entry(inp)
            self._send_json(result)
        except (ValueError, TypeError, KeyError) as exc:
            self._send_json(
                {"error": f"參數格式錯誤: {exc}"}, status=HTTPStatus.BAD_REQUEST
            )

    def do_GET(self) -> None:
        if self.path.startswith("/api/twse-exdiv"):
            self._handle_twse_exdiv()
            return
        if self.path == "/":
            self.path = "/index.html"
        super().do_GET()

    def _handle_twse_exdiv(self) -> None:
        """嘗試抓取證交所除權除息預告表 (TWT48U) 供使用者參考。"""
        url = "https://www.twse.com.tw/rwd/zh/exRight/TWT48U?response=json"
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0",
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=8) as resp:
                raw = resp.read().decode("utf-8")
            payload = json.loads(raw)
            rows = payload.get("data", []) or []
            fields = payload.get("fields", []) or []
            self._send_json(
                {
                    "ok": True,
                    "stat": payload.get("stat", ""),
                    "count": len(rows),
                    "fields": fields,
                    "rows": rows[:30],
                }
            )
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            self._send_json(
                {
                    "ok": False,
                    "error": f"無法連線證交所 API（可改為手動輸入期貨商晨報/XQ預估除息點數）：{exc}",
                },
                status=HTTPStatus.OK,
            )


def main() -> None:
    port = int(os.environ.get("PORT", "8765"))
    server = ThreadingHTTPServer(("127.0.0.1", port), SpreadToolHandler)
    print(f"台指期跨月價差進場決策工具已啟動：http://127.0.0.1:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n伺服器已停止。")
        server.server_close()


if __name__ == "__main__":
    main()
