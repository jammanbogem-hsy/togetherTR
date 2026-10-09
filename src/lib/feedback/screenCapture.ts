// In-app screen capture for the feedback dialog. The teacher drags a region straight on the live
// page and the page draws itself into an image (modern-screenshot renders the DOM through the
// browser's own CSS engine), so there is no screen-share permission prompt and no separate capture
// program. Region math is pure so it can be tested without a DOM.

export interface CropRect { x: number; y: number; width: number; height: number }
export interface Size { width: number; height: number }

/** Selections smaller than this (CSS px) are treated as a click, not a region. */
export const MIN_CROP_PX = 12
/** Elements carrying this attribute (feedback dialog, launcher, selection layer) are left out of captures. */
export const CAPTURE_EXCLUDE_ATTR = 'data-feedback-ui'
/** Render at most 2x so HiDPI captures stay sharp but small enough for the upload limit. */
const MAX_CAPTURE_SCALE = 2

/** Normalises a drag from `start` to `end` into a rectangle clamped to `bounds` (top-left origin). */
export function normalizeCrop(start: { x: number; y: number }, end: { x: number; y: number }, bounds: Size): CropRect {
  const clampX = (value: number) => Math.min(bounds.width, Math.max(0, value))
  const clampY = (value: number) => Math.min(bounds.height, Math.max(0, value))
  const x1 = clampX(start.x), x2 = clampX(end.x), y1 = clampY(start.y), y2 = clampY(end.y)
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) }
}

export function isUsableCrop(rect: CropRect | null | undefined): rect is CropRect {
  return !!rect && rect.width >= MIN_CROP_PX && rect.height >= MIN_CROP_PX
}

/** Maps a region in CSS px on a `displayed` surface to pixels of a `source` image of another size. */
export function cropToSource(rect: CropRect, displayed: Size, source: Size): CropRect {
  const sx = source.width / Math.max(1, displayed.width)
  const sy = source.height / Math.max(1, displayed.height)
  const x = Math.max(0, Math.round(rect.x * sx))
  const y = Math.max(0, Math.round(rect.y * sy))
  return {
    x, y,
    width: Math.max(1, Math.min(source.width - x, Math.round(rect.width * sx))),
    height: Math.max(1, Math.min(source.height - y, Math.round(rect.height * sy))),
  }
}

export function captureScale(devicePixelRatio: number | undefined): number {
  return Math.min(MAX_CAPTURE_SCALE, Math.max(1, devicePixelRatio || 1))
}

/** True for nodes that must not appear in the capture (the feedback UI itself). */
export function isExcludedFromCapture(node: Node): boolean {
  return node.nodeType === 1 && (node as Element).hasAttribute?.(CAPTURE_EXCLUDE_ATTR) === true
}

export function captureErrorMessage(): string {
  return '화면을 캡처하지 못했어요. 다시 시도하거나 캡처 프로그램으로 찍어 붙여 넣어 주세요.'
}

/**
 * Draws what the viewport shows now (scrolled containers included) and returns the `region`
 * (viewport CSS px) as PNG, or the whole viewport when `region` is null. No permission prompt.
 */
export async function captureViewportRegion(region: CropRect | null): Promise<Blob> {
  const { domToCanvas } = await import('modern-screenshot')
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const scale = captureScale(window.devicePixelRatio)
  const body = document.body
  const background = getComputedStyle(body).backgroundColor
  const scrolledY = window.scrollY, scrolledX = window.scrollX
  const canvas = await domToCanvas(body, {
    width: viewport.width,
    height: viewport.height,
    scale,
    backgroundColor: background && background !== 'rgba(0, 0, 0, 0)' ? background : '#ffffff',
    filter: node => !isExcludedFromCapture(node),
    features: { restoreScrollPosition: true },
    timeout: 8000,
    // The page itself may be scrolled; shift the clone so the visible part lands at the top-left.
    style: scrolledX || scrolledY ? { margin: '0', transform: `translate(${-scrolledX}px, ${-scrolledY}px)` } : { margin: '0' },
  })
  const crop = region ? cropToSource(region, viewport, { width: canvas.width, height: canvas.height }) : null
  const out = document.createElement('canvas')
  out.width = crop ? crop.width : canvas.width
  out.height = crop ? crop.height : canvas.height
  const context = out.getContext('2d')!
  if (crop) context.drawImage(canvas, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)
  else context.drawImage(canvas, 0, 0)
  return await new Promise<Blob>((resolve, reject) => out.toBlob(blob => blob ? resolve(blob) : reject(new Error('encode-failed')), 'image/png'))
}
