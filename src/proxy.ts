import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Proxy Next.js (ex-middleware) : rafraîchit la session Supabase à chaque
 * requête. La protection des routes par rôle sera branchée ici en phase 2.
 */
export default async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Toutes les routes sauf les fichiers statiques et les images :
     * inutile de rafraîchir la session pour un asset.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
