import { app, BrowserWindow, Menu, Tray, dialog, globalShortcut, ipcMain, nativeImage, net, shell } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildAssistantSystemPrompt, resolveProvider } from '@shared/actions'
import { IPC } from '@shared/ipc'
import { APP_ICON_DATA_URL, APP_TRAY_DATA_URL } from '@shared/brand'
import type { AgentToolEvent, AiStreamRequest, SettingsPatch } from '@shared/types'
import { listModels, streamChatMessages, testModel, type ProviderFetch } from './ai/OpenAICompatibleClient'
import { formatSearchContext, searchWithFallback, webSearchTool } from './ai/WebSearch'
import { agentToolDefinitions, assessCommandRisk, executeAgentTool, requiresApproval, restoreSnapshot, snapshotForMutation, summarizeToolCall } from './agent/AgentTools'
import { deleteSnapshot, loadSnapshot, saveSnapshot } from './agent/SnapshotStore'
import { cancelApprovalsForRequest, resolveApproval, waitForApproval } from './agent/AgentSession'
import { buildMemoryPrompt, ensureGlobalMemoryFile, getGlobalMemoryPath } from './memory'
import { buildSkillsPrompt, getSkillsDir, readSkillMeta, scanSkills } from './skills'
import { mcpManager } from './mcp/McpManager'
import { applyProxy, testProxy } from './proxy'
import { isMcpToolName } from './mcp/mcpUtil'
import { ScreenshotService } from './ScreenshotService'
import { SelectionService } from './SelectionService'
import { SpeechService } from './SpeechService'
import { getSettings, onSettingsChanged, updateSettings } from './settingsStore'
import { isSupportedPlatform, isWin } from './platform'

const preloadPath = join(__dirname, '../preload/index.cjs')
const rendererDir = join(__dirname, '../renderer')

if (isWin) app.commandLine.appendSwitch('wm-window-animations-disabled')
// Cap the V8 old space to keep memory bounded, but leave enough headroom for
// large screenshot data URLs (a 4K capture is tens of MB as a base64 string).
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512')

let settingsWindow: BrowserWindow | null = null
let chatWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

// Pre-images of agent write/edit calls are persisted to disk (see
// SnapshotStore) so revert from the tool card survives an app restart.
const CHAT_SHADOW_PADDING = 18
const CHAT_DEFAULT_WIDTH = 520
const CHAT_DEFAULT_HEIGHT = 640
const abortControllers = new Map<string, AbortController>()
// User notes queued mid-request, delivered into the tool loop between rounds
// (see drainInjected). Entry exists only while its request is streaming.
const injectionQueues = new Map<string, string[]>()
const providerFetch: ProviderFetch = (url, init) => net.fetch(url, init)

function createNativeImageFromFile(paths: string[], fallbackDataUrl: string): Electron.NativeImage {
  for (const path of paths) {
    if (!existsSync(path)) continue
    const image = nativeImage.createFromPath(path)
    if (!image.isEmpty()) return image
  }
  return nativeImage.createFromDataURL(fallbackDataUrl)
}

// Packaged: build/icon.png lives inside app.asar (readable via Electron's
// patched fs); some builds also copy it next to resources. The data-URL
// fallbacks are SVG, which nativeImage cannot decode — never rely on them
// for the tray or it renders as an invisible blank icon.
const packagedIconPaths = [
  join(app.getAppPath(), 'build', 'icon.png'),
  join(process.resourcesPath, 'build', 'icon.png')
]
const devIconPaths = [join(__dirname, '../../build/icon.png'), join(process.cwd(), 'build', 'icon.png')]

