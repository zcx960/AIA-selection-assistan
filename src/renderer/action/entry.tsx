import '../styles.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { buildSearchUrl, interpolatePrompt } from '@shared/actions'
import type { ActionItem, ActionPayload, AiChunkPayload, AppSettings } from '@shared/types'
import { MarkdownView } from '../Markdown'
import { ReasoningLine, ReasoningSummary } from '../ReasoningLine'
import { Icon } from '../icons'
import { useSettings } from '../useSettings'
import { useThemeMode } from '../useThemeMode'
import { useAppearance } from '../useAppearance'
import { getActionLabel, getTranslator } from '../i18n'

interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
  display?: string
  hidden?: boolean
  pending?: boolean
  error?: string
  searchQuery?: string
  /** Accumulated chain-of-thought streamed before the answer. */
  reasoning?: string
  /** Wall-clock ms when the first reasoning fragment arrived. */
  reasoningStart?: number
  /** Seconds spent thinking, frozen when the first content delta lands. */
  reasoningTime?: number
}

type Translator = (key: string) => string

interface ResultProps {
  payload: ActionPayload
  settings: AppSettings
  t: Translator
  pinned: boolean
  togglePin: () => void
}

const isMac = navigator.userAgent.includes('Mac OS X')

function Titlebar({
  icon,
  title,
  pinned,
  togglePin,
  t
}: {
  icon: string
  title: string
  pinned: boolean
  togglePin: () => void
  t: Translator
}) {
  return (
    <div className="titlebar">
      <Icon name={icon} />
      <strong>{title}</strong>
      <button className="icon" title={pinned ? t('unpin') : t('pin')} onClick={togglePin}>
        <Icon name={pinned ? 'pin-off' : 'pin'} />
      </button>
      {!isMac && (
        <>
          <button className="icon" title={t('minimize')} onClick={() => window.assistantLite.windowControls.minimize()}>
            <span>-</span>
          </button>
          <button className="icon" title={t('close')} onClick={() => window.assistantLite.windowControls.close()}>
            <Icon name="x" />
          </button>
        </>
      )}
    </div>
  )
}

// Shared streaming state for a single action's result window. Each request
// carries the action's chosen provider and reasoning mode. Hidden user turns
// (the interpolated prompt) feed the model but are not rendered.
function useActionStream(action: ActionItem, t: Translator) {
  const [chat, setChat] = React.useState<ChatTurn[]>([])
  const chatRef = React.useRef<ChatTurn[]>([])
  const activeRequestId = React.useRef<string | null>(null)

  React.useEffect(() => {
    chatRef.current = chat
  }, [chat])

  React.useEffect(() => {
    return window.assistantLite.ai.onChunk((chunk: AiChunkPayload) => {
      if (chunk.requestId !== activeRequestId.current) return
      setChat((current) => {
        if (!current.length) return current
        const next = [...current]
        const last = { ...next[next.length - 1] }
        if (chunk.type === 'delta') {
          last.text += chunk.text ?? ''
          if (last.reasoningStart !== undefined && last.reasoningTime === undefined) {
            last.reasoningTime = (Date.now() - last.reasoningStart) / 1000
          }
          last.pending = true
        } else if (chunk.type === 'reasoning') {
          last.reasoning = (last.reasoning ?? '') + (chunk.reasoning ?? '')
          if (last.reasoningStart === undefined) last.reasoningStart = Date.now()
          last.pending = true
        } else if (chunk.type === 'status') {
          last.searchQuery = chunk.text ?? ''
        } else if (chunk.type === 'done') {
          last.pending = false
        } else if (chunk.type === 'error') {
          last.pending = false
          last.error = chunk.error ?? t('unknownProviderError')
        }
        next[next.length - 1] = last
        return next
      })
      if (chunk.type === 'done' || chunk.type === 'error') {
        activeRequestId.current = null
      }
    })
  }, [t])

  // Send a turn against the current (or reset) history. We read history from a
  // ref to avoid running side-effects inside a setState updater (which would
  // double-fire under StrictMode and could issue duplicate streams).
  const send = React.useCallback(
    (opts: { sendText: string; display?: string; hidden?: boolean; reset?: boolean }) => {
      const history = opts.reset ? [] : chatRef.current
      const messages = [
        ...history.map((turn) => ({ role: turn.role, text: turn.text })),
        { role: 'user' as const, text: opts.sendText }
      ]
      const requestId = crypto.randomUUID()
      activeRequestId.current = requestId
      void window.assistantLite.ai.stream({
        requestId,
        messages,
        providerTemplateId: action.providerTemplateId,
        reasoning: action.reasoning
      })
      setChat([
        ...history,
        { role: 'user', text: opts.sendText, display: opts.display, hidden: opts.hidden },
        { role: 'assistant', text: '', pending: true }
      ])
    },
    [action]
  )

  const stop = React.useCallback(() => {
    if (activeRequestId.current) void window.assistantLite.ai.abort(activeRequestId.current)
    activeRequestId.current = null
    setChat((current) => {
      if (!current.length) return current
      const next = [...current]
      next[next.length - 1] = { ...next[next.length - 1], pending: false }
      return next
    })
  }, [])

  const loading = !!chat[chat.length - 1]?.pending
  const hasResult = chat.some((turn) => turn.role === 'assistant' && turn.text)
  return { chat, setChat, send, stop, loading, hasResult, activeRequestId }
}

