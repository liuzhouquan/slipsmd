import type { Capture } from './types'

// The old prefix is a persisted file format, retained only to read existing notes.
const prefixes = ['slips', 'inkisle'] as const
const prefixPattern = `(?:${prefixes.join('|')})`
const metadataPattern = new RegExp(`^<!-- ${prefixPattern}-(capture|archived|from):.*-->$`)
type MarkerKind = 'capture' | 'archived' | 'from'

export function captureMarker(kind: MarkerKind, id: string, time?: string): string {
  return `<!-- slips-${kind}:${id}${time ? ' ' + time : ''} -->`
}

export function hasCaptureSource(text: string, id: string): boolean {
  return prefixes.some((prefix) => text.includes(`<!-- ${prefix}-from:${id} -->`))
}

export function isCaptureMetadata(line: string): boolean {
  return metadataPattern.test(line)
}

export function parseCaptures(text: string): Capture[] {
  const normalized = text.replace(/\r\n/g, '\n')
  const archived = new Set(
    [...normalized.matchAll(new RegExp(`<!-- ${prefixPattern}-archived:([\\w-]+) -->`, 'g'))].map(
      (match) => match[1],
    ),
  )
  const clean = normalized.replace(
    new RegExp(`<!-- ${prefixPattern}-archived:[\\w-]+ -->`, 'g'),
    '',
  )
  return [
    ...clean.matchAll(
      new RegExp(
        `<!-- ${prefixPattern}-capture:([\\w-]+) ([^ ]+) -->\\n([\\s\\S]*?)(?=<!-- ${prefixPattern}-capture:|$)`,
        'g',
      ),
    ),
  ]
    .filter((match) => !archived.has(match[1]))
    .map((match) => ({ id: match[1], time: match[2], text: match[3].trim() }))
    .reverse()
}
