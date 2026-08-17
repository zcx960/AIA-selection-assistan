<div align="center">
  <img src="./docs/images/icon-readme-light.svg#gh-light-mode-only" alt="AIA Selection Assistant icon" width="88" />
  <img src="./docs/images/icon-readme-dark.svg#gh-dark-mode-only" alt="AIA Selection Assistant icon" width="88" />

  <h1>AIA Selection Assistant</h1>

  <p>Highlight text, snap a screenshot, ask AI — skip a few window switches, skip a lot of copy-pasting.</p>

  <p>
    <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-2f6fed?style=flat-square" alt="Platform" />
    <img src="https://img.shields.io/badge/Electron-33-3e4a5f?style=flat-square" alt="Electron 33" />
    <img src="https://img.shields.io/badge/React-18-2d9cdb?style=flat-square" alt="React 18" />
    <img src="https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square" alt="TypeScript 5" />
    <img src="https://img.shields.io/badge/API-OpenAI%20%7C%20Anthropic-3a7f52?style=flat-square" alt="API Support" />
    <img src="https://img.shields.io/badge/License-MIT-c9a227?style=flat-square" alt="MIT License" />
  </p>

  <p><strong>English</strong> | <a href="./README.zh.md">中文</a></p>

  <p>
    <a href="https://github.com/zcx960/AIA-selection-assistan/releases/latest"><img src="https://img.shields.io/github/v/release/zcx960/AIA-selection-assistan?style=for-the-badge&label=Latest%20Release&color=2f6fed" alt="Latest release" /></a>
    <a href="https://github.com/zcx960/AIA-selection-assistan/releases"><img src="https://img.shields.io/github/downloads/zcx960/AIA-selection-assistan/total?style=for-the-badge&label=Downloads&color=c9a227" alt="Total downloads" /></a>
  </p>
</div>

AIA Selection Assistant lives in your menu bar / system tray. Highlight some text in any app and a small toolbar slides in next to it — one click to translate, explain, summarize, rewrite, search, copy, or read aloud. Prefer the keyboard? A global shortcut works too. Toolbar actions can be added, renamed, re-iconed, reordered, edited, or deleted; each prompt action can also use its own model template, adjust reasoning intensity, or open a type-in window from its own shortcut.

It also ships a built-in region screenshot tool: drag to select an area, annotate with pen or arrows (brush size is a quick slider away), then save as PNG, copy to clipboard, pin to the desktop, or hand the image straight to AI for vision-based analysis. Pinned screenshots support wheel zoom, drag-to-move, opacity tweaking, and a right-click menu to re-send them to AI.

The result window is its own conversation — keep asking follow-ups, AI sees the earlier turns, and output streams in so you can interrupt any time. Flip on web search when you need fresh information; AI will fetch pages itself and cite the sources at the bottom of the answer.

For models you can point it at either **OpenAI-compatible** endpoints (your own endpoint, OpenAI, DeepSeek, Moonshot, Zhipu, any third-party proxy) or the **Anthropic** API. Multiple templates let you swap endpoint / key / model in one click, and individual actions can bind to a specific template. API keys stay on disk. Light / dark / system theme modes are supported, the UI ships in English and Chinese, and the result window's default size, font family, and font size can be customized.

Currently runs on macOS and Windows.

## Download

Latest published release **v0.6.2** - grab the installer for your platform:

