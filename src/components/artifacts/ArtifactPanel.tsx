'use client'

import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useProjectStore } from '@/store/project'
import { ACTIVITY_META, STAGES } from '@/types'
import type { ActivityCode, ArtifactStatus, RequiredSection } from '@/types'
import { setProjectArtifact, setActivityStatus } from '@/lib/firebase/projects'
import { Timestamp } from 'firebase/firestore'
import { cn } from '@/lib/utils'
import { Sparkle, Note, CheckCircle, XCircle, FileText, Lock, Chat, Clock, X, PencilSimple, ClockCounterClockwise, ArrowsOut, CaretDown, CaretUp, Circle as CircleIcon, Lightbulb, type Icon } from '@phosphor-icons/react'
import { createPortal } from 'react-dom'
import { CumulativeReportModal } from '@/components/modals/CumulativeReportModal'

const STAGE_COLOR: Record<string, { bg: string; text: string; light: string; pulse: string; corner: string }> = {
  T:  { bg: 'bg-[#1A73E8]', text: 'text-[#1A73E8]', light: 'bg-[#E8F0FE]', pulse: 'rgba(26,115,232,0.35)',  corner: 'rgba(26,115,232,0.11)'  },
  A:  { bg: 'bg-[#7B1FA2]', text: 'text-[#7B1FA2]', light: 'bg-[#F3E5F5]', pulse: 'rgba(123,31,162,0.35)', corner: 'rgba(123,31,162,0.10)'  },
  Ds: { bg: 'bg-[#00897B]', text: 'text-[#00897B]', light: 'bg-[#E0F2F1]', pulse: 'rgba(0,137,123,0.35)',  corner: 'rgba(0,137,123,0.10)'   },
  DI: { bg: 'bg-[#E65100]', text: 'text-[#E65100]', light: 'bg-[#FBE9E7]', pulse: 'rgba(230,81,0,0.35)',   corner: 'rgba(230,81,0,0.10)'    },
  E:  { bg: 'bg-[#C62828]', text: 'text-[#C62828]', light: 'bg-[#FFEBEE]', pulse: 'rgba(198,40,40,0.35)',  corner: 'rgba(198,40,40,0.10)'   },
}

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

