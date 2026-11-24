import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

/** Next.js 16 name for what used to be `middleware.ts`. See `src/lib/supabase/proxy.ts`. */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except the Next.js build output and the favicon. The `public/` folder is
    // empty; when files are put there, list them here explicitly (a pattern such as "every
    // path ending in .png" would also skip a page route that happens to end like that).
    "/((?!_next/static/|_next/image|favicon\\.ico$).*)",
  ],
};
