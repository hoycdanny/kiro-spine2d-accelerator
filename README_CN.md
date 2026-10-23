# kiro-spine2d-accelerator

处理 [Spine](https://esotericsoftware.com) 2D 资产的 Kiro Power：把分层美术转成可绑定的骨架、
检查与审核导出的骨架数据、headless 渲染与比对帧、编排 Spine CLI，并为 Unity／Web／Godot
产出 runtime 集成。

[English](README.md) · [繁體中文](README_ZH.md) · [日本語](README_JP.md) · [한국어](README_KR.md)

![左边是分层 PSD 的卡通角色，右边是由它生成的骨架与图集渲染出的同一个角色](docs/images/psd-to-rig.png)

*左：`demo/out/hero.psd`，17 个图层全部由 `demo/make-sample-psd.py` 用代码绘制。
右：`psd_to_skeleton` 从它生成的 20 根骨骼骨架与图集渲染出的一帧，整个过程没有打开过 Spine 编辑器。
注意右边少了紫色披风：`cape` 对不上任何已知身体部位，所以工具把它报告为「跳过」，而不是猜它该接在哪里。*

## 这是什么

两层，一起安装。

**知识层。** [`POWER.md`](POWER.md) 加上 [`steering/`](steering) 里的 13 份领域指引 —— 导出自动化、
图集打包、lint 规则、视觉回归、各引擎集成、版本兼容性、CI。AI 行动前会先读这些，
所以它的起点是这些格式被文档记载的行为，而不是猜测。

**执行层。** 一个走 stdio 的 MCP server，提供 22 个工具。

**Spine 没有编辑器内 API。** 唯一的官方自动化入口是命令行，而它的行为是「另起一个 Spine 进程 →
完成整个文件级别的操作 → 退出」—— 你无法遥控已打开的编辑器窗口、无法加一根骨骼、也无法选中某个 slot。
所以执行层只做真正可行的两件事：包装官方 CLI，以及直接操作有文档记载的数据格式
（`.json` 骨架导出、`.atlas`、`pack.json`、导出设置）。

## 它的价值在哪

### 从美术到可绑定骨架，不必打开编辑器

`psd_to_skeleton` 读取分层 PSD，把每个图层对上身体部位表，以关节边缘为枢轴建出骨骼链，
把各部位打包成图集，并写出骨架 JSON。上面那张图就是这条路径的首尾。
它不需要 Spine 授权，因为它从来没有启动 Spine。

![十六个以 attachment 命名的独立 PNG 文件，排成四乘四并标上文件名](docs/images/attachment-images.png)

*`generated/images/` 目录：每个 attachment 一个 PNG，文件名就是 attachment 名称。
这个目录是让 `File -> Import Data` 能用的关键 —— Spine 编辑器把每个 attachment 解析成
导入 JSON 旁边的 `<skeleton.images>/<attachmentName>.png`，完全不读 `.atlas`。
少了它，编辑器会打开一片空白画布，而且什么都不说。*

### 自动化视觉检查，抓到数据看不出来的变更

重新打包图集会让区域位移几个像素。骨架 JSON 一个 byte 都没变，
所以文本 diff、hash 比对、lint 全都会回报「什么都没发生」。

![左边是角色的基准渲染图，右边是 diff 图，位移的胸部区域以洋红色标出](docs/images/visual-regression-diff.png)

*左：记录下来的基准图。右：把一个图集区域按重新打包的方式位移 3 像素后，
`visual_regression` 写出的 diff 图。洋红色像素就是回归，灰色都是没变的部分。
在 demo 里这个 gate 让 4 帧全部失败、差异占 0.89–0.91% 的像素并以非零码结束，这正是 CI 需要的。*

### 数据检查、审核与语义比对

`skeleton_inspect` 报告骨骼与层级深度、slot 与混合模式、skin、attachment 类型、mesh 顶点数、
约束、事件、各动画时长与 timeline 数 —— 并交叉检查「骨架需要的区域」与「图集提供的区域」。
骨架要、图集没有的区域会渲染成「什么都没有」，而且任何地方都不会报错；
这个检查值得对每一次导出都跑。

`skeleton_diff` 区分「只是 hash 变了」与「数据真的变了」。`skeleton_lint` 套用结构不变量、
命名规则与预算，每条发现都附上修复方式，并可直接作 CI gate。

### 一个看得到、也交得出去的 rig

![导出的单文件 HTML 页面，角色站在棋盘格舞台上，下方是播放、时间轴、动画、速度、循环与骨骼控制条](docs/images/interactive-preview.png)

*`preview_export_html` 写出一个自带全部资源的 HTML 文件 —— runtime、骨架、图集与页面图
全部以 data URL 内嵌，不向外请求任何东西。控制条是播放／暂停、时间轴拖动、动画选择、速度、
循环与骨骼调试线。这里是暂停并拖到 1.00 秒动画的 0.50 秒处。
这个文件内嵌了 Spine Runtimes，所以把它交给任何人都需要你自己的 Spine 授权，见 [授权](#授权)。*

### 用来审 rig 的占位动作

![生成的 walk 在 0.00、0.25、0.50 秒的三帧渲染图，腿部正在跨出一步](docs/images/generated-walk.png)

*`skeleton_animate` 写出的 `walk` 的三个时间点。这足以看出枢轴、绘制顺序与层级在动起来之后
是否还成立，而这正是 rig review 要问的问题。这不是成品动画，见 [诚实的限制](#诚实的限制)。*

### 各引擎的接线，以及提早失败的授权边界

`runtime_scaffold` 产出各 runtime 要求的改名（spine-unity 不会导入纯 `.atlas`，必须是 `.atlas.txt`）、
一份 mix 表由这个骨架自己的动画推导出来的控制脚本，以及一份步骤 README。

Spine trial 封锁的操作 —— 保存、export、pack、unpack、import、cleanup —— 会由 `capability-gate`
在进程被启动**之前**就拒绝，并打印完整命令行：

```
CAPABILITY_DENIED: Blocked operations: exporting skeleton data (export).
Hint: Purchase a Spine license (Essential or Professional) and install the licensed build.
{
  "edition": "trial",
  "capability": "canExport",
  "wouldHaveRun": "\"C:\\Program Files\\Spine Trial\\SpineTrial.com\" -i ...\\hero-animated.json -e binary"
}
```

那行命令行就是交付物：等正式授权装好以后，同样的工作可以一字不改地重跑。

## 安装与配置

### 需求

**Node.js 18 或更新版本**是 server 本身唯一的硬性需求。

```bash
npm install
npm run build        # tsc -> dist/
```

### 接到 Kiro 或任意 MCP client

本项目自己的 [`mcp.json`](mcp.json) 就是参考形状：

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

Server 走 stdio、不开任何网络端口，因此没有需要认证的监听面。

| 环境变量 | 用途 | 留空时 |
|---|---|---|
| `SPINE_EXECUTABLE` | 显式指定 Spine CLI 可执行文件路径。Windows 要指向 `.com` 版本 —— 只有它会返回 exit code，`.exe` 不会。 | Server 会自己搜索标准安装位置。若找不到，CLI 类工具会回报「没有找到安装」，而所有数据层、生成与验证工具照常可用。 |
| `SPINE_USER_DATA` | 显式指定 Spine 用户数据目录，也就是放 `spine.log`、`version.txt` 与 `examples/` 的那一个。版本与授权版别检测会读它。 | 由找到的安装推导。完全取不到时 `spine_env_probe` 无法分辨 trial 与正式版，写入型工具会直接拒绝而不是假设。 |
| `SPINE_WORKSPACE_ROOT` | 所有写入被限制在这个根目录内，不会写到外面。 | 默认为工作目录。 |

### 哪个能力需要什么

能力是一项一项降级的，不是全有或全无。

| 要使用 | 你需要 |
|---|---|
| `skeleton_inspect`、`atlas_inspect`、`skeleton_diff`、`skeleton_lint`、`export_settings_build`、`pack_settings_build`、`runtime_scaffold`、`skeleton_animate` | 除了 Node 什么都不用。不需要安装 Spine，也不需要授权。 |
| `psd_to_skeleton` | [`uv`](https://docs.astral.sh/uv/) 与 Python —— `uv sync --project python` |
| `render_preview`、`preview_export_html`、`visual_regression`，以及 `skeleton_document` 的实测影响范围一节 | 可选依赖 `@esotericsoftware/spine-webgl`（锁定 4.2.120）与 `playwright-core`（锁定 1.62.0），外加一份 Chromium：`npx playwright install chromium`。`preview_export_html` 只需要 runtime，不需要浏览器。 |
| `spine_env_probe`、`spine_project_info`、`spine_export_settings_capture` | 一份 Spine 编辑器安装。trial 就够。 |
| `spine_export`、`spine_pack`、`spine_unpack`、`spine_import`、`spine_cleanup`，以及载有这些命令的 `spine_batch` | **正式授权**的 Spine。trial 封锁的正好是这一族。 |

缺少可选依赖时，得到的是一个 `DEPENDENCY_MISSING` 错误并附上修好它的命令，而不是 stack trace：

```
DEPENDENCY_MISSING: Chromium failed to launch (...). Install the browser with: npx playwright install chromium
Headless preview needs playwright-core plus a Chromium build. Everything else in this Power works without them.
```

### 一个值得先知道、否则会花掉一小时的陷阱

**跑 CLI 类工具之前请关掉 Spine 编辑器。** 只要有编辑器窗口开着，launcher 就会把请求交给
那个已有实例，打印 `Started.` 之后永远不返回。本项目的工具都有 timeout，
并会以那个说明回报 `CLI_TIMEOUT`，但真正的解法是关掉编辑器。

## 两分钟试跑

```bash
npm install
npm run build
node demo/run-demo.js        # 或：npm run demo
```

十个步骤、约五秒，通过 stdio 驱动真正的 server 并自己讲解：环境探测、PSD → rig、检查与审核、
语义 diff、四帧渲染、建立基准、故意位移图集并用 diff 图抓到、Unity scaffold、授权拒绝，
以及那个单文件 HTML 页面。它**不需要 Spine 授权**，只写入 `demo/out/`，而且每次执行都会重置该目录。
没有 `uv` 时它会合成一个小 rig 而不是读 PSD；没有 Chromium 时它会跳过三个视觉步骤并说明。

每一步该说什么见 [`demo/README_CN.md`](demo/README_CN.md)
（[English](demo/README.md) · [繁體中文](demo/README_ZH.md) · [日本語](demo/README_JP.md) ·
[한국어](demo/README_KR.md)）。

## 22 个工具

### CLI 编排

| 工具 | 需要授权 |
|---|---|
| `spine_env_probe` — 版本、授权版别、能力矩阵、runtime 分支、sidecar 状态 | 否 |
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
| `psd_to_skeleton` | 分层 PSD → 骨架 JSON + 图集 + 页面图，外加一个装着各 attachment 独立 PNG 的 `generated/images/` 目录，然后自动检查与审核结果 |
| `skeleton_animate` | 用五个模板（`idle`、`walk`、`wave`、`jump`、`turn_head`）生成 Spine 4.2 动画，写进另一个 JSON 文件。模板需要的骨骼若缺失，会直接失败并列出该 rig 实际拥有的骨骼，不会拿别的骨骼替代。这是机械上合理的占位动作，达不到美术师手工打磨的品质：线性 keyframe、没有曲线调整、没有次级动态、没有重心转移、没有脚步锁定。请在 Spine 编辑器中打开后细修 |
| `render_preview` | 用 spine-ts 在 headless Chromium 渲染动画帧，并回报每帧的像素覆盖率，让「静默渲染出空白」可以被检测 |
| `visual_regression` | 与基准图比对、输出 diff 图、失败即拦 |
| `preview_export_html` | 单个自带全部资源的 HTML 文件，在任意浏览器里播放骨架：播放／暂停、时间轴拖动、动画选择、速度、循环、骨骼调试线。runtime、骨架、图集与页面图全部内嵌 —— 不需要服务器，也不向外请求任何东西。分发这个文件需要你自己的 Spine 授权 |
| `skeleton_document` | 输出 `.spine-doc.md` 与 `.spine-doc.json`，说明这个 rig 到底会做什么：含世界坐标的骨骼层级、从数据解析出的每根骨骼约束、通过重新渲染实测的每根骨骼影响范围，以及每个动画的动作轮廓。同时记录内容 fingerprint，因为只看 `skeleton.hash` 检测不到变更 |
| `runtime_scaffold` | 各平台的文件名要求、含 mix 表的控制脚本，以及步骤 README |

## 两个工具自己说的话

以下两段都是对 demo 生成的 rig 实际跑出来的结果。

`skeleton_document` 跑在 `hero.json` + `hero.atlas` 上，报告 20 根骨骼（深度 8）、16 个 slot、
1 个动画、0 个约束，并在 0.7 秒内以 `rotate` 模式完成 20 次探测，没有发现任何「完全看不出效果」的骨骼。
它写出 `hero.spine-doc.md`（骨骼层级树、每根骨骼的几何表、实测影响范围表）以及同内容的 JSON。
以下是那张表的两行，已节录：

```
head        -> head 0.0386        [overlap] chest
thigh_left  -> thigh_left, shin_left, foot_left
               [overlap] hip, thigh_right, hand_left, forearm_left
```

`[overlap]` 这个标记正是重点。影响范围是靠「扰动一根骨骼、再比对轴对齐外接框」量出来的，
所以某个 slot 的框只是跟被移动的框重叠时，它会被标为测量的副产物，而不是被当成「它动了」来报告。

`skeleton_animate` 以 `animations: [{template: 'idle'}, {template: 'wave'}, {template: 'walk'}]`
把三个动画写进第二个文件 —— `idle` 2.00 秒、设计上会循环、用到 6 根骨骼；`wave` 1.00 秒、单次、
用到 5 根骨骼；`walk` 1.00 秒、设计上会循环、用到 8 根骨骼；合计 19 条 timeline、79 个 keyframe。
它保留原本的 `setup` 动画，并重算 `skeleton.hash`，同时在文件里标明算法是本项目自己的、不是编辑器的。

## 一条典型路径

```
spine_env_probe                       # 这台机器实际能做什么？
skeleton_inspect  input, atlas        # 数据里有什么，图集有没有缺区域？
skeleton_lint     input, atlas        # 按团队规范与预算是否正确？
render_preview    skeleton, atlas     # 真的画得出来吗？
visual_regression skeleton, atlas     # 外观有没有变？
preview_export_html skeleton, atlas   # 一个文件就能交给客户打开，不用服务器
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
因此 runner 不需要授权 —— 详见 `steering/ci-pipeline.md`。

## 诚实的限制

- **生成的动画是占位动作。** `skeleton_animate` 写出的是机械上合理的占位动作，
  达不到美术师手工打磨的品质：线性 keyframe、没有曲线调整、没有次级动态、没有重心转移、
  没有脚步锁定，也没有 mesh 变形。请在 Spine 编辑器中打开后细修。
  工具本身输出的原文是 `mechanically plausible placeholder motion, not artist quality — linear keyframes, no curve shaping, no secondary motion, no weight shift, no foot locking. Open it in the Spine editor to refine it.`
- **生成的 rig 只有 region attachment。** 没有加权 mesh、没有 IK、没有 transform 约束。
  权重、mesh 与手调动画属于编辑器的工作，这里是它的前一步。
- **export / pack / import 这一族没有对正式授权验证过。** 本项目是在 trial 上开发的。
  命令行组装、capability gate 与单元测试都在，但这里没有观察到授权版成功执行。
- **影响范围是用外接框量的。** `skeleton_document` 一次只扰动一根骨骼并比对轴对齐的 slot 框，
  所以归到其他子树骨骼上的分数会被标为 `[overlap]` —— 那是测量的副产物，不是真的移动。
- **目前的验证只在单一平台上。** 所有视觉相关的部分都是在 win32 x64、Windows 10.0.19045、
  Node v24.14.0、playwright-core 1.62.0、Chromium 151.0.7922.34、
  `@esotericsoftware/spine-webgl` 4.2.120 上确认的。macOS、Linux 或其他 GPU／驱动组合都未验证。
- **二进制 `.skel` 不在范围内。** 数据层读 JSON 导出。
- **导出设置的字段名官方未公开。** 模板依导出对话框的文档塑形，
  请用 `spine_export_settings_capture` 校正。`pack.json` 没有这个问题。
- **Godot 集成未实跑。** 文件名规则与安装路径来自官方文档，但没有任何 Godot 项目消费过输出。

| 已对真实目标验证 | 方式 |
|---|---|
| Trial 检测、能力矩阵、CLI `--version` | 真实的 Spine 4.3.26 Trial |
| 编辑器抢走 CLI 请求导致挂起 | 实际复现后，写成 timeout 与专属提示 |
| Headless 渲染、确定性、回归检测 | 真实 headless Chromium |
| PSD → 骨架 + 图集 | 用 psd-tools 生成的真实 PSD 文件 |
| Python sidecar 桥接 | 真实 `uv run` 往返 |

| 尚未验证 | 原因 |
|---|---|
| export / pack / import / cleanup 成功执行 | 此处没有正式授权的编辑器 |
| 导出设置的字段名 | 官方未公开，请用 `spine_export_settings_capture` 校正 |
| 二进制 `.skel` 解析 | 目前不在范围内 |
| Godot 集成 | 规则取自官方文档，未对真实项目跑过 |
| 单一平台与单一 Chromium 以外的任何组合 | 如上所述，验证只在单一平台完成 |

## 项目结构

```
POWER.md              Power 定义：架构、核心行为、工具总表、workflow
steering/             13 份领域指引，AI 行动前会先读
templates/            export-settings、pack-settings、lint-rules、ci
hooks/                promptSubmit hook，自动启用本 Power
src/                  执行层（TypeScript，stdio MCP server）
python/               PSD → 骨架 sidecar（uv、psd-tools、Pillow、rectpack）
docs/images/          本页的截图，以及重新生成它们的脚本
demo/                 两分钟的脚本化 demo
tests/                unit、property、integration 测试
```

## 开发

```bash
npm run typecheck
npm test                         # 41 个 suite、915 个测试
npm run test:unit
npm run test:integration         # 已安装时会实际运行 Spine CLI 与 Chromium
uv run --project python pytest   # 89 个测试
```

Integration 测试在缺少 Spine 或 Chromium 时会自动跳过，所以在干净机器上也是绿的。
另有 `SPINE_CLI_LIVE=1` 的可选层级，需要所有 Spine 编辑器窗口都关闭。

### 重新生成本页的图

`docs/images/` 里的每一张图都是本项目自己的输出，由同一个脚本生成：

```bash
npm run build
npm run docs:images        # node docs/make-doc-images.mjs
```

它会跑 `demo/run-demo.js`、通过 stdio 驱动 server 生成那段 walk、
在 Chromium 里截图 `demo/out/preview/hero.html`，再用 Pillow
（[`docs/compose-doc-images.py`](docs/compose-doc-images.py)）合成带标签的图。
加上 `--skip-demo` 可以沿用已有的 `demo/out/`。它需要 demo 需要的一切，
所以它会直接失败，而不是留下一组只重建了一半的图。
它不读任何外部美术素材：每一个像素都起自 `demo/make-sample-psd.py` 或由它渲染出的帧。

## 授权

本项目采用 MIT，见 [LICENSE](LICENSE)。

Spine 本身是 Esoteric Software 的商业软件，Spine Runtimes 有自己的授权条款。
**把 Spine Runtimes 集成进产品的那个时间点需要持有 Spine 编辑器授权**，
集成之后即使授权日后到期，该产品仍可继续散发。把 Runtimes 集成进免费提供的开发工具、SDK
或程序库是明确允许的，但**使用那个工具的每一位用户都需要自己的 Spine 授权，而且必须被告知这件事。**
只要散发的软件含有 Spine Runtimes 就需要 Spine 授权，即使完全没有用到 Spine 编辑器也一样。

本项目从不内嵌 runtime：`@esotericsoftware/spine-webgl` 是从 npm 安装的 `optionalDependency`，
这里没有转散发任何 Spine 代码、runtime 或示例素材。`preview_export_html` 写出的 HTML 文件
内嵌了那份 runtime，所以把那个文件散发出去需要你自己的授权。

详见 https://esotericsoftware.com/spine-purchase 。
