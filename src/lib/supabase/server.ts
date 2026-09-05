import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { requireSupabaseEnv } from "@/lib/env";

/**
 * Client Supabase pour Server Components, Server Actions et Route Handlers.
 * Agit au nom de l'utilisateur connecté : le RLS s'applique intégralement.
 *
 * C'est le client à utiliser par défaut côté serveur. `createAdminClient()`
 * (service role) est réservé aux opérations d'administration.
 */
export async function createClient() {
  // `cookies()` en PREMIER, avant toute validation susceptible de lever :
  // c'est cet appel qui marque la route comme dynamique. Valider
  // l'environnement d'abord ferait échouer le prérendu au build au lieu de
  // simplement rendre la page dynamique.
  const cookieStore = await cookies();
  const { url, anonKey } = requireSupabaseEnv();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Appelé depuis un Server Component : l'écriture de cookies y est
          // interdite. Le middleware rafraîchit déjà la session, on ignore.
        }
      },
    },
  });
}
