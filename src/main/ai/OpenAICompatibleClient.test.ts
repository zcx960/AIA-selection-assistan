import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  listModels,
  normalizeBaseUrl,
  parseAnthropicStreamEvent,
  parseOpenAIStreamEvent,
  streamChatMessages,
  testModel
} from './OpenAICompatibleClient'
import type { ProviderSettings } from '@shared/types'

const provider: ProviderSettings = {
  apiType: 'openai',
  baseUrl: 'https://api.example.com/v1/',
  apiKey: 'test-key',
  model: 'gpt-test',
  temperature: 1
}

const anthropicProvider: ProviderSettings = {
  apiType: 'anthropic',
  baseUrl: 'https://api.anthropic.com',
  apiKey: 'anthropic-key',
  model: 'claude-3-5-sonnet-latest',
  temperature: 1
}

afterEach(() => {
  vi.restoreAllMocks()
})

function streamingTextResponse(text: string): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: {"choices":[{"delta":{"content":"${text}"}}]}\n\n`))
      controller.close()
    }
  })
  return new Response(body, { status: 200 })
}

describe('OpenAI-compatible stream parser', () => {
  it('normalizes trailing slashes from base URLs', () => {
    expect(normalizeBaseUrl('https://api.example.com/v1///')).toBe('https://api.example.com/v1')
  })

  it('normalizes full OpenAI-compatible endpoint URLs back to the API root', () => {
    expect(normalizeBaseUrl('https://api.example.com/v1/chat/completions')).toBe('https://api.example.com/v1')
    expect(normalizeBaseUrl('https://api.example.com/v1/models/')).toBe('https://api.example.com/v1')
  })

  it('parses text deltas from SSE events', () => {
    const event = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n'
    expect(parseOpenAIStreamEvent(event)).toEqual({ content: 'hello' })
  })

  it('parses reasoning deltas from SSE events', () => {
    const event = 'data: {"choices":[{"delta":{"reasoning_content":"let me think"}}]}\n\n'
    expect(parseOpenAIStreamEvent(event)).toEqual({ reasoning: 'let me think' })
  })

  it('returns null for done events', () => {
    expect(parseOpenAIStreamEvent('data: [DONE]\n\n')).toBeNull()
  })

  it('parses anthropic text deltas from SSE events', () => {
    const event = 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hello"}}\n\n'
    expect(parseAnthropicStreamEvent(event)).toEqual({ content: 'hello' })
  })

  it('parses anthropic thinking deltas from SSE events', () => {
    const event = 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hmm"}}\n\n'
    expect(parseAnthropicStreamEvent(event)).toEqual({ reasoning: 'hmm' })
  })

  it('lists sorted model ids and filters invalid model entries', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: 'z-model' }, { id: '' }, { id: 123 }, { id: 'a-model' }]
        }),
        { status: 200 }
      )
    )

    await expect(listModels(provider)).resolves.toEqual(['a-model', 'z-model'])
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/v1/models', {
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-key'
      }
    })
  })

  it('uses an injected fetcher for provider requests', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('global fetch failed'))
    const providerFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: 'custom-fetch-model' }]
        }),
        { status: 200 }
      )
    )

    await expect(listModels(provider, { fetcher: providerFetch })).resolves.toEqual(['custom-fetch-model'])
    expect(globalFetch).not.toHaveBeenCalled()
    expect(providerFetch).toHaveBeenCalledWith('https://api.example.com/v1/models', {
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-key'
      }
    })
  })

  it('tests a model with a lightweight non-streaming chat request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 })
    )

    await expect(testModel(provider)).resolves.toBeUndefined()
    const [, init] = fetchMock.mock.calls[0]
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/v1/chat/completions')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'gpt-test',
      stream: false,
      max_completion_tokens: 8
    })
  })

  it('sends explicit OpenAI-compatible reasoning effort for selected intensity', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamingTextResponse('OK'))
    const deltas: string[] = []

    await streamChatMessages(
      provider,
      [{ role: 'user', text: 'explain this' }],
      'system',
      new AbortController().signal,
      (delta) => deltas.push(delta.content ?? ''),
      'high'
    )

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(String(init?.body))).toMatchObject({
      reasoning_effort: 'high'
    })
    expect(deltas).toEqual(['OK'])
  })

  it('lists anthropic models using the v1/models endpoint and anthropic headers', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'claude-3-5-haiku-latest' }] }), { status: 200 })
    )

    await expect(listModels(anthropicProvider)).resolves.toEqual(['claude-3-5-haiku-latest'])
    expect(fetchMock).toHaveBeenCalledWith('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'anthropic-key',
        'anthropic-version': '2023-06-01'
      }
    })
  })

  it('tests an anthropic model using the v1/messages endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'OK' }] }), { status: 200 })
    )

    await expect(testModel(anthropicProvider)).resolves.toBeUndefined()
    const [, init] = fetchMock.mock.calls[0]
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages')
    expect(init?.headers).toEqual({
      'content-type': 'application/json',
      'x-api-key': 'anthropic-key',
      'anthropic-version': '2023-06-01'
    })
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'claude-3-5-sonnet-latest',
      stream: false,
      max_tokens: 8,
      system: 'Reply with OK only.'
    })
  })

  it('returns readable provider errors when model testing fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('bad key', { status: 401, statusText: 'Unauthorized' }))

    await expect(testModel(provider)).rejects.toThrow('Provider request failed (401): bad key')
  })
})
