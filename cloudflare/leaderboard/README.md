# ai-chant-magic 週挑戰排行榜 Worker

`真。AI。咏唱魔法`「本週挑戰」模式的計分板後端。跟 Render 上那台遊戲伺服器完全獨立——這裡只負責「一輪結束後的分數要放哪裡查」,不參與即時連線或模擬。

## 為什麼是 Cloudflare(Worker + KV,不是 D1)

- 遊戲的 Render 免費方案硬碟是暫存的,重新部署就清空,不能放排行榜這種要長期保留的資料。
- 原本設計是 D1,但這個 Cloudflare 帳號的 D1 資料庫數量已經被其他專案(wish-pool / k-rider / goal-grid 等)用滿免費額度上限,不想動別的專案的資料庫,改用 KV——同樣是真持久化、免費、帳號裡還有名額。
- KV 沒有 read-modify-write 交易,同一秒內對「同一週+同一職業」桶子的兩筆同時提交理論上可能互相覆蓋——對這種休閒、低流量的排行榜是可接受的取捨,不值得為此換更重的資料庫。

## 資料模型

一個 KV key = 一個「這週+這個職業」的桶子,例如 `scores:2026-W27:pyro`,value 是最多 200 筆的 JSON 陣列(依 wave 降冪、kills 次要排序),`/top` 只回傳前 20 筆。

每筆記錄用瀏覽器產生的隨機 `clientId`(存 localStorage,不是帳號)辨識同一人,重複提交只有「這次分數比之前好」才會覆蓋——所以是「個人最佳」,不是每次都疊加新的一行。

**沒有防作弊機制**:這是純前端(LocalSession)跑的單機模式,分數提交本來就是瀏覽器直接打 API,跟其他所有「單機模式」的信任等級一樣——這個排行榜只是把「原本就能被竄改」的分數變成看得到而已,不是新增的風險。低風險、純娛樂的排行榜,先不做更重的防護。

## API

- `POST /submit` — body `{weekId, classId, clientId, name, wave, kills}`。`weekId` 必須等於 Worker 自己算出來的「現在是哪一週」(用 UTC 判斷,不信任前端時鐘)。
- `GET /top?week=2026-W27&class=pyro` — 回傳 `{entries: [{name, wave, kills, submittedAt}, ...]}`,最多 20 筆。

## 開發 / 部署

```bash
npm install
npm test              # vitest,測 src/validate.ts 的純函式(路由/KV 本身沒有另外寫測試,手動 curl 驗證過)
npm run dev            # wrangler dev,本機模擬(--local KV,不動到正式資料)
npm run deploy          # 真的部署上線
```

`wrangler.toml` 裡 `ALLOWED_ORIGINS` 控制 CORS 允許哪些網域打這支 API(正式站 + localhost dev)。

部署後把 Worker 網址填進 client 端建置環境變數 `VITE_LEADERBOARD_URL`(比照 `VITE_SERVER_URL` 的做法,見 `.github/workflows/deploy.yml`)。
