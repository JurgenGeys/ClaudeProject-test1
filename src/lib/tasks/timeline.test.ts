import { describe, expect, it } from "vitest";

import type { TaskDetail } from "./detail";
import { buildTimeline } from "./timeline";

const base: TaskDetail = {
  id: "t1",
  number: 1043,
  status: "assigned",
  version: "2026-11-25T18:44:00.123456Z",
  workType: "inspection",
  instructions: "Nazicht",
  scheduledDate: "2026-11-23",
  startTime: "13:30:00",
  estimatedMinutes: 60,
  locationStreet: "Lierseweg 87",
  locationPostalCode: "2200",
  locationCity: "Herentals",
  customer: {
    id: "c1",
    name: "Fam. Van Dyck",
    street: null,
    postalCode: null,
    city: null,
    phone: null,
    notes: null,
  },
  assignee: { id: "u1", fullName: "Kevin Wouters" },
  createdAt: new Date("2026-11-13T08:12:00Z"),
  createdByName: "Sofie Peeters",
  pickedUpAt: null,
  invoicedAt: null,
  invoicedByName: null,
  cancelledAt: null,
  cancelledByName: null,
  cancellationReason: null,
  completion: null,
};

const completion = {
  workedMinutes: 120,
  notes: null,
  completedAt: new Date("2026-11-20T16:31:00Z"),
  completedByName: "Jens Maes",
  correctedMinutes: null,
  correctionReason: null,
  correctedAt: null,
  correctedByName: null,
};

// "Now" is fixed: dates in this year have no year, other years keep it.
const NOW = new Date("2026-11-25T12:00:00Z");
const titles = (task: TaskDetail) => buildTimeline(task, NOW).map((item) => item.title);

describe("buildTimeline", () => {
  it("Open: created, and what did not happen yet", () => {
    const items = buildTimeline({ ...base, status: "open", assignee: null }, NOW);
    expect(items.map((item) => item.title)).toEqual(["Aangemaakt", "Nog niet opgepikt"]);
    expect(items[0].detail).toBe("vr 13/11 om 09:12 door Sofie Peeters");
    expect(items[1].pending).toBe(true);
  });

  it("Toegewezen: names the technician", () => {
    expect(titles(base)).toEqual([
      "Aangemaakt",
      "Toegewezen aan Kevin Wouters",
      "Nog niet opgepikt",
    ]);
  });

  it("Opgepikt: the moment, and not yet completed", () => {
    const items = buildTimeline(
      {
        ...base,
        status: "picked_up",
        pickedUpAt: new Date("2026-11-23T06:48:00Z"),
      },
      NOW,
    );
    expect(items.map((item) => item.title)).toEqual([
      "Aangemaakt",
      "Toegewezen aan Kevin Wouters",
      "Opgepikt",
      "Nog niet afgemeld",
    ]);
    expect(items[2]).toMatchObject({ detail: "ma 23/11 om 07:48", emphasis: "picked_up" });
  });

  it("Afgewerkt: the hours of the technician, and not yet invoiced", () => {
    const items = buildTimeline(
      {
        ...base,
        status: "completed",
        pickedUpAt: new Date("2026-11-20T14:12:00Z"),
        completion,
      },
      NOW,
    );
    expect(items.map((item) => item.title)).toEqual([
      "Aangemaakt",
      "Toegewezen aan Kevin Wouters",
      "Opgepikt",
      "Afgemeld",
      "Nog niet gefactureerd",
    ]);
    expect(items[3].detail).toBe("vr 20/11 om 17:31 · 2u00");
  });

  it("Gefactureerd with a correction: all steps, with who and when", () => {
    const items = buildTimeline(
      {
        ...base,
        status: "invoiced",
        pickedUpAt: new Date("2026-11-20T14:12:00Z"),
        completion: {
          ...completion,
          correctedMinutes: 90,
          correctedAt: new Date("2026-11-23T09:05:00Z"),
          correctedByName: "Sofie Peeters",
        },
        invoicedAt: new Date("2026-11-23T09:20:00Z"),
        invoicedByName: "Sofie Peeters",
      },
      NOW,
    );
    expect(items.map((item) => item.title)).toEqual([
      "Aangemaakt",
      "Toegewezen aan Kevin Wouters",
      "Opgepikt",
      "Afgemeld",
      "Uren gecorrigeerd naar 1u30",
      "Gefactureerd",
    ]);
    expect(items[4].detail).toBe("ma 23/11 om 10:05 door Sofie Peeters");
    expect(items[5]).toMatchObject({
      detail: "ma 23/11 om 10:20 door Sofie Peeters",
      emphasis: "invoiced",
    });
  });

  it("Geannuleerd: ends with the cancellation, without steps that will not happen", () => {
    const items = buildTimeline(
      {
        ...base,
        status: "cancelled",
        cancelledAt: new Date("2026-11-23T10:20:00Z"),
        cancelledByName: "Sofie Peeters",
      },
      NOW,
    );
    expect(items.map((item) => item.title)).toEqual([
      "Aangemaakt",
      "Toegewezen aan Kevin Wouters",
      "Geannuleerd",
    ]);
    expect(items[2]).toMatchObject({
      detail: "ma 23/11 om 11:20 door Sofie Peeters",
      emphasis: "cancelled",
    });
  });

  it("Geannuleerd without a technician has no 'Toegewezen' line", () => {
    expect(
      titles({
        ...base,
        status: "cancelled",
        assignee: null,
        cancelledAt: new Date("2026-11-23T10:20:00Z"),
      }),
    ).toEqual(["Aangemaakt", "Geannuleerd"]);
  });

  it("keeps the year for a date that is not in the current year, and decides in Belgian time", () => {
    const items = buildTimeline(
      { ...base, status: "open", assignee: null, createdAt: new Date("2025-12-31T22:30:00Z") },
      new Date("2026-06-01T10:00:00Z"),
    );
    // 23:30 on 31/12/2025 in Belgium: last year, so with the year.
    expect(items[0].detail).toBe("wo 31/12/2025 om 23:30 door Sofie Peeters");
    const sameYear = buildTimeline(
      { ...base, status: "open", assignee: null, createdAt: new Date("2025-12-31T23:30:00Z") },
      new Date("2026-06-01T10:00:00Z"),
    );
    // 00:30 on 01/01/2026 in Belgium: this year, so without.
    expect(sameYear[0].detail).toBe("do 01/01 om 00:30 door Sofie Peeters");
  });
});
