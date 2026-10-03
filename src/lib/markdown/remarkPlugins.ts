import type { Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkCjkFriendly from 'remark-cjk-friendly'

// 범위 표기(1~3개)는 보존하고 이중 물결표(~~취소선~~)만 취소선으로 처리한다.
export const REMARK_PLUGINS: NonNullable<Options['remarkPlugins']> = [
  [remarkGfm, { singleTilde: false }],
  // 따옴표·괄호 뒤 한글 조사가 붙어도 굵게 인식한다.
  remarkCjkFriendly,
]
