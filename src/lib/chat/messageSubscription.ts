// 대화 구독(watchMessages) 내보내기 판정 — 순수 함수.
//
// 활동 경로(conversations/{활동}/messages)가 대화의 원본이고, 단계 코드 레거시 경로는 보조다.
// - 레거시 첫 스냅샷만 온 상태에서 내보내면 빈 목록이 '로드 완료'로 전달돼 환영 메시지가 다시 만들어진다(#30).
// - 반대로 레거시 첫 스냅샷까지 기다리면, 레거시 응답이 늦을 때 기존 대화가 수십 초 보이지 않는다(#33).
// 그래서 활동 경로 첫 스냅샷(또는 그 오류)을 받은 뒤부터 내보내고, 레거시는 도착하는 대로 합친다.
export function canEmitMessageSnapshot(ready: { activity: boolean; legacy: boolean }): boolean {
  return ready.activity
}
