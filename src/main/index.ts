import { app, BrowserWindow, Menu, Tray, clipboard, globalShortcut, ipcMain, nativeImage, net, shell } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildAssistantSystemPrompt, buildContextInjectionPrompt, resolveProvider } from '@shared/actions'
import { buildStructuredOutputPrompt } from '@shared/structuredOutput'
import { IPC } from '@shared/ipc'
import { APP_ICON_DATA_URL, APP_TRAY_DATA_URL } from '@shared/brand'
import type { AiChunkPayload, AiStreamRequest, SettingsPatch } from '@shared/types'
import { listModels, streamChatMessages, testModel, type ProviderFetch } from './ai/OpenAICompatibleClient'
import { decideSearch, formatSearchContext, searchExa } from './ai/WebSearch'
import { abortStream, findRacingStreams, registerStream, unregisterStream } from './aiStreamRegistry'
import { appendStatsRecord, type StatsRecord } from './statsStore'
import { startHotkeyCapture, stopHotkeyCapture } from './hotkeyCapture'
import { ScreenshotService } from './ScreenshotService'
import { SelectionService } from './SelectionService'
import { SpeechService } from './SpeechService'
import { getSettings, onSettingsChanged, updateSettings } from './settingsStore'
import { clearPreWindows, getLastSelection, listPreWindows, removePreWindow, savePreWindow } from './preWindowStore'
import { loadRenderer } from './loadRenderer'
import { isSupportedPlatform, isWin } from './platform'

const __dirname = dirname(fileURLToPath(import.meta.url))
const preloadPath = join(__dirname, '../preload/index.mjs')
const rendererDir = join(__dirname, '../renderer')

if (isWin) app.commandLine.appendSwitch('wm-window-animations-disabled')

let settingsWindow: BrowserWindow | null = null
let chatWindow: ChatWindow | null = null
let tray: Tray | null = null
let isQuitting = false
// Where the chat window was opened from: only the toolbar button carries
// the attached selection as context; hotkey and tray open it clean. The
// source rides the window instance (never a module-level variable) so the
// answer to LastSelectionGet always belongs to THIS window's open, not to
// whichever open happened to run last.
type ChatOpenSource = 'hotkey' | 'tray' | 'toolbar'
interface ChatWindow extends BrowserWindow {
  chatOpenSource: ChatOpenSource
}
const CHAT_SHADOW_PADDING = 18
const CHAT_DEFAULT_WIDTH = 440
const CHAT_DEFAULT_HEIGHT = 580
const providerFetch: ProviderFetch = (url, init) => net.fetch(url, init)

function createNativeImageFromFile(paths: string[], fallbackDataUrl: string): Electron.NativeImage {
  for (const path of paths) {
    if (!existsSync(path)) continue
    const image = nativeImage.createFromPath(path)
    if (!image.isEmpty()) return image
  }
  return nativeImage.createFromDataURL(fallbackDataUrl)
}

// Windows draws the window / taskbar icon straight from the bitmap, with no
// corner mask of its own. The shared artwork is a rounded square, so its four
// corners are transparent and the shell fills them in as white wedges. The
// `icon-win` variants are the same artwork flattened onto its own background —
// a full-bleed opaque square. macOS and the tray keep the transparent version,
// since both honour alpha and the rounding reads better there.
const windowIconFiles =
  process.platform === 'win32' ? ['icon-win.png', 'icon.png'] : ['icon.png']

const appIcon = createNativeImageFromFile(
  app.isPackaged
    ? windowIconFiles.map((file) => join(process.resourcesPath, 'build', file))
    : [
        ...windowIconFiles.map((file) => join(__dirname, '../../build', file)),
        ...windowIconFiles.map((file) => join(process.cwd(), 'build', file))
      ],
  APP_ICON_DATA_URL
)
const trayIcon = createNativeImageFromFile(
  app.isPackaged
    ? [join(process.resourcesPath, 'build', 'icon.png')]
    : [join(__dirname, '../../build/icon.png'), join(process.cwd(), 'build', 'icon.png')],
  APP_TRAY_DATA_URL
)
const selectionService = new SelectionService(getSettings, preloadPath, rendererDir, appIcon, (title, message) => {
  // Tray balloon = the packaged-build failure channel (same pattern as failed
  // shortcut registration below). No-op when the tray isn't up yet — dev
  // sees console.error from the service either way.
  if (tray && isWin) tray.displayBalloon({ title, content: message })
})
const screenshotService = new ScreenshotService(getSettings, preloadPath, rendererDir, appIcon)
const speechService = new SpeechService()

function getTrayIcon(): Electron.NativeImage {
  return trayIcon.resize({ width: 18, height: 18 })
}

