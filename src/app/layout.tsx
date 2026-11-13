import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter, Noto_Sans_KR } from "next/font/google";
import { Suspense } from "react";
import { ViewerNavigation } from "@/features/auth/viewer-navigation";
import "./globals.css";

// 가변 폰트라 weight를 따로 지정하지 않는다(스펙의 300·400·600·700을 모두 쓴다).
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

// 한글 글리프 담당. 라틴 글자는 Inter가 맡으므로 미리 로드하지 않는다.
// (Pretendard는 자체 호스팅이 필요해 대신 Noto Sans KR을 쓴다.)
const notoSansKr = Noto_Sans_KR({
  variable: "--font-noto-sans-kr",
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

// 가변 폰트가 아니라서 weight를 지정한다. 날짜·통계 등 데이터 표기에만 쓴다.
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SavePoint",
  description: "게임을 평가하고, 플레이 이력을 기록하고, 취향을 공유하는 게임 아카이빙 서비스",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${inter.variable} ${notoSansKr.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {/* 세션과 현재 경로를 읽는 내비는 요청 시점 데이터라 Suspense 경계 안에 둔다(Cache Components). */}
        <Suspense fallback={null}>
          <ViewerNavigation kind="desktop" />
        </Suspense>
        <div className="flex min-h-dvh flex-col pb-20 lg:pb-0 lg:pl-60">{children}</div>
        <Suspense fallback={null}>
          <ViewerNavigation kind="mobile" />
        </Suspense>
      </body>
    </html>
  );
}
