export type TriggerMode = 'selected' | 'shortcut'
export type FilterMode = 'default' | 'whitelist' | 'blacklist'
/** What happens when the result window is closed: 'hide' keeps it pooled for instant reuse, 'destroy' releases it. */
export type ActionWindowCloseMode = 'hide' | 'destroy'
/** What happens to an in-flight stream when its window is destroyed (or a racing request takes over, once implemented): 'abort' cuts it, 'complete' lets it finish in the background. */
export type RaceResponseMode = 'abort' | 'complete'
export type ActionType = 'copy' | 'search' | 'prompt' | 'speak' | 'quote'
/** How much detail usage records keep: 'full' keeps everything, 'noSource' drops the source app name (privacy-sensitive). */
export type StatsDetailLevel = 'full' | 'noSource'
/** Which metadata fields the context injection may append to the AI system prompt. */
export type ContextInjectionField = 'sourceApp' | 'localTime' | 'localPlace'
/** Which key sends the message in the in-app input boxes; unconfigured Enter falls back to newline (single-line boxes: no-op). */
export type SendKeyMode = 'enter' | 'ctrlEnter' | 'shiftEnter'
export type AppLanguage = 'zh-CN' | 'en'
export type ThemeMode = 'system' | 'light' | 'dark'
import type { StructuredOutputMode } from './structuredOutput'

export type { StructuredOutputMode }

export type ProviderApiType = 'openai' | 'anthropic'
/** 'on' lets the model use its default; other values request explicit reasoning control. */
export type ReasoningMode = 'on' | 'off' | 'low' | 'medium' | 'high'

export interface ProviderSettings {
  apiType: ProviderApiType
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
}

export interface ProviderTemplate {
  id: string
  name: string
  provider: ProviderSettings
}

export interface ShortcutSettings {
  toggleAssistant: string
  processSelection: string
  captureScreen: string
  recordScreen: string
  chat: string
}

export interface ActionItem {
  id: string
  name: string
  enabled: boolean
  icon: string
  type: ActionType
  promptTemplate?: string
  searchUrlTemplate?: string
  /** Provider template to use for this action. Empty/undefined = follow the active provider. */
  providerTemplateId?: string
  /** Reasoning behavior for this action. Defaults to 'on' (model default). */
  reasoning?: ReasoningMode
  /** Optional global shortcut that opens a type-in window for this action. */
  shortcut?: string
}

export interface AppSettings {
  language: AppLanguage
  theme: ThemeMode
  enabled: boolean
  triggerMode: TriggerMode
  /** Pop the toolbar on Ctrl+A select-all (Windows only, independent of triggerMode). */
  selectAllTrigger: boolean
  compactToolbar: boolean
  showToolbarAppIcon: boolean
  followToolbar: boolean
  rememberWindowSize: boolean
  autoClose: boolean
  autoPin: boolean
  actionWindowClose: ActionWindowCloseMode
  raceResponse: RaceResponseMode
  prebuildActionWindow: boolean
  statsEnabled: boolean
  statsDetailLevel: StatsDetailLevel
  contextInjectionEnabled: boolean
  contextInjectionFields: ContextInjectionField[]
  sendKey: SendKeyMode
  actionWindowWidth: number
  actionWindowHeight: number
  fontFamily: string
  fontSize: number
  autoLaunch: boolean
  filterMode: FilterMode
  filterList: string[]
  provider: ProviderSettings
  providerTemplates: ProviderTemplate[]
  activeProviderTemplateId: string
  webSearchEnabled: boolean
  /** Server-side structuring strength for replace-capable action requests.
   * Failures are loud by design (no silent downgrade — unsupported providers
   * surface a 400 the user resolves by picking a lower mode). */
  structuredOutputMode: StructuredOutputMode
  shortcuts: ShortcutSettings
  actions: ActionItem[]
}

export interface SelectedTextPayload {
  text: string
  programName?: string
  isFullscreen?: boolean
  /** [fork] Handle of the window the selection came from (Windows only; null elsewhere) — the paste-back target. */
  hwnd?: number | null
}

export interface ActionPayload {
  action: ActionItem
  selectedText: string
  programName?: string
  isFullscreen?: boolean
  /** [fork] Paste-back target window handle, carried through from SelectedTextPayload (Windows only). */
  hwnd?: number | null
  /** 'selection' runs immediately on selectedText; 'input' opens a type-in box first. */
  mode?: 'selection' | 'input'
}

/** Result of the replace-selection IPC (issue #7 paste-back). ok=false always
 * leaves the clipboard holding the result text so the user can paste manually. */
export type ReplaceSelectionResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'window-gone' | 'selection-changed' | 'send-failed' }

/** Selection context a renderer attaches to an AI request so main can record usage. Requests without it (chat, screenshot) are not recorded. */
export interface AiStreamStatsContext {
  programName?: string
  actionName: string
  actionType: ActionType
  selectedText: string
}

export interface AiMessageInput {
  role: 'user' | 'assistant'
  text: string
  images?: string[]
}

/** One user-marked fragment inside a pre-selected text, as character offsets into PreWindowEntry.text. createdAt orders the global mark numbering (first marked = ①). */
export interface PreWindowMark {
  id: string
  start: number
  end: number
  createdAt: number
}

/** One pre-selected text kept in the in-memory pool. Lives only for the app session. */
export interface PreWindowEntry {
  id: string
  text: string
  programName?: string
  createdAt: number
}

/** The most recent global text selection, kept in main memory as the chat window's default context. */
export interface LastSelection {
  text: string
  programName?: string
  at: number
}

export interface AiStreamRequest {
  requestId: string
  prompt?: string
  messages?: AiMessageInput[]
  systemPrompt?: string
  /** Resolve the provider from this template instead of the active one. */
  providerTemplateId?: string
  /** Reasoning behavior for this request. Defaults to 'on' (model default). */
  reasoning?: ReasoningMode
  /** Selection usage context for local stats recording. Absent = this request is not an action run and is not recorded. */
  stats?: AiStreamStatsContext
  /** Ask main to attach the structured-output prompt contract and (per the
   * settings mode) server-side structuring parameters. The renderer sets this
   * only for replace-capable actions. */
  structuredOutput?: boolean
}

export interface AiChunkPayload {
  requestId: string
  type: 'delta' | 'reasoning' | 'done' | 'error' | 'status'
  text?: string
  /** Streamed chain-of-thought fragment (type === 'reasoning' only). */
  reasoning?: string
  error?: string
}

export type SettingsPatch = Partial<Omit<AppSettings, 'provider' | 'shortcuts'>> & {
  provider?: Partial<ProviderSettings>
  shortcuts?: Partial<ShortcutSettings>
}