function mainText(key: 'enable' | 'disable' | 'settings' | 'chat' | 'stopSpeech' | 'quit', language: string): string {
  const zh = {
    enable: '启用AIA划词助手',
    disable: '停用AIA划词助手',
    settings: '设置',
    chat: '对话',
    stopSpeech: '停止朗读',
    quit: '退出'
  }
  const en = {
    enable: 'Enable AIA Selection Assistant',
    disable: 'Disable AIA Selection Assistant',
    settings: 'Settings',
    chat: 'Chat',
    stopSpeech: 'Stop speaking',
    quit: 'Quit'
  }
  return (language === 'zh-CN' ? zh : en)[key]
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
  loadRenderer(settingsWindow, rendererDir, 'settings.html')
  return settingsWindow
}

// Per-window handle to the auto-untop blur listener hung by focusChatWindow.
// WeakMap entries die with the window — no cleanup needed on close. Tracking
// the exact listener replaces the old removeAllListeners('blur'), which also
// wiped any other subscriber's blur listeners on this window.
const chatAutoUntopHandlers = new WeakMap<BrowserWindow, () => void>()

// Bring the chat window reliably to the front: a plain show() can land behind
// the focused window (Windows foreground lock), which reads as "the hotkey did
// nothing". Temporary always-on-top lifts it above everything; the first blur
// returns it to a normal window so it never permanently covers other apps.
// Transparent windows can lose the initial always-on-top call on Windows (same
// pitfall as the screenshot pin windows), so this runs after ready-to-show.
function focusChatWindow(win: BrowserWindow): void {
  win.show()
  win.focus()
  win.setAlwaysOnTop(true, 'screen-saver')
  const previous = chatAutoUntopHandlers.get(win)
  if (previous) win.removeListener('blur', previous)
  const onFirstBlur = (): void => {
    chatAutoUntopHandlers.delete(win)
    if (!win.isDestroyed()) win.setAlwaysOnTop(false)
  }
  chatAutoUntopHandlers.set(win, onFirstBlur)
  win.once('blur', onFirstBlur)
}

function openChatWindow(source: ChatOpenSource): void {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.chatOpenSource = source
    if (chatWindow.isMinimized()) chatWindow.restore()
    focusChatWindow(chatWindow)
    return
  }
  const win = new BrowserWindow({
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
  }) as ChatWindow
  win.chatOpenSource = source
  chatWindow = win
  win.on('closed', () => {
    if (chatWindow === win) chatWindow = null
    // The pool lives for exactly one chat window session: closing the window
    // ends it (its entries were gathered as this session's context only).
    clearPreWindows()
  })
  win.once('ready-to-show', () => {
    focusChatWindow(win)
  })
  loadRenderer(win, rendererDir, 'chat.html')
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
      { label: mainText('chat', settings.language), click: () => openChatWindow('tray') },
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
        openChatWindow('hotkey')
      }
    }
  ]

  // Per-action type-in shortcuts: open a typed-input window for that action.
  for (const action of settings.actions) {
    const accelerator = action.shortcut?.trim()
    if (accelerator) shortcuts.push({ accelerator, action: () => selectionService.openActionInput(action) })
  }

  // Registration failures are invisible on the console alone (users run the
  // packaged build) — surface them via a tray balloon so a dead shortcut is
  // explainable instead of looking like a random miss.
  const failedAccelerators: string[] = []
  for (const shortcut of shortcuts) {
    const accelerator = shortcut.accelerator?.trim()
    if (!accelerator) continue
    const registered = globalShortcut.register(accelerator, shortcut.action)
    if (registered) {
      console.log(`[shortcut] registered: ${accelerator}`)
    } else {
      failedAccelerators.push(accelerator)
      console.warn(`[shortcut] FAILED to register: ${accelerator} (likely taken by another app)`)
    }
  }
  if (failedAccelerators.length > 0 && tray && isWin) {
    const zh = settings.language === 'zh-CN'
    tray.displayBalloon({
      title: zh ? '快捷键注册失败' : 'Shortcut registration failed',
      content: zh
        ? `${failedAccelerators.join('、')} 可能已被其他程序占用，请在设置中更换快捷键`
        : `Probably taken by another app: ${failedAccelerators.join(', ')}. Please change it in Settings.`
    })
  }
}

