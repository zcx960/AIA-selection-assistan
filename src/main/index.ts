import { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, net, shell } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildAssistantSystemPrompt, resolveProvider } from '@shared/actions'
import { IPC } from '@shared/ipc'
import { APP_ICON_DATA_URL, APP_TRAY_DATA_URL } from '@shared/brand'
import type { AiStreamRequest, SettingsPatch } from '@shared/types'
import { listModels, streamChatMessages, testModel, type ProviderFetch } from './ai/OpenAICompatibleClient'
import { decideSearch, formatSearchContext, searchExa } from './ai/WebSearch'
import { ScreenshotService } from './ScreenshotService'
import { SelectionService } from './SelectionService'
import { SpeechService } from './SpeechService'
import { getSettings, onSettingsChanged, updateSettings } from './settingsStore'
import { isSupportedPlatform, isWin } from './platform'

const __dirname = dirname(fileURLToPath(import.meta.url))
const preloadPath = join(__dirname, '../preload/index.mjs')
const rendererDir = join(__dirname, '../renderer')

if (isWin) app.commandLine.appendSwitch('wm-window-animations-disabled')

let settingsWindow: BrowserWindow | null = null
let chatWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
const CHAT_SHADOW_PADDING = 18
const CHAT_DEFAULT_WIDTH = 440
const CHAT_DEFAULT_HEIGHT = 580
const abortControllers = new Map<string, AbortController>()
const providerFetch: ProviderFetch = (url, init) => net.fetch(url, init)

function createNativeImageFromFile(paths: string[], fallbackDataUrl: string): Electron.NativeImage {
  for (const path of paths) {
    if (!existsSync(path)) continue
    const image = nativeImage.createFromPath(path)
    if (!image.isEmpty()) return image
  }
  return nativeImage.createFromDataURL(fallbackDataUrl)
}

const appIcon = createNativeImageFromFile(
  app.isPackaged
    ? [join(process.resourcesPath, 'build', 'icon.png')]
    : [join(__dirname, '../../build/icon.png'), join(process.cwd(), 'build', 'icon.png')],
  APP_ICON_DATA_URL
)
const trayIcon = createNativeImageFromFile(
  app.isPackaged
    ? [join(process.resourcesPath, 'build', 'icon.png')]
    : [join(__dirname, '../../build/icon.png'), join(process.cwd(), 'build', 'icon.png')],
  APP_TRAY_DATA_URL
)
const selectionService = new SelectionService(getSettings, preloadPath, rendererDir, appIcon)
const screenshotService = new ScreenshotService(getSettings, preloadPath, rendererDir, appIcon)
const speechService = new SpeechService()

function getTrayIcon(): Electron.NativeImage {
  return trayIcon.resize({ width: 18, height: 18 })
}

function mainText(key: 'enable' | 'disable' | 'settings' | 'stopSpeech' | 'quit', language: string): string {
  const zh = {
    enable: '启用AIA划词助手',
    disable: '停用AIA划词助手',
    settings: '设置',
    stopSpeech: '停止朗读',
    quit: '退出'
  }
  const en = {
    enable: 'Enable AIA Selection Assistant',
    disable: 'Disable AIA Selection Assistant',
    settings: 'Settings',
    stopSpeech: 'Stop speaking',
    quit: 'Quit'
  }
  return (language === 'zh-CN' ? zh : en)[key]
}