function EmptyState({ activityLabel }: { activityLabel: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-[#9AA0A6] gap-5 px-6">
      <div className="w-16 h-16 rounded-full bg-[#F1F3F4] flex items-center justify-center">
        <FileText size={36} weight="regular" className="text-[#DADCE0]" />
      </div>
      <div className="text-center">
        <p className="text-sm font-semibold text-[#5F6368]">아직 산출물이 없습니다</p>
        <p className="text-xs text-[#9AA0A6] mt-1.5 leading-relaxed">
          [{activityLabel}] 활동에서<br />
          AI와 대화하면 초안이 자동으로 생성됩니다
        </p>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-[#9AA0A6] bg-[#F1F3F4] rounded-full px-4 py-2">
        <Chat size={16} weight="regular" />
        <span>채팅</span>
        <span>→</span>
        <span className="font-medium text-[#5F6368]">산출물</span>
      </div>
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

function ArtifactPreviewModal({
  modal,
  onClose,
}: {
  modal: ArtifactPreviewModalState | null
  onClose: () => void
}) {
  if (!modal || typeof document === 'undefined') return null
  const modalStageColor = STAGE_COLOR[modal.stageCode] ?? STAGE_COLOR.T

  return createPortal(
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden"
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
            onClick={onClose}
            className="ml-2 p-1.5 rounded-full hover:bg-[#F1F3F4] text-[#5F6368] transition-colors flex-shrink-0"
          >
            <X size={18} weight="regular" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
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
  const meta = ACTIVITY_META[activityCode]
  const sections = meta.requiredSections
  if (!sections || sections.length === 0) return null

  const allSections = sections.filter(s => s.required === 'all')
  const anySections = sections.filter(s => s.required === 'any')

  function sectionInfo(sec: RequiredSection) {
    const filled = countKoreanChars(content[sec.key])
    const satisfied = filled >= sec.minChars
    const pct = Math.min(100, Math.round((filled / sec.minChars) * 100))
    return { filled, satisfied, pct }
  }

  const allSatisfied = allSections.every(s => sectionInfo(s).satisfied)
  const anySatisfied = anySections.length === 0 || anySections.some(s => sectionInfo(s).satisfied)
  const overallSatisfied = allSatisfied && anySatisfied

  // 헤더 라벨 생성 (required 규칙 조합에 따라 동적)
  let headerDesc = ''
  if (allSections.length > 0 && anySections.length > 0) {
    headerDesc = `필수 ${allSections.length}개 전부 + 선택 ${anySections.length}개 중 1개 이상 충족 시 완료 인정`
  } else if (allSections.length > 0) {
    headerDesc = `${allSections.length}개 섹션 모두 충족 시 완료 인정`
  } else if (anySections.length > 0) {
    headerDesc = `${anySections.length}개 중 최소 1개 충족 시 완료 인정`
  }

  // 레거시(grandfather) 산출물은 섹션 검증 미적용 — 안내 문구로 알려줌
  const isLegacy = schemaVersion !== 'v2-sections'

  const sectionOrder: RequiredSection[] = [...allSections, ...anySections]

  return (
    <div
      className={cn(
        'rounded-2xl border-2 p-4 mb-4 transition-colors',
        overallSatisfied
          ? 'border-[#34A853] bg-[#E6F4EA]/30'
          : 'border-[#C62828] bg-[#FFEBEE]/30'
      )}
    >
      <button
        type="button"
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className={cn(
            'w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0',
            overallSatisfied ? 'bg-[#34A853]' : 'bg-[#C62828]'
          )}>
            {overallSatisfied
              ? <CheckCircle size={14} weight="fill" className="text-white" />
              : <CircleIcon size={10} weight="bold" className="text-white" />}
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-extrabold text-[#202124] leading-tight">
              {meta.label} 필수 섹션
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

          {/* 가이드 문구 */}
          <div className="flex items-start gap-2 rounded-xl bg-white/70 border border-[#F1F3F4] px-3 py-2">
            <Lightbulb size={15} weight="fill" className="text-[#F9AB00] flex-shrink-0 mt-0.5" />
            <p className="text-[11px] text-[#5F6368] leading-relaxed">
              AI에게 <span className="font-semibold text-[#202124]">
                &ldquo;{sections.map(s => s.label).join('·')} 순서로 정리해줘&rdquo;
              </span>
              라고 요청하면 자동으로 채워집니다.
            </p>
          </div>

          {isLegacy && (
            <p className="text-[10px] text-[#9AA0A6] italic leading-snug px-1">
              이 산출물은 구 스키마로 저장되어 섹션 검증이 적용되지 않습니다. 완료 판정은 기존 규칙을 따릅니다.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ArtifactSection({ sectionKey, value, onDelete, onOpenPreview, artifactTitle, artifactStatus, stageCode, activityCode, allowTableExpand }: {
  sectionKey: string
  value: unknown
  onDelete?: () => void
  onOpenPreview?: (modal: ArtifactPreviewModalState) => void
  artifactTitle?: string
  artifactStatus?: ArtifactStatus
  stageCode?: string
  activityCode?: ActivityCode
  allowTableExpand?: boolean
}) {
  const canExpandTable = typeof value === 'string' && hasMarkdownTable(value)
  const isSupportToolEnvironmentCheck = sectionKey === 'AI 점검' && activityCode === 'Ds-2-1' && typeof value === 'string'

  return (
    <div className="rounded-2xl border border-[#DADCE0] overflow-hidden bg-white md-shadow-1">
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
                  <span className="inline-block px-1.5 py-0.5 rounded-md text-[13px] font-semibold bg-[#E8F0FE] text-[#1A73E8] leading-snug mx-0.5">
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
                td: ({ children }) => {
                  const text = typeof children === 'string' ? children : String(children ?? '')
                  const parts = text.split('\u2028')
                  return (
                    <td className="px-3 py-2.5 text-sm text-[#202124] leading-relaxed">
                      {parts.map((part, i) => (
                        <span key={i}>{part}{i < parts.length - 1 && <br />}</span>
                      ))}
                    </td>
                  )
                },
              }}
            >
              {/* **항목**: 패턴 앞에 빈 줄 삽입 → 각 항목이 별도 단락으로 분리 */}
              {/* 표 셀 안의 <br/>은 \u2028으로, 표 밖의 <br/>은 제거 */}
              {value
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
                <span className="leading-relaxed">{String(item)}</span>
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
  '다음 행동', '다음 단계', 'next step',
  '미결 사항', '미결', '보류 사항',
  'ai 제안', '추천 사항', '참고 사항',
  '합의 내용', '논의 내용', '토론 내용', '토의 내용', '확인 사항',
  '진행 내용', '진행 사항', '현황', '요약',
  // 아래는 명시적 저장 경로(save proposal)에서 사용하는 키이므로 차단하지 않음
  // '토의 결과' / '토론 결과', '보완할 점' → 표시 허용
]

function ArtifactContent({ content, onDeleteSection, onOpenPreview, artifactTitle, artifactStatus, stageCode, activityCode, allowTableExpand }: {
  content: Record<string, unknown>
  onDeleteSection?: (key: string) => void
  onOpenPreview?: (modal: ArtifactPreviewModalState) => void
  artifactTitle?: string
  artifactStatus?: ArtifactStatus
  stageCode?: string
  activityCode?: ActivityCode
  allowTableExpand?: boolean
}) {
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
        />
      ))}
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
  const [selectedReferenceActivity, setSelectedReferenceActivity] = useState('')
  const [previewModal, setPreviewModal] = useState<ArtifactPreviewModalState | null>(null)
  const [showCumulativeReport, setShowCumulativeReport] = useState(false)

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
      }))
  }, [orderedActivities, project?.artifacts, viewingActivity])

  useEffect(() => {
    if (previousArtifacts.length === 0) {
      setSelectedReferenceActivity('')
      return
    }
    if (!previousArtifacts.some((artifact) => artifact.code === selectedReferenceActivity)) {
      setSelectedReferenceActivity(previousArtifacts[0].code)
    }
  }, [previousArtifacts, selectedReferenceActivity])

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
    const newContent = { ...(firestoreArtifact.content as Record<string, unknown>) }
    delete newContent[key]
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
      {/* ─── 산출물 아이덴티티 헤더 ─────────────── */}
      <div className={cn(stageColor.light, 'px-5 pt-4 pb-4 flex-shrink-0')}>
        <div className="flex items-center gap-3 mb-3">
          <div
            className={cn('w-11 h-11 flex items-center justify-center flex-shrink-0', stageColor.bg)}
            style={{
              animation: 'morph-shape 9s ease-in-out infinite, stage-bounce 3.5s ease-in-out infinite',
              boxShadow: `0 6px 16px ${stageColor.pulse}`,
            }}
          >
            <FileText size={22} weight="fill" className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className={cn('text-[10px] font-bold uppercase tracking-widest mb-0.5', stageColor.text)}>산출물</p>
            <p className="text-[13px] font-bold text-[#202124] leading-tight truncate">{activityMeta.label}</p>
          </div>
          {displayArtifact && <StatusBadge status={effectiveStatus} />}
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
              className="ml-1 p-1.5 rounded-full hover:bg-white/60 text-[#5F6368] hover:text-[#1A73E8] transition-colors flex-shrink-0"
            >
              <ArrowsOut size={16} weight="regular" />
            </button>
          )}
        </div>

        {/* 잠금 안내 (팀장 아닌 경우) */}
        {!isHost && displayArtifact && (
          <div className="flex items-center gap-1.5 bg-white/60 rounded-full px-3 py-1.5 w-fit">
            <Lock size={16} weight="fill" className="text-[#5F6368]" />
            <span className="text-[10px] text-[#5F6368] font-medium">팀장이 확정합니다</span>
          </div>
        )}
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

      {/* 내용 */}
      <div className="flex-1 overflow-y-auto px-5 py-5">
        {previousArtifacts.length > 0 && (
          <div className="mb-5 rounded-2xl border border-[#DADCE0] bg-[#F8F9FA] p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <p className="text-[12px] font-bold text-[#202124]">이전 산출물 참고</p>
                <p className="text-[11px] text-[#5F6368] mt-1">
                  이전 활동의 산출물을 열어보며 현재 설계를 이어갈 수 있습니다.
                </p>
              </div>
              <span className="text-[10px] font-semibold text-[#1A73E8] bg-[#E8F0FE] px-2.5 py-1 rounded-full whitespace-nowrap">
                {previousArtifacts.length}개 있음
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <select
                  value={selectedReferenceActivity}
                  onChange={e => setSelectedReferenceActivity(e.target.value)}
                  className="w-full appearance-none rounded-xl border border-[#DADCE0] bg-white px-3 py-2.5 pr-9 text-sm text-[#202124] focus:outline-none focus:ring-2 focus:ring-[#1A73E8]"
                >
                  {previousArtifacts.map((artifact) => (
                    <option key={artifact.code} value={artifact.code}>
                      [{artifact.code}] {artifact.label}
                    </option>
                  ))}
                </select>
                <CaretDown size={16} weight="bold" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#5F6368]" />
              </div>
              <button
                onClick={() => openPreviousArtifactPreview(selectedReferenceActivity)}
                disabled={!selectedReferenceActivity}
                className="shrink-0 rounded-xl bg-[#E8F0FE] hover:bg-[#D2E3FC] disabled:opacity-50 px-4 py-2.5 text-sm font-semibold text-[#1A73E8] transition-colors"
              >
                내용 보기
              </button>
            </div>
          </div>
        )}

        {!displayArtifact || !hasContent ? (
          <>
            <EmptyState activityLabel={activityMeta.label} />
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
            <div className="pb-3 border-b border-[#F1F3F4]">
              <h4 className="font-bold text-[#202124] text-[15px] leading-snug">{displayArtifact.title}</h4>
              <p className="text-[11px] text-[#9AA0A6] mt-1">
                버전 {displayArtifact.currentVersion} · {displayArtifact.artifactType}
              </p>
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
                  {ACTIVITY_META[viewingActivity].requiredSections && (
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
                  />
                </div>
              </div>
            )}

            {effectiveStatus !== 'in_review' && (
              <>
                {ACTIVITY_META[viewingActivity].requiredSections && (
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
