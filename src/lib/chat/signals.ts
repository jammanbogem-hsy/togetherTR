const DISPLAY_TO_INTERNAL_ACTIVITY_CODE: Record<string, string> = {
  'T-1': 'T-1-1',
  'T-2': 'T-1-2',
  'T-3': 'T-2-1',
  'T-4': 'T-2-2',
  'T-5': 'T-2-3',
  'A-1': 'A-1-1',
  'A-2': 'A-1-2',
  'A-3': 'A-2-1',
  'A-4': 'A-2-2',
  'A-5': 'A-2-3',
  'Ds-1': 'Ds-1-1',
  'Ds-2': 'Ds-1-2',
  'Ds-3': 'Ds-1-3',
  'Ds-4': 'Ds-2-1',
  'Ds-5': 'Ds-2-2',
  'DI-1': 'DI-1-1',
  'DI-2': 'DI-2-1',
  'E-1': 'E-1-1',
  'E-2': 'E-2-1',
}

const KNOWN_ACTIVITY_CODES = new Set(Object.values(DISPLAY_TO_INTERNAL_ACTIVITY_CODE))

const ARTIFACT_BLOCKED_KEYS = [
  '다음 행동', '다음 단계', 'next step',
  '미결 사항', '미결', '보류 사항',
  'ai 제안', '추천 사항', '참고 사항',
  '합의 내용', '논의 내용', '토론 내용', '토의 내용', '확인 사항',
  '진행 내용', '진행 사항', '현황', '요약',
]

export interface ArtifactUpdateItem {
  activityCode?: string
  sections: Record<string, string>
}

export function normalizeSignalActivityCode(raw: string): string | null {
  const trimmed = raw.trim()
  const normalized = DISPLAY_TO_INTERNAL_ACTIVITY_CODE[trimmed] ?? trimmed
  return KNOWN_ACTIVITY_CODES.has(normalized) ? normalized : null
}

export function parseActivityAdvance(text: string): { nextActivity: string; cleanText: string } | null {
  const match = text.match(/\[ACTIVITY_ADVANCE:\s*([A-Za-z0-9-]+)\]/)
  if (!match) return null
  const nextActivity = normalizeSignalActivityCode(match[1])
  if (!nextActivity) {
    return {
      nextActivity: '',
      cleanText: text.replace(/\n*\[ACTIVITY_ADVANCE:[^\]]+\]/, '').trimEnd(),
    }
  }
  return {
    nextActivity,
    cleanText: text.replace(/\n*\[ACTIVITY_ADVANCE:[^\]]+\]/, '').trimEnd(),
  }
}

export function parseActivityReturn(text: string): { targetActivity: string; cleanText: string } | null {
  const match = text.match(/\[ACTIVITY_RETURN:\s*([A-Za-z0-9-]+)\]/)
  if (!match) return null
  const targetActivity = normalizeSignalActivityCode(match[1])
  if (!targetActivity) {
    return {
      targetActivity: '',
      cleanText: text.replace(/\n*\[ACTIVITY_RETURN:[^\]]+\]/, '').trimEnd(),
    }
  }
  return {
    targetActivity,
    cleanText: text.replace(/\n*\[ACTIVITY_RETURN:[^\]]+\]/, '').trimEnd(),
  }
}

export function parseArtifactConfirm(text: string): { codes: string[]; cleanText: string } {
  const regex = /\[ARTIFACT_CONFIRM(?:@([A-Za-z0-9-]+))?\]/g
  const codes: string[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (!match[1]) {
      codes.push('')
      continue
    }
    const normalized = normalizeSignalActivityCode(match[1])
    if (normalized) codes.push(normalized)
  }
  const cleanText = text.replace(/\n*\[ARTIFACT_CONFIRM(?:@[A-Za-z0-9-]+)?\]/g, '').trimEnd()
  return { codes, cleanText }
}

export function parseArtifactUpdates(text: string): { updates: ArtifactUpdateItem[]; cleanText: string } {
  const buckets: Record<string, Record<string, string>> = {}
  const signalRanges: Array<[number, number]> = []
  const PREFIX = '[ARTIFACT_UPDATE'
  let i = 0

  while (i < text.length) {
    const start = text.indexOf(PREFIX, i)
    if (start === -1) break

    let j = start + PREFIX.length
    let actKey = '__current__'
    let targetIsValid = true

    if (text[j] === '@') {
      j++
      const codeStart = j
      while (j < text.length && text[j] !== ':' && text[j] !== ']') j++
      if (text[j] === ':') {
        const normalized = normalizeSignalActivityCode(text.slice(codeStart, j))
        targetIsValid = normalized !== null
        if (normalized) actKey = normalized
      }
    }

    if (text[j] !== ':') {
      i = start + 1
      continue
    }
    j++
    while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j++

    const keyStart = j
    while (j < text.length && text[j] !== '=' && text[j] !== ']' && text[j] !== '\n') j++
    if (text[j] !== '=') {
      i = start + 1
      continue
    }
    const key = text.slice(keyStart, j).trim()
    j++

    const valueStart = j
    let depth = 1
    while (j < text.length) {
      if (text[j] === '[') depth++
      else if (text[j] === ']') {
        depth--
        if (depth === 0) break
      }
      j++
    }

    const incomplete = depth !== 0
    if (incomplete) j = text.length
    const end = incomplete ? text.length : j + 1
    const value = text.slice(valueStart, j).trim()
    const keyRaw = key.toLowerCase()

    if (
      targetIsValid
      && !incomplete
      && !ARTIFACT_BLOCKED_KEYS.some(blocked => keyRaw.includes(blocked))
      && key
      && value
    ) {
      if (!buckets[actKey]) buckets[actKey] = {}
      buckets[actKey][key] = value
    }

    signalRanges.push([start, end])
    i = end
  }

  let cleanText = text
  for (let rangeIdx = signalRanges.length - 1; rangeIdx >= 0; rangeIdx--) {
    const [start, end] = signalRanges[rangeIdx]
    cleanText = cleanText.slice(0, start) + cleanText.slice(end)
  }
  cleanText = cleanText.replace(/\n{3,}/g, '\n\n').trimEnd()

  const updates: ArtifactUpdateItem[] = Object.entries(buckets).map(([actKey, sections]) => ({
    activityCode: actKey === '__current__' ? undefined : actKey,
    sections,
  }))
  return { updates, cleanText }
}
