-- 리뷰와 리뷰 좋아요(데이터 모델 §4.3·§5, 7단계).
--
-- 리뷰는 평가·라이브러리와 FK로 묶지 않는다(서로 독립). (user_id, game_id)로만 만나서 평가를 취소해도, 라이브러리에서 지워도 리뷰는
-- 남고, 리뷰를 지워도 평가는 남는다. 한 사용자가 한 게임에 쓸 수 있는 리뷰는 1개다(수정으로 갱신한다).
-- `game_reviews.like_count`는 트리거가 유지하며 앱 역할은 직접 쓰지 못한다(평가 카운터와 같은 방식).
-- 이 파일은 리뷰 이벤트(`reviewed`)를 만들지 않는다: 이벤트 테이블은 달력 단계(8단계)에 생기며, 그 마이그레이션이 기존 리뷰를
-- 채우고 트리거를 건다(평가의 `rated`, 라이브러리 이벤트와 같다).
-- 전제: `npm run db:setup-roles`로 app_user·trigger_owner 역할이 먼저 있어야 한다.

CREATE TYPE "review_visibility" AS ENUM ('public', 'private');
--> statement-breakpoint

CREATE TABLE "game_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"body" text NOT NULL,
	"has_spoiler" boolean DEFAULT false NOT NULL,
	"visibility" "review_visibility" DEFAULT 'public' NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_reviews_user_game_unique" UNIQUE ("user_id", "game_id"),
	CONSTRAINT "game_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles" ("id") ON DELETE CASCADE,
	CONSTRAINT "game_reviews_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games" ("id") ON DELETE CASCADE,
	CONSTRAINT "game_reviews_body_length" CHECK (char_length("body") BETWEEN 1 AND 5000),
	-- 공백·줄바꿈뿐인 본문은 리뷰가 아니다(서버가 앞뒤 공백을 잘라 거절하지만 DB가 마지막 방어선이다).
	CONSTRAINT "game_reviews_body_not_blank" CHECK (btrim("body", E' \t\r\n') <> ''),
	CONSTRAINT "game_reviews_like_count_nonnegative" CHECK ("like_count" >= 0)
);
--> statement-breakpoint

-- 게임 상세의 공개 리뷰 목록: 좋아요 순(같으면 최신순)과 최신순. 목록 쿼리가 visibility = 'public'을 명시하므로 부분 인덱스가 맞는다.
-- 내 비공개 리뷰는 목록이 아니라 `내 기록`에서 (user_id, game_id) UNIQUE 인덱스로 읽는다.
CREATE INDEX "game_reviews_game_likes_idx" ON "game_reviews" ("game_id", "like_count" DESC, "created_at" DESC, "id" DESC) WHERE "visibility" = 'public';
--> statement-breakpoint

CREATE INDEX "game_reviews_game_recent_idx" ON "game_reviews" ("game_id", "created_at" DESC, "id" DESC) WHERE "visibility" = 'public';
--> statement-breakpoint

-- 한 사용자의 최근 리뷰 목록(프로필, 9단계).
CREATE INDEX "game_reviews_user_created_idx" ON "game_reviews" ("user_id", "created_at" DESC, "id" DESC);
--> statement-breakpoint

-- 수정 시각은 사용자가 내용(본문·스포일러·공개 범위)을 바꿀 때만 갱신한다. 좋아요가 달려 like_count가 바뀌는 것은 수정이 아니다.
CREATE TRIGGER "game_reviews_set_updated_at" BEFORE UPDATE OF "body", "has_spoiler", "visibility" ON "game_reviews"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- RLS: 공개 리뷰는 모두에게, 비공개 리뷰는 작성자에게만 보인다. 쓰기는 본인 것만이다.
ALTER TABLE "game_reviews" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "game_reviews_select" ON "game_reviews" FOR SELECT TO app_user
	USING ("visibility" = 'public' OR "user_id" = app_me());
--> statement-breakpoint

CREATE POLICY "game_reviews_insert" ON "game_reviews" FOR INSERT TO app_user WITH CHECK ("user_id" = app_me());
--> statement-breakpoint

CREATE POLICY "game_reviews_update" ON "game_reviews" FOR UPDATE TO app_user
	USING ("user_id" = app_me()) WITH CHECK ("user_id" = app_me());
--> statement-breakpoint

CREATE POLICY "game_reviews_delete" ON "game_reviews" FOR DELETE TO app_user USING ("user_id" = app_me());
--> statement-breakpoint

-- 컬럼 권한으로 더 좁힌다: 소유자·게임·좋아요 수·시각은 만든 뒤에 바꿀 수 없고(좋아요 수는 트리거만), 내용 세 칸만 고칠 수 있다.
GRANT SELECT, DELETE ON "game_reviews" TO app_user;
--> statement-breakpoint

GRANT INSERT ("user_id", "game_id", "body", "has_spoiler", "visibility") ON "game_reviews" TO app_user;
--> statement-breakpoint

GRANT UPDATE ("body", "has_spoiler", "visibility") ON "game_reviews" TO app_user;
--> statement-breakpoint

