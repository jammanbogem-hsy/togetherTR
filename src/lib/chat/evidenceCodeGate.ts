// 근거 성취기준 코드 저장 관문 — AI가 A-2-1 분석표·분석시트에 없는 코드를 지어내 저장하는 것을 막는다(#39).
// 프롬프트 금지 문구만으로는 막히지 않아, 저장 직전에 허용 목록 밖 코드를 '(근거: …)' 묶음에서만 뺀다.
import type { ArtifactUpdateItem } from './signals'

/** 근거 코드를 검사하는 활동·섹션. 다른 활동·섹션은 그대로 저장한다. */
export const EVIDENCE_GATED_SECTIONS: Readonly<Record<string, readonly string[]>> = {
  'Ds-1-1': ['평가 계획', '평가계획'],
  'Ds-1-3': ['학습 활동'],
}

/** 근거 표기를 프롬프트로 요구하는 활동 — 허용 코드 목록을 주입한다. */
export const EVIDENCE_PROMPT_ACTIVITIES: readonly string[] = ['Ds-1-1', 'Ds-1-3']

const EVIDENCE_GROUP_RE = /\(근거\s*:\s*([^()]*)\)/g
const CODE_RE = /\[(\d[가-힣]{1,3}\d{2}-\d{2})\]/g
const CODE_WITH_LEVEL = (code: string) =>
  new RegExp(`\\[${code.replace(/[-]/g, '\\-')}\\]\\s*(?:[ABC](?:\\s*[·/,~]\\s*[ABC])*(?![가-힣A-Za-z]))?`, 'g')
const NEEDS_CHECK = '(근거: 확인 필요)'

function tidyEvidence(inner: string): string {
  return inner
    .replace(/\s*([,·;/])\s*(?:[,·;/]\s*)+/g, '$1 ')
    .replace(/^[\s,·;/]+|[\s,·;/]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * '(근거: …)' 묶음 안에서 허용 목록 밖 코드(와 붙은 수준 글자)를 지운다. 묶음 밖 글은 건드리지 않는다.
 * 지운 뒤 묶음이 비면 '(근거: 확인 필요)'로 바꾼다.
 */
export function stripDisallowedEvidenceCodes(
  text: string,
  allowed: ReadonlySet<string>,
): { text: string; removed: string[] } {
  const removed: string[] = []
  const next = text.replace(EVIDENCE_GROUP_RE, (whole, inner: string) => {
    const codes = [...inner.matchAll(CODE_RE)].map(m => `[${m[1]}]`)
    const bad = codes.filter(code => !allowed.has(code))
    if (!bad.length) return whole
    let kept = inner
    for (const code of bad) {
      kept = kept.replace(CODE_WITH_LEVEL(code.slice(1, -1)), '')
      if (!removed.includes(code)) removed.push(code)
    }
    kept = tidyEvidence(kept)
    return kept ? `(근거: ${kept})` : NEEDS_CHECK
  })
  return { text: next, removed }
}

export interface EvidenceGateResult {
  updates: ArtifactUpdateItem[]
  removed: string[]
}

/**
 * 산출물 갱신 신호 중 근거 검사 대상 섹션만 걸러 낸다. 허용 목록이 비어 있으면(A-2-1·분석시트가 없음)
 * 무엇이 맞는 코드인지 알 수 없으므로 아무것도 지우지 않는다.
 */
export function gateEvidenceCodes(
  updates: readonly ArtifactUpdateItem[],
  currentActivity: string,
  allowedCodes: readonly string[],
): EvidenceGateResult {
  const allowed = new Set(allowedCodes)
  const removed: string[] = []
  if (!allowed.size) return { updates: [...updates], removed }
  const gated = updates.map(update => {
    const keys = EVIDENCE_GATED_SECTIONS[update.activityCode || currentActivity]
    if (!keys) return update
    let changed = false
    const sections = { ...update.sections }
    for (const key of keys) {
      if (typeof sections[key] !== 'string') continue
      const result = stripDisallowedEvidenceCodes(sections[key], allowed)
      if (!result.removed.length) continue
      sections[key] = result.text
      changed = true
      for (const code of result.removed) if (!removed.includes(code)) removed.push(code)
    }
    return changed ? { ...update, sections } : update
  })
  return { updates: gated, removed }
}

/** AI 메시지 끝에 붙일 안내. 지운 코드가 없으면 빈 문자열. */
export function evidenceGateNotice(removed: readonly string[]): string {
  return removed.length ? `분석표에 없는 코드 ${removed.join(', ')}는 저장에서 뺐습니다.` : ''
}

/** 채팅 프롬프트에 붙일 허용 근거 코드 목록. 대상 활동이 아니거나 코드가 없으면 빈 문자열. */
export function buildAllowedEvidenceCodesContext(activityCode: string, allowedCodes: readonly string[]): string {
  if (!EVIDENCE_PROMPT_ACTIVITIES.includes(activityCode) || !allowedCodes.length) return ''
  return `

---
## 허용 근거 코드 목록 (A-2-1 분석표·분석시트)

${allowedCodes.join(' ')}

⚠️ "(근거: …)"에는 위 목록의 코드만 쓴다. 목록 밖 코드는 저장 단계에서 자동으로 지워진다. 맞는 코드가 없으면 "(근거: 확인 필요)"로 쓰고 교사에게 묻는다.
⚠️ 코드마다 겨냥 수준 글자(A·B·C)를 반드시 붙인다 — "(근거: [코드] A)". 수준 글자 없이 코드만 쓰지 않는다.`
}

/** 저장 관문 안내를 AI 메시지 끝에 붙인다. */
export function appendSaveGateNotice(text: string, notices: readonly string[]): string {
  const lines = notices.filter(Boolean)
  return lines.length ? `${text.trimEnd()}\n\n${lines.join('\n')}` : text
}
