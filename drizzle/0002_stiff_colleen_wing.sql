CREATE TABLE "schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_name" text NOT NULL,
	"group_indexes" json DEFAULT '[]'::json NOT NULL,
	"time" text NOT NULL,
	"repeat_type" text DEFAULT 'once' NOT NULL,
	"next_run_at" timestamp NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