-- 리뷰 좋아요: PK(review_id, user_id)가 중복 좋아요를 막는다. 수정할 일이 없어 UPDATE 권한은 주지 않는다.
CREATE TABLE "game_review_likes" (
	"review_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_review_likes_pkey" PRIMARY KEY ("review_id", "user_id"),
	CONSTRAINT "game_review_likes_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "game_reviews" ("id") ON DELETE CASCADE,
	CONSTRAINT "game_review_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles" ("id") ON DELETE CASCADE
);
--> statement-breakpoint

-- 한 사용자가 누른 좋아요(목록에서 `내가 좋아요 누름` 표시, 사용자 삭제 시 정리)용. PK가 review_id 앞이라 user_id 단독 인덱스가 필요하다.
CREATE INDEX "game_review_likes_user_idx" ON "game_review_likes" ("user_id");
--> statement-breakpoint

ALTER TABLE "game_review_likes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 보이는 리뷰의 좋아요만 보인다(내가 누른 좋아요는 항상). 서브쿼리는 game_reviews의 RLS를 그대로 받으므로 비공개 리뷰의 좋아요 행은
-- 작성자 외에는 읽을 수 없다. 공개였다가 비공개로 바뀐 리뷰에도 좋아요 행은 남아 있어 이 조건이 필요하다.
CREATE POLICY "game_review_likes_select" ON "game_review_likes" FOR SELECT TO app_user
	USING ("user_id" = app_me() OR EXISTS (SELECT 1 FROM "game_reviews" r WHERE r."id" = "review_id"));
--> statement-breakpoint

-- 좋아요는 내 것만, 내가 볼 수 있는 남의 리뷰에만 누른다. 자기 리뷰(r.user_id <> me)와 볼 수 없는 리뷰(서브쿼리가 RLS로 비어 있음)는
-- 같은 방식으로 거절돼 비공개 리뷰의 존재 여부도 드러나지 않는다.
CREATE POLICY "game_review_likes_insert" ON "game_review_likes" FOR INSERT TO app_user
	WITH CHECK ("user_id" = app_me() AND EXISTS (SELECT 1 FROM "game_reviews" r WHERE r."id" = "review_id" AND r."user_id" <> app_me()));
--> statement-breakpoint

CREATE POLICY "game_review_likes_delete" ON "game_review_likes" FOR DELETE TO app_user USING ("user_id" = app_me());
--> statement-breakpoint

GRANT SELECT, DELETE ON "game_review_likes" TO app_user;
--> statement-breakpoint

GRANT INSERT ("review_id", "user_id") ON "game_review_likes" TO app_user;
--> statement-breakpoint

-- 카운터 트리거. 좋아요를 누르고 취소할 때 같은 문장 안에서 game_reviews.like_count를 맞춘다. 같은 리뷰에 동시에 눌러도 행 잠금이
-- 직렬화해 카운터가 틀어지지 않는다. SECURITY DEFINER라 호출한 app_user의 권한이 아니라 함수 소유자(trigger_owner)의 권한으로 돈다
-- (남의 리뷰의 like_count를 app_user가 직접 바꿀 수 없기 때문). search_path를 고정하고 값은 NEW/OLD에서만 읽는다.
-- 리뷰가 지워질 때 연쇄로 지워지는 좋아요에서도 돌지만, 그때는 대상 행이 이미 없어 갱신이 0행이라 아무 일도 하지 않는다.
CREATE FUNCTION apply_review_like_counters() RETURNS trigger
	LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		UPDATE public.game_reviews SET like_count = like_count + 1 WHERE id = NEW.review_id;
	ELSE
		UPDATE public.game_reviews SET like_count = like_count - 1 WHERE id = OLD.review_id;
	END IF;
	RETURN NULL;
END;
$$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION apply_review_like_counters() FROM PUBLIC;
--> statement-breakpoint

CREATE TRIGGER "game_review_likes_apply_counters" AFTER INSERT OR DELETE ON "game_review_likes"
	FOR EACH ROW EXECUTE FUNCTION apply_review_like_counters();
--> statement-breakpoint

-- trigger_owner가 할 수 있는 일은 like_count를 읽고 바꾸는 것뿐이다. game_reviews는 RLS가 켜져 있어 정책도 필요하다.
GRANT SELECT ("id", "like_count") ON "game_reviews" TO trigger_owner;
--> statement-breakpoint

GRANT UPDATE ("like_count") ON "game_reviews" TO trigger_owner;
--> statement-breakpoint

CREATE POLICY "game_reviews_select_counters" ON "game_reviews" FOR SELECT TO trigger_owner USING (true);
--> statement-breakpoint

CREATE POLICY "game_reviews_update_counters" ON "game_reviews" FOR UPDATE TO trigger_owner USING (true) WITH CHECK (true);
--> statement-breakpoint

-- 함수 소유자를 trigger_owner로 바꾼다(0003과 같은 방식: 필요한 동안만 SET·CREATE를 주고 바로 회수하며 INHERIT는 남긴다).
GRANT trigger_owner TO CURRENT_USER WITH SET TRUE;
--> statement-breakpoint

GRANT CREATE ON SCHEMA public TO trigger_owner;
--> statement-breakpoint

ALTER FUNCTION apply_review_like_counters() OWNER TO trigger_owner;
--> statement-breakpoint

REVOKE CREATE ON SCHEMA public FROM trigger_owner;
--> statement-breakpoint

REVOKE SET OPTION FOR trigger_owner FROM CURRENT_USER;
