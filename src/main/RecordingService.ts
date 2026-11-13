import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, powerMonitor, screen, systemPreferences } from 'electron'
import { copyFile, mkdir, mkdtemp, open, readdir, rename, rm, stat, type FileHandle } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { IPC } from '@shared/ipc'
import type { AppSettings } from '@shared/types'
import { recordingControlsBounds, validateRecordingSelection, type RecordingInit, type RecordingResult, type RecordingSelection } from '@shared/recording'
import { copyRecordingFile } from './recordingClipboard'
import { loadRenderer } from './loadRenderer'

type Phase = 'idle' | 'selecting' | 'preparing' | 'recording' | 'processing' | 'ready' | 'error'
interface Session {
  displayId: number
  directory: string
  file: FileHandle | null
  writes: Promise<void>
  writeError: Error | null
  init: RecordingInit
  result?: RecordingResult
}

export class RecordingService {
  private phase: Phase = 'idle'
  private overlays = new Map<BrowserWindow, { display: Electron.Display; source: Electron.DesktopCapturerSource }>()
  private masks = new Map<BrowserWindow, { selection?: RecordingSelection }>()
  private window: BrowserWindow | null = null
  private session: Session | null = null
  private generation = 0
  private disposed = false
  private stopTimer: ReturnType<typeof setTimeout> | null = null
  private onDisplayChanged = (_event: Electron.Event, display: Electron.Display) => {
    if (this.session && (this.session.displayId === display.id || this.masks.size)) this.stop()
    for (const [win, overlay] of this.overlays) {
      if (overlay.display.id === display.id) { this.overlays.delete(win); win.destroy() }
    }
    if (this.phase === 'selecting' && !this.overlays.size) this.reset()
  }
  private onLock = () => this.stop()

  constructor(
    private getSettings: () => AppSettings,
    private preloadPath: string,
    private rendererDir: string,
    private icon: Electron.NativeImage,
    private changed: () => void
  ) {}

  get active(): boolean { return ['selecting', 'preparing', 'recording', 'processing'].includes(this.phase) }
  private text(zh: string, en: string): string { return this.getSettings().language === 'zh-CN' ? zh : en }
  private setPhase(phase: Phase): void { this.phase = phase; this.changed() }
  private assertRecorder(event: Electron.IpcMainInvokeEvent): void {
    if (!this.window || event.sender !== this.window.webContents) throw new Error('Invalid recording window')
  }

