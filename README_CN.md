# kiro-spine2d-accelerator

Spine 2D 资产工作的 Kiro Power：检查与审核导出的骨架数据、生成图集打包设置、通过 Spine CLI 批量导出、
由分层 PSD 生成骨架、headless 渲染动画、检测视觉回归，并为 Unity／Web／Godot 产出 runtime 集成。

[English](README.md) · [繁體中文](README_ZH.md) · [日本語](README_JP.md) · [한국어](README_KR.md)

## 为什么这样设计

**Spine 没有编辑器内 API。** 唯一的官方自动化入口是 CLI，而 CLI 的行为是「另起一个 Spine 进程 →
完成整个文件级别的操作 → 退出」。你无法遥控已打开的编辑器窗口、无法加一根骨骼、也无法选中某个 slot。

所以这个 Power 把价值放在真正可行的地方：

- **CLI 编排** — export、pack、unpack、import、cleanup，可合并为单次调用，并支持编辑器版本锁定
- **确定性数据层** — 用代码解析、检查、审核、比对导出的骨架与图集数据，而不是让模型手改 JSON
- **生成** — 分层 PSD → 可导入的骨架，完全绕过编辑器
- **验证** — headless 渲染与像素回归，可直接作为 CI gate
- **集成** — 各 runtime 那些会让导入静默失败的文件名规则与接线代码

两个在真机上验证、并已写进工具行为的事实：

1. **打开 Spine 编辑器会让 CLI 永久等待。** launcher 会把请求交给已有实例，打印 `Started.` 后不再返回。
   本项目每个 CLI 工具都有 timeout，并会明确报出这种情况。
2. **Trial 禁止所有写入。** 保存、图集打包、所有导出都被禁用。写入型工具会先检查版本，
   并连同「原本要执行的完整命令行」一起拒绝，取得授权后可原样重跑。

## 安装

```bash
npm install
npm run build

# 可选 — PSD 生成骨架
uv sync --project python

# 可选 — headless 预览与视觉回归
npx playwright install chromium
```

在 MCP 配置（`mcp.json`）中注册：

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

Server 走 stdio、不开任何网络端口，因此没有需要认证的监听面。

| 环境变量 | 用途 |
|---|---|
| `SPINE_EXECUTABLE` | 显式指定 Spine CLI 路径。Windows 必须用 `.com`，那才会返回 exit code。 |
| `SPINE_USER_DATA` | 显式指定 Spine 用户数据目录（`spine.log`、`version.txt`、`examples/`）。 |
| `SPINE_WORKSPACE_ROOT` | 写入限制的根目录。默认为工作目录。 |

## 工具

### CLI 编排

| 工具 | 需要授权 |
|---|---|
| `spine_env_probe` — 版本、授权状态、能力矩阵、runtime 分支、sidecar 状态 | 否 |
| `spine_project_info` — 项目的 Spine 版本、骨架与动画数量 | 否 |
| `spine_export` — 导出骨架数据 | **是** |
| `spine_pack` / `spine_unpack` — 图集打包／解包 | **是** |
| `spine_import` — 把数据导入 `.spine` 项目 | **是** |
| `spine_cleanup` — 动画清理，会写回项目；需 `confirm: true` | **是** |
| `spine_export_settings_capture` — 导出项目真实的导出设置 | 否 |
| `spine_batch` — 多个命令合并为单次调用 | 视内容 |

### 数据层（无需安装 Spine）

| 工具 | 提供什么 |
|---|---|
| `skeleton_inspect` | 骨骼与层级深度、slot 与混合模式、skin、attachment 类型、mesh 顶点数、约束、事件、各动画时长与 timeline 数、nonessential data 是否存在，以及可选的图集交叉检查 |
| `atlas_inspect` | 页面、格式、filter、premultiplied alpha、旋转与裁白区域、填充率、重复命名、非 2 的幂页面 |
| `skeleton_diff` | 两份导出的语义差异，并区分「只是 hash 变了」与「数据真的变了」 |
| `skeleton_lint` | 结构不变量、命名、预算、导出设置与图集问题，每条都附修复建议；可作 CI gate |
| `export_settings_build` | 以模板差异法生成导出设置，拒绝模板中不存在的字段 |
| `pack_settings_build` | 生成 `pack.json`，全部字段做类型／范围／枚举校验 |

### 生成、验证、集成

| 工具 | 做什么 |
|---|---|
| `psd_to_skeleton` | 分层 PSD → 骨架 JSON + 图集 + 页面图，并自动检查与审核结果 |
| `render_preview` | 用 spine-ts 在 headless Chromium 渲染动画帧 |
| `visual_regression` | 与基准图比对、输出 diff 图、失败即拦 |
| `runtime_scaffold` | 各平台的文件名要求、含 mix 表的控制脚本，以及步骤 README |

