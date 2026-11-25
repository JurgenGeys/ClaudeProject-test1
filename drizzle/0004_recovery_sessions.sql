CREATE TABLE "recovery_sessions" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"verified_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recovery_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recovery_sessions" ADD CONSTRAINT "recovery_sessions_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recovery_sessions_user_id_idx" ON "recovery_sessions" USING btree ("user_id");