import { z } from "zod";

import { MAX_ESTIMATED_MINUTES, TEXT_LIMITS } from "@/lib/tasks/limits";
import { workTypes } from "@/lib/tasks/types";

import {
  BELGIAN_POSTAL_CODE,
  isoDate,
  optionalField,
  quarterMinutes,
  quarterTime,
  requiredText,
} from "./fields";
import { TASK_MESSAGES } from "./messages";

/**
 * Input of the task form (design B2), for `createTask` and `updateTask`. The status is not
 * part of it: it follows from the technician (chosen: Toegewezen, "Nog niet toewijzen": Open).
 *
 * The customer is an existing customer. The inline "Nieuwe klant" of B2 is validated with
 * `customerSchema` next to this schema by the Server Action of BT-08.
 */
export const taskSchema = z.object({
  customerId: z.uuid({ error: TASK_MESSAGES.customerRequired }),
  locationStreet: requiredText(
    TASK_MESSAGES.streetRequired,
    TEXT_LIMITS.street,
    TASK_MESSAGES.tooLong,
  ),
  locationPostalCode: z
    .string({ error: TASK_MESSAGES.postalCodeInvalid })
    .trim()
    .regex(BELGIAN_POSTAL_CODE, { error: TASK_MESSAGES.postalCodeInvalid }),
  locationCity: requiredText(TASK_MESSAGES.cityRequired, TEXT_LIMITS.city, TASK_MESSAGES.tooLong),
  workType: z.enum(workTypes, { error: TASK_MESSAGES.workTypeRequired }),
  instructions: requiredText(
    TASK_MESSAGES.instructionsRequired,
    TEXT_LIMITS.longText,
    TASK_MESSAGES.tooLong,
  ),
  scheduledDate: isoDate(TASK_MESSAGES.dateRequired),
  startTime: quarterTime(TASK_MESSAGES.startTimeRequired),
  /**
   * Optional, per quarter of an hour. The maximum is `MAX_ESTIMATED_MINUTES`, a technical
   * safety limit until Jurgen decides (see `src/lib/tasks/limits.ts`).
   */
  estimatedMinutes: optionalField(
    quarterMinutes(MAX_ESTIMATED_MINUTES, {
      required: TASK_MESSAGES.estimatedMinutesInvalid,
      notQuarter: TASK_MESSAGES.estimatedMinutesInvalid,
      tooMany: TASK_MESSAGES.estimatedMinutesTooLong,
    }),
  ),
  /** `null`, missing or `""` is "Nog niet toewijzen". */
  assigneeId: optionalField(z.uuid({ error: TASK_MESSAGES.assigneeInvalid })),
});

export type TaskInput = z.infer<typeof taskSchema>;
