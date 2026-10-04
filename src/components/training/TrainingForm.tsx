'use client'

import { useState } from 'react'
import { Timestamp } from 'firebase/firestore'
import { ACTIVITY_META, displayActivityCode, type ActivityCode, type ArtifactStatus, type Project } from '@/types'
import { TRAINING_ACTIVITIES, formatTrainingSaveNotice, isTrainingActivity, requestTrainingChatSend, trainingStatus } from '@/lib/training/trainingMode'
import { proposeArtifactToHost, setProjectArtifact } from '@/lib/firebase/projects'
import { useProjectStore } from '@/store/project'
import { artifactContentEquals } from '@/lib/chat/artifactSignalBatch'
import { getDemoActivityContract } from '@/lib/activity/demo-contracts'
import { MD3Button } from '@/components/ui/MD3Button'
import { buildTrainingFormContent, trainingFormValues } from './trainingFormState'
import { useTrainingAdvice } from './useTrainingAdvice'

export function TrainingForm({ project, activityCode, content, loaded, readOnly = false }: {
  project: Project
  activityCode: ActivityCode
  content: Record<string, unknown>
  loaded: boolean
  readOnly?: boolean
}) {
  if (!isTrainingActivity(project, activityCode)) return null
  if (!loaded) return <div role="status" className="p-4 text-sm text-[#5F6368]">산출물을 불러오는 중…<button type="button" disabled className="sr-only">저장</button></div>
  return <TrainingFormEditor key={`${project.id}:${activityCode}`} project={project} activityCode={activityCode} content={content} readOnly={readOnly} />
}

