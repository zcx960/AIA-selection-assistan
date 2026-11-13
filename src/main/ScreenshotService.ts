import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  screen
} from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import type { AppSettings } from '@shared/types'
import { validateRecordingSelection, type RecordingSelection } from '@shared/recording'
import { loadRenderer } from './loadRenderer'
import { isMac } from './platform'

export interface OverlayInitPayload {
  imageDataUrl: string
  displayId: number
  // Display size in logical CSS pixels (rotation-aware)
  width: number
  height: number
  // Actual pixel dimensions of the captured image (may differ from
  // display.size * scaleFactor on Windows / rotated displays).
  imageWidth: number
  imageHeight: number
}

export type OverlayAction = 'explain' | 'save' | 'copy' | 'pin' | 'record'

export interface OverlayConfirmPayload {
  displayId: number
  // Selection rect in CSS pixels of the overlay window viewport
  x: number
  y: number
  width: number
  height: number
  // Overlay viewport size (window.innerWidth/innerHeight) so main can
  // compute the correct crop ratio against the actual image pixels.
  viewportWidth: number
  viewportHeight: number
  action: OverlayAction
  // Optional pre-rasterized image (already cropped + annotated by the
  // renderer). When present we use this directly and skip cropping.
  imageDataUrl?: string
}

export interface PreviewInitPayload {
  imageDataUrl: string
  width: number
  height: number
}

interface DisplayCapture {
  display: Electron.Display
  image: Electron.NativeImage
  dataUrl: string
}

const PREVIEW_DEFAULT_WIDTH = 560
const PREVIEW_DEFAULT_HEIGHT = 520
const PREVIEW_SHADOW_PADDING = 18

interface PinState {
  dataUrl: string
  baseWidth: number
  baseHeight: number
  aspectRatio: number
  scale: number
  minScale: number
  maxScale: number
}

export class ScreenshotService {
  private overlayWindow: BrowserWindow | null = null
  private previewWindow: BrowserWindow | null = null
  private pinWindows = new Map<BrowserWindow, PinState>()
  private currentCapture: DisplayCapture | null = null
  private capturing = false

  constructor(
    private getSettings: () => AppSettings,
    private preloadPath: string,
    private rendererDir: string,
    private windowIcon: Electron.NativeImage,
    private startRecording: (displayId: number, selection: RecordingSelection) => Promise<void>
  ) {}

