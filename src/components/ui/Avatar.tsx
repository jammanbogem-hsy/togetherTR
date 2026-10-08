'use client'

import { Sparkle } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'
import { profileAvatarSrc } from '@/lib/profile/avatars'

// ─── Google 계정 프로필 스타일 아바타 ─────────────────────
// Google Workspace(Gmail·Drive·Docs) 아바타 규칙:
//  - 정원(perfect circle), 단색 채움, 그림자·테두리 없음(=flat)
//  - **채도 높은 배경 + 흰색 글자** — 파스텔+먹색 조합은 Google 룩이 아니다
//  - 이름 첫 글자 1개, weight 500, 크기는 지름의 약 45%
//
// 저장된 프로필 색(lib/auth.ts AVATAR_COLORS)은 PCCS 파스텔이라 그대로 쓰면
// '스티커' 느낌이 난다. Firestore 데이터(memberInfo[uid].color)는 건드리지 않고
// **표시 단계에서만** 같은 색상환 위치의 Google 채도 톤으로 치환한다.
// → 사용자별 색 정체성(빨강 계열은 계속 빨강)은 유지되고 룩만 바뀐다.
const GOOGLE_TONES: Record<string, string> = {
  '#F4AAAA': '#C5221F', // 로즈핑크 → Red 700
  '#F4C2A0': '#BF360C', // 살구     → Deep Orange 900
  '#F4DAA0': '#B06000', // 복숭아   → Amber 800
  '#F4ECA0': '#8D6E00', // 크림     → Yellow 900
  '#CCECA0': '#558B2F', // 연두     → Light Green 800
  '#A0E8B8': '#0B8043', // 민트그린 → Green 700
  '#A0DCE8': '#00838F', // 하늘     → Cyan 800
  '#A0BCE8': '#0B57D0', // 코른플라워 → Blue 700
  '#BAA0E8': '#3949AB', // 라벤더   → Indigo 600
  '#D4A0E8': '#7B1FA2', // 연보라   → Purple 700
  '#E8A0CC': '#AD1457', // 연분홍   → Pink 800
  '#A0E8D8': '#00796B', // 아쿠아   → Teal 700
}

// 팔레트 밖의 색(레거시·데모 데이터)을 위한 폴백 — 색상값 해시로 결정적 배정
const TONE_LIST = Object.values(GOOGLE_TONES)

/** 저장된 프로필 색 → Google 채도 톤. 이미 채도 톤이면 그대로 통과. */
export function googleAvatarTone(color: string): string {
  const key = color?.trim().toUpperCase()
  if (GOOGLE_TONES[key]) return GOOGLE_TONES[key]
  if (TONE_LIST.includes(key)) return key
  let h = 0
  for (let i = 0; i < (key?.length ?? 0); i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return TONE_LIST[h % TONE_LIST.length]
}

export function Avatar({
  name,
  color = '#A0BCE8',
  size = 32,
  label,
  title,
  className,
  ai = false,
  avatarId,
  photoURL,
}: {
  /** 표시 이름 — 첫 글자만 사용 */
  name?: string
  /** 배경색 (프로필 색) */
  color?: string
  /** 지름(px) */
  size?: number
  /** name 대신 직접 표시할 문자열 (예: 'AI') */
  label?: string
  title?: string
  className?: string
  /** AI 아바타 — Google 블루 + 스파클 마크 (Gemini 계열 관례) */
  ai?: boolean
  avatarId?: string
  photoURL?: string
}) {
  const imageSrc = ai ? undefined : profileAvatarSrc(avatarId) ?? (avatarId ? undefined : photoURL)
  const bg = ai ? '#1A73E8' : googleAvatarTone(color)
  const initial = label ?? (name?.trim()?.[0]?.toUpperCase() ?? '?')

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-medium tabular-nums',
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: imageSrc ? 'transparent' : bg,
        color: '#FFFFFF',
        fontSize: Math.round(size * 0.45),
        lineHeight: 1,
      }}
      title={title ?? (ai ? 'AI 공동설계자' : name)}
      aria-hidden="true"
    >
      {imageSrc
        // Small, pre-optimized local avatar assets do not need a remote image transform.
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={imageSrc} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-full w-full rounded-full object-contain" />
        : ai
        ? <Sparkle size={Math.round(size * 0.5)} weight="fill" />
        : initial}
    </div>
  )
}

/** 아바타 + 이름 — 헤더 등에서 현재 사용자를 표시할 때 */
export function AvatarChip({
  name,
  color,
  size = 32,
  className,
}: {
  name?: string
  color?: string
  size?: number
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-2 pl-0.5 pr-1', className)}>
      <Avatar name={name} color={color} size={size} />
      <span className="text-[13px] font-medium text-[#3C4043] max-w-[8rem] truncate">{name}</span>
    </div>
  )
}
