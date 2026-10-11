CREATE TABLE IF NOT EXISTS "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"owner" text,
	"batch" text,
	"amount" bigint NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"merchant" text,
	"spent_on" date NOT NULL,
	"source" text NOT NULL,
	"sheet_synced" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "expenses_spent_on_idx" ON "expenses" USING btree ("spent_on");