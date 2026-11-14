-- 게임 평가와 평균 평점 카운터(데이터 모델 §4.3·§5, 5단계).
--
-- 평가는 별점 × 2를 1–10 정수로 저장한다. `games.rating_count/rating_sum`은 트리거가 유지하며 앱 역할은 직접 쓰지 못한다.
-- 평가는 라이브러리·리뷰와 FK로 묶지 않는다(서로 독립). 이 파일은 평가 이벤트(`rated`)를 만들지 않는다:
-- 이벤트 테이블은 달력 단계(8단계)에 생기며, 그 마이그레이션이 기존 평가를 채우고 트리거를 건다.
-- 전제: `npm run db:setup-roles`로 app_user·trigger_owner 역할이 먼저 있어야 한다.

CREATE TABLE "game_ratings" (
	"user_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_ratings_pkey" PRIMARY KEY ("user_id", "game_id"),
	CONSTRAINT "game_ratings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles" ("id") ON DELETE CASCADE,
	CONSTRAINT "game_ratings_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games" ("id") ON DELETE CASCADE,
	CONSTRAINT "game_ratings_rating_range" CHECK ("rating" BETWEEN 1 AND 10)
);
--> statement-breakpoint

-- 한 게임의 평가를 모으는 조회(평균·목록)와 한 사용자의 최근 평가 목록(프로필)용. PK가 (user_id, game_id)라 game_id 단독 인덱스가 따로 필요하다.
CREATE INDEX "game_ratings_game_idx" ON "game_ratings" ("game_id");
--> statement-breakpoint

CREATE INDEX "game_ratings_user_updated_idx" ON "game_ratings" ("user_id", "updated_at" DESC);
--> statement-breakpoint

CREATE TRIGGER "game_ratings_set_updated_at" BEFORE UPDATE ON "game_ratings"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- RLS: 평가는 모두에게 보이고, 쓰기는 본인 것만이다. INSERT는 남의 user_id를 달 수 없고, UPDATE는 남의 행을 못 건드리며 소유자도 못 바꾼다.
ALTER TABLE "game_ratings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "game_ratings_select" ON "game_ratings" FOR SELECT TO app_user USING (true);
--> statement-breakpoint

CREATE POLICY "game_ratings_insert" ON "game_ratings" FOR INSERT TO app_user WITH CHECK ("user_id" = app_me());
--> statement-breakpoint

CREATE POLICY "game_ratings_update" ON "game_ratings" FOR UPDATE TO app_user
	USING ("user_id" = app_me()) WITH CHECK ("user_id" = app_me());
--> statement-breakpoint

CREATE POLICY "game_ratings_delete" ON "game_ratings" FOR DELETE TO app_user USING ("user_id" = app_me());
--> statement-breakpoint

-- 컬럼 권한으로 더 좁힌다: 값(rating)만 바꿀 수 있고 user_id·game_id·시각은 바꿀 수 없다.
GRANT SELECT, DELETE ON "game_ratings" TO app_user;
--> statement-breakpoint

GRANT INSERT ("user_id", "game_id", "rating") ON "game_ratings" TO app_user;
--> statement-breakpoint

GRANT UPDATE ("rating") ON "game_ratings" TO app_user;
--> statement-breakpoint

-- 카운터 트리거. 평가를 넣고·바꾸고·지울 때 같은 문장 안에서 games.rating_count/rating_sum을 맞춘다.
-- 같은 게임에 동시에 평가해도 행 잠금이 직렬화해서 카운터가 틀어지지 않는다. SECURITY DEFINER라 호출한 app_user의 권한이 아니라
-- 함수 소유자(trigger_owner)의 권한으로 돈다. search_path를 고정하고 값은 NEW/OLD에서만 읽는다(문자열을 조립하지 않는다).
-- games_rating_counters CHECK(개수 ≤ 합 ≤ 개수 × 10)가 카운터가 어긋나는 것을 한 번 더 막는다.
CREATE FUNCTION apply_rating_counters() RETURNS trigger
	LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		UPDATE public.games SET rating_count = rating_count + 1, rating_sum = rating_sum + NEW.rating WHERE id = NEW.game_id;
	ELSIF TG_OP = 'DELETE' THEN
		UPDATE public.games SET rating_count = rating_count - 1, rating_sum = rating_sum - OLD.rating WHERE id = OLD.game_id;
	ELSIF NEW.rating <> OLD.rating THEN
		UPDATE public.games SET rating_sum = rating_sum + (NEW.rating - OLD.rating) WHERE id = NEW.game_id;
	END IF;
	RETURN NULL;
END;
$$;
--> statement-breakpoint

-- 함수를 트리거 밖에서 부를 수 없어도(트리거 함수는 직접 호출이 안 된다) 실행 권한은 닫아 둔다.
REVOKE ALL ON FUNCTION apply_rating_counters() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER "game_ratings_apply_counters" AFTER INSERT OR DELETE OR UPDATE OF "rating" ON "game_ratings"
	FOR EACH ROW EXECUTE FUNCTION apply_rating_counters();
--> statement-breakpoint

-- trigger_owner가 할 수 있는 일은 평가 카운터를 읽고 바꾸는 것뿐이다. games는 RLS가 켜져 있어 정책도 필요하다.
GRANT SELECT ("id", "rating_count", "rating_sum") ON "games" TO trigger_owner;
--> statement-breakpoint

GRANT UPDATE ("rating_count", "rating_sum") ON "games" TO trigger_owner;
--> statement-breakpoint

CREATE POLICY "games_select_counters" ON "games" FOR SELECT TO trigger_owner USING (true);
--> statement-breakpoint

CREATE POLICY "games_update_counters" ON "games" FOR UPDATE TO trigger_owner USING (true) WITH CHECK (true);
--> statement-breakpoint

-- 평점 카운터가 바뀌는 것은 게임 정보가 바뀐 것이 아니므로 updated_at을 건드리지 않는다. 메타데이터 컬럼이 SET에 있을 때만 갱신한다.
DROP TRIGGER "games_set_updated_at" ON "games";
--> statement-breakpoint

CREATE TRIGGER "games_set_updated_at"
	BEFORE UPDATE OF "title", "title_ko", "summary", "release_date", "cover_url", "cover_width", "cover_height", "metadata_synced_at" ON "games"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- 함수 소유자를 trigger_owner로 바꾼다. 마이그레이션을 실행하는 역할은 그 역할의 멤버지만 SET 권한이 없고(ALTER OWNER가 거부된다),
-- 새 소유자에게는 스키마 CREATE 권한이 필요하다(둘 다 test 브랜치에서 확인). 필요한 동안만 부여하고 바로 회수해 평소 권한을 넓히지 않는다.
-- SET만 회수하고 상속(INHERIT)은 남긴다: 소유자 검사는 상속된 권한으로도 통과해서, 이후 마이그레이션이 이 함수를
-- CREATE OR REPLACE할 수 있다(8단계에서 평가 이벤트를 더할 때 쓴다). `SET ROLE trigger_owner`는 계속 거부된다(test 브랜치에서 확인).
GRANT trigger_owner TO CURRENT_USER WITH SET TRUE;
--> statement-breakpoint

GRANT CREATE ON SCHEMA public TO trigger_owner;
--> statement-breakpoint

ALTER FUNCTION apply_rating_counters() OWNER TO trigger_owner;
--> statement-breakpoint

REVOKE CREATE ON SCHEMA public FROM trigger_owner;
--> statement-breakpoint

REVOKE SET OPTION FOR trigger_owner FROM CURRENT_USER;
