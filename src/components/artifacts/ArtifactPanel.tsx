'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useProjectStore } from '@/store/project'
import { ACTIVITY_META, STAGES } from '@/types'
import type { ActivityCode, ArtifactStatus, RequiredSection } from '@/types'
import { setProjectArtifact, setActivityStatus, deleteProjectArtifact } from '@/lib/firebase/projects'
import { Timestamp } from 'firebase/firestore'
import { cn } from '@/lib/utils'
import { Sparkle, Note, CheckCircle, XCircle, FileText, Lock, Chat, Clock, X, PencilSimple, ClockCounterClockwise, ArrowsOut, CaretDown, CaretLeft, CaretUp, Circle as CircleIcon, Lightbulb, Stack, Shield, Warning, ArrowBendUpLeft, Copy, Check, Trash, type Icon } from '@phosphor-icons/react'
import { createPortal } from 'react-dom'
import { CumulativeReportModal } from '@/components/modals/CumulativeReportModal'
// 스펙 §1-2 — 단계 컬러 단일 출처. 로컬 선언 제거하고 공통 모듈 참조.
// 기존 corner 0.10 → 0.11 통일 (team-lead-2 결정, 시각 차이 미미).
import { STAGE_COLOR } from '@/lib/ui/stageColors'
import { isEffectivelyDone } from '@/lib/activity/completion'

const STATUS_CONFIG: Record<ArtifactStatus, { label: string; icon: Icon; className: string }> = {
  ai_draft:  { label: 'AI 초안', icon: Sparkle,      className: 'bg-[#E8F0FE] text-[#1A73E8]' },
  in_review: { label: '검토 중', icon: Note,          className: 'bg-[#FEF7E0] text-[#B06000]' },
  confirmed: { label: '확정',    icon: CheckCircle,   className: 'bg-[#E6F4EA] text-[#137333]' },
  rejected:  { label: '반려',    icon: XCircle,       className: 'bg-[#FFEBEE] text-[#C62828]' },
}

function StatusBadge({ status }: { status: ArtifactStatus }) {
  const cfg = STATUS_CONFIG[status]
  const IconComp = cfg.icon
  return (
    <span className={cn('flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full font-semibold', cfg.className)}>
      <IconComp size={16} weight="fill" />
      {cfg.label}
    </span>
  )
}

