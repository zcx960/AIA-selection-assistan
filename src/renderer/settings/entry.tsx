import '../styles.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { useSettings } from '../useSettings'
import { Icon } from '../icons'
import { defaultActions } from '@shared/defaults'
import { buildAccelerator as buildShortcutAccelerator } from '@shared/shortcutRule'
import { useThemeMode } from '../useThemeMode'
import { useAppearance } from '../useAppearance'
import { getActionLabel, getTranslator } from '../i18n'
import { ProviderNameInput } from './ProviderNameInput'
import type {
  ActionItem,
  ActionWindowCloseMode,
  AppLanguage,
  AppSettings,
  ContextInjectionField,
  FilterMode,
  ProviderTemplate,
  RaceResponseMode,
  ReasoningMode,
  SendKeyMode,
  ShortcutSettings,
  StatsDetailLevel,
  StructuredOutputMode,
  ThemeMode,
  TriggerMode
} from '@shared/types'

type SettingsSectionId = 'api' | 'actions' | 'selection' | 'window' | 'storage'

type SettingsSectionMeta = {
  id: SettingsSectionId
  label: string
}

type SettingRowProps = {
  title: string
  description?: string
  className?: string
  children: React.ReactNode
}

function SettingsNav({
  sections,
  activeSection,
  onChange
}: {
  sections: SettingsSectionMeta[]
  activeSection: SettingsSectionId
  onChange: (section: SettingsSectionId) => void
}) {
  return (
    <aside className="settings-sidebar" aria-label="Settings sections">
      {sections.map((section) => (
        <button
          key={section.id}
          className={section.id === activeSection ? 'settings-nav-button active' : 'settings-nav-button'}
          onClick={() => onChange(section.id)}
          type="button">
          <span>{section.label}</span>
        </button>
      ))}
    </aside>
  )
}

function SettingSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="setting-section">
      <h3>{title}</h3>
      <div className="setting-section-body">{children}</div>
    </section>
  )
}

function SettingRow({ title, description, className, children }: SettingRowProps) {
  return (
    <div className={className ? `setting-row ${className}` : 'setting-row'}>
      <div className="setting-info">
        <span className="setting-title">{title}</span>
        {description && <span className="setting-desc">{description}</span>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  label,
  disabled
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={checked ? 'toggle checked' : 'toggle'}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      role="switch"
      type="button">
      <span />
    </button>
  )
}

function NumberField({
  value,
  min,
  max,
  onCommit
}: {
  value: number
  min: number
  max: number
  onCommit: (value: number) => void
}) {
  const [text, setText] = React.useState(String(value))
  React.useEffect(() => setText(String(value)), [value])
  const commit = () => {
    const parsed = parseInt(text, 10)
    if (Number.isFinite(parsed)) onCommit(Math.min(max, Math.max(min, parsed)))
    else setText(String(value))
  }
  return (
    <input
      type="number"
      min={min}
      max={max}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
      }}
    />
  )
}

function formatShortcut(value: string): string[] {
  if (!value) return []
  const isMac = navigator.platform.toLowerCase().includes('mac')
  return value
    .replaceAll('CommandOrControl', isMac ? 'Command' : 'Ctrl')
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
}

// 应用内快捷键互斥：12 个可配点（4 全局键 + 全部 action）
// 共用一个键空间，同一组合键配给第二个功能时注册链只第一个生效、其余静默
// 失效（src/main/index.ts registerShortcuts 现状）——保存前在此拦下并提示冲突对象。
// 比较前 trim + 大写归一：两条录入通道产出统一格式（全大写），归一只防手工
// 编辑设置文件带入空白或小写。
function findShortcutConflict(
  settings: AppSettings,
  excludeKey: string,
  newValue: string,
  t: (key: string) => string
): string | null {
  const normalizedNew = newValue.trim().toUpperCase()
  if (!normalizedNew) return null

  const occupants: Array<{ key: string; accelerator: string; label: string }> = [
    {
      key: 'shortcut:toggleAssistant',
      accelerator: settings.shortcuts.toggleAssistant,
      label: t('shortcutToggleAssistant')
    },
    {
      key: 'shortcut:processSelection',
      accelerator: settings.shortcuts.processSelection,
      label: t('shortcutProcessSelection')
    },
    {
      key: 'shortcut:captureScreen',
      accelerator: settings.shortcuts.captureScreen,
      label: t('shortcutCaptureScreen')
    },
    {
      key: 'shortcut:chat',
      accelerator: settings.shortcuts.chat,
      label: t('shortcutChat')
    },
    {
      key: 'shortcut:recordScreen',
      accelerator: settings.shortcuts.recordScreen,
      label: settings.language === 'zh-CN' ? '区域录屏' : 'Region recording'
    }
  ]
  for (const action of settings.actions) {
    occupants.push({
      key: `action:${action.id}`,
      accelerator: action.shortcut ?? '',
      label: getActionLabel(action, settings.language)
    })
  }

  for (const occupant of occupants) {
    if (occupant.key === excludeKey) continue
    if (occupant.accelerator.trim().toUpperCase() === normalizedNew) return occupant.label
  }
  return null
}