| Platform | Package | Link |
| --- | --- | --- |
| macOS (Apple Silicon) | `.dmg` | [AIA-Selection-Assistant-0.6.2-arm64.dmg](https://github.com/zcx960/AIA-selection-assistan/releases/download/v0.6.2/AIA-Selection-Assistant-0.6.2-arm64.dmg) |
| macOS (Apple Silicon) | `.zip` | [AIA-Selection-Assistant-0.6.2-arm64-mac.zip](https://github.com/zcx960/AIA-selection-assistan/releases/download/v0.6.2/AIA-Selection-Assistant-0.6.2-arm64-mac.zip) |
| Windows x64 | Installer | [AIA-Selection-Assistant-Setup-0.6.2.exe](https://github.com/zcx960/AIA-selection-assistan/releases/download/v0.6.2/AIA-Selection-Assistant-Setup-0.6.2.exe) |
| Windows x64 | Portable | [AIA-Selection-Assistant-Portable-0.6.2.exe](https://github.com/zcx960/AIA-selection-assistan/releases/download/v0.6.2/AIA-Selection-Assistant-Portable-0.6.2.exe) |

### v0.6.2 highlights

- Fixes the floating selection toolbar so it no longer takes focus from the app that owns the selected text, reducing conflicts with mouse gesture and clipboard helper tools

For older versions and full asset lists, see [GitHub Releases](https://github.com/zcx960/AIA-selection-assistan/releases).

> This README describes the current `main` branch. If you download a Release build, use that version's actual binaries as the source of truth.

> The macOS builds are not code-signed — on first launch allow them via *System Settings → Privacy & Security*. Windows builds are not signed either; if SmartScreen complains, choose “Run anyway”.

## Overview

- Electron desktop app for macOS and Windows
- Floating toolbar appears after text selection
- System TTS can read selected text aloud on macOS and Windows
- Built-in region screenshot: pin to desktop, copy, save, or hand it to AI for image understanding
- Standalone AI chat window with multi-turn context and streaming follow-ups
- Multiple API templates, with per-action model template and reasoning intensity
- Custom actions: add, rename, change icons, edit prompts, reorder, and delete
- Per-action input shortcuts: press a shortcut, type text, and run that action directly
- Light, dark, and follow-system theme modes
- Result window supports Markdown rendering, copyable code blocks, and wrapped long lines

## Screenshots

### Everyday Flow

<p>
  <img src="./docs/images/悬浮工具栏.png" alt="Floating Toolbar" width="48%" />
  <img src="./docs/images/结果窗口页.png" alt="Result Window" width="48%" />
</p>

### API and Action Setup

<p>
  <img src="./docs/images/api配置页.png" alt="API Settings" width="48%" />
  <img src="./docs/images/动作配置页.png" alt="Action Settings" width="48%" />
</p>

### Selection and Window Settings

<p>
  <img src="./docs/images/划词配置页.png" alt="Selection Settings" width="48%" />
  <img src="./docs/images/窗口配置页.png" alt="Window Settings" width="48%" />
</p>

## Features

- Shows a floating toolbar right after text selection
- Built-in actions for translate, explain, summarize, polish, search, copy, and read-aloud, plus your own custom actions
- Supports multiple API templates for quick provider/model switching
- Each prompt action can choose its own API template and independently set reasoning intensity
- Each action can have an input shortcut, so it can run without a prior text selection
- Toolbar can run in compact mode and can hide the app icon
- Closing the app minimizes it to the menu bar or system tray instead of quitting

### Screenshot

- Trigger region capture via a global shortcut and drag to select an area
- After capture: send to AI, copy to clipboard, save as PNG, or pin to the desktop
- Pinned images support wheel zoom, drag-to-move, and a right-click menu for opacity / reset / close
- The pin's right-click menu can also send the image straight into the AI image-understanding chat

### AI Chat and Follow-up

- Dedicated chat window, decoupled from the toolbar's one-shot result popup
- Multi-turn context: keep asking follow-ups and the model sees the previous turns
- Streaming output, rendered as it arrives, with interrupt support at any time
- Markdown code blocks include a copy button and wrap long lines
- The window can be pinned on top; closing it destroys the session so context never leaks

## Platform Notes

### macOS

- Accessibility permission is required for system-level text selection detection
- Closing the main window minimizes the app to the menu bar
- On first launch, it is worth testing text selection and popup behavior manually

### Windows

- Supports staying resident in the system tray
- Closing the main window minimizes it to the tray instead of quitting
- Selection behavior can vary depending on the target app, elevation level, or IME state

## Installation and Local Development

### Prerequisites

- Node.js 20+ recommended
- `pnpm` 10+
- Use macOS or Windows if you want to test the full runtime behavior

### Install

```bash
pnpm install
```

### Development

```bash
pnpm dev
```

### Test

```bash
pnpm test
pnpm typecheck
```

### Build

```bash
pnpm build
```

## Packaging

```bash
pnpm dist:mac
pnpm dist:win
```

Notes:

- Build artifacts should not be committed to the repository
- If you want to distribute binaries, GitHub Releases is the recommended path

## Configuration

### API Support

- OpenAI-compatible: uses `/chat/completions` and `/models`
- For OpenAI-compatible providers, enter the API root when possible, such as `https://api.example.com/v1`; if you paste a full `/chat/completions` or `/models` endpoint, the app normalizes it automatically
- Anthropic: uses `/v1/messages` and `/v1/models`
- In Anthropic mode, you only need to enter the base URL; `/v1` is appended automatically

### API Templates

- Add, rename, and delete multiple API templates
- Each template stores API type, base URL, API key, and model
- Templates can fetch available models, test the configured model, and be marked as default
- Actions can follow the default template or bind to a specific template

### Action Configuration

- Built-in actions can be edited, disabled, and reordered; custom actions can also be deleted
- Prompt actions support custom prompts, icons, provider templates, and reasoning intensity
- Search actions support custom search URL templates
- The read-aloud action uses system TTS, and the tray menu can stop current speech
- Action shortcuts open a type-in window, then run the selected action once against that input

### Theme and UI

- Light, dark, and follow-system modes
- Compact toolbar mode is supported
- The app icon in the floating toolbar can be hidden
- The result window supports custom default width, height, font family, and font size
- Packaged builds support launch-at-login; login launches start hidden in the menu bar / tray
- The settings window is organized into API, Selection, Window, and Actions sections

## Privacy

- Selected text is only sent to the configured provider when you explicitly trigger an AI action
- API keys are stored locally through Electron Store
- This repository should not contain your local settings, dependencies, or build artifacts

## Known Limitations

- System-level selection depends on the third-party `selection-hook` package, so behavior can vary across apps
- Linux is not a first-class supported platform yet
- Selection position and follow-window behavior may differ in some apps or IME environments
- The current provider layer supports OpenAI-compatible and Anthropic APIs only

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before contributing.

## 🙏 Acknowledgments

- [LINUX DO](https://linux.do/) — Community support and inspiration

## Security

If you discover a security issue, please do not open a public issue first. See [SECURITY.md](./SECURITY.md).

## License

This project is released under the [MIT License](./LICENSE).
