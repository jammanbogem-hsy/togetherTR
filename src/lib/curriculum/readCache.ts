// 동기 컨텍스트 생성 한 번 안에서만 개발 모드의 JSON 읽기·가공을 공유한다.
// 요청이 끝나면 버려서 다음 요청에는 원본 파일 변경을 그대로 반영한다.
let activeReadCache: Map<string, unknown> | null = null

export function withCurriculumReadCache<T>(read: () => T): T {
  if (process.env.NODE_ENV !== 'development' || activeReadCache) return read()
  activeReadCache = new Map()
  try {
    return read()
  } finally {
    activeReadCache = null
  }
}

export function readOncePerCurriculumContext<T>(key: string, read: () => T): T {
  if (!activeReadCache) return read()
  if (activeReadCache.has(key)) return activeReadCache.get(key) as T
  const value = read()
  activeReadCache.set(key, value)
  return value
}
