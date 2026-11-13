import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { RecordingInit, RecordingOverlayInit, RecordingResult, RecordingSelection } from '@shared/recording'
import type {
  ActionPayload,
  AiChunkPayload,
  AiStreamRequest,
  AppSettings,
  LastSelection,
  PreWindowEntry,
  ReplaceSelectionResult,
  SelectedTextPayload,
  SettingsPatch
} from '@shared/types'

const api = {
  recording: {
    start: (): Promise<void> => ipcRenderer.invoke(IPC.RecordingStart),
    overlayReady: (): Promise<RecordingOverlayInit> => ipcRenderer.invoke(IPC.RecordingOverlayReady),
    select: (selection: RecordingSelection): Promise<void> => ipcRenderer.invoke(IPC.RecordingSelect, selection),
    cancel: (): Promise<void> => ipcRenderer.invoke(IPC.RecordingCancel),
    ready: (): Promise<RecordingInit> => ipcRenderer.invoke(IPC.RecordingReady),
    started: (): Promise<void> => ipcRenderer.invoke(IPC.RecordingStarted),
    append: (data: Uint8Array): Promise<void> => ipcRenderer.invoke(IPC.RecordingAppend, data),
    finish: (size: { width: number; height: number }): Promise<RecordingResult> => ipcRenderer.invoke(IPC.RecordingFinish, size),
    failed: (): Promise<void> => ipcRenderer.invoke(IPC.RecordingFailed),
    save: (): Promise<boolean> => ipcRenderer.invoke(IPC.RecordingSave),
    copy: (): Promise<boolean> => ipcRenderer.invoke(IPC.RecordingCopy),
    onStop: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on(IPC.RecordingStop, listener)
      return () => { ipcRenderer.off(IPC.RecordingStop, listener) }
    }
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SettingsGet),
    update: (patch: SettingsPatch): Promise<AppSettings> => ipcRenderer.invoke(IPC.SettingsUpdate, patch),
    onChanged: (callback: (settings: AppSettings) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, settings: AppSettings) => callback(settings)
      ipcRenderer.on(IPC.SettingsChanged, listener)
      return () => {
        ipcRenderer.off(IPC.SettingsChanged, listener)
      }
    }
  },
  selection: {
    start: (): Promise<boolean> => ipcRenderer.invoke(IPC.SelectionStart),
    stop: (): Promise<void> => ipcRenderer.invoke(IPC.SelectionStop),
    hideToolbar: (): Promise<void> => ipcRenderer.invoke(IPC.SelectionHideToolbar),
    writeClipboard: (text: string): Promise<boolean> => ipcRenderer.invoke(IPC.SelectionWriteClipboard, text),
    replaceSelection: (payload: {
      text: string
      selectedText: string
      programName?: string
      hwnd?: number | null
    }): Promise<ReplaceSelectionResult> => ipcRenderer.invoke(IPC.SelectionReplaceSelection, payload),
    determineToolbarSize: (width: number): Promise<void> => ipcRenderer.invoke(IPC.SelectionDetermineToolbarSize, width),
    processAction: (payload: ActionPayload): Promise<void> => ipcRenderer.invoke(IPC.SelectionProcessAction, payload),
    getAccessibility: (): Promise<boolean> => ipcRenderer.invoke(IPC.SelectionGetAccessibility),
    requestAccessibility: (): Promise<boolean> => ipcRenderer.invoke(IPC.SelectionRequestAccessibility),
    onSelected: (callback: (payload: SelectedTextPayload) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: SelectedTextPayload) => callback(payload)
      ipcRenderer.on(IPC.SelectionSelected, listener)
      return () => {
        ipcRenderer.off(IPC.SelectionSelected, listener)
      }
    },
    onVisibility: (callback: (visible: boolean) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, visible: boolean) => callback(visible)
      ipcRenderer.on(IPC.SelectionVisibility, listener)
      return () => {
        ipcRenderer.off(IPC.SelectionVisibility, listener)
      }
    },
    onAction: (callback: (payload: ActionPayload) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: ActionPayload) => callback(payload)
      ipcRenderer.on(IPC.SelectionProcessAction, listener)
      return () => {
        ipcRenderer.off(IPC.SelectionProcessAction, listener)
      }
    },
    // The payload a freshly-created action window is opened with. Read
    // synchronously during the first render so content is on screen before the
    // window is shown — no push/listener race, no empty-frame flash.
    getInitialAction: (): ActionPayload | null => ipcRenderer.sendSync(IPC.SelectionGetInitialAction) ?? null
  },
  ai: {
    stream: (request: AiStreamRequest): Promise<void> => ipcRenderer.invoke(IPC.AiStream, request),
    abort: (requestId: string): Promise<void> => ipcRenderer.invoke(IPC.AiAbort, requestId),
    listModels: (providerTemplateId?: string): Promise<string[]> => ipcRenderer.invoke(IPC.AiListModels, providerTemplateId),
    testModel: (providerTemplateId?: string): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.AiTestModel, providerTemplateId),
    onChunk: (callback: (payload: AiChunkPayload) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: AiChunkPayload) => callback(payload)
      ipcRenderer.on(IPC.AiChunk, listener)
      return () => {
        ipcRenderer.off(IPC.AiChunk, listener)
      }
    }
  },
  speech: {
    speak: (text: string): Promise<boolean> => ipcRenderer.invoke(IPC.SpeechSpeak, text),
    stop: (): Promise<void> => ipcRenderer.invoke(IPC.SpeechStop)
  },
  hotkeyCapture: {
    start: (): Promise<number | null> => ipcRenderer.invoke(IPC.HotkeyCaptureStart),
    stop: (): Promise<void> => ipcRenderer.invoke(IPC.HotkeyCaptureStop),
    onCaptured: (callback: (token: number, accelerator: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, token: number, accelerator: string) => callback(token, accelerator)
      ipcRenderer.on(IPC.HotkeyCaptured, listener)
      return () => {
        ipcRenderer.off(IPC.HotkeyCaptured, listener)
      }
    }
  },
  windowControls: {
    close: (): Promise<void> => ipcRenderer.invoke(IPC.WindowClose),
    minimize: (): Promise<void> => ipcRenderer.invoke(IPC.WindowMinimize),
    pin: (pinned: boolean): Promise<void> => ipcRenderer.invoke(IPC.WindowPin, pinned)
  },
  app: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.OpenExternal, url),
    readClipboardImage: (): Promise<string | null> => ipcRenderer.invoke(IPC.ClipboardReadImage)
  },
  preWindow: {
    save: (entry: { text: string; programName?: string }): Promise<PreWindowEntry> =>
      ipcRenderer.invoke(IPC.PreWindowSave, entry),
    list: (): Promise<PreWindowEntry[]> => ipcRenderer.invoke(IPC.PreWindowList),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.PreWindowRemove, id),
    onChange: (callback: () => void): (() => void) => {
      const listener = () => callback()
      ipcRenderer.on(IPC.PreWindowChanged, listener)
      return () => ipcRenderer.removeListener(IPC.PreWindowChanged, listener)
    }
  },
  context: {
    getLastSelection: (): Promise<LastSelection | null> => ipcRenderer.invoke(IPC.LastSelectionGet)
  },
  chat: {
    open: (): Promise<void> => ipcRenderer.invoke(IPC.ChatOpen)
  },
  screenshot: {
    start: (): Promise<void> => ipcRenderer.invoke(IPC.ScreenshotStart),
    overlayReady: (): Promise<void> => ipcRenderer.invoke(IPC.ScreenshotOverlayReady),
    overlayConfirm: (payload: {
      displayId: number
      x: number
      y: number
      width: number
      height: number
      viewportWidth: number
      viewportHeight: number
      action: 'explain' | 'save' | 'copy' | 'pin'
      imageDataUrl?: string
    }): Promise<void> => ipcRenderer.invoke(IPC.ScreenshotOverlayConfirm, payload),
    overlayCancel: (): Promise<void> => ipcRenderer.invoke(IPC.ScreenshotOverlayCancel),
    save: (dataUrl: string): Promise<boolean> => ipcRenderer.invoke(IPC.ScreenshotSave, dataUrl),
    copy: (dataUrl: string): Promise<boolean> => ipcRenderer.invoke(IPC.ScreenshotCopy, dataUrl),
    pin: (dataUrl: string): Promise<void> => ipcRenderer.invoke(IPC.ScreenshotPin, dataUrl),
    pinZoom: (deltaY: number): Promise<void> => ipcRenderer.invoke(IPC.ScreenshotPinZoom, deltaY),
    pinMove: (dx: number, dy: number): Promise<void> => ipcRenderer.invoke(IPC.ScreenshotPinMove, dx, dy),
    pinMenu: (): Promise<void> => ipcRenderer.invoke(IPC.ScreenshotPinMenu),
    onOverlayInit: (callback: (payload: { imageDataUrl: string; displayId: number; width: number; height: number; imageWidth: number; imageHeight: number }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { imageDataUrl: string; displayId: number; width: number; height: number; imageWidth: number; imageHeight: number }) => callback(payload)
      ipcRenderer.on(IPC.ScreenshotOverlayInit, listener)
      return () => {
        ipcRenderer.off(IPC.ScreenshotOverlayInit, listener)
      }
    },
    onPreviewInit: (callback: (payload: { imageDataUrl: string; width: number; height: number }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { imageDataUrl: string; width: number; height: number }) => callback(payload)
      ipcRenderer.on(IPC.ScreenshotPreviewInit, listener)
      return () => {
        ipcRenderer.off(IPC.ScreenshotPreviewInit, listener)
      }
    },
    onPinInit: (callback: (payload: { imageDataUrl: string; width: number; height: number }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { imageDataUrl: string; width: number; height: number }) => callback(payload)
      ipcRenderer.on(IPC.ScreenshotPinInit, listener)
      return () => {
        ipcRenderer.off(IPC.ScreenshotPinInit, listener)
      }
    }
  }
}

contextBridge.exposeInMainWorld('assistantLite', api)

export type AssistantLiteApi = typeof api
