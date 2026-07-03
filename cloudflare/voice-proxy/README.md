# ai-chant-magic 語音辨識備援 Worker

`真。AI。咏唱魔法`的語音施法預設走瀏覽器內建 Web Speech API。這個 Worker 是備援路線——只在 Web Speech API 完全不支援(如 Firefox)或有但功能失效(如 Linux snap 版 Chromium 沒有語音後端)時才會被用到。**這不是離線方案**——Web Speech API 跟這個 Groq 代理都需要網路,唯一不需要網路的施法方式是畫面下方的技能按鈕(見 `client/src/ui/skillbar.ts`)。

## 架構

`client(GitHub Pages靜態站) → 這個 Worker(存 GROQ_API_KEY secret)→ Groq whisper-large-v3-turbo → 轉錄結果回傳`

GitHub Pages 是純靜態,API key 不能放進任何前端檔案(view-source/network 分頁都看得到)——同樣的道理已經套用在 `cloudflare/leaderboard/` 上,這裡是同一個 pattern。KV 命名空間直接重用 leaderboard 那個(key 全部加 `voiceproxy:` 前綴,不會跟 `scores:...` 衝突),沒有另外申請新的。

## 觸發時機

`client/src/voice/recognizer.ts` 的 `FallbackVoiceInput` 包住原本的 `WebSpeechVoiceInput`,在下列狀態才會切換過來:
- `unsupported`(瀏覽器根本沒有 SpeechRecognition 建構子)
- `error` + 訊息等於既有的 give-up heuristic 判定結果(連續多次辨識失敗,判定後端不能用)

**`denied`(玩家明確拒絕麥克風權限)不會觸發**——麥克風權限是瀏覽器層級的閘門,`getUserMedia` 不管是給 Web Speech 用還是給這個 Worker 錄音用都一樣會被擋,fallback 完全繞不過去。

## 分段策略

Whisper 是批次的,不像 Web Speech API 那樣連續串流。Client 端用能量式 VAD(`AnalyserNode` 抓 RMS 音量,無 ML)判斷「講完一句話」——偵測到約700ms的靜音就切斷、送出這段錄音,而不是固定時間間隔硬切,比較符合「喊完一句短咒語」的自然停頓。

## 成本防護(Groq 是真的按次計費,不像 KV 免費額度)

- 每 IP 每60秒限20次(`rateLimit.ts`,跟 leaderboard 同一份邏輯)
- **全站每日請求數硬上限**(`dailyBudget.ts`,預設2500次/天)——這個是防「分散式」濫用(很多不同IP一起打),單靠per-IP限制擋不住。以 whisper-large-v3-turbo 定價 $0.04/小時、10秒最低計費換算,2500次/天最壞情況約 $0.28/天,遠低於1美元。

## 繁簡處理

Client 端會把玩家目前職業的詠唱詞(預設+自訂)當 `prompt` 一起送過去,引導 Whisper 往這些具體短語、以及繁體字風格靠(prompt本身就是繁體)。這個 Worker 收到轉錄結果後,還會過一層 `traditionalize()` 當安全網——針對遊戲實際用到的字元(深淵/深渊、凍鎖/冻锁等)做字元級簡轉繁,不是完整的 OpenCC 等級轉換器,只保底遊戲自己的詞彙不會因為簡體漂移而配對失敗。

## API

- `POST /transcribe` — multipart/form-data:`audio`(webm/opus 音檔,上限 2MB)+ `prompt`(選填,詞彙提示,上限200字)。回傳 `{text: string}`。

## 開發 / 部署

```bash
npm install
npm test                              # vitest,測 rateLimit/dailyBudget/validate/traditionalize 純函式
npm run dev                            # wrangler dev,本機模擬
echo "<key>" | npx wrangler secret put GROQ_API_KEY   # 設定 Groq API key(絕不寫進任何檔案)
npm run deploy                          # 真的部署上線
```

部署後把 Worker 網址填進 client 端建置環境變數 `VITE_VOICE_PROXY_URL`(比照 `VITE_SERVER_URL`/`VITE_LEADERBOARD_URL`,見 `.github/workflows/deploy.yml`)。
