'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Pencil, X } from 'lucide-react'
import type { Project } from '@/types'
import { MD3Button } from '@/components/ui/MD3Button'
import { PROJECT_GRADES, PROJECT_SUBJECTS, projectInfoInput, type ProjectInfoInput } from '@/lib/projects/projectInfo'

export function ProjectInfoDialog({ project, onClose, onSave }: {
  project: Project; onClose: () => void; onSave: (input: ProjectInfoInput) => Promise<void>
}) {
  const [input, setInput] = useState(() => projectInfoInput(project))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => { element?.close() }
  }, [])
  async function save() {
    if (inFlight.current) return
    inFlight.current = true; setSaving(true); setError('')
    try { await onSave(input); onClose() }
    catch (error) { setError(error instanceof Error ? error.message : '저장하지 못했습니다. 다시 시도해 주세요.') }
    finally { inFlight.current = false; setSaving(false) }
  }
  const subjects = [...new Set([...PROJECT_SUBJECTS[project.schoolLevel], ...project.targetSubjects])]
  return createPortal(<dialog ref={dialog} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); if (!inFlight.current) onClose() }}
    className="m-auto max-h-[90dvh] w-[calc(100vw-24px)] max-w-2xl overflow-hidden rounded-[28px] border-0 bg-[#F8FAFD] p-0 text-[#1F1F1F] shadow-2xl backdrop:bg-black/40">
    <form className="flex max-h-[90dvh] flex-col" onSubmit={event => { event.preventDefault(); void save() }}>
      <header className="flex items-center gap-3 px-5 py-5 sm:px-7">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#D3E3FD] text-[#0842A0]"><Pencil size={24} /></span>
        <div className="flex-1"><h2 id={titleId} className="text-[22px] font-semibold">프로젝트 정보 변경</h2><p className="mt-1 text-sm text-[#444746]">{project.schoolLevel} · 팀과 함께 사용할 정보를 수정하세요.</p></div>
        <button type="button" aria-label="프로젝트 정보 변경 닫기" disabled={saving} onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-[#E3E3E3]"><X size={24} /></button>
      </header>
      <fieldset disabled={saving} className="min-h-0 space-y-6 overflow-y-auto px-5 pb-6 sm:px-7 disabled:opacity-60">
        <label className="block text-base font-semibold">프로젝트명
          <input autoFocus required maxLength={100} value={input.title} onChange={e => setInput({ ...input, title: e.target.value })} className="mt-2 min-h-12 w-full rounded-xl border border-[#747775] bg-white px-4 py-3 text-base font-normal outline-[#0B57D0]" />
        </label>
        <fieldset><legend className="mb-2 text-base font-semibold">학년군{project.schoolLevel === '초등학교' && <span className="ml-2 text-sm font-normal text-[#444746]">여러 개 선택 가능</span>}</legend>
          <div className="flex flex-wrap gap-2">{PROJECT_GRADES[project.schoolLevel].map(grade => <label key={grade} className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border px-4 py-2 text-base ${input.gradeGroups.includes(grade) ? 'border-[#0B57D0] bg-[#D3E3FD] text-[#0842A0]' : 'border-[#747775] bg-white'}`}>
            <input type={project.schoolLevel === '초등학교' ? 'checkbox' : 'radio'} name="project-grades" checked={input.gradeGroups.includes(grade)} className="h-5 w-5 accent-[#0B57D0]"
              onChange={() => setInput(current => ({ ...current, gradeGroups: project.schoolLevel !== '초등학교' ? [grade] : current.gradeGroups.includes(grade) ? current.gradeGroups.filter(value => value !== grade) : [...current.gradeGroups, grade] }))} />
            {grade.replace(/^초/, '')}{grade.startsWith('초') ? '학년군' : ''}
          </label>)}</div>
        </fieldset>
        <fieldset><legend className="mb-2 text-base font-semibold">교과<span className="ml-2 text-sm font-normal text-[#444746]">여러 개 선택 가능</span></legend>
          <div className="flex flex-wrap gap-2">{subjects.map(subject => <label key={subject} className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-base ${input.targetSubjects.includes(subject) ? 'border-[#0B57D0] bg-[#D3E3FD] text-[#0842A0]' : 'border-[#747775] bg-white'}`}>
            <input type="checkbox" checked={input.targetSubjects.includes(subject)} className="h-5 w-5 accent-[#0B57D0]" onChange={() => setInput(current => ({ ...current, targetSubjects: current.targetSubjects.includes(subject) ? current.targetSubjects.filter(value => value !== subject) : [...current.targetSubjects, subject] }))} />{subject}
          </label>)}</div>
        </fieldset>
      </fieldset>
      <footer className="border-t border-[#C4C7C5] px-5 py-4 sm:px-7">
        {error && <p role="alert" className="mb-3 text-base text-[#B3261E]">{error}</p>}
        <div className="flex items-center justify-end gap-2"><span role="status" className="mr-auto text-sm text-[#444746]">{saving ? '변경 내용을 저장하고 있습니다.' : ''}</span>
          <MD3Button size="md" type="button" variant="text" disabled={saving} onClick={onClose}>취소</MD3Button>
          <MD3Button size="md" variant="filled" type="submit" disabled={saving || !input.title.trim() || !input.gradeGroups.length}>{saving ? '저장 중…' : '변경 저장'}</MD3Button>
        </div>
      </footer>
    </form>
  </dialog>, document.body)
}
