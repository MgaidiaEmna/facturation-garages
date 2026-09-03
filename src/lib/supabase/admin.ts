import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseEnv } from "@/lib/env";

/**
 * Client Supabase avec la SERVICE ROLE KEY : il CONTOURNE le RLS.
 *
 * Usage strictement limité aux opérations d'administration qui ne peuvent pas
 * passer par le RLS — en pratique : créer le compte Auth d'un garage depuis
 * l'espace super admin, et le script de seed.
 *
 * Règle : tout appel à ce client doit être précédé d'une vérification
 * explicite que l'appelant est bien `super_admin`. Le module `server-only`
 * garantit qu'il ne peut jamais être importé dans un bundle navigateur.
 */
export function createAdminClient() {
  const { url } = requireSupabaseEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY manquante : requise pour les opérations d'administration.",
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
