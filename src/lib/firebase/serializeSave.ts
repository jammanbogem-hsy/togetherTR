// 같은 공동 편집 필드의 저장을 이 기기에서 순서대로 실행한다(#T7).
// 저장은 getDoc → 패치 적용 → updateDoc(필드 통째) 구조라, 빠르게 연달아 저장하면 뒤 저장이 앞 저장 반영 전의
// 문서를 읽어 앞 칸을 옛 값으로 덮었다. 트랜잭션은 자기 저장끼리 충돌·재시도 지연(2026-05-14 lag fix)이 있어
// 쓰지 않고, 같은 필드 저장을 줄 세워 앞 저장이 끝난 뒤 다음 저장이 문서를 읽게 한다.
const chains = new Map<string, Promise<unknown>>()

export function serializeWorkspaceSave<T>(projectId: string, field: string, run: () => Promise<T>): Promise<T> {
  const key = `${projectId}:${field}`
  const previous = chains.get(key) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(run)
  chains.set(key, next)
  next.then(
    () => { if (chains.get(key) === next) chains.delete(key) },
    () => { if (chains.get(key) === next) chains.delete(key) },
  )
  return next
}
