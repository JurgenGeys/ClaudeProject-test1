import { customerSchema, type CustomerInput } from "./customer";
import { taskSchema, type TaskInput } from "./task";

/**
 * The form of "Nieuwe taak" (design B2) as the browser sends it: every field is text. The
 * names are the names of the form fields; `fieldErrors` of the action use the same keys, so a
 * message always ends up under the field it belongs to.
 */
export const CREATE_TASK_FIELDS = [
  "customerMode",
  "customerId",
  "newCustomerName",
  "newCustomerPhone",
  "newCustomerEmail",
  "newCustomerNotes",
  "locationStreet",
  "locationPostalCode",
  "locationCity",
  "workType",
  "instructions",
  "scheduledDate",
  "startTime",
  "estimatedMinutes",
  "assigneeId",
] as const;
export type CreateTaskField = (typeof CREATE_TASK_FIELDS)[number];

export type CreateTaskRaw = Record<CreateTaskField, string>;
export type CreateTaskFieldErrors = Partial<Record<CreateTaskField, string>>;

/** The customer of the new task: one that exists, or one that is saved together with the task. */
export type CreateTaskCustomer =
  { kind: "existing"; id: string } | { kind: "new"; data: CustomerInput };

export type CreateTaskData = {
  customer: CreateTaskCustomer;
  location: Pick<TaskInput, "locationStreet" | "locationPostalCode" | "locationCity">;
  workType: TaskInput["workType"];
  instructions: string;
  scheduledDate: string;
  startTime: string;
  estimatedMinutes: number | null;
  /** `null` is "Nog niet toewijzen": the task becomes Open. */
  assigneeId: string | null;
};

export type CreateTaskParse =
  { ok: true; data: CreateTaskData } | { ok: false; fieldErrors: CreateTaskFieldErrors };

/** Reads the known fields of the form as text. Anything else in the request is ignored. */
export function readCreateTaskForm(formData: FormData): CreateTaskRaw {
  const raw = {} as CreateTaskRaw;
  for (const field of CREATE_TASK_FIELDS) {
    const value = formData.get(field);
    raw[field] = typeof value === "string" ? value : "";
  }
  return raw;
}

/** The fields of the "Nieuwe klant" block and the `customerSchema` field each one is checked by. */
const NEW_CUSTOMER_FIELDS: Record<string, CreateTaskField> = {
  name: "newCustomerName",
  phone: "newCustomerPhone",
  email: "newCustomerEmail",
  notes: "newCustomerNotes",
};

const customerFieldsSchema = customerSchema.pick({
  name: true,
  phone: true,
  email: true,
  notes: true,
});
const taskWithoutCustomerSchema = taskSchema.omit({ customerId: true });

type Issue = { path: PropertyKey[]; message: string };

/** One message per field: the first one that was reported. */
function addFirstMessages(
  errors: CreateTaskFieldErrors,
  issues: readonly Issue[],
  toField: (key: string) => CreateTaskField | undefined,
): void {
  for (const issue of issues) {
    const field = toField(String(issue.path[0]));
    if (field && !errors[field]) {
      errors[field] = issue.message;
    }
  }
}

const TASK_FIELD_NAMES: ReadonlySet<string> = new Set(CREATE_TASK_FIELDS);
const taskFieldOf = (key: string) =>
  TASK_FIELD_NAMES.has(key) ? (key as CreateTaskField) : undefined;

/**
 * Validates the form on the server (design chapter 6): the task with `taskSchema`, and for a
 * new customer the name, phone, e-mail and remarks with `customerSchema`. The address of the new
 * customer is the location of the task (design B2, block 1): it is checked once, as the location.
 * Reports every wrong field at once, one message per field.
 */
export function parseCreateTask(raw: CreateTaskRaw): CreateTaskParse {
  const fieldErrors: CreateTaskFieldErrors = {};

  if (raw.customerMode === "new") {
    const task = taskWithoutCustomerSchema.safeParse(raw);
    const customer = customerFieldsSchema.safeParse({
      name: raw.newCustomerName,
      phone: raw.newCustomerPhone,
      email: raw.newCustomerEmail,
      notes: raw.newCustomerNotes,
    });
    if (!task.success) {
      addFirstMessages(fieldErrors, task.error.issues, taskFieldOf);
    }
    if (!customer.success) {
      addFirstMessages(fieldErrors, customer.error.issues, (key) => NEW_CUSTOMER_FIELDS[key]);
    }
    if (!task.success || !customer.success) {
      return { ok: false, fieldErrors };
    }
    const location = locationOf(task.data);
    return {
      ok: true,
      data: {
        ...detailsOf(task.data),
        location,
        customer: {
          kind: "new",
          data: {
            ...customer.data,
            // The address of a new customer is the location of this task.
            street: location.locationStreet,
            postalCode: location.locationPostalCode,
            city: location.locationCity,
          },
        },
      },
    };
  }

  const task = taskSchema.safeParse(raw);
  if (!task.success) {
    addFirstMessages(fieldErrors, task.error.issues, taskFieldOf);
    return { ok: false, fieldErrors };
  }
  return {
    ok: true,
    data: {
      ...detailsOf(task.data),
      location: locationOf(task.data),
      customer: { kind: "existing", id: task.data.customerId },
    },
  };
}

type TaskDetails = Omit<TaskInput, "customerId">;

function locationOf(task: TaskDetails): CreateTaskData["location"] {
  return {
    locationStreet: task.locationStreet,
    locationPostalCode: task.locationPostalCode,
    locationCity: task.locationCity,
  };
}

function detailsOf(task: TaskDetails) {
  return {
    workType: task.workType,
    instructions: task.instructions,
    scheduledDate: task.scheduledDate,
    startTime: task.startTime,
    estimatedMinutes: task.estimatedMinutes,
    assigneeId: task.assigneeId,
  };
}
