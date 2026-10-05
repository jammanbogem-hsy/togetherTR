import {
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '@/lib/firebase/config'

export interface UserProfile {
  uid: string
  displayName: string
  email?: string
  photoURL?: string
  color: string
  emoji: string
  createdAt: number
  // 교사 프로필
  schoolLevel?: '초등' | '중등' | '고등'
  schoolName?: string
  grade?: string
  /** 개인정보 동의 기록(src/lib/privacy/consent.ts) — 없거나 버전이 다르면 동의 화면 */
  privacyConsent?: { version: string; agreedAt: unknown; items: Array<'collect' | 'overseas'> }
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

// UID 전체를 사용한 분산 해시
function hashUid(uid: string): number {
  let h = 0
  const start = uid.startsWith('u_') ? 2 : 0
  for (let i = start; i < uid.length; i++) {
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

const LS_PROFILE_KEY = 'tcid_user_profile'

// ─── 세션 만료 (보안) ─────────────────────────────────────────────────────────
// 로그인 후 24시간이 지나면 다음 페이지 진입 시 자동 로그아웃 (절대 만료).
// 멀티탭 사용(보고서 새 탭 등)을 위해 브라우저 세션 지속성 대신 타임스탬프 방식 사용.
const LS_SESSION_KEY = 'tcid_session_started'
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000

export function markSessionStarted() {
  if (typeof window === 'undefined') return
  localStorage.setItem(LS_SESSION_KEY, String(Date.now()))
}

function clearSessionStarted() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(LS_SESSION_KEY)
}

/** 세션 만료 여부 — 타임스탬프가 없으면(구버전 로그인) 만료로 간주해 1회 재로그인 유도. */
export function isSessionExpired(): boolean {
  if (typeof window === 'undefined') return false
  const raw = localStorage.getItem(LS_SESSION_KEY)
  if (!raw) return true
  const started = Number(raw)
  if (!Number.isFinite(started)) return true
  return Date.now() - started > SESSION_MAX_AGE_MS
}

/** 만료 시 완전 로그아웃 처리 후 true 반환. */
async function expireSessionIfNeeded(): Promise<boolean> {
  if (!isSessionExpired()) return false
  try { await firebaseSignOut(auth) } catch { /* 이미 로그아웃 상태 등 — 무시 */ }
  clearLocalProfile()
  clearSessionStarted()
  return true
}

export function getLocalProfile(): UserProfile | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(LS_PROFILE_KEY)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export function saveLocalProfile(profile: UserProfile) {
  localStorage.setItem(LS_PROFILE_KEY, JSON.stringify(profile))
}

export function clearLocalProfile() {
  localStorage.removeItem(LS_PROFILE_KEY)
}

// ─── Firestore 프로필 ─────────────────────────────────────────────────────────

export async function loadFirestoreProfile(uid: string): Promise<UserProfile | null> {
  try {
    const snap = await getDoc(doc(db, 'users', uid))
    if (!snap.exists()) return null
    return snap.data() as UserProfile
  } catch {
    return null
  }
}

// Firestore는 undefined 필드를 거부 — 제거 후 저장
function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) clean[k] = v
  }
  return clean
}

export async function saveFirestoreProfile(profile: UserProfile): Promise<void> {
  // 필수 필드 누락 방어 (Firestore 로드 시 구 프로필에 없을 수 있음)
  const safe = {
    ...profile,
    color: profile.color || getColorForUid(profile.uid),
    emoji: profile.emoji || getEmojiForUid(profile.uid),
    updatedAt: serverTimestamp(),
  }
  const data = stripUndefined(safe)
  await setDoc(doc(db, 'users', profile.uid), data, { merge: true })
}

// ─── Google 로그인 ────────────────────────────────────────────────────────────

const googleProvider = new GoogleAuthProvider()

/**
 * Google 팝업 로그인.
 * 기존 Firestore 프로필이 있으면 반환 (프로필 입력 스킵).
 * 없으면 null 반환 — 호출자가 프로필 입력 UI를 표시해야 함.
 */
