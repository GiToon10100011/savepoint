import type { Metadata } from "next";
import { Suspense } from "react";
import { ManualGameForm } from "@/features/games/components/manual-game-form";
import { appPool } from "@/server/db/client";
import { requireViewer } from "@/server/viewer";

export const metadata: Metadata = { title: "게임 직접 등록" };

export default function NewGamePage() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8 lg:px-8">
      <h1 className="type-h1">게임 직접 등록</h1>
      <p className="type-body-sm mt-2 text-muted">
        검색에 없는 게임을 등록해요. 제목만 있어도 돼요. 등록한 게임은 내가 고칠 수 있고, 다른 사람은 볼 수만 있어요.
        커버 이미지는 아직 지원하지 않아요.
      </p>
      {/* 세션과 분류 목록은 요청 시점 데이터라 Suspense 경계 안에서 읽는다(Cache Components). */}
      <Suspense fallback={null}>
        <NewGameContent />
      </Suspense>
    </main>
  );
}

async function NewGameContent() {
  // proxy가 한 번 걸러 주지만 낙관적 검사일 뿐이라 화면에서도 확인한다(로그인하면 이 화면으로 돌아온다).
  await requireViewer("/games/new");
  const pool = appPool();
  const [genres, tags, platforms] = await Promise.all([
    pool.query<{ slug: string; name: string }>("select slug, name from genres order by id"),
    pool.query<{ slug: string; name: string }>("select slug, name from tags order by name"),
    pool.query<{ slug: string; name: string }>("select slug, name from platforms order by name"),
  ]);
  return (
    <div className="mt-8">
      <ManualGameForm genres={genres.rows} tags={tags.rows} platforms={platforms.rows} />
    </div>
  );
}
