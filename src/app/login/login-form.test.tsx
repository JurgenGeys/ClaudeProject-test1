import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { login } = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock("./actions", () => ({ login }));

import { LoginForm } from "./login-form";

beforeEach(() => {
  login.mockReset();
});

function submit() {
  fireEvent.submit(screen.getByRole("button", { name: "Aanmelden" }).closest("form")!);
}

describe("LoginForm", () => {
  it("has labelled fields, a submit button and the link 'Wachtwoord vergeten?'", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText("E-mailadres")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Wachtwoord")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Aanmelden" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Wachtwoord vergeten?" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("marks the form as hydrated, for the end-to-end tests", () => {
    const { container } = render(<LoginForm />);
    expect(container.querySelector("form")).toHaveAttribute("data-hydrated", "true");
  });

  it("shows a notice that was decided before the form was shown", () => {
    render(<LoginForm notice="Je account is uitgeschakeld. Neem contact op met kantoor." />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Je account is uitgeschakeld. Neem contact op met kantoor.",
    );
  });

  it("links field errors to their fields and summarizes them", async () => {
    login.mockResolvedValue({
      email: "",
      fieldErrors: { email: "Vul je e-mailadres in.", password: "Vul je wachtwoord in." },
    });
    render(<LoginForm />);
    submit();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("Vul de 2 gemarkeerde velden in.");

    const email = screen.getByLabelText("E-mailadres");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription("Vul je e-mailadres in.");
    const password = screen.getByLabelText("Wachtwoord");
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAccessibleDescription("Vul je wachtwoord in.");
    // The focus moves to the message so a screen reader announces it.
    expect(screen.getByRole("alert")).toHaveFocus();
  });

  it("uses the singular in the summary of one field error", async () => {
    login.mockResolvedValue({
      email: "kevin@frisair.be",
      fieldErrors: { password: "Vul je wachtwoord in." },
    });
    render(<LoginForm />);
    submit();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Vul het gemarkeerde veld in."),
    );
    expect(screen.getByLabelText("E-mailadres")).not.toHaveAttribute("aria-invalid");
  });

  it("shows the form error and keeps the typed e-mail address", async () => {
    login.mockResolvedValue({
      email: "kevin@frisair.be",
      fieldErrors: {},
      formError: "Dit e-mailadres en wachtwoord passen niet bij elkaar. Probeer opnieuw.",
    });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("E-mailadres"), {
      target: { value: "kevin@frisair.be" },
    });
    submit();

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Dit e-mailadres en wachtwoord passen niet bij elkaar. Probeer opnieuw.",
      ),
    );
    expect(screen.getByLabelText("E-mailadres")).toHaveValue("kevin@frisair.be");
  });
});
