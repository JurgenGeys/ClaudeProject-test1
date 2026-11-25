import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createTask, updateTask, searchCustomers } = vi.hoisted(() => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
  searchCustomers: vi.fn(),
}));
vi.mock("./actions", () => ({ createTask, updateTask }));
vi.mock("../customers/actions", () => ({ searchCustomers }));

import { TaskForm, type TaskFormEdit } from "./task-form";

const technicians = [
  { id: "t1", fullName: "Kevin Wouters" },
  { id: "t2", fullName: "Jens Maes" },
];

const edit: TaskFormEdit = {
  number: 1043,
  version: "2026-11-25T18:44:00.123456Z",
  status: "assigned",
  customer: {
    id: "c1",
    name: "Fam. Van Dyck",
    street: "Kerkstraat 1",
    postalCode: "2300",
    city: "Turnhout",
    phone: "0476 21 43 65",
  },
  locationStreet: "Lierseweg 87",
  locationPostalCode: "2200",
  locationCity: "Herentals",
  workType: "maintenance",
  instructions: "Nazicht airco\nTweede regel",
  scheduledDate: "2030-03-15",
  startTime: "13:30",
  estimatedMinutes: 60,
  assignee: technicians[0],
};

beforeEach(() => {
  vi.resetAllMocks();
  updateTask.mockResolvedValue(null);
  searchCustomers.mockResolvedValue({ ok: true, customers: [] });
});

const field = (label: string) => screen.getByLabelText(new RegExp(`^${label}( \\*)?$`));
const submit = () =>
  act(async () => {
    fireEvent.submit(screen.getByRole("button", { name: "Wijzigingen bewaren" }).closest("form")!);
  });
const sent = () => Object.fromEntries(updateTask.mock.calls.at(-1)![1] as FormData);