function EmptyState({ activityLabel, sections, sectionVariant, stageLight, stageText }: {
  activityLabel: string
  sections?: RequiredSection[]
  sectionVariant: 'required' | 'recommended'  // 헤더 문구만 분기 ('필수 섹션' vs '권장 섹션')
  stageLight: string   // stageColor.light 클래스
  stageText: string    // stageColor.text 클래스
}) {
  const sectionHeader = sectionVariant === 'required'
    ? '이 활동에서 꼭 채워야 할 내용'
    : '이 활동에서 채우면 좋은 내용'
  return (
    <div className="flex flex-col items-center text-[#9AA0A6] gap-2.5 px-4 py-4">
      <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', stageLight)}>
        <FileText size={22} weight="duotone" className={stageText} />
      </div>
      <div className="text-center">
        <p className="text-[13px] font-semibold text-[#5F6368]">아직 산출물이 없습니다</p>
        <p className="text-[10px] text-[#9AA0A6] mt-0.5 leading-snug">
          [{activityLabel}] 활동에서 AI와 대화하면 초안이 자동 생성됩니다
        </p>
      </div>

      {sections && sections.length > 0 && (
        <div className="w-full rounded-xl border border-[#DADCE0] bg-white px-3 py-2">
          <p className="text-[10px] font-bold text-[#5F6368] uppercase tracking-wider mb-1.5">
            {sectionHeader}
          </p>
          <div className="flex flex-wrap gap-1">
            {sections.map(sec => (
              <span
                key={sec.key}
                className={cn(
                  'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full',
                  stageLight, stageText
                )}
              >
                <CircleIcon size={6} weight="fill" />
                {sec.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

interface ArtifactPreviewModalState {
  title: string
  subtitle?: string
  content: Record<string, unknown>
  status?: ArtifactStatus
  stageCode: string
  activityCode?: ActivityCode
}

function hasMarkdownTable(text: string): boolean {
  return /^\s*\|.+\|\s*$/m.test(text) && /^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$/m.test(text)
}

// AI가 "| 방향 | 근거 | --- | --- | a | b | c | d |" 같은 단일 라인으로 표를 만들려 하나
// 개행이 없어 ReactMarkdown이 표로 인식 못 함. 이걸 **실제 마크다운 테이블**로 재조립해
// GFM 렌더러가 처리하도록 정규화. 구분자 행(`---`) 감지 시 그 앞 쌍을 헤더로, 뒤를 데이터 행으로.
//
// 관용 조건 (AI 출력 편차 수용):
// - 선행 `|` 필수, 후행 `|` 선택
// - 파이프 ≥ 4개
// - 홀수 셀이면 마지막 셀 버리고 짝수 처리 (혹은 원문 유지)
function normalizeInlinePipeList(text: string): string {
  if (typeof text !== 'string') return text
  // 이미 줄바꿈이 있는 표는 정상 → 추가 처리 불필요 (단, 한 줄에 || 패턴이면 행 분리)
  if (text.includes('\n')) {
    // 한 줄 안에 여러 행이 || 로 붙어있는 경우 분리 (AI가 줄바꿈 없이 붙여 출력하는 케이스)
    if (/\|\s*\|/.test(text) && text.split('\n').some(l => (l.match(/\|/g) || []).length > 8)) {
      return text.split('\n').map(line => {
        if ((line.match(/\|/g) || []).length > 8 && line.trim().startsWith('|')) {
          // | A | B || C | D | → | A | B |\n| C | D |
          return line.replace(/\|\s*\|/g, '|\n|')
        }
        return line
      }).join('\n')
    }
    return text
  }
  const trimmed = text.trim()
  if (!trimmed.startsWith('|')) return text
  const pipeCount = (trimmed.match(/\|/g) || []).length
  if (pipeCount < 4) return text

  // 선행 `|` 제거, 후행 `|` 있으면 제거 (없으면 그대로)
  const withoutLead = trimmed.slice(1)
  const core = withoutLead.endsWith('|') ? withoutLead.slice(0, -1) : withoutLead
  const rawCells = core.split('|').map(s => s.trim()).filter(Boolean)
  if (rawCells.length < 4) return text
  // 홀수 셀이면 마지막 하나 버림 (AI 출력이 마지막 값 끊긴 경우 방어)
  const evenCount = rawCells.length - (rawCells.length % 2)
  const cells = rawCells.slice(0, evenCount)
  if (cells.length < 4) return text

  const pairs: [string, string][] = []
  for (let i = 0; i < cells.length; i += 2) pairs.push([cells[i], cells[i + 1]])

  const isSepCell = (s: string) => /^:?-{2,}:?$/.test(s)
  const sepIdx = pairs.findIndex(p => isSepCell(p[0]) && isSepCell(p[1]))

  if (sepIdx > 0 && sepIdx < pairs.length - 1) {
    const header = pairs[sepIdx - 1]
    const dataRows = pairs.slice(sepIdx + 1).filter(p => !(isSepCell(p[0]) && isSepCell(p[1])))
    if (dataRows.length === 0) return text
    return [
      `| ${header[0]} | ${header[1]} |`,
      `| --- | --- |`,
      ...dataRows.map(p => `| ${p[0]} | ${p[1]} |`),
    ].join('\n')
  }

  // 구분자 없이 key-value 쌍만 있는 경우: 자동 헤더 + 2열 테이블
  return [
    `| 항목 | 내용 |`,
    `| --- | --- |`,
    ...pairs.filter(p => !(isSepCell(p[0]) && isSepCell(p[1]))).map(p => `| ${p[0]} | ${p[1]} |`),
  ].join('\n')
}

// 산출물 content를 복사용 plain text로 포맷. 섹션 키를 2차 헤딩, 값을 본문으로 하여 다른 곳에 붙여넣기 좋은 형식.
function formatArtifactForCopy(title: string, content: Record<string, unknown>): string {
  const DISPLAY_BLOCKED = new Set(['_schemaVersion', 'status', 'version'])
  const lines: string[] = [`# ${title}`, '']
  for (const [key, value] of Object.entries(content)) {
    if (DISPLAY_BLOCKED.has(key)) continue
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    if (!text || !text.trim()) continue
    lines.push(`## ${key}`)
    lines.push(text.trim())
    lines.push('')
  }
  return lines.join('\n').trim()
}

function ArtifactPreviewModal({
  modal,
  onClose,
}: {
  modal: ArtifactPreviewModalState | null
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1800)
    return () => clearTimeout(t)
  }, [copied])
  if (!modal || typeof document === 'undefined') return null
  // modal.stageCode는 외부 호출자가 임의 문자열을 넘길 수 있어 StageCode로 단정하지 않고 fallback.
  const modalStageColor = STAGE_COLOR[modal.stageCode as keyof typeof STAGE_COLOR] ?? STAGE_COLOR.T
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formatArtifactForCopy(modal.title, modal.content))
      setCopied(true)
    } catch {
      // Clipboard API 실패 시 조용히 무시 (사용자는 아무 피드백 없음) — 대부분 권한 문제
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[95vw] lg:max-w-[1400px] max-h-[92vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className={cn(modalStageColor.light, 'px-6 py-4 flex items-center gap-3 border-b border-[#DADCE0] flex-shrink-0')}>
          <div className={cn('w-9 h-9 flex items-center justify-center rounded-xl', modalStageColor.bg)}>
            <FileText size={18} weight="fill" className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className={cn('text-[11px] font-bold uppercase tracking-widest', modalStageColor.text)}>산출물 상세 보기</p>
            <p className="text-[15px] font-bold text-[#202124] truncate">{modal.title}</p>
            {modal.subtitle && (
              <p className="text-[12px] text-[#5F6368] mt-0.5 truncate">{modal.subtitle}</p>
            )}
          </div>
          {modal.status && <StatusBadge status={modal.status} />}
          <button
            onClick={handleCopy}
            title={copied ? '복사됨' : '산출물 복사'}
            aria-label={copied ? '산출물이 복사되었습니다' : '산출물 복사하기'}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[12px] font-semibold transition-colors flex-shrink-0',
              copied
                ? 'bg-[#E6F4EA] text-[#188038]'
                : 'bg-white/80 text-[#5F6368] hover:bg-white hover:text-[#1A73E8] border border-[#DADCE0]'
            )}
          >
            {copied ? <Check size={14} weight="bold" /> : <Copy size={14} weight="regular" />}
            {copied ? '복사됨' : '복사'}
          </button>
          <button
            onClick={onClose}
            className="ml-1 p-1.5 rounded-full hover:bg-[#F1F3F4] text-[#5F6368] transition-colors flex-shrink-0"
          >
            <X size={18} weight="regular" />
          </button>
        </div>
        <div className="flex-1 overflow-auto px-6 py-5">
          <ArtifactContent content={modal.content} activityCode={modal.activityCode} />
        </div>
      </div>
    </div>,
    document.body
  )
}

// ─── P1-I 3-A: E 활동 필수 섹션 체크리스트 카드 ────────────────────
// 읽기 전용 피드백 카드. ACTIVITY_META[code].requiredSections를 단일 출처로 하여
// 각 섹션의 충족 여부를 시각화. 입력 경로는 추가하지 않음 — 기존 AI ARTIFACT_UPDATE
// 파이프라인과 "직접 입력" 버튼이 content[key]를 채우면 여기서는 반영만.
function countKoreanChars(raw: unknown): number {
  if (typeof raw !== 'string') return 0
  return raw.replace(/\s/g, '').length
}

function RequiredSectionsChecklist({
  activityCode,
  content,
  schemaVersion,
}: {
  activityCode: ActivityCode
  content: Record<string, unknown>
  schemaVersion?: string
}) {
  const [collapsed, setCollapsed] = useState(false)
  const setChatInputRequest = useProjectStore(s => s.setChatInputRequest)
  const meta = ACTIVITY_META[activityCode]
  // required 우선, 없으면 recommended fallback (동시 존재 케이스 없음 — Task #9 설계 결정).
  const sections = meta.requiredSections ?? meta.recommendedSections
  const variant: 'required' | 'recommended' = meta.requiredSections ? 'required' : 'recommended'
  if (!sections || sections.length === 0) return null

  const allSections = sections.filter(s => s.required === 'all')
  const anySections = sections.filter(s => s.required === 'any')

  function sectionInfo(sec: RequiredSection) {
    let filled = countKoreanChars(content[sec.key])
    // 구조화 스키마 대응: 기존 키 → 스키마 필드 매핑
    if (filled === 0 && content._schema === 'T-1-1') {
      const s = content as unknown as { personalVisions?: Array<{ refinedVision: string }>; teamVision?: string; coreKeywords?: string[] }
      if (sec.key === '개인 비전' && s.personalVisions?.length) {
        filled = s.personalVisions.reduce((sum, pv) => sum + (pv.refinedVision?.length ?? 0), 0)
      } else if (sec.key === '팀 공통 비전' && s.teamVision) {
        filled = s.teamVision.length
      } else if (sec.key === '핵심 키워드' && s.coreKeywords?.length) {
        filled = s.coreKeywords.join(', ').length
      }
    }
    if (filled === 0 && content._schema === 'T-1-2') {
      const s = content as unknown as { designPrinciples?: Array<{ principle: string; rationale: string }> }
      if (sec.key === '설계 방향' && s.designPrinciples?.length) {
        filled = s.designPrinciples.reduce((sum, dp) => sum + (dp.principle?.length ?? 0) + (dp.rationale?.length ?? 0), 0)
      }
    }
    if (filled === 0 && content._schema === 'T-2-1') {
      const s = content as unknown as { roles?: Array<{ role: string; responsibilities: string }> }
      if (sec.key === '역할 배분' && s.roles?.length) {
        filled = s.roles.reduce((sum, r) => sum + (r.role?.length ?? 0) + (r.responsibilities?.length ?? 0), 0)
      }
    }
    if (filled === 0 && content._schema === 'T-2-2') {
      const s = content as unknown as { rules?: Array<{ name: string; description: string }> }
      if (sec.key === '팀 규칙' && s.rules?.length) {
        filled = s.rules.reduce((sum, r) => sum + (r.name?.length ?? 0) + (r.description?.length ?? 0), 0)
      }
    }
    if (filled === 0 && content._schema === 'T-2-3') {
      const s = content as unknown as { schedule?: Array<{ period: string; activity: string }> }
      if (sec.key === '팀 일정' && s.schedule?.length) {
        filled = s.schedule.reduce((sum, i) => sum + (i.period?.length ?? 0) + (i.activity?.length ?? 0), 0)
      }
    }
    if (filled === 0 && content._schema === 'Ds-1-3') {
      const s = content as unknown as { activities?: Array<{ name: string; description: string }>; review?: string }
      if (sec.key === '학습 활동' && s.activities?.length) {
        filled = s.activities.reduce((sum, a) => sum + (a.name?.length ?? 0) + (a.description?.length ?? 0), 0)
      } else if (sec.key === 'AI 점검' && s.review) {
        filled = s.review.length
      }
    }
    if (filled === 0 && content._schema === 'Ds-2-1') {
      const s = content as unknown as {
        materials?: Array<{ activity?: string; name?: string; purpose?: string }>
        envCheck?: string
        '활동별 자료 설계'?: string
        'AI 점검'?: string
      }
      if (sec.key === '활동별 자료 설계') {
        if (s.materials?.length) {
          filled = s.materials.reduce((sum, m) => sum + (m.activity?.length ?? 0) + (m.name?.length ?? 0) + (m.purpose?.length ?? 0), 0)
        } else if (typeof s['활동별 자료 설계'] === 'string') {
          filled = countKoreanChars(s['활동별 자료 설계'])
        }
      } else if (sec.key === 'AI 점검') {
        filled = (s.envCheck?.length ?? 0) || countKoreanChars(s['AI 점검'])
      }
    }
    if (filled === 0 && content._schema === 'Ds-2-2') {
      const s = content as unknown as { supportPlans?: unknown[]; scaffolds?: Array<{ type: string; content: string }>; review?: string }
      if (sec.key === '지원 방안 정리' && s.supportPlans?.length) {
        filled = s.supportPlans.length * 20
      } else if (sec.key === '스캐폴딩 계획' && s.scaffolds?.length) {
        filled = s.scaffolds.reduce((sum, x) => sum + (x.type?.length ?? 0) + (x.content?.length ?? 0), 0)
      } else if (sec.key === 'AI 점검' && s.review) {
        filled = s.review.length
      }
    }
    if (filled === 0 && content._schema === 'A-1-2') {
      const s = content as unknown as { criteria?: unknown[]; selectedTopic?: string; topicType?: string; rationale?: string }
      if (sec.key === '주제 선정 기준' && s.criteria?.length) filled = 20
      else if (sec.key === '최종 선정 주제' && s.selectedTopic) filled = s.selectedTopic.length
      else if (sec.key === '주제 유형' && s.topicType) filled = s.topicType.length
      else if (sec.key === '선정 근거' && s.rationale) filled = s.rationale.length
    }
    if (filled === 0 && content._schema === 'A-2-1') {
      const s = content as unknown as { rows?: Array<{ subject: string }> }
      if (sec.key === '성취기준분석표' && s.rows?.length) filled = s.rows.length * 20
    }
    if (filled === 0 && content._schema === 'A-2-2') {
      const s = content as unknown as {
        commonCoreIdea?: string
        integratedGoal?: string
        integratedGoals?: string[]
        subjectGoals?: unknown[]
        convergentKeywords?: string[]
        method?: string
      }
      if (sec.key === '공통 핵심 아이디어' && s.commonCoreIdea) filled = s.commonCoreIdea.length
      else if (sec.key === '통합 수업목표' && (s.integratedGoal || s.integratedGoals?.length)) filled = (s.integratedGoal || s.integratedGoals?.join(' ') || '').length
      else if (sec.key === '교과별 수업목표' && s.subjectGoals?.length) filled = 20
      else if (sec.key === '핵심 키워드' && s.convergentKeywords?.length) filled = s.convergentKeywords.join(' ').length
      else if (sec.key === '진술 방식' && s.method) filled = 5
      // 레거시 키 호환
      else if (sec.key === '교과별 세부 목표' && s.subjectGoals?.length) filled = 20
      else if (sec.key === '통합 학습목표' && s.integratedGoals?.length) filled = s.integratedGoals.join('').length
    }
    if (filled === 0 && content._schema === 'A-2-3') {
      const s = content as unknown as { commonProfile?: unknown[] }
      if (sec.key === '학습자 프로필' && s.commonProfile?.length) filled = 20
    }
    // Ds-1-2 문제상황: 워크숍 저장(선정 문제상황/문제상황 후보)·공동편집(scenario) 양쪽 형태 모두 매핑
    if (filled === 0 && content._schema === 'Ds-1-2') {
      const s = content as unknown as {
        scenario?: { title?: string; authenticity?: string; contentProduct?: string; audienceAction?: string }
        drivingQuestion?: string
        '선정 문제상황'?: { 제목?: string; 문제상황?: string; 교과별학습내용?: string; 산출물?: string }
        '문제상황 후보'?: Array<{ 제목?: string; 문제상황?: string; 선정?: boolean }>
        '핵심 질문'?: string
      }
      if (sec.key === '문제상황') {
        if (s.scenario) {
          filled = (s.scenario.title?.length ?? 0) + (s.scenario.authenticity?.length ?? 0)
            + (s.scenario.contentProduct?.length ?? 0) + (s.scenario.audienceAction?.length ?? 0)
        } else if (s['선정 문제상황']) {
          const sel = s['선정 문제상황']
          filled = (sel.제목?.length ?? 0) + (sel.문제상황?.length ?? 0)
            + (sel.교과별학습내용?.length ?? 0) + (sel.산출물?.length ?? 0)
        } else if (Array.isArray(s['문제상황 후보']) && s['문제상황 후보'].length > 0) {
          const chosen = s['문제상황 후보'].find(c => c.선정) ?? s['문제상황 후보'][0]
          filled = (chosen?.제목?.length ?? 0) + (chosen?.문제상황?.length ?? 0)
        }
      } else if (sec.key === '핵심 질문') {
        filled = (s.drivingQuestion?.length ?? 0) || (s['핵심 질문']?.length ?? 0)
      }
    }
    const satisfied = filled >= sec.minChars
    const pct = Math.min(100, Math.round((filled / sec.minChars) * 100))
    return { filled, satisfied, pct }
  }

  const allSatisfied = allSections.every(s => sectionInfo(s).satisfied)
  const anySatisfied = anySections.length === 0 || anySections.some(s => sectionInfo(s).satisfied)
  const overallSatisfied = allSatisfied && anySatisfied

  // 헤더 라벨 생성 (required 규칙 조합에 따라 동적).
  // recommended variant는 "완료 인정" 표현이 오해 소지 → 가이드 톤으로 변경.
  let headerDesc = ''
  if (variant === 'required') {
    if (allSections.length > 0 && anySections.length > 0) {
      headerDesc = `꼭 채울 ${allSections.length}개 + 그 외 ${anySections.length}개 중 1개 이상 채우면 마무리할 수 있어요`
    } else if (allSections.length > 0) {
      headerDesc = `${allSections.length}개 내용을 모두 채우면 마무리할 수 있어요`
    } else if (anySections.length > 0) {
      headerDesc = `${anySections.length}개 중 1개 이상 채우면 마무리할 수 있어요`
    }
  } else {
    headerDesc = sections.length === 1
      ? '채우면 좋은 내용 1개예요 — 안 채워도 활동 마무리에는 문제없어요'
      : `채우면 좋은 내용 ${sections.length}개예요 — 전부 안 채워도 활동 마무리에는 문제없어요`
  }

  // 레거시(grandfather) 산출물은 섹션 검증 미적용 — 안내 문구로 알려줌
  const isLegacy = schemaVersion !== 'v2-sections'

  const sectionOrder: RequiredSection[] = [...allSections, ...anySections]

  // recommended variant는 빨강/초록 대비 대신 무채색-파스텔로 톤 완화 (판정에 영향 없음을 시각으로도 전달).
  const containerClass = variant === 'required'
    ? cn(
        'rounded-2xl border-2 p-4 mb-4 transition-colors',
        overallSatisfied ? 'border-[#34A853] bg-[#E6F4EA]/30' : 'border-[#C62828] bg-[#FFEBEE]/30'
      )
    : cn(
        'rounded-2xl border p-4 mb-4 transition-colors border-[#DADCE0] bg-[#F8F9FA]'
      )
  const badgeBg = variant === 'required'
    ? (overallSatisfied ? 'bg-[#34A853]' : 'bg-[#C62828]')
    : 'bg-[#5F6368]'
  const titleLabel = variant === 'required' ? `${meta.label} — 꼭 채워야 할 내용` : `${meta.label} — 채우면 좋은 내용`

  return (
    <div className={containerClass}>
      <button
        type="button"
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className={cn(
            'w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0',
            badgeBg
          )}>
            {overallSatisfied
              ? <CheckCircle size={14} weight="fill" className="text-white" />
              : <CircleIcon size={10} weight="bold" className="text-white" />}
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-extrabold text-[#202124] leading-tight">
              {titleLabel}
            </p>
            <p className="text-[11px] text-[#5F6368] mt-0.5 leading-snug">{headerDesc}</p>
          </div>
        </div>
        {collapsed
          ? <CaretDown size={18} weight="bold" className="text-[#5F6368] flex-shrink-0" />
          : <CaretUp   size={18} weight="bold" className="text-[#5F6368] flex-shrink-0" />}
      </button>

      {!collapsed && (
        <div className="mt-3 space-y-2.5">
          {sectionOrder.map((sec) => {
            const { filled, satisfied, pct } = sectionInfo(sec)
            const isAll = sec.required === 'all'
            return (
              <div key={sec.key} className="rounded-xl bg-white/70 border border-[#DADCE0] px-3 py-2">
                <div className="flex items-center gap-2">
                  {satisfied
                    ? <CheckCircle size={16} weight="fill" className="text-[#34A853] flex-shrink-0" />
                    : <CircleIcon  size={14} weight="bold" className="text-[#9AA0A6] flex-shrink-0" />}
                  <span className="text-[12px] font-bold text-[#202124]">{sec.label}</span>
                  {isAll && (
                    <span className="text-[9px] font-extrabold bg-[#C62828] text-white px-1.5 py-0.5 rounded-full tracking-wide">
                      필수
                    </span>
                  )}
                  <span className="ml-auto text-[11px] text-[#5F6368] tabular-nums">
                    {filled === 0
                      ? <span className="text-[#9AA0A6]">입력 없음</span>
                      : <>{filled}자 / {sec.minChars}자 이상{satisfied && <span className="text-[#34A853] ml-1">✓</span>}</>}
                  </span>
                </div>
                {!satisfied && filled > 0 && (
                  <div className="mt-1.5 h-1 rounded-full bg-[#F1F3F4] overflow-hidden">
                    <div
                      className="h-full bg-[#FBBC04] transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </div>
            )
          })}

          {/* 가이드: AI 요청 문구를 채팅 입력창에 바로 주입 (기존 팁 텍스트 → 버튼) */}
          <button
            type="button"
            onClick={() => {
              const labels = sections.map(s => s.label).join(' · ')
              const prompt = `"${labels}" 순서로 정리해줘`
              setChatInputRequest(prompt)
            }}
            className="group w-full flex items-center gap-2 rounded-xl bg-white border border-[#DADCE0] hover:border-[#1A73E8] hover:bg-[#E8F0FE] px-3 py-2 transition-colors text-left"
          >
            <Lightbulb size={15} weight="fill" className="text-[#F9AB00] flex-shrink-0" />
            <span className="text-[11px] text-[#5F6368] leading-snug flex-1 min-w-0">
              AI에게 <span className="font-semibold text-[#202124]">이 섹션 순서대로 정리</span>을 요청합니다
            </span>
            <span className="text-[11px] font-bold text-[#1A73E8] whitespace-nowrap group-hover:underline">
              채팅에 넣기 →
            </span>
          </button>

          {variant === 'required' && isLegacy && (
            <p className="text-[10px] text-[#9AA0A6] italic leading-snug px-1">
              예전 방식으로 저장된 산출물이에요. 새 섹션 체크는 표시용으로만 보이고, 활동 마무리 조건은 이전과 동일합니다.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ArtifactSection({ sectionKey, value, onDelete, onOpenPreview, artifactTitle, artifactStatus, stageCode, activityCode, allowTableExpand, isRecentlyUpdated }: {
  sectionKey: string
  value: unknown
  onDelete?: () => void
  onOpenPreview?: (modal: ArtifactPreviewModalState) => void
  artifactTitle?: string
  artifactStatus?: ArtifactStatus
  stageCode?: string
  activityCode?: ActivityCode
  allowTableExpand?: boolean
  isRecentlyUpdated?: boolean  // ARTIFACT_UPDATE로 방금 들어온 섹션이면 플래시
}) {
  const canExpandTable = typeof value === 'string' && hasMarkdownTable(value)
  const isSupportToolEnvironmentCheck = sectionKey === 'AI 점검' && activityCode === 'Ds-2-1' && typeof value === 'string'

  return (
    <div className={cn(
      'rounded-2xl border border-[#DADCE0] overflow-hidden bg-white md-shadow-1 artifact-card-hover',
      isRecentlyUpdated && 'artifact-section-flash'
    )}>
      <div className="bg-[#F8F9FA] px-4 py-2.5 border-b border-[#DADCE0] flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-bold text-[#5F6368] uppercase tracking-wider truncate">{sectionKey}</span>
          {canExpandTable && (
            <span className="text-[10px] font-semibold text-[#1A73E8] bg-[#E8F0FE] px-2 py-0.5 rounded-full whitespace-nowrap">
              표 클릭 확대
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {canExpandTable && allowTableExpand && onOpenPreview && typeof value === 'string' && (
            <button
              onClick={() => onOpenPreview({
                title: artifactTitle ? `${artifactTitle} · ${sectionKey}` : sectionKey,
                subtitle: '표가 포함된 섹션 확대 보기',
                content: { [sectionKey]: value },
                status: artifactStatus,
                stageCode: stageCode ?? 'T',
              })}
              className="text-[#5F6368] hover:text-[#1A73E8] hover:bg-[#E8F0FE] rounded-full p-1 flex-shrink-0 transition-colors"
              title="이 표를 크게 보기"
            >
              <ArrowsOut size={16} weight="regular" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={onDelete}
              className="ml-1 text-[#9AA0A6] hover:text-[#C62828] hover:bg-[#FFEBEE] rounded-full p-1 flex-shrink-0 transition-colors"
              title="이 섹션 삭제"
            >
              <X size={16} weight="regular" />
            </button>
          )}
        </div>
      </div>
      <div className="px-4 py-4 bg-white">
        {isSupportToolEnvironmentCheck ? (
          <div className="rounded-2xl border border-[#D7C9FF] bg-[#F6F1FF] px-4 py-4">
            <div className="text-[11px] font-bold text-[#7C3AED] mb-2">AI 점검: 학습환경 적절성 검토</div>
            <div className="artifact-md text-sm text-[#3D2A73] leading-relaxed">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
                  strong: ({ children }) => <strong className="font-semibold text-[#5B34C7]">{children}</strong>,
                }}
              >
                {value}
              </ReactMarkdown>
            </div>
          </div>
        ) : typeof value === 'string' ? (
          <div className="artifact-md text-sm text-[#202124] leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]}
              components={{
                strong: ({ children }) => (
                  <span className="inline px-1 py-0.5 rounded text-[13px] font-semibold bg-[#E8F0FE] text-[#1A73E8] leading-snug box-decoration-clone">
                    {children}
                  </span>
                ),
                p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
                table: ({ children }) => (
                  <div
                    role={canExpandTable && allowTableExpand ? 'button' : undefined}
                    tabIndex={canExpandTable && allowTableExpand ? 0 : undefined}
                    onClick={
                      canExpandTable && allowTableExpand && onOpenPreview
                        ? () => onOpenPreview({
                            title: artifactTitle ? `${artifactTitle} · ${sectionKey}` : sectionKey,
                            subtitle: '표가 포함된 섹션 확대 보기',
                            content: { [sectionKey]: value },
                            status: artifactStatus,
                            stageCode: stageCode ?? 'T',
                          })
                        : undefined
                    }
                    onKeyDown={
                      canExpandTable && allowTableExpand && onOpenPreview
                        ? (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              onOpenPreview({
                                title: artifactTitle ? `${artifactTitle} · ${sectionKey}` : sectionKey,
                                subtitle: '표가 포함된 섹션 확대 보기',
                                content: { [sectionKey]: value },
                                status: artifactStatus,
                                stageCode: stageCode ?? 'T',
                              })
                            }
                          }
                        : undefined
                    }
                    className={cn(
                      'my-2 w-full text-left overflow-x-auto rounded-xl border border-[#DADCE0] transition-colors',
                      canExpandTable && allowTableExpand && onOpenPreview
                        ? 'cursor-zoom-in hover:border-[#1A73E8] hover:bg-[#F8FBFF] focus:outline-none focus:ring-2 focus:ring-[#1A73E8]'
                        : ''
                    )}
                    title={canExpandTable && allowTableExpand ? '클릭하여 크게 보기' : undefined}
                  >
                    <table className="min-w-full text-sm border-collapse">{children}</table>
                  </div>
                ),
                thead: ({ children }) => <thead className="bg-[#F8F9FA]">{children}</thead>,
                tbody: ({ children }) => <tbody className="divide-y divide-[#F1F3F4]">{children}</tbody>,
                tr: ({ children }) => <tr className="hover:bg-[#F8F9FA]/50 transition-colors">{children}</tr>,
                th: ({ children }) => (
                  <th className="px-3 py-2.5 text-left text-xs font-bold text-[#5F6368] uppercase tracking-wider whitespace-nowrap border-b border-[#DADCE0]">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="px-3 py-2.5 text-sm text-[#202124] leading-relaxed">
                    {children}
                  </td>
                ),
              }}
            >
              {/* 인라인 파이프 나열(잘못된 표 시도) → 불릿 리스트 정규화 먼저 적용 */}
              {/* 그다음 **항목**: 패턴 앞에 빈 줄 삽입, 표 셀 안의 <br/>은 \u2028으로, 표 밖의 <br/>은 제거 */}
              {normalizeInlinePipeList(value)
                .replace(/\\[nN]/g, '\n')
                .replace(/([^.\n])\s+(\*\*[^*\n]+\*\*\s*:)/g, '$1\n\n$2')
                .split('\n')
                .map(line => line.startsWith('|')
                  ? line.replace(/<br\s*\/?>/gi, '\u2028')
                  : line.replace(/<br\s*\/?>/gi, '')
                )
                .join('\n')
              }
            </ReactMarkdown>
          </div>
        ) : Array.isArray(value) ? (
          <ul className="space-y-2">
            {value.map((item, i) => (
              <li key={i} className="flex gap-2.5 text-sm text-[#202124]">
                <span className="mt-2 w-1.5 h-1.5 rounded-full bg-[#1A73E8] flex-shrink-0" />
                <span className="leading-relaxed">
                  {typeof item === 'object' && item !== null
                    ? Object.values(item as Record<string, unknown>).filter(v => typeof v === 'string' && v.trim()).join(' · ')
                    : String(item)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <pre className="text-xs text-[#5F6368] whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>
        )}
      </div>
    </div>
  )
}

// 산출물에 표시하면 안 되는 AI 진행 안내 섹션
const DISPLAY_BLOCKED_KEYS = [
  '_schema', '_schemaversion',
  '다음 행동', '다음 단계', 'next step',
  '미결 사항', '미결', '보류 사항',
  'ai 제안', '추천 사항', '참고 사항',
  '합의 내용', '논의 내용', '토론 내용', '토의 내용', '확인 사항',
  '진행 내용', '진행 사항', '현황', '요약',
  // 아래는 명시적 저장 경로(save proposal)에서 사용하는 키이므로 차단하지 않음
  // '토의 결과' / '토론 결과', '보완할 점' → 표시 허용
]

// 스펙 §7-3.8 — 이전 산출물 관계 타입 + 색상 토큰.
// guardrail: A-2-3 → Ds·DI (가드레일 / 설계 제약)
// basis:     T-1-1 비전 → 이후 전 활동 (가치 기반)
// prev_step: 직전 활동 (직렬 흐름)
// related:   같은 단계 내 타 활동 (병렬 참고)
type ArtifactRelation = 'guardrail' | 'basis' | 'prev_step' | 'related'

const RELATION_STYLE: Record<ArtifactRelation, { label: string; bg: string; text: string }> = {
  guardrail: { label: '가드레일', bg: 'bg-[#F3E5F5]', text: 'text-[#7B1FA2]' },
  basis:     { label: '가치 기반', bg: 'bg-[#E8F0FE]', text: 'text-[#1A73E8]' },
  prev_step: { label: '직전 단계', bg: 'bg-[#F1F3F4]', text: 'text-[#5F6368]' },
  related:   { label: '관련 활동', bg: 'bg-[#E0F2F1]', text: 'text-[#00897B]' },
}

// ui-designer 지침 (Task #4 v1.1): 자동 추론 대신 "임시 하드코딩" 힌트 맵.
// Record<currentActivity, Record<prevActivity, relationType>>.
// 매핑이 없으면 아래 fallback 규칙: guardrail(A-2-3→Ds/DI) → basis(T-1-1) → 동단계 인접(prev_step) → 그 외 동단계(related) → 타단계(prev_step).
// 매핑 데이터화는 후속 §10 태스크(ACTIVITY_RELATION_MAP) 담당.
const ARTIFACT_RELATION_HINT: Partial<Record<ActivityCode, Partial<Record<ActivityCode, ArtifactRelation>>>> = {
  // Ds 단계: A-2-3은 가드레일, T-1-1은 가치 기반, 직전은 prev_step
  'Ds-1-1': { 'A-2-3': 'guardrail', 'A-2-2': 'prev_step', 'T-1-1': 'basis' },
  'Ds-1-2': { 'A-2-3': 'guardrail', 'Ds-1-1': 'prev_step', 'T-1-1': 'basis' },
  'Ds-1-3': { 'A-2-3': 'guardrail', 'Ds-1-2': 'prev_step', 'T-1-1': 'basis' },
  'Ds-2-1': { 'A-2-3': 'guardrail', 'Ds-1-3': 'prev_step', 'T-1-1': 'basis' },
  'Ds-2-2': { 'A-2-3': 'guardrail', 'Ds-2-1': 'prev_step', 'T-1-1': 'basis' },
  // DI 단계: A-2-3은 가드레일, Ds 산출물은 직전, T-1-1은 가치 기반
  'DI-1-1': { 'A-2-3': 'guardrail', 'Ds-2-2': 'prev_step', 'T-1-1': 'basis' },
  'DI-2-1': { 'DI-1-1': 'prev_step', 'T-1-1': 'basis' },
  // E 단계: 직전 DI가 직전, T-1-1은 가치 기반
  'E-1-1': { 'DI-2-1': 'prev_step', 'T-1-1': 'basis' },
  'E-2-1': { 'E-1-1': 'prev_step', 'T-1-1': 'basis' },
}

// 이전 산출물(prev code) → 현재 활동(currentCode) 관계 판정.
// 1) 힌트 맵 우선 → 2) fallback 규칙.
function computeArtifactRelation(prevCode: ActivityCode, currentCode: ActivityCode, orderedActivities: ActivityCode[]): ArtifactRelation {
  const hinted = ARTIFACT_RELATION_HINT[currentCode]?.[prevCode]
  if (hinted) return hinted

  const prevMeta = ACTIVITY_META[prevCode]
  const currentMeta = ACTIVITY_META[currentCode]
  // A-2-3은 Ds/DI 활동에 대해 가드레일 (힌트 누락 시 안전망)
  if (prevMeta?.isGuardrailSource && (currentMeta?.stage === 'Ds' || currentMeta?.stage === 'DI')) {
    return 'guardrail'
  }
  if (prevCode === 'T-1-1') return 'basis'
  if (prevMeta?.stage === currentMeta?.stage) {
    const prevIdx = orderedActivities.indexOf(prevCode)
    const currIdx = orderedActivities.indexOf(currentCode)
    if (currIdx - prevIdx === 1) return 'prev_step'
    return 'related'
  }
  return 'prev_step'
}

// 접힘 상태 strip에서 쓸 공통 헬퍼.
// page.tsx 접힘 버튼이 직접 project.artifacts를 읽어 섹션 개수/상태를 얻을 수 있도록 export.
export function getVisibleArtifactSectionCount(content: Record<string, unknown> | undefined): number {
  if (!content) return 0
  return Object.keys(content).filter(
    key => !DISPLAY_BLOCKED_KEYS.some(k => key.toLowerCase().includes(k))
  ).length
}

// 상태 → 접힘 스트립의 점 컬러 매핑
export const ARTIFACT_STATUS_DOT: Record<ArtifactStatus, string> = {
  ai_draft:  '#1A73E8',  // 파랑 — AI가 막 초안 제시
  in_review: '#F9AB00',  // 황 — 검토·수정 요청 중
  confirmed: '#34A853',  // 녹색 — 팀 확정
  rejected:  '#C62828',  // 빨강 — 반려
}

// ─── 구조화된 산출물 렌더러 분기 ──────────────────────────────────────────
function StructuredArtifactRenderer({ content, onDelete, onDeleteField }: {
  content: Record<string, unknown>
  onDelete?: () => void
  /** 구조화 산출물의 카드(필드) 단위 부분 삭제 — sentinel key `__field:<name>`로 호출자에게 전달 */
  onDeleteField?: (key: string) => void
}) {
  const schema = content._schema as string | undefined
  const { ExpandableWrapper } = require('./structured/ExpandableWrapper') as { ExpandableWrapper: React.ComponentType<{ title: string; children: React.ReactNode; onDelete?: () => void }> }

  const SCHEMA_MAP: Record<string, { mod: string; label: string }> = {
    'T-1-1': { mod: './structured/T11Renderer', label: '공동 비전 설정' },
    'T-1-2': { mod: './structured/T12Renderer', label: '수업설계 방향 설정' },
    'T-2-1': { mod: './structured/T21Renderer', label: '역할 배분' },
    'T-2-2': { mod: './structured/T22Renderer', label: '팀 규칙 결정' },
    'T-2-3': { mod: './structured/T23Renderer', label: '팀 일정 결정' },
    'A-1-2': { mod: './structured/A12Renderer', label: '비전 기반 주제 선정' },
    'A-2-1': { mod: './structured/A21Renderer', label: '주제 상세 분석·성취기준 재구조화' },
    'A-2-2': { mod: './structured/A22Renderer', label: '통합 수업목표 진술' },
    'A-2-3': { mod: './structured/A23Renderer', label: '학습자·맥락 분석' },
    'Ds-1-1': { mod: './structured/Ds11Renderer', label: '평가 설계' },
    'Ds-1-2': { mod: './structured/Ds12Renderer', label: '문제 상황 설정' },
    'Ds-1-3': { mod: './structured/Ds13Renderer', label: '학습활동 설계' },
    'Ds-2-1': { mod: './structured/Ds21Renderer', label: '자료와 도구 연결' },
    'Ds-2-2': { mod: './structured/Ds22Renderer', label: '스캐폴딩 설계' },
  }

  if (!schema || !SCHEMA_MAP[schema]) return null

  const { label } = SCHEMA_MAP[schema]
  // T-1-1만 우선 필드별 부분 삭제 지원 — 다른 단계도 추후 동일 패턴으로 확장.
  const t11FieldDelete = onDeleteField
    ? (field: 'personalVisions' | 'teamVision' | 'coreKeywords' | 'blocks') => onDeleteField(`__field:${field}__`)
    : undefined
  let inner: React.ReactNode = null
  const renderers: Record<string, () => React.ReactNode> = {
    'T-1-1': () => { const { T11Renderer } = require('./structured/T11Renderer'); return <T11Renderer data={content} onDeleteField={t11FieldDelete} /> },
    'T-1-2': () => { const { T12Renderer } = require('./structured/T12Renderer'); return <T12Renderer data={content} /> },
    'T-2-1': () => { const { T21Renderer } = require('./structured/T21Renderer'); return <T21Renderer data={content} /> },
    'T-2-2': () => { const { T22Renderer } = require('./structured/T22Renderer'); return <T22Renderer data={content} /> },
    'T-2-3': () => { const { T23Renderer } = require('./structured/T23Renderer'); return <T23Renderer data={content} /> },
    'A-1-2': () => { const { A12Renderer } = require('./structured/A12Renderer'); return <A12Renderer data={content} /> },
    'A-2-1': () => { const { A21Renderer } = require('./structured/A21Renderer'); return <A21Renderer data={content} /> },
    'A-2-2': () => { const { A22Renderer } = require('./structured/A22Renderer'); return <A22Renderer data={content} /> },
    'A-2-3': () => { const { A23Renderer } = require('./structured/A23Renderer'); return <A23Renderer data={content} /> },
    'Ds-1-1': () => { const { Ds11Renderer } = require('./structured/Ds11Renderer'); return <Ds11Renderer data={content} /> },
    'Ds-1-2': () => { const { Ds12Renderer } = require('./structured/Ds12Renderer'); return <Ds12Renderer data={content} /> },
    'Ds-1-3': () => { const { Ds13Renderer } = require('./structured/Ds13Renderer'); return <Ds13Renderer data={content} /> },
    'Ds-2-1': () => { const { Ds21Renderer } = require('./structured/Ds21Renderer'); return <Ds21Renderer data={content} /> },
    'Ds-2-2': () => { const { Ds22Renderer } = require('./structured/Ds22Renderer'); return <Ds22Renderer data={content} /> },
  }
  if (schema && renderers[schema]) inner = renderers[schema]()

  return <ExpandableWrapper title={label} onDelete={onDelete}>{inner}</ExpandableWrapper>
}

function ArtifactContent({ content, onDeleteSection, onOpenPreview, artifactTitle, artifactStatus, stageCode, activityCode, allowTableExpand, recentlyUpdatedKeys }: {
  content: Record<string, unknown>
  onDeleteSection?: (key: string) => void
  onOpenPreview?: (modal: ArtifactPreviewModalState) => void
  artifactTitle?: string
  artifactStatus?: ArtifactStatus
  stageCode?: string
  activityCode?: ActivityCode
  allowTableExpand?: boolean
  recentlyUpdatedKeys?: Set<string>  // 방금 변경된 섹션 키 집합 (플래시 대상)
}) {
  // Ds-1-2(문제상황 개발)는 _schema 없이 한글 키 중첩 객체로 저장된 옛 데이터가 있다.
  // 그대로 두면 일반 섹션 렌더가 객체를 raw JSON으로 노출하므로, 전용 Renderer로 보내도록 보정.
  const effectiveContent = (!content._schema && activityCode === 'Ds-1-2')
    ? { ...content, _schema: 'Ds-1-2' }
    : content

  // 구조화된 산출물이면 고정 렌더러 사용 (AI 자유 형식 대신)
  if (effectiveContent._schema) {
    return <StructuredArtifactRenderer
      content={effectiveContent}
      onDelete={onDeleteSection ? () => {
        // 구조화 산출물 전체를 빈 객체로 교체 (한 번에 삭제)
        onDeleteSection('__clear_all__')
      } : undefined}
      onDeleteField={onDeleteSection}
    />
  }

  const filteredEntries = Object.entries(content).filter(
    ([key]) => !DISPLAY_BLOCKED_KEYS.some(k => key.toLowerCase().includes(k))
  )
  if (filteredEntries.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-[#DADCE0] px-4 py-8
        flex flex-col items-center gap-2 text-[#9AA0A6]">
        <FileText size={28} weight="regular" className="text-[#DADCE0]" />
        <p className="text-xs text-center leading-relaxed">
          내용이 없습니다.<br />
          AI와 대화하여 내용을 추가하거나<br />
          직접 입력해주세요.
        </p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {filteredEntries.map(([key, value]) => (
        <ArtifactSection
          key={key}
          sectionKey={key}
          value={value}
          onDelete={onDeleteSection ? () => onDeleteSection(key) : undefined}
          onOpenPreview={onOpenPreview}
          artifactTitle={artifactTitle}
          artifactStatus={artifactStatus}
          stageCode={stageCode}
          activityCode={activityCode}
          allowTableExpand={allowTableExpand}
          isRecentlyUpdated={recentlyUpdatedKeys?.has(key)}
        />
      ))}
    </div>
  )
}

// 스펙 §7-3.9 — Ds 진입 시 상단 고정 A-2-3 가드레일 요약 카드.
// 기본 펼침 + 토글. A-2-3 content 중 string 값만 4~6줄 요약. Shield 아이콘 + 부채 경고 문구.
function DsGuardrailCard({ a23Artifact }: { a23Artifact: { content: Record<string, unknown> } }) {
  const [expanded, setExpanded] = useState(false)
  const entries = Object.entries(a23Artifact.content)
    .filter(([key]) => !DISPLAY_BLOCKED_KEYS.some(k => key.toLowerCase().includes(k)))
    .filter(([, v]) => typeof v === 'string' && (v as string).trim().length > 0)
    .slice(0, 6) as [string, string][]

  const stripMd = (v: string) => v
    .replace(/\|[^\n]*\|/g, '').replace(/[-|]+[-|]+/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#+\s*/gm, '').replace(/^>\s*/gm, '')
    .replace(/\s+/g, ' ').trim()

  return (
    <div className="mb-4 rounded-2xl border border-[#CE93D8] bg-[#F3E5F5]/60 overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-[#F3E5F5] transition-colors"
      >
        <Shield size={18} weight="fill" className="text-[#7B1FA2] flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-bold text-[#7B1FA2]">A-2-3 가드레일 · 학습자·맥락 분석</p>
          {!expanded && entries.length > 0 && (
            <p className="text-[10px] text-[#7B1FA2]/60 mt-0.5 leading-snug truncate">
              {entries.map(([k]) => k).join(' · ')}
            </p>
          )}
        </div>
        {expanded
          ? <CaretUp size={14} weight="bold" className="text-[#7B1FA2] flex-shrink-0" />
          : <CaretDown size={14} weight="bold" className="text-[#7B1FA2] flex-shrink-0" />
        }
      </button>
      {expanded && entries.length > 0 && (
        <div className="px-4 pb-4 pt-1 space-y-3">
          {entries.map(([k, v]) => (
            <div key={k}>
              <p className="text-[11px] font-bold text-[#7B1FA2] mb-1">{k}</p>
              <div className="text-[11px] text-[#5F2F6B] leading-relaxed artifact-md">
                <ReactMarkdown remarkPlugins={[remarkGfm]}
                  components={{
                    p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
                    strong: ({ children }) => <strong className="font-semibold text-[#7B1FA2]">{children}</strong>,
                    table: ({ children }) => <div className="overflow-x-auto my-1.5 rounded-lg border border-[#CE93D8]/40"><table className="min-w-full text-[11px] border-collapse">{children}</table></div>,
                    thead: ({ children }) => <thead className="bg-[#F3E5F5]">{children}</thead>,
                    th: ({ children }) => <th className="px-2 py-1.5 text-left text-[10px] font-bold text-[#7B1FA2] border-b border-[#CE93D8]/40">{children}</th>,
                    td: ({ children }) => <td className="px-2 py-1.5 text-[11px] text-[#5F2F6B] border-b border-[#CE93D8]/20">{children}</td>,
                    ul: ({ children }) => <ul className="space-y-0.5 ml-3 list-disc">{children}</ul>,
                    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                  }}
                >{v}</ReactMarkdown>
              </div>
            </div>
          ))}
        </div>
      )}
      {!expanded && entries.length > 0 && (
        <div className="px-4 pb-2.5 pt-0">
          <p className="text-[10px] text-[#7B1FA2]/50 leading-snug line-clamp-1">
            {stripMd(entries[0][1]).slice(0, 100)}…
          </p>
        </div>
      )}
    </div>
  )
}

export function ArtifactPanel() {
  const { currentArtifact, currentActivity, viewingActivity, setCurrentArtifact, project, userProfile } = useProjectStore()
  const activityMeta = ACTIVITY_META[viewingActivity]
  const [revisionNote, setRevisionNote] = useState('')
  const [showRevisionForm, setShowRevisionForm] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [showDirectInput, setShowDirectInput] = useState(false)
  const [directInputText, setDirectInputText] = useState('')
  const [previewModal, setPreviewModal] = useState<ArtifactPreviewModalState | null>(null)
  const [showCumulativeReport, setShowCumulativeReport] = useState(false)
  // 버전 dropdown — 현재 v 라벨 클릭 시 토글, 항목 클릭 시 rollback confirm.
  const [showVersionMenu, setShowVersionMenu] = useState(false)

  const isHost = project?.hostUid === userProfile?.uid || project?.createdBy === userProfile?.uid
  const stageColor = STAGE_COLOR[project?.currentStage ?? 'T']

  // Firestore 산출물 (팀 전체 소스)
  const firestoreArtifact = project?.artifacts?.[viewingActivity]

  // useEffect 없이 렌더 시점에 직접 파생 — 타이밍 이슈 없음
  // 로컬 currentArtifact가 없으면 Firestore 데이터로 임시 객체 생성
  const displayArtifact = currentArtifact ?? (firestoreArtifact ? {
    id: `${viewingActivity}-firestore`,
    activityCode: viewingActivity,
    artifactType: activityMeta.label,
    title: firestoreArtifact.title,
    status: firestoreArtifact.status as ArtifactStatus,
    currentVersion: firestoreArtifact.version,
    aiDraft: firestoreArtifact.content as Record<string, unknown>,
    confirmedContent: firestoreArtifact.status === 'confirmed'
      ? (firestoreArtifact.content as Record<string, unknown>)
      : undefined,
    createdBy: firestoreArtifact.confirmedBy ?? 'host',
    meta: {
      author: 'AI 분석',
      createdAt: Timestamp.fromMillis(firestoreArtifact.confirmedAt ?? Date.now()),
      updatedAt: Timestamp.fromMillis(firestoreArtifact.confirmedAt ?? Date.now()),
      evidence: '팀 합의',
      approvalStatus: 'approved' as const,
    },
  } : null)

  // Firestore 상태가 바뀌면 로컬 Zustand도 동기화 (호스트 재입장 등)
  useEffect(() => {
    if (!firestoreArtifact || !currentArtifact) return
    if (firestoreArtifact.status !== currentArtifact.status) {
      setCurrentArtifact({
        ...currentArtifact,
        status: firestoreArtifact.status as ArtifactStatus,
        confirmedContent: firestoreArtifact.status === 'confirmed'
          ? (firestoreArtifact.content as Record<string, unknown>)
          : currentArtifact.confirmedContent,
      })
    }
  }, [firestoreArtifact?.status, viewingActivity])

  const effectiveStatus: ArtifactStatus = firestoreArtifact?.status as ArtifactStatus ?? displayArtifact?.status ?? 'in_review'
  const isConfirmed = effectiveStatus === 'confirmed'

  const orderedActivities = useMemo(
    () => STAGES.flatMap(stage => stage.activities),
    []
  )

  const previousArtifacts = useMemo(() => {
    if (!project?.artifacts) return []
    const currentIdx = orderedActivities.indexOf(viewingActivity)
    return Object.entries(project.artifacts)
      .filter(([code, artifact]) => {
        if (code === viewingActivity) return false
        const activityIdx = orderedActivities.indexOf(code as ActivityCode)
        if (activityIdx === -1) return false
        if (currentIdx !== -1 && activityIdx >= currentIdx) return false
        return Object.keys((artifact?.content ?? {}) as Record<string, unknown>).length > 0
      })
      .sort((a, b) => orderedActivities.indexOf(b[0] as ActivityCode) - orderedActivities.indexOf(a[0] as ActivityCode))
      .map(([code, artifact]) => ({
        code: code as ActivityCode,
        title: artifact.title,
        status: artifact.status as ArtifactStatus,
        content: artifact.content as Record<string, unknown>,
        version: artifact.version,
        label: ACTIVITY_META[code as ActivityCode]?.label ?? code,
        stageCode: ACTIVITY_META[code as ActivityCode]?.stage ?? 'T',
        relation: computeArtifactRelation(code as ActivityCode, viewingActivity, orderedActivities),
      }))
  }, [orderedActivities, project?.artifacts, viewingActivity])

  // ── ARTIFACT_UPDATE 변경 감지 ─────────────────────────
  // firestoreArtifact.content가 바뀌면 (추가 or 값 변경) 해당 key를 recentlyUpdated Set에 추가.
  // 1.8s 후 자동으로 제거되어 플래시 애니메이션만 일회성으로 동작.
  // Firestore 구독 로직은 건드리지 않음 — 파생 ref만 유지.
  const previousContentRef = useRef<Record<string, string>>({})
  const previousActivityRef = useRef<ActivityCode>(viewingActivity)
  const [recentlyUpdatedKeys, setRecentlyUpdatedKeys] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    // 활동 전환 시 비교 기준 리셋 (이전 활동의 content와 비교해 전체가 "새로 들어온 것"처럼 보이는 오탐 방지)
    if (previousActivityRef.current !== viewingActivity) {
      previousActivityRef.current = viewingActivity
      const seed: Record<string, string> = {}
      Object.entries(firestoreArtifact?.content ?? {}).forEach(([k, v]) => {
        seed[k] = typeof v === 'string' ? v : JSON.stringify(v)
      })
      previousContentRef.current = seed
      setRecentlyUpdatedKeys(new Set())
      return
    }

    const content = firestoreArtifact?.content ?? {}
    const changed = new Set<string>()
    const next: Record<string, string> = {}
    Object.entries(content).forEach(([k, v]) => {
      const serialized = typeof v === 'string' ? v : JSON.stringify(v)
      next[k] = serialized
      if (previousContentRef.current[k] !== serialized) changed.add(k)
    })
    previousContentRef.current = next

    if (changed.size === 0) return
    setRecentlyUpdatedKeys(prev => {
      const merged = new Set(prev)
      changed.forEach(k => merged.add(k))
      return merged
    })
    // 플래시 시간(CSS 1.8s와 정렬)만큼 뒤에 키별 제거
    const t = setTimeout(() => {
      setRecentlyUpdatedKeys(prev => {
        const rest = new Set(prev)
        changed.forEach(k => rest.delete(k))
        return rest
      })
    }, 1800)
    return () => clearTimeout(t)
  }, [firestoreArtifact?.content, viewingActivity])

  // ── v1.1 §7-3.9/10/11/12 파생값 ─────────────────────
  // viewing 활동의 단계(stage) 기준으로 Ds 전용 UI 분기. project.currentStage 대신 viewingActivity 단계를 쓰는 이유:
  // 사용자가 과거 Ds 활동을 열어봐도 가드레일 맥락은 그대로 의미가 있음.
  const viewingStage = ACTIVITY_META[viewingActivity]?.stage

  // Ds 단계에서 A-2-3 가드레일 카드 상단 노출 여부
  const showDsGuardrail = viewingStage === 'Ds' && !!project?.artifacts?.['A-2-3']?.content
  const a23Artifact = project?.artifacts?.['A-2-3']

  // A-2-3 미완 상태에서 Ds 진입 시 경고 배너
  const a23Done = project
    ? isEffectivelyDone('A-2-3', project.activityStatuses ?? {}, project.artifacts ?? {})
    : false
  const showA23IncompleteWarning = viewingStage === 'Ds' && !a23Done

  // active_return 재검토 배너 (viewingActivity의 활동 상태 기준)
  const viewingActivityStatus = project?.activityStatuses?.[viewingActivity]
  const showActiveReturnBanner = viewingActivityStatus === 'active_return'

  async function handleConfirm() {
    if (!project) return
    // Firestore snapshot 우선, 없으면 로컬 displayArtifact 사용
    const content = (
      firestoreArtifact?.content ??
      displayArtifact?.lastEditedContent ??
      displayArtifact?.aiDraft ??
      {}
    ) as Record<string, unknown>
    const title = firestoreArtifact?.title ?? displayArtifact?.title ?? (activityMeta.label + ' 산출물')
    const version = firestoreArtifact?.version ?? displayArtifact?.currentVersion ?? 1

    if (!Object.keys(content).length) {
      console.warn('확정할 내용이 없습니다')
      return
    }
    setIsSaving(true)
    try {
      await setProjectArtifact(project.id, viewingActivity, {
        status: 'confirmed',
        title,
        content,
        version,
        confirmedBy: userProfile?.uid ?? undefined,
        confirmedAt: Date.now(),
      })
      // 산출물 확정 → activityStatuses도 completed 업데이트 (StageMoveModal 미완료 체크 정합성)
      setActivityStatus(project.id, viewingActivity, 'completed').catch(console.error)
      if (currentArtifact) setCurrentArtifact({ ...currentArtifact, status: 'confirmed', confirmedContent: content })
    } catch (err) {
      console.error('산출물 확정 실패:', err)
    } finally {
      setIsSaving(false)
    }
  }

  async function handleRedraft() {
    if (!displayArtifact || !project) return
    await setProjectArtifact(project.id, currentActivity, {
      status: 'in_review',
      title: displayArtifact.title,
      content: (displayArtifact.aiDraft ?? {}) as Record<string, unknown>,
      version: displayArtifact.currentVersion,
    })
    if (currentArtifact) setCurrentArtifact({ ...currentArtifact, status: 'in_review' })
  }

  async function handleDeleteArtifact() {
    if (!displayArtifact || !project || !viewingActivity) return
    const ok = typeof window !== 'undefined'
      ? window.confirm(`'${displayArtifact.title || viewingActivity}' 산출물을 정말 삭제할까요?\n\n공동 편집 워크스페이스 초안은 그대로 남아 있으며, 산출물 카드만 제거됩니다.`)
      : true
    if (!ok) return
    setIsSaving(true)
    try {
      await deleteProjectArtifact(project.id, viewingActivity)
      setCurrentArtifact(null)
    } catch (err) {
      console.error('산출물 삭제 실패:', err)
    } finally {
      setIsSaving(false)
    }
  }

  async function handleRevisionRequest() {
    if (!displayArtifact || !project) return
    await setProjectArtifact(project.id, currentActivity, {
      status: 'in_review',
      title: displayArtifact.title,
      content: (displayArtifact.confirmedContent ?? displayArtifact.aiDraft ?? {}) as Record<string, unknown>,
      version: displayArtifact.currentVersion,
      revisionNote: revisionNote.trim() || undefined,
      revisionRequestedBy: userProfile?.uid,
      revisionRequestedAt: Date.now(),
    })
    if (currentArtifact) setCurrentArtifact({ ...currentArtifact, status: 'in_review' })
    setRevisionNote('')
    setShowRevisionForm(false)
  }

  async function handleDeleteSection(key: string) {
    if (!project || !firestoreArtifact) return
    let newContent: Record<string, unknown>
    if (key === '__clear_all__') {
      // 구조화 산출물 전체 삭제
      newContent = {}
    } else if (key.startsWith('__field:') && key.endsWith('__')) {
      // 구조화 산출물 카드(필드) 단위 부분 삭제 — sentinel `__field:<name>__`.
      // 현재 T-1-1 지원: personalVisions / teamVision / coreKeywords / blocks
      const field = key.slice('__field:'.length, -2)
      newContent = { ...(firestoreArtifact.content as Record<string, unknown>) }
      if (field === 'personalVisions') newContent.personalVisions = []
      else if (field === 'teamVision') newContent.teamVision = ''
      else if (field === 'coreKeywords') newContent.coreKeywords = []
      else if (field === 'blocks') {
        const ws = (newContent.manualWorkspace as Record<string, unknown> | undefined) ?? null
        if (ws) newContent.manualWorkspace = { ...ws, blocks: [] }
      }
    } else {
      newContent = { ...(firestoreArtifact.content as Record<string, unknown>) }
      delete newContent[key]
    }
    // 내용이 비었거나 confirmed 상태에서 수정하면 in_review로 되돌림
    const isEmpty = Object.keys(newContent).length === 0
    const nextStatus: 'ai_draft' | 'in_review' | 'confirmed' =
      isEmpty || firestoreArtifact.status === 'confirmed' || firestoreArtifact.status === 'rejected'
        ? 'in_review'
        : firestoreArtifact.status as 'ai_draft' | 'in_review'
    await setProjectArtifact(project.id, viewingActivity, {
      status: nextStatus,
      title: firestoreArtifact.title,
      content: newContent,
      version: firestoreArtifact.version + 1,
    }).catch(console.error)
    // 로컬 currentArtifact도 즉시 반영 (displayArtifact가 로컬 우선이므로 필수)
    if (currentArtifact) {
      setCurrentArtifact({
        ...currentArtifact,
        status: nextStatus,
        aiDraft: newContent,
        lastEditedContent: newContent,
        confirmedContent: isEmpty ? undefined : newContent,
      })
    }
  }

  // 선택한 과거 버전을 새 버전으로 재기록 — 현재 content는 setProjectArtifact 내부에서 versions에 자동 push.
  async function handleRollback(targetVersion: number) {
    if (!project || !firestoreArtifact) return
    const versions = firestoreArtifact.versions ?? []
    const target = versions.find(v => v.version === targetVersion)
    if (!target) return
    const ok = typeof window !== 'undefined'
      ? window.confirm(`이 버전(v${target.version})으로 되돌리시겠습니까? 현재 내용도 새 버전으로 기록됩니다.`)
      : true
    if (!ok) return
    setShowVersionMenu(false)
    setIsSaving(true)
    try {
      await setProjectArtifact(project.id, viewingActivity, {
        status: firestoreArtifact.status as 'confirmed' | 'in_review' | 'ai_draft',
        title: firestoreArtifact.title,
        content: target.content,
        version: firestoreArtifact.version + 1,
      })
      if (currentArtifact) {
        setCurrentArtifact({
          ...currentArtifact,
          aiDraft: target.content,
          lastEditedContent: target.content,
          confirmedContent: firestoreArtifact.status === 'confirmed' ? target.content : currentArtifact.confirmedContent,
        })
      }
    } catch (err) {
      console.error('산출물 rollback 실패:', err)
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDirectSave() {
    if (!project || !directInputText.trim()) return
    setIsSaving(true)
    try {
      const content = { [activityMeta.label]: directInputText.trim() }
      await setProjectArtifact(project.id, viewingActivity, {
        status: 'in_review',
        title: `${activityMeta.label} - 직접 입력`,
        content,
        version: (displayArtifact?.currentVersion ?? 0) + 1,
      })
      setShowDirectInput(false)
      setDirectInputText('')
    } catch (err) {
      console.error('직접 입력 저장 실패:', err)
    } finally {
      setIsSaving(false)
    }
  }

  const displayContent =
    displayArtifact?.confirmedContent ??
    displayArtifact?.lastEditedContent ??
    displayArtifact?.aiDraft ??
    {}

  const hasContent = Object.keys(displayContent).length > 0

  function openArtifactPreview(modal: ArtifactPreviewModalState) {
    setPreviewModal(modal)
  }

  function openCurrentArtifactPreview() {
    openArtifactPreview({
      title: displayArtifact?.title ?? activityMeta.label,
      subtitle: `${activityMeta.label} · 버전 ${displayArtifact?.currentVersion ?? 1}`,
      content: displayContent,
      status: effectiveStatus,
      stageCode: activityMeta.stage,
      activityCode: viewingActivity,
    })
  }

  function openPreviousArtifactPreview(activityCode: string) {
    const artifact = previousArtifacts.find((item) => item.code === activityCode)
    if (!artifact) return
    openArtifactPreview({
      title: artifact.title,
      subtitle: `${artifact.label} · 버전 ${artifact.version}`,
      content: artifact.content,
      status: artifact.status,
      stageCode: artifact.stageCode,
      activityCode: artifact.code,
    })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden corner-wrap-artifact"
      style={{ '--cc': stageColor.corner } as React.CSSProperties}>
      {/* ─── 산출물 아이덴티티 헤더 (스펙 §7-3 Z 패턴) ────────────────
          1행: full-width 상태 밴드 — StatusBadge가 최상위 우선순위
          2행: 활동 라벨 + 단계 코드 + 액션들
          3행: 제목 + 버전 + 잠금 안내 */}
      <div className="flex-shrink-0">
        {/* 1행 — 상태 밴드 (스펙: 상단 full-width 밴드, stage.light 배경) */}
        <div className={cn(stageColor.light, 'px-5 py-2 flex items-center gap-2 border-b border-white/40')}>
          {displayArtifact
            ? <StatusBadge status={effectiveStatus} />
            : (
              <span className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full font-semibold bg-white/70 text-[#5F6368]">
                <CircleIcon size={12} weight="bold" />
                미작성
              </span>
            )
          }
          {/* 업데이트 있음 pulse — 변경된 섹션이 있으면 황색 점 */}
          {recentlyUpdatedKeys.size > 0 && (
            <span className="flex items-center gap-1 text-[10px] font-bold text-[#B06000] bg-white/80 rounded-full px-2 py-0.5">
              <span
                className="w-1.5 h-1.5 rounded-full bg-[#FBBC04] artifact-strip-pulse"
                aria-hidden="true"
              />
              업데이트됨
            </span>
          )}
          {firestoreArtifact && (
            <div className="ml-auto relative">
              <button
                type="button"
                onClick={() => setShowVersionMenu(prev => !prev)}
                disabled={isSaving}
                className={cn(
                  'flex items-center gap-1 text-[10px] font-semibold text-[#5F6368] tabular-nums',
                  'rounded-full px-2 py-0.5 bg-white/70 hover:bg-white transition-colors',
                  'disabled:opacity-50',
                )}
                title="버전 이력"
                aria-haspopup="menu"
                aria-expanded={showVersionMenu}
              >
                <ClockCounterClockwise size={11} weight="bold" />
                v{firestoreArtifact.version}
                <CaretDown size={9} weight="bold" />
              </button>
              {showVersionMenu && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    aria-hidden="true"
                    onClick={() => setShowVersionMenu(false)}
                  />
                  <div className="absolute right-0 top-full mt-1 z-40 w-64 bg-white rounded-xl shadow-lg border border-[#E0E0E0] py-1.5 max-h-80 overflow-y-auto">
                    <div className="px-3 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-[#9AA0A6]">
                      버전 이력
                    </div>
                    <div className="px-3 py-1.5 flex items-center justify-between border-b border-[#F1F3F4] mb-1">
                      <span className="text-[11px] font-bold text-[#202124] tabular-nums">
                        v{firestoreArtifact.version} (현재)
                      </span>
                      <span className="text-[10px] text-[#9AA0A6]">최신</span>
                    </div>
                    {(firestoreArtifact.versions ?? []).length === 0 ? (
                      <div className="px-3 py-3 text-[11px] text-[#9AA0A6]">
                        이전 버전 이력이 없습니다.
                      </div>
                    ) : (
                      [...(firestoreArtifact.versions ?? [])]
                        .sort((a, b) => b.version - a.version)
                        .slice(0, 10)
                        .map((v, idx) => (
                          // Why: setProjectArtifact가 같은 version을 두 번 push하는 경로(rollback 등)가 있어
                          //      v.version만으로는 unique 보장이 안 됨. savedAt + idx로 fallback.
                          <div
                            key={`${v.version}-${v.savedAt}-${idx}`}
                            className="px-3 py-1.5 flex items-center justify-between hover:bg-[#F8F9FA] transition-colors"
                          >
                            <div className="flex flex-col min-w-0">
                              <span className="text-[11px] font-semibold text-[#202124] tabular-nums">
                                v{v.version}
                              </span>
                              <span className="text-[10px] text-[#9AA0A6] truncate">
                                {new Date(v.savedAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                {v.savedBy ? ` · ${v.savedBy}` : ''}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRollback(v.version)}
                              disabled={isSaving}
                              className="ml-2 text-[10px] font-semibold text-[#1A73E8] hover:text-[#1557B0] disabled:opacity-50 flex-shrink-0"
                            >
                              되돌리기
                            </button>
                          </div>
                        ))
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* 2행 + 3행 — stage 배경 유지, 액션 동일선상 */}
        <div className={cn(stageColor.light, 'px-5 pt-3 pb-4')}>
          <div className="flex items-center gap-3 mb-2">
            <div
              className={cn('w-11 h-11 flex items-center justify-center flex-shrink-0', stageColor.bg)}
              style={{
                animation: 'morph-shape 9s ease-in-out infinite, stage-bounce 3.5s ease-in-out infinite',
                boxShadow: `0 6px 16px ${stageColor.pulse}`,
              }}
              aria-hidden="true"
            >
              <FileText size={22} weight="fill" className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className={cn('text-[10px] font-bold uppercase tracking-widest mb-0.5', stageColor.text)}>
                산출물 · {viewingActivity}
              </p>
              <p className="text-[13px] font-extrabold text-[#202124] leading-tight truncate">
                {activityMeta.label}
              </p>
            </div>
            {viewingActivity === 'DI-1-1' && (isHost ? (
              <button
                onClick={() => setShowCumulativeReport(true)}
                title="현재까지 산출물 종합 보고서 제작"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#E65100] hover:bg-[#BF360C] text-white text-[11px] font-bold transition-colors flex-shrink-0 shadow-sm"
              >
                <FileText size={14} weight="fill" />
                보고서 제작하기
              </button>
            ) : project?.cumulativeReport && (
              <button
                onClick={() => setShowCumulativeReport(true)}
                title="팀장이 공유한 종합 보고서 보기"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#FBE9E7] hover:bg-[#FFCCBC] text-[#E65100] text-[11px] font-bold transition-colors flex-shrink-0"
              >
                <FileText size={14} weight="fill" />
                보고서 보기
              </button>
            ))}
            {hasContent && (
              <button
                onClick={openCurrentArtifactPreview}
                title="전체 보기"
                aria-label="산출물 전체 보기"
                className="ml-1 p-1.5 rounded-full hover:bg-white/60 text-[#5F6368] hover:text-[#1A73E8] transition-colors flex-shrink-0"
              >
                <ArrowsOut size={16} weight="regular" />
              </button>
            )}
          </div>

          {/* 제목 + 잠금 안내 */}
          <div className="flex items-center gap-2 flex-wrap">
            {displayArtifact && hasContent && (
              <p className="text-[12px] font-semibold text-[#5F6368] truncate flex-1 min-w-0">
                {displayArtifact.title}
              </p>
            )}
            {!isHost && displayArtifact && (
              <div className="flex items-center gap-1.5 bg-white/60 rounded-full px-3 py-1 flex-shrink-0">
                <Lock size={14} weight="fill" className="text-[#5F6368]" />
                <span className="text-[10px] text-[#5F6368] font-medium">팀장이 확정합니다</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 직접 입력 폼 (오버레이) */}
      {showDirectInput && (
        <div className="absolute inset-0 z-10 bg-white flex flex-col">
          <div className="px-5 py-4 border-b border-[#DADCE0] bg-[#FEF7E0] flex items-center justify-between flex-shrink-0">
            <div>
              <p className="text-sm font-bold text-[#B06000]">산출물 직접 입력</p>
              <p className="text-xs text-[#B06000] opacity-70 mt-0.5">AI가 저장하지 못한 경우 직접 입력하세요</p>
            </div>
            <button onClick={() => setShowDirectInput(false)}
              className="text-[#9AA0A6] hover:text-[#5F6368] rounded-full p-1 hover:bg-[#F1F3F4] transition-colors">
              <X size={16} weight="regular" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            <p className="text-xs text-[#5F6368]">현재 활동: <span className="font-semibold text-[#202124]">{activityMeta.label}</span></p>
            <textarea
              value={directInputText}
              onChange={e => setDirectInputText(e.target.value)}
              placeholder={`예: "학생들이 협력하여 실생활 문제를 해결하는 경험을 만드는 교육"`}
              rows={8}
              className="w-full text-sm border border-[#DADCE0] rounded-2xl px-4 py-3 resize-none
                focus:outline-none focus:ring-2 focus:ring-[#1A73E8] focus:border-transparent leading-relaxed"
            />
          </div>
          <div className="px-5 py-4 border-t border-[#DADCE0] bg-[#F8F9FA] flex gap-2 flex-shrink-0">
            <button
              onClick={handleDirectSave}
              disabled={isSaving || !directInputText.trim()}
              className="flex-1 py-2.5 rounded-full bg-[#FBBC04] text-[#202124] text-sm font-bold
                hover:bg-[#F9AB00] disabled:opacity-50 transition-colors shadow-sm"
            >
              {isSaving ? '저장 중...' : '산출물에 저장'}
            </button>
            <button
              onClick={() => setShowDirectInput(false)}
              className="px-5 py-2.5 rounded-full border border-[#DADCE0] text-[#5F6368] text-sm hover:bg-[#F1F3F4] transition-colors"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* 내용 — 스펙 §7-3: 현재 활동 산출물이 먼저, 누적 산출물은 아래 */}
      <div className="flex-1 overflow-y-auto px-5 py-5">
        {/* §7-3.12 — active_return 재검토 배너 (본문 상단) */}
        {showActiveReturnBanner && (
          <div className="mb-4 rounded-2xl border border-[#FFCC80] bg-[#FBE9E7] px-4 py-3 flex items-start gap-2.5">
            <ArrowBendUpLeft size={18} weight="fill" className="text-[#E65100] flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-bold text-[#E65100]">이 활동을 재검토 중</p>
              <p className="text-[11px] text-[#BF360C] mt-0.5 leading-relaxed">
                기존 합의안을 먼저 확인하고, 수정하려는 근거를 기록한 뒤 반영하세요.
              </p>
            </div>
          </div>
        )}

        {/* §7-3.10 — A-2-3 미완 상태 Ds 진입 시 경고 */}
        {showA23IncompleteWarning && (
          <div className="mb-4 rounded-2xl border border-[#EF9A9A] bg-[#FFEBEE] px-4 py-3 flex items-start gap-2.5">
            <Warning size={18} weight="fill" className="text-[#C62828] flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-bold text-[#C62828]">학습자·맥락 분석(A-2-3)이 완료되지 않았습니다</p>
              <p className="text-[11px] text-[#C62828] mt-0.5 leading-relaxed opacity-90">
                가드레일 없이 설계를 진행하면 학습자·맥락 조건이 누락된 채 설계 부채가 쌓입니다. 먼저 A-2-3부터 마무리하세요.
              </p>
            </div>
          </div>
        )}

        {/* §7-3.9 — Ds 진입 시 A-2-3 가드레일 요약 카드 상단 고정 (기본 펼침) */}
        {showDsGuardrail && a23Artifact && (
          <DsGuardrailCard a23Artifact={a23Artifact} />
        )}

        {!displayArtifact || !hasContent ? (
          <>
            <EmptyState
              activityLabel={activityMeta.label}
              sections={activityMeta.requiredSections ?? activityMeta.recommendedSections}
              sectionVariant={activityMeta.requiredSections ? 'required' : 'recommended'}
              stageLight={stageColor.light}
              stageText={stageColor.text}
            />
            {isHost && (
              <div className="px-2 pb-4 mt-4">
                <button
                  onClick={() => setShowDirectInput(true)}
                  className="squid-btn morph-btn w-full flex items-center justify-center gap-2 py-2.5
                    bg-[rgba(249,171,0,0.12)] hover:bg-[rgba(249,171,0,0.24)] text-[#B06000] text-sm font-semibold transition-colors"
                >
                  <PencilSimple size={16} weight="regular" />
                  AI가 저장 안 했나요? 직접 입력하기
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="space-y-5">
            {/* 현재 산출물 메타 (제목은 상단 밴드로 이동, 여기선 부메타만) */}
            <div className="pb-3 border-b border-[#F1F3F4] flex items-center justify-between gap-2">
              <p className="text-[11px] text-[#9AA0A6] tabular-nums">
                버전 {displayArtifact.currentVersion} · {displayArtifact.artifactType}
              </p>
              <span className={cn('inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest', stageColor.text)}>
                <Stack size={12} weight="fill" />
                현재 활동
              </span>
            </div>

            {effectiveStatus === 'in_review' && displayArtifact.aiDraft && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="flex items-center gap-1 text-xs bg-[#E8F0FE] text-[#1A73E8] px-2.5 py-1 rounded-full font-semibold">
                    <Sparkle size={16} weight="fill" />
                    AI 초안 검토
                  </span>
                  <span className="text-xs text-[#9AA0A6]">
                    {isHost ? '내용을 확인하고 확정하세요' : '팀장이 확정 대기 중'}
                  </span>
                </div>
                <div className="border-l-4 border-[#1A73E8] pl-2">
                  {(ACTIVITY_META[viewingActivity].requiredSections
                    || ACTIVITY_META[viewingActivity].recommendedSections) && (
                    <RequiredSectionsChecklist
                      activityCode={viewingActivity}
                      content={displayArtifact.aiDraft as Record<string, unknown>}
                      schemaVersion={firestoreArtifact?._schemaVersion}
                    />
                  )}
                  <ArtifactContent
                    content={displayArtifact.aiDraft!}
                    onDeleteSection={isHost ? handleDeleteSection : undefined}
                    onOpenPreview={openArtifactPreview}
                    artifactTitle={displayArtifact.title}
                    artifactStatus={effectiveStatus}
                    stageCode={activityMeta.stage}
                    activityCode={viewingActivity}
                    allowTableExpand
                    recentlyUpdatedKeys={recentlyUpdatedKeys}
                  />
                </div>
              </div>
            )}

            {effectiveStatus !== 'in_review' && (
              <>
                {(ACTIVITY_META[viewingActivity].requiredSections
                  || ACTIVITY_META[viewingActivity].recommendedSections) && (
                  <RequiredSectionsChecklist
                    activityCode={viewingActivity}
                    content={displayContent as Record<string, unknown>}
                    schemaVersion={firestoreArtifact?._schemaVersion}
                  />
                )}
                <ArtifactContent
                  content={displayContent}
                  onDeleteSection={isHost ? handleDeleteSection : undefined}
                  onOpenPreview={openArtifactPreview}
                  artifactTitle={displayArtifact.title}
                  artifactStatus={effectiveStatus}
                  stageCode={activityMeta.stage}
                  activityCode={viewingActivity}
                  allowTableExpand
                  recentlyUpdatedKeys={recentlyUpdatedKeys}
                />
              </>
            )}

            {/* 수정 요청 메모 배너 */}
            {firestoreArtifact?.revisionNote && effectiveStatus === 'in_review' && (
              <div className="rounded-2xl border border-[#FBBC04] bg-[#FEF7E0] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Chat size={16} weight="fill" className="text-[#F9AB00]" />
                  <span className="text-xs font-bold text-[#B06000]">
                    수정 요청
                    {firestoreArtifact.revisionRequestedBy && (
                      <span className="font-normal ml-1 opacity-80">
                        · {project?.memberInfo?.[firestoreArtifact.revisionRequestedBy]?.displayName ?? '팀원'}
                        {firestoreArtifact.revisionRequestedAt && (
                          <> · {new Date(firestoreArtifact.revisionRequestedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</>
                        )}
                      </span>
                    )}
                  </span>
                </div>
                <p className="text-sm text-[#B06000] leading-relaxed whitespace-pre-wrap opacity-90">
                  "{firestoreArtifact.revisionNote}"
                </p>
              </div>
            )}

            {/* 확정 정보 */}
            {isConfirmed && firestoreArtifact?.confirmedBy && (
              <div className="flex items-center gap-2 text-xs text-[#137333] bg-[#E6F4EA] rounded-full px-4 py-2">
                <CheckCircle size={16} weight="fill" className="text-[#34A853]" />
                <span>
                  {firestoreArtifact.confirmedBy === userProfile?.uid
                    ? '내가 확정함'
                    : (project?.memberInfo?.[firestoreArtifact.confirmedBy]?.displayName ?? '팀장') + '이 확정함'}
                  {firestoreArtifact.confirmedAt && (
                    <> · {new Date(firestoreArtifact.confirmedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</>
                  )}
                </span>
              </div>
            )}

            <div className="flex items-center gap-1.5 text-[11px] text-[#9AA0A6] pt-2 border-t border-[#F1F3F4]">
              <Clock size={16} weight="regular" />
              <span>
                {displayArtifact.meta?.updatedAt
                  ? new Date(displayArtifact.meta.updatedAt.toDate()).toLocaleString('ko-KR')
                  : '방금 전'}
              </span>
            </div>
          </div>
        )}

        {/* 누적 산출물 — 스펙 §7-3: 현재 산출물 이후 아래 섹션으로 분리
            (빈 상태에서도 참고로 볼 수 있도록 항상 노출) */}
        {previousArtifacts.length > 0 && (
          <div className="mt-6 rounded-2xl border-2 border-[#C2D7F8] bg-[#F5FAFF] p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[#1A73E8]">
                  <Stack size={15} weight="fill" className="text-white" />
                </span>
                <div className="min-w-0">
                  <p className="text-[12px] font-bold text-[#1557B0]">저장된 산출물 (이전 활동)</p>
                  <p className="text-[11px] text-[#5F6368] mt-0.5 leading-snug">
                    저장한 이전 활동 결과물입니다. 카드를 클릭하면 새 창에서 열립니다.
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-bold text-white bg-[#1A73E8] px-2.5 py-1 rounded-full whitespace-nowrap tabular-nums">
                저장됨 {previousArtifacts.length}
              </span>
            </div>
            {/* §7-3.8 — 각 이전 산출물에 관계 pill 부착 */}
            <div className="space-y-1.5">
              {previousArtifacts.map((artifact) => {
                const relStyle = RELATION_STYLE[artifact.relation]
                return (
                  <button
                    key={artifact.code}
                    onClick={() => openPreviousArtifactPreview(artifact.code)}
                    className="w-full flex items-center gap-2 rounded-xl border border-[#DADCE0] bg-white px-3 py-2 hover:border-[#1A73E8] hover:bg-[#F8FBFF] transition-colors text-left"
                  >
                    <span className={cn('inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0', relStyle.bg, relStyle.text)}>
                      {relStyle.label}
                    </span>
                    <span className="text-[11px] font-semibold text-[#5F6368] tabular-nums flex-shrink-0">
                      {artifact.code}
                    </span>
                    <span className="text-[12px] text-[#202124] truncate flex-1 min-w-0">
                      {artifact.label}
                    </span>
                    <CaretLeft size={12} weight="bold" className="rotate-180 text-[#9AA0A6] flex-shrink-0" />
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* 액션 버튼 — 내용이 없으면 숨김 */}
      {displayArtifact && hasContent && (
        <div className="px-5 py-4 border-t border-[#DADCE0] bg-[#F8F9FA] space-y-2.5 flex-shrink-0">
          {isHost ? (
            isConfirmed ? (
              <>
                <div className="flex items-center gap-2 text-[#137333] mb-1">
                  <CheckCircle size={16} weight="fill" className="text-[#34A853]" />
                  <span className="text-sm font-bold">산출물이 확정되었습니다</span>
                </div>
                <button
                  onClick={handleRedraft}
                  className="squid-btn morph-btn w-full flex items-center justify-center gap-2 py-2.5
                    text-[#5F6368] bg-[rgba(95,99,104,0.08)] hover:bg-[rgba(95,99,104,0.16)] text-sm transition-colors"
                >
                  <ClockCounterClockwise size={16} weight="regular" />
                  확정 취소 · 재검토
                </button>
                <button
                  onClick={handleDeleteArtifact}
                  disabled={isSaving}
                  className="squid-btn morph-btn w-full flex items-center justify-center gap-2 py-2.5
                    text-[#C62828] bg-[rgba(217,48,37,0.08)] hover:bg-[rgba(217,48,37,0.16)] text-sm font-semibold
                    disabled:opacity-60 transition-colors"
                  title="산출물 카드를 삭제합니다 (워크스페이스 초안은 유지)"
                >
                  <Trash size={16} weight="regular" />
                  산출물 삭제
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleConfirm}
                  disabled={isSaving}
                  className="squid-btn morph-btn w-full flex items-center justify-center gap-2 py-3
                    bg-[rgba(52,168,83,0.15)] hover:bg-[rgba(52,168,83,0.28)] text-[#1E7E34] text-sm font-bold
                    disabled:opacity-60 transition-colors"
                >
                  <CheckCircle size={16} weight="fill" />
                  {isSaving ? '저장 중...' : '산출물 확정하기'}
                </button>
                <button
                  onClick={handleRedraft}
                  className="squid-btn morph-btn w-full flex items-center justify-center gap-2 py-2.5
                    text-[#5F6368] bg-[rgba(95,99,104,0.08)] hover:bg-[rgba(95,99,104,0.16)] text-sm transition-colors"
                >
                  <ClockCounterClockwise size={16} weight="regular" />
                  AI 재초안 요청
                </button>
                <button
                  onClick={handleDeleteArtifact}
                  disabled={isSaving}
                  className="squid-btn morph-btn w-full flex items-center justify-center gap-2 py-2.5
                    text-[#C62828] bg-[rgba(217,48,37,0.08)] hover:bg-[rgba(217,48,37,0.16)] text-sm font-semibold
                    disabled:opacity-60 transition-colors"
                  title="산출물 카드를 삭제합니다 (워크스페이스 초안은 유지)"
                >
                  <Trash size={16} weight="regular" />
                  산출물 삭제
                </button>
              </>
            )
          ) : (
            isConfirmed ? (
              <>
                <div className="flex items-center gap-2 text-[#137333] mb-1">
                  <CheckCircle size={16} weight="fill" className="text-[#34A853]" />
                  <span className="text-sm font-semibold">팀장이 확정한 산출물입니다</span>
                </div>
                {showRevisionForm ? (
                  <div className="space-y-2">
                    <textarea
                      value={revisionNote}
                      onChange={e => setRevisionNote(e.target.value)}
                      placeholder="수정이 필요한 내용을 적어주세요..."
                      rows={3}
                      className="w-full text-sm border border-[#DADCE0] rounded-2xl px-4 py-3 resize-none
                        focus:outline-none focus:ring-2 focus:ring-[#FBBC04] focus:border-transparent"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleRevisionRequest}
                        className="squid-btn morph-btn flex-1 py-2.5 bg-[rgba(249,171,0,0.18)] hover:bg-[rgba(249,171,0,0.32)] text-[#B06000] text-sm font-bold transition-colors flex items-center justify-center gap-2"
                      >
                        <Chat size={15} weight="fill" />
                        수정 요청 보내기
                      </button>
                      <button
                        onClick={() => setShowRevisionForm(false)}
                        className="squid-btn morph-btn px-4 py-2.5 text-[#5F6368] bg-[rgba(95,99,104,0.08)] hover:bg-[rgba(95,99,104,0.16)] text-sm transition-colors"
                      >
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowRevisionForm(true)}
                    className="squid-btn morph-btn w-full flex items-center justify-center gap-2 py-2.5
                      bg-[rgba(249,171,0,0.14)] hover:bg-[rgba(249,171,0,0.28)] text-[#B06000] text-sm font-semibold transition-colors"
                  >
                    <Chat size={16} weight="fill" />
                    수정 요청하기
                  </button>
                )}
              </>
            ) : (
              <div className="flex items-center gap-2 text-[#9AA0A6] text-xs py-1">
                <Lock size={16} weight="regular" />
                <span>팀장만 산출물을 확정할 수 있습니다</span>
              </div>
            )
          )}
        </div>
      )}

      <ArtifactPreviewModal modal={previewModal} onClose={() => setPreviewModal(null)} />
      {showCumulativeReport && (
        <CumulativeReportModal onClose={() => setShowCumulativeReport(false)} />
      )}
    </div>
  )
}

// ─── 접힘 상태 strip ────────────────────────────────
// 스펙 §5-2: 접힘 상태에서도 "어떤 산출물인가"를 읽을 수 있어야 함.
// - 섹션 개수 뱃지 (DISPLAY_BLOCKED_KEYS 제외 후 개수)
// - 상태 점(ai_draft=파랑, in_review=황, confirmed=녹색, rejected=빨강)
// - 업데이트 pulse — content 변경 감지 시 1.8초 pulse
export function CollapsedArtifactStrip({ onExpand }: { onExpand: () => void }) {
  const { project, viewingActivity, currentActivity } = useProjectStore()
  const firestoreArtifact = project?.artifacts?.[viewingActivity]

  const sectionCount = useMemo(
    () => getVisibleArtifactSectionCount(firestoreArtifact?.content as Record<string, unknown> | undefined),
    [firestoreArtifact?.content]
  )

  // 변경 감지 — 직전 content serialized와 비교해 달라지면 짧은 pulse
  const previousSerializedRef = useRef<string>('')
  const previousActivityRef = useRef<ActivityCode>(viewingActivity)
  const [justUpdated, setJustUpdated] = useState(false)

  useEffect(() => {
    const serialized = JSON.stringify(firestoreArtifact?.content ?? {})
    if (previousActivityRef.current !== viewingActivity) {
      previousActivityRef.current = viewingActivity
      previousSerializedRef.current = serialized
      setJustUpdated(false)
      return
    }
    if (previousSerializedRef.current === serialized) return
    previousSerializedRef.current = serialized
    setJustUpdated(true)
    const t = setTimeout(() => setJustUpdated(false), 1800)
    return () => clearTimeout(t)
  }, [firestoreArtifact?.content, viewingActivity])

  const statusDotColor = firestoreArtifact
    ? ARTIFACT_STATUS_DOT[firestoreArtifact.status as ArtifactStatus]
    : '#DADCE0'

  const statusLabel = firestoreArtifact
    ? STATUS_CONFIG[firestoreArtifact.status as ArtifactStatus].label
    : '미작성'

  return (
    <button
      type="button"
      onClick={onExpand}
      aria-label={`산출물 패널 펼치기 — 현재 활동: ${viewingActivity}, 상태: ${statusLabel}${sectionCount > 0 ? `, 섹션 ${sectionCount}개` : ''}`}
      title={`산출물 패널 펼치기 · ${statusLabel}${sectionCount > 0 ? ` · ${sectionCount}개 섹션` : ''}`}
      className="flex-1 flex flex-col items-center justify-start gap-2 pt-3 pb-3 bg-white hover:bg-[#F8F9FA] transition-colors"
    >
      <span
        className="flex items-center justify-center w-6 h-6 rounded-md text-[#9AA0A6]"
        aria-hidden="true"
      >
        <CaretLeft size={14} weight="bold" />
      </span>

      {/* 파일 아이콘 + 상태 점.
          v1.2 §11-2 ArtifactPanel 3분기 로직:
          - justUpdated → 'artifact-strip-pulse' (이벤트성 알림, 우선)
          - isLiveViewing && status !== 'confirmed' → 'live-dot-pulse' (상태 지속 신호)
          - confirmed → 정지 (확정된 산출물은 안정 상태, 맥박 부재로 "팀 합의 완료" 의미 전달) */}
      {(() => {
        const isLiveViewing = viewingActivity === currentActivity
        const isConfirmed = firestoreArtifact?.status === 'confirmed'
        const pulseClass = justUpdated
          ? 'artifact-strip-pulse'
          : isLiveViewing && firestoreArtifact && !isConfirmed
            ? 'live-dot-pulse'
            : ''
        return (
          <span className="relative flex items-center justify-center">
            <FileText size={18} weight="fill" className="text-[#5F6368]" />
            <span
              className={cn('absolute -right-1 -bottom-1 w-2.5 h-2.5 rounded-full border border-white', pulseClass)}
              style={{
                backgroundColor: statusDotColor,
                // live-dot-pulse는 box-shadow에 currentColor를 쓰므로 dot 색을 currentColor로 위임
                color: statusDotColor,
              }}
              aria-hidden="true"
            />
          </span>
        )
      })()}

      {/* 섹션 개수 뱃지 */}
      {sectionCount > 0 && (
        <span className="inline-flex items-center justify-center min-w-[20px] h-[20px] px-1 rounded-full bg-[#E8F0FE] text-[#1A73E8] text-[10px] font-bold tabular-nums">
          {sectionCount}
        </span>
      )}

      {/* 업데이트 인디케이터 — 최근 변경이 있으면 ⚡ 문구 */}
      {justUpdated && (
        <span className="text-[9px] font-bold text-[#B06000] leading-none tracking-widest uppercase">
          NEW
        </span>
      )}

      <span
        className="text-[12px] font-extrabold text-[#5F6368] tracking-widest mt-1"
        style={{ writingMode: 'vertical-rl' }}
      >
        산출물
      </span>
    </button>
  )
}
