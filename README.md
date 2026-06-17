# 真。AI。咏唱魔法

俯視角網頁小遊戲:WSAD/方向鍵移動、滑鼠瞄準,**用麥克風喊出技能名稱**即時施法。
單機可玩,也支援 **2-4 人連線 co-op**(權威伺服器)。四位動漫風魔法少女各有專屬技能:
**惠惠**(炎術士)、**愛蜜莉雅**(霜法師)、**御坂美琴**(電擊使)、**貞德**(守護者)。

**▶ 線上即玩:https://yazelin.github.io/ai-chant-magic/** (單機免伺服器)

- 首頁就是**詠唱練習場**:四角色卡列出技能效果/數值(hover 看詳細),開麥克風對著它練喊;每招**詠唱詞可自訂**(改了練習 + 遊戲都生效)
- 客戶端純前端(GitHub Pages),連線需要一台 Node WebSocket 伺服器(本機或 Render)
- 語音用瀏覽器內建 Web Speech API —— **請用 Google Chrome 或 Edge**(Linux 的 snap 版 Chromium 沒有語音後端;遊戲會誠實提示;沒麥克風可按 1/2/3)

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

## 角色與技能

| 角色(職業) | 三招 | 定位 |
|---|---|---|
| 惠惠 — 炎術士 | **黑暗 / 深淵**(無冷卻,各 +1 爆裂充能)→ **爆裂魔法**(需 ≥1 充能;傷害/範圍隨層數放大、放完清空、冷卻隨層數變長) | 無限蓄力的一發大爆;蓄力時畫面會逐句吐出原作詠唱彩蛋 |
| 愛蜜莉雅 — 霜法師 | **冰柱魔線**(三連冰錐、命中減速)/ **絕對零度**(自身範圍完全凍結)/ **精靈自癒**(自身持續回血) | 控場減速 + 凍結 + 自補 |
| 御坂美琴 — 電擊使 | **超電磁砲**(貫穿雷射、撞牆反彈)/ **落雷**(連鎖閃電最多跳 4 個)/ **鐵砂之劍**(近距傷害 + 擊退) | 直線穿透 + 連鎖清場 + 解圍 |
| 貞德 — 守護者 | **聖光**(自身範圍)/ **聖盾**(全隊護盾)/ **治療術**(全隊持續回血) | 團隊輔助續航,全隊防護由她包辦 |

人越多,怪潮越瘋狂(超線性);治療/護盾對範圍內**存活**隊友(含自己)生效。技能名是預設「詠唱詞」,可在首頁逐招改成你順口的短詞。

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
- `tools/sprite-forge/` —— 角色 sprite 製作工具:用一張 AI 圖抽出大量姿勢 → 瀏覽器挑 → 組成 walk/idle/cast sprite(四角色的動漫造型都用它做的,詳見該夾 README)。

設計與計劃文件見 `docs/superpowers/`。

## 授權

MIT © 林亞澤 (Yaze Lin)
