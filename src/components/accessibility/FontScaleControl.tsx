'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { Minus, Plus, Chat, TextAa } from '@phosphor-icons/react'

// 글자 크기 스케일. 1.0 = 기본. 시각적으로 의미 있는 간격으로 구성.
const SCALES = [0.85, 0.92, 1.0, 1.1, 1.2, 1.35, 1.5] as const
const DEFAULT_IDX = 2
const STORAGE_KEY = 'tcid:font-scale-idx'
const CHAT_STORAGE_KEY = 'tcid:chat-font-scale-idx'

function useScaleIdx(storageKey: string): [number, (updater: (idx: number) => number) => void, number, boolean] {
  const [idx, setIdxRaw] = useState(DEFAULT_IDX)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved !== null) {
        const n = parseInt(saved, 10)
        if (!Number.isNaN(n) && n >= 0 && n < SCALES.length) setIdxRaw(n)
      }
    } catch {}
    setMounted(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setIdx = (updater: (i: number) => number) => {
    setIdxRaw(prev => {
      const next = updater(prev)
      try { localStorage.setItem(storageKey, String(next)) } catch {}
      return next
    })
  }

  return [idx, setIdx, SCALES[idx], mounted]
}

function ScaleButtons({
  idx, setIdx, label, icon, titlePrefix,
}: {
  idx: number
  setIdx: (u: (i: number) => number) => void
  label: string
  icon?: ReactNode
  titlePrefix: string
}) {
  const pct = Math.round(SCALES[idx] * 100)
  const isMin = idx === 0
  const isMax = idx === SCALES.length - 1
  return (
    <div
      className="flex items-center gap-0.5 bg-white rounded-full border border-[#DADCE0] px-1 py-0.5 flex-shrink-0"
      role="group"
      aria-label={label}
    >
      {icon && (
        <span className="flex items-center justify-center w-6 h-7 text-[#9AA0A6]" aria-hidden="true">
          {icon}
        </span>
      )}
      <button
        type="button"
        onClick={() => setIdx(i => Math.max(0, i - 1))}
        disabled={isMin}
        title={`${titlePrefix} 작게`}
        aria-label={`${titlePrefix} 작게`}
        className="flex items-center justify-center w-7 h-7 rounded-full text-[#5F6368] hover:bg-[#F1F3F4] hover:text-[#1A73E8] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
      >
        <Minus size={13} weight="bold" />
      </button>
      <button
        type="button"
        onClick={() => setIdx(() => DEFAULT_IDX)}
        title={`${titlePrefix} 초기화 (현재 ${pct}%)`}
        aria-label={`현재 ${titlePrefix} ${pct}퍼센트. 초기화하려면 클릭`}
        className="flex items-center justify-center px-2.5 h-7 rounded-full text-[11px] font-bold text-[#5F6368] hover:bg-[#F1F3F4] hover:text-[#1A73E8] tabular-nums transition-colors min-w-[44px]"
      >
        {pct}%
      </button>
      <button
        type="button"
        onClick={() => setIdx(i => Math.min(SCALES.length - 1, i + 1))}
        disabled={isMax}
        title={`${titlePrefix} 크게`}
        aria-label={`${titlePrefix} 크게`}
        className="flex items-center justify-center w-7 h-7 rounded-full text-[#5F6368] hover:bg-[#F1F3F4] hover:text-[#1A73E8] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors"
      >
        <Plus size={13} weight="bold" />
      </button>
    </div>
  )
}

// 전역 글자 크기 — <html>.style.zoom으로 전체 UI 배율 조정 (Tailwind px 고정 크기도 스케일)
export function FontScaleControl() {
  const [idx, setIdx, scale, mounted] = useScaleIdx(STORAGE_KEY)

  useEffect(() => {
    if (!mounted) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(document.documentElement.style as any).zoom = String(scale)
  }, [scale, mounted])

  if (!mounted) return null
  return <ScaleButtons idx={idx} setIdx={setIdx} label="전체 글자 크기 조절" titlePrefix="전체 글자" icon={<TextAa size={13} weight="bold" />} />
}

// 채팅 전용 글자 크기 — 같은 탭 내 여러 소비자(Control 버튼 + 메시지 영역) 간 상태 공유 필요.
// useScaleIdx처럼 컴포넌트 각자 state를 쓰면 동기화 안 되므로 모듈 레벨 pub/sub 구조 사용.
const chatScaleListeners = new Set<(idx: number) => void>()
let currentChatIdx: number = DEFAULT_IDX
let chatIdxLoaded = false

function loadChatIdxOnce() {
  if (chatIdxLoaded) return
  chatIdxLoaded = true
  try {
    const saved = localStorage.getItem(CHAT_STORAGE_KEY)
    if (saved !== null) {
      const n = parseInt(saved, 10)
      if (!Number.isNaN(n) && n >= 0 && n < SCALES.length) currentChatIdx = n
    }
  } catch {}
}

function setSharedChatIdx(updater: (idx: number) => number) {
  const next = updater(currentChatIdx)
  if (next === currentChatIdx) return
  currentChatIdx = next
  try { localStorage.setItem(CHAT_STORAGE_KEY, String(next)) } catch {}
  chatScaleListeners.forEach(cb => cb(next))
}

function useSharedChatIdx(): [number, (updater: (idx: number) => number) => void, boolean] {
  const [idx, setIdxState] = useState(DEFAULT_IDX)
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    loadChatIdxOnce()
    setIdxState(currentChatIdx)
    setMounted(true)
    const cb = (n: number) => setIdxState(n)
    chatScaleListeners.add(cb)
    return () => { chatScaleListeners.delete(cb) }
  }, [])
  return [idx, setSharedChatIdx, mounted]
}

// 채팅 메시지 컨테이너에 적용할 scale 값 반환. 전역 zoom과 독립.
export function useChatFontScale(): number {
  const [idx, , mounted] = useSharedChatIdx()
  return mounted ? SCALES[idx] : 1
}

export function ChatFontScaleControl() {
  const [idx, setIdx, mounted] = useSharedChatIdx()
  if (!mounted) return null
  return <ScaleButtons idx={idx} setIdx={setIdx} label="채팅 글자 크기 조절" titlePrefix="채팅 글자" icon={<TextAa size={13} weight="bold" />} />
}
