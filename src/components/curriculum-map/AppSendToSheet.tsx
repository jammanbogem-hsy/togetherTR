'use client'

// 앱 전용 "시트로 보내기" 대화상자 — 로그인 사용자와 Firestore 프로젝트가 필요하다.
//
// CurriculumMapView 가 이 파일을 직접 import 하지 않는 이유: 공개 사이트
// (deploy/curriculum-map, 로그인 없음)가 같은 화면을 공유하는데, 여기서 Firestore·
// 프로젝트 스토어가 딸려 가면 공개 번들 준비 스크립트가 거부한다
// (scripts/publicCurriculumMap.test.mjs). 앱 라우트가 이 컴포넌트를 prop 으로 꽂는다.

import { useProjectStore } from '@/store/project'
import SendToSheetDialog from './SendToSheetDialog'
import type { SendDialogProps } from './CurriculumMapView'

export default function AppSendToSheet({ open, picks, onClose, onDone }: SendDialogProps): React.ReactElement | null {
  const userProfile = useProjectStore(s => s.userProfile)
  if (!userProfile) return null
  return (
    <SendToSheetDialog
      open={open}
      picks={picks}
      uid={userProfile.uid}
      displayName={userProfile.displayName}
      onClose={onClose}
      onDone={onDone}
    />
  )
}
