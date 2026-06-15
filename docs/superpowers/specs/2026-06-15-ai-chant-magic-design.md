# 真。AI。咏唱魔法 — 設計文件

- **暫名(顯示名)**:真。AI。咏唱魔法
- **Repo slug(英文)**:`ai-chant-magic`
- **日期**:2026-06-15
- **作者**:林亞澤 (yazelin)
- **License**:MIT(林亞澤)

## 1. 一句話定位

俯視角網頁小遊戲:用 WSAD/方向鍵移動、滑鼠控制面向,**用麥克風喊出法術名稱即時施法**,在一波波湧入的怪物中存活越久越好。語音咏唱是核心賣點。

## 2. 範圍與非範圍

### MVP 範圍(本次)
- 單機(single-player),純前端,部署 GitHub Pages,零後台。
- wave survival 撒波生存玩法。
- 5 個法術,語音咏唱施放。
- Web Speech API 語音辨識(continuous 模式)+ 模糊關鍵字比對。
- 雙咏唱模式:直接模式 / 咏唱模式(前置詞)。

### 非範圍(明確不做,YAGNI)
- **不寫任何網路/多人連線程式碼**。只在架構上把邊界切乾淨,讓未來能插入網路層。
- 不做喚醒詞(wake-word / hotword)引擎模型(如 Porcupine/openWakeWord)。理由:法術清單要可擴充、要中英多別名,wake-word 每個詞需訓練模型,不適合;持續 STT + 關鍵字比對在體感上一樣是「一直聽、喊出來就反應」。
- 不做關卡/地圖探索、不做 boss 戰、不做帳號/排行榜後端。
- 不做本機 Whisper 整合(MVP 只實作 Web Speech API;但語音輸入做成可抽換介面,日後可接)。

## 3. 技術棧

| 項目 | 選擇 |
|---|---|
| 語言 | TypeScript |
| 遊戲引擎 | Phaser 3(像素 sprite 俯視角 2D) |
| 打包 | Vite |
| 部署 | GitHub Actions → GitHub Pages(純前端) |
| 語音 | Web Speech API(`SpeechRecognition` / `webkitSpeechRecognition`) |
| 測試 | Vitest(Simulation 層與語音比對函式的單元測試) |
| 美術素材 | 像素 sprite,用生圖工具產(codex-imagegen / nanobanana) |

## 4. 架構:單向資料流(預留多人,現在不寫網路碼)

```
[Input 層]  鍵盤 / 滑鼠 / 麥克風  ──產生──▶  [Command 指令]
                                                  │
                                                  ▼
[Simulation 層]  純邏輯世界狀態
   (玩家 / 怪物 / 投射物 / 血量 / 波次 / 冷卻)
   ├ 不碰繪圖、不碰 DOM、可單獨測試
   └ 吃 Command,每 tick 推進一步(固定步長)
                                                  │
                                                  ▼
[Render 層]  Phaser 讀世界狀態畫成像素畫面 + HUD
```

### 設計原則
- **單向流**:`Input → Command → Simulation → Render`。
- **Simulation 層零依賴**:不 import Phaser、不碰 DOM,純 TypeScript 邏輯。這是可測試性與多人化的關鍵。
- **多人預留的接縫**:現在 Command 在本機直接餵給 Simulation。未來要多人,只需在 Command 與 Simulation 之間插入「網路層」(把 Command 送到 server、收回權威 World 狀態),Simulation 與 Render 幾乎不用改。**本次不實作此層。**

### 模組邊界(每個單一職責、可獨立理解/測試)
- `sim/world.ts` — World 狀態與 `step(world, commands, dt)`。純函式風格。
- `sim/entities.ts` — Player / Enemy / Projectile / 等型別。
- `sim/spells.ts` — 法術定義(效果、冷卻、傷害、形狀)與施法解析。
- `sim/waves.ts` — 波次生成邏輯。
- `voice/recognizer.ts` — 語音輸入介面(`VoiceInput`),Web Speech API 實作。可抽換。
- `voice/matcher.ts` — 把辨識文字模糊比對到法術 id(中/英別名、容錯、雙模式)。**純函式,重點測試對象。**
- `input/controls.ts` — 鍵盤/滑鼠 → 移動向量與面向角度 → Command。
- `render/GameScene.ts` — Phaser Scene,讀 World 畫面。
- `render/hud.ts` — 血量 / 波次 / 分數 / 法術提示 / 麥克風狀態。
- `main.ts` — 組裝各層、主迴圈。

