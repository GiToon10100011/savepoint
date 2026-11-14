import Link from "next/link";
import { LibraryPanel } from "@/features/library/components/library-panel";
import { getLibraryEntry, listPlatforms } from "@/features/library/library";
import { appPool } from "@/server/db/client";
import { getViewer } from "@/server/viewer";
import { getMyRating } from "../ratings";
import { MyRating, type RatingTarget } from "./my-rating";

/**
 * 게임 상세의 `내 기록` 영역. 로그인했으면 내 별점을 읽어 입력을 보여 주고, 아니면 로그인으로 안내한다.
 * 세션은 요청 시점 데이터라 호출하는 쪽이 `<Suspense>`로 감싸야 한다(Cache Components).
 * 이후 단계(라이브러리 상태·날짜·리뷰)가 이 영역에 붙는다.
 */
export async function MyRecord({ target, returnTo }: { target: RatingTarget; returnTo: string }) {
  const viewer = await getViewer();
  const signInHref = `/auth/sign-in?redirectTo=${encodeURIComponent(returnTo)}`;
  // 아직 서비스에 없는 게임(미리보기)에는 평가도 라이브러리 항목도 있을 수 없다.
  const user = viewer ? { authUserId: viewer.user.id, profileId: viewer.profile.id } : null;
  const [initial, entry] =
    user && target.kind === "game"
      ? await Promise.all([getMyRating(appPool(), user, target.gameId), getLibraryEntry(appPool(), user, target.gameId)])
      : [null, null];
  // 플랫폼 선택지는 편집 폼이 있을 때만 읽는다.
  const platforms = entry ? await listPlatforms(appPool()) : [];

  return (
    <section aria-labelledby="my-record" className="mt-6">
      <h2 id="my-record" className="type-h3">
        내 기록
      </h2>
      {viewer ? (
        <div className="mt-2 grid gap-4">
          <MyRating target={target} initial={initial} signInHref={signInHref} />
          <LibraryPanel target={target} entry={entry} platforms={platforms} />
        </div>
      ) : (
        <p className="type-body-sm mt-2">
          <Link href={signInHref} className="inline-block py-2 font-semibold underline underline-offset-4">
            로그인하고 기록하기
          </Link>
        </p>
      )}
    </section>
  );
}
