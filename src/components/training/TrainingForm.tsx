'use client'

import { useRef, useState } from 'react'
import { Timestamp } from 'firebase/firestore'
import { ACTIVITY_META, displayActivityCode, type ActivityCode, type ArtifactStatus, type Project } from '@/types'
import { formatTrainingSaveNotice, isTrainingActivity, isTrainingQuiet, isTrainingSystemText, requestTrainingChatSend } from '@/lib/training/trainingMode'
import { proposeArtifactToHost, setProjectArtifact } from '@/lib/firebase/projects'
import { useProjectStore } from '@/store/project'
import { artifactContentEquals } from '@/lib/chat/artifactSignalBatch'
import { getDemoActivityContract } from '@/lib/activity/demo-contracts'
import { MD3Button } from '@/components/ui/MD3Button'
import { trainingSaveAdviceSuffix } from './trainingFormState'
import { TRAINING_RECORD_KEY, buildTrainingRecordContent, createTrainingRecordDraft, syncTrainingRecordDraft, trainingRecordText } from '@/lib/training/trainingRecord'
import { useTrainingAdvice } from './useTrainingAdvice'
import { TrainingFieldInput } from './TrainingFieldInput'

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
  const messages = useProjectStore(state => state.messages)
  const quiet = isTrainingQuiet(messages, activityCode)
  const quietToken = quiet ? [...messages].reverse().find(message => message.role === 'user' && message.activityCode === activityCode && !isTrainingSystemText(message.content))?.id ?? 'quiet' : null
  const isHost = !!user && (project.hostUid === user.uid || project.createdBy === user.uid)
  const [storedAdvice, setStoredAdvice] = useTrainingAdvice(project.id)
  const [oneSaveAdvice, setOneSaveAdvice] = useState<string | null>(null)
  const advice = quiet ? oneSaveAdvice === quietToken : storedAdvice
  // 개입 금지 중의 체크는 그 저장 한 번만 허용한다. 프로젝트의 기본 선호는 바꾸지 않는다.
  function setAdvice(enabled: boolean) {
    if (quiet) setOneSaveAdvice(enabled ? quietToken : null)
    else setStoredAdvice(enabled)
  }
  const sourceKey = JSON.stringify(content)
  const [draft, setDraft] = useState(() => createTrainingRecordDraft(activityCode, content))
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  // AI/팀 저장은 바로 불러오되 작성 중인 전체 글은 보존한다.
  if (draft.sourceKey !== sourceKey) {
    setDraft(syncTrainingRecordDraft(draft, activityCode, content))
    setError('')
    setFeedback('')
  }

  const steps = getDemoActivityContract(activityCode).steps

  async function save() {
    if (savingRef.current || readOnly || !user) return
    const latest = useProjectStore.getState()
    if (latest.project?.id !== project.id || latest.viewingActivity !== activityCode
      || !isTrainingActivity(latest.project, activityCode)) return
    const host = latest.project.hostUid === user.uid || latest.project.createdBy === user.uid
    savingRef.current = true
    setSaving(true)
    setError('')
    setFeedback('')
    try {
      const prior = latest.project.artifacts?.[activityCode]
      const savedContent = buildTrainingRecordContent(activityCode, content, draft.text)
      if (!trainingRecordText(activityCode, savedContent).trim()) {
        setError('저장할 기록을 입력해 주세요.')
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
        setFeedback('저장했습니다. 기록은 팀과 공유됩니다.')
        if (current.project?.id === project.id && current.currentActivity === activityCode) {
          requestTrainingChatSend(formatTrainingSaveNotice(activityCode) + trainingSaveAdviceSuffix(quiet, advice))
        }
        setOneSaveAdvice(null)
      } else {
        const sections = { [TRAINING_RECORD_KEY]: draft.text.trim() }
        await proposeArtifactToHost(project.id, activityCode, sections, user.uid, user.displayName)
        setFeedback('기록 담당에게 저장을 제안했습니다. 기록 담당이 수락하면 팀 산출물에 반영됩니다.')
      }
      setDraft(previous => ({ ...previous, sourceText: draft.text, conflict: false }))
    } catch {
      setError('저장하지 못했습니다. 입력한 내용은 그대로입니다. 다시 시도해 주세요.')
    } finally { savingRef.current = false; setSaving(false) }
  }

  return (
    <section className="min-w-0 space-y-4" aria-label="연수용 산출물 입력 양식">
      <div>
        <h3 className="text-base font-semibold text-[#202124]">{displayActivityCode(activityCode)} {ACTIVITY_META[activityCode].label}</h3>
        <p className="mt-1 text-sm leading-relaxed text-[#5F6368]">토의한 내용과 결정한 내용을 한곳에 자유롭게 적고 저장하세요.</p>
      </div>
      {draft.conflict && <div role="status" className="space-y-2 rounded-xl bg-[#E8F0FE] p-3 text-sm text-[#0842A0]">
        <p>저장된 내용이 바뀌었습니다. 작성 중인 글은 유지했습니다.</p>
        <MD3Button type="button" size="sm" variant="outlined" disabled={saving || readOnly || !user}
          onClick={() => { setDraft(previous => ({ ...previous, text: previous.sourceText, conflict: false })); setError(''); setFeedback('저장된 내용을 불러왔습니다.') }}>저장된 내용 불러오기</MD3Button>
      </div>}
      <form onSubmit={event => { event.preventDefault(); void save() }} className="space-y-4">
        <fieldset disabled={saving || readOnly || !user} className="min-w-0 space-y-4">
          <label htmlFor={`training-${activityCode}-record`} className="block text-sm font-medium text-[#202124]">활동 기록</label>
          <TrainingFieldInput id={`training-${activityCode}-record`} label="활동 기록"
            value={draft.text} placeholder="토의한 내용, 결정한 내용, 메모를 여기에 함께 적어 주세요."
            onChange={text => { setFeedback(''); setError(''); setDraft(previous => ({ ...previous, text, conflict: text === previous.sourceText ? false : previous.conflict })) }} />
        </fieldset>
        {isHost && (
          <div className="space-y-1">
            <label className="flex items-start gap-2 text-sm text-[#3C4043]">
              <input type="checkbox" checked={advice} onChange={event => setAdvice(event.target.checked)} disabled={saving || readOnly} className="mt-1 size-4 shrink-0 accent-[#0B57D0]" />저장하면 AI 조언 받기
            </label>
            {quiet && <p role="status" className="text-xs leading-relaxed text-[#5F6368]">{advice ? '개입 금지 요청 중 — 이번 저장 1회만 조언을 받아요.' : '개입 금지 요청 중 — 조언하지 않아요'}</p>}
          </div>
        )}
        {error && <p role="alert" className="text-sm text-[#C5221F]">{error}</p>}
        {feedback && <p role="status" className="text-sm text-[#137333]">{feedback}</p>}
        <MD3Button type="submit" size="sm" disabled={saving || readOnly || !user}>{saving ? '저장 중…' : isHost ? '산출물에 저장' : '기록 담당에게 저장 제안'}</MD3Button>
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
