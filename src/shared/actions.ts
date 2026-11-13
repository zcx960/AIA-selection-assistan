import { defaultProviderTemplate, defaultSettings } from './defaults'
import { normalizeAcpConfig } from './acp'
import { DEFAULT_STRUCTURED_OUTPUT_MODE, type StructuredOutputMode } from './structuredOutput'
import type {
  ActionItem,
  ActionWindowCloseMode,
  ActionType,
  AppLanguage,
  AppSettings,
  ContextInjectionField,
  ProviderApiType,
  ProviderSettings,
  ProviderTemplate,
  RaceResponseMode,
  ReasoningMode,
  SendKeyMode,
  SettingsPatch,
  StatsDetailLevel,
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
    structuredOutputMode: normalizeStructuredOutputMode(rest.structuredOutputMode ?? current.structuredOutputMode),
    actionWindowWidth: clampInt(rest.actionWindowWidth ?? current.actionWindowWidth, 320, 1600, defaultSettings.actionWindowWidth),
    actionWindowHeight: clampInt(rest.actionWindowHeight ?? current.actionWindowHeight, 240, 1200, defaultSettings.actionWindowHeight),
    actionWindowClose: normalizeActionWindowClose(rest.actionWindowClose ?? current.actionWindowClose),
    raceResponse: normalizeRaceResponse(rest.raceResponse ?? current.raceResponse),
    // Fallback references defaultSettings (not a literal) so the「实测回调制」
    // default flip lands in defaults.ts alone.
    prebuildActionWindow:
      typeof (rest.prebuildActionWindow ?? current.prebuildActionWindow) === 'boolean'
        ? (rest.prebuildActionWindow ?? current.prebuildActionWindow)
        : defaultSettings.prebuildActionWindow,
    statsEnabled:
      typeof (rest.statsEnabled ?? current.statsEnabled) === 'boolean'
        ? (rest.statsEnabled ?? current.statsEnabled)
        : defaultSettings.statsEnabled,
    statsDetailLevel: normalizeStatsDetailLevel(rest.statsDetailLevel ?? current.statsDetailLevel),
    contextInjectionEnabled:
      typeof (rest.contextInjectionEnabled ?? current.contextInjectionEnabled) === 'boolean'
        ? (rest.contextInjectionEnabled ?? current.contextInjectionEnabled)
        : defaultSettings.contextInjectionEnabled,
    contextInjectionFields: normalizeContextInjectionFields(
      rest.contextInjectionFields ?? current.contextInjectionFields
    ),
    sendKey: normalizeSendKey(rest.sendKey ?? current.sendKey),
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

function normalizeActionWindowClose(value: unknown): ActionWindowCloseMode {
  return value === 'destroy' ? 'destroy' : 'hide'
}

function normalizeRaceResponse(value: unknown): RaceResponseMode {
  return value === 'complete' ? 'complete' : 'abort'
}

function normalizeStructuredOutputMode(value: unknown): StructuredOutputMode {
  if (value === 'off' || value === 'json_object' || value === 'json_schema') return value
  return DEFAULT_STRUCTURED_OUTPUT_MODE
}

function normalizeStatsDetailLevel(value: unknown): StatsDetailLevel {
  return value === 'noSource' ? 'noSource' : 'full'
}

const CONTEXT_INJECTION_FIELDS: ContextInjectionField[] = ['sourceApp', 'localTime', 'localPlace']

// An explicit empty array is a valid state (master switch on, nothing ticked),
// but a missing field (settings saved before this feature existed) falls back to all fields —
// so turning the master switch on just works.
function normalizeContextInjectionFields(value: unknown): ContextInjectionField[] {
  if (!Array.isArray(value)) return [...defaultSettings.contextInjectionFields]
  return value.filter((field): field is ContextInjectionField =>
    CONTEXT_INJECTION_FIELDS.includes(field as ContextInjectionField)
  )
}

export interface ContextInjectionInput {
  enabled: boolean
  fields: ContextInjectionField[]
  language: AppLanguage
  /** Source app of the request, when the request carries one (action runs do; chat and screenshot do not). */
  programName?: string
  /** Injection-time clock and timezone are passed in so the prompt build stays testable. */
  now: Date
  timeZone: string
}

// Context injection: a reference-metadata block appended to the system
// prompt. Returns '' when off — callers must treat '' as "nothing to append",
// which keeps disabled-state requests byte-identical to the old behavior.
export function buildContextInjectionPrompt(input: ContextInjectionInput): string {
  if (!input.enabled || input.fields.length === 0) return ''
  const isZh = input.language === 'zh-CN'
  const parts: string[] = []
  for (const field of input.fields) {
    if (field === 'sourceApp') {
      // No source app in this request (chat, screenshot) → skip, don't invent.
      if (!input.programName?.trim()) continue
      parts.push(isZh ? `来源应用：${input.programName}` : `Source app: ${input.programName}`)
    } else if (field === 'localTime') {
      // en-CA gives ISO-ordered dates; hour12:false forces 24-hour clock.
      const localTime = new Intl.DateTimeFormat('en-CA', {
        timeZone: input.timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      }).format(input.now)
      parts.push(isZh ? `本地时间：${localTime}` : `Local time: ${localTime}`)
    } else if (field === 'localPlace') {
      parts.push(isZh ? `所在时区：${input.timeZone}` : `Time zone: ${input.timeZone}`)
    }
  }
  if (parts.length === 0) return ''
  const header = isZh ? '[用户上下文 — 供参考的元信息]' : '[User context — reference metadata]'
  return `${header}\n${parts.join('\n')}`
}

function normalizeSendKey(value: unknown): SendKeyMode {
  return value === 'ctrlEnter' || value === 'shiftEnter' ? value : 'enter'
}

function normalizeThemeMode(mode: unknown): ThemeMode {
  if (mode === 'light' || mode === 'dark') return mode
  return 'system'
}

function normalizeProviderApiType(type: unknown): ProviderApiType {
  return type === 'acp' ? 'acp' : type === 'anthropic' ? 'anthropic' : 'openai'
}

function normalizeProviderSettings(provider: Partial<ProviderSettings> | ProviderSettings): ProviderSettings {
  return {
    ...defaultProviderTemplate.provider,
    ...provider,
    apiType: normalizeProviderApiType(provider.apiType),
    ...(provider.apiType === 'acp' ? { acp: normalizeAcpConfig(provider.acp) } : {}),
    temperature: 1
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
  // quote is part of ActionType (the pre-selection pool feature) — leaving it out
  // here made every settings round-trip drop user-customized quote actions
  // (then the migration logic re-added a default one: disabled state, rename
  // and shortcut silently lost).
  return value === 'copy' || value === 'search' || value === 'prompt' || value === 'speak' || value === 'quote'
    ? value
    : null
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
      reasoning: normalizeReasoning(candidate.reasoning),
      shortcut: normalizeOptionalString(candidate.shortcut)
    })
  }
  return appendMissingBuiltInActions(result)
}

function appendMissingBuiltInActions(actions: ActionItem[]): ActionItem[] {
  // Built-in actions introduced after a user's settings were saved are
  // merged in on load (speak, quote). The guard keeps the "user cleared
  // every built-in action" state stable: with no built-in action left to
  // anchor on, nothing is re-added.
  const migratingIds = ['speak', 'quote']
  const knownIds = new Set(actions.map((action) => action.id))
  const missing = migratingIds.filter((id) => !knownIds.has(id))
  if (missing.length === 0) return actions

  const hasMigratableBuiltInAction = actions.some((action) =>
    defaultSettings.actions.some(
      (defaultAction) => !migratingIds.includes(defaultAction.id) && defaultAction.id === action.id
    )
  )
  if (!hasMigratableBuiltInAction) return actions

  const additions = defaultSettings.actions.filter((action) => missing.includes(action.id))
  return [...actions, ...additions.map((action) => ({ ...action }))]
}
