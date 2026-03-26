export interface UserProfile {
  uid: string
  displayName: string
  color: string
  emoji: string
  createdAt: number
}

// PCCS 파스텔톤 (p톤 — 彩度 낮고 明度 높음, 색상환 균등 배치)
const AVATAR_COLORS = [
  '#F4AAAA', // p2R   — 연장미 (로즈핑크)
  '#F4C2A0', // p4YR  — 살구 (피치)
  '#F4DAA0', // p6YR  — 복숭아 (크리미 오렌지)
  '#F4ECA0', // p8Y   — 크림 (버터 옐로)
  '#CCECA0', // p12YG — 연두 (라임)
  '#A0E8B8', // p16G  — 민트그린
  '#A0DCE8', // p20B  — 하늘 (스카이블루)
  '#A0BCE8', // p22B  — 코른플라워 (라벤더블루)
  '#BAA0E8', // p24PB — 라벤더
  '#D4A0E8', // p26P  — 연보라 (라일락)
  '#E8A0CC', // p28RP — 연분홍 (핑크)
  '#A0E8D8', // p18BG — 아쿠아 (민트)
]
const AVATAR_EMOJIS = ['🍎', '🌿', '🌊', '☀️', '🌸', '🍊', '⭐', '🦋', '🎯', '🌙', '🔥', '🌈']

// UID 전체를 사용한 분산 해시 (앞 2자리 'u_' 고정 문제 해결)
function hashUid(uid: string): number {
  let h = 0
  for (let i = 2; i < uid.length; i++) {  // 'u_' 이후부터 사용
    h = (h * 31 + uid.charCodeAt(i)) >>> 0
  }
  return h
}
function getColorForUid(uid: string): string {
  return AVATAR_COLORS[hashUid(uid) % AVATAR_COLORS.length]
}
function getEmojiForUid(uid: string): string {
  return AVATAR_EMOJIS[(hashUid(uid) >> 4) % AVATAR_EMOJIS.length]
}

function generateUid(): string {
  return 'u_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

const LS_PROFILE_KEY = 'tcid_user_profile'

export function getLocalProfile(): UserProfile | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(LS_PROFILE_KEY)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export function saveLocalProfile(profile: UserProfile) {
  localStorage.setItem(LS_PROFILE_KEY, JSON.stringify(profile))
}

export async function signInWithNickname(displayName: string): Promise<UserProfile> {
  // Firebase Auth 없이 로컬 UID 생성
  const uid = generateUid()
  const profile: UserProfile = {
    uid,
    displayName,
    color: getColorForUid(uid),
    emoji: getEmojiForUid(uid),
    createdAt: Date.now(),
  }
  saveLocalProfile(profile)
  return profile
}

// 구 팔레트 색상 — 이 색상이면 파스텔로 갱신
const LEGACY_COLORS = new Set([
  '#3B82F6','#8B5CF6','#EC4899','#10B981','#F59E0B',
  '#EF4444','#06B6D4','#84CC16','#F97316','#6366F1','#14B8A6','#E11D48',
])

export async function getOrRestoreProfile(): Promise<UserProfile | null> {
  const profile = getLocalProfile()
  if (!profile) return null
  // 구 팔레트 색상이면 새 파스텔 색상으로 갱신 후 저장
  if (LEGACY_COLORS.has(profile.color)) {
    const updated = {
      ...profile,
      color: getColorForUid(profile.uid),
      emoji: getEmojiForUid(profile.uid),
    }
    saveLocalProfile(updated)
    return updated
  }
  return profile
}
