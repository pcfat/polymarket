# Polymarket 智能套利交易系統

<div align="center">

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Python](https://img.shields.io/badge/python-3.11+-blue.svg)
![React](https://img.shields.io/badge/react-18-61dafb.svg)

**自動化預測市場套利交易系統，支援 24 小時監控與執行**

[功能特性](#功能特性) • [快速開始](#快速開始) • [配置說明](#配置說明) • [使用指南](#使用指南) • [API 文件](#api-文件)

</div>

---

## 📋 目錄

- [專案介紹](#專案介紹)
- [功能特性](#功能特性)
- [系統架構](#系統架構)
- [技術棧](#技術棧)
- [快速開始](#快速開始)
  - [方式 A: Docker 一鍵啟動](#方式-a-docker-一鍵啟動推薦)
  - [方式 B: 本地開發模式](#方式-b-本地開發模式)
- [Polymarket API 設定](#polymarket-api-設定)
- [配置說明](#配置說明)
- [使用指南](#使用指南)
- [API 文件](#api-文件)
- [常見問題](#常見問題)
- [風險提示](#風險提示)

---

## 專案介紹

Polymarket 智能套利交易系統是一個全自動化的預測市場套利工具，透過 Web Dashboard 提供完整的監控與控制介面。系統支援 24 小時不間斷運行，並提供模擬盤 (Paper Trading) 與實盤 (Live Trading) 雙模式。

### 核心功能

- ✅ **三種套利策略**：同市場套利、多結果套利、跨市場套利
- 📊 **實時監控面板**：完整的數據可視化與交易歷史
- 🛡️ **風險管理系統**：熔斷機制、持倉限制、每日虧損限制
- 🔄 **24/7 自動運行**：背景排程器持續掃描套利機會
- 💡 **雙模式交易**：模擬盤測試策略，實盤真實交易
- 🚀 **WebSocket 即時更新**：毫秒級數據推送
- 🐳 **一鍵部署**：Docker Compose 完整容器化

---

## 功能特性

### 套利策略引擎

#### 1. 同市場套利 (Intra-Market Arbitrage)
- 在同一市場中，當 YES 和 NO 代幣的最佳賣價之和小於 1.00 時
- 同時買入兩個結果，鎖定無風險利潤
- 適用於：二元結果市場

#### 2. 多結果套利 (Multi-Outcome Arbitrage)
- 在多結果市場中，當所有結果的最佳賣價總和小於 1.00 時
- 買入所有可能結果，保證獲利
- 適用於：3個或更多結果的市場

#### 3. 跨市場套利 (Cross-Market Arbitrage)
- 尋找語義相似但定價不一致的關聯市場
- 低買高賣，賺取價差
- 適用於：相關主題的不同市場

### 風險管理

- **熔斷機制**：5次連續虧損自動暫停交易
- **每日虧損限制**：達到設定金額後停止交易
- **持倉上限**：單筆交易與總曝險限制
- **冷卻期**：虧損後強制等待時間
- **訂單數量控制**：防止過度交易

### Web Dashboard

- **統計卡片**：餘額、總盈虧、投資回報率、勝率
- **PnL 圖表**：累計盈虧折線圖，視覺化交易表現
- **套利機會**：即時顯示當前可執行的套利機會
- **交易歷史**：完整的交易記錄與篩選功能
- **風控面板**：實時監控風險指標與系統狀態
- **設定介面**：動態調整參數，無需重啟

---

## 系統架構

```
┌─────────────────────────────────────────────────────────────────┐
│                        Web Dashboard (React)                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │Dashboard │  │ Markets  │  │  Trades  │  │ Settings │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTP/WebSocket
                         ↓
┌─────────────────────────────────────────────────────────────────┐
│                      Nginx Reverse Proxy                         │
│               /api → Backend  |  /ws → WebSocket                 │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ↓
┌─────────────────────────────────────────────────────────────────┐
│                     FastAPI Backend Server                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Background Scheduler (24/7)                              │  │
│  │  ┌───────┐  ┌───────┐  ┌───────┐  ┌───────┐  ┌───────┐ │  │
│  │  │Fetch  │→ │ Scan  │→ │Risk   │→ │Execute│→ │Broadcast│ │
│  │  │Markets│  │Arbit. │  │Check  │  │Trade  │  │WS       │ │
│  │  └───────┘  └───────┘  └───────┘  └───────┘  └───────┘ │  │
│  └──────────────────────────────────────────────────────────┘  │
│  ┌───────────────┐  ┌───────────────┐  ┌──────────────────┐  │
│  │ Arbitrage     │  │ Paper Trading │  │ Risk Manager     │  │
│  │ Engine        │  │ Engine        │  │ (Circuit Breaker)│  │
│  └───────────────┘  └───────────────┘  └──────────────────┘  │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ↓
┌─────────────────────────────────────────────────────────────────┐
│                       External Services                          │
│  ┌──────────────────┐         ┌──────────────────┐             │
│  │  Polymarket      │         │  SQLite          │             │
│  │  CLOB API        │         │  Database        │             │
│  │  (Gamma API)     │         │                  │             │
│  └──────────────────┘         └──────────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

---

## 技術棧

### Backend
- **Python 3.11+** - 主要編程語言
- **FastAPI** - 現代 Web 框架
- **SQLAlchemy** - ORM 資料庫操作
- **SQLite** - 輕量級資料庫
- **WebSocket** - 實時雙向通訊
- **py-clob-client** - Polymarket API 客戶端
- **APScheduler** - 背景任務排程

### Frontend
- **React 18** - UI 框架
- **TypeScript** - 類型安全
- **Tailwind CSS** - 樣式框架
- **Recharts** - 圖表庫
- **Vite** - 建構工具

### 部署
- **Docker** - 容器化
- **Docker Compose** - 多容器編排
- **Nginx** - 反向代理

---

## 快速開始

### 方式 A: Docker 一鍵啟動（推薦）

#### 1. 克隆專案

```bash
git clone https://github.com/pcfat/polymarket.git
cd polymarket
```

#### 2. 配置環境變數

```bash
cp .env.example .env
# 編輯 .env 檔案，填入你的 Polymarket API 憑證（實盤交易需要）
nano .env
```

#### 3. 啟動系統

```bash
# 構建並啟動所有服務
docker-compose up -d

# 查看日誌
docker-compose logs -f backend
```

#### 4. 訪問系統

- **Web Dashboard**: http://localhost
- **Backend API**: http://localhost/api
- **API 文件**: http://localhost:8000/docs

### 方式 B: 本地開發模式

#### Backend

```bash
cd backend

# 創建虛擬環境
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 安裝依賴
pip install -r requirements.txt

# 啟動服務器
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

#### Frontend

```bash
cd frontend

# 安裝依賴
npm install

# 啟動開發服務器
npm run dev
```

訪問: http://localhost:3000

---

## Polymarket API 設定

### 獲取 API 憑證

1. **註冊 Polymarket 帳號**
   - 訪問 [Polymarket.com](https://polymarket.com)
   - 創建帳號並完成 KYC

2. **獲取 Private Key**
   - 使用 MetaMask 或其他以太坊錢包
   - 導出 Polygon 網絡的 Private Key
   - ⚠️ **切勿分享或公開你的 Private Key**

3. **申請 API Key（可選）**
   - 聯繫 Polymarket 支援團隊
   - 獲取 API Key、Secret 和 Passphrase
   - 用於提高速率限制

### 配置憑證

編輯 `.env` 檔案：

```env
# 實盤交易必需
POLYMARKET_PRIVATE_KEY=0x你的私鑰

# 可選（用於提高 API 限制）
POLYMARKET_API_KEY=你的API密鑰
POLYMARKET_API_SECRET=你的API密鑰
POLYMARKET_API_PASSPHRASE=你的密碼短語
```

---

## 配置說明

### 主配置檔案: `backend/config/settings.yaml`

```yaml
system:
  mode: "paper"              # 交易模式: "paper" 或 "live"
  log_level: "INFO"          # 日誌級別

arbitrage:
  strategies:                # 啟用的策略
    - "intra_market"
    - "cross_market"
    - "multi_outcome"
  min_profit_pct: 0.5        # 最小利潤百分比 (%)
  min_profit_usd: 0.50       # 最小利潤金額 ($)
  max_slippage_pct: 0.3      # 最大滑點 (%)
  min_liquidity_usd: 500     # 最小流動性 ($)
  scan_interval_seconds: 5   # 掃描間隔 (秒)

risk:
  max_position_usd: 500      # 單筆交易上限 ($)
  max_total_exposure_usd: 5000  # 總曝險上限 ($)
  max_daily_loss_usd: 200    # 每日虧損限制 ($)
  max_open_orders: 20        # 最大訂單數
  cooldown_after_loss_sec: 300  # 虧損後冷卻時間 (秒)

paper_trading:
  initial_balance: 10000     # 初始餘額 ($)
  simulate_slippage: true    # 模擬滑點
  slippage_bps: 10           # 滑點基點 (10 = 0.1%)
  simulate_latency_ms: 200   # 模擬延遲 (毫秒)
```

### 參數調整建議

#### 保守設定（適合新手）
```yaml
arbitrage:
  min_profit_pct: 1.0        # 更高的利潤要求
  min_profit_usd: 1.00
  scan_interval_seconds: 10  # 較慢的掃描頻率

risk:
  max_position_usd: 100      # 較小的單筆上限
  max_daily_loss_usd: 50     # 更嚴格的虧損限制
```

#### 激進設定（適合經驗豐富者）
```yaml
arbitrage:
  min_profit_pct: 0.3        # 更低的利潤門檻
  min_profit_usd: 0.30
  scan_interval_seconds: 3   # 更快的掃描

risk:
  max_position_usd: 1000     # 更大的倉位
  max_daily_loss_usd: 500    # 較寬鬆的限制
```

---

## 使用指南

### 從模擬盤開始

1. **啟動系統**（預設為 Paper 模式）
   ```bash
   docker-compose up -d
   ```

2. **訪問 Dashboard**
   - 打開 http://localhost
   - 查看右上角模式標籤：🟢 PAPER

3. **觀察系統運行**
   - 監控套利機會的發現
   - 查看模擬交易執行
   - 分析盈虧表現

4. **調整參數**
   - 進入 Settings 頁面
   - 調整套利參數和風控設定
   - 點擊 "Save Settings" 儲存

5. **測試策略**
   - 運行至少 24-48 小時
   - 確保策略穩定盈利
   - Win Rate 建議 > 60%

### 切換到實盤

⚠️ **重要提醒**：實盤交易涉及真實資金，請確保：

- ✅ 已在模擬盤中測試至少 1 週
- ✅ 策略表現穩定且盈利
- ✅ 完全理解風險管理機制
- ✅ 已正確配置 API 憑證

**切換步驟**：

1. **配置 API 憑證**
   ```bash
   nano .env
   # 填入 POLYMARKET_PRIVATE_KEY
   ```

2. **重啟服務**
   ```bash
   docker-compose restart backend
   ```

3. **在 Dashboard 切換模式**
   - 進入 Settings 頁面
   - 點擊 Mode Toggle 開關
   - 確認警告對話框
   - 模式標籤變為：🔴 LIVE

4. **監控運行**
   - 密切關注前幾筆交易
   - 確保訂單正確執行
   - 監控餘額變化

### 緊急停止

如果需要立即停止交易：

1. **切回 Paper 模式**
   - Settings → Mode Toggle → Paper

2. **或直接停止服務**
   ```bash
   docker-compose stop backend
   ```

3. **取消所有訂單**（如果使用實盤）
   - 透過 Polymarket 網站手動取消
   - 或使用 API 批量取消

---

## API 文件

### REST API 端點

#### Health Check
```http
GET /api/health
```

**回應**:
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "mode": "paper",
  "scheduler_running": true
}
```

#### Dashboard

```http
GET /api/dashboard
GET /api/dashboard/stats
GET /api/dashboard/risk
```

#### Markets

```http
GET /api/markets?limit=100&active_only=true
GET /api/markets/opportunities
```

#### Trades

```http
GET /api/trades?limit=100&offset=0&mode=paper&strategy=intra_market
GET /api/trades/stats?mode=paper
GET /api/trades/pnl?mode=paper&days=30
```

#### Settings

```http
GET /api/settings
PUT /api/settings
Content-Type: application/json

{
  "system": { "mode": "paper" },
  "arbitrage": { "min_profit_pct": 0.5 },
  "risk": { "max_position_usd": 500 }
}
```

### WebSocket

連接到 `ws://localhost/ws` 接收實時更新：

**訊息類型**:
- `connected` - 連接確認
- `dashboard` - Dashboard 數據更新
- `opportunities` - 新套利機會
- `trade` - 交易執行結果
- `alert` - 系統警報

**範例訊息**:
```json
{
  "type": "opportunities",
  "data": {
    "opportunities": [...]
  },
  "timestamp": "2024-01-01T12:00:00Z"
}
```

### 互動式 API 文件

訪問 http://localhost:8000/docs 查看完整的 Swagger UI 文件。

---

## 常見問題

### Q: 系統需要多少資金才能運行？

**A**: 
- **模擬盤**: 不需要真實資金，預設 $10,000 虛擬資金
- **實盤**: 建議至少 $1,000 USDC，並根據 `max_position_usd` 設定準備資金

### Q: 套利機會是否一定能成功執行？

**A**: 不一定。可能因為：
- 市場價格快速變動
- 流動性不足
- 網路延遲
- 其他交易者搶先執行

這就是為什麼需要風險管理和多樣化策略。

### Q: 每天預期能賺多少？

**A**: 收益取決於多個因素：
- 市場狀況（波動性、流動性）
- 策略參數設定
- 資金規模
- 套利競爭程度

典型情況：日均 0.5% - 2% ROI，但可能有虧損的日子。

### Q: 如何降低風險？

**A**: 
1. 從模擬盤開始，測試至少 1 週
2. 使用保守的風控參數
3. 分散策略（啟用多種套利類型）
4. 設定較低的 `max_position_usd`
5. 定期檢查交易歷史和表現

### Q: 系統會自動更新嗎？

**A**: 
- 配置文件的修改需要重啟服務
- 透過 Settings 頁面的修改會立即生效
- 建議定期檢查 GitHub 獲取更新

### Q: 支援哪些市場？

**A**: 
系統支援所有 Polymarket 上的公開市場。最佳表現在：
- 高流動性市場（> $10,000）
- 活躍交易的二元市場
- 相關主題的多個市場

### Q: 如何備份數據？

**A**: 
```bash
# 備份資料庫
docker cp polymarket-backend:/app/data/arbitrage.db ./backup/

# 備份配置
cp backend/config/settings.yaml ./backup/
```

### Q: 遇到錯誤怎麼辦？

**A**: 
1. 查看日誌：`docker-compose logs -f backend`
2. 檢查 API 憑證是否正確
3. 確保網路連接正常
4. 重啟服務：`docker-compose restart`
5. 提交 Issue 到 GitHub

---

## 風險提示

### ⚠️ 重要聲明

**本系統僅供教育和研究目的。使用本系統進行真實交易時，請注意以下風險：**

### 市場風險

- 預測市場價格可能快速變動
- 套利機會可能瞬間消失
- 市場流動性可能不足
- 可能出現意外的市場事件

### 技術風險

- 軟體可能存在 Bug
- API 連接可能中斷
- 網路延遲影響執行
- 資料庫可能損壞

### 財務風險

- 可能損失部分或全部投資資金
- 交易成本（Gas 費、滑點）
- 實際收益可能與預期不符
- 稅務責任由使用者自行承擔

### 使用建議

1. **永遠從模擬盤開始**
2. **只投資你能承受損失的資金**
3. **定期監控系統運行**
4. **理解所有參數的含義**
5. **保管好你的 Private Key**
6. **遵守當地法律法規**

### 免責聲明

- 作者不對使用本系統造成的任何損失負責
- 本系統不提供投資建議
- 使用者需自行評估風險
- 過去的表現不代表未來結果

**使用本系統即表示您已理解並接受上述風險。**

---

## 授權

MIT License - 詳見 LICENSE 檔案

---

## 貢獻

歡迎提交 Issue 和 Pull Request！

---

## 聯繫方式

- GitHub Issues: https://github.com/pcfat/polymarket/issues
- Email: [請在 GitHub 上聯繫]

---

<div align="center">

**⭐ 如果這個專案對你有幫助，請給個 Star！**

Made with ❤️ by Polymarket Community

</div>