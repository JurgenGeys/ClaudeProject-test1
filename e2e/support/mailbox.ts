import { assertLocalSupabase } from "../../src/lib/supabase/local-only";

/**
 * Reads the mails that the local Supabase catches (Mailpit, switched on with `[local_smtp]`
 * in `supabase/config.toml`; its web address and API are on port 54324). The invitation mail
 * is how a test gets the link a technician would click. Like the user helpers, it refuses to
 * run unless Supabase is local, and it only talks to an address on this machine.
 */
const DEFAULT_MAIL_URL = "http://127.0.0.1:54324";

function mailUrl(): string {
  assertLocalSupabase(process.env);
  const base = process.env.E2E_MAIL_URL || DEFAULT_MAIL_URL;
  const { hostname } = new URL(base);
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error(`E2E_MAIL_URL must point to this machine, not to ${hostname}.`);
  }
  return base.replace(/\/+$/, "");
}

type MailpitSearch = { messages?: { ID: string }[] };
type MailpitMessage = { HTML?: string; Text?: string };

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `The mailbox answered ${response.status} for ${url}. Is the local Supabase running?`,
    );
  }
  return (await response.json()) as T;
}

/**
 * The confirm link in the HTML or text of an invitation mail, with HTML entities in the URL
 * undone (`&amp;` is how the mail writes `&`). `undefined` when the mail has no such link.
 */
export function extractConfirmLink(message: MailpitMessage): string | undefined {
  const html = message.HTML ?? "";
  const fromHref = /href="([^"]*\/auth\/confirm\?[^"]*)"/.exec(html)?.[1];
  const fromText = /https?:\/\/[^\s"<>\])]*\/auth\/confirm\?[^\s"<>\])]*/.exec(
    message.Text ?? "",
  )?.[0];
  return (fromHref ?? fromText)?.replaceAll("&amp;", "&");
}

/**
 * Waits until `count` mails for this address have arrived and returns the confirm link of
 * each, newest first. Throws after the timeout, so a mail that never comes fails the test
 * with a clear message instead of hanging.
 */
export async function waitForConfirmLinks(
  email: string,
  count = 1,
  timeoutMs = 30_000,
): Promise<string[]> {
  const base = mailUrl();
  const deadline = Date.now() + timeoutMs;
  const query = encodeURIComponent(`to:"${email}"`);

  for (;;) {
    const found = await getJson<MailpitSearch>(`${base}/api/v1/search?query=${query}`);
    const ids = (found.messages ?? []).map((message) => message.ID);
    if (ids.length >= count) {
      const links: string[] = [];
      for (const id of ids) {
        const link = extractConfirmLink(
          await getJson<MailpitMessage>(`${base}/api/v1/message/${id}`),
        );
        if (!link) {
          throw new Error(`The mail ${id} for ${email} has no link to /auth/confirm.`);
        }
        links.push(link);
      }
      return links;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Expected ${count} mail(s) for ${email} within ${timeoutMs} ms, found ${ids.length}.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
