import '../styles.css'
import './recording.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import type { RecordingRect } from '@shared/recording'
import { useSettings } from '../useSettings'
import { Icon } from '../icons'

function Overlay() {
  const { settings } = useSettings()
  const zh = settings.language === 'zh-CN'
  const [image, setImage] = React.useState('')
  const [rect, setRect] = React.useState<RecordingRect | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const origin = React.useRef<{ x: number; y: number } | null>(null)
  const valid = rect && rect.width >= 16 && rect.height >= 16
  const confirm = async () => {
    if (!valid || busy) return
    setBusy(true)
    try { await window.assistantLite.recording.select({ ...rect, viewportWidth: innerWidth, viewportHeight: innerHeight }) }
    catch (error) { setError(String(error)); setBusy(false) }
  }
  React.useEffect(() => {
    document.body.classList.add('recording-overlay-page')
    void window.assistantLite.recording.overlayReady().then((payload) => setImage(payload.imageDataUrl)).catch((error) => setError(String(error)))
  }, [])
  React.useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void window.assistantLite.recording.cancel()
      if (event.key === 'Enter' && !(event.target as HTMLElement).closest('button')) {
        event.preventDefault()
        void confirm()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [rect, busy])
  const point = (event: React.PointerEvent) => ({ x: Math.max(0, Math.min(innerWidth, event.clientX)), y: Math.max(0, Math.min(innerHeight, event.clientY)) })
  return <div className="recording-selector" style={{ backgroundImage: image ? `url("${image}")` : undefined }}
    onPointerDown={(event) => {
      if (busy || event.button !== 0 || (event.target as HTMLElement).closest('button, .recording-selection-actions')) return
      origin.current = point(event)
      setRect({ ...origin.current, width: 0, height: 0 })
      setDragging(true)
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={(event) => {
      if (!origin.current) return
      const p = point(event), start = origin.current
      setRect({ x: Math.min(p.x, start.x), y: Math.min(p.y, start.y), width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y) })
    }}
    onPointerUp={(event) => {
      origin.current = null
      setDragging(false)
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    }}>
    <div className="recording-selector-wash" />
    {rect && <div className="recording-region" style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height,
      backgroundImage: image ? `url("${image}")` : undefined, backgroundSize: `${innerWidth}px ${innerHeight}px`, backgroundPosition: `-${rect.x}px -${rect.y}px` }}>
      <span className="recording-size">{Math.round(rect.width)} × {Math.round(rect.height)}</span>
    </div>}
    {(!rect || !valid) && <div className="recording-selector-hint">
      <span className="recording-dot" />
      <strong>{zh ? '拖动选择录屏区域' : 'Drag to select a recording region'}</strong>
      <span>{zh ? '可在任意屏幕框选 · Esc 取消 · 仅录制画面' : 'Select on any display · Esc to cancel · Video only'}</span>
      <button onClick={() => setRect({ x: 0, y: 0, width: innerWidth, height: innerHeight })}>{zh ? '选择整个屏幕' : 'Select entire display'}</button>
      <button onClick={() => void window.assistantLite.recording.cancel()}>{zh ? '取消' : 'Cancel'}</button>
    </div>}
    {valid && !dragging && <div className="recording-selection-actions" style={{
      left: Math.max(12, Math.min(rect.x + rect.width - 280, innerWidth - 292)),
      top: rect.y + rect.height + 74 < innerHeight ? rect.y + rect.height + 12 : Math.max(12, rect.y + rect.height - 64)
    }}>
      <button onClick={() => { setRect(null); setError('') }} disabled={busy}>{zh ? '重新选择' : 'Reselect'}</button>
      <button className="recording-primary" onClick={() => void confirm()} disabled={busy} autoFocus><span className="recording-dot" />{busy ? (zh ? '准备中…' : 'Preparing…') : (zh ? '开始录制' : 'Start recording')}</button>
      <button aria-label={zh ? '取消' : 'Cancel'} onClick={() => void window.assistantLite.recording.cancel()}><Icon name="x" /></button>
    </div>}
    {error && <div className="recording-overlay-error" role="alert">{error}</div>}
  </div>
}
createRoot(document.getElementById('root')!).render(<Overlay />)
