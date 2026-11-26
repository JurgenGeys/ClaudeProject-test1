import { sql } from "drizzle-orm";

import { tasks } from "@/db/schema";

/**
 * `tasks.updated_at` as the version of a task, written as `2026-11-25T18:44:00.123456Z` (UTC,
 * microseconds). A page carries it in its forms; the server compares it to see that nobody else
 * changed the task meanwhile. An explicit format: `updated_at::text` would follow the DateStyle
 * and TimeZone of the session, `to_char` does not, and `...Z` is read back exactly.
 */
export const taskVersion = sql<string>`to_char(${tasks.updatedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
