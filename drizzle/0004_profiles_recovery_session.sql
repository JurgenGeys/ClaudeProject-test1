ALTER TABLE "profiles" ADD COLUMN "recovery_session_id" uuid;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "recovery_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_recovery_session_complete" CHECK (("profiles"."recovery_session_id" is null) = ("profiles"."recovery_verified_at" is null));