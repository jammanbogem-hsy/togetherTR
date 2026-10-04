import type { Metadata } from "next";
import { Noto_Sans_KR } from "next/font/google";
import "./globals.css";
import { UpdateAvailableBanner } from "@/components/layout/UpdateAvailableBanner";

const notoSansKR = Noto_Sans_KR({
  variable: "--font-noto",
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
});

export const metadata: Metadata = {
  title: "T-CID2.0 협력적 수업설계",
  description: "T-CID 모델 기반 협력 수업설계 AI 퍼실리테이터",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${notoSansKR.variable} h-full`}>
      <head>
        {/*
          Material Symbols Rounded — MD3 공식 아이콘 에셋.
          이 폰트가 없으면 리거처가 해석되지 않아 아이콘 자리에 'menu_book' 같은
          **글자가 그대로 노출**된다(로그인 랜딩에서 실제로 그렇게 보이던 문제).
          icon_names로 실제 쓰는 아이콘만 서브셋해 폰트 용량을 최소화한다.
          새 아이콘을 쓸 때는 반드시 이 목록에 이름을 추가할 것.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href={
            'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded' +
            ':opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200' +
            // ⚠️ icon_names는 **알파벳 오름차순**이어야 한다.
            //    정렬이 어긋나면 Google Fonts가 400을 돌려주고 폰트가 통째로 로드되지 않아
            //    모든 아이콘이 'assignment' 같은 리거처 이름 글자로 노출된다.
            //    (아래 sort()가 그 실수를 구조적으로 막는다)
            '&icon_names=' + [
              // 로그인·랜딩
              'add_circle', 'arrow_forward', 'auto_awesome', 'check', 'check_circle',
              'checklist', 'edit_document', 'expand_more', 'forum', 'groups',
              'login', 'menu_book', 'sync', 'task_alt',
              // 보고서 섹션
              'assignment', 'bar_chart', 'description', 'lightbulb', 'search',
              'target', 'warning',
              // 교육과정 분석 시트 (M3 전체 화면)
              'add', 'arrow_back', 'call_split', 'close', 'delete',
              'drag_indicator', 'group', 'help', 'hub', 'link', 'save', 'star',
              // 교육과정 분석맵
              'add_task', 'expand_less', 'fit_screen', 'radio_button_checked',
              'radio_button_unchecked', 'remove', 'right_panel_close', 'right_panel_open',
              'send', 'table_chart', 'dark_mode', 'light_mode',
              // 교육과정 분석맵 과목 아이콘
              'calculate', 'science', 'public', 'volunteer_activism',
              'palette', 'music_note', 'directions_run', 'translate',
              'handyman', 'emoji_nature', 'explore',
            ].sort().join(',') +
            '&display=swap'
          }
        />
      </head>
      <body className="min-h-full flex flex-col antialiased">
        {children}
        {/* 새 버전 배포 감지 — 열린 탭이 옛 코드로 남지 않게 */}
        <UpdateAvailableBanner />
      </body>
    </html>
  );
}
