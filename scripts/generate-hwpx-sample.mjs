import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const tempBuildDir = path.join(rootDir, '.tmp_hwpx_sample', 'build')
const outputDir = path.join(rootDir, '.tmp_hwpx_sample')

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: 'pipe',
  })

  if (result.status !== 0) {
    const detail = result.stderr || result.stdout || `${command} exited with code ${result.status}`
    throw new Error(detail.trim())
  }
}

async function main() {
  rmSync(tempBuildDir, { recursive: true, force: true })
  mkdirSync(tempBuildDir, { recursive: true })
  mkdirSync(outputDir, { recursive: true })

  run('npx', [
    'tsc',
    '--outDir', tempBuildDir,
    '--module', 'commonjs',
    '--target', 'es2020',
    '--lib', 'DOM,ES2020',
    '--esModuleInterop',
    'src/lib/hwpx/generateHwpx.ts',
  ])

  const { generateHwpx } = require(path.join(tempBuildDir, 'generateHwpx.js'))

  const sampleMarkdown = `# T-CID 협력 수업설계 종합 보고서

**핵심 요약**: *실생활 갈등을 법의 언어로 해석하고 재설계하는 수업*을 중심으로 팀 설계를 정리했습니다.

## 팀준비(T) 단계

### T-1-1 팀 공통 비전 설정

> 교실의 갈등을 학생 삶의 언어에서 출발해 헌법과 공동체 규칙의 언어로 연결합니다.

- 팀 비전 합의
- [x] 역할 분담 완료
- 도구 선정 초안 작성

### 산출물

| 구분 | 내용 | 비고 |
|---|---|---|
| 비전 | 학생이 법의 주인이 되는 수업 | 공동체 규칙 재설계 |
| 협업 원칙 | 교과별 전문성 공유<br/>실시간 피드백 반영 | 팀 합의 완료 |

## 분석(A) 단계

### A-2-1 핵심아이디어 및 성취기준 분석

| 교과 | 성취기준 코드 | 핵심아이디어 | 지식·이해 | 과정·기능 | 가치·태도 | 비고 |
|---|---|---|---|---|---|---|
| 사회 | [[6사03-01]] | 인권 보장을 위해 헌법에 기본권을 규정하고, 국가와 시민은 기본권 보장을 위해 노력한다. | 법의 의미와 헌법의 기본권 | 사례 조사하기<br/>사례 분석하기 | 인권 친화적 태도 | 중심 |
| 도덕 | [[6도03-02]] | 사회 정의는 시민의 인간다운 삶을 보장하는 도덕 공동체의 토대가 된다. | 사회 정의 | 공정한 규칙 고안하기<br/>시민의식 기르기 | 정의에 대한 관심 | 의미연결 |
| 국어 | [[6국01-07]] | 화자와 청자는 협력적으로 참여하고 듣기·말하기 과정에서의 문제를 해결하기 위해 적절한 전략을 사용한다. | 의사소통 전략 | 타당한 이유 제시하기<br/>절차와 규칙 지키기 | 협력적 의사소통 | 도구·활용 |

### AI 분석

**강조 포인트**: 사회·도덕·국어의 연결은 단순 어휘 일치가 아니라 *문제 상황 해석, 규칙 형성, 토론 표현*의 흐름으로 묶입니다.

## 설계(Ds) 단계

### Ds-1-3 학습활동 설계

| 차시 | 활동 | 학생 산출물 | 지원 도구 | 관찰 포인트 |
|---|---|---|---|---|
| 1차시 | 교실 갈등 사례 분석 | 갈등 상황 기록지 | Padlet, 활동지 | 갈등 원인 파악 |
| 2차시 | 헌법 관점으로 규칙 재설계 | 모둠 규칙 초안 | Canva, 구글 문서 | 근거 제시의 타당성 |
| 3차시 | 발표와 피드백 | 규칙 제안서, 발표 영상 | 슬라이드, 태블릿 | 협력적 의사소통 |
`

  const blob = await generateHwpx(sampleMarkdown, 'HWPX 품질 확인 샘플')
  const outputPath = path.join(outputDir, 'hwpx-quality-sample.hwpx')
  const buffer = Buffer.from(await blob.arrayBuffer())
  writeFileSync(outputPath, buffer)

  console.log(`Sample HWPX generated: ${outputPath}`)
}

main().catch(error => {
  console.error('Failed to generate sample HWPX')
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
