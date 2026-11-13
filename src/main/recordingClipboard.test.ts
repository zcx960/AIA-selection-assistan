import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ clipboard: {} }))
import { windowsCopyScript } from './recordingClipboard'

describe('Windows native video file clipboard', () => {
  it('treats Unicode, quotes and shell characters in paths as data', () => {
    const path = "C:\\Users\\测试\\My Videos\\'$(test).mp4"
    const script = windowsCopyScript(path)
    expect(script).not.toContain(path)
    const data = script.match(/FromBase64String\('([^']+)'\)/)![1]
    expect(Buffer.from(data, 'base64').toString('utf8')).toBe(path)
    expect(script).toContain('Clipboard]::SetFileDropList')
  })
})
