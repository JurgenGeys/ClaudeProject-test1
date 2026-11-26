import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { MyDoneTask, MyOpenTask } from "@/lib/tasks/my-tasks";

import { MyTaskCard } from "./my-task-card";
import { DoneList, TodoList } from "./my-task-lists";
import { MyTaskTabs } from "./my-task-tabs";

// Monday 23/11/2026, 10:00 in Belgium.
const NOW = new Date("2026-11-23T09:00:00Z");

let counter = 0;
function open(overrides: Partial<MyOpenTask> = {}): MyOpenTask {
  counter += 1;
  return {
    id: `id-${counter}`,
    number: 1000 + counter,
    scheduledDate: "2026-11-23",
    startTime: "08:00:00",
    estimatedMinutes: 90,
    customerName: `Klant ${counter}`,
    city: "Turnhout",
    workType: "maintenance",
    instructions: "Jaarlijks onderhoud 2 split-units\nTweede regel",
    status: "assigned",
    pickedUpAt: null,
    ...overrides,
  };
}

function done(overrides: Partial<MyDoneTask> = {}): MyDoneTask {
  counter += 1;
  return {
    id: `id-${counter}`,
    number: 1000 + counter,
    scheduledDate: "2026-11-19",
    customerName: `Klant ${counter}`,
    city: "Turnhout",
    workType: "inspection",
    workedMinutes: 60,
    completedAt: new Date("2026-11-19T10:07:00Z"),
    ...overrides,
  };
}

const headings = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);