## 5. 操作

- **移動**:WSAD / 方向鍵 → 八方向移動。
- **面向**:滑鼠位置決定角色面向角度;法術朝面向方向射出。
- **施法**:麥克風持續開著轉文字 → 模糊比對法術別名 → 命中且不在冷卻 → 施放。

## 6. 語音咏唱

- Web Speech API `continuous = true`、`interimResults = true`,語系預設 `zh-TW`(中英別名都比對;短英文詞在 zh-TW 引擎多半仍可命中,實作期驗證,必要時提供語系切換)。
- **模糊比對**:對辨識文字做正規化(去空白/標點、全半形、大小寫),比對每個法術的別名清單;容許小幅編輯距離以容錯。
- **雙模式**(設定可切):
  - `直接模式`:辨識文字含法術別名即施法(例:「火球術」)。
  - `咏唱模式`:需含固定前置詞(例:「奧義·火球術」),降低聊天誤觸發。
- **麥克風狀態指示**:HUD 顯示「聆聽中 / 已停 / 不支援」。snap Chromium 等不支援環境要顯示明確提示,不可 silent fail。
- 每個法術有冷卻,避免洗頻;比對命中但在冷卻中則忽略。

## 7. MVP 法術(5 個)

| id | 中文別名 | 英文別名 | 方向性 | 效果 | 冷卻(暫定) |
|---|---|---|---|---|---|
| fireball | 火球術、火球 | fireball, fire | 面向 | 射單發,撞擊爆炸範圍傷害 | 1.2s |
| frost | 冰錐、冰霜 | frost, ice | 面向 | 噴扇形冰片,命中減速 | 1.5s |
| thunder | 雷擊、閃電 | thunder, lightning | 面向 | 瞬發一條貫穿閃電線 | 2.5s |
| shield | 護盾、結界 | shield, guard | 自身 | 短暫擋傷 | 6s |
| heal | 治療術、治癒、補血 | heal, cure | 自身 | 回復一段血量 | 8s |

- `heal` 回血量設計成**無法完全抵消怪物 DPS**,逼玩家仍須清怪;治療只是續命。
- 別名清單可在 `sim/spells.ts` 一行擴充,新增法術無需訓練任何模型。

## 8. 遊戲循環(wave survival)

1. 怪物一波波從畫面四周湧入,朝玩家移動;接觸玩家造成傷害。
2. 玩家用語音法術清怪。清完一波後,下一波數量更多、速度更快。
3. 玩家血量歸零 → 結算畫面(撐過波次 / 擊殺數 / 存活時間)→ 可重來。
4. HUD:血量條、波次、分數、可用法術提示(提示玩家能喊什麼)、麥克風狀態。

## 9. 錯誤處理

- 瀏覽器不支援 Web Speech API(如部分 snap Chromium):顯示明確提示與建議(用 Chrome/Edge),遊戲仍可載入但語音不可用。
- 麥克風權限被拒:HUD 顯示狀態,提供重新授權指引。
- 辨識中斷(`onerror`/`onend`):自動重啟辨識(continuous 模式常被瀏覽器自動結束)。

## 10. 測試策略

- **Simulation 單元測試(Vitest)**:投射物命中判定、波次生成節奏、冷卻邏輯、血量/治療結算、護盾擋傷。
- **語音比對單元測試**:正規化、中英別名命中、容錯(編輯距離)、雙模式前置詞、誤觸發(不該命中的句子)。
- Render 層不寫自動化測試,以手動/瀏覽器驗證為主。

## 11. 部署

- GitHub Actions:`push main` → `vite build` → 部署 `dist/` 到 GitHub Pages。
- Vite `base` 設為 repo 名稱路徑(`/ai-chant-magic/`)以符合 Pages 子路徑。
- public repo,置於 `yazelin/` 帳號下,附 MIT LICENSE(林亞澤)。
- README 記錄玩法、支援的瀏覽器、語音注意事項。

## 12. 開放/待辦(非阻塞)

- 正式遊戲名稱可日後從暫名「真。AI。咏唱魔法」再調整,不影響 repo slug。
- 像素美術素材生成在實作計劃中安排。
- 語系切換 UI(若實測中英混合辨識不佳)視情況補。