const appIcon = createNativeImageFromFile(app.isPackaged ? packagedIconPaths : devIconPaths, APP_ICON_DATA_URL)
const trayIcon = createNativeImageFromFile(app.isPackaged ? packagedIconPaths : devIconPaths, APP_TRAY_DATA_URL)
const selectionService = new SelectionService(getSettings, updateSettings, preloadPath, rendererDir, appIcon)
const screenshotService = new ScreenshotService(
  getSettings,
  preloadPath,
  rendererDir,
  appIcon,
  (imageDataUrl) => {
    // Reuse the action window for vision instead of spawning a dedicated preview process.
    const isZh = getSettings().language === 'zh-CN'
    selectionService.processAction({
      action: {
        // Unique id so reusing the action window remounts for each capture.
        id: `screenshot-explain-${Date.now()}`,
        name: isZh ? 'AI 识图' : 'AI Vision',
        enabled: true,
        icon: 'sparkles',
        type: 'prompt',
        promptTemplate: isZh
          ? '直接用简洁易懂的话解释这张图片。抓住重点，不要废话，不要逐一描述画面元素，也不要堆砌冗长段落；只有在真正有帮助时再补一句简短总结。'
          : 'Explain this image directly in plain, easy-to-understand language. Be concise, stay focused on the key point, avoid listing every visual element, and skip filler. Add a brief summary only when it is genuinely helpful.'
      },
      selectedText: '',
      images: [imageDataUrl]
    })
  }
)
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
    const url = `${process.env.ELECTRON_RENDERER_URL}/${page}`
    // Dev-only: the vite server may still be starting (dependency
    // re-optimization) when the first window loads — retry until it is up.
    let attempts = 0
    const tryLoad = (): void => {
      win.loadURL(url).catch(() => {
        if (win.isDestroyed() || attempts >= 20) return
        attempts += 1
        setTimeout(tryLoad, 500)
      })
    }
    tryLoad()
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
      sandbox: true,
      backgroundThrottling: true
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
  const settings = getSettings()
  // Chat window always remembers its size (independent of rememberWindowSize toggle)
  const chatWidth = settings.chatWindowWidth ?? CHAT_DEFAULT_WIDTH
  const chatHeight = settings.chatWindowHeight ?? CHAT_DEFAULT_HEIGHT
  chatWindow = new BrowserWindow({
    width: chatWidth + CHAT_SHADOW_PADDING * 2,
    height: chatHeight + CHAT_SHADOW_PADDING * 2,
    minWidth: 360 + CHAT_SHADOW_PADDING * 2,
    minHeight: 360 + CHAT_SHADOW_PADDING * 2,
    icon: appIcon,
    title: 'AIA划词助手',
    autoHideMenuBar: true,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    paintWhenInitiallyHidden: true,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: CHAT_SHADOW_PADDING + 12, y: CHAT_SHADOW_PADDING + 10 },
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: true
    }
  })
  const win = chatWindow
  // Save window size when closing (always, for chat window)
  win.on('close', () => {
    if (!win.isDestroyed()) {
      const bounds = win.getBounds()
      void updateSettings({
        chatWindowWidth: Math.max(360, bounds.width - CHAT_SHADOW_PADDING * 2),
        chatWindowHeight: Math.max(360, bounds.height - CHAT_SHADOW_PADDING * 2)
      })
    }
  })
  win.on('closed', () => {
    if (chatWindow === win) chatWindow = null
  })
  // Also save on resize (debounced) for crash-safety
  let resizeTimer: ReturnType<typeof setTimeout> | null = null
  win.on('resized', () => {
    if (win.isDestroyed()) return
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      if (win.isDestroyed()) return
      const bounds = win.getBounds()
      void updateSettings({
        chatWindowWidth: Math.max(360, bounds.width - CHAT_SHADOW_PADDING * 2),
        chatWindowHeight: Math.max(360, bounds.height - CHAT_SHADOW_PADDING * 2)
      })
    }, 200)
  })
  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })
  loadRenderer(win, 'selectionAction.html')
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

