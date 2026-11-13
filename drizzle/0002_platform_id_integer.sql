-- 플랫폼 ID를 integer로 넓힌다(CodeRabbit 지적, dev DB에서 사실로 확인).
--
-- `INSERT ... ON CONFLICT DO NOTHING`은 충돌해도 식별 컬럼의 기본값(nextval)을 먼저 평가하므로 값이 소모된다.
-- 가져오기가 게임마다 플랫폼 INSERT를 시도해 dev에서는 행이 19개뿐인데 시퀀스가 이미 347까지 갔다.
-- smallint 식별 컬럼은 32,767에서 막혀, 그 뒤로는 이미 있는 플랫폼이 붙은 게임까지 가져오기가 실패한다.
-- (코드도 이미 있는 플랫폼은 INSERT하지 않도록 함께 고친다. 여기서는 한도 자체를 없앤다.)
--
-- 식별 컬럼의 타입을 바꾸면 시퀀스 최대값도 함께 넓어진다(32767 → 2147483647, 테스트 브랜치에서 확인).
-- 외래키는 타입이 같아야 하므로 내렸다가 다시 건다. 기본 키·인덱스는 타입 변경과 함께 다시 만들어진다.

ALTER TABLE "game_platforms" DROP CONSTRAINT "game_platforms_platform_id_fkey";
--> statement-breakpoint

ALTER TABLE "platforms" ALTER COLUMN "id" TYPE integer;
--> statement-breakpoint

ALTER TABLE "game_platforms" ALTER COLUMN "platform_id" TYPE integer;
--> statement-breakpoint

ALTER TABLE "game_platforms" ADD CONSTRAINT "game_platforms_platform_id_fkey"
	FOREIGN KEY ("platform_id") REFERENCES "platforms" ("id") ON DELETE CASCADE;
