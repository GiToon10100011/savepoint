-- 라이브러리(데이터 모델 §4.3·§5, 6단계): 사용자가 등록한 게임과 진행 상황, 그리고 본인에게만 보이는 메모.
--
-- 평가·리뷰와는 FK로 묶지 않는다. 그래서 라이브러리에서 지워도 평가·리뷰는 남고, 상태나 엔딩일을 바꿔도 평가가 생기지 않는다.
-- 이 파일은 달력 이벤트(`library_added`·`play_started`·`ending_reached`·`completed_100`)를 만들지 않는다: 이벤트 테이블은 달력 단계
-- (8단계)에 생기며, 그 마이그레이션이 기존 라이브러리를 채우고 트리거를 건다(평가의 `rated`와 같다).
-- 전제: `npm run db:setup-roles`로 app_user 역할이 먼저 있어야 한다.

CREATE TYPE "play_status" AS ENUM ('interested', 'planned', 'playing', 'paused', 'cleared', 'perfected', 'dropped');
--> statement-breakpoint

CREATE TYPE "progress_kind" AS ENUM ('percent', 'text');
--> statement-breakpoint

CREATE TABLE "user_games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	-- NULL = 상태 미지정. 상태를 지정하지 않고 등록할 수 있고, 값이 있으면 7개 중 하나다. 전환 순서는 강제하지 않는다.
	"status" "play_status",
	"platform_id" integer,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_on" date,
	"cleared_on" date,
	"perfected_on" date,
	"last_played_on" date,
	"playtime_minutes" integer,
	"progress_kind" "progress_kind" DEFAULT 'percent' NOT NULL,
	"progress_percent" smallint,
	"progress_text" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_games_user_game_unique" UNIQUE ("user_id", "game_id"),
	CONSTRAINT "user_games_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "profiles" ("id") ON DELETE CASCADE,
	CONSTRAINT "user_games_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games" ("id") ON DELETE CASCADE,
	CONSTRAINT "user_games_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "platforms" ("id") ON DELETE SET NULL,
	-- 값이 NULL이면 CHECK는 통과한다(선택 입력). 날짜는 터무니없는 값(0001년, 9999년)을 막는 범위만 둔다.
	CONSTRAINT "user_games_dates_range" CHECK (
		("started_on" BETWEEN DATE '1970-01-01' AND DATE '2100-12-31')
		AND ("cleared_on" BETWEEN DATE '1970-01-01' AND DATE '2100-12-31')
		AND ("perfected_on" BETWEEN DATE '1970-01-01' AND DATE '2100-12-31')
		AND ("last_played_on" BETWEEN DATE '1970-01-01' AND DATE '2100-12-31')
	),
	CONSTRAINT "user_games_cleared_after_started" CHECK ("cleared_on" IS NULL OR "started_on" IS NULL OR "cleared_on" >= "started_on"),
	CONSTRAINT "user_games_playtime_range" CHECK ("playtime_minutes" BETWEEN 0 AND 1000000),
	CONSTRAINT "user_games_progress_percent_range" CHECK ("progress_percent" BETWEEN 0 AND 100),
	-- 비어 있으면 NULL로 저장한다(빈 문자열은 두지 않는다).
	CONSTRAINT "user_games_progress_text_length" CHECK (char_length("progress_text") BETWEEN 1 AND 100)
);
--> statement-breakpoint

-- 기본 목록(최근 등록 순)의 키셋 `(added_at, id)`, 상태 필터, 최근 플레이·엔딩 달성일 정렬용.
CREATE INDEX "user_games_user_added_idx" ON "user_games" ("user_id", "added_at" DESC, "id" DESC);
--> statement-breakpoint

CREATE INDEX "user_games_user_status_idx" ON "user_games" ("user_id", "status", "updated_at" DESC);
--> statement-breakpoint

CREATE INDEX "user_games_user_played_idx" ON "user_games" ("user_id", "last_played_on" DESC);
--> statement-breakpoint

CREATE INDEX "user_games_user_cleared_idx" ON "user_games" ("user_id", "cleared_on" DESC) WHERE "cleared_on" IS NOT NULL;
--> statement-breakpoint