// Tool results shipped to the renderer (and replayed cross-turn by the chat
// window) keep head + tail up to 12k — the same ceiling the model sees
// in-turn, so replay never exceeds what was actually observed.
const RESULT_EVENT_MAX = 12_000
function capResultForEvent(output: string): string {
  if (output.length <= RESULT_EVENT_MAX) return output
  const head = output.slice(0, Math.floor(RESULT_EVENT_MAX * 0.7))
  const tail = output.slice(-Math.floor(RESULT_EVENT_MAX * 0.25))
  return `${head}\n[... ${output.length - head.length - tail.length} chars truncated ...]\n${tail}`
}

function registerIpc(): void {
  selectionService.registerIpc()
  screenshotService.registerIpc()

  // Typing in the proxy input fires one settings update per keystroke —
  // debounce the MCP reconnect so connections rebuild once the URL settles.
  let mcpProxyReconnectTimer: NodeJS.Timeout | null = null

  ipcMain.handle(IPC.SettingsGet, () => getSettings())
  ipcMain.handle(IPC.SettingsUpdate, (_event, patch: SettingsPatch) => {
    const prev = getSettings()
    const settings = updateSettings(patch)
    // Only re-register shortcuts if shortcut-related settings changed
    const shortcutsChanged = JSON.stringify(prev.shortcuts) !== JSON.stringify(settings.shortcuts) ||
      prev.actions.some((a, i) => a.shortcut !== settings.actions[i]?.shortcut) ||
      prev.actions.length !== settings.actions.length
    if (shortcutsChanged) registerShortcuts()
    applySelectionState(settings)
    applyAutoLaunch(settings.autoLaunch)
    // Re-apply the proxy chain (manual > system > direct) when it changes, then
    // rebuild MCP connections — live sockets keep using the old route otherwise.
    if (prev.proxyUrl !== settings.proxyUrl) {
      void applyProxy(settings.proxyUrl)
      if (mcpProxyReconnectTimer) clearTimeout(mcpProxyReconnectTimer)
      mcpProxyReconnectTimer = setTimeout(() => {
        mcpProxyReconnectTimer = null
        mcpManager.reconnectAll(getSettings().mcpServers)
      }, 1500)
    }
    // Reconcile MCP connections; unchanged servers are left untouched.
    mcpManager.sync(settings.mcpServers)
    return settings
  })
  ipcMain.handle(IPC.ProxyTest, (_event, proxyUrl: string) => testProxy(typeof proxyUrl === 'string' ? proxyUrl : ''))

  // Only allow protocols that make sense to hand to the OS shell. Selected
  // text can be an arbitrary URI, so never forward schemes like javascript:.
  ipcMain.handle(IPC.OpenExternal, (_event, url: string) => {
    if (typeof url !== 'string') return
    const allowed = /^(https?|mailto|file):/i.test(url) || /^[a-z]:[\\/]/i.test(url)
    if (allowed) return shell.openExternal(url)
  })
  ipcMain.handle(IPC.MemoryOpen, async () => {
    // Open the global memory file in the system editor, creating it on first use.
    const filePath = await ensureGlobalMemoryFile(app.getPath('userData'))
    return shell.openPath(filePath)
  })
  ipcMain.handle(IPC.MemoryOpenProject, (_event, workingDir: string) => {
    if (typeof workingDir !== 'string' || !existsSync(workingDir)) return ''
    const filePath = join(workingDir, 'AGENTS.md')
    if (!existsSync(filePath)) writeFileSync(filePath, '# Project memory\n', 'utf8')
    return shell.openPath(filePath)
  })
  ipcMain.handle(IPC.ExtStatus, async () => {
    const settings = getSettings()
    const skills = await scanSkills(getSkillsDir(app.getPath('userData')), settings.disabledSkills, settings.linkedSkillDirs)
    return { skills, mcp: mcpManager.getStatuses(settings.mcpServers) }
  })
  ipcMain.handle(IPC.ExtOpenSkillsDir, () => {
    const dir = getSkillsDir(app.getPath('userData'))
    mkdirSync(dir, { recursive: true })
    return shell.openPath(dir)
  })
  // Reuse an existing folder as a skill in place — validated (must contain a
  // parseable SKILL.md), then linked by path in settings. Nothing is copied.
  ipcMain.handle(IPC.ExtLinkSkillDir, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = { properties: ['openDirectory' as const] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    const dir = result.filePaths[0]
    const meta = await readSkillMeta(dir)
    if (!meta) return { ok: false as const, error: 'no-skill-md' }
    const settings = getSettings()
    if (!settings.linkedSkillDirs.includes(dir)) {
      updateSettings({ linkedSkillDirs: [...settings.linkedSkillDirs, dir] })
    }
    return { ok: true as const, name: meta.name ?? dir }
  })
  ipcMain.handle(IPC.ExtUnlinkSkillDir, (_event, dir: string) => {
    if (typeof dir !== 'string') return
    const settings = getSettings()
    updateSettings({
      linkedSkillDirs: settings.linkedSkillDirs.filter((d) => d !== dir),
      // Drop the stale disable entry too — its id is the path itself.
      disabledSkills: settings.disabledSkills.filter((s) => s !== dir)
    })
  })
  ipcMain.handle(IPC.ExtMcpReconnect, (_event, id: string) => {
    if (typeof id === 'string') mcpManager.reconnect(getSettings().mcpServers, id)
  })
  ipcMain.handle(IPC.SpeechSpeak, (_event, text: string) => speechService.speak(text))
  ipcMain.handle(IPC.SpeechStop, () => speechService.stop())

  ipcMain.handle(IPC.AiStream, async (event, request: AiStreamRequest) => {
    const controller = new AbortController()
    const settings = getSettings()
    abortControllers.set(request.requestId, controller)
    injectionQueues.set(request.requestId, [])
    // If the requesting window dies mid-stream, stop the request instead of
    // sending chunks into a destroyed WebContents.
    const sendChunk = (payload: Record<string, unknown>): void => {
      if (event.sender.isDestroyed()) {
        controller.abort()
        return
      }
      event.sender.send(IPC.AiChunk, { requestId: request.requestId, ...payload })
    }
    event.sender.once('destroyed', () => controller.abort())
    try {
      const messages = request.messages?.length
        ? request.messages
        : [{ role: 'user' as const, text: request.prompt ?? '' }]
      const systemPrompt = request.systemPrompt ?? buildAssistantSystemPrompt(settings)
      // Clone before overriding the model — resolveProvider returns the live
      // settings object, which is cached in settingsStore.
      const provider = { ...resolveProvider(settings, request.providerTemplateId) }
      if (request.model) {
        provider.model = request.model
      }

      // Determine whether web search tools should be included.
      // forceSearch=true  → include tools (chat window with toggle on, or action with webSearch=true)
      // forceSearch=false → exclude tools (action with webSearch=false)
      // forceSearch=undefined → follow global setting (action with webSearch=inherit)
      const enableSearch = request.forceSearch ?? settings.webSearchEnabled
      const agentEnabled = request.agentMode === true
      const workingDir =
        agentEnabled && request.workingDir && existsSync(request.workingDir) ? request.workingDir : homedir()
      // Agent mode: per-call approval is the safety net, not a sandbox. The
      // model operates on real files; write/edit/command calls pause for the
      // user unless they picked "always allow" for this stream.
      let alwaysAllow = false

      const useExtensions = request.useExtensions === true
      const mcpTools = useExtensions ? mcpManager.getToolDefinitions() : []
      const tools = [
        ...(enableSearch ? [webSearchTool] : []),
        ...(agentEnabled ? agentToolDefinitions : []),
        ...mcpTools
      ]
      let effectiveSystemPrompt = agentEnabled
        ? `${systemPrompt}\n\n` +
          // Core grounding rule — placed FIRST so it anchors model behavior.
          `IMPORTANT: You MUST use tool calls to perform actions. Describing an action in text does NOT execute it. ` +
          `Only a tool_use/function_call returned in the API response counts as real work.\n\n` +
          `You can operate on the user’s real file system with the tools read_file, write_file, edit_file, list_dir, search_files and run_command (${process.platform === 'win32' ? 'Git Bash syntax on Windows' : 'bash'}). Working directory: ${workingDir}. ` +
          `Prefer search_files to locate code instead of listing and reading files one by one. Read files before editing them, prefer edit_file for small changes, and keep commands non-interactive. ` +
          `Write/edit/command calls require user approval and may be rejected — if rejected, ask or adjust your approach instead of retrying the same call.\n\n` +
          `Grounding rules:\n` +
          `- Talk is not work. Nothing counts as done unless the tool call ran and returned success.\n` +
          `- Earlier assistant messages may end with a block titled 【本轮实际执行的工具调用】. The app generates it from execution logs; it is authoritative. Trust it. NEVER write such a block yourself.\n` +
          `- Never claim you created, edited, or verified anything without the matching tool result. Never invent outputs.\n` +
          `- If you cannot perform an action, say so. Do not pretend it succeeded.`
        : systemPrompt
      if (request.useMemory === true) {
        const userDataDir = app.getPath('userData')
        effectiveSystemPrompt += await buildMemoryPrompt(userDataDir, agentEnabled ? workingDir : undefined)
        // Teach the model the memory convention: explicit opt-in only, and the
        // update path depends on whether file tools are available right now.
        effectiveSystemPrompt += agentEnabled
          ? `\n\nMemory convention: when the user explicitly asks you to remember something durable, append a short bullet to ${getGlobalMemoryPath(userDataDir)} (personal, cross-project preferences) or AGENTS.md in the working directory (project conventions) using edit_file/write_file. Never store anything the user did not ask to remember; remove entries when asked to forget.`
          : `\n\nMemory convention: if the user asks you to remember something durable, you cannot edit files in this mode — ask them to enable agent mode (the terminal button) so you can update the memory file.`
      }
      if (useExtensions && agentEnabled) {
        // Progressive skill loading: only the metadata list is injected; the
        // agent reads a SKILL.md with read_file when a task matches.
        const skills = await scanSkills(getSkillsDir(app.getPath('userData')), settings.disabledSkills, settings.linkedSkillDirs)
        effectiveSystemPrompt += buildSkillsPrompt(skills)
      }

      const runAgentTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
        const callId = randomUUID()
        const summary = summarizeToolCall(name, args, workingDir)
        // For write/edit ship the proposed content so the renderer can show a diff.
        const diff: Partial<AgentToolEvent> =
          name === 'edit_file'
            ? { oldText: String(args.old_text ?? '').slice(0, 4000), newText: String(args.new_text ?? '').slice(0, 4000) }
            : name === 'write_file'
              ? { newText: String(args.content ?? '').slice(0, 4000) }
              : {}
        const sendTool = (patch: Partial<AgentToolEvent>): void => {
          sendChunk({ type: 'tool', tool: { callId, toolName: name, summary, ...diff, ...patch } })
        }
        // Risk gate: forbidden commands never run; dangerous ones always
        // pause for approval, even in full-access / always-allow mode.
        const risk = name === 'run_command' ? assessCommandRisk(String(args.command ?? '')) : 'safe'
        if (risk === 'forbidden') {
          sendTool({ state: 'error', result: 'Blocked: destructive command' })
          return '[Blocked: this command is classified as destructive and will never be executed. Do not retry it.]'
        }
        const approvalWaived = alwaysAllow || getSettings().agentFullAccess === true
        if (risk === 'dangerous' || (!approvalWaived && requiresApproval(name, args, workingDir))) {
          sendTool({ state: 'pending-approval' })
          const approval = await waitForApproval(callId, request.requestId, controller.signal)
          if (approval.alwaysAllow) alwaysAllow = true
          if (!approval.approved) {
            sendTool({ state: 'rejected' })
            return '[User rejected this action. Ask for clarification or try a different approach.]'
          }
        }
        sendTool({ state: 'running' })
        const snapshot = await snapshotForMutation(name, args, workingDir)
        // Live output for long-running commands: keep the tail, throttle pushes.
        let liveBuffer = ''
        let liveTimer: NodeJS.Timeout | null = null
        const pushLiveOutput = (chunk: string): void => {
          liveBuffer = (liveBuffer + chunk).slice(-2000)
          if (liveTimer) return
          liveTimer = setTimeout(() => {
            liveTimer = null
            sendTool({ state: 'running', liveOutput: liveBuffer })
          }, 300)
        }
        try {
          const output = await executeAgentTool(
            name,
            args,
            workingDir,
            controller.signal,
            name === 'run_command' ? pushLiveOutput : undefined
          )
          if (snapshot) void saveSnapshot(callId, snapshot)
          // Mirror the in-turn 12k cap (head + tail) so cross-turn replay via
          // toolRecap can carry the same content the model saw this turn.
          sendTool({ state: 'done', result: capResultForEvent(output) })
          return output
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          sendTool({ state: 'error', result: message })
          return `[Tool failed: ${message}]`
        } finally {
          if (liveTimer) clearTimeout(liveTimer)
        }
      }

      // External MCP tools always pause for approval unless "always allow" —
      // we cannot know what a third-party server will do.
      const runMcpTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
        const callId = randomUUID()
        const summary = `${mcpManager.describeTool(name)} · ${JSON.stringify(args).slice(0, 160)}`
        const sendTool = (patch: Partial<AgentToolEvent>): void => {
          sendChunk({ type: 'tool', tool: { callId, toolName: name, summary, ...patch } })
        }
        if (!alwaysAllow) {
          sendTool({ state: 'pending-approval' })
          const approval = await waitForApproval(callId, request.requestId, controller.signal)
          if (approval.alwaysAllow) alwaysAllow = true
          if (!approval.approved) {
            sendTool({ state: 'rejected' })
            return '[User rejected this action. Ask for clarification or try a different approach.]'
          }
        }
        sendTool({ state: 'running' })
        try {
          const output = await mcpManager.callTool(name, args, controller.signal)
          sendTool({ state: 'done', result: capResultForEvent(output) })
          return output.slice(0, 20_000)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          sendTool({ state: 'error', result: message })
          return `[Tool failed: ${message}]`
        }
      }

      await streamChatMessages(
        provider,
        messages,
        effectiveSystemPrompt,
        controller.signal,
        (delta) => {
          if (delta.content) {
            sendChunk({ type: 'delta', text: delta.content })
          }
          if (delta.reasoning) {
            sendChunk({ type: 'reasoning', reasoning: delta.reasoning })
          }
        },
        request.reasoning ?? 'on',
        {
          fetcher: providerFetch,
          tools: tools.length ? tools : undefined,
          // Agent mode: lower temperature to reduce hallucinated tool calls.
          agentTemperature: agentEnabled ? 0.2 : undefined,
          // Agent/MCP runs span many rounds and can pause on user approval.
          // Models often issue one call per round, so real tasks (read × N +
          // edit × N + build/test) need generous headroom.
          maxToolRounds: agentEnabled || mcpTools.length ? 50 : 5,
          toolLoopTimeoutMs: agentEnabled || mcpTools.length ? 900_000 : 60_000,
          // When the round budget is exhausted mid-task, tell the user instead
          // of ending silently (looks like an unexplained interruption).
          roundLimitNotice:
            agentEnabled || mcpTools.length
              ? settings.language === 'zh-CN'
                ? '⚠️ 已达到单次对话的最大工具调用轮次（任务尚未完成）。可回复“继续”让我接着做。'
                : '⚠️ Reached the max tool-call rounds for one turn (task may be unfinished). Reply “continue” to keep going.'
              : undefined,
          // Between tool rounds, hand queued user notes to the loop and tell
          // the renderer they were actually delivered (vs. left for fallback).
          drainInjected: () => {
            const queue = injectionQueues.get(request.requestId)
            if (!queue?.length) return []
            const notes = queue.splice(0)
            for (const note of notes) sendChunk({ type: 'injected', text: note })
            return notes.map((note) =>
              settings.language === 'zh-CN'
                ? `[用户在任务执行中途发来的指引，请据此调整后续步骤]\n${note}`
                : `[Mid-task guidance from the user — adjust your next steps accordingly]\n${note}`
            )
          },
          onStatus: (text: string, toolName?: string) => {
            // Agent tools render their own cards; the status line is search-only.
            if (toolName && toolName !== webSearchTool.name) return
            sendChunk({ type: 'status', text })
          },
          onToolCall: async (name: string, args: Record<string, unknown>) => {
            if (name === webSearchTool.name) {
              const query = typeof args.query === 'string' ? args.query : ''
              if (!query) return 'No search query provided.'
              const results = await searchWithFallback(query, controller.signal, 10, providerFetch)
              return formatSearchContext(query, results, settings.language)
            }
            if (isMcpToolName(name) && mcpManager.ownsTool(name)) {
              return runMcpTool(name, args)
            }
            return runAgentTool(name, args)
          }
        }
      )
      sendChunk({ type: 'done' })
    } catch (error) {
      if (controller.signal.aborted) {
        sendChunk({ type: 'done' })
      } else {
        sendChunk({
          type: 'error',
          error: error instanceof Error ? error.message : String(error)
        })
      }
    } finally {
      cancelApprovalsForRequest(request.requestId)
      abortControllers.delete(request.requestId)
      injectionQueues.delete(request.requestId)
    }
  })

  ipcMain.handle(IPC.AiAbort, (_event, requestId: string) => {
    abortControllers.get(requestId)?.abort()
    abortControllers.delete(requestId)
    injectionQueues.delete(requestId)
  })

  // Queue a user note for a running request. Returns false when the request
  // already finished — the renderer then sends the note as a normal message.
  ipcMain.handle(IPC.AiInject, (_event, requestId: string, text: string) => {
    if (typeof requestId !== 'string' || typeof text !== 'string' || !text.trim()) return false
    const queue = injectionQueues.get(requestId)
    if (!queue) return false
    queue.push(text)
    return true
  })

  ipcMain.handle(IPC.AgentPickWorkingDir, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options = { properties: ['openDirectory' as const] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(IPC.AgentApproveTool, (_event, callId: string, approved: boolean, alwaysAllow?: boolean) => {
    if (typeof callId !== 'string') return false
    return resolveApproval(callId, approved === true, alwaysAllow === true)
  })
  ipcMain.handle(IPC.AgentRevertTool, async (_event, callId: string) => {
    if (typeof callId !== 'string') return false
    const snapshot = await loadSnapshot(callId)
    if (!snapshot) return false
    try {
      await restoreSnapshot(snapshot)
      await deleteSnapshot(callId)
      return true
    } catch {
      return false
    }
  })
  // Export a chat transcript as Markdown. The renderer builds the markdown;
  // main writes straight into Downloads and reveals the file in Explorer.
  // No native save dialog: its modal message loop deadlocks with the global
  // selection hook on Windows (observed as "not responding" + forced exit).
  ipcMain.handle(IPC.ChatExportMarkdown, async (_event, payload: { title?: string; markdown?: string }) => {
    if (typeof payload?.markdown !== 'string' || !payload.markdown.trim()) return null
    const safeTitle =
      (typeof payload.title === 'string' ? payload.title : '')
        .replace(/[\\/:*?"<>|\n\r]/g, ' ')
        .trim()
        .slice(0, 60) || 'chat'
    const stamp = new Date().toISOString().slice(0, 10)
    try {
      const dir = app.getPath('downloads')
      // Avoid clobbering an earlier export with the same title.
      let filePath = join(dir, `${safeTitle} ${stamp}.md`)
      for (let i = 2; existsSync(filePath) && i < 100; i++) {
        filePath = join(dir, `${safeTitle} ${stamp} (${i}).md`)
      }
      await writeFile(filePath, payload.markdown, 'utf8')
      shell.showItemInFolder(filePath)
      return filePath
    } catch {
      return null
    }
  })
  ipcMain.handle(IPC.AiListModels, (_event, providerTemplateId?: string) =>
    listModels(resolveProvider(getSettings(), providerTemplateId), { fetcher: providerFetch })
  )
  ipcMain.handle(IPC.AiTestModel, async (_event, providerTemplateId?: string) => {
    await testModel(resolveProvider(getSettings(), providerTemplateId), { fetcher: providerFetch })
    return { ok: true }
  })

  // Compress old chat history into a structured summary.
  // Order: compressModel (if set) → retry once → fall back to the chat model
  // passed by the renderer. Failures throw so the UI can keep compactRef and
  // retry on the next completed turn (truncateForSend still caps payload size).
  ipcMain.handle(IPC.AiSummarize, async (_event, payload: { text: string; model?: string }) => {
    if (typeof payload?.text !== 'string' || !payload.text.trim()) return ''
    const settings = getSettings()
    const base = resolveProvider(settings, undefined)
    const chatModel =
      (typeof payload.model === 'string' && payload.model.trim()) || base.model
    const compressModel = settings.compressModel.trim()
    // Prefer dedicated compress model, then the live chat model.
    const candidates = [...new Set([compressModel, chatModel].filter(Boolean))]
    if (!candidates.length) candidates.push(base.model)

    const systemPrompt = [
      '你是对话历史压缩器。把给定的对话（可能包含一段已有摘要）合并压缩成一份结构化摘要，供后续对话作为上下文。',
      '输出格式（缺的小节可省略）：',
      '## 对话目标',
      '## 关键信息与事实',
      '## 已完成 / 已决定',
      '## 待办与未决问题',
      '要求：只保留对后续对话有用的内容；专有名词、数据、代码要点保留原文；用原对话的主要语言书写；总长不超过 800 字；直接输出摘要，不要寒暄。'
    ].join('\n')

    const runOnce = async (model: string): Promise<string> => {
      const provider = { ...base, model }
      let summary = ''
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 60_000)
      try {
        await streamChatMessages(
          provider,
          [{ role: 'user', text: payload.text }],
          systemPrompt,
          controller.signal,
          (delta) => {
            if (delta.content) summary += delta.content
          },
          'off',
          { fetcher: providerFetch }
        )
      } finally {
        clearTimeout(timeout)
      }
      return summary.trim()
    }

    let lastError: unknown
    for (const model of candidates) {
      // Two attempts per model (network blips / empty first response).
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const summary = await runOnce(model)
          if (summary) return summary
          lastError = new Error(`Empty summary from model ${model}`)
        } catch (error) {
          lastError = error
        }
      }
    }
    const message =
      lastError instanceof Error ? lastError.message : String(lastError ?? 'summarize failed')
    throw new Error(message)
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void app.whenReady().then(() => {
    app.setAppUserModelId('com.selectionassistant.lite')
    app.dock?.setIcon(appIcon)
    // Apply the proxy chain first so MCP connections go through it too.
    void applyProxy(getSettings().proxyUrl).finally(() => {
      // Bring up enabled MCP server connections in the background.
      mcpManager.sync(getSettings().mcpServers)
    })
    app.on('browser-window-created', (_event, window) => {
  // optimizer.watchWindowShortcuts equivalent: F12 toggle devtools in dev
  if (!app.isPackaged) {
    window.webContents.on('before-input-event', (_e, input) => {
      if (input.key === 'F12') {
        window.webContents.toggleDevTools()
      }
    })
  }
})

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

    // Prevent in-app navigation: all external links open in the default browser.
    app.on('web-contents-created', (_event, contents) => {
      contents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http://') || url.startsWith('https://')) {
          void shell.openExternal(url)
        }
        return { action: 'deny' }
      })
      contents.on('will-navigate', (event, url) => {
        if (url.startsWith('http://') || url.startsWith('https://')) {
          event.preventDefault()
          void shell.openExternal(url)
        }
      })
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
    mcpManager.closeAll()
  })
}