describe("TaskForm in edit mode", () => {
  it("starts from the saved task", () => {
    render(<TaskForm technicians={technicians} edit={edit} />);
    expect(screen.getByText("Fam. Van Dyck")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Andere klant kiezen" })).toBeInTheDocument();
    expect(field("Straat en nummer")).toHaveValue("Lierseweg 87");
    expect(field("Postcode")).toHaveValue("2200");
    expect(field("Gemeente")).toHaveValue("Herentals");
    expect(screen.getByRole("radio", { name: "Onderhoud" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Nazicht" })).not.toBeChecked();
    expect(field("Instructies")).toHaveValue("Nazicht airco\nTweede regel");
    expect(field("Datum")).toHaveValue("2030-03-15");
    expect(field("Startuur")).toHaveValue("13:30");
    expect(field("Geschatte duur")).toHaveValue("60");
    expect(field("Technieker")).toHaveValue("t1");
  });

  it("sends the task number, the version and the saved values to updateTask, not to createTask", async () => {
    render(<TaskForm technicians={technicians} edit={edit} />);
    fireEvent.change(field("Instructies"), { target: { value: "Nieuwe tekst" } });
    await submit();
    expect(createTask).not.toHaveBeenCalled();
    expect(sent()).toMatchObject({
      taskNumber: "1043",
      version: "2026-11-25T18:44:00.123456Z",
      customerMode: "existing",
      customerId: "c1",
      locationStreet: "Lierseweg 87",
      workType: "maintenance",
      instructions: "Nieuwe tekst",
      scheduledDate: "2030-03-15",
      startTime: "13:30",
      estimatedMinutes: "60",
      assigneeId: "t1",
    });
  });

  it("can be set back to 'Nog niet toewijzen', and says what that does", async () => {
    render(<TaskForm technicians={technicians} edit={edit} />);
    expect(field("Technieker")).toHaveAccessibleDescription(
      /verdwijnt de taak uit de lijst van Kevin Wouters.*terug op Open/,
    );
    fireEvent.change(field("Technieker"), { target: { value: "" } });
    await submit();
    expect(sent().assigneeId).toBe("");
  });

  it("uses the labels and the way back of editing", () => {
    render(<TaskForm technicians={technicians} edit={edit} />);
    expect(screen.queryByRole("button", { name: "Taak bewaren" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Annuleren" })).toHaveAttribute("href", "/tasks/1043");
  });

  it("an Open task starts on 'Nog niet toewijzen' with the hint of the new task", () => {
    render(
      <TaskForm technicians={technicians} edit={{ ...edit, status: "open", assignee: null }} />,
    );
    expect(field("Technieker")).toHaveValue("");
    expect(field("Technieker")).toHaveAccessibleDescription(/krijgt de taak de status Toegewezen/);
  });

  it("a task without an estimate starts on 'Niet ingevuld'", () => {
    render(<TaskForm technicians={technicians} edit={{ ...edit, estimatedMinutes: null }} />);
    expect(field("Geschatte duur")).toHaveValue("");
  });

  it("an Opgepikt task has a disabled technician, with the explanation, and sends none", async () => {
    render(<TaskForm technicians={technicians} edit={{ ...edit, status: "picked_up" }} />);
    const select = field("Technieker");
    expect(select).toBeDisabled();
    expect(
      within(select)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Kevin Wouters"]);
    expect(select).toHaveAccessibleDescription(
      "Deze taak is opgepikt. Gebruik 'Terugzetten' om een andere technieker te kiezen.",
    );
    await submit();
    expect("assigneeId" in sent()).toBe(false);
  });

  it("another customer can be chosen, which fills in the location again", async () => {
    searchCustomers.mockResolvedValue({
      ok: true,
      customers: [
        {
          id: "c2",
          name: "Bakkerij",
          street: "Dorp 4",
          postalCode: "2381",
          city: "Weelde",
          phone: null,
        },
      ],
    });
    render(<TaskForm technicians={technicians} edit={edit} />);
    fireEvent.click(screen.getByRole("button", { name: "Andere klant kiezen" }));
    fireEvent.change(screen.getByLabelText("Zoek een klant"), { target: { value: "bak" } });
    fireEvent.click(await screen.findByRole("button", { name: /Bakkerij/ }));
    expect(field("Gemeente")).toHaveValue("Weelde");
    await submit();
    expect(sent()).toMatchObject({ customerId: "c2", locationCity: "Weelde" });
  });

  it("warns about a date in the past from the start, as a message and not as an error", () => {
    render(<TaskForm technicians={technicians} edit={{ ...edit, scheduledDate: "2020-01-15" }} />);
    expect(screen.getByText("Deze datum ligt in het verleden.")).toBeInTheDocument();
  });

  describe("when the task changed meanwhile", () => {
    const changed = {
      ok: false,
      fieldErrors: {},
      formError: "Deze taak is intussen gewijzigd. Bekijk de taak opnieuw.",
      reload: true,
    };

    it("shows the message with the focus and a button that reloads the page, and keeps what was typed", async () => {
      updateTask.mockResolvedValue(changed);
      const reload = vi.fn();
      vi.stubGlobal("location", { ...window.location, reload });
      render(<TaskForm technicians={technicians} edit={edit} />);
      fireEvent.change(field("Instructies"), { target: { value: "Mijn wijziging" } });
      await submit();

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Deze taak is intussen gewijzigd. Bekijk de taak opnieuw.");
      expect(alert).toHaveFocus();
      expect(field("Instructies")).toHaveValue("Mijn wijziging");
      fireEvent.click(within(alert).getByRole("button", { name: "Pagina herladen" }));
      expect(reload).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    });

    it("shows no reload button for other errors", async () => {
      updateTask.mockResolvedValue({
        ok: false,
        fieldErrors: {},
        formError: "Dat is niet gelukt.",
      });
      render(<TaskForm technicians={technicians} edit={edit} />);
      await submit();
      expect(await screen.findByRole("alert")).toHaveTextContent("Dat is niet gelukt.");
      expect(screen.queryByRole("button", { name: "Pagina herladen" })).not.toBeInTheDocument();
    });
  });

  it("marks the technician field when his message comes back, like the new task form", async () => {
    updateTask.mockResolvedValue({
      ok: false,
      fieldErrors: { assigneeId: "Kevin Wouters is niet meer actief. Kies een andere technieker." },
    });
    render(<TaskForm technicians={technicians} edit={edit} />);
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "De taak is niet bewaard. Vul het gemarkeerde veld in.",
    );
    expect(field("Technieker")).toHaveAttribute("aria-invalid", "true");
    expect(field("Technieker")).toHaveAccessibleDescription(/is niet meer actief/);
  });

  it("keeps the technician selectable when he is no longer in the list", () => {
    render(<TaskForm technicians={[technicians[1]]} edit={edit} />);
    expect(field("Technieker")).toHaveValue("t1");
  });
});

describe("TaskForm without edit", () => {
  it("has no hidden task number and no version", () => {
    const { container } = render(<TaskForm technicians={technicians} />);
    expect(container.querySelector('input[name="taskNumber"]')).toBeNull();
    expect(container.querySelector('input[name="version"]')).toBeNull();
  });
});
