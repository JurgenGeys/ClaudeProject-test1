import { describe, expect, it } from "vitest";

import { formatAddressLine, mapsHref } from "./maps";

const address = { street: "Gasthuisstraat 23", postalCode: "2300", city: "Turnhout" };

describe("formatAddressLine", () => {
  it("writes street, postal code and city on one line", () => {
    expect(formatAddressLine(address)).toBe("Gasthuisstraat 23, 2300 Turnhout");
  });

  it("trims the parts", () => {
    expect(formatAddressLine({ street: " Dorp 1 ", postalCode: "2300 ", city: " Turnhout" })).toBe(
      "Dorp 1, 2300 Turnhout",
    );
  });
});

describe("mapsHref", () => {
  it("builds the universal maps link with only the address", () => {
    expect(mapsHref(address)).toBe("https://maps.google.com/?q=Gasthuisstraat+23%2C+2300+Turnhout");
  });

  it("encodes accents and characters that would change the query", () => {
    const href = mapsHref({ street: "Rue d'Été & Co #5 100%", postalCode: "1000", city: "Liège" });
    const url = new URL(href);
    expect(url.origin).toBe("https://maps.google.com");
    expect([...url.searchParams.keys()]).toEqual(["q"]);
    expect(url.searchParams.get("q")).toBe("Rue d'Été & Co #5 100%, 1000 Liège");
    expect(href).not.toContain(" ");
    expect(href.split("?")).toHaveLength(2);
    expect(href).not.toContain("#");
  });

  it("does not let a query-like street add parameters", () => {
    const url = new URL(mapsHref({ street: "A&key=secret", postalCode: "1", city: "B" }));
    expect([...url.searchParams.keys()]).toEqual(["q"]);
  });
});
