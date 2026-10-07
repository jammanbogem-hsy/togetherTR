// 팀원 내보내기 — 방장 전용. 채팅 명령 해석과 Firestore 변경 계획을 순수 함수로 둔다(ChatPanel·팀원 목록 공용).
// 명령 문장과 확인 카드는 저장하지 않는다(방장 화면 로컬 상태). 결과 기록은 project.memberRemovals 하나.

export type MemberRef = { uid: string; displayName: string; color?: string; emoji?: string }

type MemberSource = {
  memberUids?: readonly string[]
  memberInfo?: Record<string, { displayName?: string; color?: string; emoji?: string } | undefined>
  hostUid?: string
  createdBy?: string
  artifactConfirmations?: Record<string, unknown>
  teamGradeBandProposals?: Record<string, unknown>
  hostRequests?: Record<string, unknown>
}

export type MemberCommand =
  | { kind: 'none' }
  | { kind: 'not-host' }
  | { kind: 'not-found'; query: string }
  | { kind: 'self' }
  | { kind: 'host-target'; target: MemberRef }
  | { kind: 'confirm'; target: MemberRef }
  | { kind: 'choose'; query: string; candidates: MemberRef[] }

export type MemberAdminError =
  | 'project-not-found' | 'not-host' | 'target-not-member' | 'cannot-remove-self' | 'cannot-remove-host'

export const MEMBER_ADMIN_ERROR_COPY: Record<MemberAdminError, string> = {
  'project-not-found': '프로젝트를 찾지 못했어요. 새로고침 뒤 다시 시도해 주세요.',
  'not-host': '팀원 내보내기는 기록 담당만 할 수 있어요.',
  'target-not-member': '이미 방에 없는 선생님이에요.',
  'cannot-remove-self': '기록 담당 자신은 내보낼 수 없어요.',
  'cannot-remove-host': '기록 담당은 내보낼 수 없어요.',
}

// 팀원이 남긴 표 커서·본문 커서 문서(이름이 …Presence 인 하위 컬렉션)
export const MEMBER_PRESENCE_COLLECTIONS = [
  'teamVisionPresence', 'integratedGoalPresence', 'lessonDesignDirectionPresence', 'lessonDesignDirectionDocumentPresence',
  'evaluationPlanPresence', 'problemSituationWorkspacePresence', 'supportToolWorkspacePresence', 'roleDistributionPresence',
  'teamRulesPresence', 'teamSchedulePresence', 'topicSelectionPresence', 'learningActivityPresence', 'scaffoldingPresence',
  'materialDevPresence', 'lessonRecordPresence', 'lessonReflectionPresence', 'collaborationReflectionPresence',
] as const

export function isProjectHost(project: MemberSource | null | undefined, uid: string | null | undefined): boolean {
  return !!project && !!uid && (project.hostUid === uid || project.createdBy === uid)
}

function members(project: MemberSource): MemberRef[] {
  const uids = [...new Set([...(project.memberUids ?? [])])]
  return uids.map(uid => {
    const info = project.memberInfo?.[uid]
    return { uid, displayName: info?.displayName?.trim() || '', color: info?.color, emoji: info?.emoji }
  })
}

const HONORIFIC = /(선생님|선생|쌤|님)$/
const normalizeName = (name: string) => name.replace(/\s+/g, '').replace(HONORIFIC, '')

/** 이름으로 팀원 찾기 — 정확히 같은 이름이 있으면 그것만, 없으면 2글자 이상 부분 일치. */
export function findMembersByName(project: MemberSource, query: string): MemberRef[] {
  const q = normalizeName(query)
  if (!q) return []
  const named = members(project).filter(member => member.displayName)
  const exact = named.filter(member => normalizeName(member.displayName) === q)
  if (exact.length) return exact
  if (q.length < 2) return []
  return named.filter(member => {
    const name = normalizeName(member.displayName)
    return name.length >= 2 && (name.includes(q) || q.includes(name))
  })
}

const VERB = /(내보내|강퇴|추방|나가게|빼|제외)/
const STRONG_VERB = /^(내보내|강퇴|추방)/
// 동사 뒤에 올 수 있는 말 — 명령 어미만('나가게 하는 활동은 어때요' 같은 설계 문장 제외)
const COMMAND_ENDING = /^\s*(기|요|줘|줘요|주세요|줄래|줄래요|주실래요|주시겠어요|주라|라|자|해|해요|하자|시켜|버려)?\s*((해|시켜)\s*)?(줘|줘요|주세요|줄래|줄래요|주실래요|주시겠어요|주라)?$/
const ROOM = /(우리\s*|이\s*)?(방|팀)에서/g
const TRAILING = /\s*(좀|을|를|은|는|이|가|선생님|선생|쌤|님)\s*$/