function useAutoScroll(ref: React.RefObject<HTMLDivElement>, dep: unknown) {
  const stick = React.useRef(true)
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [ref])
  React.useEffect(() => {
    if (!stick.current) return
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [ref, dep])
  return stick
}

function ChatTurns({
  chat,
  t,
  isZh,
  showThinking
}: {
  chat: ChatTurn[]
  t: Translator
  isZh: boolean
  showThinking: boolean
}) {
  return (
    <>
      {chat.map((turn, index) => {
        if (turn.role === 'assistant') {
          return (
            <div key={index} className="result markdown-body">
              {turn.searchQuery && (
                <div className="search-status">
                  {isZh ? `🔍 联网搜索：${turn.searchQuery}` : `🔍 Web search: ${turn.searchQuery}`}
                </div>
              )}
              {turn.text && turn.reasoningTime !== undefined && (
                <ReasoningSummary seconds={turn.reasoningTime} label={isZh ? '思考了' : 'Thought for'} />
              )}
              {turn.text ? (
                <MarkdownView>{turn.text}</MarkdownView>
              ) : turn.pending && showThinking ? (
                <ReasoningLine
                  reasoning={turn.reasoning}
                  pending={turn.pending}
                  preparing={t('preparing')}
                  label={isZh ? '思考中' : 'Thinking…'}
                />
              ) : null}
              {turn.error && <div className="error">{turn.error}</div>}
            </div>
          )
        }
        if (turn.hidden) return null
        return (
          <div key={index} className="screenshot-preview__user-msg">
            {turn.display ?? turn.text}
          </div>
        )
      })}
    </>
  )
}

function copyLastResult(chat: ChatTurn[]): void {
  const last = [...chat].reverse().find((turn) => turn.role === 'assistant' && turn.text)
  if (last) void navigator.clipboard.writeText(last.text)
}

