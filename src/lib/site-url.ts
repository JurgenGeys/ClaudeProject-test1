import { CONFIRM_PATH } from "@/lib/auth/routes";

/** The `SITE_URL` setting is missing or not usable. The message is safe to log: it holds no secret. */
export class SiteUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SiteUrlError";
  }
}

const LOCAL_HOSTNAMES = ["localhost", "127.0.0.1"];

/**
 * The public address of the application (`SITE_URL`, for example `https://planning.frisair.be`),
 * as an origin without a path or trailing slash. Links that leave the application (the
 * invitation mail) are built from this setting and never from the `Host` header of a request:
 * that header is supplied by the visitor, so using it would let anybody make us send a mail
 * with a link to a site of their own (host header injection).
 *
 * It is read on the server only, at the moment it is needed, so it is not part of the build
 * and not visible in the browser. Plain `http` is only accepted for a local address.
 */
export function getSiteUrl(env: Record<string, string | undefined> = process.env): string {
  const value = env.SITE_URL?.trim();
  if (!value) {
    throw new SiteUrlError(
      "SITE_URL is not set. Set it to the public address of the application, for example " +
        "http://localhost:3000 (see .env.example).",
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SiteUrlError("SITE_URL is not a valid URL, for example http://localhost:3000.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new SiteUrlError("SITE_URL must start with https:// (or http:// for a local address).");
  }
  if (url.protocol === "http:" && !LOCAL_HOSTNAMES.includes(url.hostname)) {
    throw new SiteUrlError("SITE_URL must use https:// for anything but a local address.");
  }
  if (url.username || url.password) {
    throw new SiteUrlError("SITE_URL must not contain a user name or password.");
  }
  return url.origin;
}

/**
 * Where the link in the invitation mail points to: `<SITE_URL>/auth/confirm`. Supabase only
 * accepts it when it is in the list of allowed redirect URLs of the project (see the README).
 */
export function getInviteRedirectUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  return `${getSiteUrl(env)}${CONFIRM_PATH}`;
}
