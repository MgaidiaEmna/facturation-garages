"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { requireGarage } from "@/lib/auth/session";
import { fieldErrorsOf } from "@/lib/validation/fields";
import {
  clientIdSchema,
  clientSchema,
  serviceIdSchema,
  serviceSchema,
} from "./schema";

/**
 * Écritures du carnet de clients et du catalogue de prestations.
 *
 * Chaîne de vérification, dans cet ordre :
 *   1. `requireGarage()` — session, e-mail vérifié, profil, mot de passe
 *      changé, rôle ;
 *   2. droit d'écrire (`access.canWrite`, calculé en base) ;
 *   3. validation zod ;
 *   4. RLS, qui refuserait de toute façon.
 *
 * ---------------------------------------------------------------------------
 * D'OÙ VIENT LE `garage_id`
 * ---------------------------------------------------------------------------
 * De `context.garage.id`, c'est-à-dire de `profiles`, lu côté serveur par
 * `getAuthContext()`. JAMAIS du formulaire. `clients.garage_id` étant
 * `not null`, il faut bien l'écrire quelque part — et `clients_write` vérifie
 * de son côté que la valeur écrite est bien `my_garage_id()`. Deux barrières,
 * dont une seule est en TypeScript.
 *
 * Les mises à jour et les suppressions, elles, ne portent aucun filtre
 * d'appartenance : `.eq("id", …)` suffit, le RLS écarte les lignes des autres.
 * Recopier `garage_id = …` ici donnerait l'illusion que c'est ce filtre qui
 * protège, et masquerait le jour où la policy disparaîtrait.
 */

export interface CatalogFormState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  /** Identifiant de la ligne enregistrée — utile après une création. */
  id?: string;
  savedAt?: number;
}

