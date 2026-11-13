import '../styles.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Icon } from '../icons'
import { useSettings } from '../useSettings'
import { useThemeMode } from '../useThemeMode'

interface InitPayload {
  imageDataUrl: string
  displayId: number
  width: number
  height: number
  imageWidth: number
  imageHeight: number
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

interface Point {
  x: number
  y: number
}

type OverlayAction = 'explain' | 'save' | 'copy' | 'pin' | 'record'
type Tool = 'select' | 'pen' | 'arrow'
type HandleDir = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'

type PenAnnotation = {
  id: string
  type: 'pen'
  color: string
  width: number
  points: Point[]
}

type ArrowAnnotation = {
  id: string
  type: 'arrow'
  color: string
  width: number
  from: Point
  to: Point
}

type Annotation = PenAnnotation | ArrowAnnotation

const ANNOTATION_COLOR = '#ef4444'
const ANNOTATION_WIDTH_MIN = 1
const ANNOTATION_WIDTH_MAX = 12
const ANNOTATION_WIDTH_DEFAULT = 3
// Arrow head size scales with stroke width so bigger strokes get bigger heads.
const arrowHeadForWidth = (w: number): number => Math.max(10, w * 4)

function rectFrom(start: Point, current: Point): Rect {
  return {
    x: Math.min(start.x, current.x),
    y: Math.min(start.y, current.y),
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y)
  }
}

function clampRect(rect: Rect, viewportW: number, viewportH: number): Rect {
  const x = Math.max(0, Math.min(viewportW - 4, rect.x))
  const y = Math.max(0, Math.min(viewportH - 4, rect.y))
  const width = Math.max(4, Math.min(viewportW - x, rect.width))
  const height = Math.max(4, Math.min(viewportH - y, rect.height))
  return { x, y, width, height }
}

function applyHandleResize(base: Rect, dir: HandleDir, dx: number, dy: number): Rect {
  let { x, y, width, height } = base
  if (dir.includes('e')) width = base.width + dx
  if (dir.includes('s')) height = base.height + dy
  if (dir.includes('w')) {
    x = base.x + dx
    width = base.width - dx
  }
  if (dir.includes('n')) {
    y = base.y + dy
    height = base.height - dy
  }
  // Normalize if user dragged past opposite edge
  if (width < 0) {
    x += width
    width = -width
  }
  if (height < 0) {
    y += height
    height = -height
  }
  return { x, y, width, height }
}

async function rasterize(
  init: InitPayload,
  rect: Rect,
  annotations: Annotation[]
): Promise<string | null> {
  const img = new Image()
  img.src = init.imageDataUrl
  try {
    await img.decode()
  } catch {
    return null
  }
  const scaleX = init.imageWidth / window.innerWidth
  const scaleY = init.imageHeight / window.innerHeight
  const srcX = Math.max(0, rect.x * scaleX)
  const srcY = Math.max(0, rect.y * scaleY)
  const srcW = Math.max(1, rect.width * scaleX)
  const srcH = Math.max(1, rect.height * scaleY)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(srcW))
  canvas.height = Math.max(1, Math.round(srcH))
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height)

  // Average DPI scale for stroke width
  const strokeScale = (scaleX + scaleY) / 2

  for (const a of annotations) {
    ctx.strokeStyle = a.color
    ctx.fillStyle = a.color
    ctx.lineWidth = Math.max(1, a.width * strokeScale)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    if (a.type === 'pen') {
      if (a.points.length < 2) continue
      ctx.beginPath()
      a.points.forEach((p, i) => {
        const cx = (p.x - rect.x) * scaleX
        const cy = (p.y - rect.y) * scaleY
        if (i === 0) ctx.moveTo(cx, cy)
        else ctx.lineTo(cx, cy)
      })
      ctx.stroke()
    } else if (a.type === 'arrow') {
      const fromX = (a.from.x - rect.x) * scaleX
      const fromY = (a.from.y - rect.y) * scaleY
      const toX = (a.to.x - rect.x) * scaleX
      const toY = (a.to.y - rect.y) * scaleY
      const headSize = arrowHeadForWidth(a.width) * strokeScale
      drawArrowOnCanvas(ctx, { x: fromX, y: fromY }, { x: toX, y: toY }, headSize)
    }
  }

  return canvas.toDataURL('image/png')
}

