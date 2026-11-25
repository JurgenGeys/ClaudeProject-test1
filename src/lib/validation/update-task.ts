import { z } from "zod";

import {
  CREATE_TASK_FIELDS,
  parseCreateTask,
  type CreateTaskData,
  type CreateTaskFieldErrors,
  type CreateTaskRaw,
} from "./create-task";
import { parseTaskNumber } from "./task-number";

/**
 * The form of "Taak bewerken" (design B2): the fields of "Nieuwe taak" plus the number of the
 * task and its version (the `updated_at` the form was opened with, see `updateTaskInTransaction`).
 */
export const UPDATE_TASK_FIELDS = [...CREATE_TASK_FIELDS, "taskNumber", "version"] as const;
export type UpdateTaskField = (typeof UPDATE_TASK_FIELDS)[number];
export type UpdateTaskRaw = Record<UpdateTaskField, string>;

export type UpdateTaskData = CreateTaskData & {
  number: number;
  /** `updated_at` as text with full precision and offset, as the page read it. */
  version: string;
};

export type UpdateTaskParse =
  | { ok: true; data: UpdateTaskData }
  /** The number or the version is missing or not valid: the form is not a form this page made. */
  | { ok: false; reason: "stale" }
  | { ok: false; reason: "fields"; fieldErrors: CreateTaskFieldErrors };

/**
 * `2026-11-25 18:44:00.123456+00` (Postgres `timestamptz::text`) or the same with a `T` or `Z`.
 * Checked so that the database cast never fails on it.
 */
const VERSION =
  /^(20\d{2}-\d{2}-\d{2})[ T]([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,6})?(Z|[+-](0\d|1[0-4])(:?[0-5]\d)?)$/;

const versionSchema = z
  .string()
  .regex(VERSION, { abort: true })
  .refine((value) => {
    // The day must exist (no 30 February); the regex already limited the shape.
    const day = new Date(`${value.slice(0, 10)}T12:00:00Z`);
    return !Number.isNaN(day.getTime()) && day.toISOString().startsWith(value.slice(0, 10));
  });

/** Reads the known fields of the form as text. Anything else in the request is ignored. */
export function readUpdateTaskForm(formData: FormData): UpdateTaskRaw {
  const raw = {} as UpdateTaskRaw;
  for (const field of UPDATE_TASK_FIELDS) {
    const value = formData.get(field);
    raw[field] = typeof value === "string" ? value : "";
  }
  return raw;
}

/** Validates the edit form on the server: the task fields like `createTask`, plus number and version. */
export function parseUpdateTask(raw: UpdateTaskRaw): UpdateTaskParse {
  const number = parseTaskNumber(raw.taskNumber);
  const version = versionSchema.safeParse(raw.version);
  if (number === null || !version.success) {
    return { ok: false, reason: "stale" };
  }
  const task = parseCreateTask(raw as CreateTaskRaw);
  if (!task.ok) {
    return { ok: false, reason: "fields", fieldErrors: task.fieldErrors };
  }
  return { ok: true, data: { ...task.data, number, version: version.data } };
}
