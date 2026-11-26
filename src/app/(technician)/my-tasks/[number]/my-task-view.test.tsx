import { cleanup, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { TaskDetail } from "@/lib/tasks/detail";

import { MyTaskView } from "./my-task-view";

// Monday 23/11/2026, 10:00 in Belgium.
const NOW = new Date("2026-11-23T09:00:00Z");

const base: TaskDetail = {
  id: "t1",
  number: 1042,
  status: "assigned",
  version: "2026-11-25T18:44:00.123456Z",
  workType: "maintenance",
  instructions: "Jaarlijks onderhoud 2 split-units\nFilters reinigen",
  scheduledDate: "2026-11-23",
  startTime: "08:00:00",
  estimatedMinutes: 90,
  locationStreet: "Gasthuisstraat 23",
  locationPostalCode: "2300",
  locationCity: "Turnhout",
  customer: {
    id: "c1",
    name: "Bakkerij De Gouden Korst",
    street: null,
    postalCode: null,
    city: null,
    phone: "014 41 22 87",
    notes: "Ingang via de achterdeur",
  },
  assignee: { id: "k1", fullName: "Kevin Wouters" },
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

const view = (overrides: Partial<TaskDetail> = {}) =>
  render(<MyTaskView task={{ ...base, ...overrides }} now={NOW} />);

const completion = {
  workedMinutes: 60,
  notes: "Buitenunit gereinigd",
  completedAt: new Date("2026-11-19T10:07:00Z"),
  completedByName: "Kevin Wouters",
  correctedMinutes: null,
  correctionReason: null,
  correctedAt: null,
  correctedByName: null,
};

describe("T2 for a task that is Toegewezen", () => {
  it("shows number, status, customer, work type, planned moment, estimate and the blocks", () => {
    view();
    expect(screen.getByText("Toegewezen")).toBeInTheDocument();
    expect(screen.getByText("Taak #1042")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Bakkerij De Gouden Korst" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Onderhoud")).toBeInTheDocument();
    expect(screen.getByText(/^Vandaag, ma 23\/11 om/)).toHaveTextContent(
      "Vandaag, ma 23/11 om 08:00",
    );
    expect(screen.getByText("Geschatte duur: 1u30")).toBeInTheDocument();
    const location = screen.getByRole("region", { name: "Locatie" });
    expect(location).toHaveTextContent("Gasthuisstraat 23");
    expect(location).toHaveTextContent("2300 Turnhout");
    const customer = screen.getByRole("region", { name: "Klant" });
    expect(within(customer).getByRole("link", { name: "014 41 22 87" })).toHaveAttribute(
      "href",
      "tel:014412287",
    );
    expect(customer).toHaveTextContent("Opmerking: Ingang via de achterdeur");
    const instructions = screen.getByRole("region", { name: "Instructies" });
    expect(instructions).toHaveTextContent("Jaarlijks onderhoud 2 split-units");
    expect(instructions).toHaveTextContent("Filters reinigen");
    expect(screen.getByRole("link", { name: "← Mijn taken" })).toHaveAttribute("href", "/my-tasks");
  });

  it("is read only: no Oppikken and no Afmelden", () => {
    view();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/Oppikken|Afmelden/)).not.toBeInTheDocument();
  });

  it("says Morgen for tomorrow and a plain date for another day, with the year in another year", () => {
    const { unmount } = view({ scheduledDate: "2026-11-24" });
    expect(screen.getByText(/^Morgen, di 24\/11 om/)).toBeInTheDocument();
    unmount();
    const second = view({ scheduledDate: "2026-11-25", startTime: "10:00:00" });
    expect(screen.getByText(/^wo 25\/11 om/)).toHaveTextContent("wo 25/11 om 10:00");
    second.unmount();
    view({ scheduledDate: "2027-03-10", startTime: "10:00:00" });
    expect(screen.getByText(/om/, { selector: "p" })).toHaveTextContent("wo 10/03/2027 om 10:00");
  });

  it("leaves out the estimate, the phone and the remark when there are none", () => {
    view({ estimatedMinutes: null, customer: { ...base.customer, phone: null, notes: null } });
    expect(screen.queryByText(/Geschatte duur/)).not.toBeInTheDocument();
    const customer = screen.getByRole("region", { name: "Klant" });
    expect(within(customer).queryByRole("link")).not.toBeInTheDocument();
    expect(customer).not.toHaveTextContent("Opmerking");
  });
});

