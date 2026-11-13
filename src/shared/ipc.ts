export const IPC = {
  SettingsGet: 'settings:get',
  SettingsUpdate: 'settings:update',
  SettingsChanged: 'settings:changed',

  SelectionStart: 'selection:start',
  SelectionStop: 'selection:stop',
  SelectionSelected: 'selection:selected',
  SelectionVisibility: 'selection:visibility',
  SelectionHideToolbar: 'selection:hide-toolbar',
  SelectionDetermineToolbarSize: 'selection:determine-toolbar-size',
  SelectionProcessAction: 'selection:process-action',
  SelectionGetInitialAction: 'selection:get-initial-action',
  SelectionWriteClipboard: 'selection:write-clipboard',
  SelectionReplaceSelection: 'selection:replace-selection',
  SelectionGetAccessibility: 'selection:get-accessibility',
  SelectionRequestAccessibility: 'selection:request-accessibility',

  AiStream: 'ai:stream',
  AiChunk: 'ai:chunk',
  AiAbort: 'ai:abort',
  AiListModels: 'ai:list-models',
  AiTestModel: 'ai:test-model',
  AcpDetect: 'acp:detect',

  SpeechSpeak: 'speech:speak',
  SpeechStop: 'speech:stop',

  WindowClose: 'window:close',
  WindowMinimize: 'window:minimize',
  WindowPin: 'window:pin',
  OpenExternal: 'app:open-external',

  ClipboardReadImage: 'clipboard:read-image',

  PreWindowSave: 'pre-window:save',
  PreWindowList: 'pre-window:list',
  PreWindowRemove: 'pre-window:remove',
  PreWindowChanged: 'pre-window:changed',
  LastSelectionGet: 'context:last-selection',

  ChatOpen: 'chat:open',

  RecordingStart: 'recording:start',
  RecordingOverlayReady: 'recording:overlay-ready',
  RecordingSelect: 'recording:select',
  RecordingCancel: 'recording:cancel',
  RecordingReady: 'recording:ready',
  RecordingStarted: 'recording:started',
  RecordingAppend: 'recording:append',
  RecordingFinish: 'recording:finish',
  RecordingFailed: 'recording:failed',
  RecordingStop: 'recording:stop',
  RecordingSave: 'recording:save',
  RecordingCopy: 'recording:copy',

  ScreenshotStart: 'screenshot:start',
  ScreenshotOverlayReady: 'screenshot:overlay-ready',
  ScreenshotOverlayInit: 'screenshot:overlay-init',
  ScreenshotOverlayConfirm: 'screenshot:overlay-confirm',
  ScreenshotOverlayCancel: 'screenshot:overlay-cancel',
  ScreenshotPreviewInit: 'screenshot:preview-init',
  ScreenshotSave: 'screenshot:save',
  ScreenshotCopy: 'screenshot:copy',
  ScreenshotPin: 'screenshot:pin',
  ScreenshotPinInit: 'screenshot:pin-init',
  ScreenshotPinZoom: 'screenshot:pin-zoom',
  ScreenshotPinMove: 'screenshot:pin-move',
  ScreenshotPinMenu: 'screenshot:pin-menu',
  ScreenshotExplain: 'screenshot:explain',

  HotkeyCaptureStart: 'hotkey-capture:start',
  HotkeyCaptureStop: 'hotkey-capture:stop',
  HotkeyCaptured: 'hotkey-captured'
} as const

export type IpcName = (typeof IPC)[keyof typeof IPC]
