# kiro-spine2d-accelerator

Spine 2D 資產工作的 Kiro Power：檢視與稽核匯出的骨架資料、生成貼圖打包設定、透過 Spine CLI 批次匯出、
由分層 PSD 生成骨架、headless 渲染動畫、偵測視覺回歸，並為 Unity／Web／Godot 產出 runtime 整合。

[English](README.md) · [简体中文](README_CN.md) · [日本語](README_JP.md) · [한국어](README_KR.md)

## 為什麼這樣設計

**Spine 沒有編輯器內 API。** 唯一的官方自動化入口是 CLI，而 CLI 的行為是「另啟一個 Spine 行程 →
做完整個檔案層級的操作 → 退出」。你無法遙控開著的編輯器視窗、無法加一根骨頭、也無法選取某個 slot。

所以這個 Power 把價值放在真正可行的地方：

- **CLI 編排** — export、pack、unpack、import、cleanup，可合併成單次呼叫，並支援編輯器版本鎖定
- **確定性資料層** — 以程式碼解析、檢視、稽核、比對匯出的骨架與 atlas 資料，而不是讓模型手改 JSON
- **生成** — 分層 PSD → 可匯入的骨架，完全繞過編輯器
- **驗證** — headless 渲染與像素回歸，可直接當 CI gate
- **整合** — 各 runtime 那些會讓匯入無聲失敗的檔名規則與接線程式碼

兩個在真機上驗證、並已寫進工具行為的事實：

1. **開著 Spine 編輯器會讓 CLI 永久等待。** launcher 會把請求交給既有實例，印出 `Started.` 後不再返回。
   本專案每個 CLI 工具都有 timeout，並會明確報出這個情況。
2. **Trial 禁止所有寫入。** 存檔、texture packing、所有匯出都被停用。寫入型工具會先查版本，
   並連同「原本要執行的完整命令列」一起拒絕，取得授權後可原封不動重跑。

## 兩分鐘試跑

```bash
npm install
npm run build
npm run demo
```

一個會自己講解的腳本，透過 stdio 驅動真正的 server：PSD → 骨架、稽核、渲染、建基準、
故意弄壞 atlas 並用 diff 圖抓到、Unity scaffold，最後展示授權邊界。
在 trial 授權下可安全執行，只寫入 `demo/out/`。

每一步該說什麼見 [`demo/README_ZH.md`](demo/README_ZH.md)
（[English](demo/README.md) · [简体中文](demo/README_CN.md) · [日本語](demo/README_JP.md) · [한국어](demo/README_KR.md)）。

## 安裝

```bash
npm install
npm run build

# 選用 — PSD 生成骨架
uv sync --project python

# 選用 — headless 預覽與視覺回歸
npx playwright install chromium
```

在 MCP 設定（`mcp.json`）註冊：

```json
{
  "mcpServers": {
    "spine-mcp": {
      "command": "node",
      "args": ["./dist/server.js"],
      "transport": "stdio"
    }
  }
}
```

Server 走 stdio、不開任何網路埠，因此沒有需要認證的監聽面。

| 環境變數 | 用途 |
|---|---|
| `SPINE_EXECUTABLE` | 明確指定 Spine CLI 路徑。Windows 必須用 `.com`，那才會回傳 exit code。 |
| `SPINE_USER_DATA` | 明確指定 Spine 使用者資料夾（`spine.log`、`version.txt`、`examples/`）。 |
| `SPINE_WORKSPACE_ROOT` | 寫入限制的根目錄。預設為工作目錄。 |

## 工具

### CLI 編排

| 工具 | 需要授權 |
|---|---|
| `spine_env_probe` — 版本、授權狀態、能力矩陣、runtime 分支、sidecar 狀態 | 否 |
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
| `psd_to_skeleton` | 分層 PSD → 骨架 JSON + atlas + 頁面圖，並自動檢視與稽核結果 |
| `skeleton_animate` | 以五個模板（`idle`、`walk`、`wave`、`jump`、`turn_head`）產生 Spine 4.2 動畫，寫進另一個 `-animated.json`。模板需要的骨骼若缺少，會直接失敗並列出這個 rig 實際有的骨骼，不會拿別的骨骼替代。這是機械上合理的占位動作，達不到美術師手工調整的品質 — 線性 keyframe、沒有曲線調整、沒有次要動態、沒有重心轉移、沒有腳步固定。請在 Spine 編輯器中開啟後精修 |
| `render_preview` | 用 spine-ts 在 headless Chromium 渲染動畫畫格 |
| `visual_regression` | 與基準圖比對、輸出 diff 圖、失敗即擋 |
| `preview_export_html` | 單一自帶所有資源的 HTML 檔，在任何瀏覽器裡播放骨架：播放／暫停、時間軸拖曳、動畫選單、速度、骨架除錯線。runtime、骨架、atlas 與頁面圖全部內嵌 —— 不需伺服器，也不向外抓取任何東西。把這個檔案交付出去需要你自己的 Spine 授權 |
| `skeleton_document` | 輸出 `.spine-doc.md` 與 `.spine-doc.json`，說明這個 rig 到底會做什麼：含世界座標的骨骼層級、從資料解析出的每根骨骼約束、以重新渲染實測的每根骨骼影響範圍，以及每個動畫的動作輪廓。同時記錄內容 fingerprint，因為單看 `skeleton.hash` 偵測不到變更 |
| `runtime_scaffold` | 各平台的檔名要求、含 mix 表的控制腳本，以及步驟 README |

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
因此 runner 不需要授權 — 詳見 `steering/ci-pipeline.md`。