function normalizeShortcutKey(event: React.KeyboardEvent<HTMLButtonElement>): string {
  const keyMap: Record<string, string> = {
    ' ': 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Esc: 'Escape'
  }
  const rawKey = keyMap[event.key] ?? event.key
  const key = rawKey.length === 1 ? rawKey.toUpperCase() : rawKey
  const modifierKeys = new Set(['Alt', 'AltGraph', 'Control', 'Meta', 'Shift'])
  if (modifierKeys.has(key)) return ''

  // 组合顺序与单键合法性走 @shared/shortcutRule：原先本地 F\d{1,2} 放行
  // F13-F99，而 main 侧只认 F1-F12，录出的是永不触发的快捷键。
  return (
    buildShortcutAccelerator(
      { commandOrControl: event.metaKey || event.ctrlKey, alt: event.altKey, shift: event.shiftKey },
      key
    ) ?? ''
  )
}

function ShortcutRecorder({
  value,
  label,
  conflictText,
  onChange,
  t
}: {
  value: string
  label: string
  /** 应用内快捷键冲突提示（互斥校验被拒时由父层传入）；空 = 无冲突 */
  conflictText?: string
  onChange: (value: string) => void
  t: (key: string) => string
}) {
  const [recording, setRecording] = React.useState(false)
  // Dual capture channels: the main-process hook sees keys Windows
  // intercepts before they reach the renderer (Alt+Space); the local keydown
  // below stays as fallback and covers normal keys. handledRef keeps both
  // channels from committing the same keystroke twice; the session token keeps
  // sibling recorders on the same page from accepting each other's capture
  // (many components share the page-level IPC channel). The captured listener
  // lives for the whole component on purpose: intercepting keys (Alt+Space)
  // also opens the system menu, and the resulting blur tears down recording —
  // a recording-scoped listener would be removed before the IPC event lands.
  const handledRef = React.useRef(false)
  const captureTokenRef = React.useRef<number | null>(null)
  const onChangeRef = React.useRef(onChange)
  onChangeRef.current = onChange

  React.useEffect(() => {
    const offCaptured = window.assistantLite.hotkeyCapture.onCaptured((token, accelerator) => {
      if (handledRef.current || token !== captureTokenRef.current) return
      handledRef.current = true
      captureTokenRef.current = null
      onChangeRef.current(accelerator)
      setRecording(false)
    })
    return offCaptured
  }, [])

  React.useEffect(() => {
    if (!recording) return
    handledRef.current = false
    void window.assistantLite.hotkeyCapture.start().then((token) => {
      captureTokenRef.current = token
    })
    return () => {
      captureTokenRef.current = null
      void window.assistantLite.hotkeyCapture.stop()
    }
  }, [recording])

  const parts = formatShortcut(value)

  return (
    <div className="shortcut-recorder">
      <button
        className={recording ? 'shortcut-button recording' : 'shortcut-button'}
        type="button"
        aria-label={label}
        onBlur={() => setRecording(false)}
        onClick={() => setRecording(true)}
        onKeyDown={(event) => {
          if (!recording) return
          event.preventDefault()
          event.stopPropagation()

          if (event.key === 'Escape') {
            setRecording(false)
            return
          }

          if (event.key === 'Backspace' || event.key === 'Delete') {
            onChange('')
            setRecording(false)
            return
          }

          const shortcut = normalizeShortcutKey(event)
          if (!shortcut) return
          handledRef.current = true
          onChange(shortcut)
          setRecording(false)
        }}>
        {recording ? (
          <span className="shortcut-recording-text">{t('shortcutRecording')}</span>
        ) : parts.length ? (
          parts.map((part) => (
            <span className="keycap" key={part}>
              {part}
            </span>
          ))
        ) : (
          <span className="shortcut-empty">{t('shortcutUnset')}</span>
        )}
      </button>
      {value && (
        <button className="shortcut-clear" type="button" onClick={() => onChange('')} title={t('shortcutClear')}>
          {t('shortcutClear')}
        </button>
      )}
      {conflictText && <div className="shortcut-conflict">{conflictText}</div>}
    </div>
  )
}

const ACTION_ICON_CHOICES = [
  'sparkles',
  'languages',
  'circle-help',
  'scan-text',
  'search',
  'copy',
  'volume-2',
  'book-open',
  'pencil',
  'flask-conical',
  'mouse-pointer',
  'download',
  'arrow-up-right'
]

function IconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  return (
    <div className="icon-picker">
      {ACTION_ICON_CHOICES.map((name) => (
        <button
          key={name}
          type="button"
          className={name === value ? 'icon-choice active' : 'icon-choice'}
          onClick={() => onChange(name)}
          aria-label={name}>
          <Icon name={name} size={19} />
        </button>
      ))}
    </div>
  )
}

