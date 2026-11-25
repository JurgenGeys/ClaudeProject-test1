import { describe, expect, it } from "vitest";

import { MAX_ESTIMATED_MINUTES } from "@/lib/tasks/limits";

import {
  CREATE_TASK_FIELDS,
  parseCreateTask,
  readCreateTaskForm,
  type CreateTaskRaw,
} from "./create-task";

const customerId = "11111111-1111-4111-8111-111111111111";
const technicianId = "22222222-2222-4222-8222-222222222222";

const base: CreateTaskRaw = {
  customerMode: "existing",
  customerId,
  newCustomerName: "",
  newCustomerPhone: "",
  newCustomerEmail: "",
  newCustomerNotes: "",
  locationStreet: "Kerkstraat 12",
  locationPostalCode: "2310",
  locationCity: "Rijkevorsel",
  workType: "maintenance",
  instructions: "Jaarlijks onderhoud\nFilter vervangen",
  scheduledDate: "2026-12-01",
  startTime: "14:00",
  estimatedMinutes: "",
  assigneeId: "",
};

const newCustomer: CreateTaskRaw = {
  ...base,
  customerMode: "new",
  customerId: "",
  newCustomerName: "  Bakkerij De Gouden Korst ",
  newCustomerPhone: "014 41 22 87",
};

describe("readCreateTaskForm", () => {
  it("reads the known fields as text and ignores everything else", () => {
    const form = new FormData();
    form.set("locationStreet", "Kerkstraat 12");
    form.set("status", "completed");
    form.set("createdBy", "someone");
    const raw = readCreateTaskForm(form);
    expect(Object.keys(raw).sort()).toEqual([...CREATE_TASK_FIELDS].sort());
    expect(raw.locationStreet).toBe("Kerkstraat 12");
    expect(raw.workType).toBe("");
    expect(raw).not.toHaveProperty("status");
  });

  it("does not take a file as text", () => {
    const form = new FormData();
    form.set("instructions", new File(["x"], "x.txt"));
    expect(readCreateTaskForm(form).instructions).toBe("");
  });
});

describe("parseCreateTask: existing customer", () => {
  it("accepts the required fields: no duration, no technician", () => {
    expect(parseCreateTask(base)).toEqual({
      ok: true,
      data: {
        customer: { kind: "existing", id: customerId },
        location: {
          locationStreet: "Kerkstraat 12",
          locationPostalCode: "2310",
          locationCity: "Rijkevorsel",
        },
        workType: "maintenance",
        instructions: "Jaarlijks onderhoud\nFilter vervangen",
        scheduledDate: "2026-12-01",
        startTime: "14:00",
        estimatedMinutes: null,
        assigneeId: null,
      },
    });
  });

  it("reads the duration and the technician", () => {
    const result = parseCreateTask({ ...base, estimatedMinutes: "90", assigneeId: technicianId });
    expect(result).toMatchObject({
      ok: true,
      data: { estimatedMinutes: 90, assigneeId: technicianId },
    });
  });

  it("treats a missing or unknown customer mode as an existing customer", () => {
    for (const customerMode of ["", "other"]) {
      expect(parseCreateTask({ ...base, customerMode })).toMatchObject({
        ok: true,
        data: { customer: { kind: "existing" } },
      });
    }
  });

  it("gives the messages of design B2 under the fields they belong to", () => {
    const result = parseCreateTask({
      ...base,
      customerId: "",
      locationStreet: " ",
      locationPostalCode: "23",
      locationCity: "",
      workType: "",
      instructions: "",
      scheduledDate: "",
      startTime: "",
    });
    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        customerId: "Kies een klant of maak een nieuwe klant aan.",
        locationStreet: "Vul de straat en het huisnummer in.",
        locationPostalCode: "Vul een geldige postcode in (4 cijfers).",
        locationCity: "Vul de gemeente in.",
        workType: "Kies het soort werk: nazicht, onderhoud of herstelling.",
        instructions: "Beschrijf wat de technieker moet doen.",
        scheduledDate: "Kies een datum.",
        startTime: "Kies een startuur.",
      },
    });
  });

  it("refuses a start time that is not a quarter and a duration beyond 8u00 or not a quarter", () => {
    expect(parseCreateTask({ ...base, startTime: "14:10" })).toMatchObject({
      ok: false,
      fieldErrors: { startTime: "Kies een startuur." },
    });
    expect(
      parseCreateTask({ ...base, estimatedMinutes: String(MAX_ESTIMATED_MINUTES + 15) }),
    ).toMatchObject({
      ok: false,
      fieldErrors: { estimatedMinutes: "De geschatte duur mag niet meer zijn dan 8u00." },
    });
    expect(parseCreateTask({ ...base, estimatedMinutes: "20" })).toMatchObject({
      ok: false,
      fieldErrors: { estimatedMinutes: "Vul de geschatte duur in per kwartier, bv. 1u30." },
    });
  });

  it("refuses a technician id that is not an id", () => {
    expect(parseCreateTask({ ...base, assigneeId: "kevin" })).toMatchObject({
      ok: false,
      fieldErrors: { assigneeId: "Kies een technieker uit de lijst." },
    });
  });

  it("ignores the fields of a new customer while the mode is existing", () => {
    expect(parseCreateTask({ ...base, newCustomerEmail: "geen-mailadres" })).toMatchObject({
      ok: true,
    });
  });
});

