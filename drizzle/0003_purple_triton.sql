ALTER TABLE "wallet_entries" ADD COLUMN "ref" text;--> statement-breakpoint
ALTER TABLE "wallet_entries" ADD CONSTRAINT "wallet_entries_ref_unique" UNIQUE("ref");