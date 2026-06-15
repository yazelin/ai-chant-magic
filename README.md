# 真。AI。咏唱魔法

俯視角網頁小遊戲:用 WSAD/方向鍵移動、滑鼠瞄準,**用麥克風喊出法術名稱**即時施法,在一波波怪物中存活越久越好。純前端、零後台,部署在 GitHub Pages。

## 玩法

- 移動:WSAD 或方向鍵
- 面向:滑鼠位置(法術朝面向發出)
- 施法:點一下畫面授權麥克風後,直接喊法術名
- 法術:火球術 / 冰霜 / 雷擊 / 護盾 / 治療術(中英別名皆可)
- 詠唱模式:
  - 無詠唱 — 直接喊法術名
  - 詠唱 — 先念呪文「我命汝顯現」再接法術名
- 遊戲結束後按 `R` 重來

## 瀏覽器需求

語音辨識使用瀏覽器內建 Web Speech API,請用 **Chrome 或 Edge**。
部分 Linux 的 snap 版 Chromium 不支援語音(會顯示提示),其餘操作仍可進行。

## 開發

```bash
npm install
npm run dev      # 本機開發
npm run test     # 單元測試(模擬層 + 語音比對)
npm run build    # 產出 dist/
```

## 架構

`Input → Command → Simulation → Render` 單向資料流。`src/sim/` 為純邏輯、零依賴、可單元測試;未來要做多人連線,只需在 Command 與 Simulation 之間插入網路層,模擬與繪圖層幾乎不用改。

## 授權

MIT © 林亞澤 (Yaze Lin)
