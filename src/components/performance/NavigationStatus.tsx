'use client'
import { useProjectStore } from '@/store/project'

export function NavigationStatus() {
  const error = useProjectStore(state => state.navigationError)
  if (!error) return null
  return <div role="alert" className="fixed bottom-4 left-1/2 z-[100] flex max-w-xl -translate-x-1/2 items-center gap-3 rounded-xl border border-[#F28B82] bg-[#FCE8E6] px-4 py-3 text-sm text-[#A50E0E] shadow-lg">
    <span>{error}</span><button type="button" aria-label="이동 오류 안내 닫기" onClick={() => useProjectStore.setState({ navigationError: null })}>닫기</button>
  </div>
}