// Selection mode: run the action on the selected text immediately, then allow
// follow-up questions in the same window.
function SelectionResult({ payload, settings, t, pinned, togglePin }: ResultProps) {
  const isZh = settings.language === 'zh-CN'
  // With reasoning off the answer streams back almost immediately, so the
  // "Thinking…" placeholder is just a flash of noise — only show it when on.
  const showThinking = (payload.action.reasoning ?? 'on') !== 'off'
  const { chat, send, stop, loading, hasResult } = useActionStream(payload.action, t)
  const [askOpen, setAskOpen] = React.useState(false)
  const [askText, setAskText] = React.useState('')
  const askInputRef = React.useRef<HTMLInputElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const stick = useAutoScroll(contentRef, chat)

  const runInitialAction = React.useCallback(() => {
    const prompt = interpolatePrompt(payload.action.promptTemplate, payload.selectedText, {
      language: t('targetLanguageName')
    })
    setAskOpen(false)
    setAskText('')
    stick.current = true
    setTimeout(() => send({ sendText: prompt, hidden: true, reset: true }), 0)
  }, [payload, t, send, stick])

  React.useEffect(() => {
    runInitialAction()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload])

  const submitAsk = () => {
    const text = askText.trim()
    if (!text || loading) return
    setAskText('')
    setAskOpen(false)
    stick.current = true
    send({ sendText: text, display: text })
  }

  return (
    <div className="action-window action-window--flex">
      <Titlebar
        icon={payload.action.icon}
        title={getActionLabel(payload.action, settings.language)}
        pinned={pinned}
        togglePin={togglePin}
        t={t}
      />

      <div className="content" ref={contentRef}>
        {chat.length === 0 && showThinking && <div className="thinking-indicator">{t('preparing')}</div>}
        <ChatTurns chat={chat} t={t} isZh={isZh} showThinking={showThinking} />
      </div>

      {askOpen && (
        <div className="screenshot-preview__ask">
          <input
            ref={askInputRef}
            type="text"
            value={askText}
            placeholder={isZh ? '继续追问…' : 'Ask a follow-up…'}
            onChange={(e) => setAskText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submitAsk()
              } else if (e.key === 'Escape') {
                // Esc here closes the follow-up box only — keep it from bubbling
                // up to the window-level handler that would close the window.
                e.stopPropagation()
                setAskOpen(false)
                setAskText('')
              }
            }}
          />
          <button className="ask-send" onClick={submitAsk} disabled={!askText.trim() || loading} title={isZh ? '发送' : 'Send'}>
            <Icon name="arrow-up" size={18} />
          </button>
        </div>
      )}

      <div className="footer">
        <button onClick={loading ? stop : () => window.assistantLite.windowControls.close()}>
          {loading ? t('stop') : t('close')}
        </button>
        <button onClick={runInitialAction} disabled={loading}>
          {t('regenerate')}
        </button>
        <button
          onClick={() => {
            setAskOpen((v) => !v)
            setTimeout(() => askInputRef.current?.focus(), 0)
          }}
          disabled={loading}>
          {isZh ? '追问' : 'Ask'}
        </button>
        <button onClick={() => copyLastResult(chat)} disabled={loading || !hasResult}>
          {t('copy')}
        </button>
      </div>
    </div>
  )
}