  registerIpc(): void {
    screen.on('display-added', this.onDisplayChanged)
    screen.on('display-removed', this.onDisplayChanged)
    screen.on('display-metrics-changed', this.onDisplayChanged)
    powerMonitor.on('lock-screen', this.onLock)
    ipcMain.handle(IPC.RecordingStart, () => this.toggle())
    ipcMain.handle(IPC.RecordingOverlayReady, (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const mask = win && this.masks.get(win)
      if (mask) return { mode: 'recording', selection: mask.selection }
      const overlay = win && this.overlays.get(win)
      if (!overlay) throw new Error('Invalid region selector')
      return { mode: 'select', imageDataUrl: overlay.source.thumbnail.toDataURL() }
    })
    ipcMain.handle(IPC.RecordingSelect, (event, selection: RecordingSelection) => this.select(event, selection))
    ipcMain.handle(IPC.RecordingCancel, (event) => {
      if (event.sender !== this.window?.webContents && ![...this.overlays.keys()].some((win) => win.webContents === event.sender)) {
        throw new Error('Invalid recording window')
      }
      if (this.phase === 'processing' || this.phase === 'recording') return
      this.reset()
    })
    ipcMain.handle(IPC.RecordingReady, (event) => { this.assertRecorder(event); return this.session?.init })
    ipcMain.handle(IPC.RecordingStarted, async (event) => {
      this.assertRecorder(event)
      if (this.phase !== 'preparing' || !this.session) throw new Error('Recording was cancelled')
      if (this.session.init.controlsHidden) this.window!.hide()
      // Allow the compositor to remove countdown / selector windows before capturing.
      await new Promise((resolve) => setTimeout(resolve, 250))
      if (this.phase !== 'preparing') throw new Error('Recording was cancelled')
      this.setPhase('recording')
      // A safety bound on cache usage; stop normally so the result remains usable.
      this.stopTimer = setTimeout(() => this.stop(), 60 * 60 * 1000)
    })
    ipcMain.handle(IPC.RecordingAppend, (event, data: Uint8Array) => {
      this.assertRecorder(event)
      const session = this.session
      if (!session?.file || this.phase !== 'recording' || !(data instanceof Uint8Array) || data.byteLength > 16 * 1024 * 1024) {
        throw new Error('Invalid recording data')
      }
      // Serialize writes and handle partial writes rather than buffering the full video.
      const bytes = Buffer.from(data)
      session.writes = session.writes.then(async () => {
        if (session.writeError) throw session.writeError
        let offset = 0
        while (offset < bytes.length) {
          const { bytesWritten } = await session.file!.write(bytes, offset, bytes.length - offset)
          if (!bytesWritten) throw new Error('Unable to write recording')
          offset += bytesWritten
        }
      }).catch((error: Error) => { session.writeError = error; throw error })
      return session.writes
    })
    ipcMain.handle(IPC.RecordingFinish, (event, size: { width: number; height: number }) => {
      this.assertRecorder(event)
      return this.finish(size)
    })
    ipcMain.handle(IPC.RecordingFailed, (event) => {
      this.assertRecorder(event)
      this.clearStopTimer()
      this.closeMasks()
      this.setPhase('error')
      this.showResultWindow()
    })
    ipcMain.handle(IPC.RecordingSave, async (event) => {
      this.assertRecorder(event)
      const session = this.session
      if (!session?.result) throw new Error('No MP4 recording available')
      const result = await dialog.showSaveDialog(this.window!, {
        title: this.text('保存录屏', 'Save recording'),
        defaultPath: join(app.getPath('downloads'), `AIA-recording-${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`),
        filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
      })
      if (result.canceled || !result.filePath) return false
      const destination = extname(result.filePath).toLowerCase() === '.mp4' ? result.filePath : `${result.filePath}.mp4`
      if (destination !== result.filePath && await stat(destination).then(() => true, () => false)) {
        const overwrite = await dialog.showMessageBox(this.window!, { type: 'question',
          message: this.text('目标 MP4 已存在，是否替换？', 'The MP4 already exists. Replace it?'),
          buttons: [this.text('取消', 'Cancel'), this.text('替换', 'Replace')], defaultId: 0, cancelId: 0 })
        if (overwrite.response !== 1) return false
      }
      await copyFile(join(session.directory, 'recording.mp4'), destination)
      return true
    })
    ipcMain.handle(IPC.RecordingCopy, async (event) => {
      this.assertRecorder(event)
      if (!this.session?.result) throw new Error('No MP4 recording available')
      const file = join(this.session.directory, 'recording.mp4')
      await copyRecordingFile(file)
      return true
    })
  }

  async toggle(): Promise<void> {
    if (this.phase === 'recording' || this.phase === 'preparing') { this.stop(); return }
    if (this.phase === 'selecting') { this.reset(); return }
    if (this.phase === 'processing') { this.showResultWindow(); return }
    await this.startSelection()
  }

  async startRegion(displayId: number, selection: RecordingSelection): Promise<void> {
    validateRecordingSelection(selection)
    if (this.active) throw new Error(this.text('请先停止当前录屏。', 'Stop the current recording first.'))
    await this.startSelection({ displayId, selection })
  }

