import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import { normalizeChatStructure } from '../src/lib/markdown/chatStructure.ts'

export const treeMessage = `핵심 가치를 다음과 같이 묶어 보았습니다.

🎯 **학생의 실생활 문제 해결**
├── **자료 기반 탐구**
│   └── “데이터를 활용해 문제를 살펴봄”
├── **문제 해결**
│   └── “문제의 원인을 찾고 해결 방법을 탐색함”
└── **실생활 연계**
    └── “학생의 생활과 연결된 문제를 다룸”
이 가치에 보탤 내용이 있으면 적어 주세요.`

test('saved tree becomes nested semantic list with heading and following paragraph kept separate', () => {
  const normalized = normalizeChatStructure(treeMessage)
  assert.doesNotMatch(normalized, /[├└│]/)
  const html = renderToStaticMarkup(React.createElement(ReactMarkdown, null, normalized))
  assert.equal((html.match(/<li>/g) ?? []).length, 6)
  assert.equal((html.match(/<ul>/g) ?? []).length, 4)
  assert.match(html, /<li><strong>자료 기반 탐구<\/strong>\n<ul>/)
  assert.match(html, /<\/ul>\n<p>이 가치에 보탤 내용/)
  for (const line of ['데이터를 활용해 문제를 살펴봄', '문제의 원인을 찾고 해결 방법을 탐색함', '학생의 생활과 연결된 문제를 다룸']) assert.ok(html.includes(line))
  assert.equal(normalizeChatStructure(normalized), normalized)
})
test('fenced diagrams, inline code, tables and indented code are preserved exactly', () => {
  for (const content of ['```text\n├── code\n└── source\n```', '~~~\n├── code\n└── source\n~~~', '`├── one └── two`', '| 표시 | 뜻 |\n| --- | --- |\n| ├── | └── |', '    ├── code\n    └── source', '일반 문장과 **강조**\n- 목록\n  - 하위']) assert.equal(normalizeChatStructure(content), content)
})
test('folded legacy tree is separated without swallowing its root', () => {
  const content = '🎯 주제 ├── 자료 │   └── 데이터 ├── 문제 └── 실생활'
  const normalized = normalizeChatStructure(content)
  assert.match(normalized, /^🎯 주제\n\n- 자료\n  - 데이터\n- 문제\n- 실생활$/)
})
test('streaming partial and uneven-depth trees keep text and converge to final structure', () => {
  const content = '비전\n├── 가치\n│\n│   ├── 세부\n│   │   └── 설명\n└── 다음\n\n마무리'
  for (const end of [10, 20, content.length]) assert.equal(typeof normalizeChatStructure(content.slice(0,end)), 'string')
  assert.equal(normalizeChatStructure(content), '비전\n\n- 가치\n  - 세부\n    - 설명\n- 다음\n\n마무리')
})
