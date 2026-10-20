<div align="center">
  <img src="./docs/images/icon-readme-light.svg#gh-light-mode-only" alt="AIA划词助手图标" width="88" />
  <img src="./docs/images/icon-readme-dark.svg#gh-dark-mode-only" alt="AIA划词助手图标" width="88" />

  <h1>AIA划词助手</h1>

  <p>划词、截图、问 AI——少切几次窗口，多省几次复制粘贴。</p>

  <p>
    <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-2f6fed?style=flat-square" alt="Platform" />
    <img src="https://img.shields.io/badge/Electron-33-3e4a5f?style=flat-square" alt="Electron 33" />
    <img src="https://img.shields.io/badge/React-18-2d9cdb?style=flat-square" alt="React 18" />
    <img src="https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square" alt="TypeScript 5" />
    <img src="https://img.shields.io/badge/API-OpenAI%20%7C%20Anthropic-3a7f52?style=flat-square" alt="API Support" />
    <img src="https://img.shields.io/badge/License-MIT-c9a227?style=flat-square" alt="MIT License" />
  </p>

  <p><a href="./README.en.md">English</a> | <strong>中文</strong></p>

  <p>
    <a href="https://github.com/zcx960/AIA-selection-assistan/releases/latest"><img src="https://img.shields.io/github/v/release/zcx960/AIA-selection-assistan?style=for-the-badge&label=Latest%20Release&color=2f6fed" alt="Latest release" /></a>
    <a href="https://github.com/zcx960/AIA-selection-assistan/releases"><img src="https://img.shields.io/github/downloads/zcx960/AIA-selection-assistan/total?style=for-the-badge&label=Downloads&color=c9a227" alt="Total downloads" /></a>
  </p>
</div>

AIA划词助手是一个常驻菜单栏 / 系统托盘的小工具。在任意应用里选中一段文字，旁边会浮出一条工具栏，点一下就能翻译、解释、总结、润色、搜索、复制或朗读；不想用工具栏，也可以走全局快捷键。工具栏动作可以新增、重命名、换图标、改提示词、排序或删除，也能给某个动作单独绑定模型、调整思考强度，或者配置快捷键后先弹出输入框再执行。润色这类要改写原文的动作，结果窗上还会多一个「替换」按钮——点一下就把 AI 的结果写回原应用里被选中的位置，不用再复制粘贴（目前限 Windows x64 的润色动作）。

除了划词，它还内置区域截图：拖拽框选一块屏幕，可以画线、画箭头标注，笔刷粗细随手拉滑杆调整。截完可以保存 PNG、复制到剪贴板、钉在桌面，或者直接交给 AI 识图。钉住的截图能滚轮缩放、拖拽搬位置、调整透明度，右键还能再次唤起 AI 识图。

返回窗口本身就是个独立对话——回答完了可以接着追问，AI 看得到之前的上下文；也能把划词内容作为引用带进对话，或者直接把图片发出去，图片会保留在会话历史里，追问时依然看得到。输出是流式的，可以随时打断。思考型模型回复时，思维链会实时显示：推理内容自动换行，在几行高的窗口里滚动展示最新进展，结束后折叠成「思考了 Xs」的摘要，不占正文篇幅。需要查实时信息时打开联网搜索，AI 会自己抓网页，并在回答里附上来源链接。

模型这边可接 **OpenAI-compatible**（自建 endpoint、OpenAI、DeepSeek、月之暗面、智谱、各类第三方代理都行）或 **Anthropic** 官方 API。多套模板可一键切换 endpoint / Key / 模型，每个动作也可以指定自己的模板；API Key 只存在本地。界面支持亮 / 暗 / 跟随系统主题，中英双语都有，结果窗口的默认尺寸、字体和字号也可以在设置里调整。

目前支持 macOS 与 Windows。

## 下载

最新发布版本 **v0.8.2**，可点击直接下载对应平台的安装包：

