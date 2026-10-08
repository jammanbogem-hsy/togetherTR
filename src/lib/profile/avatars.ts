/** Stable, allowlisted asset IDs; stored profiles never supply an arbitrary URL. */
export const PROFILE_AVATARS = [
  ['smile', '방긋'], ['laugh', '깔깔'], ['wink', '윙크'], ['heart', '하트'],
  ['sunglasses', '멋쟁이'], ['thumbs-up', '엄지척'], ['victory', '브이'], ['hug', '포옹'],
  ['thinking', '생각 중'], ['surprised', '깜짝'], ['sleepy', '졸려요'], ['blush', '수줍음'],
  ['celebrate', '축하해요'], ['starry', '반짝반짝'], ['calm', '평온'], ['grateful', '고마워요'],
  ['clapping', '박수'], ['focused', '집중'], ['reading', '책 친구'], ['idea', '번뜩'],
  ['sprout', '새싹'], ['flower', '꽃 선물'], ['music', '음악 친구'], ['rainbow', '무지개'],
  ['cat', '고양이'], ['panda', '판다'], ['fox', '여우'], ['cheering', '응원'],
  ['curious', '호기심'], ['proud', '뿌듯해요'],
] as const

export type ProfileAvatarId = typeof PROFILE_AVATARS[number][0] | 'initials'
export function isProfileAvatarId(id: unknown): id is ProfileAvatarId {
  return id === 'initials' || PROFILE_AVATARS.some(([key]) => key === id)
}
export function profileAvatarSrc(id: unknown): string | undefined {
  return isProfileAvatarId(id) && id !== 'initials' ? `/avatars/${id}.webp` : undefined
}
