import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { STATUS_CLASSES } from "@/components/status-badge";
import { taskStatuses } from "@/lib/tasks/types";

// WCAG contrast of the design tokens, computed from the real CSS and Tailwind theme files so
// a change to a color cannot silently break accessibility.
//
// This checks the TOKENS (and the badge color pairs), not how components use them. A component
// that draws the ring at another opacity (`ring-ring/30`) or puts text on another background
// is not covered: check such a combination by hand or add it here.

type Rgb = [number, number, number]; // gamma-encoded sRGB, 0 to 1

const root = process.cwd();
const globalsCss = readFileSync(join(root, "src/app/globals.css"), "utf8");
const tailwindTheme = readFileSync(join(root, "node_modules/tailwindcss/theme.css"), "utf8");

/** `oklch(0.25 0 0)` or `oklch(37.2% 0.044 257.287)` to gamma-encoded sRGB. */
function oklchToSrgb(value: string): Rgb {
  const match = /oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/.exec(value);
  if (!match) {
    throw new Error(`Not an oklch color: ${value}`);
  }
  const l = match[2] ? Number(match[1]) / 100 : Number(match[1]);
  const c = Number(match[3]);
  const h = (Number(match[4]) * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  const encode = (x: number) => {
    const v = Math.min(1, Math.max(0, x));
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  };
  return linear.map(encode) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const [lr, lg, lb] = [r, g, b].map((v) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** A color drawn at the given opacity over a background (browsers blend in gamma-encoded sRGB). */
function over(color: Rgb, alpha: number, background: Rgb): Rgb {
  return color.map((v, i) => v * alpha + background[i] * (1 - alpha)) as Rgb;
}

/** A token from the `:root` block of globals.css. */
function token(name: string): Rgb {
  const rootBlock = /:root\s*{([^}]*)}/.exec(globalsCss)?.[1] ?? "";
  const value = new RegExp(`${name}:\\s*(oklch\\([^)]*\\))`).exec(rootBlock)?.[1];
  if (!value) {
    throw new Error(`Token ${name} not found in :root`);
  }
  return oklchToSrgb(value);
}

function tailwindColor(name: string): Rgb {
  const value = new RegExp(`--color-${name}:\\s*(oklch\\([^)]*\\))`).exec(tailwindTheme)?.[1];
  if (!value) {
    throw new Error(`Tailwind color ${name} not found`);
  }
  return oklchToSrgb(value);
}

describe("contrast of the design tokens (WCAG 2.2 AA)", () => {
  it("the focus ring (drawn at 50%) is at least 3 : 1 on the page background", () => {
    const ring = over(token("--ring"), 0.5, token("--background"));
    expect(contrast(ring, token("--background"))).toBeGreaterThanOrEqual(3);
  });

  it("the focus ring (drawn at 50%) is at least 3 : 1 on an accent background (menu item)", () => {
    const ring = over(token("--ring"), 0.5, token("--accent"));
    expect(contrast(ring, token("--accent"))).toBeGreaterThanOrEqual(3);
  });

  it("the border of input fields, checkboxes and radio buttons is at least 3 : 1 on white", () => {
    expect(contrast(token("--input"), token("--background"))).toBeGreaterThanOrEqual(3);
    expect(contrast(token("--input"), token("--card"))).toBeGreaterThanOrEqual(3);
  });

  it("body text and muted text are at least 4.5 : 1 on the page background", () => {
    expect(contrast(token("--foreground"), token("--background"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("--muted-foreground"), token("--background"))).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it("the text of the status tabs (foreground at 80%) is at least 4.5 : 1 on the muted background", () => {
    const muted = token("--muted");
    expect(contrast(over(token("--foreground"), 0.8, muted), muted)).toBeGreaterThanOrEqual(4.5);
    // The reason for the choice: muted text on the muted background is below 4.5 : 1.
    expect(contrast(token("--muted-foreground"), muted)).toBeLessThan(4.5);
  });

  it("the button text is at least 4.5 : 1 on the primary color", () => {
    expect(contrast(token("--primary-foreground"), token("--primary"))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(taskStatuses)("the %s badge text is at least 4.5 : 1 on its background", (status) => {
    // Only classes without a variant prefix (`hover:`, `dark:`) are the normal state.
    const plain = STATUS_CLASSES[status].split(/\s+/).filter((c) => !c.includes(":"));
    const background = plain.find((c) => c.startsWith("bg-"))?.slice(3);
    const text = plain.find((c) => c.startsWith("text-"))?.slice(5);
    if (!background || !text) {
      throw new Error(`No plain bg-* and text-* class for ${status}`);
    }
    expect(contrast(tailwindColor(text), tailwindColor(background))).toBeGreaterThanOrEqual(4.5);
  });
});
