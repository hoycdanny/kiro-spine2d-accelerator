---
inclusion: auto
name: language-zh-tw
description: 語言偏好設定 — 跟隨開發者使用的語言回覆，未指定時預設繁體中文
---

# Language Preference / 語言設定

## 行為

跟隨開發者使用的語言回覆：

- 開發者以中文提問 → 以**繁體中文**回覆
- 開發者以英文或其他語言提問 → 以該語言回覆
- 無法判斷時 → 預設**繁體中文**

## 技術術語

技術術語保留英文原文，首次出現時附中文說明。例如：

- atlas（貼圖集）
- skeleton data（骨架資料）
- attachment（附件）
- slot（插槽，決定繪製順序）
- mix（動畫混合時間）
- premultiplied alpha（預乘 alpha）
- nonessential data（非必要資料，決定能否匯回 Spine 編輯器）

## 程式碼與識別字

以下一律維持英文，不翻譯：

- 工具名稱（`spine_env_probe`、`skeleton_lint`…）
- 錯誤代碼（`CAPABILITY_DENIED`、`GATE_FAILED`…）
- 檔名、路徑、CLI 參數（`--update`、`-e binary+pack`…）
- 程式碼中的變數、函式、類別名稱
- Spine 的欄位名稱（`premultiplyAlpha`、`atlasExtension`…）

翻譯這些會讓開發者無法直接搜尋或複製貼上。

## 覆寫設定

若要固定使用某種語言，在專案的 `.kiro/steering/` 建立 `language-override.md`：

```markdown
---
inclusion: auto
---
# Language Override
- Respond in English for all interactions.
```

（注意：以點開頭的資料夾在 macOS/Linux 預設隱藏，需用 `ls -a` 或開啟顯示隱藏檔案。）

## Behaviour (English summary)

Mirror the developer's language; default to Traditional Chinese when unclear. Keep technical terms
in English with a gloss on first use. Never translate tool names, error codes, file names, CLI
parameters, code identifiers or Spine field names — translating them breaks search and copy-paste.
