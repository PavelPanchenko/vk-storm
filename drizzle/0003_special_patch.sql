DROP TABLE "schedules" CASCADE;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "members_count" integer DEFAULT 0 NOT NULL;