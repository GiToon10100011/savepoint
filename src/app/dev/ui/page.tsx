import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { CalendarLegend } from "@/components/calendar/calendar-event";
import { GameCard } from "@/components/game/game-card";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { TextField } from "@/components/ui/input";
import { CalendarDemo, CheckDemo, ChipDemo, RatingDemo, StatusDemo, TooltipDemo } from "./demos";

export const metadata: Metadata = { title: "UI 확인", robots: { index: false } };

const COLOR_TOKENS = [
  "--color-primary",
  "--color-secondary",
  "--color-tertiary",
  "--surface-base",
  "--surface-inverse",
  "--color-success",
  "--color-warning",
  "--color-error",
  "--color-info",
  "--color-border",
  "--color-border-subtle",
  "--color-border-hover",
  "--color-text-primary",
  "--color-text-secondary",
  "--color-surface-white",
  "--color-surface-disabled",
];

const VARIANTS: ButtonVariant[] = ["primary", "secondary", "ghost", "destructive"];
const SIZES: ButtonSize[] = ["sm", "md", "lg"];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-16">
      <h2 id={id} className="type-h2 mb-6">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** 디자인 시스템 확인용 페이지(개발 전용). 운영 빌드에서는 404다. */
export default function DevUiPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-12 lg:px-8">
      <h1 className="type-h1">디자인 시스템 확인</h1>
      <p className="type-body mt-4 max-w-prose">
        StudioBlank 규칙(모노크롬, 직각, 그림자 없음)을 따르는 컴포넌트를 한 화면에서 확인하는 개발용 페이지입니다.
      </p>

      <Section id="colors" title="색 토큰">
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {COLOR_TOKENS.map((name) => (
            <li key={name}>
              <div className="h-12 border border-line" style={{ backgroundColor: `var(${name})` }} />
              <code className="type-mono mt-1 block break-all">{name}</code>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="typography" title="타이포그래피">
        <div className="grid gap-4">
          <p className="type-hero">Hero 게임 Archive</p>
          <p className="type-h1">H1 평가와 기록</p>
          <p className="type-h2">H2 플레이 히스토리</p>
          <p className="type-h3">H3 엔딩을 본 게임</p>
          <p className="type-body">Body 300 — 한국어와 English가 함께 있어도 같은 서체 체계를 유지합니다.</p>
          <p className="type-body-sm">Body Small 400 — 개발사, 퍼블리셔, 출시일 같은 보조 정보.</p>
          <p className="type-caption">Caption 400 — 12px 보조 문구</p>
          <p className="type-mono">Mono 2026-11-10 · 536 · 4.5 — 날짜와 통계</p>
        </div>
      </Section>

      <Section id="buttons" title="버튼">
        <div className="grid gap-4">
          {VARIANTS.map((variant) => (
            <div key={variant} className="flex flex-wrap items-center gap-4">
              <span className="type-mono w-24">{variant}</span>
              {SIZES.map((size) => (
                <Button key={size} variant={variant} size={size}>
                  {size === "sm" ? "작게" : size === "md" ? "보통" : "크게"}
                </Button>
              ))}
              <Button variant={variant} disabled>
                비활성
              </Button>
            </div>
          ))}
        </div>
      </Section>

      <Section id="inputs" title="입력">
        <div className="grid max-w-md gap-6">
          <TextField id="demo-title" label="게임 제목" placeholder="예: 젤다의 전설" hint="한국어 제목이 있으면 함께 입력합니다." />
          <TextField id="demo-handle" label="핸들" defaultValue="Bad Handle!" error="영문 소문자, 숫자, _만 쓸 수 있어요." />
          <TextField id="demo-disabled" label="비활성" defaultValue="수정할 수 없음" disabled />
        </div>
      </Section>

      <Section id="cards" title="카드와 게임 카드">
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          <li>
            <GameCard
              href="/dev/ui#cards"
              title="유리 정원의 기사"
              year={2024}
              genre="RPG"
              cover={{ src: "/dev/cover-portrait.svg", width: 300, height: 400 }}
              rating={4.5}
            />
          </li>
          <li>
            <GameCard
              href="/dev/ui#cards"
              title="십자 퍼즐"
              year={2021}
              genre="퍼즐"
              cover={{ src: "/dev/cover-square.svg", width: 400, height: 400 }}
              rating={3.5}
            />
          </li>
          <li>
            <GameCard
              href="/dev/ui#cards"
              title="줄무늬 레이서"
              year={2019}
              genre="레이싱"
              cover={{ src: "/dev/cover-wide.svg", width: 460, height: 215 }}
            />
          </li>
          <li>
            <GameCard href="/dev/ui#cards" title="커버 없는 게임" year={2023} genre="어드벤처" />
          </li>
        </ul>
        <Card className="mt-6 max-w-sm">
          <CardBody>
            <p className="text-sm font-semibold">일반 카드</p>
            <p className="mt-1 text-xs text-muted">흰 배경과 1px 테두리, hover하면 테두리가 검정이 됩니다.</p>
          </CardBody>
        </Card>
      </Section>

      <Section id="chips" title="필터 칩">
        <ChipDemo />
      </Section>

      <Section id="controls" title="체크박스와 라디오">
        <CheckDemo />
      </Section>

      <Section id="tooltip" title="툴팁">
        <TooltipDemo />
      </Section>

      <Section id="rating" title="평가">
        <RatingDemo />
      </Section>

      <Section id="status" title="플레이 상태">
        <StatusDemo />
      </Section>

      <Section id="calendar" title="기록 달력">
        <p className="type-body-sm mb-4 max-w-prose">
          이벤트는 모양(글리프)과 이름으로 구분하고, 채도를 낮춘 색은 보조로 더합니다. 색을 구분하지 못해도 같은 정보를 얻을 수 있습니다.
        </p>
        <div className="mb-6">
          <CalendarLegend />
        </div>
        <div className="max-w-xl">
          <CalendarDemo />
        </div>
      </Section>
    </main>
  );
}
