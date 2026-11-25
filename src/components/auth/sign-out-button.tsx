import { signOut } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";

/** "Uitloggen" (not "Afmelden": that word is used for finishing a task). Works without JavaScript. */
export function SignOutButton() {
  return (
    <form action={signOut}>
      <Button type="submit" variant="ghost" className="h-11 px-3 underline underline-offset-4">
        Uitloggen
      </Button>
    </form>
  );
}