function TrainingFormEditor({ project, activityCode, content, readOnly }: {
  project: Project; activityCode: ActivityCode; content: Record<string, unknown>; readOnly: boolean
}) {
  const user = useProjectStore(state => state.userProfile)
  const isHost = !!user && (project.hostUid === user.uid || project.createdBy === user.uid)
  const [advice, setAdvice] = useTrainingAdvice(project.id)
  const sourceKey = JSON.stringify(content)
  const [draft, setDraft] = useState(() => ({ sourceKey, values: trainingFormValues(activityCode, content), dirty: {} as Record<string, boolean> }))
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  // 실시간 갱신은 손대지 않은 칸만 반영한다. 이미 적는 중인 칸은 보존한다.
  if (draft.sourceKey !== sourceKey) {
    const incoming = trainingFormValues(activityCode, content)
    setDraft({ ...draft, sourceKey, values: Object.fromEntries(Object.entries(incoming).map(([key, value]) => [key, draft.dirty[key] ? draft.values[key] : value])) })
  }

  const def = TRAINING_ACTIVITIES[activityCode]
  const status = trainingStatus(activityCode, draft.values)
  const steps = getDemoActivityContract(activityCode).steps

  async function save() {
    if (saving || readOnly || !user) return
    const latest = useProjectStore.getState()
    if (latest.project?.id !== project.id || latest.viewingActivity !== activityCode
      || !isTrainingActivity(latest.project, activityCode)) return
    const host = latest.project.hostUid === user.uid || latest.project.createdBy === user.uid
    setSaving(true)
    setError('')
    setFeedback('')
    try {
      const prior = latest.project.artifacts?.[activityCode]
      const savedContent = buildTrainingFormContent(activityCode, (prior?.content ?? content) as Record<string, unknown>, draft.values)
      if (!Object.keys(savedContent).some(key => !key.startsWith('_') && key !== 'manualWorkspace' && String(savedContent[key] ?? '').trim())) {
        setError('저장할 내용을 한 칸 이상 입력해 주세요.')
        return
      }
      if (host) {
        const unchanged = !!prior && artifactContentEquals(prior.content, savedContent)
        const title = prior?.title ?? `${ACTIVITY_META[activityCode].label} 산출물`
        const version = unchanged ? prior.version : (prior?.version ?? 0) + 1
        const artifactStatus: ArtifactStatus = unchanged ? prior.status as ArtifactStatus : 'in_review'
        if (!unchanged) await setProjectArtifact(project.id, activityCode, { title, content: savedContent, version, status: 'in_review' })
        const current = useProjectStore.getState()
        if (current.project?.id === project.id && current.viewingActivity === activityCode) {
          useProjectStore.getState().setCurrentArtifact({
            id: `${activityCode}-training`, activityCode, artifactType: ACTIVITY_META[activityCode].label,
            title, currentVersion: version, status: artifactStatus, aiDraft: savedContent,
            ...(artifactStatus === 'confirmed' ? { confirmedContent: savedContent } : {}),
            createdBy: user.uid,
            meta: { author: user.displayName, createdAt: Timestamp.now(), updatedAt: Timestamp.now(), evidence: '연수 양식', approvalStatus: 'pending' },
          })
        }
        setFeedback('저장했습니다. 채운 내용은 팀과 공유됩니다.')
        if (current.project?.id === project.id && current.currentActivity === activityCode) {
          requestTrainingChatSend(formatTrainingSaveNotice(activityCode) + (advice ? ' 조언해 주세요' : ' 조언은 필요 없어요'))
        }
      } else {
        const sections = Object.fromEntries(Object.entries(draft.values).filter(([, text]) => text.trim()).map(([key, text]) => [key, text.trim()]))
        if (!Object.keys(sections).length) { setError('제안할 내용을 한 칸 이상 입력해 주세요.'); return }
        await proposeArtifactToHost(project.id, activityCode, sections, user.uid, user.displayName)
        setFeedback('방장에게 저장을 제안했습니다. 방장이 수락하면 팀 산출물에 반영됩니다.')
      }
      setDraft(previous => ({ ...previous, dirty: {} }))
    } catch {
      setError('저장하지 못했습니다. 입력한 내용은 그대로입니다. 다시 시도해 주세요.')
    } finally { setSaving(false) }
  }

  return (
    <section className="min-w-0 space-y-4" aria-label="연수용 산출물 입력 양식">
      <div>
        <h3 className="text-base font-semibold text-[#202124]">{displayActivityCode(activityCode)} {ACTIVITY_META[activityCode].label}</h3>
        <p className="mt-1 text-sm leading-relaxed text-[#5F6368]">오프라인에서 정리한 내용을 옮겨 적으세요. 선택 칸은 비워도 됩니다.</p>
      </div>
      <form onSubmit={event => { event.preventDefault(); void save() }} className="space-y-4">
        <fieldset disabled={saving || readOnly || !user} className="min-w-0 space-y-4">
          {def.fields.map(field => (
            <label key={field.key} className="block min-w-0">
              <span className="mb-2 flex flex-wrap items-center gap-2 text-sm font-medium text-[#202124]">
                {field.label}
                <span className={`rounded-full px-2 py-0.5 text-xs ${field.tier === 'A' ? 'bg-[#D3E3FD] text-[#0842A0]' : 'bg-[#F1F3F4] text-[#5F6368]'}`}>{field.tier === 'A' ? '필수' : '선택'}</span>
              </span>
              <textarea value={draft.values[field.key] ?? ''} rows={4} placeholder={field.placeholder ?? '정리한 내용을 적어 주세요.'}
                onChange={event => { const value = event.target.value; setFeedback(''); setDraft(previous => ({ ...previous, values: { ...previous.values, [field.key]: value }, dirty: { ...previous.dirty, [field.key]: true } })) }}
                className="block w-full min-w-0 resize-y rounded-xl border border-[#C4C7C5] bg-white px-3 py-3 text-sm leading-relaxed text-[#202124] focus:border-[#0B57D0] focus:outline-none focus:ring-2 focus:ring-[#D3E3FD] disabled:bg-[#F8F9FA]" />
              {field.reason && <span className="mt-1 block text-xs leading-relaxed text-[#5F6368]">{field.reason}</span>}
            </label>
          ))}
        </fieldset>
        {status.missingRequired.length > 0 && <p className="text-xs leading-relaxed text-[#8A3D00]">아직 비어 있는 필수 칸: {status.missingRequired.map(field => field.label).join(' · ')}</p>}
        {isHost && (
          <label className="flex items-start gap-2 text-sm text-[#3C4043]">
            <input type="checkbox" checked={advice} onChange={event => setAdvice(event.target.checked)} disabled={saving || readOnly} className="mt-1 size-4 shrink-0 accent-[#0B57D0]" />저장하면 AI 조언 받기
          </label>
        )}
        {error && <p role="alert" className="text-sm text-[#C5221F]">{error}</p>}
        {feedback && <p role="status" className="text-sm text-[#137333]">{feedback}</p>}
        <MD3Button type="submit" size="sm" disabled={saving || readOnly || !user}>{saving ? '저장 중…' : isHost ? '산출물에 저장' : '방장에게 저장 제안'}</MD3Button>
      </form>
      <details className="border-t border-[#DADCE0] pt-3 text-sm text-[#5F6368]">
        <summary className="cursor-pointer font-medium">정식 진행 스텝 보기</summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5">
          {steps.map(step => <li key={step.id} className="leading-relaxed">{step.title}</li>)}
        </ol>
      </details>
    </section>
  )
}
