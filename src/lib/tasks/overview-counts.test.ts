import { describe, expect, it } from "vitest";

import { countsPerTab } from "./overview-counts";

describe("countsPerTab", () => {
  it("is all zeros without tasks", () => {
    expect(Object.values(countsPerTab({})).every((count) => count === 0)).toBe(true);
  });

  it("counts Actief as Open + Toegewezen + Opgepikt + Afgewerkt, without Gefactureerd and Geannuleerd", () => {
    const counts = countsPerTab({
      open: 2,
      assigned: 6,
      picked_up: 2,
      completed: 6,
      invoiced: 10,
      cancelled: 3,
    });
    expect(counts.active).toBe(16);
  });

  it("counts Alle including Geannuleerd", () => {
    const counts = countsPerTab({ open: 1, completed: 2, invoiced: 3, cancelled: 4 });
    expect(counts.all).toBe(10);
  });

  it("gives every status tab its own number", () => {
    expect(countsPerTab({ assigned: 6, cancelled: 3 })).toMatchObject({
      open: 0,
      assigned: 6,
      picked_up: 0,
      completed: 0,
      invoiced: 0,
      cancelled: 3,
    });
  });

  it("keeps a cancelled task out of Actief", () => {
    expect(countsPerTab({ cancelled: 5 }).active).toBe(0);
  });
});
