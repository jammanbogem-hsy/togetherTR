// ─── 구조화된 산출물 스키마 ──────────────────────────────────────────────
// AI 자유 형식 마크다운 대신 **코드가 구조를 강제**하는 방식.
// AI가 뭘 빠뜨리든, 형식이 이상하든 스키마가 보장한다.

// ─── T-1-1 팀 공통 비전 설정 ─────────────────────────────────────────────

export interface T11PersonalVision {
  teacherName: string
  subject?: string       // 담당 교과
  keywords: string[]     // 교사가 말한 원래 키워드
  refinedVision: string  // AI 정교화 비전 문장
}

export interface T11Structured {
  _schema: 'T-1-1'
  personalVisions: T11PersonalVision[]
  teamVision: string       // 팀 공통 비전 문장
  coreKeywords: string[]   // 핵심 키워드 3~5개
}

/**
 * AI의 ARTIFACT_UPDATE 섹션들 + 채팅 이력에서 T-1-1 구조화 산출물을 구축.
 * 빠진 필드는 채팅에서 자동 추출한다.
 */
export function buildT11Structured(
  sections: Record<string, string>,
  chatMessages: Array<{ role: string; content: string; displayName?: string }>,
): T11Structured {
  const result: T11Structured = {
    _schema: 'T-1-1',
    personalVisions: [],
    teamVision: '',
    coreKeywords: [],
  }

  // 1. 팀 공통 비전 — 가장 간단
  result.teamVision = (sections['팀 공통 비전'] ?? '').trim()

  // 2. 핵심 키워드
  const kwRaw = (sections['핵심 키워드'] ?? '').trim()
  if (kwRaw) {
    result.coreKeywords = kwRaw.split(/[,，·]/).map(s => s.trim()).filter(Boolean)
  }

  // 3. 개인 비전 — AI 출력에서 추출 시도
  const pvRaw = (sections['개인 비전'] ?? '').trim()
  if (pvRaw) {
    result.personalVisions = parsePersonalVisions(pvRaw)
  }

  // 4. 개인 비전이 비어있으면 채팅 이력에서 자동 추출
  if (result.personalVisions.length === 0) {
    result.personalVisions = extractPersonalVisionsFromChat(chatMessages)
  }

  // 5. 핵심 키워드가 비어있으면 비전에서 자동 추출
  if (result.coreKeywords.length === 0 && result.teamVision) {
    const nouns = result.teamVision.match(/[가-힣]{2,}(?:력|성|학습|교육|해결|활동|분석|역량|시민|탐구|설계)/g)
    if (nouns && nouns.length >= 2) {
      result.coreKeywords = [...new Set(nouns)].slice(0, 5)
    }
  }

  // 6. 팀 비전이 비어있으면 채팅에서 마지막 합의 문장 추출
  if (!result.teamVision) {
    for (const msg of [...chatMessages].reverse()) {
      if (msg.role !== 'assistant') continue
      const m = msg.content.match(/['"「"](.*?문제.*?교육.*?)['"」"]/)
        || msg.content.match(/['"「"](.*?학생.*?교육.*?)['"」"]/)
        || msg.content.match(/['"「"](.*?성장.*?수업.*?)['"」"]/)
      if (m) { result.teamVision = m[1].trim(); break }
    }
  }

  return result
}

/** AI가 출력한 개인 비전 텍스트(표 또는 화살표 형식)를 파싱 */
function parsePersonalVisions(raw: string): T11PersonalVision[] {
  const entries: T11PersonalVision[] = []

  // 마크다운 표 형식: | 교사명 | 키워드 | 비전 |
  const lines = raw.split('\n').filter(l => l.trim().startsWith('|'))
  if (lines.length >= 3) {
    // 헤더 + 구분 + 데이터 행
    const dataLines = lines.filter(l => !/^\|[\s\-:|]+\|$/.test(l.trim())).slice(1) // 헤더 제거
    for (const line of dataLines) {
      const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim())
      if (cells.length >= 3 && cells[0]) {
        entries.push({
          teacherName: cells[0].replace(/\s*선생님$/, ''),
          keywords: cells[1].split(/[,，·]/).map(s => s.trim()).filter(Boolean),
          refinedVision: cells[2],
        })
      }
    }
    if (entries.length > 0) return entries
  }

  // 화살표 형식: → 홍성용 선생님: '비전 문장'
  const arrowPattern = /→\s*(.+?)\s*선생님\s*[:：]\s*['"「"']?(.+?)['"」"']?\s*$/gm
  let m
  while ((m = arrowPattern.exec(raw)) !== null) {
    entries.push({
      teacherName: m[1].trim(),
      keywords: [],
      refinedVision: m[2].trim(),
    })
  }

  // 인라인 파이프 (줄바꿈 없이 || 로 붙어있는 경우)
  if (entries.length === 0 && raw.includes('|') && !raw.includes('\n')) {
    const cells = raw.split('|').map(s => s.trim()).filter(Boolean)
    // 헤더(교사명, 키워드, 비전) 제거 후 3셀씩 묶기
    const headerIdx = cells.findIndex(c => /교사명|이름/.test(c))
    const data = headerIdx >= 0 ? cells.slice(headerIdx + 3) : cells
    // 구분자 행(---) 제거
    const cleaned = data.filter(c => !/^-{2,}$/.test(c))
    for (let i = 0; i + 2 < cleaned.length; i += 3) {
      if (cleaned[i] && cleaned[i + 2]) {
        entries.push({
          teacherName: cleaned[i].replace(/\s*선생님$/, ''),
          keywords: cleaned[i + 1].split(/[,，·]/).map(s => s.trim()).filter(Boolean),
          refinedVision: cleaned[i + 2],
        })
      }
    }
  }

  return entries
}

