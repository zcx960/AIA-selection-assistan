import { defaultProviderTemplate, defaultSettings } from './defaults'
import type {
  ActionItem,
  ActionType,
  AppLanguage,
  AppSettings,
  ProviderApiType,
  ProviderSettings,
  ProviderTemplate,
  ReasoningMode,
  SettingsPatch,
  ThemeMode,
  TriggerMode
} from './types'

/** Resolve the provider an action (or request) should use, falling back to the active provider. */
export function resolveProvider(
  settings: Pick<AppSettings, 'provider' | 'providerTemplates'>,
  providerTemplateId?: string
): ProviderSettings {
  if (providerTemplateId) {
    const template = settings.providerTemplates.find((item) => item.id === providerTemplateId)
    if (template) return template.provider
  }
  return settings.provider
}

export function getResponseLanguageName(language: AppLanguage): string {
  return language === 'zh-CN' ? 'Simplified Chinese' : 'English'
}

export function buildAssistantSystemPrompt(settings: Pick<AppSettings, 'language'>): string {
  const language = getResponseLanguageName(settings.language)
  const today = new Date().toISOString().slice(0, 10)
  return `Always answer in ${language}. Match this response language even if the selected text or action prompt uses another language.\n\nCurrent date: ${today}. When the user asks about anything time-sensitive, treat this as the present and avoid baking outdated year markers into your reasoning.`
}

export function interpolatePrompt(
  template: string | undefined,
  selectedText: string,
  options: { language?: string } = {}
): string {
  const text = selectedText.trim()
  if (!template?.trim()) return text
  const preparedTemplate = template
    .replaceAll('{{language}}', options.language ?? 'the user interface language')
    .replaceAll('the user interface language', options.language ?? 'the user interface language')
  if (preparedTemplate.includes('{{text}}')) return preparedTemplate.replaceAll('{{text}}', text)
  return `${preparedTemplate.trim()}\n\n${text}`
}

export function buildSearchUrl(action: ActionItem, selectedText: string): string {
  const text = selectedText.trim()
  if (!text) return ''
  if (isUriOrFilePath(text)) return text

  const template = action.searchUrlTemplate || 'https://www.google.com/search?q={{query}}'
  return template.replaceAll('{{query}}', encodeURIComponent(text)).replaceAll('{{text}}', encodeURIComponent(text))
}

export function isUriOrFilePath(value: string): boolean {
  const text = value.trim()
  if (!text || /\s/.test(text)) return false
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(text) || /^[a-zA-Z]:[/\\]/.test(text) || /^\/[^/]/.test(text)
}

export function mergeSettings(current: AppSettings, patch: SettingsPatch): AppSettings {
  const {
    provider,
    providerTemplates,
    activeProviderTemplateId,
    shortcuts,
    actions,
    assistantPrompt: _removedAssistantPrompt,
    actionWindowOpacity: _removedActionWindowOpacity,
  ...rest
  } = patch as SettingsPatch & {
    assistantPrompt?: unknown
    actionWindowOpacity?: unknown
  }
  let nextProviderTemplates = normalizeProviderTemplates(providerTemplates ?? current.providerTemplates, current.provider)
  const nextActiveProviderTemplateId = normalizeActiveProviderTemplateId(
    activeProviderTemplateId ?? current.activeProviderTemplateId,
    nextProviderTemplates
  )

  if (provider && providerTemplates === undefined && activeProviderTemplateId === undefined) {
    const activeTemplate = nextProviderTemplates.find((template) => template.id === nextActiveProviderTemplateId)
    const mergedProvider = normalizeProviderSettings({
      ...(activeTemplate?.provider ?? current.provider),
      ...provider
    })
    nextProviderTemplates = nextProviderTemplates.map((template) =>
      template.id === nextActiveProviderTemplateId ? { ...template, provider: mergedProvider } : template
    )
  }

  const selectedProviderTemplate =
    nextProviderTemplates.find((template) => template.id === nextActiveProviderTemplateId) ?? nextProviderTemplates[0]
  const nextProvider = normalizeProviderSettings(selectedProviderTemplate?.provider ?? current.provider)
  return {
    ...current,
    ...rest,
    theme: normalizeThemeMode(rest.theme ?? current.theme),
    triggerMode: normalizeTriggerMode(rest.triggerMode ?? current.triggerMode),
    webSearchEnabled:
      typeof rest.webSearchEnabled === 'boolean' ? rest.webSearchEnabled : current.webSearchEnabled,
    actionWindowWidth: clampInt(rest.actionWindowWidth ?? current.actionWindowWidth, 320, 1600, defaultSettings.actionWindowWidth),
    actionWindowHeight: clampInt(rest.actionWindowHeight ?? current.actionWindowHeight, 240, 1200, defaultSettings.actionWindowHeight),
    chatWindowWidth: rest.chatWindowWidth != null ? clampInt(rest.chatWindowWidth, 360, 2000, 440) : current.chatWindowWidth,
    chatWindowHeight: rest.chatWindowHeight != null ? clampInt(rest.chatWindowHeight, 360, 2000, 580) : current.chatWindowHeight,
    fontFamily: typeof (rest.fontFamily ?? current.fontFamily) === 'string' ? (rest.fontFamily ?? current.fontFamily) : '',
    fontSize: clampInt(rest.fontSize ?? current.fontSize, 10, 28, defaultSettings.fontSize),
    autoLaunch: typeof (rest.autoLaunch ?? current.autoLaunch) === 'boolean' ? (rest.autoLaunch ?? current.autoLaunch) : false,
    provider: nextProvider,
    providerTemplates: nextProviderTemplates,
    activeProviderTemplateId: selectedProviderTemplate?.id ?? defaultProviderTemplate.id,
    shortcuts: {
      ...current.shortcuts,
      ...(shortcuts ?? {})
    },
    actions: normalizeActionItems(actions ?? current.actions)
  }
}

