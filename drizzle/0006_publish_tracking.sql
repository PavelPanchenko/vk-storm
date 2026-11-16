ALTER TABLE "logs" ADD COLUMN "user_id" text;
--> statement-breakpoint
CREATE INDEX "logs_user_id_id_idx" ON "logs" ("user_id", "id");
--> statement-breakpoint
CREATE TABLE "publish_batches" (
  "id" text PRIMARY KEY,
  "user_id" text NOT NULL,
  "retry_of" text,
  "heartbeat_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "publish_batches_retry_unique" ON "publish_batches" ("user_id", "retry_of");
--> statement-breakpoint
ALTER TABLE "publish_results" ADD COLUMN "status" text;
--> statement-breakpoint
ALTER TABLE "publish_results" ADD COLUMN "post_url" text;
--> statement-breakpoint
CREATE INDEX "publish_results_user_batch_idx" ON "publish_results" ("user_id", "batch_id");
--> statement-breakpoint
CREATE TABLE "media_uploads" (
  "url" text PRIMARY KEY,
  "user_id" text NOT NULL
);
