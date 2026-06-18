# 真。AI。咏唱魔法 — 連線 co-op + 職業系統 設計文件

- **子專案**:1(連線基礎 + 職業能力,合併一份 spec)
- **日期**:2026-06-16
- **作者**:林亞澤 (yazelin) / 設計細節由 Claude 在 yazelin 授權下自主拍板
- **前置**:單機 MVP 已上線(`docs/superpowers/specs/2026-06-15-ai-chant-magic-design.md`)
- **狀態**:yazelin 授權自主實作到可試玩,回來驗收一大塊

## 1. 目標(一句話)

把單機撒波生存擴成 **2-4 人連線 co-op**:權威伺服器跑共用模擬,玩家各選**職業**(火/冰/雷/守護,造型+能力都不同),用語音咏唱各自的法術組,一起在「人越多越瘋狂」的怪潮中存活;倒地可被隊友救、來不及救則下波復活。

## 2. 範圍

### 本 spec 範圍
- repo 重構成 npm workspaces:`shared/` `client/` `server/`。
- **權威 Node 伺服器**(`ws`),tick 20Hz,重用 `shared` 的模擬。
- 房間:**房間代碼(私人房)+ 快速加入(公開配對)** 都做。
- 2-4 人 co-op;**人數越多怪越瘋狂**(超線性)。
- **倒地 + 隊友救援 + 下波復活**。
- **4 職業**,各自法術組(沿用既有 5 法術 + 5 個新法術變體);語音施法吃該玩家職業的法術別名。
- 暗黑風(Dark Arcane)配色;玩家以**不同造型色塊 placeholder** 區分(各職業不同形狀/霓虹色)+ 名字標籤。真 sprite 留作子專案 3。
- **保留單機可玩**:client 透過 `GameSession` 抽象,`LocalSession`(單機,沿用現有體驗)或 `NetSession`(連線)。

### 非範圍(YAGNI / 後續)
- PvP(架構預留,本次不做)。
- 真 pixel sprite 美術(子專案 3;本次用造型化 placeholder)。
- 帳號/排行榜/持久化、重連續玩(reconnect-resume)、觀戰系統。
- 反作弊強化(權威伺服器已天生防大部分;不做進階驗證)。
- 中大型房(5+ 人)、興趣區域(AOI)、delta 壓縮(2-4 人全量 JSON 快照即可)。

## 3. 架構總覽

沿用單機的單向流,在 Command 與 Simulation 之間插入網路層(就是當初預留的接縫):

```
 客戶端 (各玩家瀏覽器)                         權威伺服器 (Node, Render)
 ┌───────────────────────────┐               ┌──────────────────────────────┐
 │ Input(鍵鼠/麥克風)        │   Command     │ Room                          │
 │   → 本地預測(只動自己)   │ ──ws(JSON)──▶ │   每 50ms tick:               │
 │ NetClient                 │               │   step(world, allCmds, dt)    │
 │   ← Snapshot ──────────────┼──ws(JSON)──── │   (= shared 的同一套 step)    │
 │ Render(內插其他玩家/怪)  │   Snapshot    │   廣播 Snapshot 給房內所有人  │
 └───────────────────────────┘               └──────────────────────────────┘
        共用：shared/ (sim / spells / classes / matcher / types)
```