export function normalizeSettings(value: unknown): AppSettings {
  const partial = value && typeof value === 'object' ? (value as Partial<AppSettings>) : {}
  return mergeSettings(defaultSettings, partial)
}

function normalizeTriggerMode(mode: unknown): TriggerMode {
  return mode === 'shortcut' ? 'shortcut' : 'selected'
}

function normalizeThemeMode(mode: unknown): ThemeMode {
  if (mode === 'light' || mode === 'dark') return mode
  return 'system'
}

function normalizeProviderApiType(type: unknown): ProviderApiType {
  return type === 'anthropic' ? 'anthropic' : 'openai'
}

function normalizeProviderSettings(provider: Partial<ProviderSettings> | ProviderSettings): ProviderSettings {
  return {
    ...defaultProviderTemplate.provider,
    ...provider,
    apiType: normalizeProviderApiType(provider.apiType),
    temperature: provider.temperature ?? 1
  }
}

function normalizeProviderTemplates(
  templates: unknown,
  fallbackProvider: ProviderSettings = defaultProviderTemplate.provider
): ProviderTemplate[] {
  if (!Array.isArray(templates) || templates.length === 0) {
    return [
      {
        ...defaultProviderTemplate,
        provider: normalizeProviderSettings(fallbackProvider)
      }
    ]
  }

  return templates.map((template, index) => {
    const candidate = template && typeof template === 'object' ? (template as Partial<ProviderTemplate>) : {}
    return {
      id: typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : `provider-template-${index + 1}`,
      name: typeof candidate.name === 'string' ? candidate.name : `Template ${index + 1}`,
      provider: normalizeProviderSettings(candidate.provider ?? fallbackProvider)
    }
  })
}

function normalizeActiveProviderTemplateId(activeId: unknown, templates: ProviderTemplate[]): string {
  if (typeof activeId === 'string' && templates.some((template) => template.id === activeId)) return activeId
  return templates[0]?.id ?? defaultProviderTemplate.id
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(max, Math.max(min, n))
}

function normalizeReasoning(value: unknown): ReasoningMode {
  if (value === 'off' || value === 'low' || value === 'medium' || value === 'high') return value
  return 'on'
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function normalizeActionType(value: unknown): ActionType | null {
  return value === 'copy' || value === 'search' || value === 'prompt' || value === 'speak' ? value : null
}

// Actions are a freely managed list (add / edit / rename / delete / reorder).
// We only validate each entry — dropping unsupported types (e.g. the removed
// dictionary action) — and guarantee unique ids while preserving order.
function normalizeActionItems(actions: unknown): ActionItem[] {
  if (!Array.isArray(actions)) return defaultSettings.actions.map((action) => ({ ...action }))
  const seen = new Set<string>()
  const result: ActionItem[] = []
  for (const raw of actions) {
    if (!raw || typeof raw !== 'object') continue
    const candidate = raw as Partial<ActionItem>
    const type = normalizeActionType(candidate.type)
    if (!type) continue
    let id = typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : `action-${result.length + 1}`
    while (seen.has(id)) id = `${id}-${result.length + 1}`
    seen.add(id)
    result.push({
      id,
      name: typeof candidate.name === 'string' ? candidate.name : '',
      enabled: candidate.enabled !== false,
      icon: typeof candidate.icon === 'string' && candidate.icon.trim() ? candidate.icon : 'sparkles',
      type,
      promptTemplate: normalizeOptionalString(candidate.promptTemplate),
      searchUrlTemplate: normalizeOptionalString(candidate.searchUrlTemplate),
      providerTemplateId: normalizeOptionalString(candidate.providerTemplateId),
      model: normalizeOptionalString(candidate.model),
      reasoning: normalizeReasoning(candidate.reasoning),
      webSearch: typeof candidate.webSearch === 'boolean' ? candidate.webSearch : undefined,
      shortcut: normalizeOptionalString(candidate.shortcut)
    })
  }
  return appendMissingBuiltInActions(result)
}

function appendMissingBuiltInActions(actions: ActionItem[]): ActionItem[] {
  if (actions.some((action) => action.id === 'speak')) return actions

  const hasMigratableBuiltInAction = actions.some((action) =>
    defaultSettings.actions.some((defaultAction) => defaultAction.id !== 'speak' && defaultAction.id === action.id)
  )
  const speakAction = defaultSettings.actions.find((action) => action.id === 'speak')
  if (!hasMigratableBuiltInAction || !speakAction) return actions

  return [...actions, { ...speakAction }]
}
