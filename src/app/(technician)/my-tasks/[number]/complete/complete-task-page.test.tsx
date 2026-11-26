import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { checkRoleAccess, getMyTaskDetail, notFound, redirect } = vi.hoisted(() => ({
  checkRoleAccess: vi.fn(),
  getMyTaskDetail: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));
vi.mock("@/lib/auth/role-access", () => ({ checkRoleAccess }));
vi.mock("@/lib/tasks/detail", () => ({ getMyTaskDetail }));
vi.mock("@/lib/company", () => ({ getCompanyPhone: () => undefined }));
vi.mock("next/navigation", () => ({
  notFound,
  redirect,
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("../../actions", () => ({ completeTask: vi.fn() }));

import CompleteTaskPage from "./page";

const task = {
  number: 1042,
  status: "picked_up",
  version: "2026-11-25T18:44:00.123456Z",
  scheduledDate: "2026-11-23",
  startTime: "08:00:00",
  customer: { name: "Bakkerij De Gouden Korst" },
};
const open = (number: string) => CompleteTaskPage({ params: Promise.resolve({ number }) } as never);

beforeEach(() => {
  vi.resetAllMocks();
  checkRoleAccess.mockResolvedValue({ kind: "allowed" });
  notFound.mockImplementation(() => {
    throw new Error("NEXT_NOT_FOUND");
  });
  redirect.mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
});

describe("T3 page", () => {
  it("checks the technician role first and renders nothing for another role", async () => {
    checkRoleAccess.mockResolvedValue({ kind: "forbidden" });
    expect(await open("1042")).toBeNull();
    expect(checkRoleAccess).toHaveBeenCalledWith("technician");
    expect(getMyTaskDetail).not.toHaveBeenCalled();
  });

  it("shows the form for an Opgepikt task of his own", async () => {
    getMyTaskDetail.mockResolvedValue(task);
    render(await open("1042"));
    expect(getMyTaskDetail).toHaveBeenCalledWith(1042);
    expect(screen.getByRole("heading", { name: "Taak afmelden" })).toBeInTheDocument();
  });

  it("gives 'not found' for a number that is not valid or not his, alike", async () => {
    getMyTaskDetail.mockResolvedValue(null);
    await expect(open("1042")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(open("abc")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getMyTaskDetail).toHaveBeenCalledTimes(1);
  });

  it.each(["assigned", "completed", "invoiced", "cancelled"])(
    "sends a %s task to T2, which shows what is true",
    async (status) => {
      getMyTaskDetail.mockResolvedValue({ ...task, status });
      await expect(open("1042")).rejects.toThrow("NEXT_REDIRECT:/my-tasks/1042");
    },
  );
});