// Input mode: open with a type-in box, run the action on the typed text, and
// show a one-shot result. Re-running replaces the result (no follow-up chat).
function InputResult({ payload, settings, t, pinned, togglePin }: ResultProps) {
  const isZh = settings.language === 'zh-CN'
  const showThinking = (payload.action.reasoning ?? 'on') !== 'off'
  const { chat, setChat, send, stop, loading, hasResult } = useActionStream(payload.action, t)
  const [input, setInput] = React.useState('')
  const inputRef = React.useRef<HTMLTextAreaElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const stick = useAutoScroll(contentRef, chat)

  React.useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  React.useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(140, el.scrollHeight)}px`
  }, [input])

  const run = React.useCallback(
    (text: string) => {
      const value = text.trim()
      if (!value || loading) return
      const prompt = interpolatePrompt(payload.action.promptTemplate, value, { language: t('targetLanguageName') })
      stick.current = true
      send({ sendText: prompt, hidden: true, reset: true })
    },
    [payload, t, send, loading, stick]
  )

  const lastInputRef = React.useRef('')
  const submit = () => {
    const value = input.trim()
    if (!value || loading) return
    if (payload.action.type === 'search') {
      const url = buildSearchUrl(payload.action, value)
      if (url) void window.assistantLite.app.openExternal(url)
      void window.assistantLite.windowControls.close()
      return
    }
    if (payload.action.type === 'copy') {
      void navigator.clipboard.writeText(value)
      void window.assistantLite.windowControls.close()
      return
    }
    if (payload.action.type === 'speak') {
      void window.assistantLite.speech.speak(value)
      void window.assistantLite.windowControls.close()
      return
    }
    lastInputRef.current = input
    run(input)
  }

  return (
    <div className="action-window action-window--flex">
      <Titlebar
        icon={payload.action.icon}
        title={getActionLabel(payload.action, settings.language)}
        pinned={pinned}
        togglePin={togglePin}
        t={t}
      />

      <div className="action-input">
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          placeholder={isZh ? '输入文本，回车运行…' : 'Type text, Enter to run…'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              if (loading) stop()
              else submit()
            }
          }}
        />
        <button
          className="action-input__btn"
          onClick={loading ? stop : submit}
          disabled={!loading && !input.trim()}
          title={loading ? t('stop') : isZh ? '运行' : 'Run'}>
          <Icon name={loading ? 'square' : 'arrow-up'} size={18} />
        </button>
      </div>

      {chat.length > 0 && (
        <div className="content" ref={contentRef}>
          <ChatTurns chat={chat} t={t} isZh={isZh} showThinking={showThinking} />
        </div>
      )}

      <div className="footer">
        <button onClick={() => window.assistantLite.windowControls.close()}>{t('close')}</button>
        <button onClick={() => run(lastInputRef.current)} disabled={loading || !lastInputRef.current.trim()}>
          {t('regenerate')}
        </button>
        <button
          onClick={() => {
            setChat([])
            setInput('')
            setTimeout(() => inputRef.current?.focus(), 0)
          }}
          disabled={loading || (!hasResult && !input)}>
          {isZh ? '清空' : 'Clear'}
        </button>
        <button onClick={() => copyLastResult(chat)} disabled={loading || !hasResult}>
          {t('copy')}
        </button>
      </div>
    </div>
  )
}

function ActionApp() {
  const { settings } = useSettings()
  // Seed from the payload the window was opened with so the very first render
  // already has content; the main process shows the window on its first paint.
  // Later opens that reuse this window arrive via onAction below.
  const [payload, setPayload] = React.useState<ActionPayload | null>(
    () => window.assistantLite.selection.getInitialAction()
  )
  const [pinned, setPinned] = React.useState(settings.autoPin)
  const t = getTranslator(settings.language)
  useThemeMode(settings.theme)
  useAppearance(settings)

  // Esc closes the action window (both selection-result and type-in modes).
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void window.assistantLite.windowControls.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  React.useEffect(() => {
    document.documentElement.classList.add('action-page-root')
    document.body.classList.add('action-page')
    return () => {
      document.documentElement.classList.remove('action-page-root')
      document.body.classList.remove('action-page')
    }
  }, [])

  React.useEffect(() => window.assistantLite.selection.onAction(setPayload), [])

  React.useEffect(() => {
    const onBlur = () => {
      if (settings.autoClose && !pinned) void window.assistantLite.windowControls.close()
    }
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [settings.autoClose, pinned])

  const togglePin = () => {
    const next = !pinned
    setPinned(next)
    void window.assistantLite.windowControls.pin(next)
  }

  if (!payload) return null

  const shared: ResultProps = { payload, settings, t, pinned, togglePin }
  // Keyed by action so reusing the window for a different action remounts with
  // fresh state; re-running the same action re-uses the instance.
  return payload.mode === 'input' ? (
    <InputResult key={`input:${payload.action.id}`} {...shared} />
  ) : (
    <SelectionResult key={`selection:${payload.action.id}`} {...shared} />
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ActionApp />
  </React.StrictMode>
)
