// Explicit local-development flag only; ordinary production builds do no measurement/logging.
export const PERF_DEBUG = process.env.NEXT_PUBLIC_PERF_DEBUG === '1'
let sequence = 0
export function startInteraction(name: string): () => void {
  if (!PERF_DEBUG || typeof performance === 'undefined') return () => {}
  const start = `tcid:${name}:${++sequence}`
  performance.mark(start)
  let done = false
  return () => {
    if (done) return
    done = true
    const result = performance.measure(`tcid:${name}`, start)
    performance.clearMarks(start)
    console.debug(`[tcid perf] ${name}: ${result.duration.toFixed(2)}ms`)
  }
}

/** Second frame observes the browser having had an opportunity to paint the committed UI. */
export function finishAfterPaint(finish: () => void) {
  if (!PERF_DEBUG) return
  if (typeof requestAnimationFrame === 'undefined') { finish(); return }
  requestAnimationFrame(() => requestAnimationFrame(finish))
}
