import { describe, expect, it } from 'vitest'
import {
  captureMarker,
  hasCaptureSource,
  isCaptureMetadata,
  parseCaptures,
} from '../src/shared/captures'

describe('capture format across the rename', () => {
  it('reads mixed legacy and current captures with CRLF without rewriting input', () => {
    const text =
      '<!-- inkisle-capture:old 2026-11-27T10:00:00Z -->\r\n旧记录\r\n\r\n' +
      captureMarker('capture', 'new', '2026-11-27T11:00:00Z') +
      '\r\n新记录\r\n'
    expect(parseCaptures(text)).toEqual([
      { id: 'new', time: '2026-11-27T11:00:00Z', text: '新记录' },
      { id: 'old', time: '2026-11-27T10:00:00Z', text: '旧记录' },
    ])
    expect(text).toContain('\r\n')
  })

  it('honors archive markers from either version so archived notes do not reappear', () => {
    const old = '<!-- inkisle-capture:old 2026-11-27T10:00:00Z -->\n旧记录\n'
    const current = captureMarker('capture', 'new', '2026-11-27T11:00:00Z') + '\n新记录\n'
    expect(
      parseCaptures(
        old + current + '<!-- inkisle-archived:new -->\n' + captureMarker('archived', 'old'),
      ),
    ).toEqual([])
  })

  it('recognizes legacy origins to avoid appending the same capture after an interrupted archive', () => {
    expect(hasCaptureSource('<!-- inkisle-from:entry-1 -->\n旧记录', 'entry-1')).toBe(true)
    expect(hasCaptureSource(captureMarker('from', 'entry-1'), 'entry-1')).toBe(true)
    expect(hasCaptureSource('<!-- inkisle-from:entry-10 -->', 'entry-1')).toBe(false)
    expect(captureMarker('archived', 'entry-1')).toBe('<!-- slips-archived:entry-1 -->')
  })

  it('hides only known standalone capture metadata in live preview', () => {
    expect(isCaptureMetadata('<!-- inkisle-from:entry-1 -->')).toBe(true)
    expect(isCaptureMetadata(captureMarker('capture', 'entry-1', '2026-11-27T10:00:00Z'))).toBe(
      true,
    )
    expect(isCaptureMetadata('<!-- user-from:entry-1 -->')).toBe(false)
    expect(isCaptureMetadata('text <!-- slips-from:entry-1 -->')).toBe(false)
  })
})
