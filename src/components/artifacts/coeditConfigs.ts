// DI·E 공동 편집 세션 설정 — 가이드 20260804 §4(개발·실행)·§5(평가) 기준.
// 각 설정은 "표에 무엇을 담을지"와 "그것이 어떤 산출물 섹션이 되는지"만 정의한다.
// 표 UI·실시간 동기화는 CoeditWorkspaceModal이 공통 처리.
//
// ⚠️ 산출물 섹션 키는 ACTIVITY_META의 required/recommendedSections 키와 **문자 단위로 일치**해야 한다.
//    완료 판정·보고서·주기 전환 파서가 같은 키를 읽는다.

import type { CoeditWorkspace } from '@/types'
import { columnToList, findTableBlock, tableToMarkdown, type CoeditModalConfig } from './CoeditWorkspaceModal'

/** DI-1-1 자료 탐색·개발 — 자료 워크스루 보드 (가이드 p56~57) */
export const MATERIAL_DEV_CONFIG: CoeditModalConfig = {
  activityCode: 'DI-1-1',
  title: '자료 탐색·개발 공동 편집',
  subtitle: '"이건 일을 늘리는 게 아니라 나누는 일" — 중복 제작을 덜고, 완성한 자료는 동료가 학생 눈으로 검토합니다',
  tableTitle: '개발 자료 목록 — 무엇을 누가 언제까지',
  toArtifact: (ws: CoeditWorkspace) => ({
    '개발 자료 목록': tableToMarkdown(ws.columns, ws.rows),
  }),
}

/** DI-2-1 수업 실행·기록 — 결정적 장면 기록판 (가이드 p58~59) */
export const LESSON_RECORD_CONFIG: CoeditModalConfig = {
  activityCode: 'DI-2-1',
  title: '수업 실행·기록 공동 편집',
  subtitle: '기록은 정교할 필요 없습니다 — 예상과 달랐던 장면을 남기세요. 깊은 분석은 평가(E) 단계에서 합니다',
  tableTitle: '결정적 장면 기록 — 무엇이 설계와 달랐는가',
  toArtifact: (ws: CoeditWorkspace) => {
    const planTable = findTableBlock(ws.blocks, 'plan-table')
    const plan = planTable ? tableToMarkdown(planTable.columns, planTable.rows) : ''
    const scenes = tableToMarkdown(ws.columns, ws.rows)
    return {
      // 실행 계획이 있으면 기록 앞에 붙여 "누가 언제 했는지"까지 산출물에 남긴다
      '주요 상황 기록': [plan && `**수업 실행 계획**\n\n${plan}`, scenes && `**결정적 장면 기록**\n\n${scenes}`]
        .filter(Boolean).join('\n\n'),
      'E단계 확인 질문': columnToList(ws.rows, 'question'),
    }
  },
}

/** E-1-1 수업 성찰과 공동 개선 — 증거 검토판 (가이드 p65~66) */
export const LESSON_REFLECTION_CONFIG: CoeditModalConfig = {
  activityCode: 'E-1-1',
  title: '수업 성찰·공동 개선 공동 편집',
  subtitle: '각자 세 종류의 샘플만 — 목표 도달 하나, 오개념 하나, 예상 밖 반응 하나. 자료를 가운데 두고 함께 봅니다',
  tableTitle: '학생 증거 — 무엇을 배웠고 어디서 갈렸는가',
  toArtifact: (ws: CoeditWorkspace) => {
    const improve = findTableBlock(ws.blocks, 'improve-table')
    const rows = improve?.rows ?? []
    // 사실 = 학생 증거 표 / 해석 = 어려움과 그 원인 / 수정안 = 수정 내용과 이유
    const 해석 = rows
      .map(r => {
        const d = (r.cells?.difficulty ?? '').trim()
        const c = (r.cells?.cause ?? '').trim()
        return d || c ? `- ${d || '(지점 미기재)'} → 원인: ${c || '(원인 미기재)'}` : ''
      })
      .filter(Boolean).join('\n')
    const 수정안 = rows
      .map(r => {
        const f = (r.cells?.fix ?? '').trim()
        const w = (r.cells?.why ?? '').trim()
        const p = (r.cells?.where ?? '').trim()
        if (!f && !w) return ''
        return `- ${f || '(수정 내용 미기재)'} — 이유: ${w || '(이유 미기재)'}${p ? ` (반영: ${p})` : ''}`
      })
      .filter(Boolean).join('\n')
    return {
      '사실': tableToMarkdown(ws.columns, ws.rows),
      '해석': 해석,
      '수정안': 수정안,
    }
  },
}

/** E-2-1 협력 과정 성찰 — 합의 대조판 (가이드 p68~69) */
export const COLLABORATION_REFLECTION_CONFIG: CoeditModalConfig = {
  activityCode: 'E-2-1',
  fillExistingRowsOnly: true,  // 초기 합의 5행은 T단계 산출물에서 온 것 — AI가 행을 늘리지 않는다
  title: '협력 과정 성찰 공동 편집',
  subtitle: '잘잘못이 아니라 구조를 봅니다 — "확인이 늦었다"가 아니라 "확인 여부를 알 장치가 없었다"로',
  tableTitle: 'T단계 합의 대조 — 무엇을 약속했고 실제로 어땠는가',
  toArtifact: (ws: CoeditWorkspace) => ({
    '협력 과정 성찰': tableToMarkdown(ws.columns, ws.rows),
    '팀 개선안': columnToList(ws.rows, 'principle'),
  }),
}
