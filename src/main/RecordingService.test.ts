import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppSettings } from '@shared/types'
import { IPC } from '@shared/ipc'

const harness = vi.hoisted(() => ({
  root: '', windows: [] as Electron.BrowserWindow[],
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Window extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), { send: vi.fn() })
    destroyed = false
    show = vi.fn(); hide = vi.fn(); focus = vi.fn(); center = vi.fn()
    setBounds = vi.fn(); setAlwaysOnTop = vi.fn(); setVisibleOnAllWorkspaces = vi.fn()
    setSimpleFullScreen = vi.fn(); setResizable = vi.fn(); setMovable = vi.fn()
    setMinimumSize = vi.fn(); setSize = vi.fn()
    loadFile = vi.fn(); loadURL = vi.fn()
    constructor() { super(); harness.windows.push(this as unknown as Electron.BrowserWindow) }
    isDestroyed() { return this.destroyed }
    destroy() { this.destroyed = true; this.emit('closed') }
    static fromWebContents(sender: Electron.WebContents) { return harness.windows.find((win) => win.webContents === sender) }
  }
  const bounds = { x: 0, y: 0, width: 1440, height: 900 }
  return {
    app: { getPath: () => harness.root }, BrowserWindow: Window,
    ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => harness.handlers.set(name, handler) },
    screen: Object.assign(new EventEmitter(), {
      getAllDisplays: vi.fn(() => [{ id: 1, bounds, workArea: bounds }]),
      getDisplayNearestPoint: () => ({ id: 1 }), getCursorScreenPoint: () => ({ x: 100, y: 100 })
    }),
    powerMonitor: new EventEmitter(),
    desktopCapturer: { getSources: vi.fn(async () => [{ id: 'screen:1:0', display_id: '1',
      thumbnail: { isEmpty: () => false, toDataURL: () => 'data:image/png;base64,AA==' } }]) },
    dialog: { showSaveDialog: vi.fn(async () => ({ canceled: true })), showMessageBox: vi.fn(async () => ({ response: 0 })) },
    systemPreferences: { getMediaAccessStatus: vi.fn(() => 'granted') }
  }
})
vi.mock('./recordingClipboard', () => ({ copyRecordingFile: vi.fn(async () => {}) }))
import { dialog, powerMonitor, screen } from 'electron'
import { copyRecordingFile } from './recordingClipboard'
import { RecordingService } from './RecordingService'

describe('region recording lifecycle and file handling', () => {
  let service: RecordingService
  const selection = { x: 50, y: 50, width: 600, height: 400, viewportWidth: 1440, viewportHeight: 900 }
  const invoke = (name: string, sender?: Electron.BrowserWindow, ...args: unknown[]) =>
    harness.handlers.get(name)!({ sender: sender?.webContents }, ...args)
  const start = async (fullscreen = false) => {
    await service.toggle()
    const overlay = harness.windows.at(-1)!
    await invoke(IPC.RecordingSelect, overlay, fullscreen ? { ...selection, x: 0, y: 0, width: 1440, height: 900 } : selection)
    const recorder = harness.windows.at(-1)!
    await invoke(IPC.RecordingStarted, recorder)
    return recorder
  }
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(48)])

  beforeEach(async () => {
    vi.clearAllMocks()
    harness.root = await mkdtemp(join(tmpdir(), 'aia-recording-test-'))
    harness.windows = []
    harness.handlers.clear()
    service = new RecordingService(() => ({ language: 'zh-CN', shortcuts: { recordScreen: 'CommandOrControl+Shift+R' } }) as AppSettings,
      'preload.mjs', 'renderer', {} as Electron.NativeImage, vi.fn())
    service.registerIpc()
  })
  afterEach(async () => {
    service.dispose()
    // Wait for queued file handles to close before deleting this test's own directory.
    await new Promise((resolve) => setImmediate(resolve))
    await rm(harness.root, { recursive: true, force: true })
  })

  it('preserves chunk order, finalizes MP4, copies the file and saves it with an extension', async () => {
    const recorder = await start()
    const first = invoke(IPC.RecordingAppend, recorder, new Uint8Array(mp4.subarray(0, 30)))
    const second = invoke(IPC.RecordingAppend, recorder, new Uint8Array(mp4.subarray(30)))
    await Promise.all([first, second])
    const result = await invoke(IPC.RecordingFinish, recorder, { width: 1200, height: 800 }) as { url: string; bytes: number }
    expect(result.bytes).toBe(mp4.length)
    expect(await readFile(new URL(result.url))).toEqual(mp4)
    await invoke(IPC.RecordingCopy, recorder)
    expect(copyRecordingFile).toHaveBeenCalledWith(new URL(result.url).pathname)
    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: true, filePath: '' })
    expect(await invoke(IPC.RecordingSave, recorder)).toBe(false)
    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath: join(harness.root, 'saved') })
    expect(await invoke(IPC.RecordingSave, recorder)).toBe(true)
    expect(await readFile(join(harness.root, 'saved.mp4'))).toEqual(mp4)
    await invoke(IPC.RecordingCancel, recorder)
    expect(await readFile(new URL(result.url))).toEqual(mp4) // clipboard target survives preview close
  })

  it('rejects other windows, malformed selections and chunks before recording', async () => {
    await service.toggle()
    const overlay = harness.windows.at(-1)!
    await expect(invoke(IPC.RecordingSelect, overlay, { ...selection, x: NaN })).rejects.toThrow('Invalid recording region')
    expect(() => invoke(IPC.RecordingAppend, overlay, new Uint8Array(32))).toThrow('Invalid recording window')
    await invoke(IPC.RecordingSelect, overlay, selection)
    const recorder = harness.windows.at(-1)!
    expect(() => invoke(IPC.RecordingAppend, recorder, new Uint8Array(32))).toThrow('Invalid recording data')
    expect(() => invoke(IPC.RecordingReady, overlay)).toThrow('Invalid recording window')
    await invoke(IPC.RecordingCancel, recorder)
    expect(service.active).toBe(false)
  })

  it('hides controls for fullscreen and stops when the screen locks', async () => {
    const recorder = await start(true)
    expect(recorder.hide).toHaveBeenCalled()
    powerMonitor.emit('lock-screen')
    expect(recorder.webContents.send).toHaveBeenCalledWith(IPC.RecordingStop)
  })

  it('stops when the recorded display changes', async () => {
    const recorder = await start()
    screen.emit('display-metrics-changed', {}, { id: 1 }, ['rotation'])
    expect(recorder.webContents.send).toHaveBeenCalledWith(IPC.RecordingStop)
  })

  it('rejects empty or mislabeled recordings and retains temporary data', async () => {
    const recorder = await start()
    await invoke(IPC.RecordingAppend, recorder, new Uint8Array(64))
    await expect(invoke(IPC.RecordingFinish, recorder, { width: 1200, height: 800 })).rejects.toThrow('not a valid MP4')
    const directories = await readdir(join(harness.root, 'recordings'))
    expect((await readFile(join(harness.root, 'recordings', directories[0], 'capture.mp4'))).length).toBe(64)
    expect(service.active).toBe(false)
  })

  it('cancels selectors and destroys an active recorder during app shutdown', async () => {
    await service.toggle()
    const overlay = harness.windows.at(-1)!
    await service.toggle()
    expect(overlay.isDestroyed()).toBe(true)
    const recorder = await start()
    service.dispose()
    expect(recorder.isDestroyed()).toBe(true)
    expect(service.active).toBe(false)
  })
})
