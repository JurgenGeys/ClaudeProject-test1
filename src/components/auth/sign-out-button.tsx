import { signOut } from "@/app/auth/actions";

/** "Uitloggen" (not "Afmelden": that word is used for finishing a task). Works without JavaScript. */
export function SignOutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="inline-flex h-11 items-center rounded-md px-3 text-sm font-medium underline underline-offset-4 hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        Uitloggen
      </button>
    </form>
  );
}
