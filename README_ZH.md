# kiro-spine2d-accelerator

處理 [Spine](https://esotericsoftware.com) 2D 資產的 Kiro Power：把分層美術轉成可綁定的骨架、
檢視與稽核匯出的骨架資料、headless 渲染與比對畫格、編排 Spine CLI，並為 Unity／Web／Godot
產出 runtime 整合。

[English](README.md) · [简体中文](README_CN.md) · [日本語](README_JP.md) · [한국어](README_KR.md)

![左邊是分層 PSD 的卡通角色，右邊是由它生成的骨架與 atlas 渲染出的同一個角色](docs/images/psd-to-rig.png)

*左：`demo/out/hero.psd`，17 個圖層全部由 `demo/make-sample-psd.py` 以程式繪製。
右：`psd_to_skeleton` 從它生成的 20 根骨骼骨架與 atlas 渲染出的一格畫面，整個過程沒有開過 Spine 編輯器。
注意右邊少了紫色披風：`cape` 對不上任何已知身體部位，所以工具把它報告為「略過」，而不是猜它該接在哪裡。*

## 這是什麼

兩層，一起安裝。

**知識層。** [`POWER.md`](POWER.md) 加上 [`steering/`](steering) 裡的 13 份領域指引 —— 匯出自動化、
貼圖打包、lint 規則、視覺回歸、各引擎整合、版本相容性、CI。AI 行動前會先讀這些，
所以它的起點是這些格式被文件記載的行為，而不是猜測。

**執行層。** 一個走 stdio 的 MCP server，提供 22 個工具。

**Spine 沒有編輯器內 API。** 唯一的官方自動化入口是命令列，而它的行為是「另啟一個 Spine 行程 →
做完整個檔案層級的操作 → 退出」—— 你無法遙控開著的編輯器視窗、無法加一根骨頭、也無法選取某個 slot。
所以執行層只做真正可行的兩件事：包裝官方 CLI，以及直接操作有文件記載的資料格式
（`.json` 骨架匯出、`.atlas`、`pack.json`、匯出設定）。

## 它的價值在哪

### 從美術到可綁定骨架，不必開編輯器

`psd_to_skeleton` 讀取分層 PSD，把每個圖層對上身體部位表，以關節邊緣為樞軸建出骨骼鏈，
把各部位打包成 atlas，並寫出骨架 JSON。上面那張圖就是這條路徑的頭尾。
它不需要 Spine 授權，因為它從來沒有啟動 Spine。

![十六個以 attachment 命名的獨立 PNG 檔，排成四乘四並標上檔名](docs/images/attachment-images.png)

*`generated/images/` 資料夾：每個 attachment 一個 PNG，檔名就是 attachment 名稱。
這個資料夾是讓 `File -> Import Data` 能用的關鍵 —— Spine 編輯器把每個 attachment 解析成
匯入 JSON 旁邊的 `<skeleton.images>/<attachmentName>.png`，完全不讀 `.atlas`。
少了它，編輯器會開出一片空白畫布，而且什麼都不說。*

### 自動化視覺檢查，抓到資料看不出來的變更

重新打包 atlas 會讓區域位移幾個像素。骨架 JSON 一個 byte 都沒變，
所以文字 diff、hash 比對、lint 全部都會回報「什麼都沒發生」。

![左邊是角色的基準渲染圖，右邊是 diff 圖，位移的胸部區域以洋紅色標出](docs/images/visual-regression-diff.png)

*左：記錄下來的基準圖。右：把一個 atlas 區域照重新打包的方式位移 3 像素後，
`visual_regression` 寫出的 diff 圖。洋紅色像素就是回歸，灰色都是沒變的部分。
在 demo 裡這個 gate 讓 4 格全部失敗、差異佔 0.89–0.91% 的像素並以非零碼結束，這正是 CI 需要的。*

### 資料檢視、稽核與語意比對

`skeleton_inspect` 報告骨骼與層級深度、slot 與混合模式、skin、attachment 型別、mesh 頂點數、
約束、事件、各動畫時長與 timeline 數 —— 並交叉檢查「骨架需要的區域」與「atlas 提供的區域」。
骨架要、atlas 沒有的區域會渲染成「什麼都沒有」，而且任何地方都不會報錯；
這個檢查值得對每一次匯出都跑。

`skeleton_diff` 區分「只是 hash 變了」與「資料真的變了」。`skeleton_lint` 套用結構不變量、
命名規則與預算，每條發現都附上修正方式，並可直接當 CI gate。

### 一個看得到、也交得出去的 rig

![匯出的單檔 HTML 頁面，角色站在棋盤格舞台上，下方是播放、時間軸、動畫、速度、循環與骨架控制列](docs/images/interactive-preview.png)

*`preview_export_html` 寫出一個自帶所有資源的 HTML 檔 —— runtime、骨架、atlas 與頁面圖
全部以 data URL 內嵌，不向外抓任何東西。控制列是播放／暫停、時間軸拖曳、動畫選單、速度、
循環與骨架除錯線。這裡是暫停並拖到 1.00 秒動畫的 0.50 秒處。
這個檔案內嵌了 Spine Runtimes，所以把它交給任何人都需要你自己的 Spine 授權，見 [授權](#授權)。*

### 用來審 rig 的占位動作

![生成的 walk 在 0.00、0.25、0.50 秒的三格渲染圖，腿部正在跨出一步](docs/images/generated-walk.png)

*`skeleton_animate` 寫出的 `walk` 的三個時間點。這足以看出樞軸、繪製順序與層級在動起來以後
是否還成立，而這正是 rig review 要問的問題。這不是成品動畫，見 [誠實的限制](#誠實的限制)。*

### 各引擎的接線，以及提早失敗的授權邊界

`runtime_scaffold` 產出各 runtime 要求的改名（spine-unity 不會匯入純 `.atlas`，必須是 `.atlas.txt`）、
一份 mix 表由這個骨架自己的動畫推導出來的控制腳本，以及一份步驟 README。

Spine trial 封鎖的操作 —— 存檔、export、pack、unpack、import、cleanup —— 會由 `capability-gate`
在行程被啟動**之前**就拒絕，並印出完整命令列：

```
CAPABILITY_DENIED: Blocked operations: exporting skeleton data (export).
Hint: Purchase a Spine license (Essential or Professional) and install the licensed build.
{
  "edition": "trial",
  "capability": "canExport",
  "wouldHaveRun": "\"C:\\Program Files\\Spine Trial\\SpineTrial.com\" -i ...\\hero-animated.json -e binary"
}
```

那行命令列就是交付物：等正式授權裝好以後，同樣的工作可以一字不改地重跑。

## 安裝與設定

### 需求

**Node.js 18 或更新版本**是 server 本身唯一的硬性需求。

```bash
npm install
npm run build        # tsc -> dist/
```

### 接到 Kiro 或任何 MCP client

本專案自己的 [`mcp.json`](mcp.json) 就是參考形狀：

```json
{
  "mcpServers": {
    "spine-mcp": {
      "command": "node",
      "args": ["./dist/server.js"],
      "transport": "stdio",
      "env": {
        "SPINE_EXECUTABLE": "",
        "SPINE_USER_DATA": ""
      },
      "disabled": false
    }
  }
}
```

Server 走 stdio、不開任何網路埠，因此沒有需要認證的監聽面。

| 環境變數 | 用途 | 留空時 |
|---|---|---|
| `SPINE_EXECUTABLE` | 明確指定 Spine CLI 執行檔路徑。Windows 要指向 `.com` 版本 —— 只有它會回傳 exit code，`.exe` 不會。 | Server 會自己搜尋標準安裝位置。若找不到，CLI 類工具會回報「沒有找到安裝」，而所有資料層、生成與驗證工具照常可用。 |
| `SPINE_USER_DATA` | 明確指定 Spine 使用者資料夾，也就是放 `spine.log`、`version.txt` 與 `examples/` 的那一個。版本與授權版別偵測會讀它。 | 由找到的安裝推導。完全取不到時 `spine_env_probe` 無法分辨 trial 與正式版，寫入型工具會直接拒絕而不是假設。 |
| `SPINE_WORKSPACE_ROOT` | 所有寫入被限制在這個根目錄內，不會寫到外面。 | 預設為工作目錄。 |

### 哪個能力需要什麼

能力是一項一項降級的，不是全有或全無。

| 要使用 | 你需要 |
|---|---|
| `skeleton_inspect`、`atlas_inspect`、`skeleton_diff`、`skeleton_lint`、`export_settings_build`、`pack_settings_build`、`runtime_scaffold`、`skeleton_animate` | 除了 Node 什麼都不用。不需要安裝 Spine，也不需要授權。 |
| `psd_to_skeleton` | [`uv`](https://docs.astral.sh/uv/) 與 Python —— `uv sync --project python` |
| `render_preview`、`preview_export_html`、`visual_regression`，以及 `skeleton_document` 的實測影響範圍一節 | 選用依賴 `@esotericsoftware/spine-webgl`（鎖定 4.2.120）與 `playwright-core`（鎖定 1.62.0），外加一份 Chromium：`npx playwright-core install chromium`。`preview_export_html` 只需要 runtime，不需要瀏覽器。 |
| `spine_env_probe`、`spine_project_info`、`spine_export_settings_capture` | 一份 Spine 編輯器安裝。trial 就夠。 |
| `spine_export`、`spine_pack`、`spine_unpack`、`spine_import`、`spine_cleanup`，以及載有這些命令的 `spine_batch` | **正式授權**的 Spine。trial 封鎖的正好是這一族。 |

缺少選用依賴時，得到的是一個 `DEPENDENCY_MISSING` 錯誤並附上修好它的命令，而不是 stack trace：

```
DEPENDENCY_MISSING: Chromium failed to launch (...). Install the browser with: npx playwright-core install chromium
Headless preview needs playwright-core plus a Chromium build. Everything else in this Power works without them.
```

### 一個值得先知道、否則會花掉一小時的陷阱

**跑 CLI 類工具之前請關掉 Spine 編輯器。** 只要有編輯器視窗開著，launcher 就會把請求交給
那個既有實例，印出 `Started.` 之後永遠不返回。本專案的工具都有 timeout，
並會以那個說明回報 `CLI_TIMEOUT`，但真正的解法是關掉編輯器。

## 兩分鐘試跑

```bash
npm install
npm run build
node demo/run-demo.js        # 或：npm run demo
```

十個步驟、約五秒，透過 stdio 驅動真正的 server 並自己講解：環境探測、PSD → rig、檢視與稽核、
語意 diff、四格渲染、建立基準、故意位移 atlas 並用 diff 圖抓到、Unity scaffold、授權拒絕，
以及那個單檔 HTML 頁面。它**不需要 Spine 授權**，只寫入 `demo/out/`，而且每次執行都會重置該資料夾。
沒有 `uv` 時它會合成一個小 rig 而不是讀 PSD；沒有 Chromium 時它會略過三個視覺步驟並說明。

每一步該說什麼見 [`demo/README_ZH.md`](demo/README_ZH.md)
（[English](demo/README.md) · [简体中文](demo/README_CN.md) · [日本語](demo/README_JP.md) ·
[한국어](demo/README_KR.md)）。

## 22 個工具

### CLI 編排

| 工具 | 需要授權 |
|---|---|
| `spine_env_probe` — 版本、授權版別、能力矩陣、runtime 分支、sidecar 狀態 | 否 |
| `spine_project_info` — 專案的 Spine 版本、骨架與動畫數 | 否 |
| `spine_export` — 匯出骨架資料 | **是** |
| `spine_pack` / `spine_unpack` — 貼圖集打包／解包 | **是** |
| `spine_import` — 把資料匯入 `.spine` 專案 | **是** |
| `spine_cleanup` — 動畫清理，會存回專案；需 `confirm: true` | **是** |
| `spine_export_settings_capture` — 寫出專案真實的匯出設定 | 否 |
| `spine_batch` — 多個命令合併成單次呼叫 | 視內容 |

### 資料層（不需安裝 Spine）

| 工具 | 給你什麼 |
|---|---|
| `skeleton_inspect` | 骨骼與層級深度、slot 與混合模式、skin、attachment 型別、mesh 頂點數、約束、事件、各動畫時長與 timeline 數、nonessential data 是否存在，以及選用的 atlas 交叉檢查 |
| `atlas_inspect` | 頁面、格式、filter、premultiplied alpha、旋轉與裁白區域、填充率、重複命名、非 2 次方頁面 |
| `skeleton_diff` | 兩份匯出的語意差異，並區分「只是 hash 變了」與「資料真的變了」 |
| `skeleton_lint` | 結構不變量、命名、預算、匯出設定與 atlas 問題，每條都附修正建議；可當 CI gate |
| `export_settings_build` | 以範本差異法產生匯出設定，拒絕範本沒有的欄位 |
| `pack_settings_build` | 產生 `pack.json`，全部欄位做型別／範圍／列舉驗證 |

### 生成、驗證、整合

| 工具 | 做什麼 |
|---|---|
| `psd_to_skeleton` | 分層 PSD → 骨架 JSON + atlas + 頁面圖，外加一個裝著各 attachment 獨立 PNG 的 `generated/images/` 資料夾，然後自動檢視與稽核結果 |
| `skeleton_animate` | 以五個模板（`idle`、`walk`、`wave`、`jump`、`turn_head`）產生 Spine 4.2 動畫，寫進另一個 JSON 檔。模板需要的骨骼若缺少，會直接失敗並列出這個 rig 實際有的骨骼，不會拿別的骨骼替代。這是機械上合理的占位動作，達不到美術師手工調整的品質：線性 keyframe、沒有曲線調整、沒有次要動態、沒有重心轉移、沒有腳步固定。請在 Spine 編輯器中開啟後精修 |
| `render_preview` | 用 spine-ts 在 headless Chromium 渲染動畫畫格，並回報每格的像素覆蓋率，讓「無聲渲染出空白」可以被偵測 |
| `visual_regression` | 與基準圖比對、輸出 diff 圖、失敗即擋 |
| `preview_export_html` | 單一自帶所有資源的 HTML 檔，在任何瀏覽器裡播放骨架：播放／暫停、時間軸拖曳、動畫選單、速度、循環、骨架除錯線。runtime、骨架、atlas 與頁面圖全部內嵌 —— 不需伺服器，也不向外抓取任何東西。把這個檔案交付出去需要你自己的 Spine 授權 |
| `skeleton_document` | 輸出 `.spine-doc.md` 與 `.spine-doc.json`，說明這個 rig 到底會做什麼：含世界座標的骨骼層級、從資料解析出的每根骨骼約束、以重新渲染實測的每根骨骼影響範圍，以及每個動畫的動作輪廓。同時記錄內容 fingerprint，因為單看 `skeleton.hash` 偵測不到變更 |
| `runtime_scaffold` | 各平台的檔名要求、含 mix 表的控制腳本，以及步驟 README |

## 兩個工具自己說的話

以下兩段都是對 demo 生成的 rig 實際跑出來的結果。

`skeleton_document` 跑在 `hero.json` + `hero.atlas` 上，報告 20 根骨骼（深度 8）、16 個 slot、
1 個動畫、0 個約束，並在 0.7 秒內以 `rotate` 模式完成 20 次探測，沒有發現任何「完全看不出效果」的骨骼。
它寫出 `hero.spine-doc.md`（骨骼層級樹、每根骨骼的幾何表、實測影響範圍表）以及同內容的 JSON。
以下是那張表的兩列，已節錄：

```
head        -> head 0.0386        [overlap] chest
thigh_left  -> thigh_left, shin_left, foot_left
               [overlap] hip, thigh_right, hand_left, forearm_left
```

`[overlap]` 這個標記正是重點。影響範圍是靠「擾動一根骨骼、再比對軸對齊外接框」量出來的，
所以某個 slot 的框只是跟被移動的框重疊時，它會被標為量測的副產物，而不是被當成「它動了」來報告。

`skeleton_animate` 以 `animations: [{template: 'idle'}, {template: 'wave'}, {template: 'walk'}]`
把三個動畫寫進第二個檔案 —— `idle` 2.00 秒、設計上會循環、用到 6 根骨骼；`wave` 1.00 秒、單次、
用到 5 根骨骼；`walk` 1.00 秒、設計上會循環、用到 8 根骨骼；合計 19 條 timeline、79 個 keyframe。
它保留原本的 `setup` 動畫，並重算 `skeleton.hash`，同時在檔案裡標明演算法是本專案自己的、不是編輯器的。

## 一條典型路徑

```
spine_env_probe                       # 這台機器實際能做什麼？
skeleton_inspect  input, atlas        # 資料裡有什麼，atlas 有沒有缺區域？
skeleton_lint     input, atlas        # 依團隊規範與預算是否正確？
render_preview    skeleton, atlas     # 真的畫得出來嗎？
visual_regression skeleton, atlas     # 外觀有沒有變？
preview_export_html skeleton, atlas   # 一個檔案就能交給客戶打開，不用伺服器
runtime_scaffold  target=unity        # 引擎端需要什麼？
```

以上全部在 trial 授權下可用。export、pack、import 需要正式授權。

## CI

`templates/ci/` 提供 GitHub Actions workflow 與 PowerShell 腳本，`dist/ci-cli.js` 把同樣的 gate
做成子命令：

```bash
node dist/ci-cli.js lint       --export-dir export --fail-on error
node dist/ci-cli.js regression --export-dir export --baseline-dir baseline --diff-dir diff
node dist/ci-cli.js export     --projects-dir art --out-dir export --update 4.2.xx
node dist/ci-cli.js diff       --from old.json --to new.json
```

Exit code：0 通過、1 gate 失敗、2 用法或操作錯誤。預設的 CI 形狀假設匯出產物已 commit，
因此 runner 不需要授權 —— 詳見 `steering/ci-pipeline.md`。

## 誠實的限制

- **生成的動畫是占位動作。** `skeleton_animate` 寫出的是機械上合理的占位動作，
  達不到美術師手工調整的品質：線性 keyframe、沒有曲線調整、沒有次要動態、沒有重心轉移、
  沒有腳步固定，也沒有 mesh 變形。請在 Spine 編輯器中開啟後精修。
  工具本身輸出的原文是 `mechanically plausible placeholder motion, not artist quality — linear keyframes, no curve shaping, no secondary motion, no weight shift, no foot locking. Open it in the Spine editor to refine it.`
- **生成的 rig 只有 region attachment。** 沒有加權 mesh、沒有 IK、沒有 transform 約束。
  權重、mesh 與手調動畫屬於編輯器的工作，這裡是它的前一步。
- **export / pack / import 這一族沒有對正式授權驗證過。** 本專案是在 trial 上開發的。
  命令列組裝、capability gate 與單元測試都在，但這裡沒有觀察到授權版成功執行。
- **影響範圍是用外接框量的。** `skeleton_document` 一次只擾動一根骨骼並比對軸對齊的 slot 框，
  所以歸到其他子樹骨骼上的分數會被標為 `[overlap]` —— 那是量測的副產物，不是真的移動。
- **目前的驗證只在單一平台上。** 所有視覺相關的部分都是在 win32 x64、Windows 10.0.19045、
  Node v24.14.0、playwright-core 1.62.0、Chromium 151.0.7922.34、
  `@esotericsoftware/spine-webgl` 4.2.120 上確認的。macOS、Linux 或其他 GPU／驅動組合都未驗證。
- **二進位 `.skel` 不在範圍內。** 資料層讀 JSON 匯出。
- **匯出設定的欄位名稱官方未公開。** 範本依匯出對話框的文件塑形，
  請用 `spine_export_settings_capture` 校正。`pack.json` 沒有這個問題。
- **Godot 整合未實跑。** 檔名規則與安裝路徑來自官方文件，但沒有任何 Godot 專案消費過輸出。

| 已對真實目標驗證 | 方式 |
|---|---|
| Trial 偵測、能力矩陣、CLI `--version` | 真實的 Spine 4.3.26 Trial |
| 編輯器搶走 CLI 請求導致懸掛 | 實際重現後，寫成 timeout 與專屬提示 |
| Headless 渲染、決定性、回歸偵測 | 真實 headless Chromium |
| PSD → 骨架 + atlas | 以 psd-tools 產生的真實 PSD 檔 |
| Python sidecar 橋接 | 真實 `uv run` 往返 |

| 尚未驗證 | 原因 |
|---|---|
| export / pack / import / cleanup 成功執行 | 此處沒有正式授權的編輯器 |
| 匯出設定的欄位名稱 | 官方未公開，請用 `spine_export_settings_capture` 校正 |
| 二進位 `.skel` 解析 | 目前不在範圍內 |
| Godot 整合 | 規則取自官方文件，未對真實專案跑過 |
| 單一平台與單一 Chromium 以外的任何組合 | 如上所述，驗證只在單一平台完成 |

## 專案結構

```
POWER.md              Power 定義：架構、核心行為、工具總表、workflow
steering/             13 份領域指引，AI 行動前會先讀
templates/            export-settings、pack-settings、lint-rules、ci
hooks/                promptSubmit hook，自動啟用本 Power
src/                  執行層（TypeScript，stdio MCP server）
python/               PSD → 骨架 sidecar（uv、psd-tools、Pillow、rectpack）
docs/images/          本頁的截圖，以及重新產生它們的腳本
demo/                 兩分鐘的腳本化 demo
tests/                unit、property、integration 測試
```

## 開發

```bash
npm run typecheck
npm test                         # 41 個 suite、915 個測試
npm run test:unit
npm run test:integration         # 有安裝時會實際跑 Spine CLI 與 Chromium
uv run --project python pytest   # 89 個測試
```

Integration 測試在缺少 Spine 或 Chromium 時會自動略過，所以在乾淨機器上也是綠的。
另有 `SPINE_CLI_LIVE=1` 的選用層級，需要所有 Spine 編輯器視窗都關閉。

### 重新產生本頁的圖

`docs/images/` 裡的每一張圖都是本專案自己的輸出，由同一個腳本產生：

```bash
npm run build
npm run docs:images        # node docs/make-doc-images.mjs
```

它會跑 `demo/run-demo.js`、透過 stdio 驅動 server 產生那段 walk、
在 Chromium 裡截圖 `demo/out/preview/hero.html`，再用 Pillow
（[`docs/compose-doc-images.py`](docs/compose-doc-images.py)）合成帶標籤的圖。
加上 `--skip-demo` 可以沿用既有的 `demo/out/`。它需要 demo 需要的一切，
所以它會直接失敗，而不是留下一組只重建了一半的圖。
它不讀任何外部美術素材：每一個像素都起自 `demo/make-sample-psd.py` 或由它渲染出的畫格。

## 授權

本專案採用 MIT，見 [LICENSE](LICENSE)。

Spine 本身是 Esoteric Software 的商業軟體，Spine Runtimes 有自己的授權條款。
**把 Spine Runtimes 整合進產品的那個時間點需要持有 Spine 編輯器授權**，
整合之後即使授權日後到期，該產品仍可繼續散佈。把 Runtimes 整合進免費提供的開發工具、SDK
或程式庫是明確允許的，但**使用那個工具的每一位使用者都需要自己的 Spine 授權，而且必須被告知這件事。**
只要散佈的軟體含有 Spine Runtimes 就需要 Spine 授權，即使完全沒有用到 Spine 編輯器也一樣。

本專案從不內嵌 runtime：`@esotericsoftware/spine-webgl` 是從 npm 安裝的 `optionalDependency`，
這裡沒有轉散佈任何 Spine 程式碼、runtime 或範例素材。`preview_export_html` 寫出的 HTML 檔
內嵌了那份 runtime，所以把那個檔案散佈出去需要你自己的授權。

詳見 https://esotericsoftware.com/spine-purchase 。