/** 채팅 이력에서 개인 비전 정보를 추출 */
function extractPersonalVisionsFromChat(
  messages: Array<{ role: string; content: string; displayName?: string }>,
): T11PersonalVision[] {
  const entries: T11PersonalVision[] = []
  const assistantMsgs = messages.filter(m => m.role === 'assistant')

  for (const msg of assistantMsgs) {
    // "→ 홍성용 선생님: '비전 문장'" 패턴
    const patterns = [
      /→\s*(.+?)\s*선생님\s*[:：]\s*['"「"'](.+?)['"」"']/g,
      /\*\*(.+?)\s*선생님\*\*\s*[:：]\s*['"「"'](.+?)['"」"']/g,
    ]
    for (const pattern of patterns) {
      let m
      while ((m = pattern.exec(msg.content)) !== null) {
        const name = m[1].trim()
        if (!entries.some(e => e.teacherName === name)) {
          entries.push({
            teacherName: name,
            keywords: [],
            refinedVision: m[2].trim(),
          })
        }
      }
    }
  }

  // 키워드 채우기: user 메시지 중 짧은 것(키워드)을 교사별로 매칭
  const userMsgs = messages.filter(m => m.role === 'user')
  for (const entry of entries) {
    for (const um of userMsgs) {
      if (um.displayName && um.displayName.includes(entry.teacherName) && um.content.length <= 30) {
        entry.keywords = um.content.split(/[,，·\s]+/).filter(Boolean)
        break
      }
    }
    // displayName 없으면 assistant 응답에서 "[이름]께서 말씀하신 '[키워드]'" 추출
    if (entry.keywords.length === 0) {
      for (const am of assistantMsgs) {
        const kwMatch = am.content.match(new RegExp(`${entry.teacherName}.*?말씀하신\\s*['"「](.+?)['"」]`))
        if (kwMatch) {
          entry.keywords = kwMatch[1].split(/[,，·\s]+/).filter(Boolean)
          break
        }
      }
    }
  }

  return entries
}

// ─── T-1-2 수업설계 방향 설정 ─────────────────────────────────────────────

export interface T12DesignPrinciple {
  principle: string   // 설계 원칙 (구체적 방법론 포함)
  rationale: string   // 근거
}

export interface T12Structured {
  _schema: 'T-1-2'
  designPrinciples: T12DesignPrinciple[]
}

export function buildT12Structured(
  sections: Record<string, string>,
  chatMessages: Array<{ role: string; content: string }>,
): T12Structured {
  const result: T12Structured = { _schema: 'T-1-2', designPrinciples: [] }

  const raw = (sections['설계 방향'] ?? '').trim()
  if (raw) {
    result.designPrinciples = parseDesignPrinciples(raw)
  }

  // 채팅 fallback: 설계 원칙이 비어있으면 AI 응답에서 **A안:**/불릿 패턴 추출
  if (result.designPrinciples.length === 0) {
    result.designPrinciples = extractDesignPrinciplesFromChat(chatMessages)
  }

  return result
}

function parseDesignPrinciples(raw: string): T12DesignPrinciple[] {
  const entries: T12DesignPrinciple[] = []

  // 마크다운 표: | 설계 원칙 | 근거 |
  const lines = raw.split('\n').filter(l => l.trim().startsWith('|'))
  if (lines.length >= 3) {
    const dataLines = lines.filter(l => !/^\|[\s\-:|]+\|$/.test(l.trim())).slice(1)
    for (const line of dataLines) {
      const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim())
      if (cells.length >= 2 && cells[0]) {
        entries.push({ principle: cells[0], rationale: cells[1] || '' })
      }
    }
    if (entries.length > 0) return entries
  }

  // 불릿 리스트: - **원칙**: 설명
  const bulletPattern = /[-•]\s*\*?\*?(.+?)\*?\*?\s*[:：]\s*(.+)/g
  let m
  while ((m = bulletPattern.exec(raw)) !== null) {
    entries.push({ principle: m[1].trim(), rationale: m[2].trim() })
  }

  // 인라인 파이프 (줄바꿈 없이)
  if (entries.length === 0 && raw.includes('|') && !raw.includes('\n')) {
    const cells = raw.split('|').map(s => s.trim()).filter(Boolean)
    const headerIdx = cells.findIndex(c => /원칙|방향/.test(c))
    const data = headerIdx >= 0 ? cells.slice(headerIdx + 2) : cells
    const cleaned = data.filter(c => !/^-{2,}$/.test(c))
    for (let i = 0; i + 1 < cleaned.length; i += 2) {
      if (cleaned[i]) entries.push({ principle: cleaned[i], rationale: cleaned[i + 1] || '' })
    }
  }

  return entries
}

