import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./invoice-actions", () => ({ markInvoiced: vi.fn(), unmarkInvoiced: vi.fn() }));

import type { TaskDetail } from "@/lib/tasks/detail";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// The dialog "Terugzetten" imports the Server Action; it is tested in reset-task-dialog.test.tsx.
vi.mock("./actions", () => ({ resetTask: vi.fn() }));
// The dialog "Taak annuleren" imports its Server Action; it is tested in cancel-task-dialog.test.tsx.
vi.mock("./cancel-actions", () => ({ cancelTask: vi.fn() }));

import { TaskDetailView } from "./task-detail";

const task: TaskDetail = {
  id: "t1",
  number: 1043,
  status: "assigned",
  version: "2026-11-25T18:44:00.123456Z",
  workType: "inspection",
  instructions: "Nazicht airco slaapkamer.\nToestel is 4 jaar oud.",
  scheduledDate: "2026-11-23",
  startTime: "13:30:00",
  estimatedMinutes: 60,
  locationStreet: "Lierseweg 87",
  locationPostalCode: "2200",
  locationCity: "Herentals",
  customer: {
    id: "c1",
    name: "Fam. Van Dyck",
    street: "Lierseweg 87",
    postalCode: "2200",
    city: "Herentals",
    phone: "0476 21 43 65",
    notes: "Hond in de tuin",
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
  notes: "4 units gereinigd.\nFilter vervangen.",
  completedAt: new Date("2026-11-20T16:31:00Z"),
  completedByName: "Jens Maes",
  correctedMinutes: null,
  correctionReason: null,
  correctedAt: null,
  correctedByName: null,
};

// "Now" is fixed: a date in this year has no year, a date in another year keeps it.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-25T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("TaskDetailView (B3)", () => {
  it("shows the number, status, customer as title, kind of work, planning and technician", () => {
    render(<TaskDetailView task={task} />);
    expect(screen.getByRole("heading", { level: 1, name: "Fam. Van Dyck" })).toBeInTheDocument();
    expect(screen.getByText("Taak #1043")).toBeInTheDocument();
    expect(screen.getByText("Toegewezen", { selector: "[data-status]" })).toBeInTheDocument();
    const summary = screen.getByRole("heading", { level: 1 }).nextElementSibling;
    expect(summary).toHaveTextContent(
      "Nazicht · ma 23/11 om 13:30 · geschatte duur 1u00 · Kevin Wouters",
    );
    expect(screen.getByRole("link", { name: "← Taken" })).toHaveAttribute("href", "/tasks");
  });

  it("shows instructions with their line breaks, the location, and the customer with a phone link and remark", () => {
    render(<TaskDetailView task={task} />);
    const instructions = screen.getByRole("region", { name: "Instructies" });
    expect(instructions).toHaveTextContent("Nazicht airco slaapkamer.");
    expect(within(instructions).getByText(/Nazicht airco/)).toHaveClass("whitespace-pre-line");
    expect(screen.getByRole("region", { name: "Locatie" })).toHaveTextContent(
      "Lierseweg 872200 Herentals",
    );
    const customer = screen.getByRole("region", { name: "Klant" });
    expect(within(customer).getByRole("link", { name: "0476 21 43 65" })).toHaveAttribute(
      "href",
      "tel:0476214365",
    );
    expect(customer).toHaveTextContent("Opmerking: Hond in de tuin");
  });

  it("shows the timeline", () => {
    render(<TaskDetailView task={task} />);
    const timeline = screen.getByRole("region", { name: "Tijdlijn" });
    const items = within(timeline).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Aangemaaktvr 13/11 om 09:12 door Sofie Peeters",
      "Toegewezen aan Kevin Wouters",
      "Nog niet opgepikt",
    ]);
  });

  it("has no confirmation by default, and 'Taak #1043 bewaard.' after a save", () => {
    const { rerender } = render(<TaskDetailView task={task} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    rerender(<TaskDetailView task={task} saved />);
    expect(screen.getByRole("status")).toHaveTextContent("Taak #1043 bewaard.");
  });

  it.each([
    ["open", true],
    ["assigned", true],
    ["picked_up", true],
    ["completed", false],
    ["invoiced", false],
    ["cancelled", false],
  ] as const)("status %s: the Bewerken link is %s", (status, shown) => {
    render(
      <TaskDetailView
        task={{
          ...task,
          status,
          pickedUpAt: new Date("2026-11-23T06:48:00Z"),
          completion: status === "completed" || status === "invoiced" ? completion : null,
          cancelledAt: status === "cancelled" ? new Date("2026-11-23T10:20:00Z") : null,
        }}
      />,
    );
    const link = screen.queryByRole("link", { name: "Bewerken" });
    if (shown) {
      expect(link).toHaveAttribute("href", "/tasks/1043/edit");
    } else {
      expect(link).not.toBeInTheDocument();
    }
  });

  describe("Terugzetten (BT-14)", () => {
    const pickedUp = {
      ...task,
      status: "picked_up" as const,
      pickedUpAt: new Date("2026-11-23T06:48:00Z"),
    };
    const technicians = [
      { id: "u1", fullName: "Kevin Wouters" },
      { id: "u2", fullName: "Jens Maes" },
    ];

    it("is offered for an Opgepikt task, next to Bewerken, with the current planning as default", () => {
      render(<TaskDetailView task={pickedUp} technicians={technicians} />);
      const button = screen.getByRole("button", { name: "Terugzetten" });
      expect(button).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Bewerken" })).toBeInTheDocument();
      // Bewerken (outline) comes first, then Terugzetten as the main action (the mockup).
      expect(
        screen.getByRole("link", { name: "Bewerken" }).compareDocumentPosition(button) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it.each(["open", "assigned", "completed", "invoiced", "cancelled"] as const)(
      "is not offered for a %s task",
      (status) => {
        render(
          <TaskDetailView
            task={{
              ...task,
              status,
              pickedUpAt: status === "open" || status === "assigned" ? null : pickedUp.pickedUpAt,
              completion: status === "completed" || status === "invoiced" ? completion : null,
              cancelledAt: status === "cancelled" ? new Date("2026-11-23T10:20:00Z") : null,
            }}
            technicians={technicians}
          />,
        );
        expect(screen.queryByRole("button", { name: "Terugzetten" })).not.toBeInTheDocument();
      },
    );

    it("shows the confirmation of the design after a reset, and only when the task is Toegewezen again", () => {
      const { rerender } = render(<TaskDetailView task={task} reset />);
      expect(screen.getByRole("status")).toHaveTextContent(
        "Taak teruggezet. Ze staat opnieuw op Toegewezen bij Kevin Wouters, voor ma 23/11 om 13:30.",
      );
      // Somebody picked it up again meanwhile: the message would be untrue.
      rerender(<TaskDetailView task={pickedUp} reset technicians={technicians} />);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("shows no confirmation without ?reset=1", () => {
      render(<TaskDetailView task={task} />);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  describe("Taak annuleren (BT-14b)", () => {
    const cancelled = {
      ...task,
      status: "cancelled" as const,
      cancelledAt: new Date("2026-11-23T10:20:00Z"),
      cancelledByName: "Sofie Peeters",
    };

    it.each(["open", "assigned"] as const)(
      "is offered for a %s task, before Bewerken (the mockup)",
      (status) => {
        render(
          <TaskDetailView
            task={{ ...task, status, assignee: status === "open" ? null : task.assignee }}
          />,
        );
        const button = screen.getByRole("button", { name: "Taak annuleren" });
        expect(
          button.compareDocumentPosition(screen.getByRole("link", { name: "Bewerken" })) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      },
    );

    it.each(["picked_up", "completed", "invoiced", "cancelled"] as const)(
      "is not offered for a %s task",
      (status) => {
        render(
          <TaskDetailView
            task={{
              ...task,
              status,
              pickedUpAt: new Date("2026-11-23T06:48:00Z"),
              completion: status === "completed" || status === "invoiced" ? completion : null,
              cancelledAt: status === "cancelled" ? cancelled.cancelledAt : null,
            }}
          />,
        );
        expect(screen.queryByRole("button", { name: "Taak annuleren" })).not.toBeInTheDocument();
      },
    );

    it("shows the confirmation of the design after a cancellation, and only when the task is Geannuleerd", () => {
      const { rerender } = render(<TaskDetailView task={cancelled} cancelled />);
      expect(screen.getByRole("status")).toHaveTextContent("Taak #1043 is geannuleerd.");
      // Not cancelled (any more): the message would be untrue.
      rerender(<TaskDetailView task={task} cancelled />);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("shows no confirmation without ?cancelled=1", () => {
      render(<TaskDetailView task={cancelled} />);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("gives a cancelled task no actions at all (read only)", () => {
      render(<TaskDetailView task={cancelled} />);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Bewerken" })).not.toBeInTheDocument();
    });
  });

  it("builds none of the actions of the later build tasks", () => {
    render(<TaskDetailView task={task} />);
    for (const name of [/terugzetten/i, /corrigeren/i, /gefactureerd/i]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("Open: 'Nog niet toegewezen' with a link to choose a technician", () => {
    render(<TaskDetailView task={{ ...task, status: "open", assignee: null }} />);
    const block = screen.getByRole("region", { name: "Technieker" });
    expect(block).toHaveTextContent("Nog niet toegewezen");
    expect(within(block).getByRole("link", { name: "Technieker kiezen" })).toHaveAttribute(
      "href",
      "/tasks/1043/edit",
    );
  });

  it("Afgewerkt: the completion with the hours, the notes and who completed it", () => {
    render(
      <TaskDetailView
        task={{
          ...task,
          status: "completed",
          pickedUpAt: new Date("2026-11-20T14:12:00Z"),
          completion,
        }}
      />,
    );
    const block = screen.getByRole("region", { name: "Afmelding" });
    expect(block).toHaveTextContent("2u00");
    expect(block).toHaveTextContent("gewerkte uren, zonder verplaatsing");
    expect(block).toHaveTextContent("4 units gereinigd.");
    expect(block).toHaveTextContent("Afgemeld door Jens Maes op vr 20/11 om 17:31.");
    expect(block).not.toHaveTextContent("Gecorrigeerd");
  });

  it("a correction: the current hours big, and the original, who, when and why", () => {
    render(
      <TaskDetailView
        task={{
          ...task,
          status: "invoiced",
          pickedUpAt: new Date("2026-11-20T14:12:00Z"),
          invoicedAt: new Date("2026-11-23T09:20:00Z"),
          invoicedByName: "Sofie Peeters",
          completion: {
            ...completion,
            correctedMinutes: 90,
            correctionReason: "Wachttijd niet aanrekenen",
            correctedAt: new Date("2026-11-23T09:05:00Z"),
            correctedByName: "Sofie Peeters",
          },
        }}
      />,
    );
    const block = screen.getByRole("region", { name: "Afmelding" });
    expect(block).toHaveTextContent("1u30");
    expect(block).toHaveTextContent("Gecorrigeerd door Sofie Peeters op ma 23/11 om 10:05.");
    expect(block).toHaveTextContent("Oorspronkelijk door Jens Maes ingevuld: 2u00.");
    expect(block).toHaveTextContent("Reden: Wachttijd niet aanrekenen");
  });

  it("a task without notes says so", () => {
    render(
      <TaskDetailView
        task={{
          ...task,
          status: "completed",
          pickedUpAt: new Date("2026-11-20T14:12:00Z"),
          completion: { ...completion, notes: null },
        }}
      />,
    );
    expect(screen.getByText("Geen notities.")).toBeInTheDocument();
  });

  it("Geannuleerd: the grey bar with who, when and why, a link to a new task, and no actions", () => {
    render(
      <TaskDetailView
        task={{
          ...task,
          status: "cancelled",
          cancelledAt: new Date("2026-11-23T10:20:00Z"),
          cancelledByName: "Sofie Peeters",
          cancellationReason: "Klant heeft zelf afgezegd",
        }}
      />,
    );
    expect(
      screen.getByText("Deze taak is geannuleerd op ma 23/11 om 11:20 door Sofie Peeters."),
    ).toBeInTheDocument();
    expect(screen.getByText("Reden: Klant heeft zelf afgezegd")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Maak een nieuwe taak aan" })).toHaveAttribute(
      "href",
      "/tasks/new",
    );
    expect(screen.getByText("Geannuleerd", { selector: "[data-status]" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Bewerken" })).not.toBeInTheDocument();
    // The rest stays readable.
    expect(screen.getByRole("region", { name: "Instructies" })).toBeInTheDocument();
  });

  it("a cancelled task without a reason shows no 'Reden'", () => {
    render(
      <TaskDetailView
        task={{ ...task, status: "cancelled", cancelledAt: new Date("2026-11-23T10:20:00Z") }}
      />,
    );
    expect(screen.queryByText(/^Reden:/)).not.toBeInTheDocument();
  });

  it("keeps the year on dates in another year: the planning, the timeline and the cancellation bar", () => {
    render(
      <TaskDetailView
        task={{
          ...task,
          status: "cancelled",
          scheduledDate: "2027-03-10",
          createdAt: new Date("2025-11-13T08:12:00Z"),
          cancelledAt: new Date("2026-12-31T23:30:00Z"),
          cancelledByName: "Sofie Peeters",
        }}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).nextElementSibling).toHaveTextContent(
      "Nazicht · wo 10/03/2027 om 13:30",
    );
    expect(screen.getByText(/Aangemaakt/).parentElement).toHaveTextContent(
      "do 13/11/2025 om 09:12 door Sofie Peeters",
    );
    expect(screen.getByText(/^Deze taak is geannuleerd op/)).toHaveTextContent(
      "vr 01/01/2027 om 00:30",
    );
  });

  it("writes the planning of another year exactly as the e2e test expects (2031-03-10 is a Monday)", () => {
    render(
      <TaskDetailView task={{ ...task, scheduledDate: "2031-03-10", startTime: "09:00:00" }} />,
    );
    expect(screen.getByText(/ma 10\/03\/2031 om 09:00/)).toBeInTheDocument();
  });
});

describe("TaskDetailView (B3): invoicing (BT-17)", () => {
  const completed: TaskDetail = {
    ...task,
    status: "completed",
    pickedUpAt: new Date("2026-11-20T14:00:00Z"),
    completion,
  };
  const invoiced: TaskDetail = {
    ...completed,
    status: "invoiced",
    invoicedAt: new Date("2026-11-24T10:00:00Z"),
    invoicedByName: "Sofie Peeters",
  };

  it("offers 'Markeer als gefactureerd' for an Afgewerkt task, and not the unmark button", () => {
    render(<TaskDetailView task={completed} />);
    expect(screen.getByRole("button", { name: "Markeer als gefactureerd" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Markering ongedaan maken" }),
    ).not.toBeInTheDocument();
  });

  it("offers 'Markering ongedaan maken' for a Gefactureerd task, and locks the hours", () => {
    render(<TaskDetailView task={invoiced} />);
    expect(screen.getByRole("button", { name: "Markering ongedaan maken" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Markeer als gefactureerd" }),
    ).not.toBeInTheDocument();
    const block = screen.getByRole("region", { name: "Afmelding" });
    expect(block).toHaveTextContent("gefactureerde uren · vergrendeld");
    expect(block).toHaveTextContent("Maak eerst de markering ongedaan");
  });

  it("does not talk about locked hours for an Afgewerkt task", () => {
    render(<TaskDetailView task={completed} />);
    expect(screen.getByRole("region", { name: "Afmelding" })).not.toHaveTextContent("vergrendeld");
  });

  it.each(["open", "assigned", "picked_up"] as const)(
    "has no invoicing button for %s",
    (status) => {
      render(<TaskDetailView task={{ ...task, status }} />);
      expect(
        screen.queryByRole("button", { name: /gefactureerd|ongedaan/ }),
      ).not.toBeInTheDocument();
    },
  );
});
