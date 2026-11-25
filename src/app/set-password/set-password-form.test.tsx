import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { setPassword } = vi.hoisted(() => ({ setPassword: vi.fn() }));
vi.mock("./actions", () => ({ setPassword }));

import { SetPasswordForm } from "./set-password-form";

beforeEach(() => {
  setPassword.mockReset();
});

function submit() {
  fireEvent.submit(screen.getByRole("button", { name: "Wachtwoord bewaren" }).closest("form")!);
}

describe("SetPasswordForm", () => {
  it("has two labelled password fields with the rule, and a submit button", () => {
    render(<SetPasswordForm mode="invite" />);
    const password = screen.getByLabelText("Nieuw wachtwoord");
    expect(password).toHaveAttribute("type", "password");
    expect(password).toHaveAttribute("autocomplete", "new-password");
    expect(password).toHaveAccessibleDescription("Minstens 8 tekens.");
    expect(screen.getByLabelText("Herhaal wachtwoord")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Wachtwoord bewaren" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sends the mode along, only to choose the wording of a refusal", () => {
    const { container, rerender } = render(<SetPasswordForm mode="reset" />);
    expect(container.querySelector('input[name="mode"]')).toHaveValue("reset");
    rerender(<SetPasswordForm mode="invite" />);
    expect(container.querySelector('input[name="mode"]')).toHaveValue("invite");
  });

  it("marks the form as hydrated, for the end-to-end tests", () => {
    const { container } = render(<SetPasswordForm mode="invite" />);
    expect(container.querySelector("form")).toHaveAttribute("data-hydrated", "true");
  });

  it("links the field errors to their fields, summarizes them and moves the focus", async () => {
    setPassword.mockResolvedValue({
      fieldErrors: {
        password: "Je wachtwoord moet minstens 8 tekens hebben.",
        confirmPassword: "De twee wachtwoorden zijn niet gelijk.",
      },
    });
    render(<SetPasswordForm mode="invite" />);
    submit();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Vul de 2 gemarkeerde velden in.");
    // The focus moves after the render that shows the summary: wait for it.
    await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());

    const password = screen.getByLabelText("Nieuw wachtwoord");
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAccessibleDescription(
      "Minstens 8 tekens. Je wachtwoord moet minstens 8 tekens hebben.",
    );
    const confirm = screen.getByLabelText("Herhaal wachtwoord");
    expect(confirm).toHaveAttribute("aria-invalid", "true");
    expect(confirm).toHaveAccessibleDescription("De twee wachtwoorden zijn niet gelijk.");
  });

  it("shows a form error such as an expired link", async () => {
    setPassword.mockResolvedValue({
      fieldErrors: {},
      formError: "Deze link is niet meer geldig. Vraag kantoor om een nieuwe uitnodiging.",
    });
    render(<SetPasswordForm mode="invite" />);
    submit();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Deze link is niet meer geldig. Vraag kantoor om een nieuwe uitnodiging.",
      ),
    );
    expect(screen.getByLabelText("Nieuw wachtwoord")).not.toHaveAttribute("aria-invalid");
  });

  it("sends both fields to the action", async () => {
    setPassword.mockResolvedValue(null);
    render(<SetPasswordForm mode="invite" />);
    fireEvent.change(screen.getByLabelText("Nieuw wachtwoord"), {
      target: { value: "een-goed-wachtwoord" },
    });
    fireEvent.change(screen.getByLabelText("Herhaal wachtwoord"), {
      target: { value: "een-goed-wachtwoord" },
    });
    submit();
    await waitFor(() => expect(setPassword).toHaveBeenCalled());
    const data = setPassword.mock.calls[0][1] as FormData;
    expect(data.get("password")).toBe("een-goed-wachtwoord");
    expect(data.get("confirmPassword")).toBe("een-goed-wachtwoord");
  });
});
