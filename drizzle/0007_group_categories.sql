CREATE TABLE "group_categories" (
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "group_categories_user_id_name_pk" PRIMARY KEY("user_id","name")
);
--> statement-breakpoint
UPDATE "groups" SET "category" = 'Без категории' WHERE "category" = '';
--> statement-breakpoint
INSERT INTO "group_categories" ("user_id", "name")
SELECT DISTINCT "user_id", "category"
FROM "groups"
WHERE "category" <> 'Без категории';
