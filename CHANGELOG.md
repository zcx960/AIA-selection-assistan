# Changelog

## 0.7.0 - 2026-08-30

### Added

- AI 回复时实时显示思维链：思考过程中展示模型推理内容的最新片段，自动换行并在约三行高度的窗口内垂直滚动、始终钉在最新内容底部，结束后折叠为"思考了 Xs"摘要。
- 支持 OpenAI-compatible API 的 `reasoning_content` / `reasoning` / `thinking` 流式字段，以及 Anthropic 的 `thinking_delta` 事件。
- AI 对话、划词动作结果窗口和 AI 识图窗口均生效；模型不输出思维链时自动退化为原有的"正在思考"提示。

### Fixed

- 修复思维链流式解析在部分供应商返回不完整 JSON 分片时可能导致整块流中断的问题。

## 0.6.2 - 2026-07-05

### Fixed

- 修复划词悬浮工具栏在显示时可能抢占原应用文本焦点的问题，降低与鼠标手势、剪贴板增强等工具的冲突概率。

## 0.6.1 - 2026-06-16

### Fixed

- 修复设置页服务名称输入中文时被异步设置刷新打断，导致 IME 组合输入异常的问题。
- 修复服务名称清空后会自动恢复为 `Template 1`，导致默认名称首字母无法删除的问题。
- 修复 Windows 便携版中模型列表获取、模型测活和翻译请求可能因 Node `fetch` 未走 Electron 网络栈而报 `fetch failed` 的问题。
- 兼容 OpenAI-compatible 配置中粘贴完整 `/chat/completions` 或 `/models` endpoint 的常见用法。

### Tests

- 增加服务名称清空、OpenAI-compatible URL 规范化、供应商请求 fetcher 注入和 Web Search 预判请求的回归测试。
