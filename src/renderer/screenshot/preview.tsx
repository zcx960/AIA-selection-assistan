import '../styles.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AiChunkPayload, AiMessageInput } from '@shared/types'
import { ReasoningLine, ReasoningSummary } from '../ReasoningLine'
import { Icon } from '../icons'
import { useSettings } from '../useSettings'
import { useThemeMode } from '../useThemeMode'
import { getTranslator } from '../i18n'

interface PreviewInit {
  imageDataUrl: string
  width: number
  height: number
}

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

function PreviewApp() {
  const { settings } = useSettings()
  const t = getTranslator(settings.language)
  useThemeMode(settings.theme)
  const isZh = settings.language === 'zh-CN'

  const [payload, setPayload] = React.useState<PreviewInit | null>(null)
  const [chat, setChat] = React.useState<ChatTurn[]>([])
  const [showImage, setShowImage] = React.useState(false)
  const [askOpen, setAskOpen] = React.useState(false)
  const [askText, setAskText] = React.useState('')
  const [pinned, setPinned] = React.useState(settings.autoPin)
  const activeRequestId = React.useRef<string | null>(null)
  const askInputRef = React.useRef<HTMLInputElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const chatRef = React.useRef<ChatTurn[]>([])
  const stickToBottomRef = React.useRef(true)

  React.useEffect(() => {
    document.documentElement.classList.add('action-page-root')
    document.body.classList.add('action-page')
    return () => {
      document.documentElement.classList.remove('action-page-root')
      document.body.classList.remove('action-page')
    }
  }, [])

  React.useEffect(() => {
    return window.assistantLite.screenshot.onPreviewInit((data) => {
      setPayload(data)
      chatRef.current = []
      setChat([])
      setShowImage(false)
      setAskOpen(false)
      setAskText('')
    })
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

  // Only auto-follow new content while the user is near the bottom.
  React.useEffect(() => {
    if (!stickToBottomRef.current) return
    const el = contentRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat])

  const sendTurn = React.useCallback((userText: string, includeImage: boolean) => {
    if (!payload) return
    const history = chatRef.current
    const allUser: ChatTurn[] = [...history, { role: 'user', text: userText }]
    const messages: AiMessageInput[] = allUser.map((turn, index) => {
      const isFirstUser = index === 0 && turn.role === 'user'
      return {
        role: turn.role,
        text: turn.text,
        ...(isFirstUser && includeImage ? { images: [payload.imageDataUrl] } : {})
      }
    })
    const requestId = crypto.randomUUID()
    activeRequestId.current = requestId
    void window.assistantLite.ai.stream({ requestId, messages })
    stickToBottomRef.current = true
    setChat([
      ...history,
      { role: 'user', text: userText },
      { role: 'assistant', text: '', pending: true }
    ])
  }, [payload])

  const explain = React.useCallback(() => {
    const prompt = isZh
      ? '直接用简洁易懂的话解释这张图片。抓住重点，不要废话，不要逐一描述画面元素，也不要堆砌冗长段落；只有在真正有帮助时再补一句简短总结。'
      : 'Explain this image directly in plain, easy-to-understand language. Be concise, stay focused on the key point, avoid listing every visual element, and skip filler. Add a brief summary only when it is genuinely helpful.'
    sendTurn(prompt, true)
  }, [isZh, sendTurn])

  // Auto-trigger initial explain
  React.useEffect(() => {
    if (payload && chat.length === 0) explain()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload])

  const stop = () => {
    if (activeRequestId.current) {
      void window.assistantLite.ai.abort(activeRequestId.current)
      activeRequestId.current = null
      setChat((current) => {
        if (!current.length) return current
        const next = [...current]
        const last = { ...next[next.length - 1] }
        last.pending = false
        next[next.length - 1] = last
        return next
      })
    }
  }

  const regenerate = () => {
    if (activeRequestId.current) return
    chatRef.current = []
    setChat([])
    // delay so chat reset takes effect before sendTurn reads it
    setTimeout(() => explain(), 0)
  }

  const submitAsk = () => {
    const text = askText.trim()
    if (!text || activeRequestId.current) return
    setAskText('')
    setAskOpen(false)
    sendTurn(text, chat.length === 0)
  }

  const togglePin = () => {
    const next = !pinned
    setPinned(next)
    void window.assistantLite.windowControls.pin(next)
  }

  const copyLast = () => {
    const last = [...chat].reverse().find((turn) => turn.role === 'assistant' && turn.text)
    if (last) void navigator.clipboard.writeText(last.text)
  }

  const lastTurn = chat[chat.length - 1]
  const loading = !!lastTurn?.pending
  const hasResult = chat.some((turn) => turn.role === 'assistant' && turn.text)

  if (!payload) return null

  return (
    <div className="action-window action-window--flex">
      <div className="titlebar">
        <Icon name="sparkles" />
        <strong>{isZh ? 'AI 识图' : 'AI Vision'}</strong>
        <button
          className="icon"
          title={showImage ? (isZh ? '隐藏原图' : 'Hide image') : (isZh ? '显示原图' : 'Show image')}
          onClick={() => setShowImage((v) => !v)}>
          <Icon name="square" />
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

      {showImage && (
        <div className="screenshot-preview__thumb">
          <img src={payload.imageDataUrl} alt="" />
        </div>
      )}

      <div className="content" ref={contentRef}>
        {chat.length === 0 && loading && <div className="thinking-indicator">{t('preparing')}</div>}
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
                  <Markdown remarkPlugins={[remarkGfm]}>{turn.text}</Markdown>
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
          }
          // user follow-up turn (skip the auto first prompt)
          const isAutoFirst = index === 0
          if (isAutoFirst) return null
          return (
            <div key={index} className="screenshot-preview__user-msg">
              {turn.text}
            </div>
          )
        })}
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
                setAskOpen(false)
                setAskText('')
              }
            }}
          />
          <button
            className="ask-send"
            onClick={submitAsk}
            disabled={!askText.trim() || loading}
            title={isZh ? '发送' : 'Send'}>
            <Icon name="arrow-up" size={18} />
          </button>
        </div>
      )}

      <div className="footer">
        <button onClick={loading ? stop : () => window.assistantLite.windowControls.close()}>
          {loading ? t('stop') : t('close')}
        </button>
        <button onClick={regenerate} disabled={loading}>
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
        <button onClick={copyLast} disabled={loading || !hasResult}>
          {t('copy')}
        </button>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PreviewApp />
  </React.StrictMode>
)
