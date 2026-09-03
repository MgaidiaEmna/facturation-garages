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
  const { url, anonKey } = requireSupabaseEnv();
  const cookieStore = await cookies();

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
