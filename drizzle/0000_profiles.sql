-- 프로필: Neon Auth 사용자와 1:1인 앱 프로필 (docs/architecture/data-model.md §4.1, §5)
-- 전제: `npm run db:setup-roles`로 app_user 역할이 먼저 있어야 한다(없으면 GRANT가 실패해 바로 드러난다).

CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint

CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" text NOT NULL,
	"handle" citext NOT NULL,
	"nickname" text NOT NULL,
	"bio" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_auth_user_id_unique" UNIQUE("auth_user_id"),
	CONSTRAINT "profiles_handle_unique" UNIQUE("handle"),
	-- citext의 ~ 연산자는 대소문자를 구분하지 않는다. text로 바꿔 소문자만 허용한다.
	CONSTRAINT "profiles_handle_format" CHECK ("handle"::text ~ '^[a-z0-9_]{3,20}$'),
	CONSTRAINT "profiles_nickname_length" CHECK (char_length("nickname") BETWEEN 1 AND 20),
	CONSTRAINT "profiles_bio_length" CHECK ("bio" IS NULL OR char_length("bio") <= 200),
	CONSTRAINT "profiles_avatar_url_https" CHECK ("avatar_url" IS NULL OR ("avatar_url" ~ '^https://' AND char_length("avatar_url") <= 2048))
);
--> statement-breakpoint

-- RLS 정책이 읽는 요청 컨텍스트. 앱이 트랜잭션마다 set_config(..., true)로 넣는다(src/server/db/with-user.ts).
-- search_path를 고정해 호출자가 바꾼 경로로 다른 객체를 가리키지 못하게 한다.
CREATE FUNCTION app_me() RETURNS uuid
	LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp
	AS $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

CREATE FUNCTION app_auth_user_id() RETURNS text
	LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp
	AS $$ select nullif(current_setting('app.auth_user_id', true), '') $$;
--> statement-breakpoint

-- 다른 테이블도 쓰는 updated_at 갱신 트리거 함수(호출자 권한으로 자기 행의 NEW만 바꾼다).
CREATE FUNCTION set_updated_at() RETURNS trigger
	LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp
	AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
--> statement-breakpoint

CREATE TRIGGER "profiles_set_updated_at" BEFORE UPDATE ON "profiles"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 조회는 모두에게 열려 있다(프로필은 공개 정보). 정책이 없는 역할(catalog_writer 등)은 아무 행도 못 본다.
CREATE POLICY "profiles_select" ON "profiles" FOR SELECT TO app_user USING (true);
--> statement-breakpoint

-- 생성은 세션의 Neon Auth 사용자 본인 것만(app.auth_user_id). 첫 로그인에는 app.user_id가 아직 없다.
CREATE POLICY "profiles_insert" ON "profiles" FOR INSERT TO app_user
	WITH CHECK ("auth_user_id" = app_auth_user_id());
--> statement-breakpoint

CREATE POLICY "profiles_update" ON "profiles" FOR UPDATE TO app_user
	USING ("id" = app_me()) WITH CHECK ("id" = app_me());
--> statement-breakpoint

-- 삭제 권한은 주지 않는다. UPDATE는 사용자가 바꿀 수 있는 컬럼만(id·auth_user_id·created_at은 불변).
GRANT SELECT, INSERT ON "profiles" TO app_user;
--> statement-breakpoint

GRANT UPDATE ("handle", "nickname", "bio", "avatar_url") ON "profiles" TO app_user;
