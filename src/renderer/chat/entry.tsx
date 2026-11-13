import '../styles.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import type { AiChunkPayload, AiMessageInput, PreWindowEntry, PreWindowMark } from '@shared/types'
import { ReasoningLine, ReasoningSummary } from '../ReasoningLine'
import { Icon } from '../icons'
import { useSettings } from '../useSettings'
import { useThemeMode } from '../useThemeMode'
import { useAppearance } from '../useAppearance'
import { getTranslator } from '../i18n'
import { AttachmentStrip, filesToDataUrls, historyTurnMessages, imageFilesFromPaste, userMessageWithImages } from '../inputAttachments'
import { matchesSendKey } from '../sendKey'
import { PreSelectionPanel, markNumberLabel, numberAllMarks, type NumberedMark } from './PreSelectionPanel'
import { MarkPicker } from './MarkPicker'

// Lazy so the markdown toolchain (~374 kB) stays out of the first-screen chunk;
// it loads when the first AI answer renders.
const MarkdownView = React.lazy(() => import('../Markdown').then((m) => ({ default: m.MarkdownView })))

interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
  /** What the model actually receives for this turn (context block included); falls back to text. */
  fullText?: string
  pending?: boolean
  error?: string
  searchQuery?: string
  /** Accumulated chain-of-thought streamed before the answer. */
  reasoning?: string
  /** Wall-clock ms when the first reasoning fragment arrived. */
  reasoningStart?: number
  /** Seconds spent thinking, frozen when the first content delta lands. */
  reasoningTime?: number
  /** Data URLs the user attached to this turn. Kept on the turn so follow-up
   * requests re-send them (same lifetime as the conversation: memory only,
   * gone when the window closes). */
  images?: string[]
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
  const [attachments, setAttachments] = React.useState<string[]>([])
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

  // Pre-selection state. The pool lives in main memory; this window is
  // destroyed on close, so everything here re-pulls on mount — and again on
  // window focus, because selections made while the chat window is open must
  // refresh the paper slip ("AI 默认看最后一次划词" holds for a window that
  // stays open across selections).
  const [entries, setEntries] = React.useState<PreWindowEntry[]>([])
  const [marksByEntry, setMarksByEntry] = React.useState<Record<string, PreWindowMark[]>>({})
  const [lastSelection, setLastSelection] = React.useState<Awaited<ReturnType<typeof window.assistantLite.context.getLastSelection>>>(null)
  // Inverted selection state: every pooled entry ships by default (收集即意图);
  // only entries the user explicitly unticked are held back. Focus re-pulls
  // never touch this set, so an exclusion survives window refocus and newly
  // pooled entries join the default automatically.
  const [uncheckedIds, setUncheckedIds] = React.useState<Set<string>>(new Set())
  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  const [paperDismissed, setPaperDismissed] = React.useState(false)
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [pickerActive, setPickerActive] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    const pull = async () => {
      const [pool, last] = await Promise.all([
        window.assistantLite.preWindow.list(),
        window.assistantLite.context.getLastSelection()
      ])
      if (cancelled) return
      setEntries(pool)
      setLastSelection(last)
    }
    void pull()
    window.addEventListener('focus', pull)
    // Pool changes push, not wait for focus: a save from the toolbar happens
    // while another app holds focus (focus alone missed it in practice).
    const offPoolChange = window.assistantLite.preWindow.onChange(pull)
    return () => {
      cancelled = true
      window.removeEventListener('focus', pull)
      offPoolChange()
    }
  }, [])

  const numberedMarks = numberAllMarks(entries, marksByEntry)
  // Ticking an entry is the only ticket into the context; @ cites INSIDE that
  // scope. Marks on unticked entries are hidden from the picker and their
  // @N tokens stay literal on send (no text to ground on).
  const citableMarks = numberedMarks.filter((mark) => !uncheckedIds.has(mark.entryId))
  // Active @ query: an unbroken "@query" tail of the input (ends at a space
  // or another @). The picker shows while it exists and the query filters the
  // candidates — the standard mention-typeahead model.
  const activeQuery = /[@＠]([^\s@＠]*)$/.exec(input)?.[1] ?? null
  const filteredMarks =
    activeQuery === null
      ? []
      : citableMarks.filter((mark) => (activeQuery === '' ? true : mark.snippet.toLowerCase().includes(activeQuery.toLowerCase())))
  // A new query restarts keyboard navigation from the top.
  React.useEffect(() => {
    setPickerActive(0)
  }, [activeQuery])
  const pickerEmptyHint =
    numberedMarks.length === 0
      ? isZh
        ? '还没有标记——先在预选条里划选文字'
        : 'No marks yet — select text inside a pre-selected entry first'
      : isZh
        ? '没有可引用的标记——先勾选标记所在的预选条，或换个词'
        : 'Nothing citable — tick the entry holding the mark, or retype'


  const addMark = (entryId: string, start: number, end: number): boolean => {
    // One text region carries one mark: an overlapping selection is ignored
    // (remove the old mark first if re-marking is intended). Returns whether
    // the mark was added so the caller keeps the selection visible on refuse.
    const existing = marksByEntry[entryId] ?? []
    if (existing.some((mark) => start < mark.end && end > mark.start)) return false
    setMarksByEntry((current) => ({
      ...current,
      [entryId]: [...(current[entryId] ?? []), { id: crypto.randomUUID(), start, end, createdAt: Date.now() }]
    }))
    return true
  }

  const removeMark = (entryId: string, markId: string) => {
    setMarksByEntry((current) => ({
      ...current,
      [entryId]: (current[entryId] ?? []).filter((mark) => mark.id !== markId)
    }))
  }

  const removeEntry = (id: string) => {
      void window.assistantLite.preWindow.remove(id)
      setEntries((current) => current.filter((entry) => entry.id !== id))
      setUncheckedIds((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    setMarksByEntry((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
    setExpandedId((current) => (current === id ? null : current))
  }

  const handlePickMark = (mark: NumberedMark) => {
    setInput((current) => {
      // Replace the whole active "@query" tail with the consumed token
      // (half-width always — the token is what expandPlaceholders parses).
      const m = /[@＠][^\s@＠]*$/.exec(current)
      const base = m ? current.slice(0, m.index) : current
      return `${base}@${mark.number} `
    })
    setPickerOpen(false)
    inputRef.current?.focus()
  }

  /** Context block for the outgoing message: checked entries (+ their marks), then the paper slip. Ticking a entry is the ONLY way content gets in — @ citations stay inside that scope. */
  const buildContextBlock = (): string => {
    const ordered = [...entries].sort((a, b) => a.createdAt - b.createdAt)
    const blocks: string[] = []
    for (const entry of ordered) {
      if (uncheckedIds.has(entry.id)) continue
      const entryMarks = numberedMarks.filter((mark) => mark.entryId === entry.id)
      const source = entry.programName ? ` (${entry.programName})` : ''
      const lines = [`--- ${isZh ? '预选' : 'Pre-selected'}${source} ---`, entry.text]
      for (const mark of entryMarks) {
        lines.push(`${isZh ? '标记' : 'Mark'}${markNumberLabel(mark.number)}: "${mark.snippet}"`)
      }
      blocks.push(lines.join('\n'))
    }
    const showPaper =
      !paperDismissed && !!lastSelection && !entries.some((entry) => entry.text === lastSelection.text)
    if (showPaper && lastSelection) {
      blocks.push(`--- ${isZh ? '上次划词' : 'Last selection'} ---\n${lastSelection.text}`)
    }
    if (blocks.length === 0) return ''
    return `[${isZh ? '引用上下文' : 'Referenced context'}]\n${blocks.join('\n\n')}\n\n`
  }

  /** Replace "@N" tokens with exact citations so the model sees which mark is meant. Tokens pointing at unticked entries stay literal — their text is not in the context, so a locator alone would mislead. */
  const expandPlaceholders = (text: string): string =>
    text.replace(/@(\d+)/g, (match, digits: string) => {
      const mark = numberedMarks.find((item) => item.number === Number(digits))
      if (!mark || uncheckedIds.has(mark.entryId)) return match
      return `${isZh ? '（见标记' : '(see mark '}${markNumberLabel(mark.number)}: "${mark.snippet}"）`
    })

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
            console.warn('[chat] unhandled ai chunk type:', unhandledChunkType)
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
    if ((!text.trim() && attachments.length === 0) || activeRequestId.current) return
    const contextBlock = buildContextBlock()
    const expanded = expandPlaceholders(text)
    const fullText = `${contextBlock}${expanded}`
    const history = chatRef.current
    const messages: AiMessageInput[] = [
      // Follow-up turns re-send each user turn's fullText so an earlier
      // context block survives into later turns of the same conversation.
      // Attached images ride along the same way (see historyTurnMessages).
      ...historyTurnMessages(history),
      userMessageWithImages(fullText, attachments)
    ]
    const requestId = crypto.randomUUID()
    activeRequestId.current = requestId
    // Send first so the assistant placeholder always corresponds to an
    // in-flight request, even if React re-runs the state updater.
    void window.assistantLite.ai.stream({ requestId, messages })
    // The paper slip is one-shot: its content just entered the conversation,
    // so it goes away (the pool chips stay for follow-ups).
    if (contextBlock) setPaperDismissed(true)
    setPickerOpen(false)
    // Snap to bottom when the user sends a new message.
    stickToBottomRef.current = true
    setChat([
      ...history,
      // Copy the attachment list: the turn must keep the images that were
      // current at send time, independent of later edits to the state.
      { role: 'user', text, fullText, ...(attachments.length ? { images: [...attachments] } : {}) },
      { role: 'assistant', text: '', pending: true }
    ])
  }

  const submit = () => {
    const text = input.trim()
    // Allow an image-only send: empty text + pending attachments is valid.
    if (!text && attachments.length === 0) return
    setInput('')
    setAttachments([])
    sendMessage(text)
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
      <div className={isMac ? 'titlebar' : 'titlebar titlebar--flush'}>
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
              <Icon name="minus" />
            </button>
            <button className="icon titlebar-close" title={t('close')} onClick={() => window.assistantLite.windowControls.close()}>
              <Icon name="x" />
            </button>
          </>
        )}
      </div>

      {/* Pre-selection panel lives at the TOP of the window as its own
          section (by design): separated from the conversation instead of
          squeezing the message area / input row. */}
      <PreSelectionPanel
        entries={entries}
        lastSelection={lastSelection}
        paperDismissed={paperDismissed}
        marksByEntry={marksByEntry}
        uncheckedIds={uncheckedIds}
        expandedId={expandedId}
        isZh={isZh}
        onToggleChecked={(id) =>
          setUncheckedIds((current) => {
            const next = new Set(current)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
          })
        }
        onRemoveEntry={removeEntry}
        onToggleExpanded={setExpandedId}
        onAddMark={addMark}
        onRemoveMark={removeMark}
        onDismissPaper={() => setPaperDismissed(true)}
      />

      <div className="content chat-content" ref={contentRef}>
        {chat.length === 0 ? (
          <div className="chat-empty">
            <Icon name="sparkles" size={28} />
            <div className="chat-empty__title">{isZh ? '开始一段对话' : 'Start a chat'}</div>
            <div className="chat-empty__hint">
              {settings.statsEnabled
                ? isZh
                  ? '本地记录开启中，划词动作的原文与回答会存本机。'
                  : 'Local recording is on — action texts and replies are stored on this device.'
                : isZh
                  ? '随手问一句，关闭窗口即销毁，不留痕迹。'
                  : 'Ask anything. Closing the window discards everything.'}
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
                    <MarkdownView>{turn.text}</MarkdownView>
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
          })
        )}
      </div>

      <AttachmentStrip images={attachments} onRemove={removeAttachment} isZh={isZh} />

      <div className="chat-input">
        {pickerOpen && (
          <MarkPicker
            marks={filteredMarks}
            activeIndex={pickerActive}
            emptyHint={pickerEmptyHint}
            onHover={setPickerActive}
            onPick={handlePickMark}
            onClose={() => setPickerOpen(false)}
          />
        )}
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          placeholder={isZh ? '发消息…（@ 引用标记）' : 'Message… (@ to cite marks)'}
          onChange={(e) => {
            const next = e.target.value
            setInput(next)
            // Picker keys off the VALUE, not key events: IMEs route '@'
            // through composition (keydown reports 'Process'). An unbroken
            // "@query" tail opens it, typing on / a space closes it.
            setPickerOpen(/[@＠]([^\s@＠]*)$/.test(next))
          }}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            // IME composition: hand every key to the input method. The picker
            // below must not consume arrows/Enter mid-composition (they are
            // candidate navigation there); matchesSendKey separately refuses
            // to send, so an early return changes nothing else.
            if (e.nativeEvent.isComposing) return
            if (pickerOpen && e.key === 'Escape') {
              // Esc closes the picker first; stop it from reaching the
              // window-level handler that would close the whole window.
              e.stopPropagation()
              setPickerOpen(false)
              return
            }
            if (pickerOpen && filteredMarks.length > 0) {
              // Standard mention keyboard model: arrows move, Enter/Tab
              // picks. Enter falls through to "send" only when the query
              // has no candidates.
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                const delta = e.key === 'ArrowDown' ? 1 : -1
                setPickerActive((i) => (i + delta + filteredMarks.length) % filteredMarks.length)
                return
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                const mark = filteredMarks[pickerActive]
                if (mark) {
                  e.preventDefault()
                  handlePickMark(mark)
                  return
                }
              }
            }
            if (matchesSendKey(e, settings.sendKey)) {
              e.preventDefault()
              if (loading) stop()
              else submit()
            }
          }}
        />
        <button
          className="chat-input__btn chat-input__btn--attach"
          onClick={() => void attachFromClipboard()}
          title={isZh ? '插入剪贴板图片' : 'Attach clipboard image'}>
          <Icon name="image" size={18} />
        </button>
        {loading ? (
          <button className="chat-input__btn chat-input__btn--stop" onClick={stop} title={t('stop')}>
            <Icon name="square" size={18} />
          </button>
        ) : (
          <button
            className="chat-input__btn"
            onClick={submit}
            disabled={!input.trim() && attachments.length === 0}
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
