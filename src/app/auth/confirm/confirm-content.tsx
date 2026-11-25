import { redirect } from "next/navigation";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  SET_PASSWORD_ERROR_LINK,
  SET_PASSWORD_MODE_INVITE,
  SET_PASSWORD_PATH,
} from "@/lib/auth/routes";

import { confirmInvite } from "./actions";

const querySchema = z.object({
  token_hash: z.string().min(1).max(512),
  type: z.enum(["invite", "recovery"]),
});

/**
 * The page that the link in the invitation mail opens. It only explains and shows a button:
 * opening it (also by a mail scanner or a link preview) does not use the one-time token. The
 * token is checked when the button is pressed (`confirmInvite`). Without a usable token it
 * leads to the same "link is no longer valid" message as every other failure.
 */
export async function ConfirmContent({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = await searchParams;
  const parsed = querySchema.safeParse({ token_hash: query.token_hash, type: query.type });
  if (!parsed.success) {
    redirect(
      `${SET_PASSWORD_PATH}?mode=${SET_PASSWORD_MODE_INVITE}&error=${SET_PASSWORD_ERROR_LINK}`,
    );
  }

  return (
    <>
      <h1 className="mt-1 text-center text-2xl font-semibold tracking-tight">
        Welkom bij de planning
      </h1>
      <p className="mt-2 text-center text-muted-foreground">
        Je bent uitgenodigd om de planning te gebruiken. Druk op de knop om een wachtwoord te
        kiezen.
      </p>
      <Card className="mt-6 py-0 shadow-sm">
        <CardContent className="p-6">
          <form action={confirmInvite}>
            <input type="hidden" name="token_hash" value={parsed.data.token_hash} />
            <input type="hidden" name="type" value={parsed.data.type} />
            <Button type="submit" className="h-11 w-full text-base font-semibold">
              Wachtwoord instellen
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