describe("T2 for a task that is Opgepikt", () => {
  it("shows when it was picked up, in Belgian time, and still no button", () => {
    view({ status: "picked_up", pickedUpAt: new Date("2026-11-23T06:48:00Z") });
    expect(screen.getByRole("status")).toHaveTextContent("Opgepikt om 07:48");
    expect(screen.getAllByText("Opgepikt").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("T2 for a finished task", () => {
  it.each([["completed"], ["invoiced"]] as const)(
    "shows a %s task as Afgewerkt, with his own report and a way back to the Afgewerkt tab",
    (status) => {
      view({
        status,
        scheduledDate: "2026-11-19",
        startTime: "10:00:00",
        pickedUpAt: new Date("2026-11-19T08:41:00Z"),
        completion,
      });
      expect(screen.getByText("Afgewerkt", { selector: "[data-status]" })).toHaveAttribute(
        "data-status",
        "completed",
      );
      expect(screen.queryByText("Gefactureerd")).not.toBeInTheDocument();
      const report = screen.getByRole("region", { name: "Jouw afmelding" });
      expect(report).toHaveTextContent("Gewerkte uren1u00");
      expect(within(report).getByText("Opgepikt").nextElementSibling).toHaveTextContent(
        "do 19/11 om 09:41",
      );
      expect(within(report).getByText("Afgemeld").nextElementSibling).toHaveTextContent(
        "do 19/11 om 11:07",
      );
      expect(report).toHaveTextContent("Buitenunit gereinigd");
      expect(screen.getByRole("link", { name: "← Afgewerkt" })).toHaveAttribute(
        "href",
        "/my-tasks?tab=done",
      );
      expect(screen.queryByRole("region", { name: "Klant" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    },
  );

  it("shows the hours he filled in himself, not the correction of the back office", () => {
    view({
      status: "completed",
      completion: {
        ...completion,
        workedMinutes: 120,
        correctedMinutes: 90,
        correctionReason: "Klant bevestigde",
        correctedAt: new Date("2026-11-20T09:00:00Z"),
        correctedByName: "Sofie Peeters",
      },
    });
    const report = screen.getByRole("region", { name: "Jouw afmelding" });
    expect(report).toHaveTextContent("Gewerkte uren2u00");
    expect(report).not.toHaveTextContent("1u30");
    expect(report).not.toHaveTextContent("Klant bevestigde");
  });

  it("says when there are no notes", () => {
    view({ status: "completed", completion: { ...completion, notes: null } });
    expect(screen.getByText("Geen notities.")).toBeInTheDocument();
  });
});

describe("T2 for a task cancelled by the office", () => {
  it("shows only the message and a way back, nothing about the task", () => {
    view({ status: "cancelled", cancelledAt: new Date("2026-11-22T10:00:00Z") });
    // A plain section with the heading as page title, not an alert that is read out on load.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Deze taak is geannuleerd door kantoor." }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Deze taak is geannuleerd door kantoor." }),
    ).toHaveTextContent("Je hoeft niets meer te doen.");
    expect(screen.getByText("Taak #1042")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Terug naar mijn taken" })).toHaveAttribute(
      "href",
      "/my-tasks",
    );
    expect(screen.queryByText("Bakkerij De Gouden Korst")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Instructies" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Locatie" })).not.toBeInTheDocument();
  });
});

describe("the sentences about calling the office (COMPANY_PHONE)", () => {
  const office = (overrides: Partial<TaskDetail>, officePhone?: string) =>
    render(<MyTaskView task={{ ...base, ...overrides }} now={NOW} officePhone={officePhone} />);

  it("shows 'Bel kantoor op' with a tel: link of at least 44 px on a picked up task", () => {
    office({ status: "picked_up", pickedUpAt: new Date("2026-11-23T06:48:00Z") }, "014 00 00 00");
    const link = screen.getByRole("link", { name: "014 00 00 00" });
    expect(link).toHaveAttribute("href", "tel:014000000");
    expect(link).toHaveClass("min-h-11");
    expect(link.closest("p")).toHaveTextContent(
      "Kan je de taak niet uitvoeren, bv. omdat de klant niet thuis is? Bel kantoor op 014 00 00 00. Kantoor zet de taak dan terug.",
    );
  });

  it("shows it on a finished task too", () => {
    office({ status: "completed", completion }, "+32 14 00 00 00");
    const report = screen.getByRole("region", { name: "Jouw afmelding" });
    expect(report).toHaveTextContent("Klopt er iets niet? Bel kantoor op +32 14 00 00 00.");
    expect(within(report).getByRole("link", { name: "+32 14 00 00 00" })).toHaveAttribute(
      "href",
      "tel:+3214000000",
    );
  });

  it.each([[undefined], [""]])("leaves the sentences out without a number (%j)", (phone) => {
    office({ status: "picked_up", pickedUpAt: new Date("2026-11-23T06:48:00Z") }, phone);
    expect(screen.queryByText(/Bel kantoor/)).not.toBeInTheDocument();
    expect(screen.queryByText(/niet thuis/)).not.toBeInTheDocument();
    cleanup();
    office({ status: "completed", completion }, phone);
    expect(screen.queryByText(/Bel kantoor/)).not.toBeInTheDocument();
    expect(screen.getByText(/Een afgemelde taak kan je niet meer wijzigen\./)).toBeInTheDocument();
  });

  it("does not show it on a task that is only assigned", () => {
    office({}, "014 00 00 00");
    expect(screen.queryByText(/Bel kantoor/)).not.toBeInTheDocument();
  });
});
