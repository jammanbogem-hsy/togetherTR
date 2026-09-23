'use client'

/**
 * 성취수준 화면 검증 라우트 (/dev/achievement-levels)
 *
 * 목적: 로그인·프로젝트 없이 픽스처 산출물로 성취수준 UI를 실제 렌더링해 확인한다.
 *   - A-2-1 산출물 표의 "성취수준 A·B·C 보기"
 *   - Ds 단계 산출물 패널의 "성취기준 정렬 점검" 카드(빈칸·A 수준 경고 포함)
 * UI는 검증용으로만 최소 구성 (/dev/curriculum-map 과 같은 관례).
 */

import { A21Renderer } from '@/components/artifacts/structured/A21Renderer'
import { AlignmentMatrixCard } from '@/components/curriculum/AlignmentMatrixCard'

const A21_FIXTURE = {
  _schema: 'A-2-1',
  rows: [
    {
      subject: '사회 ★중심',
      coreIdea: '사회 변화와 문화 다양성',
      standard: '[4사03-02] 우리 사회에 다양한 문화가 확산되면서 나타나는 긍정적 효과와 문제를 분석하고, 나와 다른 사람이나 집단의 문화를 존중하는 태도를 기른다.',
      knowledgeUnderstanding: '문화 다양성',
      processFunction: '분석하기',
      valueAttitude: '존중',
    },
    {
      subject: '국어',
      coreIdea: '듣기·말하기',
      standard: '[4국01-01] 중요한 내용과 주제를 파악하며 듣고 그 내용을 요약한다.',
      knowledgeUnderstanding: '요약',
      processFunction: '듣기',
      valueAttitude: '경청',
    },
    {
      subject: '수학',
      coreIdea: '자료와 가능성',
      standard: '[4수04-01] 자료를 수집하여 간단한 그림그래프나 막대그래프로 나타내고, 그래프를 해석할 수 있다.',
      knowledgeUnderstanding: '그래프',
      processFunction: '해석하기',
      valueAttitude: '',
    },
  ],
  reconstructedStandard: '다문화 이웃의 이야기를 듣고 요약하며, 문화 확산의 효과와 문제를 자료로 분석해 존중하는 태도를 기른다.',
}

const ARTIFACTS = {
  'A-2-1': { content: A21_FIXTURE as unknown as Record<string, unknown> },
  'Ds-1-1': {
    content: {
      _schema: 'Ds-1-1',
      rubric: [
        { checkpoint: '인터뷰 직후', item: '인터뷰 내용을 요약한다 ([4국01-01])', method: '기록지', timing: '과정', actor: '교사' },
        { checkpoint: '책자 발표', item: '효과와 문제를 분석한다 ([4사03-02])', method: '루브릭', timing: '결과', actor: '교사', high: '[4사03-02] A' },
      ],
    },
  },
  'Ds-1-3': {
    content: {
      _schema: 'Ds-1-3',
      activities: [
        { order: '1', phase: '정보 탐색', name: '이웃 인터뷰하기', description: '인터뷰를 듣고 요약한다. (근거: [4국01-01] B)', coreType: '핵심', subject: '국어', session: '1~2차시', operation: '' },
        { order: '2', phase: '분석', name: '자료 비교하기', description: '여러 자료로 효과와 문제를 도출한다. (근거: [4사03-02] A)', coreType: '핵심', subject: '사회', session: '3차시', operation: '' },
      ],
    },
  },
}

export default function AchievementLevelsDevPage() {
  return (
    <main className="mx-auto max-w-5xl space-y-8 bg-[#F1F3F4] p-6">
      <h1 className="text-lg font-bold text-[#202124]">성취수준 UI 검증 (픽스처)</h1>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-[#5F6368]">A-2-1 산출물 표 — 성취수준 펼쳐 보기</h2>
        <A21Renderer data={A21_FIXTURE as never} />
      </section>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-[#5F6368]">Ds 단계 — 성취기준 정렬 점검 ([4수04-01]은 일부러 빈칸, [4국01-01]은 A 수준 활동 없음)</h2>
        <AlignmentMatrixCard artifacts={ARTIFACTS} />
      </section>
    </main>
  )
}
