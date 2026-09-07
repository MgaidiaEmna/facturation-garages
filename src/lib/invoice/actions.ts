"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { requireGarage } from "@/lib/auth/session";
import { DEFAULT_LOCALE, getLocale, type LocaleCode } from "@/lib/locale";
import { invoiceDraftSchema, type InvoiceDraftInput } from "./schema";

/**
 * Écritures de l'espace garage.
 *
 * Chaîne de vérification, dans l'ordre :
 *   1. `requireGarage()` — session, e-mail vérifié, rôle, mot de passe changé ;
 *   2. droit d'écrire (`access.canWrite`, calculé en base) ;
 *   3. validation zod ;
 *   4. RLS, qui refuserait de toute façon.
 *
 * Le `garage_id` n'apparaît nulle part dans ce fichier : c'est
 * `save_invoice_draft()` qui le lit dans `my_garage_id()`, côté serveur. Une
 * facture ne peut donc pas être créée pour le compte d'un autre garage, même
 * si l'appelant s'y employait.
 */

export interface DraftFormState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  /** Identifiant du brouillon enregistré, pour rediriger vers sa reprise. */
  invoiceId?: string;
  savedAt?: number;
}

/**
 * Enregistre un brouillon : création si `invoiceId` est absent, mise à jour
 * sinon.
 *
 * Aucun total n'est transmis. Ceux qu'affiche l'aperçu temps réel sont
 * indicatifs ; `save_invoice_draft()` les recalcule depuis les lignes, et
 * `finalize_invoice()` recommencera à l'émission.
 */
export async function saveInvoiceDraftAction(
  input: InvoiceDraftInput,
): Promise<DraftFormState> {
  const context = await requireGarage();

  // Lecture seule : abonnement échu ou compte désactivé. Le RLS refuserait
  // l'écriture, mais avec un message que personne ne peut comprendre —
  // autant dire ce qui se passe.
  if (!context.access.canWrite) {
    return {
      error: !context.garage.isActive
        ? "Ce compte est désactivé : l'enregistrement est impossible. Contactez l'administrateur."
        : "Votre abonnement a expiré : votre espace est en lecture seule. Contactez l'administrateur pour le renouveler.",
    };
  }

  const parsed = invoiceDraftSchema.safeParse(input);
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  }

  const draft = parsed.data;
  // `garages.locale` est un `text` en base pour rester ouvert aux pays à
  // venir ; le registre TypeScript, lui, est clos. On retombe sur la locale
  // par défaut plutôt que de planter sur une valeur inconnue.
  const localeCode = (context.garage.locale as LocaleCode) || DEFAULT_LOCALE;
  const locale = getLocale(localeCode);
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("save_invoice_draft", {
    p_invoice_id: draft.invoiceId ?? null,
    p_header: {
      client_name: draft.clientName,
      client_address: draft.clientAddress,
      client_phone: draft.clientPhone,
      client_vat_number: draft.clientVatNumber,
      issue_date: draft.issueDate,
      service_date: draft.serviceDate || null,
      notes: draft.notes,
    },
    // Les lignes vides ne sont pas envoyées ; la fonction SQL les écarte
    // également, pour que la règle tienne quel que soit l'appelant.
    p_lines: draft.lines
      .filter((line) => line.description.trim() !== "")
      .map((line) => ({
        description: line.description,
        unit: line.unit,
        quantity: line.quantity,
        unit_price_ht: line.unitPriceHt,
        vat_rate: line.vatRate,
      })),
    p_decimals: locale.decimals,
  });

  if (error) {
    return { error: `Enregistrement impossible : ${error.message}` };
  }

  const invoice = (Array.isArray(data) ? data[0] : data) as { id?: string } | null;

  revalidatePath("/app/factures");
  if (invoice?.id) revalidatePath(`/app/factures/${invoice.id}`);

  return { invoiceId: invoice?.id, savedAt: Date.now() };
}

/**
 * Supprime un brouillon.
 *
 * Aucune vérification d'appartenance écrite ici : `invoices_delete` ne laisse
 * passer que les factures du garage courant, et `invoices_guard_trg` refuse
 * la suppression d'une facture émise. Deux garde-fous en base valent mieux
 * qu'une condition recopiée dans l'application.
 */
export async function deleteInvoiceDraftAction(
  invoiceId: string,
): Promise<{ error?: string }> {
  await requireGarage();

  const parsed = z.uuid("Brouillon introuvable.").safeParse(invoiceId);
  if (!parsed.success) return { error: "Brouillon introuvable." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .delete()
    .eq("id", parsed.data)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();

  if (error) return { error: `Suppression impossible : ${error.message}` };
  if (!data) return { error: "Brouillon introuvable, ou déjà émis." };

  revalidatePath("/app/factures");
  return {};
}

/**
 * Émission d'une facture : le brouillon devient un document légal.
 *
 * ---------------------------------------------------------------------------
 * TOUT SE DÉCIDE EN BASE
 * ---------------------------------------------------------------------------
 * `finalize_invoice()` est `SECURITY DEFINER` : elle refait ses propres
 * contrôles (appartenance, statut, blocage commercial, mentions minimales),
 * recalcule les totaux depuis `invoice_lines` en `numeric` exact, appelle
 * `next_invoice_number()` et gèle `seller_snapshot` — le tout dans UNE
 * transaction. Cette action ne fait que l'appeler.
 *
 * Ce qui est vérifié ici l'est pour l'ERGONOMIE, pas pour la sécurité : dire
 * « essai terminé » avant le clic plutôt qu'après. La phrase affichée est
 * celle que la base produirait (`finalize_block_message()`, lue par
 * `my_access_state()`), pour qu'annonce et refus ne divergent jamais.
 *
 * Ni le numéro ni les totaux ne transitent par le navigateur : cette
 * fonction n'envoie qu'un identifiant de facture et le nombre de décimales
 * de la locale.
 */
export interface FinalizeState {
  error?: string;
  /** Numéro attribué par la base, à afficher tel quel. Jamais recalculé ici. */
  number?: string;
}

export async function finalizeInvoiceAction(invoiceId: string): Promise<FinalizeState> {
  const context = await requireGarage();

  // Essai épuisé, abonnement échu, compte désactivé : le motif ET la phrase
  // viennent de `finalize_block_reason()` / `finalize_block_message()`.
  if (context.access.finalizeBlockReason) {
    return {
      error:
        context.access.finalizeBlockMessage ??
        "L'émission de factures est suspendue pour ce compte.",
    };
  }

  const parsed = z.uuid("Facture introuvable.").safeParse(invoiceId);
  if (!parsed.success) return { error: "Facture introuvable." };

  const localeCode = (context.garage.locale as LocaleCode) || DEFAULT_LOCALE;
  const locale = getLocale(localeCode);
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("finalize_invoice", {
    p_invoice_id: parsed.data,
    // La connaissance des règles pays reste dans le TypeScript ; la base
    // arrondit avec ce qu'on lui donne.
    p_decimals: locale.decimals,
  });

  // Le message de refus vient de la base et se suffit à lui-même : le
  // reformuler ici, c'est risquer d'annoncer autre chose que ce qui s'est
  // réellement passé.
  if (error) return { error: error.message };

  const invoice = (Array.isArray(data) ? data[0] : data) as { number?: string } | null;

  revalidatePath("/app/factures");
  revalidatePath(`/app/factures/${parsed.data}`);
  // Le bandeau d'essai de l'espace change de compte : 2/3 devient 3/3.
  revalidatePath("/app");

  return { number: invoice?.number };
}
