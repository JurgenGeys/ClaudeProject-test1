const LOCAL_HOSTS = ["127.0.0.1", "localhost"];

function hostnameOf(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set.`);
  }
  try {
    return new URL(value).hostname;
  } catch {
    throw new Error(`${name} is not a valid URL.`);
  }
}

/**
 * Safety check for the end-to-end tests: they create users and change profiles, so they
 * may only ever run against a Supabase on this machine (or the CI runner). Throws, with an
 * explanation, when the Supabase URL or the database URL points anywhere else.
 */
export function assertLocalSupabase(env: Record<string, string | undefined>): void {
  const offenders = (["NEXT_PUBLIC_SUPABASE_URL", "DATABASE_URL"] as const).filter(
    (name) => !LOCAL_HOSTS.includes(hostnameOf(name, env[name])),
  );
  if (offenders.length > 0) {
    throw new Error(
      `Refusing to run the end-to-end tests: ${offenders.join(" and ")} does not point to ` +
        `127.0.0.1 or localhost. The tests create users and would change a real Supabase project. ` +
        "Start the local Supabase (`supabase start`) and use its values in .env.local.",
    );
  }
}