CREATE TRIGGER "user_games_set_updated_at" BEFORE UPDATE ON "user_games"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- 마지막 플레이일은 시스템이 채운다: 진행도(퍼센트·텍스트)나 플레이 시간이 **값으로** 바뀔 때 오늘로 맞춘다. 값을 지우는 변경은
-- 플레이가 아니므로 건드리지 않고, 사용자가 같은 문장에서 마지막 플레이일을 직접 바꾸면 그 값을 존중한다(수동 수정).
-- 서비스의 기준 시간대는 Asia/Seoul이다: DB 기본(UTC)의 current_date를 쓰면 한국 사용자는 오전 9시 전에 하루 전 날짜가 찍힌다.
-- 호출한 사용자의 권한으로 도는 일반 트리거다(NEW의 컬럼을 채울 뿐이라 별도 권한이 필요 없다).
CREATE FUNCTION user_games_set_last_played() RETURNS trigger
	LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		IF NEW.last_played_on IS NULL AND (NEW.progress_percent IS NOT NULL OR NEW.progress_text IS NOT NULL OR NEW.playtime_minutes IS NOT NULL) THEN
			NEW.last_played_on := (now() AT TIME ZONE 'Asia/Seoul')::date;
		END IF;
	ELSIF NEW.last_played_on IS NOT DISTINCT FROM OLD.last_played_on AND (
		(NEW.progress_percent IS NOT NULL AND NEW.progress_percent IS DISTINCT FROM OLD.progress_percent)
		OR (NEW.progress_text IS NOT NULL AND NEW.progress_text IS DISTINCT FROM OLD.progress_text)
		OR (NEW.playtime_minutes IS NOT NULL AND NEW.playtime_minutes IS DISTINCT FROM OLD.playtime_minutes)
	) THEN
		NEW.last_played_on := (now() AT TIME ZONE 'Asia/Seoul')::date;
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "user_games_last_played" BEFORE INSERT OR UPDATE ON "user_games"
	FOR EACH ROW EXECUTE FUNCTION user_games_set_last_played();
--> statement-breakpoint

-- RLS: 라이브러리는 모두에게 보이고(프로필·팔로워가 본다), 쓰기는 본인 것만이다.
ALTER TABLE "user_games" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY "user_games_select" ON "user_games" FOR SELECT TO app_user USING (true);
--> statement-breakpoint

CREATE POLICY "user_games_insert" ON "user_games" FOR INSERT TO app_user WITH CHECK ("user_id" = app_me());
--> statement-breakpoint

CREATE POLICY "user_games_update" ON "user_games" FOR UPDATE TO app_user
	USING ("user_id" = app_me()) WITH CHECK ("user_id" = app_me());
--> statement-breakpoint

CREATE POLICY "user_games_delete" ON "user_games" FOR DELETE TO app_user USING ("user_id" = app_me());
--> statement-breakpoint

-- 컬럼 권한으로 더 좁힌다: 소유자·게임·등록 시각은 만든 뒤에 바꿀 수 없다. 마지막 플레이일은 INSERT에서는 트리거가 채우고,
-- UPDATE에서는 수동 수정을 허용한다.
GRANT SELECT, DELETE ON "user_games" TO app_user;
--> statement-breakpoint

GRANT INSERT ("user_id", "game_id", "status", "platform_id", "started_on", "cleared_on", "perfected_on", "playtime_minutes", "progress_kind", "progress_percent", "progress_text")
	ON "user_games" TO app_user;
--> statement-breakpoint

GRANT UPDATE ("status", "platform_id", "started_on", "cleared_on", "perfected_on", "last_played_on", "playtime_minutes", "progress_kind", "progress_percent", "progress_text")
	ON "user_games" TO app_user;
--> statement-breakpoint

-- 개인 메모: 소유자에게만 보인다. 행이 없으면 메모가 없는 것이고, 비우면 행을 지운다.
CREATE TABLE "user_game_notes" (
	"user_game_id" uuid PRIMARY KEY NOT NULL,
	"note" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_game_notes_user_game_id_fkey" FOREIGN KEY ("user_game_id") REFERENCES "user_games" ("id") ON DELETE CASCADE,
	CONSTRAINT "user_game_notes_note_length" CHECK (char_length("note") BETWEEN 1 AND 2000)
);
--> statement-breakpoint

CREATE TRIGGER "user_game_notes_set_updated_at" BEFORE UPDATE ON "user_game_notes"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

ALTER TABLE "user_game_notes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 읽기·쓰기 모두 그 라이브러리 항목의 소유자만. user_games의 SELECT 정책이 모두에게 열려 있어 소유자 확인용 서브쿼리가 동작한다.
CREATE POLICY "user_game_notes_owner" ON "user_game_notes" FOR ALL TO app_user
	USING (EXISTS (SELECT 1 FROM "user_games" ug WHERE ug."id" = "user_game_id" AND ug."user_id" = app_me()))
	WITH CHECK (EXISTS (SELECT 1 FROM "user_games" ug WHERE ug."id" = "user_game_id" AND ug."user_id" = app_me()));
--> statement-breakpoint

GRANT SELECT, DELETE ON "user_game_notes" TO app_user;
--> statement-breakpoint

GRANT INSERT ("user_game_id", "note") ON "user_game_notes" TO app_user;
--> statement-breakpoint

GRANT UPDATE ("note") ON "user_game_notes" TO app_user;
