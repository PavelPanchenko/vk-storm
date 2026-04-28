ALTER TABLE "posts" ADD COLUMN "user_id" text;
ALTER TABLE "groups" ADD COLUMN "user_id" text;
ALTER TABLE "blacklist" ADD COLUMN "user_id" text;
ALTER TABLE "publish_results" ADD COLUMN "user_id" text;
--> statement-breakpoint
UPDATE "posts"
SET "user_id" = COALESCE((SELECT "user_id" FROM "sessions" ORDER BY "created_at" DESC LIMIT 1), 'legacy');
UPDATE "groups"
SET "user_id" = COALESCE((SELECT "user_id" FROM "sessions" ORDER BY "created_at" DESC LIMIT 1), 'legacy');
UPDATE "blacklist"
SET "user_id" = COALESCE((SELECT "user_id" FROM "sessions" ORDER BY "created_at" DESC LIMIT 1), 'legacy');
UPDATE "publish_results" pr
SET "user_id" = COALESCE(s."user_id", (SELECT "user_id" FROM "sessions" ORDER BY "created_at" DESC LIMIT 1), 'legacy')
FROM "sessions" s
WHERE pr."session_id" = s."id";
UPDATE "publish_results"
SET "user_id" = COALESCE("user_id", (SELECT "user_id" FROM "sessions" ORDER BY "created_at" DESC LIMIT 1), 'legacy');
--> statement-breakpoint
ALTER TABLE "posts" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "groups" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "blacklist" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "publish_results" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "posts" DROP CONSTRAINT IF EXISTS "posts_name_unique";
ALTER TABLE "groups" DROP CONSTRAINT IF EXISTS "groups_url_unique";
ALTER TABLE "blacklist" DROP CONSTRAINT IF EXISTS "blacklist_url_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "posts_user_name_unique" ON "posts" USING btree ("user_id","name");
CREATE UNIQUE INDEX IF NOT EXISTS "groups_user_url_unique" ON "groups" USING btree ("user_id","url");
CREATE UNIQUE INDEX IF NOT EXISTS "blacklist_user_url_unique" ON "blacklist" USING btree ("user_id","url");
