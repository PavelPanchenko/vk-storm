ALTER TABLE "publish_results" ADD COLUMN "batch_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "publish_results" ADD COLUMN "post_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "publish_results" ADD COLUMN "group_name" text DEFAULT '' NOT NULL;