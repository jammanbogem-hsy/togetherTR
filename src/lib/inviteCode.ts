const COLORS = ['파란', '빨간', '초록', '노란', '보라', '주황', '분홍', '하늘', '금빛', '은빛']
const ANIMALS = ['고양이', '강아지', '토끼', '사자', '호랑이', '곰', '여우', '펭귄', '다람쥐', '사슴', '독수리', '돌고래']

export function generateInviteCode(): string {
  const color = COLORS[Math.floor(Math.random() * COLORS.length)]
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)]
  return color + animal
}

// localStorage: 참여한 프로젝트 ID 목록
const LS_MEMBERSHIPS_KEY = 'tcid_memberships'

export function getJoinedProjectIds(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(LS_MEMBERSHIPS_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function addJoinedProjectId(projectId: string) {
  const ids = getJoinedProjectIds()
  if (!ids.includes(projectId)) {
    localStorage.setItem(LS_MEMBERSHIPS_KEY, JSON.stringify([...ids, projectId]))
  }
}
