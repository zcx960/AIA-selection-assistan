import type { AiMessageInput, ProviderApiType, ProviderSettings, ReasoningMode } from '@shared/types'

export class AiConfigurationError extends Error {}
const ANTHROPIC_VERSION = '2023-06-01'

export type ProviderFetch = (input: string, init?: RequestInit) => Promise<Response>

export interface ProviderRequestOptions {
  readonly fetcher?: ProviderFetch
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/(?:chat\/completions|models)$/i, '')
    .replace(/\/+$/, '')
}

function normalizeAnthropicBaseUrl(baseUrl: string): string {
  return normalizeBaseUrl(baseUrl).replace(/\/v1(?:\/messages|\/models)?$/i, '')
}

function buildProviderUrl(provider: ProviderSettings, path: 'chat/completions' | 'models' | 'messages'): string {
  if (provider.apiType === 'anthropic') {
    const base = normalizeAnthropicBaseUrl(provider.baseUrl)
    if (path === 'messages') return `${base}/v1/messages`
    if (path === 'models') return `${base}/v1/models`
    return `${base}/v1/messages`
  }
  return `${normalizeBaseUrl(provider.baseUrl)}/${path}`
}

function buildProviderHeaders(provider: ProviderSettings): Record<string, string> {
  if (provider.apiType === 'anthropic') {
    return {
      'content-type': 'application/json',
      'x-api-key': provider.apiKey,
      'anthropic-version': ANTHROPIC_VERSION
    }
  }

  return {
    'content-type': 'application/json',
    authorization: `Bearer ${provider.apiKey}`
  }
}

function fetchProvider(url: string, init: RequestInit, options: ProviderRequestOptions = {}): Promise<Response> {
  return (options.fetcher ?? fetch)(url, init)
}

function assertProviderReady(provider: ProviderSettings, requireModel = true): void {
  if (!provider.apiKey.trim()) {
    throw new AiConfigurationError('Missing API key. Open Settings and configure your API provider.')
  }
  if (requireModel && !provider.model.trim()) {
    throw new AiConfigurationError('Missing model. Open Settings and set a model name.')
  }
}

async function readProviderError(response: Response): Promise<string> {
  const body = await response.text().catch(() => '')
  return `Provider request failed (${response.status}): ${body || response.statusText}`
}

export interface StreamDelta {
  content?: string
  reasoning?: string
}

export function parseOpenAIStreamEvent(raw: string): StreamDelta | null {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))

  for (const line of lines) {
    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') return null
    try {
      const parsed = JSON.parse(payload) as {
        choices?: Array<{
          delta?: {
            content?: string
            reasoning_content?: string
            reasoning?: string
            thinking?: string
          }
          message?: { content?: string }
        }>
      }
      const delta = parsed.choices?.[0]?.delta
      if (!delta) continue
      const content = delta.content ?? parsed.choices?.[0]?.message?.content
      const reasoning = delta.reasoning_content ?? delta.reasoning ?? delta.thinking
      if (typeof content === 'string' || typeof reasoning === 'string') {
        const result: StreamDelta = {}
        if (typeof content === 'string') result.content = content
        if (typeof reasoning === 'string') result.reasoning = reasoning
        return result
      }
    } catch {
      // Incomplete or malformed JSON chunk — skip silently
      continue
    }
  }
  return null
}

export function parseAnthropicStreamEvent(raw: string): StreamDelta | null {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'))

  for (const line of lines) {
    const payload = line.slice(5).trim()
    if (!payload) return null

    try {
      const parsed = JSON.parse(payload) as {
        type?: string
        delta?: { type?: string; text?: string; thinking?: string }
      }

      if (parsed.type === 'content_block_delta' && parsed.delta) {
        if (parsed.delta.type === 'text_delta' && parsed.delta.text) {
          return { content: parsed.delta.text }
        }
        if (parsed.delta.type === 'thinking_delta' && parsed.delta.thinking) {
          return { reasoning: parsed.delta.thinking }
        }
      }
    } catch {
      // Incomplete or malformed JSON chunk — skip silently
      continue
    }
  }
  return null
}

function parseProviderStreamEvent(apiType: ProviderApiType, raw: string): StreamDelta | null {
  return apiType === 'anthropic' ? parseAnthropicStreamEvent(raw) : parseOpenAIStreamEvent(raw)
}

function parseDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl.trim())
  if (!match) return null
  return { mediaType: match[1], data: match[2] }
}

function buildOpenAIContent(message: AiMessageInput): unknown {
  if (!message.images?.length) return message.text
  const parts: unknown[] = []
  if (message.text) parts.push({ type: 'text', text: message.text })
  for (const image of message.images) {
    parts.push({ type: 'image_url', image_url: { url: image } })
  }
  return parts
}

function buildAnthropicContent(message: AiMessageInput): unknown {
  if (!message.images?.length) return message.text
  const parts: unknown[] = []
  for (const image of message.images) {
    const parsed = parseDataUrl(image)
    if (!parsed) continue
    parts.push({
      type: 'image',
      source: { type: 'base64', media_type: parsed.mediaType, data: parsed.data }
    })
  }
  if (message.text) parts.push({ type: 'text', text: message.text })
  return parts
}

