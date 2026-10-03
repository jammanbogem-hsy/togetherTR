'use client'

import { Component, type ReactNode } from 'react'
import { WarningCircleIcon as WarningCircle, ArrowClockwiseIcon as ArrowClockwise } from '@phosphor-icons/react'
import { MD3Button, MD3_ICON } from '@/components/ui/MD3Button'

// The workshop is a lazily loaded full-screen overlay. Without a boundary, a
// render error or a failed chunk load (e.g. the dev server restarted, or a new
// deploy replaced the chunk) bubbles to Next's default "This page couldn't
// load" screen and takes the whole project page down with it.
export class WorkshopErrorBoundary extends Component<
  { onClose: () => void; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('[문제상황 워크숍] 렌더링 오류:', error)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    // A failed dynamic import stays cached as rejected, so only a reload fetches the chunk again.
    const isChunkError = /Loading chunk|ChunkLoadError|Failed to fetch dynamically imported module|importing a module script failed/i.test(`${error.name} ${error.message}`)
    return (
      <div className="m3-shell fixed inset-0 z-50 flex items-center justify-center bg-[var(--md-sys-surface-container-low)] p-4">
        <section role="alert" className="w-full max-w-md rounded-[var(--md-sys-radius-xl)] bg-[var(--md-sys-surface-container-lowest)] p-8 text-center shadow-[0_1px_3px_rgba(0,0,0,0.12)]">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--md-sys-error-container)] text-[var(--md-sys-on-error-container)]">
            <WarningCircle size={26} weight="fill" />
          </span>
          <h2 className="text-[20px] font-medium text-[var(--md-sys-on-surface)]">문제상황 워크숍을 열지 못했습니다</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--md-sys-on-surface-variant)]">
            {isChunkError
              ? '화면 파일을 불러오지 못했습니다. 페이지를 새로고침하면 다시 열 수 있습니다. 저장된 내용은 그대로 남아 있습니다.'
              : '일시적인 오류가 발생했습니다. 저장된 내용은 그대로 남아 있습니다.'}
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <MD3Button variant="outlined" tone="neutral" onClick={() => { this.setState({ error: null }); this.props.onClose() }}>
              닫기
            </MD3Button>
            <MD3Button
              variant="filled"
              tone="blue"
              icon={<ArrowClockwise size={MD3_ICON.sm} weight="bold" />}
              onClick={() => (isChunkError ? window.location.reload() : this.setState({ error: null }))}
            >
              {isChunkError ? '새로고침' : '다시 시도'}
            </MD3Button>
          </div>
        </section>
      </div>
    )
  }
}
