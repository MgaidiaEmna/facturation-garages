"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/session";
import {
  garageFlagSchema,
  garageIdSchema,
  garageIdentitySchema,
} from "@/lib/admin/garage-schema";
import { registerPaymentSchema } from "@/lib/admin/payment-schema";

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

// ---------------------------------------------------------------------------
// Fiches garages (phase 3)
// ---------------------------------------------------------------------------
//
// Toutes ces actions écrivent par le client serveur SOUS RLS : c'est la
// policy `garages_admin_write` (`is_admin()`) qui autorise, pas le
// `requireAdmin()` qui la précède. Le garde applicatif sert à rediriger
// proprement et à ne pas tenter une écriture vouée au refus ; s'il sautait,
// la base refuserait quand même.

/** État renvoyé au formulaire de fiche garage. Jamais de secret dedans. */
export interface GarageFormState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  /** Horodatage du dernier enregistrement réussi : rejoue l'accusé de réception. */
  savedAt?: number;
}

function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  return z.flattenError(error).fieldErrors as Record<string, string[]>;
}

/** Rafraîchit la liste ET la fiche : les deux montrent les mêmes valeurs. */
function revalidateGarage(garageId: string): void {
  revalidatePath("/admin/garages");
  revalidatePath(`/admin/garages/${garageId}`);
  revalidatePath("/admin/comptes");
  revalidatePath("/admin");
}

/**
 * Enregistre l'identité légale, le contact et les conditions de règlement.
 *
 * Le `garageId` vient du formulaire, donc du navigateur — mais il ne donne
 * aucun pouvoir : sans `is_admin()`, la policy filtre la ligne et l'UPDATE
 * touche zéro ligne. On vérifie tout de même que la fiche existe, pour
 * distinguer « garage inconnu » d'un enregistrement silencieux.
 *
 * Les clés du schéma zod sont les noms des colonnes : le résultat du parse
 * part tel quel dans `update()`. Aucune valeur non validée n'y entre.
 */
export async function updateGarageAction(
  _prevState: GarageFormState,
  formData: FormData,
): Promise<GarageFormState> {
  await requireAdmin();

  const identifier = garageIdSchema.safeParse({ garageId: formData.get("garageId") });
  if (!identifier.success) {
    return { error: "Garage introuvable." };
  }

  const parsed = garageIdentitySchema.safeParse({
    name: formData.get("name"),
    legal_form: formData.get("legal_form"),
    siret: formData.get("siret"),
    vat_number: formData.get("vat_number"),
    rcs_city: formData.get("rcs_city"),
    capital: formData.get("capital"),
    address: formData.get("address"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    iban: formData.get("iban"),
    bic: formData.get("bic"),
    vat_exempt: formData.get("vat_exempt"),
    payment_term_days: formData.get("payment_term_days"),
    late_payment_penalty_rate: formData.get("late_payment_penalty_rate"),
    recovery_indemnity: formData.get("recovery_indemnity"),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsOf(parsed.error) };
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("garages")
    .update(parsed.data)
    .eq("id", identifier.data.garageId)
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: `Enregistrement impossible : ${error.message}` };
  }
  if (!data) {
    return { error: "Garage introuvable, ou modification refusée." };
  }

  revalidateGarage(identifier.data.garageId);
  return { savedAt: Date.now() };
}

/**
 * Active ou désactive un garage.
 *
 * `is_active = false` n'est pas cosmétique : `has_write_access()` s'appuie
 * dessus, donc l'espace du garage repasse en lecture seule et
 * `finalize_invoice()` refuse d'émettre. C'est l'opération à préférer à une
 * suppression dès qu'une facture a été émise.
 */
export async function setGarageActiveAction(
  garageId: string,
  enabled: boolean,
): Promise<{ error?: string }> {
  await requireAdmin();

  const parsed = garageFlagSchema.safeParse({ garageId, enabled });
  if (!parsed.success) return { error: "Garage introuvable." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("garages")
    .update({ is_active: parsed.data.enabled })
    .eq("id", parsed.data.garageId)
    .select("id")
    .maybeSingle();

  if (error) return { error: `Modification impossible : ${error.message}` };
  if (!data) return { error: "Garage introuvable, ou modification refusée." };

  revalidateGarage(parsed.data.garageId);
  return {};
}

/**
 * Bascule le drapeau « premium » (`logo_management_enabled`).
 *
 * Ce n'est PAS un rôle : c'est un booléen porté par le garage, et c'est lui
 * que consulte `can_manage_logos()` dans la policy d'écriture des logos.
 * L'abaisser referme la bibliothèque de logos à la requête suivante, sans
 * toucher au reste des droits.
 */
export async function setLogoManagementAction(
  garageId: string,
  enabled: boolean,
): Promise<{ error?: string }> {
  await requireAdmin();

  const parsed = garageFlagSchema.safeParse({ garageId, enabled });
  if (!parsed.success) return { error: "Garage introuvable." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("garages")
    .update({ logo_management_enabled: parsed.data.enabled })
    .eq("id", parsed.data.garageId)
    .select("id")
    .maybeSingle();

  if (error) return { error: `Modification impossible : ${error.message}` };
  if (!data) return { error: "Garage introuvable, ou modification refusée." };

  revalidateGarage(parsed.data.garageId);
  return {};
}

// ---------------------------------------------------------------------------
// Abonnements et paiements (phase 4)
// ---------------------------------------------------------------------------

export interface PaymentFormState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  /** Horodatage du dernier enregistrement réussi : rejoue l'accusé de réception. */
  savedAt?: number;
  /** Nouvelle échéance, telle que la base l'a calculée — pas telle qu'on l'espérait. */
  newEndDate?: string;
}

/**
 * Consigne un encaissement hors ligne et prolonge l'abonnement.
 *
 * L'action ne calcule RIEN : elle valide la saisie, puis passe la main à
 * `register_payment()`, qui écrit dans `payments` et `subscriptions` sous une
 * seule transaction et décide seule de la nouvelle échéance. C'est aussi elle
 * qui refait le contrôle `is_admin()` — `requireAdmin()` ici sert à rediriger
 * proprement, pas à autoriser.
 *
 * La date renvoyée à l'écran est celle que la base a retenue. Recalculer la
 * même chose en TypeScript pour l'afficher, c'est se donner deux vérités et
 * attendre qu'elles divergent.
 */
export async function registerPaymentAction(
  _prevState: PaymentFormState,
  formData: FormData,
): Promise<PaymentFormState> {
  await requireAdmin();

  const parsed = registerPaymentSchema.safeParse({
    garageId: formData.get("garageId"),
    amount: formData.get("amount"),
    method: formData.get("method"),
    paidOn: formData.get("paidOn"),
    notes: formData.get("notes"),
    months: formData.get("months"),
    endDate: formData.get("endDate"),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsOf(parsed.error) };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("register_payment", {
    p_garage_id: parsed.data.garageId,
    p_amount: parsed.data.amount ?? null,
    p_method: parsed.data.method,
    p_paid_on: parsed.data.paidOn,
    p_notes: parsed.data.notes ?? null,
    p_months: parsed.data.months ?? null,
    p_end_date: parsed.data.endDate ?? null,
  });

  if (error) {
    return { error: `Enregistrement impossible : ${error.message}` };
  }

  const subscription = (Array.isArray(data) ? data[0] : data) as
    | { end_date?: string }
    | null;

  revalidateGarage(parsed.data.garageId);
  return { savedAt: Date.now(), newEndDate: subscription?.end_date };
}
