"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireGarage } from "@/lib/auth/session";
import { fieldErrorsOf } from "@/lib/validation/fields";
import {
  extensionPour,
  logoIdSchema,
  logoLabelSchema,
  logoUploadSchema,
  MESSAGE_TAILLE,
  MESSAGE_TYPE,
} from "./schema";

/**
 * Bibliothèque de logos : téléversement, libellé, défaut, suppression.
 *
 * ---------------------------------------------------------------------------
 * LE TÉLÉVERSEMENT PASSE PAR LA SESSION, JAMAIS PAR LA CLÉ SERVICE ROLE
 * ---------------------------------------------------------------------------
 * `createClient()` porte le JWT de la personne connectée : les policies du
 * bucket s'appliquent donc à chaque appel, et c'est le premier segment du
 * chemin (`{garage_id}/`) qui décide. Téléverser avec la clé service role
 * écrirait n'importe où sans qu'aucune barrière ne s'y oppose — la sécurité
 * reposerait alors uniquement sur le fait que ce fichier calcule le bon
 * chemin, ce qui n'est pas une barrière mais une espérance.
 *
 * `verify:logos` éprouve ces policies avec de VRAIS appels au service de
 * stockage, et non sur un stub SQL.
 *
 * ---------------------------------------------------------------------------
 * D'OÙ VIENT LE CHEMIN
 * ---------------------------------------------------------------------------
 * `{garage_id}/{uuid}.{png|jpg}`. Le garage vient de `profiles`, le nom du
 * fichier est tiré au sort, et l'extension est déduite du type MIME VALIDÉ —
 * jamais du nom envoyé par le navigateur, qui peut contenir des séparateurs de
 * chemin ou mentir sur le contenu.
 */

export interface LogoFormState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  savedAt?: number;
}

function motifLectureSeule(actif: boolean): string {
  return actif
    ? "Votre abonnement a expiré : votre espace est en lecture seule. Contactez l'administrateur pour le renouveler."
    : "Ce compte est désactivé : l'enregistrement est impossible. Contactez l'administrateur.";
}

/**
 * Téléverse le fichier puis crée la ligne.
 *
 * Dans cet ordre : un fichier sans ligne est un orphelin invisible, une ligne
 * sans fichier est une vignette cassée à l'écran. Si l'insertion échoue, le
 * fichier est retiré — on ne laisse pas de trace d'une opération qui n'a pas
 * abouti.
 */
async function televerser(
  supabase: Awaited<ReturnType<typeof createClient>>,
  garageId: string,
  file: File,
  label: string | null,
  premierParDefaut: boolean,
): Promise<LogoFormState> {
  const chemin = `${garageId}/${randomUUID()}.${extensionPour(file.type)}`;

  const { error: erreurFichier } = await supabase.storage
    .from("logos")
    .upload(chemin, file, { contentType: file.type, upsert: false });

  if (erreurFichier) {
    // Le bucket a le dernier mot sur la taille et le format. Ses messages sont
    // techniques (« The object exceeded the maximum allowed size ») : on les
    // traduit dans les MÊMES phrases que le navigateur et zod, pour qu'un seul
    // problème n'ait pas trois formulations.
    const brut = erreurFichier.message.toLowerCase();
    if (brut.includes("exceed") || brut.includes("too large") || brut.includes("size")) {
      return { fieldErrors: { file: [MESSAGE_TAILLE] } };
    }
    if (brut.includes("mime") || brut.includes("type")) {
      return { fieldErrors: { file: [MESSAGE_TYPE] } };
    }
    return { error: `Téléversement impossible : ${erreurFichier.message}` };
  }

  const { error: erreurLigne } = await supabase
    .from("logos")
    .insert({
      garage_id: garageId,
      storage_path: chemin,
      label,
      is_default: premierParDefaut,
    })
    .select("id")
    .maybeSingle();

  if (erreurLigne) {
    await supabase.storage.from("logos").remove([chemin]);
    return { error: `Enregistrement impossible : ${erreurLigne.message}` };
  }

  return { savedAt: Date.now() };
}

/** Le garage a-t-il déjà un logo par défaut ? */
async function aUnDefaut(
  supabase: Awaited<ReturnType<typeof createClient>>,
  garageId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("logos")
    .select("id")
    .eq("garage_id", garageId)
    .eq("is_default", true)
    .maybeSingle();
  return Boolean(data);
}

// ---------------------------------------------------------------------------
// Espace garage — réservé aux comptes « premium »
// ---------------------------------------------------------------------------

/**
 * Téléverse un logo dans la bibliothèque du garage courant.
 *
 * Le drapeau premium n'est pas vérifié ici : `logos_write` et les policies du
 * bucket exigent `can_manage_logos()`, et un garage standard est refusé par
 * la base quel que soit le chemin d'écriture. Ce qui est vérifié ici, c'est le
 * DROIT D'ÉCRIRE (abonnement) — pour dire ce qui se passe plutôt que de
 * laisser remonter un refus incompréhensible.
 */
