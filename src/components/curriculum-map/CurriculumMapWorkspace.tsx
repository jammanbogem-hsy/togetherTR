'use client'

// 호환 래퍼 — 공개 사이트 템플릿(deploy/curriculum-map)이 `standalone` 으로 렌더한다.
// 실제 화면은 CurriculumMapView 가 담당한다.

import { CurriculumMapView } from './CurriculumMapView'

export default function CurriculumMapWorkspace({ standalone = false }: { standalone?: boolean }): React.ReactElement {
  return <CurriculumMapView mode="page" standalone={standalone} />
}
