-- ADR-0003: `tasks.updated_at` is the version of a task (the edit form of BT-10 compares it).
-- The database sets it on every update, whoever writes (Drizzle, raw SQL, a later migration), so
-- a writer cannot forget it. Strictly increasing per row, even if the clock goes back. Adds a
-- function and a trigger; removes and renames nothing.
CREATE FUNCTION "public"."tasks_set_updated_at"() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
	NEW.updated_at := greatest(clock_timestamp(), OLD.updated_at + interval '1 microsecond');
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "tasks_set_updated_at"
BEFORE UPDATE ON "public"."tasks"
FOR EACH ROW EXECUTE FUNCTION "public"."tasks_set_updated_at"();
