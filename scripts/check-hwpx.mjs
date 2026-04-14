import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import JSZip from 'jszip'

const require = createRequire(import.meta.url)
const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const tempDir = path.join(rootDir, '.tmp_hwpx_check')

const REQUIRED_ENTRIES = [
  'mimetype',
  'META-INF/container.xml',
  'META-INF/container.rdf',
  'META-INF/manifest.xml',
  'Contents/content.hpf',
  'Contents/header.xml',
  'Contents/section0.xml',
  'Contents/BodyText/Section0.xml',
  'Preview/PrvText.txt',
  'settings.xml',
  'version.xml',
]

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

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function main() {
  try {
    rmSync(tempDir, { recursive: true, force: true })
    mkdirSync(tempDir, { recursive: true })

    run('npx', [
      'tsc',
      '--outDir', tempDir,
      '--module', 'commonjs',
      '--target', 'es2020',
      '--lib', 'DOM,ES2020',
      '--esModuleInterop',
      'src/lib/hwpx/generateHwpx.ts',
    ])

    const { generateHwpx } = require(path.join(tempDir, 'generateHwpx.js'))

    const blob = await generateHwpx(`# 제목

본문에 **굵게**, *기울임*, \`코드\`가 있습니다.

> 인용 블록 검증

1. 순서 하나
2. 순서 둘

- 불릿 하나
- 불릿 둘
- [x] 체크 항목

| 구분 | 내용 |
|---|---|
| A | 테스트 |
| B | 줄바꿈<br/>검증 |`, '테스트 보고서')

    const buffer = Buffer.from(await blob.arrayBuffer())
    const zip = await JSZip.loadAsync(buffer)

    for (const entry of REQUIRED_ENTRIES) {
      assert(zip.file(entry), `missing required entry: ${entry}`)
    }

    const mimetype = await zip.file('mimetype').async('string')
    assert(mimetype.trim() === 'application/hwp+zip', 'invalid mimetype')

    const contentHpf = await zip.file('Contents/content.hpf').async('string')
    assert(contentHpf.includes('<opf:package'), 'content.hpf must use opf:package')
    assert(contentHpf.includes('Contents/section0.xml'), 'content.hpf must reference Contents/section0.xml')

    const sectionXml = await zip.file('Contents/section0.xml').async('string')
    assert(sectionXml.includes('<hs:sec'), 'section0.xml must contain hs:sec root')
    assert(sectionXml.includes('<hp:tbl'), 'section0.xml must contain a table for markdown tables')
    assert(sectionXml.includes('제목'), 'section0.xml must contain heading text')
    assert(sectionXml.includes('불릿 하나'), 'section0.xml must contain bullet text')
    assert(sectionXml.includes('체크 항목'), 'section0.xml must contain checkbox text')
    assert(sectionXml.includes('기울임'), 'section0.xml must contain italic text')
    assert(sectionXml.includes('코드'), 'section0.xml must contain inline code text')
    assert(sectionXml.includes('인용 블록 검증'), 'section0.xml must contain blockquote text')
    assert(sectionXml.includes('charPrIDRef="5"') || sectionXml.includes('charPrIDRef="6"'), 'section0.xml should include styled inline runs')
    assert(sectionXml.includes('paraPrIDRef="1"'), 'section0.xml must include heading paragraph style')
    assert(sectionXml.includes('paraPrIDRef="5"'), 'section0.xml must include list paragraph style')
    assert(sectionXml.includes('paraPrIDRef="6"'), 'section0.xml must include blockquote paragraph style')
    assert(sectionXml.includes('borderFillIDRef="3"'), 'section0.xml should use enhanced table border fill')
    assert(sectionXml.includes('borderFillIDRef="4"'), 'section0.xml should use colored header border fill')
    assert(sectionXml.includes('vertAlign="TOP"'), 'section0.xml should top-align table cells')

    const previewText = await zip.file('Preview/PrvText.txt').async('string')
    assert(previewText.includes('제목'), 'preview text must include heading')
    assert(previewText.includes('체크 항목'), 'preview text must include checkbox item')

    const headerXml = await zip.file('Contents/header.xml').async('string')
    assert(headerXml.includes('hh:borderFills itemCnt="4"'), 'header.xml must include enhanced border fill set')
    assert(headerXml.includes('<hc:fillBrush><hc:winBrush faceColor="#DDF3F1" hatchColor="#DDF3F1"/></hc:fillBrush>'), 'header.xml must include pale teal table header fill')

    console.log('HWPX self-check passed')
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error('HWPX self-check failed')
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
