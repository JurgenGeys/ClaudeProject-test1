import { LOGIN_MESSAGES } from "@/lib/auth/messages";

/** Shown when Supabase Auth cannot be reached. Not a redirect: the user is not "signed out". */
export function AuthUnavailable() {
  return (
    <main className="mx-auto w-full max-w-md flex-1 space-y-2 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Even niet beschikbaar</h1>
      <p role="alert">{LOGIN_MESSAGES.technicalProblem}</p>
    </main>
  );
}