export async function uploadLogoAction(
  _prevState: LogoFormState,
  formData: FormData,
): Promise<LogoFormState> {
  const context = await requireGarage();
  if (!context.access.canWrite) {
    return { error: motifLectureSeule(context.garage.isActive) };
  }

  const parsed = logoUploadSchema.safeParse({
    label: formData.get("label"),
    file: formData.get("file"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };

  const supabase = await createClient();
  const premier = !(await aUnDefaut(supabase, context.garage.id));

  const resultat = await televerser(
    supabase,
    context.garage.id,
    parsed.data.file,
    parsed.data.label,
    premier,
  );

  if (!resultat.error) {
    revalidatePath("/app/logos");
    revalidatePath("/app/factures");
  }
  return resultat;
}

/** Renomme un logo. Le libellé n'a aucun effet sur la facture : c'est un repère. */
export async function renameLogoAction(
  logoId: string,
  label: string,
): Promise<{ error?: string }> {
  const context = await requireGarage();
  if (!context.access.canWrite) {
    return { error: motifLectureSeule(context.garage.isActive) };
  }

  const parsed = logoLabelSchema.safeParse({ logoId, label });
  if (!parsed.success) return { error: "Libellé invalide." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("logos")
    .update({ label: parsed.data.label })
    .eq("id", parsed.data.logoId)
    .select("id")
    .maybeSingle();

  if (error) return { error: `Enregistrement impossible : ${error.message}` };
  if (!data) return { error: "Logo introuvable, ou modification refusée." };

  revalidatePath("/app/logos");
  return {};
}

/**
 * Désigne le logo par défaut.
 *
 * Passe par `set_default_logo()` : retirer le drapeau aux autres et le poser
 * sur celui-ci sont deux écritures, et l'index unique refuse l'état
 * intermédiaire. En deux appels PostgREST elles ne partagent aucune
 * transaction — un échec entre les deux laisserait le garage sans aucun logo
 * par défaut.
 */
export async function setDefaultLogoAction(
  logoId: string,
): Promise<{ error?: string }> {
  const context = await requireGarage();
  if (!context.access.canWrite) {
    return { error: motifLectureSeule(context.garage.isActive) };
  }

  const parsed = logoIdSchema.safeParse(logoId);
  if (!parsed.success) return { error: "Logo introuvable." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_default_logo", { p_logo_id: parsed.data });

  if (error) return { error: `Modification impossible : ${error.message}` };

  revalidatePath("/app/logos");
  revalidatePath("/app/factures");
  return {};
}

/**
 * Retire un logo de la bibliothèque.
 *
 * La LIGNE d'abord, le fichier ensuite : c'est la ligne dont la suppression
 * peut être refusée (`logos_guard_trg` la retient dès qu'une facture émise la
 * porte). L'inverse laisserait, en cas de refus, une ligne pointant vers un
 * fichier disparu — donc une facture émise avec un logo cassé.
 */
export async function deleteLogoAction(logoId: string): Promise<{ error?: string }> {
  const context = await requireGarage();
  if (!context.access.canWrite) {
    return { error: motifLectureSeule(context.garage.isActive) };
  }

  const parsed = logoIdSchema.safeParse(logoId);
  if (!parsed.success) return { error: "Logo introuvable." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("logos")
    .delete()
    .eq("id", parsed.data)
    .select("storage_path")
    .maybeSingle();

  // Le message du trigger explique pourquoi : on le laisse passer tel quel.
  if (error) return { error: error.message };
  if (!data) return { error: "Logo introuvable, ou suppression refusée." };

  await supabase.storage.from("logos").remove([String(data.storage_path)]);

  revalidatePath("/app/logos");
  revalidatePath("/app/factures");
  return {};
}

// ---------------------------------------------------------------------------
// Espace admin — le logo d'un garage standard
// ---------------------------------------------------------------------------

/**
 * Téléverse le logo d'un garage depuis sa fiche.
 *
 * C'est le SEUL chemin pour un garage standard : il ne gère pas ses logos
 * lui-même. L'administrateur est autorisé partout par les policies (`is_admin()`
 * dans le `with check` du bucket), donc rien n'est contourné ici — c'est la
 * même barrière, qui répond simplement « oui » à quelqu'un d'autre.
 */
export async function uploadLogoForGarageAction(
  garageId: string,
  formData: FormData,
): Promise<LogoFormState> {
  await requireAdmin();

  const identifiant = logoIdSchema.safeParse(garageId);
  if (!identifiant.success) return { error: "Garage introuvable." };

  const parsed = logoUploadSchema.safeParse({
    label: formData.get("label"),
    file: formData.get("file"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };

  const supabase = await createClient();
  const premier = !(await aUnDefaut(supabase, identifiant.data));

  const resultat = await televerser(
    supabase,
    identifiant.data,
    parsed.data.file,
    parsed.data.label,
    premier,
  );

  if (!resultat.error) revalidatePath(`/admin/garages/${identifiant.data}`);
  return resultat;
}

/** Retire un logo depuis la fiche admin. Mêmes garde-fous en base. */
export async function deleteLogoForGarageAction(
  garageId: string,
  logoId: string,
): Promise<{ error?: string }> {
  await requireAdmin();

  const parsed = logoIdSchema.safeParse(logoId);
  if (!parsed.success) return { error: "Logo introuvable." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("logos")
    .delete()
    .eq("id", parsed.data)
    .select("storage_path")
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: "Logo introuvable, ou suppression refusée." };

  await supabase.storage.from("logos").remove([String(data.storage_path)]);

  revalidatePath(`/admin/garages/${garageId}`);
  return {};
}

/** Désigne le logo par défaut d'un garage, depuis sa fiche. */
export async function setDefaultLogoForGarageAction(
  garageId: string,
  logoId: string,
): Promise<{ error?: string }> {
  await requireAdmin();

  const parsed = logoIdSchema.safeParse(logoId);
  if (!parsed.success) return { error: "Logo introuvable." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_default_logo", { p_logo_id: parsed.data });

  if (error) return { error: `Modification impossible : ${error.message}` };

  revalidatePath(`/admin/garages/${garageId}`);
  return {};
}