## 一条典型路径

```
spine_env_probe                       # 这台机器实际能做什么？
skeleton_inspect  input, atlas        # 数据里有什么，图集有没有缺区域？
skeleton_lint     input, atlas        # 按团队规范与预算是否正确？
render_preview    skeleton, atlas     # 真的画得出来吗？
visual_regression skeleton, atlas     # 外观有没有变？
runtime_scaffold  target=unity        # 引擎端需要什么？
```

以上全部在 trial 授权下可用。export、pack、import 需要正式授权。

## CI

`templates/ci/` 提供 GitHub Actions workflow 与 PowerShell 脚本，`dist/ci-cli.js` 把同样的 gate
做成子命令：

```bash
node dist/ci-cli.js lint       --export-dir export --fail-on error
node dist/ci-cli.js regression --export-dir export --baseline-dir baseline --diff-dir diff
node dist/ci-cli.js export     --projects-dir art --out-dir export --update 4.2.xx
node dist/ci-cli.js diff       --from old.json --to new.json
```

Exit code：0 通过、1 gate 失败、2 用法或操作错误。默认的 CI 形态假设导出产物已 commit，
因此 runner 不需要授权 — 详见 `steering/ci-pipeline.md`。

## 项目结构

```
POWER.md              Power 定义：架构、核心行为、工具总表、workflow
steering/             13 份领域指引，AI 行动前会先读
templates/            export-settings、pack-settings、lint-rules、ci
hooks/                promptSubmit hook，自动启用本 Power
src/                  执行层（TypeScript，stdio MCP server）
python/               PSD → 骨架 sidecar（uv、psd-tools、Pillow、rectpack）
tests/                unit、property、integration 测试
```

## 开发

```bash
npm run typecheck
npm test                      # 559 个测试
npm run test:integration      # 已安装时会实际运行 Spine CLI 与 Chromium
uv run --project python pytest   # 66 个测试
```

Integration 测试在缺少 Spine 或 Chromium 时会自动跳过，所以在干净机器上也是绿的。
另有 `SPINE_CLI_LIVE=1` 的可选层级，需要所有 Spine 编辑器窗口都关闭。

## 诚实的现状

| 已对真实目标验证 | 方式 |
|---|---|
| Trial 检测、能力矩阵、CLI `--version` | 真实的 Spine 4.3.26 Trial |
| 编辑器抢走 CLI 请求导致挂起 | 实际复现后，写成 timeout 与专属提示 |
| Headless 渲染、确定性、回归检测 | 真实 headless Chromium |
| PSD → 骨架 + 图集 | 用 psd-tools 生成的真实 PSD 文件 |
| Python sidecar 桥接 | 真实 `uv run` 往返 |

| 尚未验证 | 原因 |
|---|---|
| export / pack / import / cleanup 成功执行 | 此处没有正式授权。命令行组装、capability gate 与单元测试都在，但没有观察到授权版成功执行。 |
| 导出设置的字段名 | 官方未公开。模板依导出对话框的文档塑形，请用 `spine_export_settings_capture` 校正。`pack.json` 没有这个问题。 |
| 二进制 `.skel` 解析 | 目前不在范围内，数据层读 JSON 导出。 |
| Godot 集成 | 文件名规则与安装路径来自官方文档，但未对真实 Godot 项目运行过。 |

## 授权

MIT，见 [LICENSE](LICENSE)。

Spine 本身是 Esoteric Software 的商业软件，Spine Runtimes 有自己的授权条款：
使用集成了 Runtimes 的软件的每一位用户，都需要自己的 Spine 授权。
本 Power 不包含也不转散发 Spine、其 runtimes 或其示例素材。

把 Spine Runtimes 集成进产品的那个时间点需要持有 Spine 编辑器授权，集成之后即使授权日后到期，
该产品仍可继续散发。把 Runtimes 集成进免费提供的开发工具、SDK 或程序库是明确允许的，但使用那个
工具的每一位用户都需要自己的 Spine 授权。只要散发的软件含有 Spine Runtimes 就需要 Spine 授权，
即使完全没有用到 Spine 编辑器也一样。本项目把 `@esotericsoftware/spine-webgl` 当作 optional
dependency 从 npm 安装，没有内嵌任何 Spine 代码；`preview_export_html` 写出的 HTML 文件内嵌了
那份 runtime，所以把那个文件散发出去需要你自己的授权。
详见 https://esotericsoftware.com/spine-purchase 。
