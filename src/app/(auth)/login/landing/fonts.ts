import { Gowun_Batang } from 'next/font/google'

// 저장소의 Noto 패턴과 동일: subsets latin + weight 배열(가변폰트 아님 → weight 필수).
// 한글 글리프는 unicode-range로 자동 포함(Noto와 동일 방식).
export const gowunBatang = Gowun_Batang({
  weight: ['400', '700'],
  subsets: ['latin'],
  variable: '--font-gowun',
  display: 'swap',
})
