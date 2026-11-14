import type { Facet } from "../browse";
import type { Page } from "../search";
import { GameGrid, MoreLink } from "./game-grid";

/** 장르·태그 하나에 속한 게임 목록 화면의 본문. 두 화면이 같은 모양이라 함께 쓴다. */
export function FacetList({ kind, facet, page, basePath }: { kind: "장르" | "태그"; facet: Facet; page: Page; basePath: string }) {
  const moreHref = page.nextCursor ? `${basePath}?${new URLSearchParams({ cursor: page.nextCursor })}` : null;
  return (
    <>
      <p className="type-body-sm text-muted">{kind}</p>
      <h1 className="type-h1 mt-1">{facet.name}</h1>
      <p className="type-mono mt-2">게임 {facet.gameCount.toLocaleString("en-US")}개</p>
      {page.items.length > 0 ? (
        <GameGrid items={page.items} label={`${facet.name} 게임 목록`} />
      ) : (
        <p className="type-body mt-6">아직 이 {kind}의 게임이 없어요.</p>
      )}
      <MoreLink href={moreHref} />
    </>
  );
}
