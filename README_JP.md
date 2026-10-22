# kiro-spine2d-accelerator

Spine 2D のアセット作業向け Kiro Power。エクスポート済みスケルトンデータの検査と lint、テクスチャ
パッカー設定の生成、Spine CLI による一括エクスポート、レイヤー分けされた PSD からのリグ生成、
ヘッドレスでのアニメーション描画、ビジュアルリグレッション検出、そして Unity／Web／Godot 向けの
ランタイム統合の足場づくりを行います。

[English](README.md) · [繁體中文](README_ZH.md) · [简体中文](README_CN.md) · [한국어](README_KR.md)

## この設計になっている理由

**Spine にはエディタ内 API がありません。** 公式の自動化手段はコマンドラインインターフェースだけで、
CLI は「別の Spine プロセスを起動 → ファイル単位の操作を実行 → 終了」という動作をします。開いている
エディタウィンドウを操作したり、ボーンを追加したり、スロットを選択したりはできません。

そのため、この Power は実際に価値を出せる場所に機能を置いています。

- **CLI オーケストレーション** — export、pack、unpack、import、cleanup。1 回の呼び出しにまとめられ、
  エディタのバージョン固定にも対応
- **決定的なデータレイヤー** — エクスポート済みのスケルトンと atlas をコードで解析・検査・lint・比較。
  モデルに JSON を直接編集させません
- **生成** — レイヤー分けされた PSD からインポート可能なリグへ。エディタを完全にバイパス
- **検証** — ヘッドレス描画とピクセル単位のリグレッション。CI のゲートにそのまま使えます
- **統合** — インポートを無言で壊す、ランタイムごとのファイル名規則と接続コード

実機で確認し、ツールの挙動に組み込んだ 2 つの事実:

1. **Spine エディタが開いていると CLI が永久に待ち続けます。** ランチャーは既存のインスタンスに要求を
   渡し、`Started.` を出力したまま戻りません。本プロジェクトの CLI ツールはすべてタイムアウトを持ち、
   この状況を明示的に報告します。
2. **Trial 版はすべての書き込みを禁止します。** 保存、テクスチャパッキング、全エクスポートが無効です。
   書き込み系ツールはまずエディションを確認し、「実行しようとしたコマンドライン」を添えて拒否するため、
   ライセンス取得後にそのまま再実行できます。

## インストール

```bash
npm install
npm run build

# 任意 — PSD からのリグ生成
uv sync --project python

# 任意 — ヘッドレスプレビューとビジュアルリグレッション
npx playwright install chromium
```

MCP 設定（`mcp.json`）に登録します。

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

サーバーは stdio のみで通信し、ネットワークポートを開かないため、認証が必要な待ち受け面はありません。

| 環境変数 | 用途 |
|---|---|
| `SPINE_EXECUTABLE` | Spine CLI の明示的なパス。Windows では exit code を返す `.com` を指定します。 |
| `SPINE_USER_DATA` | Spine のユーザーデータディレクトリ（`spine.log`、`version.txt`、`examples/`）。 |
| `SPINE_WORKSPACE_ROOT` | 書き込みを閉じ込めるルート。既定は作業ディレクトリです。 |

## ツール

### CLI オーケストレーション

| ツール | ライセンス必要 |
|---|---|
| `spine_env_probe` — バージョン、エディション、機能マトリクス、ランタイムブランチ、サイドカー状態 | 不要 |
| `spine_project_info` — プロジェクトの Spine バージョン、スケルトン数、アニメーション数 | 不要 |
| `spine_export` — スケルトンデータのエクスポート | **必要** |
| `spine_pack` / `spine_unpack` — テクスチャ atlas のパック／アンパック | **必要** |
| `spine_import` — データを `.spine` プロジェクトへインポート | **必要** |
| `spine_cleanup` — アニメーションのクリーンアップ。プロジェクトを保存するため `confirm: true` が必要 | **必要** |
| `spine_export_settings_capture` — プロジェクトの実際のエクスポート設定を書き出す | 不要 |
| `spine_batch` — 複数コマンドを 1 回の呼び出しに | 内容次第 |

### データレイヤー（Spine のインストール不要）

