/**
 * A-2-1 핵심아이디어 선정 API
 * ─────────────────────────────
 * 중심 성취기준의 핵심아이디어 목록과 연관 성취기준들을 받아,
 * 교육과정 DB 원문에 있는 핵심아이디어 / 지식·이해 / 과정·기능 /
 * 가치·태도만 반환합니다.
 */

import { loadGraph } from '@/lib/curriculum/graphReader'
import { isElementaryGradeGroup, loadContentSystems, loadElementaryContentSystems } from '@/lib/curriculum/contentSystemReader'
import type { GraphCenterNode, GraphRelationType, GraphSelectedStandard } from '@/lib/knowledge-graph/domain'

export const runtime = 'nodejs'
export const maxDuration = 60

interface CoreIdeaResult {
  subjectId: string
  subjectName: string
  selectedIdea: string
  allIdeas: string[]
  justification: string
}

interface StandardAnalysis {
  standardId: string
  standardLabel: string
  subjectName: string
  coreIdea: string                   // 이 성취기준에 해당하는 핵심아이디어
  knowledgeUnderstanding: string[]   // 지식·이해
  processFunction: string[]          // 과정·기능
  valueAttitude: string[]            // 가치·태도
  relationType?: GraphRelationType
  isCenterStandard: boolean
}

function normalizeCurriculumText(value: string): string {
  return value.replace(/\s+/g, '').replace(/[·⋅]/g, '⋅').trim()
}

