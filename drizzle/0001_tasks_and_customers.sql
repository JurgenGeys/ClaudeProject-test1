CREATE TYPE "public"."task_status" AS ENUM('open', 'assigned', 'picked_up', 'completed', 'invoiced', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."work_type" AS ENUM('inspection', 'maintenance', 'repair');--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"street" text,
	"postal_code" text,
	"city" text,
	"phone" text,
	"email" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "task_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"worked_minutes" integer NOT NULL,
	"notes" text,
	"completed_by" uuid NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"corrected_minutes" integer,
	"correction_reason" text,
	"corrected_by" uuid,
	"corrected_at" timestamp with time zone,
	CONSTRAINT "task_completions_task_id_unique" UNIQUE("task_id"),
	CONSTRAINT "task_completions_worked_minutes_valid" CHECK ("task_completions"."worked_minutes" > 0 and "task_completions"."worked_minutes" % 15 = 0),
	CONSTRAINT "task_completions_corrected_minutes_valid" CHECK ("task_completions"."corrected_minutes" is null or ("task_completions"."corrected_minutes" > 0 and "task_completions"."corrected_minutes" % 15 = 0)),
	CONSTRAINT "task_completions_correction_complete" CHECK (num_nonnulls("task_completions"."corrected_minutes", "task_completions"."correction_reason", "task_completions"."corrected_by", "task_completions"."corrected_at") in (0, 4)),
	CONSTRAINT "task_completions_correction_reason_not_blank" CHECK ("task_completions"."correction_reason" is null or char_length(btrim("task_completions"."correction_reason")) > 0),
	CONSTRAINT "task_completions_notes_length" CHECK ("task_completions"."notes" is null or char_length("task_completions"."notes") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "task_completions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "tasks_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1001 CACHE 1),
	"customer_id" uuid NOT NULL,
	"location_street" text NOT NULL,
	"location_postal_code" text NOT NULL,
	"location_city" text NOT NULL,
	"work_type" "work_type" NOT NULL,
	"instructions" text NOT NULL,
	"scheduled_date" date NOT NULL,
	"start_time" time NOT NULL,
	"estimated_minutes" integer,
	"assignee_id" uuid,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"picked_up_at" timestamp with time zone,
	"invoiced_at" timestamp with time zone,
	"invoiced_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	CONSTRAINT "tasks_number_unique" UNIQUE("number"),
	CONSTRAINT "tasks_assignee_matches_status" CHECK (("tasks"."status" = 'open' and "tasks"."assignee_id" is null)
        or ("tasks"."status" in ('assigned', 'picked_up', 'completed', 'invoiced') and "tasks"."assignee_id" is not null)
        or "tasks"."status" = 'cancelled'),
	CONSTRAINT "tasks_picked_up_at_matches_status" CHECK (("tasks"."status" in ('picked_up', 'completed', 'invoiced')) = ("tasks"."picked_up_at" is not null)),
	CONSTRAINT "tasks_invoiced_matches_status" CHECK (("tasks"."status" = 'invoiced') = ("tasks"."invoiced_at" is not null)
        and ("tasks"."status" = 'invoiced') = ("tasks"."invoiced_by" is not null)),
	CONSTRAINT "tasks_cancelled_matches_status" CHECK (("tasks"."status" = 'cancelled') = ("tasks"."cancelled_at" is not null)
        and ("tasks"."status" = 'cancelled') = ("tasks"."cancelled_by" is not null)),
	CONSTRAINT "tasks_cancellation_reason_valid" CHECK ("tasks"."cancellation_reason" is null
        or ("tasks"."status" = 'cancelled' and char_length("tasks"."cancellation_reason") <= 500)),
	CONSTRAINT "tasks_estimated_minutes_valid" CHECK ("tasks"."estimated_minutes" is null or ("tasks"."estimated_minutes" > 0 and "tasks"."estimated_minutes" % 15 = 0))
);
--> statement-breakpoint
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_completions" ADD CONSTRAINT "task_completions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_completions" ADD CONSTRAINT "task_completions_completed_by_profiles_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_completions" ADD CONSTRAINT "task_completions_corrected_by_profiles_id_fk" FOREIGN KEY ("corrected_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_profiles_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_invoiced_by_profiles_id_fk" FOREIGN KEY ("invoiced_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_cancelled_by_profiles_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_updated_by_profiles_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customers_lower_name_idx" ON "customers" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "task_completions_completed_at_idx" ON "task_completions" USING btree ("completed_at");--> statement-breakpoint
CREATE INDEX "tasks_assignee_status_date_idx" ON "tasks" USING btree ("assignee_id","status","scheduled_date");--> statement-breakpoint
CREATE INDEX "tasks_status_date_idx" ON "tasks" USING btree ("status","scheduled_date");--> statement-breakpoint
CREATE INDEX "tasks_scheduled_date_idx" ON "tasks" USING btree ("scheduled_date");--> statement-breakpoint
CREATE INDEX "tasks_customer_idx" ON "tasks" USING btree ("customer_id");