| ツール | 得られるもの |
|---|---|
| `skeleton_inspect` | ボーンと階層の深さ、スロットとブレンドモード、スキン、アタッチメント種別、メッシュ頂点数、コンストレイント、イベント、各アニメーションの長さとタイムライン数、nonessential data の有無、任意で atlas との相互チェック |
| `atlas_inspect` | ページ、フォーマット、フィルター、premultiplied alpha、回転・余白除去された領域、充填率、名前の重複、2 のべき乗でないページ |
| `skeleton_diff` | 2 つのエクスポートの意味的な差分。「ハッシュが変わった」と「データが変わった」を区別します |
| `skeleton_lint` | 構造不変条件、命名、予算、エクスポート設定と atlas の問題。各項目に修正方法付き。CI のゲートに使えます |
| `export_settings_build` | テンプレート差分でエクスポート設定を生成。テンプレートに無いキーは拒否します |
| `pack_settings_build` | `pack.json` を生成。全フィールドを型・範囲・列挙値で検証します |

### 生成・検証・統合

| ツール | 内容 |
|---|---|
| `psd_to_skeleton` | レイヤー PSD → スケルトン JSON + atlas + ページ画像。生成後に検査と lint も実行 |
| `skeleton_animate` | 5 つのテンプレート（`idle`、`walk`、`wave`、`jump`、`turn_head`）から Spine 4.2 のアニメーションを生成し、別ファイル `-animated.json` に書き出します。テンプレートが必要とするボーンが無ければ、別のボーンで代用せずに失敗し、リグが実際に持つボーン名を示します。これは機械的に妥当なプレースホルダーのモーションで、完成したアニメーションではありません — 線形キーフレームのみ、カーブ調整なし、二次モーションなし、重心移動なし、足の固定なし。Spine エディタで開いて仕上げてください |
| `render_preview` | spine-ts をヘッドレス Chromium で動かしアニメーションのフレームを描画 |
| `visual_regression` | ベースラインと比較し、diff 画像を出力。失敗でゲートを閉じます |
| `preview_export_html` | すべてを内包した 1 枚の HTML ファイル。どのブラウザでもスケルトンを再生でき、再生／一時停止、タイムラインのスクラブ、アニメーション選択、速度、ボーン表示が使えます。ランタイム、スケルトン、atlas、ページ画像はすべて埋め込み済み — サーバー不要、外部への取得もありません。このファイルを配布するには自分の Spine ライセンスが必要です |
| `skeleton_document` | `.spine-doc.md` と `.spine-doc.json` を書き出し、そのリグが何をするのかを説明します：ワールド変換付きの階層、データから解決したボーンごとのコンストレイント、再描画して実測したボーンごとの影響範囲、アニメーションごとのモーションプロファイル。内容の fingerprint も記録します。`skeleton.hash` だけでは変更を検出できないからです |
| `runtime_scaffold` | ターゲットごとのファイル名要件、mix テーブル付きのコントローラーコード、手順 README |

## 典型的な流れ

```
spine_env_probe                       # このマシンで実際に何ができるか
skeleton_inspect  input, atlas        # データの中身と、atlas に欠けた領域はないか
skeleton_lint     input, atlas        # チーム規約と予算に照らして正しいか
render_preview    skeleton, atlas     # 実際に描画されるか
visual_regression skeleton, atlas     # 見た目は変わっていないか
preview_export_html skeleton, atlas   # クライアントが開くだけの 1 ファイル、サーバー不要
runtime_scaffold  target=unity        # エンジン側に必要なものは何か
```

ここまではすべて trial ライセンスで動きます。export、pack、import には製品ライセンスが必要です。

## CI

`templates/ci/` に GitHub Actions ワークフローと PowerShell スクリプトがあり、`dist/ci-cli.js` が
同じゲートをサブコマンドとして公開します。

```bash
node dist/ci-cli.js lint       --export-dir export --fail-on error
node dist/ci-cli.js regression --export-dir export --baseline-dir baseline --diff-dir diff
node dist/ci-cli.js export     --projects-dir art --out-dir export --update 4.2.xx
node dist/ci-cli.js diff       --from old.json --to new.json
```