describe("MyTaskTabs", () => {
  it("links both tabs and marks the current one, each at least 44 px high", () => {
    render(<MyTaskTabs current="todo" />);
    const todo = screen.getByRole("link", { name: "Te doen" });
    const finished = screen.getByRole("link", { name: "Afgewerkt" });
    expect(todo).toHaveAttribute("href", "/my-tasks");
    expect(todo).toHaveAttribute("aria-current", "page");
    expect(finished).toHaveAttribute("href", "/my-tasks?tab=done");
    expect(finished).not.toHaveAttribute("aria-current");
    expect(todo).toHaveClass("min-h-11");
    expect(finished).toHaveClass("min-h-11");
  });

  it("marks the finished tab when it is current", () => {
    render(<MyTaskTabs current="done" />);
    expect(screen.getByRole("link", { name: "Afgewerkt" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Te doen" })).not.toHaveAttribute("aria-current");
  });
});

describe("MyTaskCard", () => {
  it("shows time, estimate, number, customer, city, status, kind of work and the first line", () => {
    render(
      <MyTaskCard
        task={open({ number: 1042, customerName: "Bakkerij De Gouden Korst" })}
        now={NOW}
        when="time"
      />,
    );
    const card = screen.getByRole("link");
    expect(card).toHaveAttribute("href", "/my-tasks/1042");
    expect(card).toHaveTextContent("08:00 · ca. 1u30 · #1042");
    expect(card).toHaveTextContent("Bakkerij De Gouden Korst");
    expect(card).toHaveTextContent("Turnhout");
    expect(card).toHaveTextContent("Toegewezen");
    expect(card).toHaveTextContent("Onderhoud · Jaarlijks onderhoud 2 split-units");
    expect(card).not.toHaveTextContent("Tweede regel");
  });

  it("leaves the estimate out when there is none", () => {
    render(
      <MyTaskCard task={open({ estimatedMinutes: null, number: 1046 })} now={NOW} when="time" />,
    );
    expect(screen.getByRole("link")).toHaveTextContent("08:00 · #1046");
  });

  it("writes the day first where there is no day heading", () => {
    const { rerender } = render(
      <MyTaskCard task={open({ scheduledDate: "2026-11-23" })} now={NOW} when="day" />,
    );
    expect(screen.getByRole("link")).toHaveTextContent("Vandaag 08:00");
    rerender(<MyTaskCard task={open({ scheduledDate: "2026-11-24" })} now={NOW} when="day" />);
    expect(screen.getByRole("link")).toHaveTextContent("Morgen 08:00");
    rerender(
      <MyTaskCard
        task={open({ scheduledDate: "2026-11-20", startTime: "15:00:00", estimatedMinutes: null })}
        now={NOW}
        when="day"
        late
      />,
    );
    // 20/11/2026 is a Friday.
    expect(screen.getByRole("link")).toHaveTextContent(/^vr 20\/11 15:00 · #\d+/);
  });

  it("keeps the year of a day in another year", () => {
    render(
      <MyTaskCard
        task={open({ scheduledDate: "2025-12-31", estimatedMinutes: null })}
        now={NOW}
        when="day"
        late
      />,
    );
    // 31/12/2025 is a Wednesday.
    expect(screen.getByRole("link")).toHaveTextContent("wo 31/12/2025 08:00");
  });

  it("shows the status Opgepikt on a picked up task", () => {
    render(
      <MyTaskCard
        task={open({ status: "picked_up", pickedUpAt: new Date("2026-11-23T06:48:00Z") })}
        now={NOW}
        when="day"
      />,
    );
    expect(screen.getByRole("link")).toHaveTextContent("Opgepikt");
  });
});

describe("TodoList", () => {
  it("shows the empty state when there are no tasks", () => {
    render(<TodoList tasks={[]} now={NOW} />);
    expect(screen.getByText("Je hebt geen taken.")).toBeInTheDocument();
    expect(
      screen.getByText("Nieuwe taken verschijnen hier zodra kantoor ze aan jou toewijst."),
    ).toBeInTheDocument();
  });

  it("orders the sections Bezig, Te laat, Vandaag, Morgen and the later days, with weekdays", () => {
    const tasks = [
      open({ scheduledDate: "2026-11-20", startTime: "15:00:00", number: 1029 }),
      open({ scheduledDate: "2026-11-23", status: "picked_up", number: 1042 }),
      open({ scheduledDate: "2026-11-23", startTime: "13:30:00", number: 1043 }),
      open({ scheduledDate: "2026-11-24", startTime: "09:00:00", number: 1044 }),
      open({ scheduledDate: "2026-11-25", startTime: "10:00:00", number: 1047 }),
      open({ scheduledDate: "2027-01-04", startTime: "10:00:00", number: 1050 }),
    ];
    // Bezig comes first although its task is not first in the list: the order of the input is by day.
    render(<TodoList tasks={tasks} now={NOW} />);
    expect(headings()).toEqual([
      "Bezig",
      "Te laat",
      "Vandaag · ma 23/11",
      "Morgen · di 24/11",
      "wo 25/11",
      "ma 04/01/2027",
    ]);
    const late = screen.getByRole("region", { name: "Te laat" });
    expect(within(late).getAllByRole("link")).toHaveLength(1);
    expect(late).toHaveTextContent("#1029");
    const busy = screen.getByRole("region", { name: "Bezig" });
    expect(busy).toHaveTextContent("#1042");
    // The task of today that is picked up is not repeated under "Vandaag".
    const today = screen.getByRole("region", { name: "Vandaag · ma 23/11" });
    expect(today).toHaveTextContent("#1043");
    expect(today).not.toHaveTextContent("#1042");
  });

  it("shows several picked up tasks in Bezig (K5)", () => {
    render(
      <TodoList
        tasks={[
          open({ status: "picked_up", number: 1042 }),
          open({ status: "picked_up", number: 1043, startTime: "09:00:00" }),
        ]}
        now={NOW}
      />,
    );
    expect(within(screen.getByRole("region", { name: "Bezig" })).getAllByRole("link")).toHaveLength(
      2,
    );
    expect(screen.queryByRole("region", { name: "Te laat" })).not.toBeInTheDocument();
  });

  it("has no Te laat or Bezig section when nothing is late or busy", () => {
    render(<TodoList tasks={[open()]} now={NOW} />);
    expect(headings()).toEqual(["Vandaag · ma 23/11"]);
  });
});

describe("DoneList", () => {
  it("lists the finished tasks with date, city, number, work type, hours and the label Afgewerkt", () => {
    render(
      <DoneList
        tasks={[
          done({
            number: 1026,
            customerName: "Fam. De Smedt",
            workedMinutes: 60,
            scheduledDate: "2026-11-19",
          }),
          done({
            number: 1009,
            customerName: "Garage Smets",
            city: "Lille",
            workType: "repair",
            workedMinutes: 150,
            scheduledDate: "2026-11-13",
          }),
        ]}
        now={NOW}
      />,
    );
    expect(screen.getByText("Je afgemelde taken van de laatste 30 dagen.")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Fam. De Smedt");
    // 19/11/2026 is a Thursday, 13/11/2026 a Friday.
    expect(items[0]).toHaveTextContent("do 19/11 · Turnhout");
    expect(items[0]).toHaveTextContent("#1026 · Nazicht");
    expect(items[0]).toHaveTextContent("1u00");
    expect(items[0]).toHaveTextContent("Afgewerkt");
    expect(within(items[0]).getByRole("link")).toHaveAttribute("href", "/my-tasks/1026");
    expect(items[1]).toHaveTextContent("vr 13/11 · Lille");
    expect(items[1]).toHaveTextContent("#1009 · Herstelling");
    expect(items[1]).toHaveTextContent("2u30");
  });

  it("shows the empty state", () => {
    render(<DoneList tasks={[]} now={NOW} />);
    expect(
      screen.getByText("Je hebt de laatste 30 dagen nog geen taken afgemeld."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