export async function signInWithGoogle(): Promise<{
  firebaseUser: User
  existingProfile: UserProfile | null
}> {
  const result = await signInWithPopup(auth, googleProvider)
  const user = result.user
  markSessionStarted() // 24시간 세션 시작 시점 기록
  const existingProfile = await loadFirestoreProfile(user.uid)
  return { firebaseUser: user, existingProfile }
}

/**
 * 프로필 완성 후 저장.
 * Firebase Auth 사용자 정보 + 입력 필드를 합쳐 Firestore + localStorage에 저장.
 */
export async function completeProfile(
  firebaseUser: User,
  fields: {
    displayName: string
    schoolLevel: '초등' | '중등' | '고등'
    schoolName: string
    grade: string
  }
): Promise<UserProfile> {
  const profile: UserProfile = {
    uid: firebaseUser.uid,
    displayName: fields.displayName,
    email: firebaseUser.email ?? undefined,
    photoURL: firebaseUser.photoURL ?? undefined,
    color: getColorForUid(firebaseUser.uid),
    emoji: getEmojiForUid(firebaseUser.uid),
    createdAt: Date.now(),
    schoolLevel: fields.schoolLevel,
    schoolName: fields.schoolName,
    grade: fields.grade,
  }
  await saveFirestoreProfile(profile)
  saveLocalProfile(profile)
  return profile
}

export async function signOut(): Promise<void> {
  await firebaseSignOut(auth)
  clearLocalProfile()
  clearSessionStarted()
}

// ─── 세션 복원 ────────────────────────────────────────────────────────────────

/**
 * 앱 진입 시 Firebase Auth 상태로 프로필 복원.
 * 1) localStorage 캐시 확인 (빠른 초기 렌더)
 * 2) Firebase Auth onAuthStateChanged → Firestore 프로필 로드
 */
export function onProfileRestored(
  callback: (profile: UserProfile | null) => void
): () => void {
  return onAuthStateChanged(auth, async (user) => {
    // 24시간 절대 만료 — 만료됐으면 로그아웃 처리 후 비로그인으로 응답
    if (user && (await expireSessionIfNeeded())) {
      callback(null)
      return
    }
    if (!user) {
      // 비로그인: localStorage 캐시도 제거
      clearLocalProfile()
      callback(null)
      return
    }
    // Firestore 프로필 우선
    const firestoreProfile = await loadFirestoreProfile(user.uid)
    if (firestoreProfile) {
      // 구 프로필에 emoji/color 누락 시 보정
      if (!firestoreProfile.emoji || !firestoreProfile.color || LEGACY_COLORS.has(firestoreProfile.color)) {
        firestoreProfile.color = getColorForUid(firestoreProfile.uid)
        firestoreProfile.emoji = getEmojiForUid(firestoreProfile.uid)
      }
      saveLocalProfile(firestoreProfile)
      callback(firestoreProfile)
    } else {
      // Firestore 없음 → 프로필 입력 필요 (null 반환)
      callback(null)
    }
  })
}

// ─── 레거시 지원 (닉네임 전용 UID — 기존 사용자 마이그레이션) ──────────────────

// 구 팔레트 색상 — 이 색상이면 파스텔로 갱신
const LEGACY_COLORS = new Set([
  '#3B82F6','#8B5CF6','#EC4899','#10B981','#F59E0B',
  '#EF4444','#06B6D4','#84CC16','#F97316','#6366F1','#14B8A6','#E11D48',
])

export async function getOrRestoreProfile(): Promise<UserProfile | null> {
  const profile = getLocalProfile()
  if (!profile) return null
  // 24시간 절대 만료 — 만료됐으면 로그아웃 처리 후 비로그인으로 응답 (루트 진입 가드)
  if (await expireSessionIfNeeded()) return null
  // 구 팔레트 색상이거나 emoji 필드 누락이면 갱신 후 저장
  if (LEGACY_COLORS.has(profile.color) || !profile.emoji) {
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
