import { describe, expect, it } from 'vitest'
import { recordingControlsBounds, recordingCrop, validateRecordingSelection } from './recording'

describe('recording region mapping', () => {
  const selection = { x: 100, y: 50, width: 301, height: 201, viewportWidth: 1440, viewportHeight: 900 }
  it('maps Retina viewport coordinates to source pixels and even H.264 dimensions', () => {
    expect(recordingCrop(selection, 2880, 1800)).toEqual({ x: 200, y: 100, width: 602, height: 402, outputWidth: 602, outputHeight: 402 })
    expect(recordingCrop(selection, 1440, 900).outputWidth).toBe(300)
  })
  it('keeps the full crop when scaling a 5K display to 4K', () => {
    const crop = recordingCrop({ x: 0, y: 0, width: 2560, height: 1440, viewportWidth: 2560, viewportHeight: 1440 }, 5120, 2880)
    expect(crop.width).toBe(5120)
    expect([crop.outputWidth, crop.outputHeight]).toEqual([3840, 2160])
  })
  it('handles rotated displays and clamps rounding at the edge', () => {
    const crop = recordingCrop({ x: 500, y: 900, width: 99.5, height: 100, viewportWidth: 600, viewportHeight: 1000 }, 1200, 2000)
    expect(crop.x + crop.width).toBeLessThanOrEqual(1200)
    expect(crop.y + crop.height).toBe(2000)
    expect(crop.outputWidth % 2).toBe(0)
  })
  it.each([{ x: NaN }, { width: 0 }, { viewportWidth: 0 }, { x: -1 }, { width: Infinity }, { x: 1400 }])('rejects malformed region %s', (override) => {
    expect(() => validateRecordingSelection({ ...selection, ...override })).toThrow()
  })
})

describe('recording controls placement', () => {
  it('never puts the panel inside a selected region', () => {
    const region = { x: 100, y: 100, width: 800, height: 600 }
    const bounds = recordingControlsBounds(region, [{ x: 0, y: 0, width: 1200, height: 900 }])!
    expect(bounds.y).toBeGreaterThanOrEqual(700)
  })
  it('hides controls for fullscreen when there is no spare screen', () => {
    const display = { x: 0, y: 0, width: 1920, height: 1080 }
    expect(recordingControlsBounds(display, [display])).toBeNull()
  })
  it('can place controls on a monitor with a negative desktop origin', () => {
    const region = { x: 0, y: 0, width: 1920, height: 1080 }
    const bounds = recordingControlsBounds(region, [region, { x: -1440, y: -200, width: 1440, height: 900 }])!
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(0)
  })
})
