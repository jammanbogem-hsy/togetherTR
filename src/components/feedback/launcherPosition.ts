// Position math for the draggable feedback launcher. Pure so it can be tested without a DOM.

/** Collapsed launcher is a 44px circle (minimum touch target). */
export const LAUNCHER_SIZE = 44
/** Width when the label is shown on hover/focus. */
export const LAUNCHER_EXPANDED_WIDTH = 168
/** Gap kept between the launcher and the viewport edge. */
export const LAUNCHER_EDGE_MARGIN = 8
/** Pointer travel (px) before a press becomes a drag instead of a click. */
export const DRAG_THRESHOLD_PX = 6
export const LAUNCHER_STORAGE_KEY = 'tcid.feedbackLauncher.position.v1'

export interface LauncherPoint { x: number; y: number }
export interface Viewport { width: number; height: number }

/** Keeps the collapsed circle (top-left at x,y) fully inside the viewport. */
export function clampLauncherPosition(point: LauncherPoint, viewport: Viewport): LauncherPoint {
  const maxX = Math.max(LAUNCHER_EDGE_MARGIN, viewport.width - LAUNCHER_SIZE - LAUNCHER_EDGE_MARGIN)
  const maxY = Math.max(LAUNCHER_EDGE_MARGIN, viewport.height - LAUNCHER_SIZE - LAUNCHER_EDGE_MARGIN)
  return {
    x: Math.round(Math.min(maxX, Math.max(LAUNCHER_EDGE_MARGIN, point.x))),
    y: Math.round(Math.min(maxY, Math.max(LAUNCHER_EDGE_MARGIN, point.y))),
  }
}

/**
 * The label grows toward the roomier side so the expanded pill stays on screen:
 * in the right half it grows leftward (anchored by its right edge), in the left half rightward.
 */
export function expandsLeftward(point: LauncherPoint, viewport: Viewport): boolean {
  return point.x + LAUNCHER_SIZE / 2 >= viewport.width / 2
}

/** CSS offsets for a placed launcher; right-anchored when it expands leftward. */
export function launcherStyle(point: LauncherPoint, viewport: Viewport): { top: number; left?: number; right?: number } {
  return expandsLeftward(point, viewport)
    ? { top: point.y, right: Math.max(0, viewport.width - point.x - LAUNCHER_SIZE) }
    : { top: point.y, left: point.x }
}

export function exceededDragThreshold(start: LauncherPoint, current: LauncherPoint): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= DRAG_THRESHOLD_PX
}

/** Reads a stored position; anything malformed means "use the default corner". */
export function parseStoredLauncherPosition(raw: string | null | undefined): LauncherPoint | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<LauncherPoint>
    if (typeof value?.x !== 'number' || typeof value?.y !== 'number') return null
    if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return null
    return { x: value.x, y: value.y }
  } catch {
    return null
  }
}
