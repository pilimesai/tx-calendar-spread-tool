"""決策引擎單元測試，涵蓋筆記中的各類實戰情境。"""

import unittest

from decision_engine import EvaluationInput, evaluate_entry, third_wednesday


class TestDecisionEngine(unittest.TestCase):
    def test_third_wednesday(self):
        # 2026 年 11 月第三個週三為 2026-11-18（與筆記截圖一致）
        self.assertEqual(third_wednesday(2026, 11).isoformat(), "2026-11-18")
        # 2026 年 7 月第三個週三為 2026-07-15
        self.assertEqual(third_wednesday(2026, 7).isoformat(), "2026-07-15")

    def test_july_ex_div_discount_entry_green(self):
        """筆記範例：7月轉8月，理論價差約 -215，市場報價 -240（低估25點），結算前4天，應為綠燈。"""
        inp = EvaluationInput(
            index_level=23000,
            annual_rate_pct=1.826,  # 23000 * 1.826% / 12 ≈ 35
            expected_ex_div_points=250,
            market_spread=-240,
            foreign_net_short=22000,
            bid_ask_gap=2,
            ex_div_dates_confirmed=True,
            eval_datetime="2026-07-09T10:00:00",  # 2026-07-15 前 4 個交易日
            contract_type="TX",
            contracts=1,
            target_exit_spread=-170,
        )
        res = evaluate_entry(inp)
        self.assertEqual(res["signal"], "GREEN")
        self.assertAlmostEqual(res["valuation"]["theoretical_spread"], -215.0, delta=0.5)
        self.assertGreater(res["valuation"]["discount_points"], 24.0)
        self.assertEqual(res["sizing"]["expected_gain_points"], 70.0)
        self.assertEqual(res["sizing"]["expected_profit_twd"], 14000)

    def test_july_ex_div_premium_red(self):
        """筆記範例：市場報價已拉到 -170（高估45點），不應追多進場。"""
        inp = EvaluationInput(
            index_level=23000,
            annual_rate_pct=1.826,
            expected_ex_div_points=250,
            market_spread=-170,
            foreign_net_short=22000,
            bid_ask_gap=2,
            ex_div_dates_confirmed=True,
            eval_datetime="2026-07-14T10:00:00",
        )
        res = evaluate_entry(inp)
        self.assertEqual(res["signal"], "RED")
        self.assertTrue(any("高於理論價差" in b for b in res["risk_factors"]["blockers"]))

    def test_settlement_day_after_1315_liquidity_blackhole(self):
        """結算日 13:18 尾盤流動性黑洞（跳空40點），必須觸發紅燈阻斷。"""
        inp = EvaluationInput(
            index_level=23000,
            annual_rate_pct=1.75,
            expected_ex_div_points=0,
            market_spread=200,
            foreign_net_short=25000,
            bid_ask_gap=42,
            eval_datetime="2026-11-18T13:18:00",
        )
        res = evaluate_entry(inp)
        self.assertEqual(res["signal"], "RED")
        self.assertGreaterEqual(len(res["risk_factors"]["blockers"]), 2)

    def test_high_foreign_net_short_warning_or_block(self):
        """外資淨空單超過 45,000 口且無足夠折價保護，應觸發紅燈。"""
        inp = EvaluationInput(
            index_level=23000,
            annual_rate_pct=1.75,
            expected_ex_div_points=0,
            market_spread=35,
            foreign_net_short=46000,
            bid_ask_gap=2,
            eval_datetime="2026-11-12T10:00:00",
        )
        res = evaluate_entry(inp)
        self.assertEqual(res["signal"], "RED")
        self.assertTrue(any("外資未平倉淨空單" in b for b in res["risk_factors"]["blockers"]))


if __name__ == "__main__":
    unittest.main()