function extractDesignPrinciplesFromChat(
  messages: Array<{ role: string; content: string }>,
): T12DesignPrinciple[] {
  const entries: T12DesignPrinciple[] = []
  const assistantMsgs = [...messages.filter(m => m.role === 'assistant')].reverse()

  for (const msg of assistantMsgs) {
    // 표 패턴
    const tableLines = msg.content.split('\n').filter(l => l.trim().startsWith('|'))
    if (tableLines.length >= 3) {
      const parsed = parseDesignPrinciples(tableLines.join('\n'))
      if (parsed.length > 0) return parsed
    }
    // **A안:** / **원칙 N:** 패턴
    const patterns = [
      /\*\*(?:A안|B안|원칙\s*\d+)\s*[:：]?\*\*\s*['"「"]?(.+?)['"」"]?\s*(?:\((.+?)\))?$/gm,
      /[-•]\s*\*\*(.+?)\*\*\s*[:：]\s*(.+)/gm,
    ]
    for (const p of patterns) {
      let m
      while ((m = p.exec(msg.content)) !== null) {
        entries.push({ principle: m[1].trim(), rationale: (m[2] || '').trim() })
      }
    }
    if (entries.length >= 2) return entries
  }
  return entries
}

// ─── T-2-1 역할 배분 ─────────────────────────────────────────────────────

export interface T21Role {
  teacherName: string
  subject: string
  strengths: string
  role: string
  responsibilities: string
}

export interface T21Structured {
  _schema: 'T-2-1'
  roles: T21Role[]
}

export function buildT21Structured(
  sections: Record<string, string>,
  chatMessages: Array<{ role: string; content: string }>,
): T21Structured {
  const result: T21Structured = { _schema: 'T-2-1', roles: [] }
  const raw = (sections['역할 배분'] ?? '').trim()
  if (raw) result.roles = parseTableRows(raw, 5).map(cells => ({
    teacherName: cells[0] || '', subject: cells[1] || '', strengths: cells[2] || '',
    role: cells[3] || '', responsibilities: cells[4] || '',
  }))
  if (result.roles.length === 0) {
    // 채팅 fallback: AI 응답에서 5열 표 추출
    for (const msg of [...chatMessages.filter(m => m.role === 'assistant')].reverse()) {
      const rows = parseTableRows(msg.content, 5)
      if (rows.length > 0) {
        result.roles = rows.map(cells => ({
          teacherName: cells[0] || '', subject: cells[1] || '', strengths: cells[2] || '',
          role: cells[3] || '', responsibilities: cells[4] || '',
        }))
        break
      }
    }
  }
  return result
}

// ─── T-2-2 팀 규칙 수립 ──────────────────────────────────────────────────

export interface T22Rule {
  category: string    // [소통], [시간] 등
  name: string
  description: string
  violation: string   // 위반 시 조치
}

export interface T22Structured {
  _schema: 'T-2-2'
  rules: T22Rule[]
}

export function buildT22Structured(
  sections: Record<string, string>,
  chatMessages: Array<{ role: string; content: string }>,
): T22Structured {
  const result: T22Structured = { _schema: 'T-2-2', rules: [] }
  const raw = (sections['팀 규칙'] ?? '').trim()
  if (raw) result.rules = parseRules(raw)
  if (result.rules.length === 0) {
    for (const msg of [...chatMessages.filter(m => m.role === 'assistant')].reverse()) {
      const rules = parseRules(msg.content)
      if (rules.length >= 2) { result.rules = rules; break }
    }
  }
  return result
}

