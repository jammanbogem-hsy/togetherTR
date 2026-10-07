import { isInternalArtifactKey } from './internalKeys'
const ANALYSIS_COLUMNS = [
  'gradeBand', 'subject', 'coreIdea', 'standard',
  'knowledgeUnderstanding', 'processFunction', 'valueAttitude',
] as const

const ANALYSIS_LABELS: Record<string, string> = {
  gradeBand: '학년군', subject: '교과', coreIdea: '핵심 아이디어',
  standard: '성취기준 코드+원문', knowledgeUnderstanding: '지식·이해',
  processFunction: '과정·기능', valueAttitude: '가치·태도',
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** 프롬프트에 산출물 원문과 표 행을 전달한다. 내부 메타 키는 제외한다. */
export function serializeArtifactForPrompt(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) {
    if (!value.length) return ''
    const objectRows = value.filter(isRecord)
    if (objectRows.length) {
      const keys = [...new Set(objectRows.flatMap(row => Object.keys(row).filter(key => !key.startsWith('_'))))]
      const isAnalysis = keys.includes('standard') && keys.includes('subject')
      const columns = isAnalysis
        ? [...ANALYSIS_COLUMNS.filter(key => keys.includes(key)), ...keys.filter(key => !(ANALYSIS_COLUMNS as readonly string[]).includes(key))]
        : keys
      const header = columns.map(key => isAnalysis ? (ANALYSIS_LABELS[key] ?? key) : key).join(' | ')
      const rows = value.map(row => isRecord(row)
        ? columns.map(key => serializeArtifactForPrompt(row[key])).join(' | ')
        : serializeArtifactForPrompt(row))
      return [header, ...rows].join('\n')
    }
    return value.map(serializeArtifactForPrompt).join('\n')
  }
  if (isRecord(value)) {
    return Object.entries(value)
      .filter(([key]) => !isInternalArtifactKey(key))
      .map(([key, item]) => {
        const text = serializeArtifactForPrompt(item)
        return Array.isArray(item) || isRecord(item) ? `${key}:\n${text}` : `${key}: ${text}`
      })
      .join('\n')
  }
  return String(value)
}
