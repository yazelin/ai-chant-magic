# 真。AI。咏唱魔法

俯視角網頁小遊戲:WSAD/方向鍵移動、滑鼠瞄準,**用麥克風喊出法術名稱**即時施法。
單機可玩,也支援 **2-4 人連線 co-op**(權威伺服器),四種職業各有不同造型與法術組。

- 暗黑魔法(Dark Arcane)視覺風格
- 客戶端純前端(GitHub Pages),連線需要一台 Node WebSocket 伺服器(本機或 Render)
- 語音用瀏覽器內建 Web Speech API —— **請用 Google Chrome 或 Edge**(Linux 的 snap 版 Chromium 沒有語音後端;遊戲會誠實提示)

## 快速開始(本機,含兩分頁連線試玩)

```bash
npm install
npm run dev          # 同時起 server(ws://localhost:8787)與 client(Vite)
```

開瀏覽器到 Vite 印出的網址(通常 http://localhost:5173 )。

- **單機**:選職業 → 單機,直接玩。
- **兩人連線(同機測試)**:開兩個分頁 → 分頁 A「建立房間」拿到代碼 → 分頁 B「輸入代碼加入」→ 各選職業 → 房主按開始。
- 沒有麥克風也能測:遊戲中按 **1 / 2 / 3** 施放當前職業的三個法術;真 Chrome 下可直接用語音喊法術名。

> 兩分頁連線請在 **Vite dev(http)** 下測;不要用 HTTPS 的 Pages 頁面連 `ws://localhost`(瀏覽器會擋)。

## 操作

- 移動:WSAD / 方向鍵
- 面向:滑鼠(法術朝面向發出)
- 施法:喊法術名(無詠唱)或先念呪文「我命汝顯現」再接法術名(詠唱模式);或按 1/2/3
- 倒地:被怪打趴會倒地,隊友站旁邊會自動把你救起;沒人救到、流血計時結束會陣亡,下一波開始時復活
- 重來:`R`

## 職業與法術

| 職業 | 造型 | 法術組 | 定位 |
|---|---|---|---|
| 炎術士 Pyro | 菱形·橘紅 | 火球術、火海、護盾 | 爆發輸出 |
| 霜法師 Cryo | 六角·青藍 | 冰錐、冰霜新星、護盾 | 控場減速 |
| 雷術士 Storm | 三角·紫 | 雷擊、連鎖閃電、護盾 | 穿透連鎖 |
| 守護者 Warden | 圓·金 | 治療術、聖盾、聖光 | 輔助續航 |

人越多,怪潮越瘋狂(超線性);治療/護盾對範圍內**存活**隊友(含自己)生效。

## 連線部署

- **客戶端 → GitHub Pages**:`.github/workflows/deploy.yml` 會 build `client` workspace 並部署 `client/dist`。
- **伺服器 → Render**(或任何 Node 主機):用 `render.yaml` Blueprint 部署。伺服器綁 `PORT`、`/healthz` 探活。
- 部署好伺服器後,讓線上客戶端連它:網址加 `?server=wss://<your-service>.onrender.com`,或在 build 時設 `VITE_SERVER_URL`。
- 線上(HTTPS)客戶端必須連 **wss://**(混合內容限制);沒設定伺服器時 lobby 會提示並提供單機。

## 開發指令

```bash
npm run dev          # server + client 一起跑(本機連線試玩)
npm run dev:client   # 只跑前端(單機就夠)
npm run dev:server   # 只跑伺服器
npm test             # shared 模擬 + server 單元/整合測試
npm run test:client  # client 單元測試(控制/session/內插)
npm run build:client # 產出 client/dist(Pages 用)
npm run build -w @acm/server  # esbuild 打包伺服器到 server/dist/index.js
```

## 架構

`Input → Command → Simulation → Render` 單向流,拆成 npm workspaces:

- `shared/` —— 純 TypeScript 模擬(世界/職業/法術/比對),零瀏覽器/Node 依賴,client 與 server 共用。
- `server/` —— 權威 Node `ws` 伺服器;每 50ms 跑同一套 `step()` 並廣播快照;房間代碼 + 快速加入。
- `client/` —— Vite + Phaser;`LocalSession`(單機本地跑模擬)或 `NetSession`(收伺服器快照、內插渲染,無客戶端預測)。

設計與計劃文件見 `docs/superpowers/`。

## 授權

MIT © 林亞澤 (Yaze Lin)