function parseRules(raw: string): T22Rule[] {
  const rules: T22Rule[] = []

  // Step 1: 규칙 항목 블록으로 분리 — 번호(1. 2.), 볼드(**), 불릿(-•) 기준
  const blocks: string[] = []
  // 번호/볼드/불릿으로 시작하는 줄에서 분리
  const lines = raw.split('\n')
  let current = ''
  for (const line of lines) {
    const trimmed = line.trim()
    // 새 규칙 항목 시작 감지
    const isNewRule = /^\d+\.\s*/.test(trimmed) || /^\*\*\[/.test(trimmed) || /^\*\*[^*]/.test(trimmed) || /^[-•]\s*\[/.test(trimmed)
    // 위반 시 조치 하위 항목은 새 규칙이 아님
    const isViolation = /위반\s*시/.test(trimmed)
    if (isNewRule && !isViolation && current.trim()) {
      blocks.push(current.trim())
      current = line
    } else if (isNewRule && !isViolation) {
      current = line
    } else {
      current += '\n' + line
    }
  }
  if (current.trim()) blocks.push(current.trim())

  // Step 2: 각 블록에서 범주, 이름, 설명, 위반 시 조치 추출
  for (const block of blocks) {
    // 위반 시 조치 추출 (별도 줄 또는 인라인)
    let violation = ''
    let mainText = block
    // 별도 줄: • 위반 시 조치: ... 또는 • N회 이상 위반 시 조치: ...
    const violationLineMatch = mainText.match(/\n\s*[-•]\s*(?:\d+회\s*이상\s*)?위반\s*시\s*(?:조치\s*)?[:：]\s*([^\n]+)/)
    if (violationLineMatch) {
      violation = violationLineMatch[1].trim().split('\n')[0] // 첫 줄만
      mainText = mainText.slice(0, mainText.indexOf(violationLineMatch[0])).trim()
    }
    // 인라인: (위반 시: ...)
    if (!violation) {
      const inlineMatch = mainText.match(/\((?:\d+회\s*이상\s*)?위반\s*시\s*(?:조치\s*)?[:：]\s*(.+?)\)/)
      if (inlineMatch) {
        violation = inlineMatch[1].trim()
        mainText = mainText.replace(inlineMatch[0], '').trim()
      }
    }

    // 번호/볼드/불릿 제거
    mainText = mainText
      .replace(/^\d+\.\s*/, '')
      .replace(/^\*\*(.+?)\*\*/, '$1')
      .replace(/^[-•]\s*/, '')
      .trim()

    // 범주 [소통] 추출
    let category = ''
    const catMatch = mainText.match(/^\[([^\]]+)\]\s*/)
    if (catMatch) {
      category = catMatch[1].trim()
      mainText = mainText.slice(catMatch[0].length).trim()
    }

    // 이름 : 설명 분리 (첫 번째 : 기준)
    const colonIdx = mainText.search(/\s*[:：]\s/)
    if (colonIdx > 0 && colonIdx < 40) {
      const name = mainText.slice(0, colonIdx).replace(/\*\*/g, '').trim()
      const desc = mainText.slice(colonIdx).replace(/^[\s:：]+/, '').trim()
      if (name && desc) {
        rules.push({ category, name, description: desc, violation })
      }
    } else if (mainText.length > 5) {
      // 콜론 없으면 전체를 이름+설명으로
      rules.push({ category, name: mainText.slice(0, 30).replace(/\*\*/g, ''), description: mainText, violation })
    }
  }

  return rules
}

// ─── T-2-3 팀 일정 협의 ──────────────────────────────────────────────────

export interface T23ScheduleItem {
  period: string
  activity: string
  deliverable: string
  assignee: string
}

export interface T23Structured {
  _schema: 'T-2-3'
  schedule: T23ScheduleItem[]
}

export function buildT23Structured(
  sections: Record<string, string>,
  chatMessages: Array<{ role: string; content: string }>,
): T23Structured {
  const result: T23Structured = { _schema: 'T-2-3', schedule: [] }
  const raw = (sections['팀 일정'] ?? '').trim()
  if (raw) result.schedule = parseTableRows(raw, 4).map(cells => ({
    period: cells[0] || '', activity: cells[1] || '', deliverable: cells[2] || '', assignee: cells[3] || '',
  }))
  if (result.schedule.length === 0) {
    for (const msg of [...chatMessages.filter(m => m.role === 'assistant')].reverse()) {
      const rows = parseTableRows(msg.content, 4)
      if (rows.length > 0) {
        result.schedule = rows.map(cells => ({
          period: cells[0] || '', activity: cells[1] || '', deliverable: cells[2] || '', assignee: cells[3] || '',
        }))
        break
      }
    }
  }
  return result
}

// ─── A-1-2 주제 선정 ─────────────────────────────────────────────────────

export interface A12Criterion { criterion: string; description: string; priority: string }
export interface A12LinkedSubject { subject: string; focus: string }

export interface A12Structured {
  _schema: 'A-1-2'
  criteria: A12Criterion[]
  linkedSubjects: A12LinkedSubject[]
  selectedTopic: string
  topicType: string        // 내용요소형 / 기능요소형 / 혼합형
  rationale: string
}

export function buildA12Structured(sections: Record<string, string>, chat: Array<{ role: string; content: string }>): A12Structured {
  const r: A12Structured = { _schema: 'A-1-2', criteria: [], linkedSubjects: [], selectedTopic: '', topicType: '', rationale: '' }
  // 기준
  const critRaw = (sections['주제 선정 기준'] ?? '').trim()
  if (critRaw) r.criteria = parseTableRows(critRaw, 2).map(c => ({ criterion: c[0], description: c[1] || '', priority: c[2] || '' }))
  const linkedRaw = (sections['연계 교과'] ?? sections['교과 연계'] ?? '').trim()
  if (linkedRaw) r.linkedSubjects = parseLinkedSubjects(linkedRaw)
  // 최종 주제 — 80자 이하만 유효 (긴 텍스트는 AI가 전체 응답을 넣은 것)
  const rawTopic = (sections['최종 선정 주제'] ?? sections['선정 주제'] ?? '').trim()
  r.selectedTopic = rawTopic.length <= 80 ? rawTopic.replace(/\*\*/g, '').replace(/^#+\s*/, '') : ''
  // 주제 유형
  const rawType = (sections['주제 유형'] ?? '').trim()
  r.topicType = rawType.length <= 40 ? rawType.replace(/\*\*/g, '') : ''
  // 선정 근거
  const rawRationale = (sections['선정 근거'] ?? '').trim()
  r.rationale = rawRationale.length <= 300 ? rawRationale.replace(/\*\*/g, '').replace(/^#+\s*/, '') : ''
  // fallback — 채팅에서 추출 (마크다운 strip 후 정밀 패턴)
  if (r.criteria.length === 0 || !r.selectedTopic) {
    const stripMd = (s: string) => s.replace(/\*\*/g, '').replace(/__/g, '').replace(/[*_~`]/g, '').trim()
    for (const msg of [...chat.filter(m => m.role === 'assistant')].reverse()) {
      const rawLines = msg.content.split('\n')
      const lines = rawLines.map(stripMd)
      if (r.criteria.length === 0) { const rows = parseTableRows(msg.content, 2); if (rows.length >= 2) r.criteria = rows.map(c => ({ criterion: stripMd(c[0]), description: stripMd(c[1] || ''), priority: stripMd(c[2] || '') })) }
      if (r.linkedSubjects.length === 0) r.linkedSubjects = parseLinkedSubjects(msg.content)
      if (!r.selectedTopic) {
        for (const line of lines) {
          const m = line.match(/(?:[-•]\s*)?(?:최종\s*선정\s*주제|선정\s*주제)\s*[:：]\s*(.+)$/)
          if (m && m[1].length < 80 && m[1].length > 2) { r.selectedTopic = m[1].trim(); break }
        }
      }
      if (!r.topicType) {
        for (const line of lines) {
          const m = line.match(/(?:[-•]\s*)?주제\s*유형\s*[:：]\s*(.+?)(?:\s*[-–]|$)/)
          if (m && m[1].length < 40) { r.topicType = m[1].trim(); break }
        }
      }
      if (!r.rationale) {
        for (let li = 0; li < lines.length; li++) {
          const m = lines[li].match(/(?:[-•]\s*)?선정\s*근거\s*[:：]\s*(.*)/)
          if (m) {
            if (m[1].trim().length > 10) {
              r.rationale = m[1].trim()
            } else {
              const parts: string[] = []
              for (let j = li + 1; j < lines.length && j < li + 8; j++) {
                const bl = lines[j].match(/^\s*[-•]\s*(.+)/)
                if (bl) parts.push(bl[1].trim())
                else if (lines[j].trim() && !lines[j].match(/^\s*[-•]/)) break
              }
              if (parts.length > 0) r.rationale = parts.join('. ')
            }
            break
          }
        }
      }
      if (r.selectedTopic) break
    }
  }
  // 주제 유형 자동 추론
  if (!r.topicType && r.selectedTopic) {
    const t = r.selectedTopic + ' ' + r.rationale
    if (/해결|제작|표현|탐구|설계/.test(t) && /환경|사회|역사|과학|문화/.test(t)) r.topicType = '혼합형(내용 + 기능)'
    else if (/해결|제작|표현|탐구|설계/.test(t)) r.topicType = '기능요소형'
    else r.topicType = '내용요소형'
  }
  return r
}

function parseLinkedSubjects(raw: string): A12LinkedSubject[] {
  const subjectNames = ['국어', '사회', '수학', '과학', '도덕', '실과', '체육', '음악', '미술', '영어']
  const rows = parseTableRows(raw, 2)
    .map(c => ({ subject: stripArtifactMd(c[0] ?? ''), focus: stripArtifactMd(c[1] ?? '') }))
    .filter(item => subjectNames.includes(item.subject) && item.focus)
  if (rows.length > 0) return uniqueLinkedSubjects(rows)

  const parsed: A12LinkedSubject[] = []
  for (const line of raw.split('\n')) {
    const clean = stripArtifactMd(line).replace(/^[-•*\d.\s]+/, '').trim()
    const match = clean.match(/^([가-힣]+)\s*[:：]\s*(.+)$/)
    if (!match) continue
    const subject = match[1].replace(/과$/, '')
    if (!subjectNames.includes(subject)) continue
    parsed.push({ subject, focus: match[2].trim() })
  }
  return uniqueLinkedSubjects(parsed)
}

function uniqueLinkedSubjects(items: A12LinkedSubject[]): A12LinkedSubject[] {
  const seen = new Set<string>()
  const out: A12LinkedSubject[] = []
  for (const item of items) {
    if (seen.has(item.subject)) continue
    seen.add(item.subject)
    out.push(item)
  }
  return out
}

function stripArtifactMd(value: string): string {
  return value.replace(/\*\*/g, '').replace(/__/g, '').replace(/[*_~`]/g, '').trim()
}

function cleanA21Cell(value: string): string {
  return stripArtifactMd(value)
    .replace(/&(?:#124|124);/g, ' / ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}

// ─── A-2-1 성취기준 분석 (기존 extractA21TableForSave 유지, 구조화는 단순 래핑) ──

export interface A21Row {
  subject: string           // 교과명
  coreIdea: string          // 핵심 아이디어
  standard?: string         // 성취기준
  knowledgeUnderstanding: string  // 지식·이해
  processFunction: string   // 과정·기능
  agentLessonExample?: string      // Agent 추천 수업아이디어
  description?: string             // 교사 수업내용 설명
  isCommon?: boolean        // 공통(팀 조정) 행 여부
}

export interface A21Structured {
  _schema: 'A-2-1'
  rows: A21Row[]
  agentLessonIdeas?: string
}

export function buildA21Structured(sections: Record<string, string>, chat: Array<{ role: string; content: string }>): A21Structured {
  const r: A21Structured = { _schema: 'A-2-1', rows: [] }

  // 기존 "성취기준분석표" 키에서 4열 표 파싱 시도
  const raw = (sections['성취기준분석표'] ?? sections['핵심아이디어분석'] ?? '').trim()
  if (raw) r.rows = parseA21Table(raw)
  const agentLessonIdeas = (
    sections['Agent 추천 수업아이디어']
    ?? sections['Agent 추천 수업 예시']
    ?? sections['Agent 추천 수업예시']
    ?? ''
  ).trim()
  if (agentLessonIdeas) r.agentLessonIdeas = agentLessonIdeas

  // fallback: 채팅에서 4열 또는 7열 표 추출
  if (r.rows.length === 0) {
    for (const msg of [...chat.filter(m => m.role === 'assistant')].reverse()) {
      const rows = parseA21Table(msg.content)
      if (rows.length >= 2) { r.rows = rows; break }
    }
  }

  return r
}

function parseA21Table(raw: string): A21Row[] {
  const rows: A21Row[] = []
  const tableLines = raw.split('\n').filter(l => l.trim().startsWith('|'))
  if (tableLines.length < 3) return rows

  // 헤더에서 열 인덱스 파악
  const headerCells = tableLines[0].replace(/^\|/, '').replace(/\|$/, '').split('|').map(cleanA21Cell)
  const findCol = (keywords: string[]) => headerCells.findIndex(h => keywords.some(k => h.includes(k)))

  const subjectIdx = findCol(['교과'])
  const coreIdeaIdx = findCol(['핵심아이디어', '핵심 아이디어'])
  const standardIdx = findCol(['성취기준'])
  const knowledgeIdx = findCol(['지식', '이해'])
  const functionIdx = findCol(['과정', '기능'])
  const agentLessonIdx = findCol(['Agent', '추천 수업', '수업아이디어', '수업 아이디어', '수업 예시'])
  const descriptionIdx = findCol(['수업내용', '수업 내용', '설명'])

  // 데이터 행 (헤더 + 구분자 제외)
  const dataLines = tableLines.filter(l => !/^\|[\s\-:|]+\|$/.test(l.trim())).slice(1)
  for (const line of dataLines) {
    const cells = line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cleanA21Cell)
    const subject = cells[subjectIdx >= 0 ? subjectIdx : 0] || ''
    const coreIdea = cells[coreIdeaIdx >= 0 ? coreIdeaIdx : 1] || ''
    const standard = standardIdx >= 0 ? (cells[standardIdx] || '') : ''
    const knowledge = cells[knowledgeIdx >= 0 ? knowledgeIdx : 2] || ''
    const fn = cells[functionIdx >= 0 ? functionIdx : 3] || ''
    const agentLessonExample = agentLessonIdx >= 0 ? (cells[agentLessonIdx] || '') : ''
    const description = descriptionIdx >= 0 ? (cells[descriptionIdx] || '') : ''

    if (subject || coreIdea) {
      rows.push({
        subject,
        coreIdea,
        standard,
        knowledgeUnderstanding: knowledge,
        processFunction: fn,
        agentLessonExample,
        description,
        isCommon: /공통|팀\s*조정|통합/.test(subject),
      })
    }
  }

  // 불릿 리스트 형식 fallback: "1. 과학\n• 핵심아이디어: ...\n• 지식·이해: ..."
  if (rows.length === 0) {
    const blocks = raw.split(/(?=\d+\.\s*[가-힣])/).filter(b => b.trim())
    for (const block of blocks) {
      const lines = block.split('\n').map(cleanA21Cell)
      const subjectMatch = lines[0]?.match(/^\d+\.\s*(.+?)(?:\s*$|\s*[:：])/)
      if (!subjectMatch) continue
      const subject = subjectMatch[1].trim()
      let coreIdea = '', knowledge = '', fn = ''
      for (const line of lines) {
        const ci = line.match(/핵심\s*아이디어\s*[:：]\s*(.+)/)
        if (ci) coreIdea = ci[1].trim()
        const kn = line.match(/지식[·⋅\s]*이해\s*[:：]\s*(.+)/)
        if (kn) knowledge = kn[1].trim()
        const pf = line.match(/과정[·⋅\s]*기능\s*[:：]\s*(.+)/)
        if (pf) fn = pf[1].trim()
      }
      if (subject && (coreIdea || knowledge)) {
        rows.push({ subject, coreIdea, knowledgeUnderstanding: knowledge, processFunction: fn, isCommon: /공통|팀/.test(subject) })
      }
    }
  }

  return rows
}

// ─── A-2-2 통합 수업목표 진술 ────────────────────────────────────────────

export interface A22SubjectGoal { subject: string; goal: string }

export interface A22Structured {
  _schema: 'A-2-2'
  subjectGoals: A22SubjectGoal[]
  integratedGoals: string[]
}

export function buildA22Structured(sections: Record<string, string>, chat: Array<{ role: string; content: string }>): A22Structured {
  const r: A22Structured = { _schema: 'A-2-2', subjectGoals: [], integratedGoals: [] }
  const sgRaw = (sections['교과별 세부 목표'] ?? '').trim()
  if (sgRaw) r.subjectGoals = parseTableRows(sgRaw, 2).map(c => ({ subject: c[0], goal: c[1] || '' }))
  const igRaw = (sections['통합 학습목표'] ?? '').trim()
  if (igRaw) r.integratedGoals = igRaw.split('\n').map(l => l.replace(/^[-•\d.]\s*/, '').trim()).filter(Boolean)
  // fallback
  if (r.subjectGoals.length === 0 || r.integratedGoals.length === 0) {
    for (const msg of [...chat.filter(m => m.role === 'assistant')].reverse()) {
      if (r.subjectGoals.length === 0) { const rows = parseTableRows(msg.content, 2); if (rows.length >= 2) r.subjectGoals = rows.map(c => ({ subject: c[0], goal: c[1] || '' })) }
      if (r.integratedGoals.length === 0) {
        const goals = msg.content.split('\n').filter(l => /^\s*[-•\d.]\s*.{10,}/.test(l) && /학생|학습|역량|목표/.test(l)).map(l => l.replace(/^[-•\d.]\s*/, '').trim())
        if (goals.length >= 2) r.integratedGoals = goals
      }
      if (r.subjectGoals.length > 0 && r.integratedGoals.length > 0) break
    }
  }
  return r
}

// ─── A-2-3 학습자·맥락 분석 ──────────────────────────────────────────────

export interface A23ProfileItem { item: string; content: string }
export interface A23TeacherNote { teacherName: string; note: string }

export interface A23Structured {
  _schema: 'A-2-3'
  commonProfile: A23ProfileItem[]  // 선수지식, 오개념·혼동, 환경 제약, 예상 난관
  teacherNotes: A23TeacherNote[]   // 교사별 맞춤 고려 포인트
}

export function buildA23Structured(sections: Record<string, string>, chat: Array<{ role: string; content: string }>): A23Structured {
  const r: A23Structured = { _schema: 'A-2-3', commonProfile: [], teacherNotes: [] }
  const raw = (sections['학습자 프로필'] ?? '').trim()
  if (raw) {
    // 표 형식: | 항목 | 내용 |
    const rows = parseTableRows(raw, 2)
    if (rows.length > 0) r.commonProfile = rows.map(c => ({ item: c[0], content: c[1] || '' }))
    // 교사별 맞춤 (불릿: • 교사명 : 내용)
    const teacherLines = raw.split('\n').filter(l => /[-•]\s*.+선생님\s*[:：]/.test(l))
    r.teacherNotes = teacherLines.map(l => {
      const m = l.match(/[-•]\s*(.+?선생님)\s*[:：]\s*(.+)/)
      return m ? { teacherName: m[1].trim(), note: m[2].trim() } : null
    }).filter((n): n is A23TeacherNote => n !== null)
  }
  // fallback
  if (r.commonProfile.length === 0) {
    for (const msg of [...chat.filter(m => m.role === 'assistant')].reverse()) {
      const rows = parseTableRows(msg.content, 2)
      if (rows.length >= 2 && /선수|오개념|환경|난관/.test(msg.content)) {
        r.commonProfile = rows.map(c => ({ item: c[0], content: c[1] || '' }))
        break
      }
    }
  }
  if (r.teacherNotes.length === 0) {
    for (const msg of [...chat.filter(m => m.role === 'assistant')].reverse()) {
      const tLines = msg.content.split('\n').filter(l => /[-•]\s*.+선생님\s*[:：]/.test(l))
      if (tLines.length >= 1) {
        r.teacherNotes = tLines.map(l => { const m = l.match(/[-•]\s*(.+?선생님)\s*[:：]\s*(.+)/); return m ? { teacherName: m[1].trim(), note: m[2].trim() } : null }).filter((n): n is A23TeacherNote => n !== null)
        break
      }
    }
  }
  return r
}

// ─── 공통 유틸 ───────────────────────────────────────────────────────────

/** 마크다운 표에서 데이터 행을 추출 (헤더/구분자 제외) */
function parseTableRows(raw: string, minCols: number): string[][] {
  const lines = raw.split('\n').filter(l => l.trim().startsWith('|'))
  if (lines.length < 3) return []
  const dataLines = lines.filter(l => !/^\|[\s\-:|]+\|$/.test(l.trim())).slice(1) // 헤더 제거
  return dataLines
    .map(line => line.replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim()))
    .filter(cells => cells.length >= minCols && cells.some(c => c.length > 0))
}

// ─── 스키마 감지 유틸 ─────────────────────────────────────────────────────

// ─── 빈 필드 감지 ────────────────────────────────────────────────────────
// 구조화 산출물에서 아직 채워지지 않은 항목을 검출 → 사용자에게 격려 피드백 제공

export interface MissingField {
  label: string        // 사용자에게 보여줄 필드명
  hint: string         // 입력 유도 안내 문구
}

export function detectMissingFields(data: Record<string, unknown>): MissingField[] {
  const missing: MissingField[] = []
  const schema = data._schema as string | undefined

  if (schema === 'T-1-1') {
    const d = data as unknown as T11Structured
    if (!d.personalVisions?.length) missing.push({ label: '개인 비전', hint: '각 선생님의 비전 키워드와 정교화 문장을 공유해주세요' })
    if (!d.teamVision) missing.push({ label: '팀 공통 비전', hint: '팀이 합의한 비전 문장을 확정해주세요' })
    if (!d.coreKeywords?.length) missing.push({ label: '핵심 키워드', hint: '비전의 핵심 단어 3~5개를 정해주세요' })
  } else if (schema === 'T-1-2') {
    const d = data as unknown as T12Structured
    if (!d.designPrinciples?.length) missing.push({ label: '설계 원칙', hint: '수업에서 지킬 설계 원칙 3~5가지를 정해주세요' })
  } else if (schema === 'T-2-1') {
    const d = data as unknown as T21Structured
    if (!d.roles?.length) missing.push({ label: '역할 배분', hint: '팀원별 역할과 담당 업무를 나눠주세요' })
  } else if (schema === 'T-2-2') {
    const d = data as unknown as T22Structured
    if (!d.rules?.length) missing.push({ label: '팀 규칙', hint: '팀에서 지킬 규칙 3~5가지를 정해주세요' })
  } else if (schema === 'T-2-3') {
    const d = data as unknown as T23Structured
    if (!d.schedule?.length) missing.push({ label: '팀 일정', hint: '단계별 일정과 마감을 정해주세요' })
  } else if (schema === 'A-1-2') {
    const d = data as unknown as A12Structured
    if (!d.criteria?.length) missing.push({ label: '주제 선정 기준', hint: '주제를 고르는 기준 3가지를 정해주세요' })
    if (!d.selectedTopic) missing.push({ label: '선정 주제', hint: '팀이 합의한 주제를 확정해주세요' })
    if (!d.topicType) missing.push({ label: '주제 유형', hint: '내용요소형/기능요소형/혼합형 중 선택해주세요' })
    if (!d.rationale) missing.push({ label: '선정 근거', hint: '왜 이 주제를 선택했는지 근거를 적어주세요' })
  } else if (schema === 'A-2-1') {
    const d = data as unknown as A21Structured
    if (!d.rows?.length) missing.push({ label: '핵심아이디어 분석표', hint: '교과별 핵심아이디어·지식이해·과정기능 표를 완성해주세요' })
    else if (!d.rows.some(r => r.isCommon)) missing.push({ label: '공통(팀 조정) 행', hint: '교과 간 공통 요소를 정리한 통합 행을 추가해주세요' })
  } else if (schema === 'A-2-2') {
    const d = data as unknown as A22Structured
    if (!d.subjectGoals?.length) missing.push({ label: '교과별 세부 목표', hint: '각 교과의 학습 목표를 정해주세요' })
    if (!d.integratedGoals?.length) missing.push({ label: '통합 학습목표', hint: '교과를 아우르는 통합 목표 3~5개를 진술해주세요' })
  } else if (schema === 'A-2-3') {
    const d = data as unknown as A23Structured
    if (!d.commonProfile?.length) missing.push({ label: '학습자 프로필', hint: '선수지식, 오개념, 환경 제약 등을 정리해주세요' })
  }

  return missing
}

export function isStructuredArtifact(content: Record<string, unknown>): boolean {
  return typeof content._schema === 'string'
}

export function getArtifactSchema(content: Record<string, unknown>): string | null {
  return typeof content._schema === 'string' ? content._schema : null
}