- **shared/**:純 TypeScript,零瀏覽器/Node/Phaser 依賴。client 與 server 都 import。
- **權威**:伺服器是唯一真相。客戶端只送 intent(move/face/cast),收快照後渲染。
- **本地預測**:只對「自己的移動」做預測 + 快照校正(reconciliation),其餘(別的玩家、怪、投射物)用快照內插,降低體感延遲。
- **語音**:仍在各自瀏覽器跑 Web Speech;辨識到法術 → 送 `cast` command(法術 id 來自該玩家職業的 loadout)。

## 4. Workspaces 與檔案結構

```
ai-chant-magic/
├─ package.json                 # workspaces: ["shared","client","server"]
├─ shared/
│  ├─ package.json
│  └─ src/
│     ├─ vec.ts                 # (沿用)
│     ├─ types.ts               # World/Player/Enemy/Projectile/Command + 多人欄位
│     ├─ config.ts              # 調參(含多人/職業/復活/scaling)
│     ├─ spells.ts              # SpellDef + SPELLS(含新法術)+ JUMON
│     ├─ classes.ts             # ClassDef + CLASSES(4 職業 loadout/造型/調整)
│     ├─ matcher.ts             # (沿用,加入「依職業可用法術」過濾)
│     ├─ recognizer-policy.ts   # (沿用)
│     └─ world.ts               # createWorld + step(多人/復活/scaling/新法術)
├─ server/
│  ├─ package.json
│  └─ src/
│     ├─ protocol.ts            # ClientMsg / ServerMsg 型別(JSON)
│     ├─ room.ts                # Room:lobby→playing 狀態機、tick、加入/離開
│     ├─ rooms.ts               # RoomRegistry:房間代碼產生、quick-join 配對
│     ├─ snapshot.ts            # world → Snapshot 序列化(純函式)
│     └─ index.ts               # ws 伺服器 wiring(薄)
├─ client/
│  ├─ package.json
│  ├─ index.html
│  ├─ vite.config.ts
│  └─ src/
│     ├─ main.ts                # 組裝:lobby UI → GameSession → render
│     ├─ net/NetClient.ts       # ws 連線、送 command、收 snapshot、內插緩衝
│     ├─ session/GameSession.ts # 介面;LocalSession / NetSession 兩實作
│     ├─ session/LocalSession.ts# 單機:本地跑 step
│     ├─ session/NetSession.ts  # 連線:NetClient 包成 session
│     ├─ ui/Lobby.ts            # 名字、選職業、房間代碼/快速加入、ready
│     ├─ input/controls.ts      # (沿用)
│     ├─ voice/recognizer.ts    # (沿用)
│     └─ render/
│        ├─ GameScene.ts        # 多玩家/職業造型/內插/HUD
│        └─ hud.ts              # 隊伍 HUD(各玩家血量/倒地/波次/分數/mic)
├─ render.yaml                  # Render Blueprint(部署 server)
└─ .github/workflows/deploy.yml # client → Pages(build client workspace)
```

**重構原則**:`shared` 是 client 既有 `src/sim`、`src/voice/matcher`、`recognizer-policy` 平移而來;單機測試全數搬到 `shared` 並維持綠燈。client 既有單機行為以 `LocalSession` 保留。

## 5. 資料模型(shared/types.ts 重點)

```
type ClassId = 'pyro' | 'cryo' | 'storm' | 'warden';
type SpellId = 'fireball'|'firestorm'|'frost'|'frostnova'|'thunder'|'chain'|'shield'|'aegis'|'heal'|'holybolt';

interface Player {
  id: string; name: string; classId: ClassId;
  pos: Vec2; facing: number;
  hp: number; maxHp: number;
  downed: boolean; bleedoutAt: number;   // world time 倒地會真死的時刻
  reviveProgress: number;                 // 0..1 被救進度
  shieldUntil: number;
  cooldowns: Record<SpellId, number>;
  alive: boolean;                         // false=完全死亡,等下波復活
  respawnAtWave: number;                  // 預定復活波次
  connected: boolean;
}

interface World {
  time; status('lobby'|'playing'|'gameover');
  players: Player[];                      // 多人
  enemies: Enemy[]; projectiles: Projectile[];
  nextEntityId; wave; score(隊伍共用);
  spawnQueue; spawnTimer; spawnCadence; breakTimer;
  playerCount;                            // 影響 scaling 的有效人數
}
```

Command 增加施法者:`{kind:'cast', playerId, spell}`、`{kind:'move', playerId, dir}`、`{kind:'face', playerId, angle}`、`{kind:'revive', playerId, targetId}`(或由 step 自動偵測鄰近隊友救援,見 §7)。

## 6. 職業與法術(4 職業,各 3 法術)

每職業 3 個語音法術。沿用既有機制 + 5 個新法術變體。所有法術可調參數集中在 `config.ts` / `spells.ts`。

| 職業 | 造型(placeholder) | 法術組(中文/英別名) | 角色定位 |
|---|---|---|---|
| **火 Pyro** 炎術士 | 菱形 · 橘紅霓虹 | 火球術(fireball/fire)、火海(firestorm/inferno)、護盾(shield/guard) | 爆發輸出 |
| **冰 Cryo** 冰精靈 | 六角 · 青藍霓虹 | 冰錐(frost/ice)、冰霜新星(frostnova/nova)、護盾(shield/guard) | 控場減速 |
| **雷 Storm** 雷術士 | 三角 · 紫霓虹 | 雷擊(thunder/lightning)、連鎖閃電(chain/chainlightning)、護盾(shield/guard) | 穿透連鎖 |
| **守護 Warden** 守護者 | 圓 · 金/翠霓虹 | 治療術(heal/cure,治隊友)、聖盾(aegis/barrier,護全隊)、聖光(holybolt/smite,小遠程傷) | 輔助續航 |

新法術機制(都是既有 pattern 的變體):
- **火海 firestorm**:朝面向射出較慢的火種,落點(或撞擊)產生**大範圍**延遲爆炸,高傷。重用 fireball 的投射+AoE,放大半徑/傷害、加落地引信。
- **冰霜新星 frostnova**:**以自身為中心**的環狀 AoE,對範圍內怪造成小傷 + 強減速。新但單純(掃一次 enemies 距離)。
- **連鎖閃電 chain**:命中最近的怪,再向附近未命中的怪**跳躍** N 次遞減傷害。新,中等(就近搜尋圖)。
- **聖盾 aegis**:對**範圍內所有隊友**(含自己)上護盾(設定 shieldUntil)。= shield 的「隊友版」。
- **聖光 holybolt**:朝面向的小型直線/投射傷害,讓 Warden 不至於毫無輸出。重用投射。
- **治療術 heal(隊友版)**:回復**範圍內隊友(含自己)**血量;Warden 版較強。co-op 本來就需要對隊友生效。

平衡原則(co-op,人越多越瘋狂):各法術有冷卻;治療/護盾無法完全抵銷怪 DPS;Warden 輸出弱但續航強。具體數值在 `config.ts`,以可玩為先、之後微調。

`classes.ts`:`CLASSES: Record<ClassId,{id,displayName,spells:SpellId[],shape,color,hpMod,speedMod}>`。`spells.ts` 的 `SPELLS` 仍是所有法術的單一定義;職業只決定**可用子集**與少量加成。

## 7. 模擬(shared/world.ts)— 多人擴充

`step(world, commands, dt, rng)` 維持純函式風格,改成多玩家:
1. 套用每個 command 到對應 `playerId` 的玩家(忽略 downed/dead 玩家的 move/cast;downed 仍可被救)。
2. 施法:依**該玩家職業 loadout** 驗證法術可用 + 冷卻;套用效果(投射物記 `ownerId`,只傷怪不傷隊友——co-op 無友傷)。
3. 移動所有 alive 玩家;clamp 場內。
4. **波次/scaling**:`effectivePlayers = connected 且(alive 或 downed)的玩家數`;每波怪量 `baseCount + (wave-1)*perWave`,再乘 `playerScale = playerCount^CONFIG.scaleExp`(超線性,例 1.6);怪 hp/速度隨 wave 升。怪會挑**最近的 alive 玩家**追。
5. **接觸傷害**:怪碰到 alive 玩家扣血(有 shield 則免)。玩家 hp≤0 → 進入 **downed**(非立即死):設 `downed=true`、`bleedoutAt=time+CONFIG.bleedoutTime`、`reviveProgress=0`。
6. **救援**:每 tick,對每個 downed 玩家,若有 alive 隊友在 `reviveRadius` 內 → `reviveProgress += reviveRate*dt`(Warden 在場加速);達 1 → 救起(`downed=false`、hp 設為 `reviveHp`)。若 `time≥bleedoutAt` 仍沒救起 → `alive=false`(完全死)、`respawnAtWave=wave+1`。
7. **復活**:新一波開始時,`alive=false` 的玩家在場中心/隨機點復活(`alive=true,hp=maxHp`)。
8. **gameover**:當所有玩家都 `!alive` 同時 → `status='gameover'`(隊伍全滅)。單機(1 人)時等同原本死亡即結束(下波沒有別人能救,bleedout 後若無人則 game over;單機特例:1 人 downed 無人可救,bleedout→alive=false→無人存活→gameover)。

§7 全部以單元測試覆蓋(多人移動/各職業施法/新法術/救援/bleedout/復活/scaling/全滅)。

## 8. 伺服器(server/)

- **傳輸**:`ws`。訊息為 JSON。
- **protocol.ts**:
  - Client→Server:`join{name,classId,roomCode?}`、`quickJoin{name,classId}`、`create{name,classId}`、`ready{value}`、`startGame`、`input{seq,move?,face?,cast?}`、`leave`。
  - Server→Client:`joined{roomCode,selfId,players}`、`lobby{players}`、`started`、`snapshot{tick,world}`、`error{code,msg}`、`peerLeft{id}`。
- **room.ts**:`Room` 狀態機 `lobby→playing→gameover`。
  - lobby:收 join/ready/class 變更;達到開始條件(房主按 startGame,或全員 ready)→ `playing`,`createWorld(players)`。
  - playing:每 50ms tick:把累積的玩家 input 整理成 commands → `step` → 廣播 snapshot(節流到 ~20Hz)。
  - 玩家斷線:標 `connected=false`;其角色移除/標記;房空 → 由 registry 回收。
- **rooms.ts**:`RoomRegistry`。`createRoom()` 產 4 碼代碼(去除易混字元);`joinByCode`;`quickJoin` 找有空位且在 lobby 的公開房,無則新建。**純邏輯可測**(代碼產生、配對選房)。
- **snapshot.ts**:`toSnapshot(world)` 純函式,挑出要傳的欄位(players/enemies/projectiles/wave/score/status/各玩家 downed/hp)。可測。
- **index.ts**:薄 wiring,把 ws 事件接到 room/registry;tick 用 `setInterval`。
- 上限:每房 4 人;`MAX_ROOMS` 保護。
- **測試**:`rooms.ts`(代碼/配對)、`snapshot.ts`、`room.ts` 的 lobby/開始/input→step 整理邏輯以單元測試覆蓋(注入假 ws/clock)。一支 node ws 整合 smoke:起 server、兩個 ws client、create+join、started、收到 snapshot、送 cast。

## 9. 客戶端(client/)

- **GameSession 介面**:`{ start(), sendMove(dir), sendFace(angle), sendCast(spell), onWorld(cb), getSelfId() }`。
  - **LocalSession**:本機跑 `step`,單一玩家(沿用單機體驗)。
  - **NetSession**:包 `NetClient`;送 input、收 snapshot;`onWorld` 給渲染。
- **NetClient.ts**:連 `serverUrl`(來源:`?server=` query > `VITE_SERVER_URL` > 開發預設 `ws://localhost:8787`);送/收 JSON;維護**快照緩衝**(保留最近 2-3 個,渲染時間回插值 ~100ms);序號化自己 input 供預測校正。
- **Lobby.ts**:輸入名字 → 選職業(4 張卡,顯示造型/法術組)→「建立房間」得代碼 / 「輸入代碼加入」/「快速加入」→ lobby 顯示成員與 ready → 開始。
- **render/GameScene.ts**:依 snapshot 畫**多位玩家**(各職業造型/霓虹色 + 名字 + 倒地圖示 + 救援進度環)、怪、投射物、法術特效;本地玩家用預測位置,其餘內插。
- **render/hud.ts**:隊伍面板(每位玩家名字/血條/倒地狀態)、波次、隊伍分數、自己的法術提示(依職業)、mic 狀態(沿用 recognizer)。
- **語音**:辨識文字 → `matchSpell(text,{mode,jumon,allowed: 該玩家職業 loadout})` → `session.sendCast(spell)`。
- **暗黑風**:背景近黑 + 細格;法術/玩家霓虹發光(沿用 GameScene graphics,顏色用職業色)。

## 10. 連線/錯誤處理

- 連不上伺服器:lobby 顯示「無法連線到伺服器(檢查網址/伺服器是否啟動)」,提供本機單機入口。
- 斷線:遊戲中斷線顯示提示;不做自動重連 resume(MVP)。
- 房間代碼錯誤/房滿/已開始:`error` 訊息回前端顯示。
- 語音:沿用既有 snap-Chromium 偵測與誠實提示(`recognizer-policy`)。
- 混合內容:HTTPS 的 Pages client 必須連 **wss://**;本機則 http client 連 ws://localhost(同源無混合內容問題)。

## 11. 部署

- **client → GitHub Pages**:`deploy.yml` 改成 build `client` workspace;`base: './'`;server URL 由 build 時 `VITE_SERVER_URL` 或執行時 `?server=` 指定。
- **server → Render**:`render.yaml` Blueprint(Node web service,`npm i && npm run build -w server`,`node server/dist/index.js`,健康檢查 `/healthz`,free plan)。提供清楚部署步驟;若環境有可用部署憑證則直接上線並把 client 預設指向該 wss。
- **本機試玩(保證可用)**:root script `npm run dev` 同時起 server(ws://localhost:8787)與 client(vite),開兩個分頁即可兩人連線同玩。

## 12. 測試策略

- **shared 單元測試(Vitest)**:多人 step、四職業每個法術(含 5 新法術)、救援/bleedout/復活、scaling、全滅;matcher 加「職業可用法術過濾」。沿用既有測試平移後保持綠。
- **server 單元測試**:rooms(代碼/quick-join)、snapshot、room lobby/開始/input 整理。
- **server 整合 smoke**:node ws 雙客戶端跑通 create→join→start→snapshot→cast。
- **client**:input/controls 與 session 抽象的純邏輯測試;render/lobby 以本機手動 + 自動 headless 煙霧(載入無 console error)驗證。
- **本機 e2e**:起 server+client,兩分頁加入同房、移動、(真 Chrome)語音施法、互救、全滅重來。

## 13. 給 yazelin 的驗收重點(回來時)

1. `npm install && npm run dev` → 開兩個瀏覽器分頁 → 一個「建立房間」拿代碼、另一個「輸入代碼加入」→ 兩個不同職業 → 開始 → 一起打怪、互救、人多怪變多。
2. 真 Chrome 下喊各自職業的法術名會施對應法術。
3. 線上:client 已上 Pages;若伺服器尚未上線,用本機 server + `?server=ws://localhost:8787`,或依 `render.yaml` 一鍵部署後用 `?server=wss://…`。
4. 單機仍可玩(LocalSession)。

## 14. 我自主拍板、可能想調整的點(留給 yazelin 覆核)

- 職業法術組與數值(尤其新法術手感/平衡)。
- 開始條件(房主按開始 vs 全員 ready vs 倒數自動)。預設:**房主按開始**,且 ≥1 人即可開(方便你一個人開兩分頁測)。
- 救援:採「鄰近自動救援(站旁邊就讀條)」而非額外按鍵,降低操作負擔。
- 復活時點:**下一波開始**復活(非固定秒數)。
- scaleExp(人數超線性指數)預設 1.6。

## 15. 設計覆核修正(2026-06-16,依 adversarial design review)— 本節為最終權威,與前文衝突處以本節為準

經四面向(netcode / 職業平衡 / repo 重構 / 部署)對照現有程式碼的逆向審查,修正如下:

### 15.1 Netcode 簡化(blocker)
- **取消客戶端預測與校正**。現有 `step` 就地 mutate 且用 RNG 生怪,無法重播,預測不可行。**所有實體(含自己)一律走快照內插緩衝**渲染(render 落後約 100ms / 約 2 個快照)。localhost 下延遲體感可忽略。
- **單一頻率**:伺服器每 50ms `step` 一次並廣播一次快照(20Hz),不分離 tick 與 broadcast。
- **每 tick 指令彙整**:每位玩家只保留「最新 move」「最新 face」;**所有 cast 入佇列全部處理**(不可因取最新而漏掉語音施法)。
- **斷線**:玩家標 `connected=false`,**絕不從 players 陣列 splice**(splice 會打亂索引/快照對應)。其角色留在世界但不再吃指令、不再被怪追(視為已離開)。
- **加入時機**:只在 lobby 可加入;**遊戲中拒絕新加入**(回 error)。

### 15.2 Transient 效果頻道(blocker,結構性)
- `World` 與 `Snapshot` 新增 `effects: TransientEffect[]`。瞬發/視覺性法術(thunder 光束、chain 連線、frostnova 環、firestorm 爆炸、aegis/heal 光環)由 `step` 產生一筆短 ttl 效果,`step` 每幀衰減 ttl 並移除過期者;客戶端據此畫特效。
- `TransientEffect = { id, kind, ownerId?, a:Vec2, b?:Vec2, radius?, ttl, colorHint }`(`kind`: 'beam'|'chain'|'nova'|'blast'|'aura')。

### 15.3 Repo 重構順序與工具鏈(blocker)
- **分兩步,各自保持綠**:(1) 先 `git mv` 把 `src/sim`、`src/voice/matcher`、`recognizer-policy` 平移到 `shared/`,測試全綠、單機不變;(2) **另一個獨立步驟**才做 World「單人→players 陣列」改寫。
- **shared 消費模型(擇一,定案)**:`shared` 為 workspace 套件,**以 TS 源碼**被消費。client 用 Vite 直接 bundle TS;**server 用 `tsx` 跑開發、用 `esbuild` 打包成單一 JS 上 Render**(避開 root `tsconfig` 是 `bundler`+`noEmit` 無法 emit Node 產物的問題)。
- 根目錄一份 lockfile 供 `npm ci`;Phaser 只在 client、`ws` 只在 server。

### 15.4 部署現實(blocker)
- **兩分頁驗收一律在 Vite dev server**(http://localhost:5173 client → ws://localhost:8787 server;http 頁面連 ws 無混合內容問題)。**不要**用 HTTPS 的 Pages 頁面連 `ws://localhost`(會被擋/不穩)。
- `deploy.yml` 必須 build **client workspace** 並上傳 `client/dist`(否則上線空站)。
- server 綁 `process.env.PORT` 於 `0.0.0.0`,健康路由 `/healthz` 走同一 http server(供 Render 探活)。Render 免費層會在閒置(約 15 分)後休眠、冷啟動數秒——前端 lobby 顯示「喚醒伺服器中…」UX;**不加 keep-alive cron**。
- Pages client 的 server 網址:`?server=wss://…` query > build 時 `VITE_SERVER_URL`;HTTPS 下若未指定則顯示「需設定伺服器」並提供單機入口。

### 15.5 職業/平衡修正(important)
- **聖光 holybolt 是真正的攻擊**(中等傷害投射),且 Warden **能自我續航**(heal 對含自己生效 + holybolt 有輸出),確保單人/雙人試玩時 Warden 不是陷阱選擇。
- **heal / aegis 只對 alive 隊友(含自己)生效**,跳過 downed/dead。
- **救援採鄰近自動讀條**(alive 隊友站在 downed 隊友 `reviveRadius` 內即累進),**刪除 revive Command**(原 §5 的 revive command 取消,避免雙重規格)。
- **連鎖閃電 chain**:從命中點起「貪婪找最近未命中怪」遍歷,`visited` 集合,`maxJumps=4`,每跳傷害遞減。
- **火海 firestorm**:投射帶引信,**ttl 到期或撞擊時引爆**大範圍 AoE。
- **scaleExp 下修為 1.4**(超線性別把雙人場懲罰過重)。

### 15.6 建置分期(plan 依此切)
- **Phase A(地板,獨立可交付可玩)**:workspaces 重構 + 多人 World(players 陣列、天生無友傷、downed/revive/respawn/scaling、全 10 法術、effects 頻道)+ 全單元測試 + **單機沿用 LocalSession 仍可玩(可選一個職業、用該職業法術)**。Phase A 完成即有可玩 demo。
- **Phase B(天花板)**:`ws` 權威伺服器 + client NetSession + 房間代碼(quick-join 為非阻塞加分項)+ 兩分頁本機 e2e。B 若卡住,A 仍是可交付的可玩版。
- 驗收門:A = sim/職業/法術/救援/scaling 測試綠 + 單機可玩 + 單機死亡→downed→bleedout→gameover 測到;B = node ws smoke(create/join/start/snapshot/cast)+ 手動兩分頁(Vite dev)。
