import { describe, expect, it } from "vitest";

import { assertLocalSupabase } from "./local-only";

const local = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
};

describe("assertLocalSupabase", () => {
  it("accepts a local Supabase (127.0.0.1 or localhost)", () => {
    expect(() => assertLocalSupabase(local)).not.toThrow();
    expect(() =>
      assertLocalSupabase({
        NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
        DATABASE_URL: "postgresql://postgres:postgres@localhost:54322/postgres",
      }),
    ).not.toThrow();
  });

  it("refuses a hosted Supabase URL", () => {
    expect(() =>
      assertLocalSupabase({ ...local, NEXT_PUBLIC_SUPABASE_URL: "https://abcdefgh.supabase.co" }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL does not point to 127\.0\.0\.1 or localhost/);
  });

  it("refuses a remote database even when the API URL is local", () => {
    expect(() =>
      assertLocalSupabase({
        ...local,
        DATABASE_URL: "postgresql://postgres:secret@db.abcdefgh.supabase.co:5432/postgres",
      }),
    ).toThrow(/DATABASE_URL does not point to/);
  });

  it("names both variables when both are remote", () => {
    expect(() =>
      assertLocalSupabase({
        NEXT_PUBLIC_SUPABASE_URL: "https://abcdefgh.supabase.co",
        DATABASE_URL: "postgresql://u:p@db.abcdefgh.supabase.co:5432/postgres",
      }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL and DATABASE_URL/);
  });

  it("does not let a look-alike host pass", () => {
    expect(() =>
      assertLocalSupabase({
        ...local,
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1.evil.example:54321",
      }),
    ).toThrow();
    expect(() =>
      assertLocalSupabase({ ...local, NEXT_PUBLIC_SUPABASE_URL: "http://localhost@evil.example/" }),
    ).toThrow();
  });

  it("refuses missing or invalid values", () => {
    expect(() => assertLocalSupabase({ DATABASE_URL: local.DATABASE_URL })).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL is not set/,
    );
    expect(() => assertLocalSupabase({ ...local, DATABASE_URL: "geen url" })).toThrow(
      /DATABASE_URL is not a valid URL/,
    );
  });
});