  registerIpc(): void {
    ipcMain.handle(IPC.ScreenshotStart, () => this.startCapture())
    ipcMain.handle(IPC.ScreenshotOverlayReady, (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && win === this.overlayWindow && this.currentCapture) {
        const imageSize = this.currentCapture.image.getSize()
        const payload: OverlayInitPayload = {
          imageDataUrl: this.currentCapture.dataUrl,
          displayId: this.currentCapture.display.id,
          width: this.currentCapture.display.size.width,
          height: this.currentCapture.display.size.height,
          imageWidth: imageSize.width,
          imageHeight: imageSize.height
        }
        event.sender.send(IPC.ScreenshotOverlayInit, payload)
      }
    })
    ipcMain.handle(IPC.ScreenshotOverlayConfirm, (event, payload: OverlayConfirmPayload) => {
      if (event.sender !== this.overlayWindow?.webContents || payload?.displayId !== this.currentCapture?.display.id) {
        throw new Error('Invalid screenshot window')
      }
      return this.handleOverlayConfirm(payload)
    })
    ipcMain.handle(IPC.ScreenshotOverlayCancel, () => this.closeOverlay())
    ipcMain.handle(IPC.ScreenshotSave, (_event, dataUrl: string) => this.saveImage(dataUrl))
    ipcMain.handle(IPC.ScreenshotCopy, (_event, dataUrl: string) => this.copyImage(dataUrl))
    ipcMain.handle(IPC.ScreenshotPin, (_event, dataUrl: string) => this.pinImage(dataUrl))
    ipcMain.handle(IPC.ScreenshotPinZoom, (event, deltaY: number) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win) this.zoomPin(win, deltaY)
    })
    ipcMain.handle(IPC.ScreenshotPinMove, (event, dx: number, dy: number) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) return
      const bounds = win.getBounds()
      win.setPosition(Math.round(bounds.x + dx), Math.round(bounds.y + dy), false)
    })
    ipcMain.handle(IPC.ScreenshotPinMenu, (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win) this.showPinMenu(win)
    })
  }

  dispose(): void {
    this.closeOverlay()
    if (this.previewWindow && !this.previewWindow.isDestroyed()) this.previewWindow.close()
    this.previewWindow = null
    for (const win of this.pinWindows.keys()) {
      if (!win.isDestroyed()) win.close()
    }
    this.pinWindows.clear()
  }

  async startCapture(): Promise<void> {
    if (this.capturing) return
    this.capturing = true
    try {
      const cursor = screen.getCursorScreenPoint()
      const display = screen.getDisplayNearestPoint(cursor)
      const scale = display.scaleFactor || 1
      const { width, height } = display.size

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.round(width * scale),
          height: Math.round(height * scale)
        }
      })
      const source =
        sources.find((item) => item.display_id === String(display.id)) ?? sources[0]
      if (!source || source.thumbnail.isEmpty()) {
        throw new Error('No screen source available')
      }

      this.currentCapture = {
        display,
        image: source.thumbnail,
        dataUrl: source.thumbnail.toDataURL()
      }
      this.openOverlay(display)
    } catch (error) {
      console.error('Screenshot capture failed', error)
      this.currentCapture = null
    } finally {
      this.capturing = false
    }
  }

  private openOverlay(display: Electron.Display): void {
    this.closeOverlay()
    const { x, y, width, height } = display.bounds
    this.overlayWindow = new BrowserWindow({
      x,
      y,
      width,
      height,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      enableLargerThanScreen: true,
      ...(isMac ? { type: 'panel' as const, hiddenInMissionControl: true, acceptFirstMouse: true } : {}),
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })
    this.overlayWindow.setAlwaysOnTop(true, 'screen-saver')
    this.overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    const overlay = this.overlayWindow
    overlay.on('closed', () => {
      if (this.overlayWindow === overlay) this.overlayWindow = null
    })

    loadRenderer(overlay, this.rendererDir, 'screenshotOverlay.html')
    overlay.once('ready-to-show', () => {
      overlay.show()
      // On Windows the taskbar will otherwise float above a normal
      // top-most window. Re-asserting bounds + simple fullscreen
      // forces the overlay to truly cover the whole display.
      if (!isMac) {
        overlay.setBounds(display.bounds)
        try {
          overlay.setSimpleFullScreen(true)
        } catch {
          // ignore — older Electron may not support it
        }
      }
      overlay.focus()
    })
  }

  private closeOverlay(): void {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.close()
    }
    this.overlayWindow = null
  }

  private async handleOverlayConfirm(payload: OverlayConfirmPayload): Promise<void> {
    const capture = this.currentCapture
    if (payload.action === 'record' && capture) {
      const selection = validateRecordingSelection({ x: payload.x, y: payload.y, width: payload.width, height: payload.height,
        viewportWidth: payload.viewportWidth, viewportHeight: payload.viewportHeight })
      this.closeOverlay()
      this.currentCapture = null
      try { await this.startRecording(capture.display.id, selection) }
      catch (error) {
        void dialog.showMessageBox({ type: 'error',
          title: this.getSettings().language === 'zh-CN' ? '无法开始录屏' : 'Cannot start recording',
          message: error instanceof Error ? error.message : String(error) })
      }
      return
    }
    this.closeOverlay()
    if (!capture) return

    let dataUrl: string
    let size: { width: number; height: number }

    if (payload.imageDataUrl) {
      // Renderer has already rasterized the crop (with annotations).
      const image = nativeImage.createFromDataURL(payload.imageDataUrl)
      this.currentCapture = null
      if (image.isEmpty()) return
      dataUrl = payload.imageDataUrl
      size = image.getSize()
    } else {
      // Map selection from overlay-viewport CSS pixels to the actual captured
      // image pixels using the real viewport/image ratio. This is robust to
      // DPI scaling, display rotation, and any minor window-size mismatch
      // (e.g. Windows truncating the taskbar region).
      const imageSize = capture.image.getSize()
      const vpW = Math.max(1, payload.viewportWidth || capture.display.size.width)
      const vpH = Math.max(1, payload.viewportHeight || capture.display.size.height)
      const scaleX = imageSize.width / vpW
      const scaleY = imageSize.height / vpH
      const cropX = Math.max(0, Math.min(imageSize.width - 1, Math.round(payload.x * scaleX)))
      const cropY = Math.max(0, Math.min(imageSize.height - 1, Math.round(payload.y * scaleY)))
      const cropW = Math.max(1, Math.min(imageSize.width - cropX, Math.round(payload.width * scaleX)))
      const cropH = Math.max(1, Math.min(imageSize.height - cropY, Math.round(payload.height * scaleY)))
      const cropped = capture.image.crop({ x: cropX, y: cropY, width: cropW, height: cropH })
      this.currentCapture = null
      if (cropped.isEmpty()) return
      dataUrl = cropped.toDataURL()
      size = cropped.getSize()
    }

    switch (payload.action) {
      case 'save':
        await this.saveImage(dataUrl)
        return
      case 'copy':
        this.copyImage(dataUrl)
        return
      case 'pin':
        this.pinImage(dataUrl)
        return
      case 'explain':
      default:
        this.openPreview({ imageDataUrl: dataUrl, width: size.width, height: size.height })
    }
  }

  private openPreview(payload: PreviewInitPayload): void {
    if (this.previewWindow && !this.previewWindow.isDestroyed()) {
      this.previewWindow.close()
    }
    this.previewWindow = new BrowserWindow({
      width: PREVIEW_DEFAULT_WIDTH + PREVIEW_SHADOW_PADDING * 2,
      height: PREVIEW_DEFAULT_HEIGHT + PREVIEW_SHADOW_PADDING * 2,
      minWidth: 380 + PREVIEW_SHADOW_PADDING * 2,
      minHeight: 360 + PREVIEW_SHADOW_PADDING * 2,
      icon: this.windowIcon,
      title: 'AIA划词助手',
      autoHideMenuBar: true,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: PREVIEW_SHADOW_PADDING + 12, y: PREVIEW_SHADOW_PADDING + 10 },
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })
    const win = this.previewWindow
    win.on('closed', () => {
      if (this.previewWindow === win) this.previewWindow = null
    })
    loadRenderer(win, this.rendererDir, 'screenshotPreview.html')
    win.webContents.once('did-finish-load', () => {
      win.webContents.send(IPC.ScreenshotPreviewInit, payload)
      win.show()
      win.focus()
    })
  }

  private async saveImage(dataUrl: string): Promise<boolean> {
    const image = nativeImage.createFromDataURL(dataUrl)
    if (image.isEmpty()) {
      console.warn('[screenshot] saveImage: empty image')
      return false
    }
    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .slice(0, 19)
    const downloads = (() => {
      try {
        return app.getPath('downloads')
      } catch {
        return app.getPath('home')
      }
    })()
    const defaultPath = join(downloads, `screenshot-${stamp}.png`)
    const options = {
      title: 'Save Screenshot',
      defaultPath,
      filters: [{ name: 'PNG Image', extensions: ['png'] }]
    }

    // Bring our app to the front before showing the dialog. When save is
    // triggered from the overlay (which is a macOS panel), the overlay closes
    // and the dialog can otherwise open behind whatever app was previously
    // focused, looking like "nothing happened".
    try {
      app.focus({ steal: true })
    } catch {
      // ignore — older Electron may not support this signature
    }

    const parent = this.previewWindow && !this.previewWindow.isDestroyed() ? this.previewWindow : undefined

    try {
      const result = parent
        ? await dialog.showSaveDialog(parent, options)
        : await dialog.showSaveDialog(options)
      if (result.canceled || !result.filePath) return false
      await writeFile(result.filePath, image.toPNG())
      return true
    } catch (error) {
      console.error('[screenshot] saveImage failed:', error)
      return false
    }
  }

  private copyImage(dataUrl: string): boolean {
    const image = nativeImage.createFromDataURL(dataUrl)
    if (image.isEmpty()) return false
    clipboard.writeImage(image)
    return true
  }

  private pinImage(dataUrl: string): void {
    const image = nativeImage.createFromDataURL(dataUrl)
    if (image.isEmpty()) return
    const cursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursor)
    const sf = display.scaleFactor || 1
    const bitmap = image.getSize()
    // bitmap is in physical pixels; window units are logical
    const baseW = Math.max(40, Math.round(bitmap.width / sf))
    const baseH = Math.max(40, Math.round(bitmap.height / sf))
    const aspect = baseW / baseH

    // Initial scale: 1 if it fits, otherwise shrink to fit work area
    const fitW = display.workArea.width * 0.95
    const fitH = display.workArea.height * 0.95
    const initScale = Math.min(1, fitW / baseW, fitH / baseH)
    const winW = Math.round(baseW * initScale)
    const winH = Math.round(baseH * initScale)

    const pin = new BrowserWindow({
      width: winW,
      height: winH,
      x: Math.max(display.workArea.x, cursor.x - Math.round(winW / 2)),
      y: Math.max(display.workArea.y, cursor.y - Math.round(winH / 2)),
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      ...(isMac ? { type: 'panel' as const, hiddenInMissionControl: true, acceptFirstMouse: true } : {}),
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })
    pin.setAlwaysOnTop(true, isMac ? 'floating' : 'pop-up-menu')

    const minScale = Math.max(0.1, 40 / Math.min(baseW, baseH))
    const maxScale = Math.min(8, Math.max(display.workArea.width, display.workArea.height) / Math.max(baseW, baseH))
    this.pinWindows.set(pin, {
      dataUrl,
      baseWidth: baseW,
      baseHeight: baseH,
      aspectRatio: aspect,
      scale: initScale,
      minScale,
      maxScale
    })
    pin.on('closed', () => this.pinWindows.delete(pin))
    loadRenderer(pin, this.rendererDir, 'screenshotPin.html')
    pin.webContents.once('did-finish-load', () => {
      // Re-assert alwaysOnTop after content loads — on Windows the initial
      // call can be lost for transparent windows, causing the pin to fall
      // behind all other windows.
      if (!isMac) pin.setAlwaysOnTop(true, 'pop-up-menu')
      pin.webContents.send(IPC.ScreenshotPinInit, { imageDataUrl: dataUrl, width: baseW, height: baseH })
    })
  }

  private zoomPin(win: BrowserWindow, deltaY: number): void {
    const state = this.pinWindows.get(win)
    if (!state || win.isDestroyed()) return
    // wheel up (negative deltaY) = zoom in
    const factor = Math.exp(-deltaY * 0.0015)
    const next = Math.max(state.minScale, Math.min(state.maxScale, state.scale * factor))
    if (Math.abs(next - state.scale) < 1e-3) return
    state.scale = next
    const bounds = win.getBounds()
    const newW = Math.max(40, Math.round(state.baseWidth * next))
    const newH = Math.max(40, Math.round(state.baseHeight * next))
    // Keep window centered around its current center
    const cx = bounds.x + bounds.width / 2
    const cy = bounds.y + bounds.height / 2
    win.setBounds({
      x: Math.round(cx - newW / 2),
      y: Math.round(cy - newH / 2),
      width: newW,
      height: newH
    })
  }

  private showPinMenu(win: BrowserWindow): void {
    const state = this.pinWindows.get(win)
    if (!state) return
    const language = this.getSettings().language
    const isZh = language === 'zh-CN'
    const labels = isZh
      ? { explain: 'AI 识图', copy: '复制图片', save: '保存图片', opacity: '透明度', reset: '重置大小', close: '关闭' }
      : { explain: 'AI Explain', copy: 'Copy image', save: 'Save image', opacity: 'Opacity', reset: 'Reset size', close: 'Close' }

    const opacityLevels = [1.0, 0.8, 0.6, 0.4, 0.2]
    const currentOpacity = win.getOpacity()

    const menu = Menu.buildFromTemplate([
      {
        label: labels.explain,
        click: () => {
          this.openPreview({
            imageDataUrl: state.dataUrl,
            width: state.baseWidth,
            height: state.baseHeight
          })
        }
      },
      {
        label: labels.copy,
        click: () => this.copyImage(state.dataUrl)
      },
      {
        label: labels.save,
        click: () => void this.saveImage(state.dataUrl)
      },
      { type: 'separator' },
      {
        label: labels.opacity,
        submenu: opacityLevels.map((value) => ({
          label: `${Math.round(value * 100)}%`,
          type: 'radio' as const,
          checked: Math.abs(currentOpacity - value) < 0.05,
          click: () => win.setOpacity(value)
        }))
      },
      {
        label: labels.reset,
        click: () => this.resetPinScale(win)
      },
      { type: 'separator' },
      {
        label: labels.close,
        click: () => {
          if (!win.isDestroyed()) win.close()
        }
      }
    ])
    menu.popup({ window: win })
  }

  private resetPinScale(win: BrowserWindow): void {
    const state = this.pinWindows.get(win)
    if (!state || win.isDestroyed()) return
    state.scale = 1
    const bounds = win.getBounds()
    const cx = bounds.x + bounds.width / 2
    const cy = bounds.y + bounds.height / 2
    win.setBounds({
      x: Math.round(cx - state.baseWidth / 2),
      y: Math.round(cy - state.baseHeight / 2),
      width: state.baseWidth,
      height: state.baseHeight
    })
    win.setOpacity(1)
  }
}