export async function streamChatCompletion(
  provider: ProviderSettings,
  prompt: string,
  systemPrompt: string,
  signal: AbortSignal,
  onDelta: (delta: StreamDelta) => void
): Promise<void> {
  return streamChatMessages(provider, [{ role: 'user', text: prompt }], systemPrompt, signal, onDelta)
}

const anthropicThinkingBudget: Record<Extract<ReasoningMode, 'low' | 'medium' | 'high'>, number> = {
  low: 1024,
  medium: 2048,
  high: 4096
}

// Reasoning control. 'on' means "model default" — we send nothing extra, so it
// works with every provider. 'off' explicitly suppresses thinking: Anthropic has
// no thinking unless enabled (so nothing to do), while OpenAI-compatible thinking
// models (Qwen/DeepSeek/GLM, vLLM, ...) disable it via enable_thinking:false.
// low/medium/high use the OpenAI-compatible reasoning_effort field; Anthropic
// gets its native thinking budget when the user explicitly asks for intensity.
function applyReasoning(body: Record<string, unknown>, apiType: ProviderApiType, reasoning: ReasoningMode): void {
  if (reasoning === 'on') return
  if (reasoning === 'off') {
    if (apiType === 'anthropic') return
    body.enable_thinking = false
    body.chat_template_kwargs = { enable_thinking: false }
    return
  }

  if (apiType === 'anthropic') {
    const budget = anthropicThinkingBudget[reasoning]
    body.thinking = { type: 'enabled', budget_tokens: budget }
    body.max_tokens = Math.max(typeof body.max_tokens === 'number' ? body.max_tokens : 0, budget + 1024)
    return
  }

  body.reasoning_effort = reasoning
}

export async function streamChatMessages(
  provider: ProviderSettings,
  messages: AiMessageInput[],
  systemPrompt: string,
  signal: AbortSignal,
  onDelta: (delta: StreamDelta) => void,
  reasoning: ReasoningMode = 'on',
  options: ProviderRequestOptions = {}
): Promise<void> {
  assertProviderReady(provider)

  const body: Record<string, unknown> =
    provider.apiType === 'anthropic'
      ? {
          model: provider.model,
          temperature: provider.temperature,
          max_tokens: 1024,
          stream: true,
          system: systemPrompt,
          messages: messages.map((message) => ({
            role: message.role,
            content: buildAnthropicContent(message)
          }))
        }
      : {
          model: provider.model,
          temperature: provider.temperature,
          stream: true,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages.map((message) => ({
              role: message.role,
              content: buildOpenAIContent(message)
            }))
          ]
        }
  applyReasoning(body, provider.apiType, reasoning)

  const response = await fetchProvider(
    buildProviderUrl(provider, provider.apiType === 'anthropic' ? 'messages' : 'chat/completions'),
    {
      method: 'POST',
      signal,
      headers: buildProviderHeaders(provider),
      body: JSON.stringify(body)
    },
    options
  )

  if (!response.ok) {
    throw new Error(await readProviderError(response))
  }
  if (!response.body) throw new Error('Provider returned an empty response body.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''

    for (const event of events) {
      const delta = parseProviderStreamEvent(provider.apiType, event)
      if (delta) onDelta(delta)
    }
  }

  if (buffer.trim()) {
    const delta = parseProviderStreamEvent(provider.apiType, buffer)
    if (delta) onDelta(delta)
  }
}

export async function listModels(provider: ProviderSettings, options: ProviderRequestOptions = {}): Promise<string[]> {
  assertProviderReady(provider, false)
  const response = await fetchProvider(
    buildProviderUrl(provider, 'models'),
    {
      method: 'GET',
      headers: buildProviderHeaders(provider)
    },
    options
  )

  if (!response.ok) throw new Error(await readProviderError(response))

  const body = (await response.json()) as { data?: Array<{ id?: unknown }> }
  return (body.data ?? [])
    .map((model) => model.id)
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .sort((a, b) => a.localeCompare(b))
}

export async function testModel(provider: ProviderSettings, options: ProviderRequestOptions = {}): Promise<void> {
  assertProviderReady(provider)
  const body =
    provider.apiType === 'anthropic'
      ? {
          model: provider.model,
          temperature: provider.temperature,
          stream: false,
          max_tokens: 8,
          system: 'Reply with OK only.',
          messages: [{ role: 'user', content: 'ping' }]
        }
      : {
          model: provider.model,
          temperature: 0,
          stream: false,
          max_completion_tokens: 8,
          messages: [
            { role: 'system', content: 'Reply with OK only.' },
            { role: 'user', content: 'ping' }
          ]
        }

  const response = await fetchProvider(
    buildProviderUrl(provider, provider.apiType === 'anthropic' ? 'messages' : 'chat/completions'),
    {
      method: 'POST',
      headers: buildProviderHeaders(provider),
      body: JSON.stringify(body)
    },
    options
  )

  if (!response.ok) throw new Error(await readProviderError(response))
  await response.json().catch(() => undefined)
}