## 專案結構

```
POWER.md              Power 定義：架構、核心行為、工具總表、workflow
steering/             13 份領域指引，AI 行動前會先讀
templates/            export-settings、pack-settings、lint-rules、ci
hooks/                promptSubmit hook，自動啟用本 Power
src/                  執行層（TypeScript，stdio MCP server）
python/               PSD → 骨架 sidecar（uv、psd-tools、Pillow、rectpack）
tests/                unit、property、integration 測試
```

## 開發

```bash
npm run typecheck
npm test                      # 559 個測試
npm run test:integration      # 有安裝時會實際跑 Spine CLI 與 Chromium
uv run --project python pytest   # 66 個測試
```

Integration 測試在缺少 Spine 或 Chromium 時會自動略過，所以在乾淨機器上也是綠的。
另有 `SPINE_CLI_LIVE=1` 的選用層級，需要所有 Spine 編輯器視窗都關閉。

## 誠實的現況

| 已對真實目標驗證 | 方式 |
|---|---|
| Trial 偵測、能力矩陣、CLI `--version` | 真實的 Spine 4.3.26 Trial |
| 編輯器搶走 CLI 請求導致懸掛 | 實際重現後，寫成 timeout 與專屬提示 |
| Headless 渲染、決定性、回歸偵測 | 真實 headless Chromium |
| PSD → 骨架 + atlas | 以 psd-tools 產生的真實 PSD 檔 |
| Python sidecar 橋接 | 真實 `uv run` 往返 |

| 尚未驗證 | 原因 |
|---|---|
| export / pack / import / cleanup 成功執行 | 此處沒有正式授權。命令列組裝、capability gate 與單元測試都在，但沒有觀察到授權版成功執行。 |
| 匯出設定的欄位名稱 | 官方未公開。範本依匯出對話框的文件塑形，請用 `spine_export_settings_capture` 校正。`pack.json` 沒有這個問題。 |
| 二進位 `.skel` 解析 | 目前不在範圍內，資料層讀 JSON 匯出。 |
| Godot 整合 | 檔名規則與安裝路徑來自官方文件，但未對真實 Godot 專案跑過。 |
| 把模板動畫當成美術成品 | `skeleton_animate` 產生的是機械上合理的占位動作，達不到美術師手工調整的品質：線性 keyframe、沒有曲線調整、沒有次要動態、沒有重心轉移、沒有腳步固定，也沒有 mesh 變形。請在 Spine 編輯器中開啟後精修。工具本身輸出的原文是 `mechanically plausible placeholder motion, not artist quality — linear keyframes, no curve shaping, no secondary motion, no weight shift, no foot locking. Open it in the Spine editor to refine it.` |

## 授權

MIT，見 [LICENSE](LICENSE)。

Spine 本身是 Esoteric Software 的商業軟體，Spine Runtimes 有自己的授權條款：
使用整合了 Runtimes 的軟體的每一位使用者，都需要自己的 Spine 授權。
本 Power 不包含也不轉散佈 Spine、其 runtimes 或其範例素材。

把 Spine Runtimes 整合進產品的那個時間點需要持有 Spine 編輯器授權，整合之後即使授權日後到期，
該產品仍可繼續散佈。把 Runtimes 整合進免費提供的開發工具、SDK 或程式庫是明確允許的，但使用那個
工具的每一位使用者都需要自己的 Spine 授權。只要散佈的軟體含有 Spine Runtimes 就需要 Spine 授權，
即使完全沒有用到 Spine 編輯器也一樣。本專案把 `@esotericsoftware/spine-webgl` 當成 optional
dependency 從 npm 安裝，沒有內嵌任何 Spine 程式碼；`preview_export_html` 寫出的 HTML 檔內嵌了
那份 runtime，所以把那個檔案散佈出去需要你自己的授權。
詳見 https://esotericsoftware.com/spine-purchase 。
