// R1 변동 배지: 산출물이 실제로 바뀐 시각(artifacts.<code>.updatedAt). 같은 내용 재저장은 시각을 바꾸지 않는다.
// '실제로 바뀜' = 제목·내용·상태(확정·검토 중·초안) 중 하나라도 다름. 확정·재편집도 바뀐 것으로 본다.

type ArtifactLike = { title?: unknown; content?: unknown; status?: unknown; updatedAt?: unknown }

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

export function sameArtifactSnapshot(current: ArtifactLike | null | undefined, next: ArtifactLike): boolean {
  return !!current
    && stable(current.title) === stable(next.title)
    && stable(current.status) === stable(next.status)
    && stable(current.content) === stable(next.content)
}

/** 저장할 updatedAt. 같은 내용이면 기존 값(없으면 undefined — 필드를 쓰지 않는다), 바뀌었으면 now. */
export function nextArtifactUpdatedAt(current: ArtifactLike | null | undefined, next: ArtifactLike, now: number): number | undefined {
  if (sameArtifactSnapshot(current, next)) {
    return typeof current?.updatedAt === 'number' ? current.updatedAt : undefined
  }
  return now
}