  private async startSelection(preset?: { displayId: number; selection: RecordingSelection }): Promise<void> {
    this.reset()
    this.setPhase('selecting')
    const generation = this.generation
    try {
      if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') === 'denied') {
        throw new Error(this.text('请在“系统设置 → 隐私与安全性 → 屏幕与系统音频录制”中允许 AIA，然后重新启动应用。',
          'Allow AIA in System Settings → Privacy & Security → Screen & System Audio Recording, then restart the app.'))
      }
      const displays = screen.getAllDisplays()
      let captureTimer: ReturnType<typeof setTimeout> | undefined
      const sources = await Promise.race([
        desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 2560, height: 1600 } }),
        new Promise<never>((_resolve, reject) => {
          captureTimer = setTimeout(() => reject(new Error(this.text('屏幕捕获超时。请解锁屏幕并检查屏幕录制权限。',
            'Screen capture timed out. Unlock the screen and check screen recording permission.'))), 15000)
        })
      ]).finally(() => clearTimeout(captureTimer))
      if (generation !== this.generation || this.disposed) return
      if (preset) {
        const display = displays.find((item) => item.id === preset.displayId)
        const source = sources.find((item) => item.display_id === String(preset.displayId)) ?? (displays.length === 1 ? sources[0] : undefined)
        if (!display || !source) throw new Error(this.text('所选显示器已不可用，请重新截图。', 'The selected display is unavailable. Take another screenshot.'))
        await this.prepare(display, source, preset.selection)
        void this.pruneOldRecordings().catch(console.warn)
        return
      }
      for (const display of displays) {
        const source = sources.find((item) => item.display_id === String(display.id)) ?? (displays.length === 1 ? sources[0] : undefined)
        if (!source || source.thumbnail.isEmpty()) continue
        const win = new BrowserWindow({
          ...display.bounds, show: false, frame: false, resizable: false, movable: false,
          alwaysOnTop: true, skipTaskbar: true, fullscreenable: false, enableLargerThanScreen: true,
          ...(process.platform === 'darwin' ? { type: 'panel', hiddenInMissionControl: true } : {}),
          webPreferences: { preload: this.preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: false }
        })
        this.overlays.set(win, { display, source })
        win.setAlwaysOnTop(true, 'screen-saver')
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
        win.on('closed', () => { this.overlays.delete(win) })
        win.once('ready-to-show', () => {
          win.show()
          win.setBounds(display.bounds)
          if (process.platform !== 'darwin') win.setSimpleFullScreen(true)
          if (screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id === display.id) win.focus()
        })
        loadRenderer(win, this.rendererDir, 'recordingOverlay.html')
      }
      if (!this.overlays.size) throw new Error(this.text('无法访问屏幕，请检查屏幕录制权限。', 'Cannot access the screen. Check screen recording permission.'))
      void this.pruneOldRecordings().catch(console.warn)
    } catch (error) {
      if (generation !== this.generation || this.disposed) return
      this.reset()
      void dialog.showMessageBox({ type: 'error', title: this.text('无法开始录屏', 'Cannot start recording'),
        message: error instanceof Error ? error.message : String(error) })
    }
  }

  stop(): void {
    if (this.phase === 'selecting') { this.reset(); return }
    if (this.phase === 'preparing' && !this.window) { this.reset(); return }
    if ((this.phase === 'recording' || this.phase === 'preparing') && this.window && !this.window.isDestroyed()) {
      this.closeMasks()
      this.window.webContents.send(IPC.RecordingStop)
    }
  }

  private async select(event: Electron.IpcMainInvokeEvent, selection: RecordingSelection): Promise<void> {
    const win = BrowserWindow.fromWebContents(event.sender)
    const overlay = win && this.overlays.get(win)
    if (!overlay || this.phase !== 'selecting') throw new Error('Region selection is no longer active')
    validateRecordingSelection(selection)
    await this.prepare(overlay.display, overlay.source, selection)
  }

  private async prepare(display: Electron.Display, source: Electron.DesktopCapturerSource, selection: RecordingSelection): Promise<void> {
    this.setPhase('preparing')
    const generation = this.generation
    try {
      const root = join(app.getPath('userData'), 'recordings')
      await mkdir(root, { recursive: true })
      const directory = await mkdtemp(join(root, 'recording-'))
      const file = await open(join(directory, 'capture.mp4'), 'w')
      if (generation !== this.generation || this.disposed) { await file.close(); return }
      const bounds = display.bounds
      const region = { x: bounds.x + selection.x / selection.viewportWidth * bounds.width,
        y: bounds.y + selection.y / selection.viewportHeight * bounds.height,
        width: selection.width / selection.viewportWidth * bounds.width,
        height: selection.height / selection.viewportHeight * bounds.height }
      const controls = recordingControlsBounds(region, screen.getAllDisplays().map((display) => display.workArea))
      this.session = { displayId: display.id, directory, file, writes: Promise.resolve(), writeError: null,
        init: { sourceId: source.id, selection, stopShortcut: this.getSettings().shortcuts.recordScreen, controlsHidden: !controls } }
      this.closeOverlays()
      this.showMasks(display.id, selection)
      this.window = new BrowserWindow({
        ...(controls ?? { width: 380, height: 100 }), show: false, frame: false, resizable: false,
        movable: false, alwaysOnTop: true, skipTaskbar: true, icon: this.icon,
        title: this.text('区域录屏', 'Region recording'),
        webPreferences: { preload: this.preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false }
      })
      const recorderWindow = this.window
      recorderWindow.setAlwaysOnTop(true, 'screen-saver')
      recorderWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      recorderWindow.on('close', (closeEvent) => {
        if (this.phase === 'recording' || this.phase === 'preparing' || this.phase === 'processing') {
          closeEvent.preventDefault()
          this.stop()
        }
      })
      recorderWindow.on('closed', () => {
        if (this.window === recorderWindow) this.reset()
      })
      recorderWindow.webContents.on('render-process-gone', () => {
        this.reset()
        void dialog.showMessageBox({ type: 'error', message: this.text('录屏窗口异常退出。已写入的临时视频保留在应用数据目录的 recordings 文件夹中。',
          'The recorder exited unexpectedly. Temporary video remains in the recordings folder in app data.') })
      })
      recorderWindow.once('ready-to-show', () => recorderWindow.show())
      loadRenderer(recorderWindow, this.rendererDir, 'recording.html')
    } catch (error) {
      this.reset()
      throw error
    }
  }

  private async finish(size: { width: number; height: number }): Promise<RecordingResult> {
    const session = this.session
    if (!session || !['recording', 'error'].includes(this.phase)) throw new Error('No recording to export')
    if (!Number.isInteger(size?.width) || !Number.isInteger(size?.height) || size.width < 2 || size.height < 2 || size.width > 3840 || size.height > 2160 || size.width % 2 || size.height % 2) {
      throw new Error('Invalid recording dimensions')
    }
    this.clearStopTimer()
    this.closeMasks()
    this.setPhase('processing')
    this.showResultWindow()
    try {
      await session.writes
      if (session.writeError) throw session.writeError
      await session.file?.sync()
      await session.file?.close()
      session.file = null
      const output = join(session.directory, 'recording.mp4')
      const input = join(session.directory, 'capture.mp4')
      const bytes = (await stat(input)).size
      if (bytes < 32) throw new Error('The recording did not produce any video frames')
      const check = await open(input, 'r')
      try {
        const header = Buffer.alloc(8)
        await check.read(header, 0, 8, 0)
        if (header.toString('ascii', 4, 8) !== 'ftyp') throw new Error('The recording is not a valid MP4 file')
      } finally { await check.close() }
      await rename(input, output)
      if (this.session !== session || this.disposed) throw new Error('Recording was cancelled')
      session.result = { url: pathToFileURL(output).href, width: size.width, height: size.height, bytes: (await stat(output)).size }
      this.setPhase('ready')
      return session.result
    } catch (error) {
      if (this.session === session && !this.disposed) this.setPhase('error')
      throw error
    }
  }

  private showResultWindow(): void {
    if (!this.window || this.window.isDestroyed()) return
    this.window.setAlwaysOnTop(false)
    this.window.setResizable(true)
    this.window.setMovable(true)
    this.window.setMinimumSize(560, 420)
    this.window.setSize(720, 540)
    this.window.center()
    this.window.show()
    this.window.focus()
  }

  private closeOverlays(): void {
    for (const win of this.overlays.keys()) if (!win.isDestroyed()) win.destroy()
    this.overlays.clear()
  }
  private showMasks(displayId: number, selection: RecordingSelection): void {
    for (const display of screen.getAllDisplays()) {
      const win = new BrowserWindow({
        ...display.bounds, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
        hasShadow: false, focusable: false, resizable: false, movable: false, minimizable: false,
        maximizable: false, fullscreenable: false, alwaysOnTop: true, skipTaskbar: true, enableLargerThanScreen: true,
        ...(process.platform === 'darwin' ? { type: 'panel', hiddenInMissionControl: true } : {}),
        webPreferences: { preload: this.preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: false }
      })
      this.masks.set(win, { selection: display.id === displayId ? selection : undefined })
      win.setIgnoreMouseEvents(true)
      win.setAlwaysOnTop(true, 'pop-up-menu')
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      win.once('ready-to-show', () => {
        if (win.isDestroyed()) return
        win.setBounds(display.bounds)
        win.showInactive()
      })
      win.on('closed', () => { this.masks.delete(win) })
      loadRenderer(win, this.rendererDir, 'recordingOverlay.html')
    }
  }
  private closeMasks(): void {
    for (const win of this.masks.keys()) if (!win.isDestroyed()) win.destroy()
    this.masks.clear()
  }
  private clearStopTimer(): void { if (this.stopTimer) clearTimeout(this.stopTimer); this.stopTimer = null }
  private reset(): void {
    this.generation++
    this.clearStopTimer()
    this.closeOverlays()
    this.closeMasks()
    const session = this.session
    this.session = null
    if (session) void session.writes.catch(() => {}).then(() => session.file?.close()).catch(console.warn)
    const win = this.window
    this.window = null
    if (win && !win.isDestroyed()) win.destroy()
    this.setPhase('idle')
  }
  private async pruneOldRecordings(): Promise<void> {
    const root = join(app.getPath('userData'), 'recordings')
    const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('recording-')) continue
      const directory = join(root, entry.name)
      if (directory === this.session?.directory) continue
      if (Date.now() - (await stat(directory)).mtimeMs > 7 * 24 * 60 * 60 * 1000) await rm(directory, { recursive: true, force: true })
    }
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    screen.removeListener('display-added', this.onDisplayChanged)
    screen.removeListener('display-removed', this.onDisplayChanged)
    screen.removeListener('display-metrics-changed', this.onDisplayChanged)
    powerMonitor.removeListener('lock-screen', this.onLock)
    this.reset()
  }
}
