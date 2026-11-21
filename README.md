# 台指期跨月價差進場決策工具（吃正二轉倉豆腐）

純前端靜態網頁＋PWA 決策輔助工具，幫你判斷現在適不適合進場做台指期跨月價差（買進價差單：賣近月＋買遠月）。開啟即可計算理論價差、安全邊際與結算／籌碼風險，給出 🟢／🟡／🔴 燈號，手機與電腦皆可使用。

## 線上使用（GitHub Pages）

- 線上網址（需先於 Repo Settings → Pages 啟用 `main` 分支 `/ (root)`）：  
  `https://pilimesai.github.io/tx-calendar-spread-tool/`
- 支援手機響應式版面與 PWA（iOS Safari「分享 → 加入主畫面」或 Android Chrome「加到主畫面」可當作 App 使用）。

## 功能
- **理論跨月價差**：`資金成本（指數 × 年利率 / 12）− 區間預計除息點數`，並和市場報價比較，算出低估或高估多少點
- **視覺化價差溫度計與五大風控體檢**：將價位安全邊際、結算時機（含 13:15 尾盤黑洞）、外資籌碼壓力、五檔流動性與除權息變數排序呈現
- **損益試算**：支援 TX（200 元/點）、MTX（50 元/點）、TMF（10 元/點），算出目標損益和洗盤緩衝資金
- **盤後資料自動更新**：由 GitHub Actions（`.github/workflows/update_data.yml`）於每個交易日台灣時間 15:35、17:35、19:35 執行 `fetch_data.py` 更新 `data/market.json`，自動抓取期交所台指期近遠月結算價、外資未平倉淨空單，以及證交所除權息預告表（TWT48U）
- **⚡ 盤中即時報價（Cloudflare Worker）**：可搭配 `worker/taifex-proxy.js` 轉發期交所 `mis.taifex.com.tw` 即時複式單報價，在手機上每 15 秒自動同步跨月價差、近月點位與五檔買賣價差

## ⚡ 盤中即時報價設定（Cloudflare Worker）

1. 依 [worker/README.md](worker/README.md) 將 [worker/taifex-proxy.js](worker/taifex-proxy.js) 部署到免費 Cloudflare Worker（可網頁貼上或執行 `npx wrangler deploy`）。
2. 在決策網頁的「⚡ 盤中即時報價」點 **⚙️ 設定 API**，貼入你的 `https://tx-spread-live-proxy.<你的帳號>.workers.dev` 網址後按 **儲存並抓取**。
3. 小技巧：也可以直接把 `?api=https://你的worker網址` 加在網頁網址後面存成手機書籤，打開即自動記憶並同步。

## 本機預覽與手動更新資料

不需安裝額外套件，直接使用 Python 內建伺服器即可預覽（請勿直接用 `file://` 開啟，否則無法讀取 `data/market.json`）：

```bash
python -m http.server 8765
```

開啟 `http://127.0.0.1:8765`。

若需手動更新最新盤後資料：

```bash
python fetch_data.py
```

## 測試
```bash
node --test tests/engine.test.cjs tests/worker.test.mjs
```

## 注意事項
- 結算日預設以「每月第三個週三」推算，遇到國定假日順延請在介面上手動覆寫結算日
- 外資未平倉淨空單僅有盤後資料，盤中即時模式會自動沿用最新盤後的外資淨空單水位
- 預計除息點數請參考期貨商晨報或 XQ 的「各月份預估除息點數表」
- 這個工具只是輔助判斷，不構成投資建議
