/**
 * 핵심아이디어 → 영역별 지식이해/과정기능 매핑 데이터 생성
 *
 * 실행: npx tsx scripts/build-core-idea-mapping.ts
 * 출력: data/core-idea-area-mapping.json
 *
 * 대형 레코드(30개+ 지식이해)에서 표원문을 파싱하여
 * 핵심아이디어 → 해당 영역의 지식이해/과정기능만 정확히 매핑.
 */

import fs from 'fs'
import path from 'path'

const DIR = path.join(process.cwd(), 'data/curriculum-content-systems')
const OUT = path.join(process.cwd(), 'data/core-idea-area-mapping.json')

interface AreaEntry {
  subject: string
  entryArea: string
  subArea: string
  categories: string[]
  coreIdeas: string[]
  knowledge: string[]
  functions: string[]
}

function parseBullets(text: string): string[] {
  return text.split('⋅').map(s => s.trim()).filter(s => s.length > 0)
}

function parseRawTextSections(rawText: string, allCI: string[]): Array<{
  name: string; coreIdeas: string[]
}> {
  // (N) 패턴으로 영역 분리
  const parts = rawText.split(/\((\d+)\)\s+/)
  const sections: Array<{ name: string; coreIdeas: string[] }> = []

  for (let i = 1; i < parts.length; i += 2) {
    const text = parts[i + 1] || ''
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    const name = lines[0]

    // 핵심아이디어 추출 — "핵심" + "아이디어" 가 같은 줄이든 다른 줄이든 감지
    let ciStartIdx = -1
    for (let j = 0; j < lines.length; j++) {
      if (lines[j].includes('핵심') && (lines[j].includes('아이디어') || (lines[j + 1] && lines[j + 1].includes('아이디어')))) {
        ciStartIdx = lines[j].includes('아이디어') ? j : j + 1
        break
      }
    }
    if (ciStartIdx < 0) continue

    // 핵심아이디어 뒤의 불릿 라인 수집
    const ciTexts: string[] = []
    for (let j = ciStartIdx + 1; j < lines.length; j++) {
      const l = lines[j]
      if (l.startsWith('⋅') || l.startsWith('·') || l.startsWith('-')) {
        ciTexts.push(l.replace(/^[⋅·\-]\s*/, '').trim())
      } else if (l.includes('범주') || l.includes('구분') || l.includes('학년') || l.includes('지식')) {
        break
      } else if (ciTexts.length > 0) {
        // 이전 핵심아이디어의 연속 (줄바꿈된 긴 문장)
        ciTexts[ciTexts.length - 1] += ' ' + l
      }
    }

    // 원본 allCI 배열에서 정확히 매칭
    const matched = ciTexts.map(ci => {
      const prefix = ci.substring(0, Math.min(20, ci.length))
      return allCI.find(full => full.startsWith(prefix)) ?? ci
    })

    sections.push({ name, coreIdeas: matched })
  }

  return sections
}

function parseTableAreas(tables: Array<{ 행: (string | null)[][] }>): Array<{
  categories: string[]; knowledge: string[]; functions: string[]
}> {
  let areaIdx = -1
  const areas: Array<{ categories: string[]; knowledge: string[]; functions: string[] }> = []
  let inKnowledge = false
  let inFunction = false

  for (const table of tables) {
    for (const row of table['행']) {
      if (row[0] === '핵심 아이디어' || row[0] === '핵심아이디어') {
        areaIdx++
        areas.push({ categories: [], knowledge: [], functions: [] })
        inKnowledge = false
        inFunction = false
        continue
      }

      if (areaIdx < 0) continue
      const area = areas[areaIdx]

      // 상태 전환
      const firstCell = (row[0] ?? '').replace(/\s/g, '')
      if (firstCell.includes('지식') && firstCell.includes('이해')) { inKnowledge = true; inFunction = false }
      if (firstCell.includes('과정') && firstCell.includes('기능')) { inFunction = true; inKnowledge = false }
      if (firstCell.includes('가치') && firstCell.includes('태도')) { inFunction = false; inKnowledge = false }

      if (inKnowledge) {
        const cat = row[1] && row[1] !== '-' ? row[1].trim() : null
        if (cat) area.categories.push(cat)

        // 초등: col 2 = 3-4학년군 (또는 1-2학년군), col 3 = 5-6학년군
        for (let c = 2; c < Math.min(row.length, 4); c++) {
          const cell = row[c]
          if (!cell || cell === '-') continue
          const items = parseBullets(cell)
          const grade = c === 2 ? '3-4학년군' : '5-6학년군'
          area.knowledge.push(...items.map(it => `${grade}: ${it}`))
        }
      }

      if (inFunction) {
        for (let c = 1; c < row.length; c++) {
          const cell = row[c]
          if (!cell || cell === '-') continue
          area.functions.push(...parseBullets(cell))
        }
      }
    }
  }

  return areas
}

