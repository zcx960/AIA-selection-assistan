import '../styles.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import type { AiChunkPayload, AiMessageInput } from '@shared/types'
import { MarkdownView } from '../Markdown'
import { ReasoningLine, ReasoningSummary } from '../ReasoningLine'
import { Icon } from '../icons'
import { useSettings } from '../useSettings'
import { useThemeMode } from '../useThemeMode'
import { useAppearance } from '../useAppearance'
import { getTranslator } from '../i18n'

interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
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

const isMac = navigator.userAgent.includes('Mac OS X')

function ChatApp() {
  const { settings } = useSettings()
  const t = getTranslator(settings.language)
  useThemeMode(settings.theme)
  useAppearance(settings)
  const isZh = settings.language === 'zh-CN'

  const [chat, setChat] = React.useState<ChatTurn[]>([])
  const [input, setInput] = React.useState('')
  const [pinned, setPinned] = React.useState(false)
  const activeRequestId = React.useRef<string | null>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const inputRef = React.useRef<HTMLTextAreaElement>(null)
  // Mirror of chat state so sendMessage can derive history without
  // performing side-effects from inside a setState updater (which would
  // double-fire under React.StrictMode and could send the request twice).
  const chatRef = React.useRef<ChatTurn[]>([])
  // Track whether the user has scrolled away from the bottom; if so, we
  // stop force-following the latest tokens so they can read freely.
  const stickToBottomRef = React.useRef(true)

  React.useEffect(() => {
    document.documentElement.classList.add('action-page-root')
    document.body.classList.add('action-page')
    return () => {
      document.documentElement.classList.remove('action-page-root')
      document.body.classList.remove('action-page')
    }
  }, [])

  // Focus input on mount
  React.useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  // Esc closes the window (state is destroyed with the window — "用后即销毁")
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void window.assistantLite.windowControls.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Abort any in-flight stream when the window is being destroyed
  React.useEffect(() => {
    const onBeforeUnload = () => {
      if (activeRequestId.current) {
        void window.assistantLite.ai.abort(activeRequestId.current)
        activeRequestId.current = null
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

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

  React.useEffect(() => {
    chatRef.current = chat
  }, [chat])

  // Track scroll position: only auto-follow new content while the user
  // is already near the bottom. Once they scroll up, leave them alone.
  React.useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      stickToBottomRef.current = distance < 32
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // Auto-scroll on new content, but only when sticking to the bottom.
  React.useEffect(() => {
    if (!stickToBottomRef.current) return
    const el = contentRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat])

  // Auto-grow textarea
  React.useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(140, el.scrollHeight)}px`
  }, [input])

  const sendMessage = (text: string) => {
    if (!text.trim() || activeRequestId.current) return
    const history = chatRef.current
    const messages: AiMessageInput[] = [
      ...history.map((turn) => ({ role: turn.role, text: turn.text })),
      { role: 'user', text }
    ]
    const requestId = crypto.randomUUID()
    activeRequestId.current = requestId
    // Send first so the assistant placeholder always corresponds to an
    // in-flight request, even if React re-runs the state updater.
    void window.assistantLite.ai.stream({ requestId, messages })
    // Snap to bottom when the user sends a new message.
    stickToBottomRef.current = true
    setChat([
      ...history,
      { role: 'user', text },
      { role: 'assistant', text: '', pending: true }
    ])
  }

  const submit = () => {
    const text = input.trim()
    if (!text) return
    setInput('')
    sendMessage(text)
  }

  const stop = () => {
    if (activeRequestId.current) {
      void window.assistantLite.ai.abort(activeRequestId.current)
      activeRequestId.current = null
    }
    setChat((current) => {
      if (!current.length) return current
      const next = [...current]
      const last = { ...next[next.length - 1] }
      last.pending = false
      next[next.length - 1] = last
      return next
    })
  }

  const newChat = () => {
    if (activeRequestId.current) {
      void window.assistantLite.ai.abort(activeRequestId.current)
      activeRequestId.current = null
    }
    chatRef.current = []
    stickToBottomRef.current = true
    setChat([])
    setInput('')
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const togglePin = () => {
    const next = !pinned
    setPinned(next)
    void window.assistantLite.windowControls.pin(next)
  }

  const lastTurn = chat[chat.length - 1]
  const loading = !!lastTurn?.pending

  return (
    <div className="action-window action-window--flex">
      <div className="titlebar">
        <Icon name="sparkles" />
        <strong>{isZh ? 'AI 对话' : 'AI Chat'}</strong>
        <button className="icon" title={isZh ? '新对话' : 'New chat'} onClick={newChat} disabled={chat.length === 0 && !loading}>
          <Icon name="trash-2" />
        </button>
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

      <div className="content chat-content" ref={contentRef}>
        {chat.length === 0 ? (
          <div className="chat-empty">
            <Icon name="sparkles" size={28} />
            <div className="chat-empty__title">{isZh ? '开始一段对话' : 'Start a chat'}</div>
            <div className="chat-empty__hint">
              {isZh ? '随手问一句，关闭窗口即销毁，不留痕迹。' : 'Ask anything. Closing the window discards everything.'}
            </div>
          </div>
        ) : (
          chat.map((turn, index) => {
            if (turn.role === 'user') {
              return (
                <div key={index} className="screenshot-preview__user-msg">
                  {turn.text}
                </div>
              )
            }
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
                ) : turn.pending ? (
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
          })
        )}
      </div>

      <div className="chat-input">
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          placeholder={isZh ? '发消息…' : 'Message…'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              if (loading) stop()
              else submit()
            }
          }}
        />
        {loading ? (
          <button className="chat-input__btn chat-input__btn--stop" onClick={stop} title={t('stop')}>
            <Icon name="square" size={18} />
          </button>
        ) : (
          <button
            className="chat-input__btn"
            onClick={submit}
            disabled={!input.trim()}
            title={isZh ? '发送' : 'Send'}>
            <Icon name="arrow-up" size={18} />
          </button>
        )}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ChatApp />
  </React.StrictMode>
)
