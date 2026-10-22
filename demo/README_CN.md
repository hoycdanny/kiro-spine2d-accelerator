# Demo — 两分钟，十个步骤

[English](README.md) · [繁體中文](README_ZH.md) · [日本語](README_JP.md) · [한국어](README_KR.md)

一个会自己讲解的脚本，通过 stdio 驱动真正的 MCP server。可以直接在客户面前跑：
用 Spine **trial** 就能跑完、只写入 `demo/out/`、每次执行都会先清空该目录。

## 执行

```bash
npm install
npm run build
npm run demo
```

两个可选依赖会让 demo 更完整。没装也能跑，它会明确说明跳过了什么：

```bash
uv sync --project python          # 第 2 步，PSD 那段
npx playwright install chromium   # 第 5–7 步，视觉那段
```

热机状态约 5 秒跑完。然后打开这几个产物 —— 它们就是 demo 的重点：

```
demo/out/generated/images/  每个 attachment 一张散图 PNG —— File -> Import Data 就是对着它们解析
demo/out/preview/           动画的四张渲染帧
demo/out/regression-diff/   抓到图集位移 3 像素的 diff 图
demo/out/preview/hero.html  直接双击：动画会在任何浏览器里播放，不需要搭服务器
```

## 每一步该说什么

| 步骤 | 画面上出现什么 | 可以直接讲的那句话 |
|---|---|---|
| 1. 环境探测 | 检测到 trial、7 项操作被封锁、Python sidecar 就绪 | “它会在你浪费时间之前，先告诉你哪些事做不到。” |
| 2. PSD → 骨架 | 12 根骨骼、6 个 attachment、6 根虚拟骨骼、`cape` 被跳过，另外生成含 6 张散图 PNG 的 `generated/images/` 目录 | “素材进、骨架出 —— 而且全程没打开 Spine 编辑器，这就是这一段在 trial 上也能用的原因。JSON 旁边那个 `images/` 目录才是让 `File -> Import Data` 能成功的关键：编辑器是对着这些散图解析 attachment，而不是读图集。” |
| 3. 检查 + 审核 | 图集交叉检查通过、两个附修复建议的警告 | “交叉检查才是关键：骨架需要但图集没有的区域，在 runtime 会画出‘空的’，而且任何地方都不会报错。” |
| 4. 动画师加动作 | `+ animations: idle, wave` | “导出 JSON 的文本 diff 根本看不懂。这个回答的是审查者真正想问的问题。” |
| 5. 渲染 | 240×240 四张帧、报告像素覆盖率 | “用真正的 Spine web runtime、无头渲染。覆盖率的意义是：‘它悄无声息什么都没画’这件事能被检测到。” |
| 6. 建基准 + 比对 | 4/4 帧在容差内 | “这就是流水线在每次变更时会跑的那道 gate。” |
| 7. 故意弄坏 | 4/4 帧 FAIL，附像素数与 diff 图 | “我把一个图集区域移了三像素。骨架数据完全没变 —— 只有视觉检查抓得到。” |
| 8. Unity scaffold | `hero.atlas → hero.atlas.txt`、mix 表、控制脚本 | “spine-unity 加载不了纯 `.atlas`。这条规则写在工具里，不是靠某个人记得。” |
| 9. 授权边界 | `CAPABILITY_DENIED`，附完整命令行 | “在 trial 上它会拒绝 —— 并把原本要执行的命令交给你，买了授权后原样重跑就行。” |
| 10. 可以直接交给客户的一个文件 | `demo/out/preview/hero.html`，约 236 KB | “双击打开就行。runtime、骨架、图集、图片全都打包在这一个文件里 —— 不用服务器、不用安装、不会向外拉取任何东西。可以拖时间轴。注意它内嵌了 Spine Runtimes，所以把文件交给别人需要你自己的 Spine 授权。” |

## 改成现场实时演示

Power 装进 Kiro 后，用这些自然语言指令可以走出同一条路径。
建议先跑一次 `npm run demo`，让 `demo/out/` 已经有文件。

```
我现在这台机器的 Spine 环境能做什么？

把 demo/out/hero.psd 转成 Spine 骨架，输出到 demo/out/generated。

审核 demo/out/generated/hero.json 与它的图集，告诉我哪里有问题。

渲染 wave 动画的四张帧并保存。

建立视觉基准，然后跟它比对一次。

我的 Unity 项目要用这组资产，需要什么？
```

最后一句很适合收尾：它会回答必须的文件名改动、对应的 runtime 分支，
以及一份 mix 表是从这个骨架自己的动画推导出来的控制脚本。

## 诚实交代（主动讲，不要等人问）

- **示例素材是色块**，由 `make-sample-psd.py` 生成。它要展示的是绑定规则
  （关节枢纽、虚拟骨骼、绘制顺序），不是美术质量。
- **export、pack、import 需要购买授权。** 第 9 步就是刻意展示这条边界。
  demo 其他部分在 trial 上都能跑。
- **渲染帧来自 Spine web runtime**，不是 Spine 自己的图片导出。
  Spine 的导出才是权威视觉输出；这条路径的存在意义是让流水线能在没有桌面环境时自我检查。

## 疑难排解

| 现象 | 处理 |
|---|---|
| `dist/server.js is missing` | 执行 `npm run build` |
| 第 2 步说 uv 不可用 | 执行 `uv sync --project python`，或让它改用内置的小骨架 |
| 第 5–7 步被跳过 | 执行 `npx playwright install chromium` |
| 在 Spine 编辑器 `File -> Import Data` 之后画面一片空白 | 编辑器以导入的 JSON 为基准，把每个 attachment 解析成 `<skeleton.images>/<attachmentName>.png`，完全不读 `.atlas`。请确认 `demo/out/generated/images/` 就在 `hero.json` 旁边、且每个 attachment 都有一张 PNG；若目录不存在，用 `emitLooseImages` true（默认值）重跑一次。你自己放进该目录的 PNG 会列在 `foreignImagesKept` 并原样保留：只有以已知身体部位命名的图才会被清理 |
| 某一步报告 `CLI_TIMEOUT` | 关掉所有 Spine 编辑器窗口；launcher 会把 CLI 请求交给已打开的编辑器，然后永远不返回 |
| 想要纯文本逐字稿 | `NO_COLOR=1 npm run demo > demo-transcript.txt` |
