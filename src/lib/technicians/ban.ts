import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * How long the Auth server gets to answer a change of the block. The change runs inside a database
 * transaction that holds a row lock, so a hanging Auth server must not keep that lock for long.
 */
export const AUTH_BAN_TIMEOUT_MS = 5_000;

/** The Auth server did not answer in time. The change may or may not have been applied. */
export class AuthTimeoutError extends Error {
  constructor() {
    super("The Auth server did not answer in time");
    this.name = "AuthTimeoutError";
  }
}

/** The Auth server did not accept the change of the block. */
export class BanFailedError extends Error {
  constructor(readonly cause: unknown) {
    super("Changing the block of the Auth account failed");
    this.name = "BanFailedError";
  }
}

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

/**
 * Sets (`"87600h"`) or lifts (`"none"`) the block of an Auth account. Idempotent: setting the same
 * value again changes nothing. Throws `BanFailedError` when Auth refuses and `AuthTimeoutError`
 * when it does not answer within `AUTH_BAN_TIMEOUT_MS`.
 */
export async function changeAuthBan(
  admin: AdminClient,
  userId: string,
  banDuration: string,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new AuthTimeoutError()), AUTH_BAN_TIMEOUT_MS);
  });
  try {
    const { error } = await Promise.race([
      admin.auth.admin.updateUserById(userId, { ban_duration: banDuration }),
      timeout,
    ]);
    if (error) {
      throw new BanFailedError(error);
    }
  } finally {
    clearTimeout(timer);
  }
}