function loadRenderer(win: BrowserWindow, page: string): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${page}`)
  } else {
    void win.loadFile(join(rendererDir, page))
  }
}

function createSettingsWindow(): BrowserWindow {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    app.dock?.show()
    settingsWindow.show()
    settingsWindow.focus()
    return settingsWindow
  }

  settingsWindow = new BrowserWindow({
    width: 420,
    height: 680,
    minWidth: 380,
    minHeight: 560,
    icon: appIcon,
    title: 'AIA划词助手',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  settingsWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    settingsWindow?.hide()
    app.dock?.hide()
  })
  settingsWindow.on('show', () => app.dock?.show())
  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
  loadRenderer(settingsWindow, 'settings.html')
  return settingsWindow
}

function openChatWindow(): void {
  if (chatWindow && !chatWindow.isDestroyed()) {
    if (chatWindow.isMinimized()) chatWindow.restore()
    chatWindow.show()
    chatWindow.focus()
    return
  }
  chatWindow = new BrowserWindow({
    width: CHAT_DEFAULT_WIDTH + CHAT_SHADOW_PADDING * 2,
    height: CHAT_DEFAULT_HEIGHT + CHAT_SHADOW_PADDING * 2,
    minWidth: 360 + CHAT_SHADOW_PADDING * 2,
    minHeight: 360 + CHAT_SHADOW_PADDING * 2,
    icon: appIcon,
    title: 'AIA划词助手',
    autoHideMenuBar: true,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: CHAT_SHADOW_PADDING + 12, y: CHAT_SHADOW_PADDING + 10 },
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  const win = chatWindow
  win.on('closed', () => {
    if (chatWindow === win) chatWindow = null
  })
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })
  loadRenderer(win, 'chat.html')
}

function createTray(): void {
  tray = new Tray(getTrayIcon())
  tray.setToolTip('AIA划词助手')
  tray.on('click', () => createSettingsWindow())
  refreshTrayMenu()
}

function refreshTrayMenu(): void {
  if (!tray) return
  const settings = getSettings()
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: settings.enabled ? mainText('disable', settings.language) : mainText('enable', settings.language),
        enabled: isSupportedPlatform && selectionService.isAvailable,
        click: () => {
          const next = updateSettings({ enabled: !getSettings().enabled })
          applySelectionState(next)
        }
      },
      { label: mainText('settings', settings.language), click: () => createSettingsWindow() },
      { label: mainText('stopSpeech', settings.language), click: () => speechService.stop() },
      { type: 'separator' },
      {
        label: mainText('quit', settings.language),
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
}

function registerShortcuts(): void {
  const settings = getSettings()
  globalShortcut.unregisterAll()
  const shortcuts = [
    {
      accelerator: settings.shortcuts.toggleAssistant,
      action: () => {
        const next = updateSettings({ enabled: !getSettings().enabled })
        applySelectionState(next)
      }
    },
    {
      accelerator: settings.shortcuts.processSelection,
      action: () => {
        selectionService.processShortcutSelection()
      }
    },
    {
      accelerator: settings.shortcuts.captureScreen,
      action: () => {
        void screenshotService.startCapture()
      }
    },
    {
      accelerator: settings.shortcuts.chat,
      action: () => {
        openChatWindow()
      }
    }
  ]

  // Per-action type-in shortcuts: open a typed-input window for that action.
  for (const action of settings.actions) {
    const accelerator = action.shortcut?.trim()
    if (accelerator) shortcuts.push({ accelerator, action: () => selectionService.openActionInput(action) })
  }

  for (const shortcut of shortcuts) {
    const accelerator = shortcut.accelerator?.trim()
    if (!accelerator) continue
    const registered = globalShortcut.register(accelerator, shortcut.action)
    if (registered) {
      console.log(`[shortcut] registered: ${accelerator}`)
    } else {
      console.warn(`[shortcut] FAILED to register: ${accelerator} (likely taken by another app)`)
    }
  }
}

// Register (or clear) the OS login item. We only touch it in a packaged build —
// registering the dev electron.exe path into the user's startup would be wrong.
// '--hidden' is what tells a login-triggered launch to stay in the tray.
function applyAutoLaunch(enabled: boolean): void {
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: enabled, args: ['--hidden'] })
}

function wasStartedHidden(): boolean {
  if (process.argv.includes('--hidden')) return true
  try {
    return app.getLoginItemSettings().wasOpenedAtLogin
  } catch {
    return false
  }
}

function applySelectionState(settings = getSettings()): void {
  if (!isSupportedPlatform || !selectionService.isAvailable) return
  if (settings.enabled && !selectionService.isRunning) {
    selectionService.start()
  } else if (!settings.enabled && selectionService.isRunning) {
    selectionService.stop()
  } else if (selectionService.isRunning) {
    selectionService.applySettings(settings)
  }
  refreshTrayMenu()
}

function registerIpc(): void {
  selectionService.registerIpc()
  screenshotService.registerIpc()

  ipcMain.handle(IPC.SettingsGet, () => getSettings())
  ipcMain.handle(IPC.SettingsUpdate, (_event, patch: SettingsPatch) => {
    const settings = updateSettings(patch)
    registerShortcuts()
    applySelectionState(settings)
    applyAutoLaunch(settings.autoLaunch)
    return settings
  })
  ipcMain.handle(IPC.OpenExternal, (_event, url: string) => shell.openExternal(url))
  ipcMain.handle(IPC.SpeechSpeak, (_event, text: string) => speechService.speak(text))
  ipcMain.handle(IPC.SpeechStop, () => speechService.stop())

  ipcMain.handle(IPC.AiStream, async (event, request: AiStreamRequest) => {
    const controller = new AbortController()
    const settings = getSettings()
    abortControllers.set(request.requestId, controller)
    try {
      const messages = request.messages?.length
        ? request.messages
        : [{ role: 'user' as const, text: request.prompt ?? '' }]
      let systemPrompt = request.systemPrompt ?? buildAssistantSystemPrompt(settings)
      const provider = resolveProvider(settings, request.providerTemplateId)

      // Optional: web search pre-flight. Let the model decide; if yes, query Exa
      // (via its public hosted MCP — no key required) and inject the results
      // into the system prompt before the main stream.
      if (settings.webSearchEnabled) {
        const lastUser = [...messages].reverse().find((m) => m.role === 'user')
        const userText = lastUser?.text?.trim() ?? ''
        if (userText) {
          try {
            const decision = await decideSearch(
              provider,
              userText,
              settings.language,
              controller.signal,
              { fetcher: providerFetch }
            )
            if (decision.needsSearch && decision.query) {
              event.sender.send(IPC.AiChunk, {
                requestId: request.requestId,
                type: 'status',
                text: decision.query
              })
              const results = await searchExa(decision.query, controller.signal)
              const context = formatSearchContext(decision.query, results, settings.language)
              if (context) systemPrompt = `${systemPrompt}\n\n${context}`
            }
          } catch (error) {
            if (controller.signal.aborted) throw error
            console.warn('[web-search] skipped:', error instanceof Error ? error.message : error)
          }
        }
      }

      await streamChatMessages(
        provider,
        messages,
        systemPrompt,
        controller.signal,
        (delta) => {
          if (delta.content) {
            event.sender.send(IPC.AiChunk, { requestId: request.requestId, type: 'delta', text: delta.content })
          }
          if (delta.reasoning) {
            event.sender.send(IPC.AiChunk, { requestId: request.requestId, type: 'reasoning', reasoning: delta.reasoning })
          }
        },
        request.reasoning ?? 'on',
        { fetcher: providerFetch }
      )
      event.sender.send(IPC.AiChunk, { requestId: request.requestId, type: 'done' })
    } catch (error) {
      if (controller.signal.aborted) {
        event.sender.send(IPC.AiChunk, { requestId: request.requestId, type: 'done' })
      } else {
        event.sender.send(IPC.AiChunk, {
          requestId: request.requestId,
          type: 'error',
          error: error instanceof Error ? error.message : String(error)
        })
      }
    } finally {
      abortControllers.delete(request.requestId)
    }
  })

  ipcMain.handle(IPC.AiAbort, (_event, requestId: string) => {
    abortControllers.get(requestId)?.abort()
    abortControllers.delete(requestId)
  })
  ipcMain.handle(IPC.AiListModels, (_event, providerTemplateId?: string) =>
    listModels(resolveProvider(getSettings(), providerTemplateId), { fetcher: providerFetch })
  )
  ipcMain.handle(IPC.AiTestModel, async (_event, providerTemplateId?: string) => {
    await testModel(resolveProvider(getSettings(), providerTemplateId), { fetcher: providerFetch })
    return { ok: true }
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.selectionassistant.lite')
    app.dock?.setIcon(appIcon)
    app.on('browser-window-created', (_event, window) => optimizer.watchWindowShortcuts(window))

    registerIpc()
    createTray()
    registerShortcuts()
    applySelectionState()
    applyAutoLaunch(getSettings().autoLaunch)

    onSettingsChanged((settings) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(IPC.SettingsChanged, settings)
      }
      refreshTrayMenu()
    })

    // A login-triggered launch (or any '--hidden' start) stays in the tray.
    if (!wasStartedHidden()) createSettingsWindow()
  })

  app.on('second-instance', () => createSettingsWindow())
  app.on('activate', () => createSettingsWindow())
  app.on('will-quit', () => {
    isQuitting = true
    globalShortcut.unregisterAll()
    selectionService.dispose()
    screenshotService.dispose()
    speechService.dispose()
  })
}
