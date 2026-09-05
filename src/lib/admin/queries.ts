import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { GarageAccountStatus, GarageOrigin } from "@/lib/auth/types";

/**
 * Lectures de l'espace administrateur.
 *
 * Toutes passent par le client serveur SOUS RLS : c'est la policy
 * `is_admin()` qui autorise la vue globale, pas un filtre écrit ici. Un bug
 * dans ces requêtes ne peut donc pas ouvrir plus que le rôle ne permet.
 */

export interface GarageAccount {
  userId: string;
  fullName: string | null;
  mustChangePassword: boolean;
  garage: {
    id: string;
    name: string;
    email: string | null;
    isActive: boolean;
    accountStatus: GarageAccountStatus;
    origin: GarageOrigin;
    trialInvoicesUsed: number;
    trialInvoiceLimit: number;
  } | null;
  subscriptionEndDate: string | null;
}

export type AdminNotificationType =
  | "garage_signup"
  | "password_changed"
  | "password_reset_by_admin"
  | "trial_exhausted";

export interface AdminNotification {
  id: string;
  type: AdminNotificationType;
  message: string;
  createdAt: string;
  readAt: string | null;
  garageName: string | null;
}

/**
 * Déplie un embed PostgREST. Selon la cardinalité déduite des clés
 * étrangères, il arrive tantôt en objet, tantôt en tableau d'un élément.
 */
function one(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null;
  return (value as Record<string, unknown>) ?? null;
}

/** Comptes garages, avec leur statut commercial. */
export async function listGarageAccounts(): Promise<GarageAccount[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select(
      `id, full_name, must_change_password,
       garages ( id, name, email, is_active, account_status, origin,
                 trial_invoices_used, trial_invoice_limit,
                 subscriptions ( end_date ) )`,
    )
    .eq("role", "garage")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Lecture des comptes impossible : ${error.message}`);

  return (data ?? []).map((row): GarageAccount => {
    const garage = one(row.garages);
    const subscription = garage ? one(garage.subscriptions) : null;

    return {
      userId: row.id,
      fullName: row.full_name ?? null,
      mustChangePassword: Boolean(row.must_change_password),
      garage: garage
        ? {
            id: String(garage.id),
            name: String(garage.name),
            email: (garage.email as string | null) ?? null,
            isActive: Boolean(garage.is_active),
            accountStatus: garage.account_status as GarageAccountStatus,
            origin: garage.origin as GarageOrigin,
            trialInvoicesUsed: Number(garage.trial_invoices_used ?? 0),
            trialInvoiceLimit: Number(garage.trial_invoice_limit ?? 0),
          }
        : null,
      subscriptionEndDate: subscription ? String(subscription.end_date) : null,
    };
  });
}

/** Journal d'événements, du plus récent au plus ancien. */
export async function listAdminNotifications(limit = 50): Promise<AdminNotification[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("admin_notifications")
    .select("id, type, message, created_at, read_at, garages ( name )")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Lecture des notifications impossible : ${error.message}`);

  return (data ?? []).map((row): AdminNotification => {
    const garage = one(row.garages);
    return {
      id: row.id,
      type: row.type,
      message: row.message,
      createdAt: row.created_at,
      readAt: row.read_at ?? null,
      garageName: garage ? String(garage.name) : null,
    };
  });
}

/** Nombre de notifications non lues, pour la pastille du tableau de bord. */
export async function countUnreadNotifications(): Promise<number> {
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("admin_notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);

  if (error) return 0;
  return count ?? 0;
}