/** Phrase de refus quand l'espace est en lecture seule. */
function motifLectureSeule(actif: boolean): string {
  return actif
    ? "Votre abonnement a expiré : votre espace est en lecture seule. Contactez l'administrateur pour le renouveler."
    : "Ce compte est désactivé : l'enregistrement est impossible. Contactez l'administrateur.";
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

/**
 * Crée un client, ou met à jour celui dont l'identifiant est fourni.
 *
 * Un seul point d'entrée pour les deux : le formulaire est le même, et deux
 * actions jumelles finiraient par valider différemment.
 */
export async function saveClientAction(
  _prevState: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const context = await requireGarage();
  if (!context.access.canWrite) {
    return { error: motifLectureSeule(context.garage.isActive) };
  }

  const parsed = clientSchema.safeParse({
    name: formData.get("name"),
    address: formData.get("address"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    vat_number: formData.get("vat_number"),
    siret: formData.get("siret"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };

  const brut = formData.get("clientId");
  const supabase = await createClient();

  if (brut) {
    const identifiant = clientIdSchema.safeParse(brut);
    if (!identifiant.success) return { error: "Client introuvable." };

    const { data, error } = await supabase
      .from("clients")
      .update(parsed.data)
      .eq("id", identifiant.data)
      .select("id")
      .maybeSingle();

    if (error) return { error: `Enregistrement impossible : ${error.message}` };
    if (!data) return { error: "Client introuvable, ou modification refusée." };

    revalidatePath("/app/clients");
    revalidatePath(`/app/clients/${identifiant.data}`);
    revalidatePath("/app/factures");
    return { id: identifiant.data, savedAt: Date.now() };
  }

  const { data, error } = await supabase
    .from("clients")
    .insert({ ...parsed.data, garage_id: context.garage.id })
    .select("id")
    .maybeSingle();

  if (error) return { error: `Enregistrement impossible : ${error.message}` };
  if (!data) return { error: "Création refusée." };

  revalidatePath("/app/clients");
  revalidatePath("/app/factures");
  return { id: String(data.id), savedAt: Date.now() };
}

/**
 * Supprime un client du carnet.
 *
 * Aucune facture n'en souffre : le nom, l'adresse et le n° de TVA sont
 * RECOPIÉS sur la facture au moment de la saisie, et `invoices.client_id`
 * n'est pas posé. Supprimer un client efface une commodité de saisie, pas une
 * pièce comptable.
 */
export async function deleteClientAction(clientId: string): Promise<{ error?: string }> {
  const context = await requireGarage();
  if (!context.access.canWrite) {
    return { error: motifLectureSeule(context.garage.isActive) };
  }

  const parsed = clientIdSchema.safeParse(clientId);
  if (!parsed.success) return { error: "Client introuvable." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clients")
    .delete()
    .eq("id", parsed.data)
    .select("id")
    .maybeSingle();

  if (error) return { error: `Suppression impossible : ${error.message}` };
  if (!data) return { error: "Client introuvable, ou suppression refusée." };

  revalidatePath("/app/clients");
  revalidatePath("/app/factures");
  return {};
}

/**
 * Enregistre au carnet un client saisi à la volée dans l'éditeur.
 *
 * Même validation et même chemin que le formulaire du carnet : c'est
 * `saveClientAction` avec un `FormData` construit ici. Une seconde
 * implémentation « allégée » serait une seconde occasion de laisser passer
 * quelque chose.
 */
export async function quickCreateClientAction(input: {
  name: string;
  address: string;
  phone: string;
  vatNumber: string;
}): Promise<CatalogFormState> {
  const formData = new FormData();
  formData.set("name", input.name);
  formData.set("address", input.address);
  formData.set("phone", input.phone);
  formData.set("vat_number", input.vatNumber);

  return saveClientAction({}, formData);
}

// ---------------------------------------------------------------------------
// Prestations
// ---------------------------------------------------------------------------

/** Crée une prestation, ou met à jour celle dont l'identifiant est fourni. */
export async function saveServiceAction(
  _prevState: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const context = await requireGarage();
  if (!context.access.canWrite) {
    return { error: motifLectureSeule(context.garage.isActive) };
  }

  const parsed = serviceSchema.safeParse({
    label: formData.get("label"),
    default_unit: formData.get("default_unit"),
    default_price_ht: formData.get("default_price_ht"),
    default_vat_rate: formData.get("default_vat_rate"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };

  const brut = formData.get("serviceId");
  const supabase = await createClient();

  if (brut) {
    const identifiant = serviceIdSchema.safeParse(brut);
    if (!identifiant.success) return { error: "Prestation introuvable." };

    const { data, error } = await supabase
      .from("services")
      .update(parsed.data)
      .eq("id", identifiant.data)
      .select("id")
      .maybeSingle();

    if (error) return { error: `Enregistrement impossible : ${error.message}` };
    if (!data) return { error: "Prestation introuvable, ou modification refusée." };

    revalidatePath("/app/prestations");
    revalidatePath(`/app/prestations/${identifiant.data}`);
    revalidatePath("/app/factures");
    return { id: identifiant.data, savedAt: Date.now() };
  }

  const { data, error } = await supabase
    .from("services")
    .insert({ ...parsed.data, garage_id: context.garage.id })
    .select("id")
    .maybeSingle();

  if (error) return { error: `Enregistrement impossible : ${error.message}` };
  if (!data) return { error: "Création refusée." };

  revalidatePath("/app/prestations");
  revalidatePath("/app/factures");
  return { id: String(data.id), savedAt: Date.now() };
}

/**
 * Supprime une prestation du catalogue.
 *
 * Les lignes de facture ne portent aucun lien vers le catalogue : elles ont
 * recopié désignation, unité, prix et taux. Une facture émise l'an dernier ne
 * change pas parce qu'on retire une prestation aujourd'hui.
 */
export async function deleteServiceAction(
  serviceId: string,
): Promise<{ error?: string }> {
  const context = await requireGarage();
  if (!context.access.canWrite) {
    return { error: motifLectureSeule(context.garage.isActive) };
  }

  const parsed = serviceIdSchema.safeParse(serviceId);
  if (!parsed.success) return { error: "Prestation introuvable." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("services")
    .delete()
    .eq("id", parsed.data)
    .select("id")
    .maybeSingle();

  if (error) return { error: `Suppression impossible : ${error.message}` };
  if (!data) return { error: "Prestation introuvable, ou suppression refusée." };

  revalidatePath("/app/prestations");
  revalidatePath("/app/factures");
  return {};
}
