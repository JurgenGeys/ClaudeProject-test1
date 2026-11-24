import { z } from "zod";

const urlSchema = z.url({ error: "NEXT_PUBLIC_SUPABASE_URL is not set or not a valid URL." });
const publishableKeySchema = z
  .string({ error: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set." })
  .min(1, { error: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set." });

function configurationError(issues: { message: string }[]): Error {
  return new Error(
    `Supabase is not configured. ${issues.map((issue) => issue.message).join(" ")} ` +
      "Copy .env.example to .env.local and fill in the values.",
  );
}

/**
 * Public Supabase settings (safe for the browser). Next.js only inlines `NEXT_PUBLIC_*`
 * variables written out literally, so they must be read exactly like this and not via a
 * dynamic key.
 */
export function getSupabasePublicEnv(): { url: string; publishableKey: string } {
  const url = urlSchema.safeParse(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const publishableKey = publishableKeySchema.safeParse(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  if (!url.success || !publishableKey.success) {
    throw configurationError([
      ...(url.success ? [] : url.error.issues),
      ...(publishableKey.success ? [] : publishableKey.error.issues),
    ]);
  }
  return { url: url.data, publishableKey: publishableKey.data };
}

/** Only the project URL, for callers that do not use the publishable key (the admin client). */
export function getSupabaseUrl(): string {
  const url = urlSchema.safeParse(process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!url.success) {
    throw configurationError(url.error.issues);
  }
  return url.data;
}
