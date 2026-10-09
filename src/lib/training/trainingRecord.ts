import type { ActivityCode } from '@/types'
import { TRAINING_ACTIVITIES } from './trainingMode'
import { STRUCTURED_FIELDS, trainingFormValues } from '@/components/training/trainingFormState'
import { trainingFieldLabel, trainingFormText } from '@/components/training/trainingFormText'

export const TRAINING_RECORD_KEY = '연수 기록'
const isBodyKey = (key: string) => !key.startsWith('_') && !['id', 'manualWorkspace', 'isCommon', 'isCenter', 'groupWithPrevious'].includes(key)

/** 기존 섹션과 구조화 산출물을 빠짐없이 한 문서로 보여 준다. 내부 메타데이터는 제외한다. */
function recordSections(code: ActivityCode, content: Record<string, unknown>): [string, string][] {
  const values = trainingFormValues(code, content)
  const consumed = new Set([TRAINING_RECORD_KEY, ...TRAINING_ACTIVITIES[code].fields.map(field => field.key),
    ...Object.values(STRUCTURED_FIELDS[code] ?? {}).flat()])
  const sections: [string, string][] = TRAINING_ACTIVITIES[code].fields
    .filter(field => values[field.key].trim()).map(field => [field.key, values[field.key]])
  for (const [key, value] of Object.entries(content)) {
    if (consumed.has(key) || !isBodyKey(key)) continue
    const text = trainingFormText(value, code)
    if (text.trim()) sections.push([trainingFieldLabel(code, key), text])
  }
  return sections
}

export function trainingRecordText(code: ActivityCode, content: Record<string, unknown>): string {
  const prose = trainingFormText(content[TRAINING_RECORD_KEY], code)
  return [prose, ...recordSections(code, content).map(([label, text]) => `## ${label}\n${text}`)]
    .filter(text => text.trim()).join('\n\n')
}

/** 제목을 유지한 기존 기록은 섹션 키도 유지한다. 자유롭게 쓴 글은 하나의 연수 기록으로 저장한다. */
export function buildTrainingRecordContent(code: ActivityCode, previous: Record<string, unknown>, text: string): Record<string, unknown> {
  if (text === trainingRecordText(code, previous)) return { ...previous }
  const result: Record<string, unknown> = {}
  // 편집 이전 본문/스키마가 새 글을 가리거나 삭제한 내용을 되살리지 않게 한다.
  for (const [key, value] of Object.entries(previous)) {
    if (!isBodyKey(key) && key !== '_schema') result[key] = value
  }
  const labels = new Set([...TRAINING_ACTIVITIES[code].fields.map(field => field.key),
    ...recordSections(code, previous).map(([label]) => label)])
  let key = TRAINING_RECORD_KEY
  let lines: string[] = []
  let fence: string | null = null
  const flush = () => {
    const value = lines.join('\n').trim()
    if (value) result[key] = result[key] ? `${result[key]}\n\n${value}` : value
    lines = []
  }
  for (const line of text.split('\n')) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null
      lines.push(line)
      continue
    }
    const heading = !fence && line.match(/^## ([^\n]+)\s*$/)
    if (heading && labels.has(heading[1].trim())) { flush(); key = heading[1].trim() }
    else lines.push(line)
  }
  flush()
  return result
}

/** 전체 기록 저장은 이전 본문을 교체하고, 기존 AI의 개별 섹션 갱신은 해당 부분만 합친다. */
export function mergeTrainingRecordUpdate(code: ActivityCode, base: Record<string, unknown>, update: Record<string, unknown>): Record<string, unknown> {
  if (typeof update[TRAINING_RECORD_KEY] !== 'string') return { ...base, ...update }
  const { [TRAINING_RECORD_KEY]: text, ...sections } = update
  return { ...buildTrainingRecordContent(code, base, text as string), ...sections }
}

export interface TrainingRecordDraft {
  sourceKey: string
  sourceText: string
  text: string
  conflict: boolean
}
export function createTrainingRecordDraft(code: ActivityCode, content: Record<string, unknown>): TrainingRecordDraft {
  const text = trainingRecordText(code, content)
  return { sourceKey: JSON.stringify(content), sourceText: text, text, conflict: false }
}
export function syncTrainingRecordDraft(draft: TrainingRecordDraft, code: ActivityCode, content: Record<string, unknown>): TrainingRecordDraft {
  const incoming = createTrainingRecordDraft(code, content)
  if (draft.text !== draft.sourceText && draft.text !== incoming.text) {
    incoming.text = draft.text
    incoming.conflict = draft.conflict || incoming.sourceText !== draft.sourceText
  }
  return incoming
}
