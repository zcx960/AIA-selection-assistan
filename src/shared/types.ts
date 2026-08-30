export type TriggerMode = 'selected' | 'shortcut'
export type FilterMode = 'default' | 'whitelist' | 'blacklist'
export type ActionType = 'copy' | 'search' | 'prompt' | 'speak'
export type AppLanguage = 'zh-CN' | 'en'
export type ThemeMode = 'system' | 'light' | 'dark'
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
  compactToolbar: boolean
  showToolbarAppIcon: boolean
  followToolbar: boolean
  rememberWindowSize: boolean
  autoClose: boolean
  autoPin: boolean
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
  shortcuts: ShortcutSettings
  actions: ActionItem[]
}

export interface SelectedTextPayload {
  text: string
  programName?: string
  isFullscreen?: boolean
}

export interface ActionPayload {
  action: ActionItem
  selectedText: string
  isFullscreen?: boolean
  /** 'selection' runs immediately on selectedText; 'input' opens a type-in box first. */
  mode?: 'selection' | 'input'
}

export interface AiMessageInput {
  role: 'user' | 'assistant'
  text: string
  images?: string[]
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
