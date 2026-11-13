import { recordingCrop, type RecordingInit, type RecordingResult } from '@shared/recording'

export type RecorderState = { phase: 'preparing' | 'countdown' | 'recording' | 'processing' | 'ready' | 'error';
  countdown?: number; startedAt?: number; result?: RecordingResult; error?: string; retryable?: boolean; init?: RecordingInit }

export class RegionRecorder {
  private recorder: MediaRecorder | null = null
  private source: MediaStream | null = null
  private canvasStream: MediaStream | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private stopped = false
  private writes = Promise.resolve()
  private pendingBytes = 0
  private error: Error | null = null
  private size = { width: 0, height: 0 }
  private exportReady = false

  constructor(private update: (state: RecorderState) => void) {}

  async start(): Promise<void> {
    try {
      const init = await window.assistantLite.recording.ready()
      this.update({ phase: 'preparing', init })
      this.source = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
        mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: init.sourceId,
          minWidth: 1, minHeight: 1, maxWidth: 7680, maxHeight: 4320, maxFrameRate: 30 }
      } as MediaTrackConstraints })
      if (this.stopped) { this.release(); await window.assistantLite.recording.cancel(); return }
      const video = document.createElement('video')
      video.muted = true
      video.srcObject = this.source
      await video.play()
      const crop = recordingCrop(init.selection, video.videoWidth, video.videoHeight)
      const canvas = document.createElement('canvas')
      canvas.width = crop.outputWidth
      canvas.height = crop.outputHeight
      this.size = { width: canvas.width, height: canvas.height }
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('Cannot create recording canvas')
      const draw = () => context.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height)
      const mimeType = ['video/mp4;codecs=avc1.640033', 'video/mp4;codecs=avc1.420033'].find((type) => MediaRecorder.isTypeSupported(type))
      if (!mimeType) throw new Error('H.264 MP4 recording is unavailable. Please update the app or your graphics driver.')
      this.source.getVideoTracks()[0].onended = () => this.stop()
      for (let countdown = 3; countdown > 0; countdown--) {
        if (this.stopped) { this.release(); await window.assistantLite.recording.cancel(); return }
        this.update({ phase: 'countdown', countdown, init })
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
      if (this.stopped) { this.release(); await window.assistantLite.recording.cancel(); return }
      await window.assistantLite.recording.started()
      draw()
      this.canvasStream = canvas.captureStream(30)
      const recorder = new MediaRecorder(this.canvasStream, { mimeType, videoBitsPerSecond: 8_000_000 })
      this.recorder = recorder
      recorder.ondataavailable = (event) => {
        if (!event.data.size) return
        this.pendingBytes += event.data.size
        if (this.pendingBytes > 64 * 1024 * 1024) { this.error = new Error('Recording storage is too slow'); this.stop() }
        this.writes = this.writes.then(async () => {
          if (this.error) return
          await window.assistantLite.recording.append(new Uint8Array(await event.data.arrayBuffer()))
        }).catch((error: Error) => { this.error = error; this.stop() }).finally(() => { this.pendingBytes -= event.data.size })
      }
      recorder.onerror = () => { this.error = new Error('Screen recording failed'); this.stop() }
      recorder.onstop = () => { void this.complete() }
      this.timer = setInterval(draw, 1000 / 30)
      recorder.start(1000)
      this.update({ phase: 'recording', startedAt: Date.now(), init })
      if (this.stopped) recorder.stop()
    } catch (error) { await this.fail(error) }
  }

  stop(): void {
    this.stopped = true
    if (this.recorder?.state === 'recording') this.recorder.stop()
    else {
      this.release()
      void window.assistantLite.recording.cancel().catch(() => {})
    }
  }
  private release(): void {
    if (this.timer) clearInterval(this.timer)
    this.source?.getTracks().forEach((track) => { track.onended = null; track.stop() })
    this.canvasStream?.getTracks().forEach((track) => track.stop())
    this.source = null
    this.canvasStream = null
  }
  private async complete(): Promise<void> {
    this.release()
    await this.writes
    if (this.error) { await this.fail(this.error); return }
    this.exportReady = true
    await this.export()
  }
  async export(): Promise<void> {
    this.update({ phase: 'processing' })
    try {
      const result = await window.assistantLite.recording.finish(this.size)
      this.update({ phase: 'ready', result })
    } catch (error) { await this.fail(error) }
  }
  private async fail(error: unknown): Promise<void> {
    this.release()
    await window.assistantLite.recording.failed().catch(() => {})
    this.update({ phase: 'error', error: error instanceof Error ? error.message : String(error), retryable: this.exportReady })
  }
}
