'use client'

import { useState } from 'react'
import { STAGES, ACTIVITY_META, type ActivityCode, type StageCode } from '@/types'
import { returnToActivity } from '@/lib/firebase/projects'
import { cn } from '@/lib/utils'

const STAGE_COLOR: Record<StageCode, { bg: string; text: string; light: string }> = {
  T:  { bg: '#1A73E8', text: '#1A73E8', light: '#E8F0FE' },
  A:  { bg: '#7B1FA2', text: '#7B1FA2', light: '#F3E5F5' },
  Ds: { bg: '#00897B', text: '#00897B', light: '#E0F2F1' },
  DI: { bg: '#E65100', text: '#E65100', light: '#FBE9E7' },
  E:  { bg: '#C62828', text: '#C62828', light: '#FFEBEE' },
}

interface Props {
  projectId: string
  currentActivity: ActivityCode
}

export function DevJumpPanel({ projectId, currentActivity }: Props) {
  const [open, setOpen] = useState(false)
  const [jumping, setJumping] = useState<ActivityCode | null>(null)

  async function handleJump(code: ActivityCode) {
    if (jumping) return
    setJumping(code)
    const stage = ACTIVITY_META[code].stage as StageCode
    await returnToActivity(projectId, code, stage).catch(console.error)
    setJumping(null)
    setOpen(false)
  }

  return (
    <>
      {/* 플로팅 버튼 */}
      <button
        onClick={() => setOpen(v => !v)}
        title="개발자 — 활동 빠른 이동"
        className={cn(
          'fixed bottom-5 left-1/2 -translate-x-1/2 z-50',
          'flex items-center gap-1.5 px-4 py-2 rounded-full text-[12px] font-bold shadow-lg transition-all',
          open
            ? 'bg-[#202124] text-white'
            : 'bg-white/90 text-[#5F6368] border border-[#DADCE0] hover:border-[#1A73E8] hover:text-[#1A73E8]',
        )}
        style={{ backdropFilter: 'blur(8px)' }}
      >
        <span>⚡</span>
        <span>{open ? '닫기' : '활동 빠른 이동 (DEV)'}</span>
      </button>

      {/* 패널 */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="fixed bottom-16 left-1/2 -translate-x-1/2 z-50 bg-white rounded-2xl overflow-hidden"
            style={{
              width: 'min(860px, calc(100vw - 32px))',
              boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
              border: '1.5px solid #E8EAED',
            }}
          >
            <div className="px-5 py-3.5 border-b border-[#F1F3F4] flex items-center justify-between bg-[#F8F9FA]">
              <div>
                <p className="text-[13px] font-extrabold text-[#202124]">⚡ 활동 빠른 이동 (개발 전용)</p>
                <p className="text-[11px] text-[#9AA0A6] mt-0.5">클릭하면 해당 활동으로 즉시 이동합니다 — 팀 전체에 동기화됩니다</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-[#9AA0A6] hover:text-[#5F6368] text-lg leading-none px-1"
              >×</button>
            </div>

            <div className="p-4 flex gap-3 overflow-x-auto">
              {STAGES.map(stage => {
                const color = STAGE_COLOR[stage.code as StageCode]
                return (
                  <div key={stage.code} className="flex-shrink-0 w-[152px]">
                    {/* 단계 헤더 */}
                    <div
                      className="rounded-xl px-3 py-2 mb-2 flex items-center gap-2"
                      style={{ backgroundColor: color.light }}
                    >
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold text-white flex-shrink-0"
                        style={{ backgroundColor: color.bg }}
                      >
                        {stage.code}
                      </div>
                      <span className="text-[12px] font-bold" style={{ color: color.text }}>
                        {stage.label}
                      </span>
                    </div>

                    {/* 활동 목록 */}
                    <div className="space-y-1.5">
                      {stage.activities.map(code => {
                        const meta = ACTIVITY_META[code]
                        const isActive = code === currentActivity
                        const isJumping = jumping === code
                        return (
                          <button
                            key={code}
                            onClick={() => handleJump(code)}
                            disabled={isJumping || isActive}
                            className={cn(
                              'w-full text-left rounded-xl px-3 py-2.5 transition-all',
                              'text-[11px] leading-snug',
                              isActive
                                ? 'font-extrabold cursor-default'
                                : 'font-medium hover:scale-[1.02] active:scale-100',
                              isJumping && 'opacity-60',
                            )}
                            style={
                              isActive
                                ? { backgroundColor: color.bg, color: '#fff' }
                                : { backgroundColor: color.light, color: color.text }
                            }
                          >
                            <span className="block opacity-60 text-[10px] mb-0.5">{code}</span>
                            <span className="block">{isJumping ? '이동 중...' : meta.label}</span>
                            {isActive && <span className="block mt-0.5 text-[9px] opacity-80">현재 위치</span>}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </>
  )
}
