// In-app screen capture for the feedback dialog: the teacher drags a region straight on the live
// page, and one frame of this tab is taken with the browser's Screen Capture API (no extension or
// separate capture program) and cropped to that region. Region math is pure for tests.

export interface CropRect { x: number; y: number; width: number; height: number }
export interface Size { width: number; height: number }

/** Selections smaller than this (display px) are treated as a click, not a crop. */
export const MIN_CROP_PX = 12

/** True when this browser can capture the current tab (desktop Chrome/Edge/Firefox/Safari 13+). */
export function canCaptureScreen(nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  return typeof nav?.mediaDevices?.getDisplayMedia === 'function'
}

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

/** Maps a crop drawn on the displayed (scaled) image back to source-image pixels. */
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

/** Human message for a failed capture; a declined permission prompt is a normal cancel. */
export function captureErrorMessage(error: unknown): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'AbortError') return '화면 캡처를 취소했어요.'
  if (name === 'NotSupportedError' || name === 'TypeError') return '이 브라우저는 화면 캡처를 지원하지 않아요. 캡처 프로그램으로 찍어 붙여 넣어 주세요.'
  return '화면을 캡처하지 못했어요. 다시 시도하거나 캡처 프로그램으로 찍어 붙여 넣어 주세요.'
}

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export interface TabStream {
  /** Takes one PNG frame of what the tab shows right now. */
  grab: () => Promise<Blob>
  /** Ends sharing; safe to call more than once. */
  stop: () => void
  /** Called if the teacher stops sharing from the browser's own bar. */
  onEnded: (handler: () => void) => void
}

/**
 * Asks the browser to share this tab (Chrome/Edge preselect it via preferCurrentTab; other
 * browsers show their picker) and keeps the stream open so the teacher can drag a region on
 * the live page; `grab` then takes the frame and the caller stops the stream at once.
 */
export async function openTabStream(): Promise<TabStream> {
  const options = {
    video: { displaySurface: 'browser', frameRate: 30 },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    surfaceSwitching: 'exclude',
    monitorTypeSurfaces: 'exclude',
  } as DisplayMediaStreamOptions
  const stream = await navigator.mediaDevices.getDisplayMedia(options)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = stream
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    for (const track of stream.getTracks()) track.stop()
    video.srcObject = null
  }
  try { await video.play() } catch (error) { stop(); throw error }
  return {
    stop,
    onEnded: handler => stream.getVideoTracks()[0]?.addEventListener('ended', handler, { once: true }),
    async grab() {
      // Let the page repaint without the selection overlay and a fresh frame arrive.
      await nextFrame(); await nextFrame(); await wait(250)
      const width = video.videoWidth, height = video.videoHeight
      if (!width || !height) throw new Error('empty-frame')
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d')!.drawImage(video, 0, 0, width, height)
      return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('encode-failed')), 'image/png'))
    },
  }
}

/** Maps a region dragged on the viewport (CSS px) to pixels of the captured tab frame. */
export function viewportRegionToFrame(rect: CropRect, viewport: Size, frame: Size): CropRect {
  return cropToSource(rect, viewport, frame)
}

/** Crops `blob` to `rect` (source pixels); returns the original when no crop is given. */
export async function cropImageBlob(blob: Blob, rect: CropRect | null): Promise<Blob> {
  if (!rect) return blob
  const bitmap = await createImageBitmap(blob)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = rect.width
    canvas.height = rect.height
    canvas.getContext('2d')!.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(out => out ? resolve(out) : reject(new Error('encode-failed')), 'image/png'))
  } finally { bitmap.close() }
}
