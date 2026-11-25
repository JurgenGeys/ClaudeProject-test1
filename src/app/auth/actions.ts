"use server";

import { redirect } from "next/navigation";

import { LOGIN_PATH } from "@/lib/auth/routes";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Signs the current user out and sends them to the login page. It does not call
 * `requireRole`: everyone, including a user whose account was just deactivated, must be
 * able to sign out. Only this browser's session ends (`scope: "local"`).
 */
export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect(LOGIN_PATH);
}