function drawArrowOnCanvas(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  size: number
): void {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  if (len < 1) return
  const ux = dx / len
  const uy = dy / len
  const lineEndX = to.x - ux * size * 0.4
  const lineEndY = to.y - uy * size * 0.4
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(lineEndX, lineEndY)
  ctx.stroke()

  const angle = Math.atan2(dy, dx)
  const a1 = angle - Math.PI / 6
  const a2 = angle + Math.PI / 6
  ctx.beginPath()
  ctx.moveTo(to.x, to.y)
  ctx.lineTo(to.x - Math.cos(a1) * size, to.y - Math.sin(a1) * size)
  ctx.lineTo(to.x - Math.cos(a2) * size, to.y - Math.sin(a2) * size)
  ctx.closePath()
  ctx.fill()
}

type Drag =
  | { kind: 'create'; start: Point }
  | { kind: 'move'; start: Point; baseRect: Rect }
  | { kind: 'resize'; start: Point; baseRect: Rect; dir: HandleDir }
  | { kind: 'pen'; id: string }
  | { kind: 'arrow'; id: string }

function OverlayApp(): React.JSX.Element | null {
  const { settings } = useSettings()
  useThemeMode(settings.theme)
  const isZh = settings.language === 'zh-CN'
  const labels = {
    cancel: isZh ? '取消' : 'Cancel',
    pin: isZh ? '钉住' : 'Pin',
    save: isZh ? '保存' : 'Save',
    copy: isZh ? '复制' : 'Copy',
    explain: isZh ? 'AI 识图' : 'AI Explain',
    record: isZh ? '录屏' : 'Record',
    recordHint: isZh ? '录制当前区域（不包含截图标注）' : 'Record this region (without screenshot annotations)',
    recordTooSmall: isZh ? '录屏区域至少需要 16 × 16' : 'Recording needs a region of at least 16 × 16',
    pen: isZh ? '画笔' : 'Pen',
    arrow: isZh ? '箭头' : 'Arrow',
    undo: isZh ? '撤销' : 'Undo',
    hint: isZh ? '拖动鼠标框选区域 · Esc 取消' : 'Drag to select region · Esc to cancel'
  }

  const [init, setInit] = React.useState<InitPayload | null>(null)
  const [committed, setCommitted] = React.useState<Rect | null>(null)
  const [drafting, setDrafting] = React.useState<Rect | null>(null)
  const [drag, setDrag] = React.useState<Drag | null>(null)
  const [tool, setTool] = React.useState<Tool>('select')
  const [annotations, setAnnotations] = React.useState<Annotation[]>([])
  const [annotationWidth, setAnnotationWidth] = React.useState(ANNOTATION_WIDTH_DEFAULT)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const submitting = React.useRef(false)
  const toolbarRef = React.useRef<HTMLDivElement>(null)
  const [toolbarHeight, setToolbarHeight] = React.useState(52)
  const [toolbarWidth, setToolbarWidth] = React.useState(480)
  const [viewport, setViewport] = React.useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 0,
    height: typeof window !== 'undefined' ? window.innerHeight : 0
  })

  React.useEffect(() => {
    const off = window.assistantLite.screenshot.onOverlayInit((payload) => setInit(payload))
    void window.assistantLite.screenshot.overlayReady()
    return off
  }, [])

  React.useLayoutEffect(() => {
    if (!toolbarRef.current) return
    const observer = new ResizeObserver(([entry]) => {
      const bounds = entry.target.getBoundingClientRect()
      setToolbarHeight(bounds.height)
      setToolbarWidth(bounds.width)
    })
    observer.observe(toolbarRef.current)
    return () => observer.disconnect()
  }, [!!committed])

  React.useEffect(() => {
    const onResize = (): void =>
      setViewport({ width: window.innerWidth, height: window.innerHeight })
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const cancel = React.useCallback(() => {
    void window.assistantLite.screenshot.overlayCancel()
  }, [])

  const confirm = React.useCallback(
    async (rect: Rect, action: OverlayAction) => {
      if (!init || submitting.current) return
      if (rect.width < 4 || rect.height < 4) return
      if (action === 'record' && (rect.width < 16 || rect.height < 16)) return
      submitting.current = true
      setBusy(true)
      setError('')
      try {
        let imageDataUrl: string | undefined
        if (action !== 'record' && annotations.length > 0) {
          const result = await rasterize(init, rect, annotations)
          if (result) imageDataUrl = result
        }

        await window.assistantLite.screenshot.overlayConfirm({
          displayId: init.displayId,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          action,
          imageDataUrl
        })
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error))
      } finally {
        submitting.current = false
        setBusy(false)
      }
    },
    [init, annotations]
  )

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (submitting.current) return
      if (event.key === 'Escape') cancel()
      else if (event.key === 'Enter' && committed && !(event.target as HTMLElement).closest('button, input')) {
        event.preventDefault()
        void confirm(committed, 'explain')
      }
      else if ((event.metaKey || event.ctrlKey) && event.key === 'z') {
        setAnnotations((current) => current.slice(0, -1))
      } else if (event.key === '1') setTool('select')
      else if (event.key === '2') setTool('pen')
      else if (event.key === '3') setTool('arrow')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancel, confirm, committed])

  const rect = drafting ?? committed

  // ----- Mouse handlers (background) ------------------------------------
  const beginDragOnBackground = (event: React.MouseEvent): void => {
    if (event.button !== 0 || submitting.current) return
    const pos = { x: event.clientX, y: event.clientY }
    // If we have a committed rect and the user clicked inside it,
    // route the action depending on the current tool.
    if (committed && pointInRect(pos, committed)) {
      if (tool === 'pen') {
        const id = crypto.randomUUID()
        setAnnotations((current) => [
          ...current,
          { id, type: 'pen', color: ANNOTATION_COLOR, width: annotationWidth, points: [pos] }
        ])
        setDrag({ kind: 'pen', id })
        return
      }
      if (tool === 'arrow') {
        const id = crypto.randomUUID()
        setAnnotations((current) => [
          ...current,
          { id, type: 'arrow', color: ANNOTATION_COLOR, width: annotationWidth, from: pos, to: pos }
        ])
        setDrag({ kind: 'arrow', id })
        return
      }
      // select tool: move the rect
      setDrag({ kind: 'move', start: pos, baseRect: committed })
      return
    }
    // Otherwise start a fresh selection.
    setCommitted(null)
    setAnnotations([])
    setDrafting({ x: pos.x, y: pos.y, width: 0, height: 0 })
    setDrag({ kind: 'create', start: pos })
  }

  const onMouseMove = (event: React.MouseEvent): void => {
    if (!drag) return
    const pos = { x: event.clientX, y: event.clientY }
    if (drag.kind === 'create') {
      setDrafting(rectFrom(drag.start, pos))
      return
    }
    if (drag.kind === 'move') {
      const dx = pos.x - drag.start.x
      const dy = pos.y - drag.start.y
      const next = clampRect(
        { x: drag.baseRect.x + dx, y: drag.baseRect.y + dy, width: drag.baseRect.width, height: drag.baseRect.height },
        viewport.width,
        viewport.height
      )
      setCommitted(next)
      return
    }
    if (drag.kind === 'resize') {
      const dx = pos.x - drag.start.x
      const dy = pos.y - drag.start.y
      const next = clampRect(
        applyHandleResize(drag.baseRect, drag.dir, dx, dy),
        viewport.width,
        viewport.height
      )
      setCommitted(next)
      return
    }
    if (drag.kind === 'pen') {
      setAnnotations((current) =>
        current.map((a) =>
          a.id === drag.id && a.type === 'pen' ? { ...a, points: [...a.points, pos] } : a
        )
      )
      return
    }
    if (drag.kind === 'arrow') {
      setAnnotations((current) =>
        current.map((a) => (a.id === drag.id && a.type === 'arrow' ? { ...a, to: pos } : a))
      )
      return
    }
  }

  const onMouseUp = (event: React.MouseEvent): void => {
    if (!drag) return
    if (drag.kind === 'create') {
      // Compute the final rect from the original mousedown point and the
      // current pointer position rather than reading `drafting` from state,
      // which may be stale across React's render boundary.
      const finalRect = rectFrom(drag.start, { x: event.clientX, y: event.clientY })
      setDrag(null)
      setDrafting(null)
      if (finalRect.width < 4 || finalRect.height < 4) {
        setCommitted(null)
        return
      }
      setCommitted(finalRect)
      return
    }
    if (drag.kind === 'arrow') {
      // Drop zero-length arrows
      setAnnotations((current) =>
        current.filter(
          (a) =>
            !(
              a.id === drag.id &&
              a.type === 'arrow' &&
              Math.hypot(a.to.x - a.from.x, a.to.y - a.from.y) < 6
            )
        )
      )
    }
    setDrag(null)
  }

  // ----- Resize handle ---------------------------------------------------
  const onHandleMouseDown = (event: React.MouseEvent, dir: HandleDir): void => {
    if (!committed) return
    event.stopPropagation()
    event.preventDefault()
    setTool('select')
    setDrag({
      kind: 'resize',
      start: { x: event.clientX, y: event.clientY },
      baseRect: committed,
      dir
    })
  }

  if (!init) return null

  // ----- Geometry --------------------------------------------------------
  const maskPieces = ((): { left: number; top: number; width: number; height: number }[] | null => {
    if (!rect) return null
    const W = viewport.width
    const H = viewport.height
    return [
      { left: 0, top: 0, width: W, height: rect.y },
      { left: 0, top: rect.y + rect.height, width: W, height: Math.max(0, H - rect.y - rect.height) },
      { left: 0, top: rect.y, width: rect.x, height: rect.height },
      {
        left: rect.x + rect.width,
        top: rect.y,
        width: Math.max(0, W - rect.x - rect.width),
        height: rect.height
      }
    ]
  })()

  const actionToolbarStyle = ((): { top: number; right: number } | null => {
    if (!rect || !committed) return null
    const TOOLBAR_H = toolbarHeight
    const PAD = 8
    const belowSpace = viewport.height - (rect.y + rect.height)
    const showBelow = belowSpace >= TOOLBAR_H + PAD
    const top = Math.max(PAD, Math.min(viewport.height - TOOLBAR_H - PAD,
      showBelow ? rect.y + rect.height + PAD : rect.y - TOOLBAR_H - PAD))
    const right = Math.max(PAD, Math.min(viewport.width - toolbarWidth - PAD, viewport.width - (rect.x + rect.width)))
    return { top, right }
  })()

  const handleSize = 10
  const halfHandle = handleSize / 2
  const handles: Array<{ dir: HandleDir; left: number; top: number; cursor: string }> = committed
    ? [
        { dir: 'nw', left: committed.x - halfHandle, top: committed.y - halfHandle, cursor: 'nwse-resize' },
        { dir: 'n', left: committed.x + committed.width / 2 - halfHandle, top: committed.y - halfHandle, cursor: 'ns-resize' },
        { dir: 'ne', left: committed.x + committed.width - halfHandle, top: committed.y - halfHandle, cursor: 'nesw-resize' },
        { dir: 'e', left: committed.x + committed.width - halfHandle, top: committed.y + committed.height / 2 - halfHandle, cursor: 'ew-resize' },
        { dir: 'se', left: committed.x + committed.width - halfHandle, top: committed.y + committed.height - halfHandle, cursor: 'nwse-resize' },
        { dir: 's', left: committed.x + committed.width / 2 - halfHandle, top: committed.y + committed.height - halfHandle, cursor: 'ns-resize' },
        { dir: 'sw', left: committed.x - halfHandle, top: committed.y + committed.height - halfHandle, cursor: 'nesw-resize' },
        { dir: 'w', left: committed.x - halfHandle, top: committed.y + committed.height / 2 - halfHandle, cursor: 'ew-resize' }
      ]
    : []

  // Cursor for the rect interior
  const interiorCursor = ((): string => {
    if (tool === 'pen' || tool === 'arrow') return 'crosshair'
    return 'move'
  })()

  return (
    <div
      className={`screenshot-overlay screenshot-overlay--tool-${tool}`}
      onMouseDown={beginDragOnBackground}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onContextMenu={(e) => {
        e.preventDefault()
        cancel()
      }}>
      <img className="screenshot-overlay__bg" src={init.imageDataUrl} alt="" draggable={false} />
      {!rect && <div className="screenshot-overlay__mask" />}
      {maskPieces?.map((piece, i) => (
        <div
          key={i}
          className="screenshot-overlay__mask-piece"
          style={{
            left: piece.left,
            top: piece.top,
            width: piece.width,
            height: piece.height
          }}
        />
      ))}

      {/* Annotation layer — clipped to the committed rect */}
      {committed && annotations.length > 0 && (
        <svg
          className="screenshot-overlay__annotations"
          width={viewport.width}
          height={viewport.height}
          style={{
            clipPath: `inset(${committed.y}px ${viewport.width - committed.x - committed.width}px ${
              viewport.height - committed.y - committed.height
            }px ${committed.x}px)`
          }}>
          {annotations.map((a) => {
            if (a.type === 'pen') {
              if (a.points.length < 2) return null
              const d = a.points
                .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
                .join(' ')
              return (
                <path
                  key={a.id}
                  d={d}
                  stroke={a.color}
                  strokeWidth={a.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              )
            }
            // arrow
            const headSize = arrowHeadForWidth(a.width)
            const dx = a.to.x - a.from.x
            const dy = a.to.y - a.from.y
            const len = Math.hypot(dx, dy)
            if (len < 1) return null
            const ux = dx / len
            const uy = dy / len
            const lineEndX = a.to.x - ux * headSize * 0.4
            const lineEndY = a.to.y - uy * headSize * 0.4
            const angle = Math.atan2(dy, dx)
            const a1 = angle - Math.PI / 6
            const a2 = angle + Math.PI / 6
            const head1x = a.to.x - Math.cos(a1) * headSize
            const head1y = a.to.y - Math.sin(a1) * headSize
            const head2x = a.to.x - Math.cos(a2) * headSize
            const head2y = a.to.y - Math.sin(a2) * headSize
            return (
              <g key={a.id}>
                <line
                  x1={a.from.x}
                  y1={a.from.y}
                  x2={lineEndX}
                  y2={lineEndY}
                  stroke={a.color}
                  strokeWidth={a.width}
                  strokeLinecap="round"
                />
                <polygon
                  points={`${a.to.x},${a.to.y} ${head1x},${head1y} ${head2x},${head2y}`}
                  fill={a.color}
                  stroke={a.color}
                  strokeWidth={1}
                  strokeLinejoin="round"
                />
              </g>
            )
          })}
        </svg>
      )}

      {rect && (
        <div
          className="screenshot-overlay__rect"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            cursor: committed ? interiorCursor : 'crosshair',
            // Accept events so the cursor reflects the active tool; we then
            // forward the events to the same handlers used on the background.
            pointerEvents: committed ? 'auto' : 'none'
          }}
          onMouseDown={
            committed
              ? (e) => {
                  e.stopPropagation()
                  beginDragOnBackground(e)
                }
              : undefined
          }>
          <div className="screenshot-overlay__rect-size">
            {Math.round(rect.width)} × {Math.round(rect.height)}
          </div>
        </div>
      )}

      {committed &&
        handles.map((h) => (
          <div
            key={h.dir}
            className="screenshot-overlay__handle"
            style={{ left: h.left, top: h.top, width: handleSize, height: handleSize, cursor: h.cursor }}
            onMouseDown={(e) => onHandleMouseDown(e, h.dir)}
          />
        ))}

      {/* Single action toolbar (with inline annotation buttons) */}
      {committed && actionToolbarStyle && (
        <div
          className="toolbar-root screenshot-overlay__toolbar"
          ref={toolbarRef}
          aria-busy={busy}
          style={actionToolbarStyle}
          onMouseDown={(e) => {
            e.stopPropagation()
            e.preventDefault()
          }}>
          <button className="toolbar-button" onClick={cancel} title={labels.cancel}>
            <Icon name="x" />
          </button>
          <span className="screenshot-overlay__palette-sep" />
          <button
            className={`toolbar-button${tool === 'pen' ? ' toolbar-button--active' : ''}`}
            onClick={() => setTool((t) => (t === 'pen' ? 'select' : 'pen'))}
            title={labels.pen}>
            <Icon name="pencil" />
          </button>
          <button
            className={`toolbar-button${tool === 'arrow' ? ' toolbar-button--active' : ''}`}
            onClick={() => setTool((t) => (t === 'arrow' ? 'select' : 'arrow'))}
            title={labels.arrow}>
            <Icon name="arrow-up-right" />
          </button>
          <button
            className="toolbar-button"
            onClick={() => setAnnotations((cur) => cur.slice(0, -1))}
            disabled={annotations.length === 0}
            title={labels.undo}>
            <Icon name="undo-2" />
          </button>
          <span className="screenshot-overlay__palette-sep" />
          <button
            className="toolbar-button"
            onClick={() => void confirm(committed, 'pin')}
            title={labels.pin}>
            <Icon name="pin" />
          </button>
          <button
            className="toolbar-button"
            onClick={() => void confirm(committed, 'save')}
            title={labels.save}>
            <Icon name="download" />
          </button>
          <button
            className="toolbar-button"
            onClick={() => void confirm(committed, 'copy')}
            title={labels.copy}>
            <Icon name="copy" />
          </button>
          <button
            className="toolbar-button screenshot-overlay__record-button"
            onClick={() => void confirm(committed, 'record')}
            title={committed.width < 16 || committed.height < 16 ? labels.recordTooSmall : labels.recordHint}
            aria-label={labels.recordHint}
            disabled={busy || committed.width < 16 || committed.height < 16}>
            <Icon name="video" />
            <span>{labels.record}</span>
          </button>
          <button
            className="toolbar-button toolbar-button--primary"
            onClick={() => void confirm(committed, 'explain')}
            title={labels.explain}>
            <Icon name="sparkles" />
            <span>{labels.explain}</span>
          </button>
        </div>
      )}

      {/* Stroke-width slider — visible only when a draw tool is active */}
      {committed && actionToolbarStyle && (tool === 'pen' || tool === 'arrow') && (
        <div
          className="screenshot-overlay__size-slider"
          style={{
            top: actionToolbarStyle.top + toolbarHeight + 40 < viewport.height
              ? actionToolbarStyle.top + toolbarHeight + 8 : Math.max(8, actionToolbarStyle.top - 40),
            right: actionToolbarStyle.right
          }}
          // Only stop propagation so the overlay doesn't react to the click.
          // Do NOT preventDefault — that would block the native range-thumb drag.
          onMouseDown={(e) => e.stopPropagation()}
          onMouseMove={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}>
          <input
            type="range"
            min={ANNOTATION_WIDTH_MIN}
            max={ANNOTATION_WIDTH_MAX}
            step={1}
            value={annotationWidth}
            onChange={(e) => setAnnotationWidth(Number(e.target.value))}
          />
          <span className="screenshot-overlay__size-value">{annotationWidth}</span>
        </div>
      )}

      {!committed && <div className="screenshot-overlay__hint">{labels.hint}</div>}
      {error && <div className="screenshot-overlay__error" role="alert">{error}</div>}
    </div>
  )
}

function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OverlayApp />
  </React.StrictMode>
)