/**
 * 채팅 문장이 '팀원 내보내기' 명령인지 판정한다. 명령이 아니면 { kind: 'none' } → 평소대로 AI 호출.
 * '내보내/강퇴/방에서 빼·나가게'는 명령, 단순 '빼 줘/제외해 줘'는 대상이 실제 팀원 이름이거나
 * '선생님·쌤'이 붙을 때만 명령으로 본다('이 문장 빼 줘' 같은 일반 요청 오탐 방지).
 */
export function classifyMemberCommand(text: string, project: MemberSource | null | undefined, myUid: string | null | undefined): MemberCommand {
  const t = text.trim().replace(/[.!?~\s]+$/, '')
  if (!project || !t || t.length > 60) return { kind: 'none' }
  const verbAt = t.search(VERB)
  if (verbAt <= 0) return { kind: 'none' }
  const tail = t.slice(verbAt)
  const verb = tail.match(VERB)![0]
  // 동사 뒤에는 '줘·주세요·해 주세요·시켜 줘' 같은 명령 어미만 허용한다.
  if (!COMMAND_ENDING.test(tail.slice(verb.length))) return { kind: 'none' }
  let head = t.slice(0, verbAt)
  const strong = STRONG_VERB.test(verb) || ROOM.test(head)
  ROOM.lastIndex = 0
  head = head.replace(ROOM, ' ')
  let honorific = false
  for (let guard = 0; guard < 4; guard++) {
    const match = head.match(TRAILING)
    if (!match) break
    if (/(선생님|선생|쌤|님)/.test(match[1])) honorific = true
    head = head.slice(0, head.length - match[0].length)
  }
  const query = head.replace(/\s+/g, '')
  if (/\s/.test(head.trim()) && !honorific && !strong) return { kind: 'none' } // 여러 낱말인 일반 문장
  const matches = query ? findMembersByName(project, query) : []
  if (!strong && !honorific && matches.length === 0) return { kind: 'none' }
  if (!isProjectHost(project, myUid)) return { kind: 'not-host' }
  if (matches.length === 0) return { kind: 'not-found', query }
  const candidates = matches.filter(member => member.uid !== myUid && !isProjectHost(project, member.uid))
  if (candidates.length === 0) {
    return matches.some(member => member.uid === myUid) ? { kind: 'self' } : { kind: 'host-target', target: matches[0] }
  }
  if (candidates.length === 1) return { kind: 'confirm', target: candidates[0] }
  return { kind: 'choose', query, candidates }
}

export function memberCommandText(command: MemberCommand): string {
  switch (command.kind) {
    case 'none': return ''
    case 'not-host': return MEMBER_ADMIN_ERROR_COPY['not-host']
    case 'not-found': return command.query
      ? `'${command.query}' 이름의 팀원을 찾지 못했어요. 팀원 목록의 이름으로 다시 말해 주세요.`
      : '내보낼 선생님 이름을 함께 말해 주세요.'
    case 'self': return MEMBER_ADMIN_ERROR_COPY['cannot-remove-self']
    case 'host-target': return MEMBER_ADMIN_ERROR_COPY['cannot-remove-host']
    case 'confirm': return `${command.target.displayName} 선생님을 이 방에서 내보낼까요? 남긴 대화와 산출물은 남습니다.`
    case 'choose': return '같은 이름이 여러 명이에요. 내보낼 선생님을 골라 주세요.'
  }
}

export function memberRemovedText(target: Pick<MemberRef, 'displayName'>): string {
  return `${target.displayName} 선생님이 방에서 나갔어요.`
}

export type MemberRemovalPlan =
  | { ok: false; error: MemberAdminError }
  | { ok: true; target: MemberRef; deleteFieldPaths: string[] }

/** 내보내기 전 검사와 지울 필드 목록. 대화·산출물은 건드리지 않는다. */
export function planMemberRemoval(project: MemberSource | null | undefined, byUid: string, targetUid: string): MemberRemovalPlan {
  if (!project) return { ok: false, error: 'project-not-found' }
  if (!isProjectHost(project, byUid)) return { ok: false, error: 'not-host' }
  if (targetUid === byUid) return { ok: false, error: 'cannot-remove-self' }
  if (isProjectHost(project, targetUid)) return { ok: false, error: 'cannot-remove-host' }
  if (!(project.memberUids ?? []).includes(targetUid)) return { ok: false, error: 'target-not-member' }
  const target = members(project).find(member => member.uid === targetUid)!
  const deleteFieldPaths = [`memberInfo.${targetUid}`]
  if (project.artifactConfirmations && targetUid in project.artifactConfirmations) deleteFieldPaths.push(`artifactConfirmations.${targetUid}`)
  if (project.teamGradeBandProposals && targetUid in project.teamGradeBandProposals) deleteFieldPaths.push(`teamGradeBandProposals.${targetUid}`)
  if (project.hostRequests && targetUid in project.hostRequests) deleteFieldPaths.push(`hostRequests.${targetUid}`)
  return { ok: true, target, deleteFieldPaths }
}
