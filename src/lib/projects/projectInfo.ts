import type { GradeGroup, Project, SchoolLevel } from '@/types'
import { buildTeamGradeBandUpdate } from '@/lib/curriculum/teamGradeBandState'
import { resolveTeamGradeBands, normalizeTeamGradeBands, toGradeGroupCode } from '@/lib/curriculum/teamGradeBands'

export const PROJECT_GRADES: Record<SchoolLevel, readonly GradeGroup[]> = {
  초등학교: ['초1-2', '초3-4', '초5-6'], 중학교: ['중1-3'], 고등학교: ['고공통', '고선택'],
}
export const PROJECT_SUBJECTS: Record<SchoolLevel, readonly string[]> = {
  초등학교: ['국어', '수학', '사회', '과학', '영어', '도덕', '음악', '미술', '체육', '실과', '통합교과', '창체'],
  중학교: ['국어', '수학', '사회', '역사', '도덕', '과학', '기술·가정', '영어', '음악', '미술', '체육', '정보'],
  고등학교: ['국어', '수학', '사회', '과학', '영어', '한국사', '윤리', '정보', '음악', '미술', '체육', '진로'],
}
export interface ProjectInfoInput { title: string; gradeGroups: GradeGroup[]; targetSubjects: string[] }

export function projectInfoInput(project: Project): ProjectInfoInput {
  return {
    title: project.title,
    gradeGroups: project.schoolLevel === '초등학교'
      ? resolveTeamGradeBands(project).map(band => toGradeGroupCode(band) as GradeGroup)
      : [project.targetGradeGroup],
    targetSubjects: [...project.targetSubjects],
  }
}

/** Only metadata changes; existing curriculum rows retain their original grade labels. */
export function buildProjectInfoUpdate(project: Project, input: ProjectInfoInput): Partial<Project> {
  const title = input.title.trim()
  if (!title || title.length > 100) throw new Error('프로젝트명은 1~100자로 입력해 주세요.')
  const allowed = PROJECT_GRADES[project.schoolLevel]
  const grades = allowed.filter(grade => input.gradeGroups.includes(grade))
  if (!grades.length || input.gradeGroups.some(grade => !allowed.includes(grade)) || (project.schoolLevel !== '초등학교' && grades.length !== 1)) {
    throw new Error('학년군을 선택해 주세요.')
  }
  const subjects = [...new Set(input.targetSubjects.map(subject => subject.trim()).filter(Boolean))]
  if (subjects.length > 20 || subjects.some(subject => subject.length > 40)) throw new Error('교과명을 확인해 주세요.')
  const patch: Partial<Project> = { title, targetSubjects: subjects }
  if (project.schoolLevel === '초등학교') {
    const bands = normalizeTeamGradeBands(grades)
    if (JSON.stringify(bands) !== JSON.stringify(resolveTeamGradeBands(project))) {
      Object.assign(patch, buildTeamGradeBandUpdate(project, bands))
    }
  } else if (project.targetGradeGroup !== grades[0]) patch.targetGradeGroup = grades[0]
  return patch
}
