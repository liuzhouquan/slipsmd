import { describe, expect, it, vi } from 'vitest'

// Exercise Windows path algorithms on every CI host. This is not a claim of NTFS testing.
vi.mock('node:path', async (original) => {
  const actual = await original<typeof import('node:path')>()
  return { ...actual.win32, default: actual.win32 }
})
import { applyUrlEdits, planUrlEdits } from '../src/main/link-repair'

const root = 'C:\\Notes'
describe('case-preserving Windows repair paths', () => {
  it('keeps a distinct parent directory in incoming links', () => {
    const context = {
      root,
      source: 'C:\\Notes\\A\\Old.md',
      target: 'C:\\Notes\\A\\New.md',
      document: 'C:\\Notes\\a\\Index.md',
    }
    const text = '[old](../A/Old.md#heading)'
    expect(applyUrlEdits(text, planUrlEdits(text, context).edits)).toBe(
      '[old](../A/New.md#heading)',
    )
  })
  it('rebases resources when moving between case-distinct directories', () => {
    const source = 'C:\\Notes\\A\\Old.md'
    const context = { root, source, target: 'C:\\Notes\\a\\New.md', document: source }
    const text = '![pic](pic.png)'
    const result = planUrlEdits(text, context)
    expect(applyUrlEdits(text, result.edits)).toBe('![pic](../A/pic.png)')
    expect(result.edits[0].before).not.toBe(result.edits[0].after)
  })
  it('keeps the exact target directory spelling in rooted incoming links', () => {
    const context = {
      root,
      source: 'C:\\Notes\\A\\Old.md',
      target: 'C:\\Notes\\a\\New.md',
      document: 'C:\\Notes\\Index.md',
    }
    const text = '[old](/A/Old.md)'
    expect(applyUrlEdits(text, planUrlEdits(text, context).edits)).toBe('[old](/a/New.md)')
  })
  it('still represents the future parent directory explicitly', () => {
    const source = 'C:\\Notes\\Old.md'
    const context = { root, source, target: 'C:\\Notes\\Archive\\New.md', document: source }
    const text = '[folder](Archive/#part)'
    expect(applyUrlEdits(text, planUrlEdits(text, context).edits)).toBe('[folder](./#part)')
  })
  it('does not authorize a case-distinct sibling of the workspace root', () => {
    const context = {
      root: 'C:\\Notes\\A',
      source: 'C:\\Notes\\a\\Old.md',
      target: 'C:\\Notes\\A\\New.md',
      document: 'C:\\Notes\\A\\Index.md',
    }
    expect(() => planUrlEdits('[old](Old.md)', context)).toThrow('同一工作区')
  })
})