| 平台 | 包类型 | 下载 |
| --- | --- | --- |
| macOS (Apple Silicon) | `.dmg` | [AIA-Selection-Assistant-0.8.2-arm64.dmg](https://github.com/zcx960/AIA-selection-assistan/releases/download/v0.8.2/AIA-Selection-Assistant-0.8.2-arm64.dmg) |
| macOS (Apple Silicon) | `.zip` | [AIA-Selection-Assistant-0.8.2-arm64-mac.zip](https://github.com/zcx960/AIA-selection-assistan/releases/download/v0.8.2/AIA-Selection-Assistant-0.8.2-arm64-mac.zip) |
| Windows x64 | 安装版 | [AIA-Selection-Assistant-Setup-0.8.2.exe](https://github.com/zcx960/AIA-selection-assistan/releases/download/v0.8.2/AIA-Selection-Assistant-Setup-0.8.2.exe) |
| Windows x64 | 便携版 | [AIA-Selection-Assistant-Portable-0.8.2.exe](https://github.com/zcx960/AIA-selection-assistan/releases/download/v0.8.2/AIA-Selection-Assistant-Portable-0.8.2.exe) |

### v0.8.2 更新

- 修复 Windows **便携版开机自启指向临时解压目录**导致的启动失败（#9）：便携版每次运行都会把自己解压到 `%TEMP%\<随机目录>`，而自启项原先跟着 `process.execPath` 写成了这个临时路径；临时目录被系统清理后，下次登录启动到的是一份残缺副本，主进程在 ESM 解析 `package.json` 阶段就抛 `ENOENT`，连窗口都起不来。现在自启项指向你双击的那个 `.exe`，旧版本写坏的注册表项会在新版本启动时自动覆写
- 打包流程加入原生模块完整性校验：`selection-hook` / `uiohook-napi` 的 `package.json`、JS 入口或目标平台的 `.node` 若没正确落到 `app.asar.unpacked`，构建直接失败，避免问题包出厂

v0.8.1 的主要更新（Windows 图标四角白块修复）见 [CHANGELOG](./CHANGELOG.md)。

历史版本与全部产物：[GitHub Releases](https://github.com/zcx960/AIA-selection-assistan/releases)。

> Windows 便携版每次运行都会把自己解压到系统临时目录（`%TEMP%`）。它现在会把开机自启项指向你双击的那个 `.exe`，而不是临时解压目录，但便携版仍然不适合长期挂开机自启：临时目录被系统清理后需要重新运行一次 `.exe` 才能恢复。想让它在登录时稳定自启，请用安装版。

> README 描述的是当前 `main` 分支能力；若直接下载 Release，请以对应版本的产物为准。

> macOS 包未做代码签名，首次打开请到「系统设置 → 隐私与安全性」放行。
>
> Windows 包同样未做代码签名：SmartScreen 提示时选「仍要运行」即可。如果系统开启了**智能应用控制（Smart App Control）**，安装包可能会被直接拦下 —— 该功能不支持给单个应用加白名单，只能在「Windows 安全中心 → 应用和浏览器控制 → 智能应用控制设置」里整体关闭。注意较早的 Windows 11 版本关闭后无法自行恢复（需重置系统），24H2 / 25H2 在 2026 年 4 月更新（KB5083769）之后才可以随时开关。

## 项目概览

- 适用于 macOS 和 Windows 的 Electron 桌面应用
- 选中文本后弹出悬浮工具栏，直接触发常用动作
- 支持系统 TTS 朗读选中文本，macOS 与 Windows 均可用
- 内置区域截图，可直接钉图、复制、保存或交给 AI 识图
- 独立 AI 对话窗口，支持多轮上下文与流式追问
- 划词内容可作为引用带入对话，对话支持发图并保留图片上下文
- 润色结果可一键「替换」回原应用被选中的位置（Windows x64，仅润色动作）
- AI 回复时实时显示思维链，结束后折叠为思考耗时摘要
- 支持多套 API 模板，并可按动作指定模型与思考强度
- 支持自定义动作：新增、重命名、换图标、编辑提示词、排序、删除
- 支持动作输入快捷键：按快捷键弹出输入框，输入文本后直接运行指定动作
- 支持亮色、暗色、跟随系统三种主题
- 结果窗口支持 Markdown 渲染，代码块可复制，长行自动换行

## 截图

### 交互体验

<p>
  <img src="./docs/images/悬浮工具栏.png" alt="悬浮工具栏" width="48%" />
  <img src="./docs/images/结果窗口页.png" alt="结果窗口" width="48%" />
</p>

### API 与动作配置

<p>
  <img src="./docs/images/api配置页.png" alt="API 配置页" width="48%" />
  <img src="./docs/images/动作配置页.png" alt="动作配置页" width="48%" />
</p>

### 划词与窗口设置

<p>
  <img src="./docs/images/划词配置页.png" alt="划词配置页" width="48%" />
  <img src="./docs/images/窗口配置页.png" alt="窗口配置页" width="48%" />
</p>

## 功能特性

- 选中文本后直接弹出悬浮工具栏
- 内置翻译、解释、总结、润色、搜索、复制、朗读等动作，也可添加自己的动作
- 润色结果可一键替换回原应用被选中的位置，免去复制粘贴（Windows x64，仅润色动作）
- 支持多个 API 模板，切换模型和服务商更方便
- 每个提示词动作可单独选择 API 模板，并独立设置思考强度
- 每个动作可配置输入快捷键，不需要先选中文本也能快速运行
- Windows 下 Ctrl+A 全选也能唤出工具栏（默认开启）
- 工具栏可切换紧凑模式，也能隐藏 app 图标
- 应用关闭后最小化到状态栏或系统托盘，不会直接退出

### 替换回填（Windows x64）

- 只对会改写原文的动作有意义，目前接在**润色**动作上
- 结果窗上的「替换」按钮会把结果写回原应用中被选中的位置：结果先写剪贴板 → 焦点回到来源窗口 → 复核选区是否仍是原来那段 → 合成 Ctrl+V
- 复核不通过（来源窗口变了、选区变了或拿不到窗口句柄）时不会盲贴，降级为「已复制，请手动粘贴」
- 拿不到来源应用名或窗口句柄时按钮直接禁用，悬浮提示会说明原因
- 翻译等其他动作、以及 macOS 尚未覆盖

### 截图

- 全局快捷键唤起截图，鼠标拖拽框选区域即可
- 截完可选：AI 识图、复制到剪贴板、保存为 PNG，或钉在桌面
- 钉住的图片支持滚轮缩放、拖拽移动、右键菜单调整透明度 / 重置 / 关闭
- 钉图右键也能直接「AI 识图」，把图片送进识图对话

### AI 对话与追问

- 独立的对话窗口，与悬浮工具栏的单次结果窗解耦
- 支持多轮上下文：问完一题后可以接着追问，AI 能看到之前的对话
- 划词内容可以作为引用带进对话窗，支持预选面板与标记选择器，面板占固定槽位、布局不跳动
- 支持发图：图片随会话历史保留，后续追问时模型仍能看到之前的图
- 流式输出，回答边生成边显示，可随时中断
- 流被新请求覆盖、或所在窗口被销毁时，可选择中止还是继续跑完
- 思考型模型的思维链实时可见：最新推理内容自动换行滚动，开始回答后折叠为「思考了 Xs」
- Markdown 代码块支持一键复制，长代码行会自动换行
- 窗口支持「钉住」常驻；关闭窗口即销毁会话，避免上下文意外保留

## 平台与权限说明

### macOS

- 需要授予辅助功能权限，应用才能检测系统级划词
- 关闭主窗口后会缩到顶部状态栏
- 首次使用建议手动测试一下划词唤起和窗口显示效果

### Windows

- 支持系统托盘驻留
- 关闭主窗口后会缩到托盘，不会直接退出
- 划词监听效果可能会受目标应用、管理员权限或输入法状态影响
- 安装包未做代码签名：SmartScreen 提示时选「仍要运行」；若系统启用了智能应用控制（Smart App Control），需要先整体关闭它才能安装（详见上文「下载」小节）

## 安装与本地开发

### 前置要求

- 推荐 Node.js 20+
- `pnpm` 10+
- 想完整验证功能，建议直接在 macOS 或 Windows 上运行

### 安装依赖

```bash
pnpm install
```

### 开发模式

```bash
pnpm dev
```

### 测试

```bash
pnpm test
pnpm typecheck
```

### 构建

```bash
pnpm build
```

## 打包命令

```bash
pnpm dist:mac
pnpm dist:win
```

说明：

- 打包产物不会提交到 git 仓库
- 如果要给别人分发安装包，建议通过 GitHub Releases 发布

## 配置说明

### API 支持

- OpenAI-compatible：使用 `/chat/completions` 与 `/models`
- OpenAI-compatible 的 Base URL 建议填到 API 根路径（例如 `https://api.example.com/v1`）；如果粘贴了完整 `/chat/completions` 或 `/models` endpoint，应用会自动归一化
- Anthropic：使用 `/v1/messages` 与 `/v1/models`
- Anthropic 模式下，Base URL 只需要填基础地址，不用手动补 `/v1`

### API 模板

- 可新增、重命名、删除多个 API 模板
- 每个模板会保存 API 类型、Base URL、API Key 和模型名
- 模板支持获取模型列表、模型测活，并可设为默认模板
- 动作可以跟随默认模板，也可以指定某个模板单独运行

### 动作配置

- 内置动作可编辑、停用、排序；自定义动作还可以删除
- 提示词动作支持自定义提示词、图标、模型模板和思考强度
- 搜索动作支持自定义搜索 URL 模板
- 朗读动作使用系统 TTS，托盘菜单可停止当前朗读
- 动作快捷键会打开输入窗口，输入文本后用对应动作一次性运行

### 主题与界面

- 支持亮色、暗色、跟随系统
- 工具栏支持紧凑模式
- 工具栏可控制是否显示 app 图标
- 结果窗口支持设置默认宽高、字体名称和字号
- 发送键可配置为 Enter / Ctrl+Enter / Shift+Enter（默认纯 Enter）
- 可选预建动作窗，降低首次触发延迟（默认开启）
- 可选上下文注入（默认关闭）：开启后才会在请求里附加来源应用、本地时间与时区
- 可选本地使用统计（默认关闭）
- 全局热键与动作快捷键重复时会拒绝保存并就地提示
- 安装版支持开机自启；登录启动时会静默驻留到状态栏 / 托盘
- 设置页分成 API 配置、划词、窗口、动作 四个分区

## 隐私说明

- 只有你主动触发 AI 动作时，选中的文本才会发送到你配置的 API 服务
- API Key 存储在本地 Electron Store 配置中
- **本地使用统计默认关闭**。开启后，每次完成或中止的 AI 动作会向本机 `userData/stats.jsonl` 追加一条 JSONL 记录（含该次请求的原文与回答；流被中止时保存已生成的部分）。该文件不上传，也不会被读回用于 AI 请求；选中文本本身仍随正常 AI 请求发送
- **上下文注入默认关闭**。关闭时不向 system prompt 追加任何元信息；开启后才附加来源应用、本地时间与时区三项，隐私档可以只去掉来源应用名
- 仓库里不会包含你的本地配置、依赖目录或打包产物

## 已知限制

- 系统级划词能力依赖第三方 `selection-hook`，项目内置了它的 fork（`third_party/selection-hook`），不再跟随上游自动更新；不同应用里的稳定性会有差异
- 替换回填目前仅 Windows x64，且只覆盖润色动作
- Linux 目前还不是正式支持平台
- 某些输入法或特殊应用环境下，划词位置和窗口跟随效果可能不完全一致
- 目前只支持 OpenAI-compatible 和 Anthropic 两类接口

## 贡献

欢迎提 issue 或 pull request。开始之前建议先看一下 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 🙏 Acknowledgments

- [LINUX DO](https://linux.do/) — Community support and inspiration

## 安全

如果你发现安全问题，请不要直接公开提 issue，先阅读 [SECURITY.md](./SECURITY.md)。

## 许可证

本项目基于 [MIT License](./LICENSE) 开源。
