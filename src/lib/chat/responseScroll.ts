/** Keep an answer's beginning visible while it grows; only an intentional bottom scroll opts into following. */
export function createResponseScrollController(getViewport: () => HTMLElement | null, onUnread: (unread: boolean) => void) {
  let scope = '', initialized = false
  let mode: 'start' | 'tail' | 'paused' = 'start'
  let lastSavedId = '', streaming = false, awaitingSaved = false
  let revision = '', unread = false, programmedTop: number | null = null, userIntent = false
  const notify = (next: boolean) => { if (unread !== next) { unread = next; onUnread(next) } }
  const elements = (viewport: HTMLElement) => {
    const saved = Array.from(viewport.querySelectorAll<HTMLElement>('[data-ai-response-id]')).at(-1) ?? null
    const stream = viewport.querySelector<HTMLElement>('[data-ai-stream]')
    return { saved, stream }
  }
  const move = (viewport: HTMLElement, top: number) => {
    const target = Math.max(0, Math.min(top, viewport.scrollHeight - viewport.clientHeight))
    if (Math.abs(viewport.scrollTop - target) < 1) return
    userIntent = false
    programmedTop = target
    viewport.scrollTo({ top: target, behavior: 'instant' })
  }
  const startOf = (viewport: HTMLElement, target: HTMLElement) => {
    const scale = viewport.offsetHeight ? viewport.getBoundingClientRect().height / viewport.offsetHeight : 1
    return viewport.scrollTop + (target.getBoundingClientRect().top - viewport.getBoundingClientRect().top) / (scale || 1) - viewport.clientTop
  }

  function sync(scopeKey: string, ready: boolean) {
    if (scope !== scopeKey) {
      scope = scopeKey; initialized = false; mode = 'start'; lastSavedId = ''; streaming = false
      awaitingSaved = false; revision = ''; programmedTop = null; userIntent = false; notify(false)
    }
    const viewport = getViewport()
    if (!viewport || !ready) return
    const { saved, stream } = elements(viewport)
    const savedId = saved?.dataset.aiResponseId ?? ''
    const started = !!stream && !streaming
    const savedChanged = savedId !== lastSavedId
    const completing = (streaming || awaitingSaved) && savedChanged
    if (streaming && !stream && !savedChanged) awaitingSaved = true
    if (completing || started) awaitingSaved = false
    const target = stream ?? ((!awaitingSaved || savedChanged) ? saved : null)
    const incoming = !!target && (started || savedChanged)
    if (incoming && !completing && mode !== 'paused') mode = 'start'
    const nextRevision = target ? `${stream ? 'stream' : savedId}:${target.dataset.aiRevision ?? target.textContent?.length ?? 0}` : revision
    if (target && !initialized) { initialized = true; mode = 'start' }
    if (mode === 'paused') {
      if (incoming || nextRevision !== revision) notify(true)
    } else if (target && mode === 'start') {
      // Before the answer fills the viewport, the browser clamps to the available bottom.
      // Once it is taller, the same anchor stays at the top instead of chasing the last line.
      move(viewport, startOf(viewport, target))
      notify(false)
    } else if (mode === 'tail') {
      move(viewport, viewport.scrollHeight)
      notify(false)
    }
    revision = nextRevision; streaming = !!stream; lastSavedId = savedId
  }

  function onScroll() {
    const viewport = getViewport()
    if (!viewport) return
    if (programmedTop !== null && Math.abs(viewport.scrollTop - programmedTop) <= 1) {
      programmedTop = null
      return
    }
    if (!userIntent) return // DOM height clamping and browser restoration are not a request to follow.
    programmedTop = null
    const atBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 24
    mode = atBottom ? 'tail' : 'paused'
    if (atBottom) notify(false)
  }

  function goToLatest() {
    const viewport = getViewport()
    if (!viewport) return
    const { saved, stream } = elements(viewport)
    const target = stream ?? saved
    mode = 'start'; userIntent = false; notify(false)
    if (target) move(viewport, startOf(viewport, target))
  }

  return { sync, onScroll, goToLatest, onUserIntent: () => { userIntent = true; programmedTop = null } }
}
