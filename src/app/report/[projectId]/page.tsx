import { getProject } from '@/lib/firebase/projects'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { ReportViewer } from './ReportViewer'

interface Props {
  params: Promise<{ projectId: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { projectId } = await params
  const project = await getProject(projectId)
  if (!project?.cumulativeReport) return { title: 'T-CID 종합 설계 보고서' }
  return {
    title: `${project.title} · T-CID 종합 설계 보고서`,
    description: `T-CID 협력 수업설계 모델 기반 종합 분석 보고서 — ${project.targetGradeGroup}`,
  }
}

export default async function ReportPage({ params }: Props) {
  const { projectId } = await params
  const project = await getProject(projectId)

  if (!project?.cumulativeReport) notFound()

  // 확정된 산출물 수
  const completedCount = Object.values(project.artifacts ?? {}).filter(a => a.status === 'confirmed').length

  // 팀 비전 (T-1-1 산출물에서 첫 번째 값 추출)
  const t11Content = project.artifacts?.['T-1-1']?.content as Record<string, string> | undefined
  const teamVision = t11Content ? Object.values(t11Content).find(v => typeof v === 'string' && v.trim()) : undefined

  // 선정 주제 (A-1-2 산출물에서 첫 번째 값 추출)
  const a12Content = project.artifacts?.['A-1-2']?.content as Record<string, string> | undefined
  const selectedTopic = a12Content ? Object.values(a12Content).find(v => typeof v === 'string' && v.trim()) : undefined

  return (
    <ReportViewer
      title={project.title}
      targetGradeGroup={project.targetGradeGroup}
      targetSubjects={project.targetSubjects}
      content={project.cumulativeReport.content}
      savedAt={project.cumulativeReport.savedAt}
      memberInfo={project.memberInfo}
      completedCount={completedCount}
      teamVision={teamVision}
      selectedTopic={selectedTopic}
    />
  )
}
