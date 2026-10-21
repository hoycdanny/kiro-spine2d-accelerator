# Demo — 兩分鐘，九個步驟

[English](README.md) · [简体中文](README_CN.md) · [日本語](README_JP.md) · [한국어](README_KR.md)

一個會自己講解的腳本，透過 stdio 驅動真正的 MCP server。可以直接在客戶面前跑：
用 Spine **trial** 就能跑完、只寫入 `demo/out/`、每次執行都會先清空該資料夾。

## 執行

```bash
npm install
npm run build
npm run demo
```

兩個選用依賴會讓 demo 完整。沒裝也能跑，它會明確說自己跳過了什麼：

```bash
uv sync --project python          # 第 2 步，PSD 那段
npx playwright install chromium   # 第 5–7 步，視覺那段
```

熱機狀態約 5 秒跑完。然後打開這三個資料夾 —— 它們就是 demo 的重點：

```
demo/out/generated/images/  每個 attachment 一張散圖 PNG —— File -> Import Data 就是對著它們解析
demo/out/preview/           動畫的四張渲染畫格
demo/out/regression-diff/   抓到 atlas 位移 3 像素的 diff 圖
```

## 每一步該說什麼

| 步驟 | 畫面上出現什麼 | 可以直接講的那句話 |
|---|---|---|
| 1. 環境探測 | 偵測到 trial、7 項操作被封鎖、Python sidecar 就緒 | 「它會在你浪費時間之前，先告訴你哪些事做不到。」 |
| 2. PSD → 骨架 | 12 根骨骼、6 個 attachment、6 根虛擬骨骼、`cape` 被跳過，另外產出含 6 張散圖 PNG 的 `generated/images/` 資料夾 | 「素材進、骨架出 —— 而且全程沒開 Spine 編輯器，這就是這段在 trial 上也能用的原因。JSON 旁邊那個 `images/` 資料夾才是讓 `File -> Import Data` 能成功的關鍵：編輯器是對著這些散圖解析 attachment，不是讀 atlas。」 |
| 3. 檢視 + 稽核 | atlas 交叉檢查通過、兩個附修正建議的警告 | 「交叉檢查才是關鍵：骨架需要但 atlas 沒有的區域，在 runtime 會畫出『空的』，而且任何地方都不會報錯。」 |
| 4. 動畫師加動作 | `+ animations: idle, wave` | 「匯出 JSON 的文字 diff 根本看不懂。這個回答的是審查者真正想問的問題。」 |
| 5. 渲染 | 240×240 四張畫格、回報像素覆蓋率 | 「用真正的 Spine web runtime、無頭渲染。覆蓋率的意義是：『它靜悄悄什麼都沒畫』這件事能被偵測到。」 |
| 6. 建基準 + 比對 | 4/4 畫格在容差內 | 「這就是管線在每次變更時會跑的那道 gate。」 |
| 7. 故意弄壞 | 4/4 畫格 FAIL，附像素數與 diff 圖 | 「我把一個 atlas 區域移了三像素。骨架資料完全沒變 —— 只有視覺檢查抓得到。」 |
| 8. Unity scaffold | `hero.atlas → hero.atlas.txt`、mix 表、控制腳本 | 「spine-unity 載不了純 `.atlas`。這條規則寫在工具裡，不是靠某個人記得。」 |
| 9. 授權邊界 | `CAPABILITY_DENIED`，附完整命令列 | 「在 trial 上它會拒絕 —— 並把原本要執行的命令交給你，買了授權後原封不動重跑就行。」 |

## 改成現場即時演示

Power 裝進 Kiro 後，用這些自然語言指令可以走出同一條路徑。
建議先跑一次 `npm run demo`，讓 `demo/out/` 已經有檔案。

```
我現在這台機器的 Spine 環境能做什麼？

把 demo/out/hero.psd 轉成 Spine 骨架，輸出到 demo/out/generated。

稽核 demo/out/generated/hero.json 與它的 atlas，告訴我哪裡有問題。

渲染 wave 動畫的四張畫格並存檔。

建立視覺基準，然後跟它比對一次。

我的 Unity 專案要用這組資產，需要什麼？
```

最後一句很適合收尾：它會回答必須的檔名改動、對應的 runtime 分支，
以及一份 mix 表是從這個骨架自己的動畫推導出來的控制腳本。

## 誠實交代（主動講，不要等人問）

- **範例素材是色塊**，由 `make-sample-psd.py` 生成。它要展示的是綁定規則
  （關節樞紐、虛擬骨骼、繪製順序），不是美術品質。
- **export、pack、import 需要購買授權。** 第 9 步就是刻意展示這條邊界。
  demo 其他部分在 trial 上都能跑。
- **渲染畫格來自 Spine web runtime**，不是 Spine 自己的圖片匯出。
  Spine 的匯出才是權威視覺輸出；這條路徑的存在意義是讓管線能在沒有桌面環境時自我檢查。

## 疑難排解

| 現象 | 處理 |
|---|---|
| `dist/server.js is missing` | 執行 `npm run build` |
| 第 2 步說 uv 不可用 | 執行 `uv sync --project python`，或讓它改用內建的小骨架 |
| 第 5–7 步被跳過 | 執行 `npx playwright install chromium` |
| 在 Spine 編輯器 `File -> Import Data` 之後畫面一片空白 | 編輯器是以匯入的 JSON 為基準，把每個 attachment 解析成 `<skeleton.images>/<attachmentName>.png`，完全不讀 `.atlas`。請確認 `demo/out/generated/images/` 就在 `hero.json` 旁邊、且每個 attachment 都有一張 PNG；若資料夾不存在，用 `emitLooseImages` true（預設值）重跑一次 |
| 某一步回報 `CLI_TIMEOUT` | 關掉所有 Spine 編輯器視窗；launcher 會把 CLI 請求交給已開啟的編輯器，然後永遠不返回 |
| 想要純文字逐字稿 | `NO_COLOR=1 npm run demo > demo-transcript.txt` |
