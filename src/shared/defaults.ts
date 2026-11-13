import type { ActionItem, AppSettings, ProviderTemplate } from './types'
import { DEFAULT_STRUCTURED_OUTPUT_MODE } from './structuredOutput'

export const defaultActions: ActionItem[] = [
  {
    id: 'translate',
    name: 'Translate',
    enabled: true,
    icon: 'languages',
    type: 'prompt',
    promptTemplate:
      'Translate the following text into {{language}}. Preserve the original meaning and tone as much as possible. Return only the translation.\n\n{{text}}'
  },
  {
    id: 'explain',
    name: 'Explain',
    enabled: true,
    icon: 'circle-help',
    type: 'prompt',
    promptTemplate:
      'Explain the following text directly in plain, easy-to-understand language. Be concise, stay focused on the meaning, and avoid unnecessary filler. Add a brief summary only when it is genuinely helpful.\n\n{{text}}'
  },
  {
    id: 'summarize',
    name: 'Summarize',
    enabled: true,
    icon: 'scan-text',
    type: 'prompt',
    promptTemplate:
      'Summarize the following text into 3-5 concise bullet points. Focus on the main ideas, key facts, and takeaways. Keep the wording simple and direct.\n\n{{text}}'
  },
  {
    id: 'search',
    name: 'Search',
    enabled: true,
    icon: 'search',
    type: 'search',
    searchUrlTemplate: 'https://www.google.com/search?q={{query}}'
  },
  {
    id: 'copy',
    name: 'Copy',
    enabled: true,
    icon: 'copy',
    type: 'copy'
  },
  {
    id: 'speak',
    name: 'Speak',
    enabled: true,
    icon: 'volume-2',
    type: 'speak'
  },
  {
    id: 'polish',
    name: 'Polish',
    enabled: true,
    icon: 'sparkles',
    type: 'prompt',
    promptTemplate:
      'Rewrite the following text to be clearer, smoother, and more natural while preserving its original meaning. Keep the tone appropriate to the source and do not add new information.\n\n{{text}}'
  },
  {
    id: 'quote',
    name: 'Pre-select',
    enabled: true,
    icon: 'quote',
    type: 'quote'
  }
]

export const defaultProviderTemplate: ProviderTemplate = {
  id: 'default-provider',
  name: 'Default',
  provider: {
    apiType: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    temperature: 1
  }
}

export const defaultSettings: AppSettings = {
  language: 'zh-CN',
  theme: 'system',
  enabled: false,
  triggerMode: 'selected',
  // Default on: the fork author's primary use case; users can turn it off in
  // settings (non-text Ctrl+A stays silent because no text selection exists).
  selectAllTrigger: true,
  compactToolbar: false,
  showToolbarAppIcon: true,
  followToolbar: true,
  rememberWindowSize: false,
  autoClose: false,
  autoPin: false,
  actionWindowClose: 'hide',
  raceResponse: 'abort',
  prebuildActionWindow: true,
  statsEnabled: false,
  statsDetailLevel: 'full',
  // Context injection: off by default (the leak is certain, the benefit
  // only possible). Field ticks default to all three so turning the master
  // switch on yields the full feature without hunting for every checkbox.
  contextInjectionEnabled: false,
  contextInjectionFields: ['sourceApp', 'localTime', 'localPlace'],
  sendKey: 'enter',
  actionWindowWidth: 560,
  actionWindowHeight: 420,
  fontFamily: '',
  fontSize: 14,
  autoLaunch: false,
  filterMode: 'default',
  filterList: [],
  provider: defaultProviderTemplate.provider,
  providerTemplates: [defaultProviderTemplate],
  activeProviderTemplateId: defaultProviderTemplate.id,
  webSearchEnabled: true,
  structuredOutputMode: DEFAULT_STRUCTURED_OUTPUT_MODE,
  shortcuts: {
    toggleAssistant: 'CommandOrControl+Shift+Space',
    processSelection: 'CommandOrControl+Shift+S',
    captureScreen: 'CommandOrControl+Shift+A',
    recordScreen: 'CommandOrControl+Shift+R',
    chat: 'CommandOrControl+Shift+C'
  },
  actions: defaultActions
}
