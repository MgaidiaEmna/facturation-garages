"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";

/**
 * Actions de l'espace administrateur qui ne touchent pas aux comptes Auth.
 * Celles qui en touchent vivent dans `src/lib/auth/admin-actions.ts`, avec le
 * commentaire sur la clé service role.
 */

/**
 * Marque tout le journal comme lu.
 *
 * `read_at` est la SEULE colonne modifiable d'une notification : le trigger
 * `admin_notifications_guard_trg` refuse toute réécriture du contenu. Un
 * journal d'audit se lit, il ne se corrige pas.
 */
export async function markNotificationsReadAction(): Promise<void> {
  await requireAdmin();

  const supabase = await createClient();
  await supabase
    .from("admin_notifications")
    .update({ read_at: new Date().toISOString() })
    .is("read_at", null);

  revalidatePath("/admin/notifications");
  revalidatePath("/admin");
}
