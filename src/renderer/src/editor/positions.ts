import type { EditorView } from '@codemirror/view'

export interface ReadingPosition {
  anchor: number
  head: number
  preview: boolean
  scrollTop: number
  top: { from: number; offset: number }
}

// One cache per pane, owned by its window. Store coordinates, never document contents.
export class ReadingPositions {
  private entries = new Map<string, ReadingPosition>()
  get(path: string) {
    const position = this.entries.get(path)
    if (position) {
      this.entries.delete(path)
      this.entries.set(path, position)
    }
    return position
  }
  set(path: string, position: ReadingPosition) {
    this.entries.delete(path)
    this.entries.set(path, position)
    if (this.entries.size > 100) this.entries.delete(this.entries.keys().next().value!)
  }
  move(previous: string, target: string) {
    const position = this.entries.get(previous)
    this.entries.delete(previous)
    if (position) this.set(target, position)
  }
}

export function selectionAt(position: ReadingPosition | undefined, length: number) {
  return {
    anchor: Math.min(position?.anchor ?? 0, length),
    head: Math.min(position?.head ?? 0, length),
  }
}

export function trackReadingPosition(
  view: EditorView,
  container: HTMLElement,
  positions: ReadingPositions,
  path: string,
  preview: () => boolean,
  saved: ReadingPosition | undefined,
) {
  let restoring = true
  let disposed = false
  const toolbarHeight = () =>
    container.querySelector<HTMLElement>(':scope > .related-toolbar')?.offsetHeight ?? 0
  const visibleTop = () => container.getBoundingClientRect().top + toolbarHeight()
  const key = {}
  const restore = () => {
    if (!restoring || disposed) return
    view.requestMeasure({
      key,
      read: () => {
        if (!saved || saved.scrollTop === 0) return 0
        const block = view.lineBlockAt(Math.min(saved.top.from, view.state.doc.length))
        return container.scrollTop + view.documentTop + block.top + saved.top.offset - visibleTop()
      },
      write: (top) => {
        if (restoring && !disposed) container.scrollTop = Math.max(0, top)
      },
    })
  }
  const stopRestoring = () => {
    restoring = false
    observer.disconnect()
    clearTimeout(deadline)
  }
  // Images and CodeMirror's initial measurement can change height after mounting.
  // Reapply during initial layout only; user input always takes over immediately.
  const observer = new ResizeObserver(restore)
  observer.observe(view.contentDOM)
  container.addEventListener('scroll', restore, { passive: true })
  const deadline = setTimeout(stopRestoring, 1500)
  for (const event of ['wheel', 'pointerdown', 'keydown', 'touchstart'])
    container.addEventListener(event, stopRestoring, { passive: true })
  restore()
  return () => {
    if (disposed) return
    if (restoring && saved) positions.set(path, saved)
    else {
      const height = visibleTop() - view.documentTop
      const block = view.lineBlockAtHeight(Math.max(0, height))
      const selection = view.state.selection.main
      positions.set(path, {
        anchor: selection.anchor,
        head: selection.head,
        preview: preview(),
        scrollTop: container.scrollTop,
        top: { from: block.from, offset: height - block.top },
      })
    }
    disposed = true
    stopRestoring()
    container.removeEventListener('scroll', restore)
    for (const event of ['wheel', 'pointerdown', 'keydown', 'touchstart'])
      container.removeEventListener(event, stopRestoring)
  }
}
