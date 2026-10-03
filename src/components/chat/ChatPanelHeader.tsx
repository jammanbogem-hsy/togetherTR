'use client'

import type { ReactNode } from 'react'
import { Shield, Star } from '@phosphor-icons/react'
import { ACTIVITY_META, type ActivityCode } from '@/types'
import { ChatFontScaleControl } from '@/components/accessibility/FontScaleControl'
import { cn } from '@/lib/utils'

export function ChatPanelHeader({ activity, teamMode = false, extraTopSpace = false, children }: {
  activity: ActivityCode
  teamMode?: boolean
  extraTopSpace?: boolean
  children?: ReactNode
}) {
  const meta = ACTIVITY_META[activity]
  // 헤더 안내 말풍선은 이 층 안에 두어 모달·오버레이(z-40 이상) 위로 올라가지 않게 한다.
  return <div className={cn('relative isolate z-20 px-4 border-b flex items-center gap-2 flex-shrink-0', extraTopSpace ? 'pt-12 pb-3' : 'py-3', teamMode ? 'bg-[#E0F2F1] border-[#80CBC4]' : 'bg-white border-[#DADCE0]')}>
    <div className={cn('w-2 h-2 rounded-full flex-shrink-0', teamMode ? 'bg-[#00897B]' : 'bg-[#34A853]')} />
    <span className="text-[15px] font-semibold text-[#202124] truncate min-w-0">{meta.label}</span>
    {meta.isGuardrailSource && <span className="flex items-center gap-1 text-[10px] bg-[#F3E5F5] text-[#7B1FA2] px-1.5 py-0.5 rounded-full"><Shield size={11} weight="fill" /> 가드레일 소스</span>}
    {meta.isBackwardDesignFirst && <span className="flex items-center gap-1 text-[10px] bg-[#FFF3E0] text-[#E65100] px-1.5 py-0.5 rounded-full"><Star size={11} weight="fill" /> 평가 먼저</span>}
    <div className="ml-auto flex items-center gap-2 flex-shrink-0"><ChatFontScaleControl />{children}</div>
  </div>
}
