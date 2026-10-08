'use client'

import { useEffect, useRef } from 'react'
import { ArrowRight, BookOpen, ChatCircle, FileText, Lightbulb, Stack, Trash } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

interface Command {
  id: string
  label: string
  desc: string
  keywords: readonly string[]
}
const ICONS = { 'team-chat': ChatCircle, artifact: FileText, standards: BookOpen, coreidea: Lightbulb, briefing: Stack, 'reset-chat': Trash, next: ArrowRight }

export function SlashCommandPalette<T extends Command>({ commands, selectedIndex, onSelectIndex, onExecute, hasReply }: {
  commands: readonly T[]
  selectedIndex: number
  onSelectIndex: (index: number) => void
  onExecute: (id: T['id']) => void
  hasReply: boolean
}) {
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])
  return (
    <section aria-label="커맨드" className="mb-3 overflow-hidden rounded-[24px] border border-[#C4C7C5] bg-[#F0F4F9] text-[#1F1F1F] shadow-[0_4px_12px_rgba(31,31,31,0.14)]">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <span className="text-sm font-semibold text-[#444746]">커맨드</span>
        {hasReply && <span className="rounded-full bg-[#D3E3FD] px-3 py-1 text-sm font-medium text-[#0842A0]">선택된 메시지에 적용</span>}
      </div>
      <div ref={listRef} className="max-h-[min(45dvh,400px)] overflow-y-auto overscroll-contain px-2 pb-2">
        {commands.map((cmd, index) => {
          const Icon = ICONS[cmd.id as keyof typeof ICONS] ?? FileText
          const destructive = cmd.id === 'reset-chat'
          const selected = index === selectedIndex
          return <button
            key={cmd.id} type="button" data-selected={selected}
            className={cn('flex min-h-16 w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#0B57D0]',
              selected ? destructive ? 'bg-[#FADCD9] text-[#8C1D18]' : 'bg-[#D3E3FD] text-[#0842A0]' : destructive ? 'text-[#8C1D18] hover:bg-[#FBE9E7]' : 'hover:bg-[#E1E9F3]')}
            onMouseDown={event => event.preventDefault()}
            onClick={() => onExecute(cmd.id)}
            onMouseEnter={() => onSelectIndex(index)}
          >
            <Icon size={22} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="text-base font-semibold">{cmd.label}</span>
                <span className={cn('rounded-lg px-2 py-0.5 text-sm font-medium', selected ? destructive ? 'bg-white/60 text-[#8C1D18]' : 'bg-white/60 text-[#0842A0]' : 'bg-white/70 text-[#444746]')}>/{cmd.keywords[0]}</span>
              </span>
              <span className="mt-1 block text-sm leading-relaxed text-[#444746]">{cmd.desc}</span>
            </span>
          </button>
        })}
      </div>
      <p className="border-t border-[#C4C7C5] px-4 py-2.5 text-xs text-[#444746]">↑↓ 이동 · Enter 실행 · Esc 닫기</p>
    </section>
  )
}