// Register (or clear) the OS login item. We only touch it in a packaged build —
// registering the dev electron.exe path into the user's startup would be wrong.
// '--hidden' is what tells a login-triggered launch to stay in the tray.
//
// Windows defaults the login item to process.execPath. For the portable build
// that path is the throw-away unpack directory under %TEMP% (`<random>\…exe`),
// which is recreated per launch and swept by system cleanup — a Run entry there
// is a dead shortcut at best. electron-builder exports the .exe the user
// actually double-clicked as PORTABLE_EXECUTABLE_FILE, so register that instead;
// installed builds don't set the variable and keep the execPath default.
const portableExecutablePath = isWin ? process.env.PORTABLE_EXECUTABLE_FILE?.trim() : undefined

function applyAutoLaunch(enabled: boolean): void {
  if (!app.isPackaged) return
  const loginItem: Parameters<typeof app.setLoginItemSettings>[0] = {
    openAtLogin: enabled,
    openAsHidden: enabled,
    args: ['--hidden']
  }
  if (portableExecutablePath) loginItem.path = portableExecutablePath
  app.setLoginItemSettings(loginItem)
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

  // Attach button: read an image from the system clipboard. Read-only —
  // empty or non-image clipboard yields null so the renderer keeps its state.
  ipcMain.handle(IPC.ClipboardReadImage, () => {
    const image = clipboard.readImage()
    if (image.isEmpty()) return null
    return image.toDataURL()
  })

  // Pre-selection pool: in-memory store (clears on restart by design).
  ipcMain.handle(IPC.PreWindowSave, (_event, entry: { text: string; programName?: string }) => {
    const saved = savePreWindow(entry)
    // Push, don't wait for the chat window to notice: a save from the toolbar
    // happens while another app holds focus, and focus-based re-pulls alone
    // missed it (user-visible stale panel).
    if (chatWindow && !chatWindow.isDestroyed()) chatWindow.webContents.send(IPC.PreWindowChanged)
    return saved
  })
  ipcMain.handle(IPC.PreWindowList, () => listPreWindows())
  ipcMain.handle(IPC.PreWindowRemove, (_event, id: string) => removePreWindow(id))
  // Only the toolbar button opens the chat with the selection attached: the
  // context follows the toolbar attach, not the globally latest selection.
  // Hotkey and tray open it clean — the source rides the asking window.
  ipcMain.handle(IPC.LastSelectionGet, (event) => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender) as ChatWindow | null
    return sourceWindow?.chatOpenSource === 'toolbar' ? getLastSelection() : null
  })

  ipcMain.handle(IPC.ChatOpen, () => openChatWindow('toolbar'))

  // Hotkey recording: system-level hook path for keys Windows intercepts
  // before they reach the renderer (Alt+Space opens the window menu instead).
  ipcMain.handle(IPC.HotkeyCaptureStart, (event) => startHotkeyCapture(event.sender))
  ipcMain.handle(IPC.HotkeyCaptureStop, () => {
    stopHotkeyCapture()
  })

  ipcMain.handle(IPC.AiStream, async (event, request: AiStreamRequest) => {
    // Two trigger sources dispose of an in-flight stream, and they are two
    // different things:
    // 1) Window destruction — stream vs window (the output channel dies). The
    //    user's intent is unknowable: they may be done with the result, or may
    //    just be tidying up the window while still wanting the result; abort
    //    wrongs the latter.
    // 2) Racing takeover — stream vs stream (display arbitration): a newer
    //    request replaces an older one. Intent is equally unknowable — a real
    //    replacement, or impatience / an accidental double trigger; abort
    //    wrongs the latter too.
    // Shared essence: we cannot speak for the user in either scenario. The
    // simplification in force: both share ONE raceResponse setting — it
    // expresses the user's preference for "what happens to a stream when it
    // is displaced", not a per-scenario policy (deliberate trade-off: the
    // mis-abort risk is accepted for a simpler settings surface). Splitting
    // it into two settings later is an evolution for future maintainers; this
    // comment only records the current state and the reasoning. Trigger
    // source 2 is handled below; source 1 is the 'destroyed' listener further
    // down.
    const controller = new AbortController()
    const settings = getSettings()
    for (const racing of findRacingStreams(event.sender.id, request.requestId)) {
      if (settings.raceResponse === 'abort') {
        console.log(
          `[ai:stream] new request ${request.requestId} races old stream, aborting old stream`
        )
        racing.controller.abort()
      } else {
        console.log(
          `[ai:stream] new request ${request.requestId} races old stream, old stream keeps running in background (complete mode)`
        )
      }
    }
    registerStream(request.requestId, { controller, senderId: event.sender.id })
    // Usage recording anchors: entry timestamp, accumulated response text.
    const statsStartedAt = Date.now()
    let statsResponseText = ''
    const recordStats = (outcome: StatsRecord['outcome']) => {
      const stats = request.stats
      // Requests without stats context (chat, screenshot explain) are not
      // action runs — usage recording tracks action runs only.
      if (!stats || !settings.statsEnabled) return
      void appendStatsRecord(
        {
          timestamp: new Date(statsStartedAt).toISOString(),
          programName: stats.programName,
          actionName: stats.actionName,
          actionType: stats.actionType,
          textLength: stats.selectedText.length,
          outcome,
          durationMs: Date.now() - statsStartedAt,
          selectedText: stats.selectedText,
          responseText: statsResponseText
        },
        settings.statsDetailLevel
      )
    }
    // Chunks must not touch a destroyed webContents: the window may die mid-stream
    // (user close in destroy mode, stop(), a crash). Skipping keeps "complete" mode
    // running in the background without errors, and guards every other path.
    const safeSend = (payload: AiChunkPayload) => {
      if (event.sender.isDestroyed()) return
      event.sender.send(IPC.AiChunk, payload)
    }
    // Disposal of an in-flight stream when its window is destroyed — trigger
    // source 1 of the two. Source 2 (racing takeover) is handled at the top
    // of this handler.
    const onSenderDestroyed = () => {
      if (getSettings().raceResponse === 'abort') {
        console.log(`[ai:stream] sender destroyed, aborting stream ${request.requestId}`)
        controller.abort()
      } else {
        console.log(
          `[ai:stream] sender destroyed, stream ${request.requestId} keeps running in background (complete mode)`
        )
      }
    }
    event.sender.once('destroyed', onSenderDestroyed)
    try {
      const messages = request.messages?.length
        ? request.messages
        : [{ role: 'user' as const, text: request.prompt ?? '' }]
      let systemPrompt = request.systemPrompt ?? buildAssistantSystemPrompt(settings)
      // Context injection: metadata is assembled here — the single point
      // where every AI request passes — reading settings at request time
      // (组装即定局). The stats context is the only channel carrying a source
      // app name; requests without it (chat, screenshot) skip that field.
      const injectionPrompt = buildContextInjectionPrompt({
        enabled: settings.contextInjectionEnabled,
        fields: settings.contextInjectionFields,
        language: settings.language,
        programName: request.stats?.programName,
        now: new Date(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
      })
      if (injectionPrompt) systemPrompt = `${systemPrompt}\n\n${injectionPrompt}`
      // Structured output contract rides on the system prompt so the user's
      // promptTemplate (and the default language lock) stay untouched. The
      // server-side parameter level comes from settings; the prompt layer is
      // the only mechanism every provider honors.
      if (request.structuredOutput) systemPrompt = `${systemPrompt}\n\n${buildStructuredOutputPrompt()}`
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
              safeSend({
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
            statsResponseText += delta.content
            safeSend({ requestId: request.requestId, type: 'delta', text: delta.content })
          }
          if (delta.reasoning) {
            safeSend({ requestId: request.requestId, type: 'reasoning', reasoning: delta.reasoning })
          }
        },
        request.reasoning ?? 'on',
        {
          fetcher: providerFetch,
          structuredOutput: request.structuredOutput === true,
          structuredOutputMode: settings.structuredOutputMode ?? 'json_schema'
        }
      )
      safeSend({ requestId: request.requestId, type: 'done' })
      recordStats('complete')
    } catch (error) {
      if (controller.signal.aborted) {
        safeSend({ requestId: request.requestId, type: 'done' })
        recordStats('truncated')
      } else {
        safeSend({
          requestId: request.requestId,
          type: 'error',
          error: error instanceof Error ? error.message : String(error)
        })
      }
    } finally {
      unregisterStream(request.requestId)
      if (!event.sender.isDestroyed()) {
        event.sender.removeListener('destroyed', onSenderDestroyed)
      }
    }
  })

  ipcMain.handle(IPC.AiAbort, (_event, requestId: string) => {
    abortStream(requestId)
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

    // Silent start by design: the tray icon appearing (created above) IS
    // the started signal. The settings window opens on demand (tray click /
    // menu / second-instance), not on boot — booting straight to the tray
    // is the expected behavior for a tray-resident app. ('--hidden' login
    // launches were already silent; explicit starts now are too.)
  })

  app.on('second-instance', () => createSettingsWindow())
  app.on('activate', () => createSettingsWindow())
  // Quit entries that bypass the tray menu (Cmd+Q, OS shutdown) never set
  // isQuitting above — flip it here so close→hide windows don't block quit.
  app.on('before-quit', () => {
    isQuitting = true
    selectionService.prepareExit()
  })
  app.on('will-quit', () => {
    isQuitting = true
    globalShortcut.unregisterAll()
    selectionService.dispose()
    screenshotService.dispose()
    speechService.dispose()
  })
}