function ActionEditor({
  action,
  defaultAction,
  language,
  providerTemplates,
  index,
  count,
  onChange,
  onDelete,
  onMove,
  t
}: {
  action: ActionItem
  defaultAction?: ActionItem
  language: AppLanguage
  providerTemplates: ProviderTemplate[]
  index: number
  count: number
  onChange: (patch: Partial<ActionItem>) => void
  onDelete: () => void
  onMove: (dir: -1 | 1) => void
  t: (key: string) => string
}) {
  const [expanded, setExpanded] = React.useState(false)
  const isPrompt = action.type === 'prompt'
  const isSearch = action.type === 'search'
  const isCustom = !defaultAction
  const defaultPrompt = defaultAction?.promptTemplate ?? ''

  // Local buffers for the free-text fields. Persisting goes through an async IPC
  // round-trip, so binding the inputs straight to `action.*` made the value prop
  // lag a keystroke behind — which reset the caret to the end and broke IME
  // composition. We edit locally and persist in the background. Seeded once per
  // action; the list keys editors by id, so this remounts when the action changes.
  const [name, setName] = React.useState(action.name)
  const [promptTemplate, setPromptTemplate] = React.useState(action.promptTemplate ?? '')
  const [searchUrlTemplate, setSearchUrlTemplate] = React.useState(action.searchUrlTemplate ?? '')

  return (
    <div className="action-config-item">
      <div className="action-config-row">
        <span className="action-name">
          <Icon name={action.icon} size={18} />
          <span>{getActionLabel(action, language)}</span>
        </span>
        <div className="action-row-tools">
          <button className="inline-icon-button" type="button" title={t('moveUp')} onClick={() => onMove(-1)} disabled={index === 0}>
            <span>↑</span>
          </button>
          <button
            className="inline-icon-button"
            type="button"
            title={t('moveDown')}
            onClick={() => onMove(1)}
            disabled={index === count - 1}>
            <span>↓</span>
          </button>
          <button className="prompt-edit-button" type="button" onClick={() => setExpanded((value) => !value)}>
            {expanded ? t('hidePrompt') : t('editPrompt')}
          </button>
        </div>
        <Toggle checked={action.enabled} label={getActionLabel(action, language)} onChange={(enabled) => onChange({ enabled })} />
      </div>
      {expanded && (
        <div className="prompt-template-editor">
          <div className="action-meta">
            <label className="field">
              <span>{t('actionName')}</span>
              <input
                value={name}
                placeholder={getActionLabel(action, language)}
                onChange={(event) => {
                  setName(event.target.value)
                  onChange({ name: event.target.value })
                }}
              />
            </label>
            <label className="field">
              <span>{t('actionIcon')}</span>
              <IconPicker value={action.icon} onChange={(icon) => onChange({ icon })} />
            </label>
          </div>

          {isPrompt && (
            <textarea
              value={promptTemplate}
              placeholder={t('promptTemplatePlaceholder')}
              onChange={(event) => {
                setPromptTemplate(event.target.value)
                onChange({ promptTemplate: event.target.value })
              }}
            />
          )}

          {isSearch && (
            <label className="field">
              <span>{t('searchUrlLabel')}</span>
              <input
                value={searchUrlTemplate}
                placeholder="https://www.google.com/search?q={{query}}"
                onChange={(event) => {
                  setSearchUrlTemplate(event.target.value)
                  onChange({ searchUrlTemplate: event.target.value })
                }}
              />
            </label>
          )}

          {isPrompt && (
            <div className="action-ai-options">
              <label className="field">
                <span>{t('actionProvider')}</span>
                <select
                  value={action.providerTemplateId ?? ''}
                  onChange={(event) => onChange({ providerTemplateId: event.target.value || undefined })}>
                  <option value="">{t('actionProviderDefault')}</option>
                  {providerTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t('actionReasoning')}</span>
                <select
                  value={action.reasoning ?? 'on'}
                  onChange={(event) => onChange({ reasoning: event.target.value as ReasoningMode })}>
                  <option value="on">{t('reasoningOn')}</option>
                  <option value="off">{t('reasoningOff')}</option>
                  <option value="low">{t('reasoningLow')}</option>
                  <option value="medium">{t('reasoningMedium')}</option>
                  <option value="high">{t('reasoningHigh')}</option>
                </select>
              </label>
            </div>
          )}

          {((isPrompt && defaultPrompt) || isCustom) && (
            <div className="action-editor-footer">
              {isPrompt && defaultPrompt && (
                <button
                  type="button"
                  onClick={() => {
                    setPromptTemplate(defaultPrompt)
                    onChange({ promptTemplate: defaultPrompt })
                  }}>
                  {t('restoreDefaultPrompt')}
                </button>
              )}
              {isCustom && (
                <button type="button" className="danger-text" onClick={onDelete}>
                  {t('deleteAction')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SettingsApp() {
  const { settings, loaded, update } = useSettings()
  const [accessibilityTrusted, setAccessibilityTrusted] = React.useState(true)
  const [activeSection, setActiveSection] = React.useState<SettingsSectionId>('api')
  const [modelsByTemplate, setModelsByTemplate] = React.useState<Record<string, string[]>>({})
  const [statusByTemplate, setStatusByTemplate] = React.useState<Record<string, string>>({})
  const [busyTemplate, setBusyTemplate] = React.useState<{ id: string; kind: 'list' | 'test' } | null>(null)
  // 快捷键互斥：只记最后一条被拒的冲突（一次只操作一个录制框）。
  // targetKey 命中哪个录制框，红字就挂在哪个框下；任何一次成功保存即清除。
  const [shortcutConflict, setShortcutConflict] = React.useState<{ targetKey: string; text: string } | null>(null)
  const t = getTranslator(settings.language)
  useThemeMode(settings.theme)
  useAppearance(settings)

  React.useEffect(() => {
    document.documentElement.classList.add('settings-page-root')
    document.body.classList.add('settings-body')
    return () => {
      document.documentElement.classList.remove('settings-page-root')
      document.body.classList.remove('settings-body')
    }
  }, [])

  React.useEffect(() => {
    void window.assistantLite.selection.getAccessibility().then(setAccessibilityTrusted)
  }, [settings.enabled])

  React.useEffect(() => {
    document.documentElement.lang = settings.language
    document.title = t('appTitle')
  }, [settings.language])

  if (!loaded) return <main className="page">{t('loading')}</main>

  const updateTemplate = (id: string, patch: Partial<ProviderTemplate>) => {
    void update({
      providerTemplates: settings.providerTemplates.map((template) =>
        template.id === id ? { ...template, ...patch } : template
      )
    })
  }

  const updateTemplateProvider = (id: string, field: string, value: string) => {
    void update({
      providerTemplates: settings.providerTemplates.map((template) =>
        template.id === id ? { ...template, provider: { ...template.provider, [field]: value } } : template
      )
    })
  }

  const addProviderTemplate = () => {
    const nextTemplate: ProviderTemplate = {
      id: crypto.randomUUID(),
      name: `${t('providerTemplateDefaultName')} ${settings.providerTemplates.length + 1}`,
      provider: { ...settings.provider }
    }
    void update({ providerTemplates: [...settings.providerTemplates, nextTemplate] })
  }

  const deleteProviderTemplate = (id: string) => {
    if (settings.providerTemplates.length <= 1) return
    const remaining = settings.providerTemplates.filter((template) => template.id !== id)
    const nextActive = settings.activeProviderTemplateId === id ? remaining[0]?.id : settings.activeProviderTemplateId
    void update({ providerTemplates: remaining, activeProviderTemplateId: nextActive })
  }

  const fetchModelsFor = async (id: string) => {
    setBusyTemplate({ id, kind: 'list' })
    setStatusByTemplate((current) => ({ ...current, [id]: t('modelListLoading') }))
    try {
      const models = await window.assistantLite.ai.listModels(id)
      setModelsByTemplate((current) => ({ ...current, [id]: models }))
      setStatusByTemplate((current) => ({
        ...current,
        [id]: models.length ? t('modelListSuccess').replace('{{count}}', String(models.length)) : t('modelListEmpty')
      }))
    } catch (error) {
      setStatusByTemplate((current) => ({ ...current, [id]: error instanceof Error ? error.message : String(error) }))
    } finally {
      setBusyTemplate(null)
    }
  }

  const testModelFor = async (id: string) => {
    setBusyTemplate({ id, kind: 'test' })
    setStatusByTemplate((current) => ({ ...current, [id]: t('modelTestLoading') }))
    try {
      await window.assistantLite.ai.testModel(id)
      setStatusByTemplate((current) => ({ ...current, [id]: t('modelTestSuccess') }))
    } catch (error) {
      setStatusByTemplate((current) => ({ ...current, [id]: error instanceof Error ? error.message : String(error) }))
    } finally {
      setBusyTemplate(null)
    }
  }

  const updateAction = (id: string, patch: Partial<ActionItem>) => {
    void update({
      actions: settings.actions.map((action) => (action.id === id ? { ...action, ...patch } : action))
    })
  }

  const addAction = () => {
    const next: ActionItem = {
      id: crypto.randomUUID(),
      name: t('newActionName'),
      enabled: true,
      icon: 'sparkles',
      type: 'prompt',
      promptTemplate: '',
      reasoning: 'on'
    }
    void update({ actions: [...settings.actions, next] })
  }

  const deleteAction = (id: string) => {
    // Built-in default actions can be disabled or edited, but not removed.
    if (defaultActions.some((action) => action.id === id)) return
    void update({ actions: settings.actions.filter((action) => action.id !== id) })
  }

  const moveAction = (id: string, dir: -1 | 1) => {
    const actions = [...settings.actions]
    const i = actions.findIndex((action) => action.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= actions.length) return
    ;[actions[i], actions[j]] = [actions[j], actions[i]]
    void update({ actions })
  }

  const updateShortcut = (field: keyof ShortcutSettings, value: string) => {
    const conflictLabel = findShortcutConflict(settings, `shortcut:${field}`, value, t)
    if (conflictLabel) {
      setShortcutConflict({
        targetKey: `shortcut:${field}`,
        text: t('shortcutConflictHint').replace('{name}', conflictLabel)
      })
      return
    }
    setShortcutConflict(null)
    void update({ shortcuts: { [field]: value } })
  }

  const updateContextInjectionField = (field: ContextInjectionField, on: boolean) => {
    const next = on
      ? [...new Set([...settings.contextInjectionFields, field])]
      : settings.contextInjectionFields.filter((ticked) => ticked !== field)
    void update({ contextInjectionFields: next })
  }

  const updateActionShortcut = (id: string, value: string) => {
    const conflictLabel = findShortcutConflict(settings, `action:${id}`, value, t)
    if (conflictLabel) {
      setShortcutConflict({
        targetKey: `action:${id}`,
        text: t('shortcutConflictHint').replace('{name}', conflictLabel)
      })
      return
    }
    setShortcutConflict(null)
    updateAction(id, { shortcut: value || undefined })
  }

  const sections: SettingsSectionMeta[] = [
    { id: 'api', label: t('sectionApi') },
    { id: 'actions', label: t('sectionActions') },
    { id: 'selection', label: t('sectionSelection') },
    { id: 'window', label: t('sectionWindow') },
    { id: 'storage', label: t('sectionStorage') }
  ]
  const defaultActionById = new Map(defaultActions.map((action) => [action.id, action]))
  const filterText = settings.filterList.join('\n')
  const toggleAssistantEnabled = async () => {
    if (!settings.enabled) {
      const trusted = await window.assistantLite.selection.getAccessibility()
      setAccessibilityTrusted(trusted)
      if (!trusted) {
        await window.assistantLite.selection.requestAccessibility()
        return
      }
    }
    void update({ enabled: !settings.enabled })
  }

  const cycleTheme = () => {
    const nextTheme: Record<ThemeMode, ThemeMode> = {
      system: 'light',
      light: 'dark',
      dark: 'system'
    }
    void update({ theme: nextTheme[settings.theme] })
  }

  const themeIconName: Record<ThemeMode, string> = {
    system: 'laptop',
    light: 'sun',
    dark: 'moon'
  }

  const renderSection = () => {
    if (activeSection === 'api') {
      return (
        <div className="settings-stack">
          <SettingSection title={t('providerTitle')}>
            <div className="provider-list">
              {settings.providerTemplates.map((template) => {
                const isDefault = template.id === settings.activeProviderTemplateId
                const models = modelsByTemplate[template.id] ?? []
                const status = statusByTemplate[template.id]
                const listing = busyTemplate?.id === template.id && busyTemplate.kind === 'list'
                return (
                  <div className="provider-card" key={template.id}>
                    <div className="provider-card__head">
                      <ProviderNameInput
                        value={template.name}
                        placeholder={t('providerTemplateName')}
                        onChange={(name) => updateTemplate(template.id, { name })}
                      />
                      <button
                        type="button"
                        className={isDefault ? 'pill active' : 'pill'}
                        onClick={() => update({ activeProviderTemplateId: template.id })}
                        disabled={isDefault}
                        title={t('setDefault')}>
                        {isDefault ? t('providerDefault') : t('setDefault')}
                      </button>
                      <button
                        type="button"
                        className="inline-icon-button danger"
                        title={t('providerTemplateDelete')}
                        aria-label={t('providerTemplateDelete')}
                        onClick={() => deleteProviderTemplate(template.id)}
                        disabled={settings.providerTemplates.length <= 1}>
                        <Icon name="trash-2" size={14} />
                      </button>
                    </div>
                    <div className="form-grid">
                      <label className="field">
                        <span>{t('apiType')}</span>
                        <select
                          value={template.provider.apiType}
                          onChange={(event) => updateTemplateProvider(template.id, 'apiType', event.target.value)}>
                          <option value="openai">{t('apiTypeOpenAI')}</option>
                          <option value="anthropic">{t('apiTypeAnthropic')}</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>{t('baseUrl')}</span>
                        <input
                          value={template.provider.baseUrl}
                          onChange={(event) => updateTemplateProvider(template.id, 'baseUrl', event.target.value)}
                        />
                      </label>
                      {template.provider.apiType === 'anthropic' && (
                        <div className="model-status">{t('baseUrlAnthropicHint')}</div>
                      )}
                      <label className="field">
                        <div className="field-header">
                          <span>{t('model')}</span>
                          <div className="inline-actions">
                            <button
                              className="inline-action-button"
                              type="button"
                              onClick={() => fetchModelsFor(template.id)}
                              disabled={busyTemplate !== null}>
                              {listing ? t('modelListLoading') : t('fetchModels')}
                            </button>
                            <button
                              className="inline-icon-button"
                              type="button"
                              title={t('testModel')}
                              aria-label={t('testModel')}
                              onClick={() => testModelFor(template.id)}
                              disabled={busyTemplate !== null}>
                              <Icon name="flask-conical" size={14} />
                            </button>
                          </div>
                        </div>
                        <input
                          value={template.provider.model}
                          onChange={(event) => updateTemplateProvider(template.id, 'model', event.target.value)}
                        />
                      </label>
                      {models.length > 0 && (
                        <label className="field">
                          <span>{t('modelList')}</span>
                          <select
                            value={template.provider.model}
                            onChange={(event) => updateTemplateProvider(template.id, 'model', event.target.value)}>
                            <option value={template.provider.model}>
                              {template.provider.model || t('modelSelectPlaceholder')}
                            </option>
                            {models
                              .filter((model) => model !== template.provider.model)
                              .map((model) => (
                                <option key={model} value={model}>
                                  {model}
                                </option>
                              ))}
                          </select>
                        </label>
                      )}
                      <label className="field">
                        <span>{t('apiKey')}</span>
                        <input
                          type="password"
                          value={template.provider.apiKey}
                          onChange={(event) => updateTemplateProvider(template.id, 'apiKey', event.target.value)}
                        />
                      </label>
                      {status && <div className="model-status">{status}</div>}
                    </div>
                  </div>
                )
              })}
              <button type="button" className="add-row-button" onClick={addProviderTemplate}>
                + {t('addProvider')}
              </button>
            </div>
          </SettingSection>

          <SettingSection title={t('webSearchGroup')}>
            <SettingRow title={t('webSearchEnabled')} description={t('webSearchEnabledDesc')}>
              <Toggle
                checked={settings.webSearchEnabled}
                label={t('webSearchEnabled')}
                onChange={(webSearchEnabled) => update({ webSearchEnabled })}
              />
            </SettingRow>
          </SettingSection>
        </div>
      )
    }

    if (activeSection === 'selection') {
      return (
        <div className="settings-stack">
          <SettingSection title={t('selectionTriggerGroup')}>
            <SettingRow title={t('triggerMode')}>
              <select value={settings.triggerMode} onChange={(event) => update({ triggerMode: event.target.value as TriggerMode })}>
                <option value="selected">{t('triggerSelected')}</option>
                <option value="shortcut">{t('triggerShortcut')}</option>
              </select>
            </SettingRow>
            <SettingRow title={t('selectAllTrigger')} description={t('selectAllTriggerDesc')}>
              <Toggle
                checked={settings.selectAllTrigger}
                label={t('selectAllTrigger')}
                onChange={(selectAllTrigger) => update({ selectAllTrigger })}
              />
            </SettingRow>
          </SettingSection>

          <SettingSection title={t('selectionShortcutGroup')}>
            <SettingRow title={t('shortcutToggleAssistant')} description={t('shortcutRecordHint')} className="shortcut-row">
              <ShortcutRecorder
                value={settings.shortcuts.toggleAssistant}
                label={t('shortcutToggleAssistant')}
                conflictText={
                  shortcutConflict?.targetKey === 'shortcut:toggleAssistant' ? shortcutConflict.text : undefined
                }
                onChange={(value) => updateShortcut('toggleAssistant', value)}
                t={t}
              />
            </SettingRow>
            <SettingRow
              title={t('shortcutProcessSelection')}
              description={t('shortcutProcessSelectionDesc')}
              className="shortcut-row">
              <ShortcutRecorder
                value={settings.shortcuts.processSelection}
                label={t('shortcutProcessSelection')}
                conflictText={
                  shortcutConflict?.targetKey === 'shortcut:processSelection' ? shortcutConflict.text : undefined
                }
                onChange={(value) => updateShortcut('processSelection', value)}
                t={t}
              />
            </SettingRow>
            <SettingRow
              title={t('shortcutCaptureScreen')}
              description={t('shortcutCaptureScreenDesc')}
              className="shortcut-row">
              <ShortcutRecorder
                value={settings.shortcuts.captureScreen}
                label={t('shortcutCaptureScreen')}
                conflictText={
                  shortcutConflict?.targetKey === 'shortcut:captureScreen' ? shortcutConflict.text : undefined
                }
                onChange={(value) => updateShortcut('captureScreen', value)}
                t={t}
              />
            </SettingRow>
            <SettingRow
              title={t('shortcutChat')}
              description={t('shortcutChatDesc')}
              className="shortcut-row">
              <ShortcutRecorder
                value={settings.shortcuts.chat}
                label={t('shortcutChat')}
                conflictText={shortcutConflict?.targetKey === 'shortcut:chat' ? shortcutConflict.text : undefined}
                onChange={(value) => updateShortcut('chat', value)}
                t={t}
              />
            </SettingRow>
            <SettingRow
              title={settings.language === 'zh-CN' ? '区域录屏 / 停止录制' : 'Record a region / Stop recording'}
              description={settings.language === 'zh-CN' ? '框选区域录制画面，完成后复制视频或保存 MP4。' : 'Select a region, record video, then copy or save as MP4.'}
              className="shortcut-row">
              <ShortcutRecorder
                value={settings.shortcuts.recordScreen}
                label={settings.language === 'zh-CN' ? '区域录屏' : 'Region recording'}
                conflictText={shortcutConflict?.targetKey === 'shortcut:recordScreen' ? shortcutConflict.text : undefined}
                onChange={(value) => updateShortcut('recordScreen', value)}
                t={t}
              />
            </SettingRow>
          </SettingSection>

          <SettingSection title={t('actionShortcutsGroup')}>
            <div className="group-hint">{t('actionShortcutsHint')}</div>
            {settings.actions.map((action) => (
              <SettingRow
                key={action.id}
                title={getActionLabel(action, settings.language)}
                className="shortcut-row action-shortcut-setting-row">
                <ShortcutRecorder
                  value={action.shortcut ?? ''}
                  label={getActionLabel(action, settings.language)}
                  conflictText={
                    shortcutConflict?.targetKey === `action:${action.id}` ? shortcutConflict.text : undefined
                  }
                  onChange={(value) => updateActionShortcut(action.id, value)}
                  t={t}
                />
              </SettingRow>
            ))}
          </SettingSection>

          <SettingSection title={t('selectionToolbarGroup')}>
            <SettingRow title={t('compactToolbar')} description={t('compactToolbarDesc')}>
              <Toggle
                checked={settings.compactToolbar}
                label={t('compactToolbar')}
                onChange={(compactToolbar) => update({ compactToolbar })}
              />
            </SettingRow>
            <SettingRow title={t('showToolbarAppIcon')} description={t('showToolbarAppIconDesc')}>
              <Toggle
                checked={settings.showToolbarAppIcon}
                label={t('showToolbarAppIcon')}
                onChange={(showToolbarAppIcon) => update({ showToolbarAppIcon })}
              />
            </SettingRow>
          </SettingSection>

          <SettingSection title={t('selectionFilterGroup')}>
            <SettingRow title={t('filterMode')}>
              <select value={settings.filterMode} onChange={(event) => update({ filterMode: event.target.value as FilterMode })}>
                <option value="default">{t('filterDefault')}</option>
                <option value="whitelist">{t('filterWhitelist')}</option>
                <option value="blacklist">{t('filterBlacklist')}</option>
              </select>
            </SettingRow>
            <SettingRow title={t('filterList')} description={t('filterListPlaceholder')} className="tall">
              <textarea
                value={filterText}
                placeholder={t('filterListPlaceholder')}
                onChange={(event) =>
                  update({
                    filterList: event.target.value
                      .split('\n')
                      .map((item) => item.trim().toLowerCase())
                      .filter(Boolean)
                  })
                }
              />
            </SettingRow>
          </SettingSection>
        </div>
      )
    }

    if (activeSection === 'window') {
      return (
        <div className="settings-stack">
          <SettingSection title={t('actionWindowTitle')}>
            <SettingRow title={t('followToolbar')}>
              <Toggle checked={settings.followToolbar} label={t('followToolbar')} onChange={(followToolbar) => update({ followToolbar })} />
            </SettingRow>
            <SettingRow title={t('rememberWindowSize')}>
              <Toggle
                checked={settings.rememberWindowSize}
                label={t('rememberWindowSize')}
                onChange={(rememberWindowSize) => update({ rememberWindowSize })}
              />
            </SettingRow>
            <SettingRow title={t('autoClose')}>
              <Toggle checked={settings.autoClose} label={t('autoClose')} onChange={(autoClose) => update({ autoClose })} />
            </SettingRow>
            <SettingRow title={t('autoPin')}>
              <Toggle checked={settings.autoPin} label={t('autoPin')} onChange={(autoPin) => update({ autoPin })} />
            </SettingRow>
            <SettingRow title={t('actionWindowClose')} description={t('actionWindowCloseDesc')}>
              <select
                value={settings.actionWindowClose}
                onChange={(event) => update({ actionWindowClose: event.target.value as ActionWindowCloseMode })}
              >
                <option value="hide">{t('actionWindowCloseHide')}</option>
                <option value="destroy">{t('actionWindowCloseDestroy')}</option>
              </select>
            </SettingRow>
            <SettingRow title={t('raceResponse')} description={t('raceResponseDesc')}>
              <select
                value={settings.raceResponse}
                onChange={(event) => update({ raceResponse: event.target.value as RaceResponseMode })}
              >
                <option value="abort">{t('raceResponseAbort')}</option>
                <option value="complete">{t('raceResponseComplete')}</option>
              </select>
            </SettingRow>
            <SettingRow title={t('structuredOutputMode')} description={t('structuredOutputModeDesc')}>
              <select
                value={settings.structuredOutputMode}
                onChange={(event) => update({ structuredOutputMode: event.target.value as StructuredOutputMode })}
              >
                <option value="json_schema">{t('structuredOutputModeJsonSchema')}</option>
                <option value="json_object">{t('structuredOutputModeJsonObject')}</option>
                <option value="off">{t('structuredOutputModeOff')}</option>
              </select>
            </SettingRow>
            <SettingRow title={t('sendKey')} description={t('sendKeyDesc')}>
              <select
                value={settings.sendKey}
                onChange={(event) => update({ sendKey: event.target.value as SendKeyMode })}
              >
                <option value="enter">{t('sendKeyEnter')}</option>
                <option value="ctrlEnter">{t('sendKeyCtrlEnter')}</option>
                <option value="shiftEnter">{t('sendKeyShiftEnter')}</option>
              </select>
            </SettingRow>
            <SettingRow title={t('prebuildActionWindow')} description={t('prebuildActionWindowDesc')}>
              <Toggle
                checked={settings.prebuildActionWindow}
                label={t('prebuildActionWindow')}
                onChange={(prebuildActionWindow) => update({ prebuildActionWindow })}
              />
            </SettingRow>
          </SettingSection>

          <SettingSection title={t('appearanceSizeGroup')}>
            <SettingRow title={t('defaultWindowWidth')}>
              <NumberField
                value={settings.actionWindowWidth}
                min={320}
                max={1600}
                onCommit={(actionWindowWidth) => update({ actionWindowWidth })}
              />
            </SettingRow>
            <SettingRow title={t('defaultWindowHeight')}>
              <NumberField
                value={settings.actionWindowHeight}
                min={240}
                max={1200}
                onCommit={(actionWindowHeight) => update({ actionWindowHeight })}
              />
            </SettingRow>
          </SettingSection>

          <SettingSection title={t('appearanceFontGroup')}>
            <SettingRow title={t('fontFamily')} description={t('fontFamilyDesc')} className="tall">
              <input
                value={settings.fontFamily}
                placeholder={t('fontFamilyPlaceholder')}
                onChange={(event) => update({ fontFamily: event.target.value })}
              />
            </SettingRow>
            <SettingRow title={t('fontSize')}>
              <NumberField value={settings.fontSize} min={10} max={28} onCommit={(fontSize) => update({ fontSize })} />
            </SettingRow>
          </SettingSection>
        </div>
      )
    }

    if (activeSection === 'storage') {
      return (
        <div className="settings-stack">
          <SettingSection title={t('storageGroup')}>
            <SettingRow title={t('statsEnabled')} description={t('statsEnabledDesc')}>
              <Toggle
                checked={settings.statsEnabled}
                label={t('statsEnabled')}
                onChange={(statsEnabled) => update({ statsEnabled })}
              />
            </SettingRow>
            <SettingRow title={t('statsDetailLevel')} description={t('statsDetailLevelDesc')}>
              <select
                value={settings.statsDetailLevel}
                onChange={(event) => update({ statsDetailLevel: event.target.value as StatsDetailLevel })}
              >
                <option value="full">{t('statsDetailFull')}</option>
                <option value="noSource">{t('statsDetailNoSource')}</option>
              </select>
            </SettingRow>
          </SettingSection>

          <SettingSection title={t('contextInjectionGroup')}>
            <SettingRow title={t('contextInjectionEnabled')} description={t('contextInjectionEnabledDesc')}>
              <Toggle
                checked={settings.contextInjectionEnabled}
                label={t('contextInjectionEnabled')}
                onChange={(contextInjectionEnabled) => update({ contextInjectionEnabled })}
              />
            </SettingRow>
            <SettingRow
              title={t('contextInjectionFieldSourceApp')}
              description={t('contextInjectionFieldSourceAppDesc')}>
              <Toggle
                checked={settings.contextInjectionFields.includes('sourceApp')}
                label={t('contextInjectionFieldSourceApp')}
                disabled={!settings.contextInjectionEnabled}
                onChange={(on) => updateContextInjectionField('sourceApp', on)}
              />
            </SettingRow>
            <SettingRow title={t('contextInjectionFieldLocalTime')} description={t('contextInjectionFieldLocalTimeDesc')}>
              <Toggle
                checked={settings.contextInjectionFields.includes('localTime')}
                label={t('contextInjectionFieldLocalTime')}
                disabled={!settings.contextInjectionEnabled}
                onChange={(on) => updateContextInjectionField('localTime', on)}
              />
            </SettingRow>
            <SettingRow
              title={t('contextInjectionFieldLocalPlace')}
              description={t('contextInjectionFieldLocalPlaceDesc')}>
              <Toggle
                checked={settings.contextInjectionFields.includes('localPlace')}
                label={t('contextInjectionFieldLocalPlace')}
                disabled={!settings.contextInjectionEnabled}
                onChange={(on) => updateContextInjectionField('localPlace', on)}
              />
            </SettingRow>
          </SettingSection>
        </div>
      )
    }

    return (
      <div className="settings-stack">
        <SettingSection title={t('actions')}>
          <div className="action-list">
            {settings.actions.map((action, index) => (
              <ActionEditor
                key={action.id}
                action={action}
                defaultAction={defaultActionById.get(action.id)}
                language={settings.language}
                providerTemplates={settings.providerTemplates}
                index={index}
                count={settings.actions.length}
                onChange={(patch) => updateAction(action.id, patch)}
                onDelete={() => deleteAction(action.id)}
                onMove={(dir) => moveAction(action.id, dir)}
                t={t}
              />
            ))}
          </div>
          <button type="button" className="add-row-button" onClick={addAction}>
            + {t('addAction')}
          </button>
        </SettingSection>
      </div>
    )
  }

  return (
    <main className="page settings-page">
      <div className="settings-shell">
        <header className="settings-header">
          <div className="settings-toolbar">
            <div className="language-segment" role="group" aria-label={t('language')}>
              <button
                type="button"
                className={settings.language === 'zh-CN' ? 'language-segment-button active' : 'language-segment-button'}
                aria-pressed={settings.language === 'zh-CN'}
                onClick={() => update({ language: 'zh-CN' as AppLanguage })}>
                CN
              </button>
              <button
                type="button"
                className={settings.language === 'en' ? 'language-segment-button active' : 'language-segment-button'}
                aria-pressed={settings.language === 'en'}
                onClick={() => update({ language: 'en' as AppLanguage })}>
                EN
              </button>
            </div>
            <div className="status-control">
              <button
                type="button"
                className="theme-toggle"
                title={settings.language === 'zh-CN' ? '区域录屏' : 'Record a region'}
                aria-label={settings.language === 'zh-CN' ? '区域录屏' : 'Record a region'}
                onClick={() => void window.assistantLite.recording.start()}>
                <Icon name="video" size={16} />
              </button>
              <button
                type="button"
                className={settings.autoLaunch ? 'theme-toggle active' : 'theme-toggle'}
                title={t('autoLaunch')}
                aria-label={t('autoLaunch')}
                aria-pressed={settings.autoLaunch}
                onClick={() => update({ autoLaunch: !settings.autoLaunch })}>
                <Icon name="power" size={14} />
              </button>
              <button
                type="button"
                className="theme-toggle"
                title={t(`theme_${settings.theme}`)}
                aria-label={t(`theme_${settings.theme}`)}
                onClick={cycleTheme}>
                <Icon name={themeIconName[settings.theme]} size={14} />
              </button>
              <span className={settings.enabled ? 'status-label enabled' : 'status-label'}>
                {settings.enabled ? t('statusEnabled') : t('statusDisabled')}
              </span>
              <Toggle checked={settings.enabled} label={t('shortcutToggleAssistant')} onChange={() => void toggleAssistantEnabled()} />
            </div>
          </div>
        </header>

        {!accessibilityTrusted && (
          <section className="accessibility-panel">
            <div>
              <h2>{t('accessibilityTitle')}</h2>
              <p>{t('accessibilityBody')}</p>
            </div>
            <button className="primary" onClick={() => window.assistantLite.selection.requestAccessibility()}>
              {t('accessibilityButton')}
            </button>
          </section>
        )}

        <div className="settings-layout">
          <SettingsNav sections={sections} activeSection={activeSection} onChange={setActiveSection} />

          <section className="settings-content">
            {renderSection()}
          </section>
        </div>
      </div>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SettingsApp />
  </React.StrictMode>
)
