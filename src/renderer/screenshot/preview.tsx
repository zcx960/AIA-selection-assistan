import '../styles.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import type { AiChunkPayload, AiMessageInput } from '@shared/types'
import { ReasoningLine, ReasoningSummary } from '../ReasoningLine'
import { Icon } from '../icons'
import { useSettings } from '../useSettings'
import { useThemeMode } from '../useThemeMode'
import { getTranslator } from '../i18n'
import { AttachmentStrip, filesToDataUrls, historyTurnMessages, imageFilesFromPaste, userMessageWithImages } from '../inputAttachments'
import { matchesSendKey } from '../sendKey'

// Lazy so the markdown toolchain (~374 kB) stays out of the first-screen chunk;
// it loads when the first AI answer renders.
const LazyMarkdown = React.lazy(() => import('../MarkdownPlain'))

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
  /** Data URLs the user attached to this follow-up turn (the screenshot image
   * itself is not stored here — it rides on the first user turn separately).
   * Memory only, like the rest of the conversation. */
  images?: string[]
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
  const [attachments, setAttachments] = React.useState<string[]>([])
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
      setAttachments([])
    })
  }, [])

  React.useEffect(() => {
    return window.assistantLite.ai.onChunk((chunk: AiChunkPayload) => {
      if (chunk.requestId !== activeRequestId.current) return
      setChat((current) => {
        if (!current.length) return current
        const next = [...current]
        const last = { ...next[next.length - 1] }
        // Exhaustive over AiChunkPayload.type: a newly added chunk kind must
        // be handled here — the never assignment below turns "silently
        // ignored by every window" into a compile error.
        switch (chunk.type) {
          case 'delta': {
            last.searchQuery = undefined
            last.text += chunk.text ?? ''
            if (last.reasoningStart !== undefined && last.reasoningTime === undefined) {
              last.reasoningTime = (Date.now() - last.reasoningStart) / 1000
            }
            last.pending = true
            break
          }
          case 'reasoning': {
            last.searchQuery = undefined
            last.reasoning = (last.reasoning ?? '') + (chunk.reasoning ?? '')
            if (last.reasoningStart === undefined) last.reasoningStart = Date.now()
            last.pending = true
            break
          }
          case 'status':
            last.searchQuery = chunk.statusKind === 'web-search' ? chunk.text : undefined
            break
          case 'done':
            last.searchQuery = undefined
            last.pending = false
            break
          case 'error':
            last.searchQuery = undefined
            last.pending = false
            last.error = chunk.error ?? t('unknownProviderError')
            break
          default: {
            const unhandledChunkType: never = chunk.type
            console.warn('[screenshot] unhandled ai chunk type:', unhandledChunkType)
            break
          }
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

  const sendTurn = React.useCallback(
    (userText: string, pendingAttachments: string[] = []) => {
      if (!payload) return
      const history = chatRef.current
      // The screenshot itself rides on the very first turn — stored there like
      // any attachment so every later request re-sends it (follow-ups can see
      // the image they are asking about). Pasted/attached images ride on the
      // outgoing turn.
      const isFirstTurn = history.length === 0
      const outgoingImages = [...(isFirstTurn ? [payload.imageDataUrl] : []), ...pendingAttachments]
      // One turn object feeds both the request and the stored conversation,
      // so the two can never drift apart.
      const outgoing: ChatTurn = userMessageWithImages(userText, outgoingImages)
      const messages: AiMessageInput[] = [...historyTurnMessages(history), outgoing]
      const requestId = crypto.randomUUID()
      activeRequestId.current = requestId
      void window.assistantLite.ai.stream({ requestId, messages })
      stickToBottomRef.current = true
      setChat([...history, outgoing, { role: 'assistant', text: '', pending: true }])
    },
    [payload]
  )

  const explain = React.useCallback(() => {
    const prompt = isZh
      ? '直接用简洁易懂的话解释这张图片。抓住重点，不要废话，不要逐一描述画面元素，也不要堆砌冗长段落；只有在真正有帮助时再补一句简短总结。'
      : 'Explain this image directly in plain, easy-to-understand language. Be concise, stay focused on the key point, avoid listing every visual element, and skip filler. Add a brief summary only when it is genuinely helpful.'
    sendTurn(prompt)
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
    if ((!text && attachments.length === 0) || activeRequestId.current) return
    setAskText('')
    setAskOpen(false)
    sendTurn(text, attachments)
    setAttachments([])
  }

  const attachFromClipboard = async () => {
    const dataUrl = await window.assistantLite.app.readClipboardImage()
    if (dataUrl) setAttachments((current) => [...current, dataUrl])
  }

  const removeAttachment = (index: number) => {
    setAttachments((current) => current.filter((_, position) => position !== index))
  }

  const handlePaste = (event: React.ClipboardEvent) => {
    const imageFiles = imageFilesFromPaste(event)
    // Text-only paste: keep the default insertion behavior untouched.
    if (imageFiles.length === 0) return
    event.preventDefault()
    void filesToDataUrls(imageFiles).then((images) => {
      setAttachments((current) => [...current, ...images])
    })
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
      <div className={isMac ? 'titlebar' : 'titlebar titlebar--flush'}>
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
              <Icon name="minus" />
            </button>
            <button className="icon titlebar-close" title={t('close')} onClick={() => window.assistantLite.windowControls.close()}>
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
                {turn.pending && turn.searchQuery && (
                  <div className="search-status">
                    {isZh ? `🔍 联网搜索：${turn.searchQuery}` : `🔍 Web search: ${turn.searchQuery}`}
                  </div>
                )}
                {turn.text && turn.reasoningTime !== undefined && (
                  <ReasoningSummary seconds={turn.reasoningTime} label={isZh ? '思考了' : 'Thought for'} />
                )}
                {turn.text ? (
                  <React.Suspense fallback={null}>
                    <LazyMarkdown>{turn.text}</LazyMarkdown>
                  </React.Suspense>
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
        <>
          <AttachmentStrip images={attachments} onRemove={removeAttachment} isZh={isZh} />
          <div className="screenshot-preview__ask">
            <input
              ref={askInputRef}
              type="text"
              value={askText}
              placeholder={isZh ? '继续追问…' : 'Ask a follow-up…'}
              onChange={(e) => setAskText(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (matchesSendKey(e, settings.sendKey)) {
                  e.preventDefault()
                  submitAsk()
                } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  // 未命中的 Enter（改配其他发送键后）在单行框无意义，吞掉防默认行为。
                  // 组合输入中的 Enter 是选字键，不能吞。
                  e.preventDefault()
                } else if (e.key === 'Escape') {
                  setAskOpen(false)
                  setAskText('')
                }
              }}
            />
            <button
              className="ask-attach"
              onClick={() => void attachFromClipboard()}
              title={isZh ? '插入剪贴板图片' : 'Attach clipboard image'}>
              <Icon name="image" size={16} />
            </button>
            <button
              className="ask-send"
              onClick={submitAsk}
              disabled={(!askText.trim() && attachments.length === 0) || loading}
              title={isZh ? '发送' : 'Send'}>
              <Icon name="arrow-up" size={18} />
            </button>
          </div>
        </>
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
