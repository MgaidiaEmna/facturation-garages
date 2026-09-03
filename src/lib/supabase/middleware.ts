import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isSupabaseConfigured, requireSupabaseEnv } from "@/lib/env";

/**
 * Rafraîchit la session Supabase à chaque requête et propage les cookies mis à
 * jour vers la réponse. Sans cela, le token d'accès expire et les Server
 * Components voient un utilisateur déconnecté.
 *
 * Phase 2 branchera ici la redirection par rôle (`/admin` vs `/app`).
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Tant que Supabase n'est pas configuré, on laisse simplement passer.
  if (!isSupabaseConfigured()) return response;

  const { url, anonKey } = requireSupabaseEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // `getUser()` (et non `getSession()`) : il revalide le token auprès du
  // serveur Auth. Ne jamais faire confiance à un JWT non revalidé.
  await supabase.auth.getUser();

  return response;
}
