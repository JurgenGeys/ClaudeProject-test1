import { describe, expect, it } from "vitest";

import { fieldErrors } from "./test-helpers";
import { technicianIdSchema, technicianSchema } from "./technician";

describe("technicianSchema", () => {
  it("trims the name and trims and lower-cases the e-mail address", () => {
    expect(
      technicianSchema.parse({ fullName: "  Kevin Wouters ", email: " Kevin.Wouters@FrisAir.be " }),
    ).toEqual({ fullName: "Kevin Wouters", email: "kevin.wouters@frisair.be" });
  });

  it("asks for the name and a valid e-mail address when the form is empty", () => {
    expect(fieldErrors(technicianSchema, { fullName: "", email: "" })).toEqual({
      fullName: ["Vul de naam in."],
      email: ["Vul een geldig e-mailadres in."],
    });
  });

  it("treats a name of only spaces as empty", () => {
    expect(fieldErrors(technicianSchema, { fullName: "   ", email: "a@b.be" })).toEqual({
      fullName: ["Vul de naam in."],
    });
  });

  it.each(["kevin", "kevin@", "kevin@frisair", "@frisair.be", "kevin frisair@x.be", "a@b@c.be"])(
    "refuses %j as an e-mail address",
    (email) => {
      expect(fieldErrors(technicianSchema, { fullName: "Kevin", email })).toEqual({
        email: ["Vul een geldig e-mailadres in."],
      });
    },
  );

  it("treats missing fields like empty ones", () => {
    expect(fieldErrors(technicianSchema, {})).toEqual({
      fullName: ["Vul de naam in."],
      email: ["Vul een geldig e-mailadres in."],
    });
  });

  it("refuses absurdly long input", () => {
    expect(
      fieldErrors(technicianSchema, {
        fullName: "a".repeat(201),
        email: `${"a".repeat(320)}@x.be`,
      }),
    ).toEqual({
      fullName: ["Deze tekst is te lang. Maak hem korter."],
      email: ["Vul een geldig e-mailadres in."],
    });
  });
});

describe("technicianIdSchema", () => {
  it("accepts a uuid and refuses anything else", () => {
    expect(technicianIdSchema.safeParse("11111111-1111-4111-8111-111111111111").success).toBe(true);
    expect(technicianIdSchema.safeParse("1 or 1=1").success).toBe(false);
    expect(technicianIdSchema.safeParse("").success).toBe(false);
  });
});