exit code は 0 が成功、1 がゲート失敗、2 が使い方または操作エラーです。既定の CI 構成はエクスポート
成果物がコミットされている前提なので、ランナーにライセンスは不要です（`steering/ci-pipeline.md` 参照）。

## リポジトリ構成

```
POWER.md              Power の定義: アーキテクチャ、基本動作、ツール一覧、ワークフロー
steering/             AI が行動前に読む 13 本のドメインガイド
templates/            export-settings、pack-settings、lint-rules、ci
hooks/                この Power を有効化する promptSubmit フック
src/                  実行レイヤー（TypeScript、stdio MCP サーバー）
python/               PSD → リグのサイドカー（uv、psd-tools、Pillow、rectpack）
tests/                ユニット、プロパティ、統合テスト
```

## 開発

```bash
npm run typecheck
npm test                      # 559 テスト
npm run test:integration      # Spine CLI と Chromium が存在すれば実際に実行します
uv run --project python pytest   # 66 テスト
```

統合テストは Spine や Chromium が無い環境では自動的にスキップされるため、クリーンなマシンでも
スイートはグリーンになります。`SPINE_CLI_LIVE=1` の任意層では、Spine エディタのウィンドウを
すべて閉じておく必要があります。

## 正直な現状

| 実機で検証済み | 方法 |
|---|---|
| Trial 判定、機能マトリクス、CLI `--version` | 実際の Spine 4.3.26 Trial |
| エディタが CLI の要求を奪いハングする挙動 | 再現したうえで、タイムアウトと専用ヒントに実装 |
| ヘッドレス描画、決定性、リグレッション検出 | 実際のヘッドレス Chromium |
| PSD → スケルトン + atlas | psd-tools で生成した実際の PSD ファイル |
| Python サイドカーの橋渡し | 実際の `uv run` 往復 |

| 未検証 | 理由 |
|---|---|
| export / pack / import / cleanup の成功実行 | ここに製品ライセンスがありません。コマンドライン組み立て、capability gate、ユニットテストは揃っていますが、ライセンス版での成功実行は観測していません。 |
| エクスポート設定のフィールド名 | 公式に文書化されていません。テンプレートはエクスポートダイアログの文書から形作っており、`spine_export_settings_capture` で校正してください。`pack.json` にこの問題はありません。 |
| バイナリ `.skel` の解析 | 現時点では対象外で、データレイヤーは JSON エクスポートを読みます。 |
| Godot 統合 | ファイル名規則とインストール経路は公式文書由来ですが、実際の Godot プロジェクトでは未実行です。 |
| テンプレートのモーションを完成品として扱うこと | `skeleton_animate` が書き出すのは機械的に妥当なプレースホルダーのモーションで、完成したアニメーションではありません：線形キーフレームのみ、カーブ調整なし、二次モーションなし、重心移動なし、足の固定なし、メッシュのデフォームなし。Spine エディタで開いて仕上げてください。 |

## ライセンス

MIT（[LICENSE](LICENSE) 参照）。

Spine 自体は Esoteric Software の商用ソフトウェアで、Spine Runtimes には独自のライセンスが
あります。Runtimes を統合したソフトウェアの利用者は、各自が Spine ライセンスを保有する必要が
あります。この Power は Spine、その runtimes、サンプルアセットを同梱も再配布もしません。

Spine Runtimes を製品に統合する時点で Spine エディターのライセンスが必要で、統合後はライセンスが
あとで失効しても、その製品の配布を続けられます。Runtimes を無償で提供する開発ツール、SDK、
ライブラリに統合することは明確に許可されていますが、そのツールの利用者は各自が Spine ライセンスを
保有する必要があります。Spine エディター自体を使わない場合でも、Spine Runtimes を含む
ソフトウェアを配布するには Spine ライセンスが必要です。このリポジトリは
`@esotericsoftware/spine-webgl` を optional dependency として npm から入れるだけで、Spine の
コードは同梱していません。`preview_export_html` が書き出す HTML ファイルはそのランタイムを
埋め込むため、そのファイルを配布するには自分のライセンスが必要です。
詳細は https://esotericsoftware.com/spine-purchase を参照してください。