// ─── 메인 ───

const result: AreaEntry[] = []
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json') && !f.includes('README'))

for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf-8'))
  const subject: string = data['메타']?.['교과'] ?? ''

  for (const entry of (data['내용체계'] ?? [])) {
    const allCI = (entry['핵심아이디어'] ?? []) as string[]
    const rawText = entry['표원문'] as string | undefined
    const tables = entry['표'] as Array<{ 쪽: number; 행: (string | null)[][] }> | undefined

    if (!rawText || !tables || allCI.length === 0) continue

    // 소형 레코드는 스킵
    const flatKn = (entry['내용요소']?.['지식⋅이해'] ?? []) as string[]
    let gbKnCount = 0
    for (const gb of Object.values(entry['학년군별'] ?? {})) {
      gbKnCount += ((gb as Record<string, string[]>)?.['지식⋅이해'] ?? []).length
    }
    if (flatKn.length + gbKnCount <= 30) continue

    // Step 1: 표원문에서 영역별 핵심아이디어 추출
    const ciSections = parseRawTextSections(rawText, allCI)
    // Step 2: 표에서 영역별 지식이해/과정기능 추출
    const tableAreas = parseTableAreas(tables)

    const count = Math.min(ciSections.length, tableAreas.length)
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        result.push({
          subject,
          entryArea: entry['영역'],
          subArea: ciSections[i].name,
          categories: tableAreas[i].categories,
          coreIdeas: ciSections[i].coreIdeas,
          knowledge: tableAreas[i].knowledge,
          functions: [...new Set(tableAreas[i].functions)],
        })
      }
      console.log(`${subject}/${entry['영역']}: ${count}개 하위 영역`)
    } else if (tableAreas.length > 0) {
      // (N) 패턴 없이 단일 영역 → 전체를 하나로
      const allKn = tableAreas.flatMap(a => a.knowledge)
      const allFn = [...new Set(tableAreas.flatMap(a => a.functions))]
      const allCats = [...new Set(tableAreas.flatMap(a => a.categories))]
      result.push({
        subject,
        entryArea: entry['영역'],
        subArea: entry['영역'],
        categories: allCats,
        coreIdeas: allCI,
        knowledge: allKn,
        functions: allFn,
      })
      console.log(`${subject}/${entry['영역']}: 단일 영역 (CI ${allCI.length})`)
    }
  }
}

fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf-8')
console.log(`\n완료: ${result.length}개 매핑 → ${OUT}`)

// 검증: 핵심아이디어 누락 확인
let totalCI = 0, mappedCI = 0
for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf-8'))
  for (const entry of (data['내용체계'] ?? [])) {
    const allCI = (entry['핵심아이디어'] ?? []) as string[]
    const flatKn = (entry['내용요소']?.['지식⋅이해'] ?? []) as string[]
    let gbKnCount = 0
    for (const gb of Object.values(entry['학년군별'] ?? {})) {
      gbKnCount += ((gb as Record<string, string[]>)?.['지식⋅이해'] ?? []).length
    }
    if (flatKn.length + gbKnCount <= 30) continue
    totalCI += allCI.length
    for (const ci of allCI) {
      if (result.some(r => r.coreIdeas.some(mc => mc === ci || ci.startsWith(mc.substring(0, 15))))) mappedCI++
    }
  }
}
console.log(`핵심아이디어 커버리지: ${mappedCI}/${totalCI} (${(mappedCI/totalCI*100).toFixed(1)}%)`)
