import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { checkRoleAccess, getMyTasks, getMyTaskDetail, notFound } = vi.hoisted(() => ({
  checkRoleAccess: vi.fn(),
  getMyTasks: vi.fn(),
  getMyTaskDetail: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/lib/auth/role-access", () => ({ checkRoleAccess }));
vi.mock("@/lib/tasks/my-tasks", () => ({ getMyTasks }));
vi.mock("@/lib/tasks/detail", () => ({ getMyTaskDetail }));
vi.mock("next/navigation", () => ({ notFound, useRouter: () => ({ refresh: vi.fn() }) }));
// The page renders the button Oppikken, which imports the Server Action; the action has its own tests.
vi.mock("./actions", () => ({ pickUpTask: vi.fn() }));
const { getCompanyPhone } = vi.hoisted(() => ({ getCompanyPhone: vi.fn() }));
vi.mock("@/lib/company", () => ({ getCompanyPhone }));

import type { TaskDetail } from "@/lib/tasks/detail";

import MyTasksPage from "./page";
import MyTaskNotFound from "./[number]/not-found";
import MyTaskPage from "./[number]/page";

const kevin = { id: "k1", email: "k@x.be", fullName: "Kevin Wouters", role: "technician" as const };

const task: TaskDetail = {
  id: "t1",
  number: 1042,
  status: "assigned",
  version: "2026-11-25T18:44:00.123456Z",
  workType: "maintenance",
  instructions: "Jaarlijks onderhoud",
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
    notes: null,
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

const listPage = (searchParams: Record<string, string | string[] | undefined> = {}) =>
  MyTasksPage({ searchParams: Promise.resolve(searchParams) } as never);
const taskPage = (number: string) => MyTaskPage({ params: Promise.resolve({ number }) } as never);

beforeEach(() => {
  vi.resetAllMocks();
  notFound.mockImplementation(() => {
    throw new Error("NEXT_NOT_FOUND");
  });
  checkRoleAccess.mockResolvedValue({ kind: "allowed", user: kevin });
  getMyTasks.mockResolvedValue({ tab: "todo", tasks: [] });
  getMyTaskDetail.mockResolvedValue(task);
});

describe("Mijn taken (T1)", () => {
  it("checks the technician role first and shows the title, the tabs and the empty state", async () => {
    render(await listPage());
    expect(checkRoleAccess).toHaveBeenCalledWith("technician");
    expect(screen.getByRole("heading", { level: 1, name: "Mijn taken" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Te doen" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Je hebt geen taken.")).toBeInTheDocument();
  });

  it("reads the Te doen tab by default, with the moment of the request", async () => {
    render(await listPage());
    expect(getMyTasks).toHaveBeenCalledWith("todo", expect.any(Date));
  });

  it("reads the Afgewerkt tab for ?tab=done", async () => {
    getMyTasks.mockResolvedValue({ tab: "done", tasks: [] });
    render(await listPage({ tab: "done" }));
    expect(getMyTasks).toHaveBeenCalledWith("done", expect.any(Date));
    expect(screen.getByRole("link", { name: "Afgewerkt" })).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByText("Je hebt de laatste 30 dagen nog geen taken afgemeld."),
    ).toBeInTheDocument();
  });

  it("ignores an unknown tab, like the other overviews", async () => {
    render(await listPage({ tab: "cancelled" }));
    expect(getMyTasks).toHaveBeenCalledWith("todo", expect.any(Date));
  });

  it("never takes whose tasks from the address: it passes no id on", async () => {
    await listPage({ technician: "someone-else", assignee: "someone-else", tab: "done" });
    expect(getMyTasks).toHaveBeenCalledTimes(1);
    expect(getMyTasks.mock.calls[0]).toHaveLength(2);
  });

  it.each([["wrong-role"], ["unavailable"]])(
    "renders nothing for access '%s' and reads nothing",
    async (kind) => {
      checkRoleAccess.mockResolvedValue({ kind, user: { ...kevin, role: "backoffice" } });
      expect(await listPage()).toBeNull();
      expect(getMyTasks).not.toHaveBeenCalled();
    },
  );
});

describe("Taak (T2)", () => {
  it("checks the role first, then reads the task by its number", async () => {
    render(await taskPage("1042"));
    expect(checkRoleAccess).toHaveBeenCalledWith("technician");
    expect(getMyTaskDetail).toHaveBeenCalledWith(1042);
    expect(
      screen.getByRole("heading", { level: 1, name: "Bakkerij De Gouden Korst" }),
    ).toBeInTheDocument();
  });

  it("passes the office number of the company on to the page", async () => {
    getCompanyPhone.mockReturnValue("014 00 00 00");
    getMyTaskDetail.mockResolvedValue({
      ...task,
      status: "picked_up",
      pickedUpAt: new Date("2026-11-23T06:48:00Z"),
    });
    render(await taskPage("1042"));
    expect(screen.getByRole("link", { name: "014 00 00 00" })).toHaveAttribute(
      "href",
      "tel:014000000",
    );
  });

  it.each([["abc"], ["0"], ["-1"], ["1e3"], ["01042"], ["1042abc"], ["9999999999"], [""]])(
    "gives 'not found' for the number %j without asking the database",
    async (number) => {
      await expect(taskPage(number)).rejects.toThrow("NEXT_NOT_FOUND");
      expect(getMyTaskDetail).not.toHaveBeenCalled();
    },
  );

  it("gives the same 'not found' for a task that does not exist or is not his (the read returns null)", async () => {
    getMyTaskDetail.mockResolvedValue(null);
    await expect(taskPage("5000")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each([["wrong-role"], ["unavailable"]])(
    "renders nothing for access '%s', and does not reveal whether the task exists",
    async (kind) => {
      checkRoleAccess.mockResolvedValue({ kind, user: { ...kevin, role: "backoffice" } });
      expect(await taskPage("1042")).toBeNull();
      expect(await taskPage("abc")).toBeNull();
      expect(getMyTaskDetail).not.toHaveBeenCalled();
      expect(notFound).not.toHaveBeenCalled();
    },
  );

  it("has a 'not found' page that says the same for every case and leads back to the list", () => {
    render(<MyTaskNotFound />);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Deze taak bestaat niet of is niet aan jou toegewezen.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Naar mijn taken" })).toHaveAttribute(
      "href",
      "/my-tasks",
    );
  });
});
