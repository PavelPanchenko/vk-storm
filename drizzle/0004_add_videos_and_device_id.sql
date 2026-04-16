ALTER TABLE "posts" ADD COLUMN "videos" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "device_id" text DEFAULT '' NOT NULL;