describe("parseCreateTask: new customer", () => {
  it("validates the customer fields with customerSchema and takes the location as the address", () => {
    const result = parseCreateTask(newCustomer);
    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({
        customer: {
          kind: "new",
          data: {
            name: "Bakkerij De Gouden Korst",
            phone: "014 41 22 87",
            email: null,
            notes: null,
            street: "Kerkstraat 12",
            postalCode: "2310",
            city: "Rijkevorsel",
          },
        },
      }),
    });
  });

  it("does not need a customer id", () => {
    expect(parseCreateTask({ ...newCustomer, customerId: "" })).toMatchObject({ ok: true });
  });

  it("asks for the name and checks the e-mail address, next to the task fields", () => {
    expect(
      parseCreateTask({
        ...newCustomer,
        newCustomerName: " ",
        newCustomerEmail: "geen-mailadres",
        locationCity: "",
      }),
    ).toEqual({
      ok: false,
      fieldErrors: {
        locationCity: "Vul de gemeente in.",
        newCustomerName: "Vul de naam van de klant in.",
        newCustomerEmail: "Dit e-mailadres is niet geldig. Controleer het of laat het leeg.",
      },
    });
  });

  it("reports the address once, as the location, and not as a customer error", () => {
    const result = parseCreateTask({ ...newCustomer, locationPostalCode: "" });
    expect(result).toEqual({
      ok: false,
      fieldErrors: { locationPostalCode: "Vul een geldige postcode in (4 cijfers)." },
    });
  });

  it("limits the length of the remarks", () => {
    expect(parseCreateTask({ ...newCustomer, newCustomerNotes: "x".repeat(5001) })).toMatchObject({
      ok: false,
      fieldErrors: { newCustomerNotes: "Deze tekst is te lang. Maak hem korter." },
    });
  });
});

describe("parseCreateTask: line endings", () => {
  it("turns the CRLF of a textarea into \\n in the instructions and the customer remarks", () => {
    const result = parseCreateTask({
      ...newCustomer,
      instructions: "Jaarlijks onderhoud\r\n\r\nFilter vervangen\rDaarna testen",
      newCustomerNotes: "Sleutel bij de buren\r\nBel eerst",
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        instructions: "Jaarlijks onderhoud\n\nFilter vervangen\nDaarna testen",
        customer: { data: { notes: "Sleutel bij de buren\nBel eerst" } },
      },
    });
  });

  it("counts a line break as one character for the maximum length", () => {
    const text = "x\r\n".repeat(2500);
    expect(parseCreateTask({ ...base, instructions: text })).toMatchObject({ ok: true });
  });
});
