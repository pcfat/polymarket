# 🤖 Polymarket 15分鐘加密貨幣自動交易系統

一套完整的 Polymarket 15 分鐘加密貨幣智能自動交易系統，包含後端交易引擎和前端監控面板。

## 🌟 功能特性

### 核心功能
- ⚡ **24 小時自動監控與執行** - 每 30 秒掃描 Polymarket 上的 15 分鐘加密貨幣預測市場，每 10 秒檢查交易機會
- 🔄 **模擬盤/實盤切換** - 前端可自由一鍵切換模擬盤（paper）與實盤（live）模式
- 📊 **實時和歷史紀錄** - 透過 WebSocket (Socket.IO) 即時推送新交易到前端
- 🗑️ **清除紀錄功能** - 可刪除所有交易紀錄和市場快照，重新開始記錄

### 前端面板功能
- 🎮 引擎啟動/停止控制
- 🔀 模擬盤/實盤模式切換（附確認對話框）
- 📈 統計卡片：總交易次數、勝率、總盈虧、平均盈虧
- 🏪 即時市場監控網格
- 📋 交易紀錄表格（支援按模式篩選）
- ⚙️ 策略設定面板
- 📝 即時日誌面板
- 🔴 連接狀態指示燈
- 📱 響應式設計（桌面/手機）

### 後端功能
- Express.js API 伺服器
- Socket.IO 即時通訊
- SQLite 資料庫（better-sqlite3）
- Polymarket Gamma API 整合
- Polymarket CLOB API 整合
- 模擬下單功能
- 交易策略引擎

## 🚀 快速開始

### 系統要求
- Node.js 16+ 
- npm 或 yarn

### 安裝步驟

1. **克隆專案**
```bash
git clone <repository-url>
cd polymarket
```

2. **安裝後端依賴**
```bash
cd backend
npm install
```

3. **配置環境變數**
```bash
cp .env.example .env
# 編輯 .env 文件，根據需要調整配置
```

4. **啟動系統**
```bash
npm start
```

5. **訪問前端**
打開瀏覽器訪問: `http://localhost:3001`

## ⚙️ 配置說明

### 環境變數 (.env)

```bash
# 伺服器配置
PORT=3001                          # API 伺服器端口
NODE_ENV=development               # 環境模式

# Polymarket API
GAMMA_API_URL=https://gamma-api.polymarket.com
CLOB_API_URL=https://clob.polymarket.com

# 交易策略配置
TRADE_AMOUNT=10                    # 每筆交易金額 (USDC)
TRADE_WINDOW_SECONDS=120           # 交易窗口（市場到期前 N 秒）

# 掃描間隔
MARKET_SCAN_INTERVAL=30            # 市場掃描間隔（秒）
TRADE_CHECK_INTERVAL=10            # 交易檢查間隔（秒）

# 資料庫
DB_PATH=./polymarket.db            # SQLite 資料庫路徑

# 實盤交易（可選）
# WALLET_PRIVATE_KEY=your_private_key_here
# CHAIN_ID=137
# RPC_URL=https://polygon-rpc.com
```

## 📡 API 端點

### REST API

| 方法 | 端點 | 描述 |
|------|------|------|
| GET | `/api/status` | 取得引擎狀態 |
| POST | `/api/start` | 啟動引擎 |
| POST | `/api/stop` | 停止引擎 |
| POST | `/api/mode` | 切換模式 (paper/live) |
| GET | `/api/trades` | 取得交易紀錄 |
| GET | `/api/snapshots` | 取得市場快照 |
| GET | `/api/stats` | 取得統計資料 |
| DELETE | `/api/records` | 清除所有紀錄 |
| PUT | `/api/config` | 更新策略配置 |
| GET | `/api/markets` | 取得活躍市場 |

### Socket.IO 事件

- `status` - 引擎狀態更新
- `modeChanged` - 模式切換通知
- `newTrade` - 新交易通知
- `stats` - 統計更新
- `markets` - 市場資料更新
- `recentTrades` - 最近交易列表
- `recordsCleared` - 紀錄已清除通知
- `error` - 錯誤通知

## 🎯 交易策略

系統使用複合策略進行交易決策，結合技術分析、新聞情緒和訂單流分析：

1. **時間窗口**: 只在市場到期前 N 秒（默認 120 秒）內交易
2. **複合分數**: 綜合評估技術面、新聞面和訂單流權重計算交易信號
3. **信心度評估**: 基於各項指標的一致性判斷交易信心度
4. **動態交易決策**: 根據複合分數和信心度決定是否交易及交易方向
5. **交易金額**: 每筆固定金額（默認 10 USDC）

可在前端策略設定面板中調整交易金額、交易窗口和策略權重等參數。

## 💾 資料庫結構

### trades 表
存儲所有交易紀錄，包含：
- 交易時間、模式（paper/live）
- 市場信息、操作方向
- 價格、金額、股數
- 狀態、訂單 ID、盈虧

### market_snapshots 表
存儲市場快照，包含：
- 時間戳、市場 ID
- YES/NO 價格
- 成交量、流動性

### bot_status 表
存儲引擎狀態，包含：
- 運行狀態、交易模式
- 最後心跳時間
- 總交易次數、總盈虧

## 🔧 實盤交易設定

⚠️ **警告**: 實盤交易涉及真實資金，請謹慎使用！

要啟用實盤交易，需要：

1. 在 `.env` 文件中配置錢包私鑰
2. 集成 `@polymarket/clob-client` SDK
3. 在 `tradingEngine.js` 中實現實盤下單邏輯

當前版本預留了實盤交易架構，但實際下單功能需要進一步開發。

## 🎨 前端設計

- **深色主題**: GitHub 風格配色 (#0d1117 背景)
- **響應式布局**: 支援桌面、平板、手機
- **即時更新**: Socket.IO 實時數據推送
- **確認對話框**: 關鍵操作（清除紀錄、切換實盤）需確認
- **狀態指示**: 連接狀態脈衝動畫

## 📁 專案結構

```
polymarket/
├── backend/
│   ├── server.js              # Express + Socket.IO 伺服器
│   ├── tradingEngine.js       # 交易引擎
│   ├── polymarketClient.js    # Polymarket API 客戶端
│   ├── database.js            # SQLite 資料庫管理
│   ├── package.json           # 依賴配置
│   └── .env.example           # 環境變數範本
├── frontend/
│   ├── index.html             # 主頁面
│   ├── app.js                 # 前端邏輯
│   └── style.css              # 樣式表
└── README.md                  # 說明文件
```

## 🛠️ 開發與調試

### 查看日誌
系統日誌會在終端和前端日誌面板中顯示。

### 測試 API
使用 curl 或 Postman 測試 REST API：
```bash
# 查看狀態
curl http://localhost:3001/api/status

# 啟動引擎
curl -X POST http://localhost:3001/api/start

# 切換模式
curl -X POST http://localhost:3001/api/mode \
  -H "Content-Type: application/json" \
  -d '{"mode":"paper"}'
```

## ⚠️ 風險警告

1. **資金風險**: 實盤交易涉及真實資金，可能造成損失
2. **API 限制**: Polymarket API 可能有速率限制
3. **市場風險**: 加密貨幣市場波動劇烈
4. **技術風險**: 軟體可能存在 bug 或故障
5. **網絡風險**: 網絡中斷可能導致交易失敗

## 📝 授權

MIT License

## 🤝 貢獻

歡迎提交 Issue 和 Pull Request！

## 📧 聯繫

如有問題或建議，請開啟 Issue。