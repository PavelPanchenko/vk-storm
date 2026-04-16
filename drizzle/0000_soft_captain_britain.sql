CREATE TABLE "blacklist" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "blacklist_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"category" text DEFAULT 'Без категории' NOT NULL,
	"photo" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "groups_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"images" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "posts_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "publish_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"post_name" text NOT NULL,
	"group_url" text NOT NULL,
	"success" boolean NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text NOT NULL,
	"user_photo" text DEFAULT '' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
