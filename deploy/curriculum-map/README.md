# 로그인 없는 교육과정 분석맵

- 공개 주소: https://jammanbo-curriculum-map.web.app
- Firebase 프로젝트: `togethertr`
- Hosting 사이트: `jammanbo-curriculum-map`
- 기존 앱의 Hosting 사이트 `togethertr`와 별도로 배포합니다.

기존 앱과 공개 사이트는 `src/components/curriculum-map/CurriculumMapWorkspace.tsx`를
공유합니다. 공개 사이트에서는 대시보드 이동 버튼을 지도 아이콘으로 표시합니다.
과목·학년군 필터, 검색, 노드, 관계 분석은 기존 구현을 그대로 사용합니다.
기존 앱의 `(app)/layout.tsx` 로그인 검사는 변경하지 않습니다.

## 별도 배포 디렉터리 생성

Node.js 24에서 저장소 루트를 기준으로 실행합니다. 대상은 저장소 밖의 빈 폴더여야 합니다.

```bash
node scripts/prepare-public-curriculum-map.mjs /tmp/tcid-public-curriculum-map
cd /tmp/tcid-public-curriculum-map
npm ci
```

준비 스크립트는 공유 화면과 두 API의 실제 의존 파일만 수집합니다. 로그인·대시보드·팀
프로젝트·채팅 API·Firestore 접근 코드는 포함하지 않습니다. 교육과정 그래프, 임베딩,
학년군별 교육과정 내용체계 데이터는 별도로 복사합니다. 다른 화면이나 서버 기능을
공개 사이트에 추가하려면 준비 스크립트의 허용 범위를 명시적으로 변경해야 합니다.

생성된 폴더의 `.env.local`에 서버 설정 `OPENAI_API_KEY`, `TYPESAFE_API_KEY`를
안전하게 설정합니다. 기존 설정을 유지하려면 `OPENAI_UTILITY_MODEL`,
`CURRICULUM_EXPANSION_MODEL`, `CURRICULUM_EMBEDDINGS`, `JEV_JUDGE`,
`CURRICULUM_JUDGE`도 필요에 따라 설정합니다. 준비 스크립트는 비밀키를 복사하거나
출력하지 않으며, 비밀키는 Git/백업 ZIP/브라우저 코드에 넣지 않습니다.

## 검증 및 배포

원본 저장소에서:

```bash
node --experimental-strip-types --import ./scripts/lib/register-ts-hooks.mjs --test \
  scripts/curriculumMap.test.mjs scripts/curriculumMapUi.test.mjs scripts/publicCurriculumMap.test.mjs
```

생성된 배포 폴더에서:

```bash
npm run build
npx firebase-tools@15.30.2 deploy --only hosting --project togethertr \
  --account jammanbogem@gmail.com --non-interactive
```

Firebase Web Frameworks 통합을 사용하는 별도 Next.js 앱입니다. 루트(`/`)가 바로
분석맵이며 `/curriculum-map`은 루트로 이동합니다. `/dashboard`, `/login`,
`/projects/*`, `/api/chat`은 공개 사이트에 존재하지 않습니다.

배포 후 비로그인 브라우저에서 지도 표시, 주제 검색, 검색 결과 선택 후 연결 분석,
교과·학년군 필터, 모바일 화면을 확인합니다. 두 API는 공개 사이트의 같은 출처에서
실행되며, AI 비밀키는 서버에서만 사용합니다.

## 업데이트·복구

원본 맵 수정 후 준비 스크립트를 다시 실행하고 새 사이트에 배포하면 두 버전의
화면 코드가 어긋나는 것을 방지할 수 있습니다. 기존 앱 배포와 공개 사이트 배포는
독립적입니다. 특정 버전으로 복구하려면 해당 Git 커밋을 별도 체크아웃한 후 같은
절차로 다시 배포하거나 Firebase Hosting의 해당 사이트 이전 릴리스로 복원합니다.
최초 공개 배포 전 버전에는 이 사이트 자체가 없으므로, 최초 배포를 철회하려면 새
Hosting 사이트만 비활성화합니다. 기존 사이트를 되돌릴 필요는 없습니다.
