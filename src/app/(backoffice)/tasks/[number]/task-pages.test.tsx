import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { checkRoleAccess, getTaskDetail, listAssignableTechnicians, notFound } = vi.hoisted(() => ({
  checkRoleAccess: vi.fn(),
  getTaskDetail: vi.fn(),
  listAssignableTechnicians: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/lib/auth/role-access", () => ({ checkRoleAccess }));
vi.mock("@/lib/tasks/detail", () => ({ getTaskDetail }));
vi.mock("@/lib/technicians/queries", () => ({ listAssignableTechnicians }));
vi.mock("next/navigation", () => ({ notFound, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../invoice-actions", () => ({ markInvoiced: vi.fn(), unmarkInvoiced: vi.fn() }));
vi.mock("../cancel-actions", () => ({ cancelTask: vi.fn() }));
vi.mock("../actions", () => ({ createTask: vi.fn(), updateTask: vi.fn(), resetTask: vi.fn() }));
vi.mock("../../customers/actions", () => ({ searchCustomers: vi.fn() }));

import type { TaskDetail } from "@/lib/tasks/detail";

import EditTaskPage from "./edit/page";
import TaskNotFound from "./not-found";
import TaskDetailPage from "./page";

const sofie = { id: "s1", email: "s@x.be", fullName: "Sofie Peeters", role: "backoffice" as const };

const task: TaskDetail = {
  id: "t1",
  number: 1043,
  status: "assigned",
  version: "2026-11-25T18:44:00.123456Z",
  workType: "repair",
  instructions: "Lek aan de binnenunit",
  scheduledDate: "2026-11-23",
  startTime: "13:30:00",
  estimatedMinutes: 90,
  locationStreet: "Lierseweg 87",
  locationPostalCode: "2200",
  locationCity: "Herentals",
  customer: {
    id: "c1",
    name: "Fam. Van Dyck",
    street: "Kerkstraat 1",
    postalCode: "2300",
    city: "Turnhout",
    phone: "0476 21 43 65",
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

const detailPage = (number: string, searchParams: Record<string, string> = {}) =>
  TaskDetailPage({
    params: Promise.resolve({ number }),
    searchParams: Promise.resolve(searchParams),
  } as never);
const editPage = (number: string) => EditTaskPage({ params: Promise.resolve({ number }) } as never);

beforeEach(() => {
  vi.resetAllMocks();
  notFound.mockImplementation(() => {
    throw new Error("NEXT_NOT_FOUND");
  });
  checkRoleAccess.mockResolvedValue({ kind: "allowed", user: sofie });
  getTaskDetail.mockResolvedValue(task);
  listAssignableTechnicians.mockResolvedValue([
    { id: "u1", fullName: "Kevin Wouters" },
    { id: "u2", fullName: "Jens Maes" },
  ]);
});

describe("the task page (B3)", () => {
  it("checks the role first, then reads the task by its number", async () => {
    render(await detailPage("1043"));
    expect(checkRoleAccess).toHaveBeenCalledWith("backoffice");
    expect(getTaskDetail).toHaveBeenCalledWith(1043);
    expect(screen.getByRole("heading", { level: 1, name: "Fam. Van Dyck" })).toBeInTheDocument();
  });

  it("shows the confirmation only for ?saved=1", async () => {
    render(await detailPage("1043", { saved: "1" }));
    expect(screen.getByRole("status")).toHaveTextContent("Taak #1043 bewaard.");
  });

  it.each([
    ["marked", "Taak gemarkeerd als gefactureerd."],
    ["unmarked", "Markering ongedaan gemaakt. De taak staat weer op Afgewerkt."],
  ])("shows the confirmation for ?invoiced=%s", async (value, message) => {
    render(await detailPage("1043", { invoiced: value }));
    expect(screen.getByRole("status")).toHaveTextContent(message);
  });

  it.each([["1"], ["yes"], ["<b>marked</b>"], ["MARKED"]])(
    "shows no invoicing confirmation for ?invoiced=%j",
    async (value) => {
      render(await detailPage("1043", { invoiced: value }));
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    },
  );

  it("reads the technicians for Terugzetten only for an Opgepikt task", async () => {
    render(await detailPage("1043"));
    expect(listAssignableTechnicians).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Terugzetten" })).not.toBeInTheDocument();

    getTaskDetail.mockResolvedValue({
      ...task,
      status: "picked_up",
      pickedUpAt: new Date("2026-11-23T06:48:00Z"),
    });
    render(await detailPage("1043"));
    expect(listAssignableTechnicians).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Terugzetten" })).toBeInTheDocument();
  });

  it("shows the cancellation confirmation only for ?cancelled=1 and a cancelled task", async () => {
    getTaskDetail.mockResolvedValue({
      ...task,
      status: "cancelled",
      cancelledAt: new Date("2026-11-23T10:20:00Z"),
      cancelledByName: "Sofie Peeters",
    });
    render(await detailPage("1043", { cancelled: "1" }));
    expect(screen.getByRole("status")).toHaveTextContent("Taak #1043 is geannuleerd.");
  });

  it("shows no cancellation confirmation for another value of ?cancelled", async () => {
    getTaskDetail.mockResolvedValue({
      ...task,
      status: "cancelled",
      cancelledAt: new Date("2026-11-23T10:20:00Z"),
      cancelledByName: "Sofie Peeters",
    });
    render(await detailPage("1043", { cancelled: "yes" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the reset confirmation only for ?reset=1", async () => {
    render(await detailPage("1043", { reset: "1" }));
    expect(screen.getByRole("status")).toHaveTextContent("Taak teruggezet.");
  });

  it.each([["abc"], ["0"], ["-1"], ["1e3"], ["01043"], ["1043abc"], ["9999999999"], [""]])(
    "gives 'not found' for the number %j without asking the database",
    async (number) => {
      await expect(detailPage(number)).rejects.toThrow("NEXT_NOT_FOUND");
      expect(getTaskDetail).not.toHaveBeenCalled();
    },
  );

  it("gives 'not found' for a number that does not exist", async () => {
    getTaskDetail.mockResolvedValue(null);
    await expect(detailPage("5000")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each([["wrong-role"], ["unavailable"]])(
    "renders nothing for access '%s', and does not reveal whether the task exists",
    async (kind) => {
      checkRoleAccess.mockResolvedValue({ kind, user: { ...sofie, role: "technician" } });
      expect(await detailPage("1043")).toBeNull();
      expect(await detailPage("abc")).toBeNull();
      expect(getTaskDetail).not.toHaveBeenCalled();
      expect(notFound).not.toHaveBeenCalled();
    },
  );
});

describe("the 'not found' page of a task", () => {
  it("says the task does not exist and links back to the overview", () => {
    render(<TaskNotFound />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Deze taak bestaat niet (meer)." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Naar de taken" })).toHaveAttribute("href", "/tasks");
  });
});

describe("the edit page (B2, edit mode)", () => {
  it("has the title with the number, a way back and the form with the values of the task", async () => {
    render(await editPage("1043"));
    expect(
      screen.getByRole("heading", { level: 1, name: "Taak #1043 bewerken" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Terug naar de taak" })).toHaveAttribute(
      "href",
      "/tasks/1043",
    );
    expect(screen.getByLabelText(/^Straat en nummer/)).toHaveValue("Lierseweg 87");
    expect(screen.getByLabelText(/^Technieker$/)).toHaveValue("u1");
    expect(screen.getByRole("button", { name: "Wijzigingen bewaren" })).toBeInTheDocument();
  });

  it("gives 'not found' for an invalid or unknown number", async () => {
    await expect(editPage("abc")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getTaskDetail).not.toHaveBeenCalled();
    getTaskDetail.mockResolvedValue(null);
    await expect(editPage("5000")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each([
    ["completed", "Afgewerkt"],
    ["invoiced", "Gefactureerd"],
    ["cancelled", "Geannuleerd"],
  ] as const)("a %s task has no form, only the reason and a way back", async (status, label) => {
    getTaskDetail.mockResolvedValue({ ...task, status });
    render(await editPage("1043"));
    expect(
      screen.getByText(`Deze taak is ${label.toLowerCase()} en kan niet meer bewerkt worden.`),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Wijzigingen bewaren" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Naar de taak" })).toHaveAttribute(
      "href",
      "/tasks/1043",
    );
    expect(listAssignableTechnicians).not.toHaveBeenCalled();
  });

  it.each([["wrong-role"], ["unavailable"]])(
    "renders nothing for access '%s' and reads nothing",
    async (kind) => {
      checkRoleAccess.mockResolvedValue({ kind, user: { ...sofie, role: "technician" } });
      expect(await editPage("1043")).toBeNull();
      expect(getTaskDetail).not.toHaveBeenCalled();
      expect(listAssignableTechnicians).not.toHaveBeenCalled();
    },
  );

  it("offers the current technician even when he is no longer in the list of active ones", async () => {
    listAssignableTechnicians.mockResolvedValue([{ id: "u2", fullName: "Jens Maes" }]);
    render(await editPage("1043"));
    const options = within(screen.getByLabelText(/^Technieker$/)).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Nog niet toewijzen",
      "Jens Maes",
      "Kevin Wouters",
    ]);
  });
});
