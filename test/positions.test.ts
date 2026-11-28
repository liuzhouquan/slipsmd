import { describe, expect, it } from 'vitest'
import {
  ReadingPositions,
  selectionAt,
  type ReadingPosition,
} from '../src/renderer/src/editor/positions'

const position: ReadingPosition = {
  anchor: 250,
  head: 150,
  preview: false,
  scrollTop: 800,
  top: { from: 100, offset: 12 },
}

describe('window-local reading positions', () => {
  it('clamps a restored selection when the disk document has become shorter', () => {
    expect(selectionAt(position, 200)).toEqual({ anchor: 200, head: 150 })
    expect(selectionAt(position, 0)).toEqual({ anchor: 0, head: 0 })
    expect(selectionAt(undefined, 100)).toEqual({ anchor: 0, head: 0 })
  })
  it('bounds the cache and keeps recently revisited documents', () => {
    const cache = new ReadingPositions()
    for (let i = 0; i < 100; i++) cache.set(String(i), position)
    cache.get('0')
    cache.set('100', position)
    expect(cache.get('1')).toBeUndefined()
    expect(cache.get('0')).toEqual(position)
    expect(cache.get('100')).toEqual(position)
  })
  it('keeps positions independent between panes and windows', () => {
    const first = new ReadingPositions()
    const second = new ReadingPositions()
    first.set('same.md', position)
    expect(second.get('same.md')).toBeUndefined()
    second.set('same.md', { ...position, scrollTop: 0 })
    expect(first.get('same.md')?.scrollTop).toBe(800)
  })
  it('moves a cached position to the new path and leaves unrelated entries intact', () => {
    const cache = new ReadingPositions()
    cache.set('Old.md', position)
    cache.set('Other.md', { ...position, scrollTop: 0 })
    cache.move('Old.md', 'Folder/New.md')
    cache.move('Old.md', 'Folder/New.md')
    expect(cache.get('Old.md')).toBeUndefined()
    expect(cache.get('Folder/New.md')).toEqual(position)
    expect(cache.get('Other.md')?.scrollTop).toBe(0)
  })
})