function curriculumTextMatches(a: string, b: string): boolean {
  const na = normalizeCurriculumText(a)
  const nb = normalizeCurriculumText(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

function filterByGrade(items: string[], gradeGroup?: string): string[] {
  if (!gradeGroup) return items
  const needle = gradeGroup.replace(/^초/, '').replace(/~/g, '-').trim()
  if (!needle) return items
  const prefixed = items.filter(item => /^\d+-\d+학년군:/.test(item))
  if (prefixed.length === 0) return items
  return prefixed.filter(item => item.includes(needle))
}

function isSelectionCurriculum(curriculum: string): boolean {
  return curriculum.trim().startsWith('선택 중심 교육과정')
}

function scoreChoice(choice: string, query: string): number {
  const queryTokens = new Set((query.match(/[가-힣A-Za-z0-9]+/g) ?? []).map(token => token.toLowerCase()))
  return (choice.match(/[가-힣A-Za-z0-9]+/g) ?? [])
    .map(token => token.toLowerCase())
    .reduce((score, token) => score + (queryTokens.has(token) ? 3 : [...queryTokens].some(q => q.includes(token) || token.includes(q)) ? 1 : 0), 0)
}

function selectDbCoreIdea(ideas: string[], query: string): string {
  const candidates = [...new Set(ideas.filter(Boolean))]
  if (candidates.length <= 1) return candidates[0] ?? ''
  return candidates
    .map(idea => ({ idea, score: scoreChoice(idea, query) }))
    .sort((a, b) => b.score - a.score)[0]?.idea ?? candidates[0]
}

export async function POST(request: Request) {
  try {
    const { centerNode, selectedStandards, targetGradeGroup }: {
      centerNode: GraphCenterNode | null
      selectedStandards: GraphSelectedStandard[]
      targetGradeGroup?: string
    } = await request.json()

    if (!centerNode && selectedStandards.length === 0) {
      return Response.json({ error: 'No standards provided' }, { status: 400 })
    }

    const graph = loadGraph()
    if (!graph) {
      return Response.json({ error: 'Graph not loaded' }, { status: 500 })
    }

    // 교과 이름 맵
    const subjectNameMap = new Map(graph.subjects.map(s => [s.id, s.name_ko]))

    // 모든 성취기준 (중심 + 연관)
    const allStandards: GraphSelectedStandard[] = [
      ...(centerNode ? [{ ...centerNode }] : []),
      ...selectedStandards.filter(s => s.id !== centerNode?.id),
    ]

    // 성취기준 ID → core_idea_id 맵
    const stdCoreIdeaMap = new Map(
      graph.achievementStandards
        .filter(s => s.core_idea_id)
        .map(s => [s.id, s.core_idea_id!])
    )

    // 교과별로 핵심아이디어 수집 (해당 표준과 연결된 영역 우선)
    function getCoreIdeasForSubject(subjectId: string, standardId?: string): { areaId: string; ideas: string[] }[] {
      // 해당 표준의 core_idea_id가 있으면 그 영역 우선
      const coreIdeaId = standardId ? stdCoreIdeaMap.get(standardId) : undefined
      const subjectIdeas = graph!.coreIdeas.filter(ci => ci.subject_id === subjectId)
      if (coreIdeaId) {
        const matched = subjectIdeas.filter(ci => ci.id === coreIdeaId)
        if (matched.length > 0) return matched.map(ci => ({ areaId: ci.id, ideas: ci.ideas }))
      }
      return subjectIdeas.map(ci => ({ areaId: ci.id, ideas: ci.ideas }))
    }

    // 교과별 핵심아이디어 수집
    const subjectIdSet = new Set(allStandards.map(s => s.subjectId))
    const subjectCoreIdeasMap = new Map<string, string[]>()
    for (const subjectId of subjectIdSet) {
      const stdForSubject = allStandards.find(s => s.subjectId === subjectId)
      const areaIdeas = getCoreIdeasForSubject(subjectId, stdForSubject?.id)
      const flatIdeas = areaIdeas.flatMap(ai => ai.ideas)
      if (flatIdeas.length > 0) subjectCoreIdeasMap.set(subjectId, flatIdeas)
    }

    // Claude 프롬프트 구성
    const centerText = centerNode
      ? `[중심 성취기준] ${centerNode.label}: "${centerNode.text}"`
      : ''
    const connectedText = selectedStandards
      .filter(s => s.id !== centerNode?.id)
      .map(s => `• ${s.label} (${subjectNameMap.get(s.subjectId) ?? s.subjectId}${s.relationType ? `, ${s.relationType}` : ''}): "${s.text}"`)
      .join('\n')

    // ─── 내용체계 데이터에서 지식·이해 / 과정·기능 원문 로드 ───
    const csRecords = isElementaryGradeGroup(targetGradeGroup)
      ? loadElementaryContentSystems()
      : loadContentSystems()

    function getContentSystemForSubject(subjectId: string, area: string) {
      const subjName = subjectNameMap.get(subjectId) ?? ''
      const match = csRecords.find(r =>
        !isSelectionCurriculum(r.curriculum) &&
        (r.subject.includes(subjName) || subjName.includes(r.subject)) &&
        curriculumTextMatches(r.area, area)
      )
      return match ? {
        knowledge: filterByGrade(match.knowledge, targetGradeGroup),
        functions: filterByGrade(match.functions, targetGradeGroup),
        attitudes: filterByGrade(match.attitudes, targetGradeGroup),
      } : null
    }

    // ─── 코드 레벨에서 핵심아이디어 확정 (AI 선택 아님) ───
    // 핵심아이디어는 교육과정에 제시된 확정 문구이므로 AI가 선택·생성하는 것이 아님.
    // core_idea_id 매핑으로 확정된 첫 번째 핵심아이디어를 사용.
    const coreIdeas: CoreIdeaResult[] = []
    const subjectSelectedMap = new Map<string, string>()

    for (const subjectId of subjectIdSet) {
      const std = allStandards.find(item => item.subjectId === subjectId)
      const dbIdeas = subjectCoreIdeasMap.get(subjectId) ?? []
      const graphStd = graph.achievementStandards.find(item => item.id === std?.id)
      const selected = selectDbCoreIdea(dbIdeas, `${graphStd?.text ?? std?.text ?? ''} ${graphStd?.area ?? ''}`) || '(핵심아이디어 미매핑)'
      subjectSelectedMap.set(subjectId, selected)
      coreIdeas.push({
        subjectId,
        subjectName: subjectNameMap.get(subjectId) ?? subjectId,
        selectedIdea: selected,
        allIdeas: dbIdeas,
        justification: '교육과정 데이터에서 성취기준 코드로 직접 매핑된 핵심아이디어',
      })
    }

    void centerText
    void connectedText

    const standardAnalyses: StandardAnalysis[] = allStandards.map(std => {
      const graphStd = graph.achievementStandards.find(item => item.id === std.id)
      const area = graphStd?.area ?? ''
      const cs = getContentSystemForSubject(std.subjectId, area)
      const sameAreaStandards = graph.achievementStandards
        .filter(item =>
          item.subject_id === std.subjectId &&
          curriculumTextMatches(item.area, area) &&
          (!targetGradeGroup || (item.grade_band ?? '').includes(targetGradeGroup.replace(/^초/, '').replace(/~/g, '-')))
        )
        .sort((a, b) => a.code.localeCompare(b.code))
      const standardIndex = sameAreaStandards.findIndex(item => item.id === std.id)
      const knowledge = cs?.knowledge ?? []
      const functions = cs?.functions ?? []
      const attitudes = cs?.attitudes ?? []

      return {
        standardId: std.id,
        standardLabel: std.label,
        subjectName: subjectNameMap.get(std.subjectId) ?? std.subjectId,
        coreIdea: subjectSelectedMap.get(std.subjectId) ?? '(핵심아이디어 미매핑)',
        knowledgeUnderstanding: standardIndex >= 0 && knowledge.length === sameAreaStandards.length
          ? [knowledge[standardIndex]].filter(Boolean)
          : knowledge.slice(0, 4),
        processFunction: standardIndex >= 0 && functions.length === sameAreaStandards.length
          ? [functions[standardIndex]].filter(Boolean)
          : functions.slice(0, 3),
        valueAttitude: standardIndex >= 0 && attitudes.length === sameAreaStandards.length
          ? [attitudes[standardIndex]].filter(Boolean)
          : attitudes.slice(0, 2),
        relationType: ('relationType' in std ? std.relationType : undefined) as GraphRelationType | undefined,
        isCenterStandard: std.id === centerNode?.id,
      }
    })

    return Response.json({ coreIdeas, standardAnalyses })
  } catch (err) {
    console.error('[analyze/a21]', err)
    return Response.json({ error: 'analysis failed' }, { status: 500 })
  }
}
