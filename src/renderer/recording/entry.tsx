import '../styles.css'
import './recording.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { RegionRecorder, type RecorderState } from './recorder'
import { useSettings } from '../useSettings'
import { useThemeMode } from '../useThemeMode'
import { Icon } from '../icons'

function RecorderApp() {
  const { settings } = useSettings()
  useThemeMode(settings.theme)
  const zh = settings.language === 'zh-CN'
  const [state, setState] = React.useState<RecorderState>({ phase: 'preparing' })
  const recorder = React.useRef<RegionRecorder>()
  const [seconds, setSeconds] = React.useState(0)
  const [feedback, setFeedback] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => {
    const instance = new RegionRecorder(setState)
    recorder.current = instance
    const off = window.assistantLite.recording.onStop(() => instance.stop())
    void instance.start()
    return () => { off(); instance.stop() }
  }, [])
  React.useEffect(() => {
    if (state.phase !== 'recording') return
    const interval = setInterval(() => setSeconds(Math.floor((Date.now() - state.startedAt!) / 1000)), 250)
    return () => clearInterval(interval)
  }, [state.phase, state.startedAt])
  const action = async (kind: 'copy' | 'save') => {
    setBusy(true)
    setFeedback('')
    try {
      if (await window.assistantLite.recording[kind]()) setFeedback(kind === 'copy' ? (zh ? '已复制视频文件，可粘贴到支持文件的应用' : 'Video file copied. Paste into an app that accepts files.') : (zh ? 'MP4 已保存' : 'MP4 saved'))
    } catch (error) { setFeedback(`${zh ? '操作失败：' : 'Failed: '}${String(error)}`) }
    finally { setBusy(false) }
  }
  const close = () => void window.assistantLite.recording.cancel()
  const compact = ['preparing', 'countdown', 'recording'].includes(state.phase)
  if (compact) return <main className="recording-controls">
    <div className="recording-control-main"><span className="recording-dot" /><strong aria-live="polite">
      {state.phase === 'preparing' ? (zh ? '正在准备录屏…' : 'Preparing recording…') : state.phase === 'countdown' ?
        (zh ? `${state.countdown} 秒后开始录制` : `Starting in ${state.countdown}…`) :
        `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`}
    </strong><button className="recording-primary" onClick={() => recorder.current?.stop()}><Icon name={state.phase === 'recording' ? 'square' : 'x'} />{state.phase === 'recording' ? (zh ? '停止录制' : 'Stop') : (zh ? '取消' : 'Cancel')}</button></div>
    <p>{state.init?.controlsHidden ? (zh ? '录制时此面板会隐藏；从托盘菜单停止' : 'Controls hide during capture; stop from the tray menu') :
      (zh ? '仅录制所选区域 · 无声音' : 'Selected region only · No audio')}
      {state.init?.stopShortcut && ` · ${state.init.stopShortcut.replace('CommandOrControl', navigator.platform.includes('Mac') ? '⌘' : 'Ctrl')}`}</p>
  </main>
  return <main className="recording-preview">
    <header className="recording-preview-header"><div><span className="recording-eyebrow">AIA · {zh ? '区域录屏' : 'REGION RECORDING'}</span><h1>{state.phase === 'ready' ? (zh ? '录制完成' : 'Recording complete') : state.phase === 'processing' ? (zh ? '正在生成 MP4' : 'Creating MP4') : (zh ? '录制未完成' : 'Recording could not complete')}</h1></div>
      {state.phase !== 'processing' && <button aria-label={zh ? '关闭' : 'Close'} onClick={close} disabled={busy}><Icon name="x" size={20} /></button>}</header>
    {state.result ? <div className="recording-video-wrap"><video controls preload="metadata" src={state.result.url} /></div> :
      <div className="recording-message" role={state.phase === 'error' ? 'alert' : 'status'}>
        {state.phase === 'processing' ? <><span className="recording-spinner" /><p>{zh ? '正在处理视频，请稍候…' : 'Processing your video…'}</p></> :
          <><Icon name="circle-help" size={32} /><p>{state.error}</p><span>{zh ? '如为权限问题，请允许屏幕录制后重启应用。' : 'For permission errors, allow screen recording and restart the app.'}</span></>}
      </div>}
    <footer className="recording-preview-footer">
      {state.result && <><span className="recording-metadata">MP4 · {state.result.width} × {state.result.height} · {(state.result.bytes / 1024 / 1024).toFixed(1)} MB</span><div className="recording-preview-actions">
        <button onClick={() => void action('copy')} disabled={busy}><Icon name="copy" />{zh ? '复制视频' : 'Copy video'}</button>
        <button className="recording-primary" onClick={() => void action('save')} disabled={busy}><Icon name="download" />{zh ? '保存 MP4' : 'Save MP4'}</button>
      </div></>}
      {state.phase === 'error' && <div className="recording-preview-actions">{state.retryable && <button className="recording-primary" onClick={() => void recorder.current?.export()}>{zh ? '重试生成 MP4' : 'Retry MP4 export'}</button>}<button onClick={close}>{zh ? '关闭' : 'Close'}</button></div>}
      <p className="recording-feedback" role="status">{feedback || (state.phase === 'ready' ? (zh ? '复制的是 MP4 文件；临时视频保留 7 天，请及时保存。' : 'Copies the MP4 file. Temporary recordings are kept for 7 days; save a copy to keep it.') : '')}</p>
    </footer>
  </main>
}
createRoot(document.getElementById('root')!).render(<RecorderApp />)
