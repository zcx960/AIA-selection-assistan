export interface RecordingRect {
  x: number
  y: number
  width: number
  height: number
}

export interface RecordingSelection extends RecordingRect {
  viewportWidth: number
  viewportHeight: number
}

export interface RecordingOverlayInit {
  imageDataUrl: string
}

export interface RecordingInit {
  sourceId: string
  selection: RecordingSelection
  stopShortcut: string
  controlsHidden: boolean
}

export interface RecordingResult {
  url: string
  width: number
  height: number
  bytes: number
}

export function validateRecordingSelection(value: RecordingSelection): RecordingSelection {
  const values = [value?.x, value?.y, value?.width, value?.height, value?.viewportWidth, value?.viewportHeight]
  if (!values.every(Number.isFinite) || value.viewportWidth <= 0 || value.viewportHeight <= 0 ||
    value.x < 0 || value.y < 0 || value.width < 16 || value.height < 16 ||
    value.x + value.width > value.viewportWidth + 1 || value.y + value.height > value.viewportHeight + 1) {
    throw new Error('Invalid recording region')
  }
  return value
}

/** Map viewport coordinates to the actual stream, including mixed-DPI displays. */
export function recordingCrop(selection: RecordingSelection, videoWidth: number, videoHeight: number) {
  validateRecordingSelection(selection)
  if (videoWidth < 2 || videoHeight < 2) throw new Error('Screen stream has no video frames')
  const x = Math.min(videoWidth - 2, Math.round(selection.x / selection.viewportWidth * videoWidth))
  const y = Math.min(videoHeight - 2, Math.round(selection.y / selection.viewportHeight * videoHeight))
  const width = Math.max(2, Math.min(videoWidth - x, Math.round(selection.width / selection.viewportWidth * videoWidth)))
  const height = Math.max(2, Math.min(videoHeight - y, Math.round(selection.height / selection.viewportHeight * videoHeight)))
  // H.264/yuv420p needs even dimensions. Cap at 4K without changing the crop.
  const scale = Math.min(1, 3840 / width, 2160 / height)
  return { x, y, width, height, outputWidth: Math.max(2, Math.floor(width * scale / 2) * 2),
    outputHeight: Math.max(2, Math.floor(height * scale / 2) * 2) }
}

/** Return a position outside the recorded area, or null for a fullscreen region. */
export function recordingControlsBounds(region: RecordingRect, workAreas: RecordingRect[], width = 380, height = 100): RecordingRect | null {
  const overlaps = (a: RecordingRect, b: RecordingRect) =>
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
  for (const area of workAreas) {
    const candidates = [
      { x: area.x + area.width - width - 12, y: area.y + area.height - height - 12 },
      { x: area.x + 12, y: area.y + 12 },
      { x: region.x, y: region.y + region.height + 12 },
      { x: region.x, y: region.y - height - 12 },
      { x: region.x - width - 12, y: region.y },
      { x: region.x + region.width + 12, y: region.y }
    ]
    for (const position of candidates) {
      const candidate = { ...position, width, height }
      if (candidate.x >= area.x && candidate.y >= area.y && candidate.x + width <= area.x + area.width &&
        candidate.y + height <= area.y + area.height && !overlaps(candidate, region)) return candidate
    }
  }
  return null
}
