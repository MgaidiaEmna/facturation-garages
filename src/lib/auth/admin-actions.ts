"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { garageDeletionSchema } from "@/lib/admin/garage-schema";
import { createGarageAccountSchema } from "./password-policy";
import { requireAdmin } from "./session";
import type { AuthFormState } from "./actions";

/**
 * Actions réservées au super administrateur.
 *
 * ---------------------------------------------------------------------------
 * MOTS DE PASSE : CE QUE L'ADMIN VOIT, ET CE QU'IL NE VOIT JAMAIS
 * ---------------------------------------------------------------------------
 * · Un mot de passe CHOISI par un garage est invisible pour tout le monde,
 *   administrateur compris. Supabase Auth le hache ; il n'existe nulle part
 *   ailleurs. L'admin est seulement prévenu de l'ÉVÉNEMENT par une
 *   notification (« le garage X a modifié son mot de passe »).
 * · Un mot de passe TEMPORAIRE généré ici est affiché une fois à l'admin,
 *   parce qu'il doit le transmettre au garage. Il est jeté après usage : le
 *   garage doit le remplacer à sa connexion suivante
 *   (`must_change_password`). Il n'est ni journalisé, ni stocké, ni écrit
 *   dans une notification.
 *
 * Chaque appel à `createAdminClient()` (clé service role, hors RLS) est
 * précédé d'un `requireAdmin()`. Trois opérations l'exigent, toutes ici :
 * créer un compte Auth, en réinitialiser le mot de passe, et le supprimer
 * avec son garage — l'API `auth.admin` n'existe pas sous une autre clé.
 */

/** Alphabet sans caractères ambigus : ni O/0, ni I/l/1. Un mot de passe qui se dicte. */
const TEMP_PASSWORD_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const TEMP_PASSWORD_LENGTH = 16;

/**
 * Mot de passe temporaire. `randomInt` du module `node:crypto` :
 * `Math.random()` n'est pas cryptographique et n'a rien à faire ici.
 */
function generateTemporaryPassword(): string {
  let out = "";
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i++) {
    out += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
  }
  return out;
}

function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  return z.flattenError(error).fieldErrors as Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// Créer un compte garage (chemin ADMIN : sans vérification d'e-mail)
// ---------------------------------------------------------------------------

export interface CreateGarageAccountState extends AuthFormState {
  /** Nom du garage créé, pour l'accusé de réception. */
  createdGarageName?: string;
}

/**
 * L'admin fixe l'adresse et un mot de passe initial. Le compte Auth est créé
 * PRÉ-CONFIRMÉ (`email_confirm: true`) : pas de boucle de vérification, accès
 * immédiat. En contrepartie, `must_change_password` est posé à `true` — le
 * garage doit remplacer, dès sa première connexion, le mot de passe que
 * l'administrateur connaît.
 *
 * Les quatre écritures ne sont pas dans une transaction (Auth et Postgres
 * sont deux systèmes distincts) : chaque échec défait ce qui précède, pour ne
 * pas laisser un compte Auth orphelin ou un garage sans utilisateur.
 */
export async function createGarageAccountAction(
  _prevState: CreateGarageAccountState,
  formData: FormData,
): Promise<CreateGarageAccountState> {
  const admin = await requireAdmin();

  const parsed = createGarageAccountSchema.safeParse({
    garageName: formData.get("garageName"),
    fullName: formData.get("fullName") || undefined,
    email: formData.get("email"),
    password: formData.get("password"),
    subscriptionEndDate: formData.get("subscriptionEndDate"),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsOf(parsed.error) };
  }

  const supabase = await createClient();

  // 1. Le garage. Supprimable tant qu'aucune facture n'a été émise.
  const { data: garage, error: garageError } = await supabase
    .from("garages")
    .insert({
      name: parsed.data.garageName,
      email: parsed.data.email,
      locale: "FR",
      origin: "admin",
      account_status: "subscribed",
    })
    .select("id, name")
    .single();

  if (garageError || !garage) {
    return { error: `Création du garage impossible : ${garageError?.message ?? "erreur inconnue"}` };
  }

  // 2. Le compte Auth, pré-confirmé. Seul usage de la clé service role ici.
  const serviceRole = createAdminClient();
  const { data: created, error: userError } = await serviceRole.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    // `signup_source: 'admin'` interdit à ce compte de se provisionner
    // lui-même un garage d'essai via `provision_self_signup()`.
    user_metadata: { signup_source: "admin", full_name: parsed.data.fullName ?? null },
  });

  if (userError || !created?.user) {
    await supabase.from("garages").delete().eq("id", garage.id);
    const known = userError?.message?.toLowerCase().includes("already been registered")
      ? "Cette adresse e-mail est déjà associée à un compte."
      : (userError?.message ?? "erreur inconnue");
    return { fieldErrors: { email: [known] } };
  }

  // 3. Le profil : c'est LUI qui donne le rôle et rattache au garage.
  const { error: profileError } = await supabase.from("profiles").insert({
    id: created.user.id,
    role: "garage",
    garage_id: garage.id,
    full_name: parsed.data.fullName ?? parsed.data.garageName,
    // Le mot de passe initial est connu de l'administrateur : le garage doit
    // le remplacer avant toute autre chose.
    must_change_password: true,
  });

  if (profileError) {
    await serviceRole.auth.admin.deleteUser(created.user.id);
    await supabase.from("garages").delete().eq("id", garage.id);
    return { error: `Création du profil impossible : ${profileError.message}` };
  }

  // 4. L'abonnement initial (encaissement hors ligne). Le trigger
  // `subscriptions_end_trial_trg` confirme le statut « abonné ».
  const { error: subscriptionError } = await supabase.from("subscriptions").insert({
    garage_id: garage.id,
    end_date: parsed.data.subscriptionEndDate,
    updated_by: admin.userId,
  });

  if (subscriptionError) {
    return {
      createdGarageName: garage.name,
      error:
        `Compte créé, mais l'abonnement n'a pas pu être enregistré : ` +
        `${subscriptionError.message}. L'espace restera en lecture seule ` +
        `tant qu'il n'est pas défini.`,
    };
  }

  revalidatePath("/admin/comptes");
  return { createdGarageName: garage.name };
}

// ---------------------------------------------------------------------------
// Réinitialiser le mot de passe d'un compte garage
// ---------------------------------------------------------------------------

export interface ResetPasswordState extends AuthFormState {
  /**
   * Mot de passe temporaire, affiché UNE fois à l'administrateur pour qu'il
   * le transmette. Volontairement absent des journaux et des notifications.
   */
  temporaryPassword?: string;
  targetLabel?: string;
}

export async function resetGaragePasswordAction(
  _prevState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  await requireAdmin();

  const parsed = z
    .object({ userId: z.uuid("Compte introuvable.") })
    .safeParse({ userId: formData.get("userId") });

  if (!parsed.success) {
    return { error: "Compte introuvable." };
  }

  const supabase = await createClient();

  // Cible lue côté serveur : on ne fait pas confiance au libellé du
  // formulaire, et on refuse de réinitialiser un compte administrateur par
  // ce chemin.
  const { data: target, error: targetError } = await supabase
    .from("profiles")
    .select("id, role, full_name, garages(name, email)")
    .eq("id", parsed.data.userId)
    .maybeSingle();

  if (targetError || !target) {
    return { error: "Compte introuvable." };
  }
  if (target.role !== "garage") {
    return { error: "Cette action ne concerne que les comptes garages." };
  }

  const temporaryPassword = generateTemporaryPassword();

  const serviceRole = createAdminClient();
  const { error: updateError } = await serviceRole.auth.admin.updateUserById(target.id, {
    password: temporaryPassword,
  });
  if (updateError) {
    return { error: `Réinitialisation impossible : ${updateError.message}` };
  }

  // Changement forcé à la connexion suivante : le mot de passe temporaire est
  // passé de la main à la main, il ne doit pas durer.
  const { error: flagError } = await supabase
    .from("profiles")
    .update({ must_change_password: true })
    .eq("id", target.id);

  if (flagError) {
    return {
      error:
        "Mot de passe réinitialisé, mais le changement obligatoire n'a pas pu " +
        "être activé. Réessayez avant de transmettre le mot de passe.",
    };
  }

  // Journalise l'ÉVÉNEMENT. Le mot de passe temporaire n'y figure pas.
  await supabase.rpc("notify_password_reset", { p_user_id: target.id });

  const garage = Array.isArray(target.garages) ? target.garages[0] : target.garages;

  revalidatePath("/admin/comptes");
  return {
    temporaryPassword,
    targetLabel: garage?.name ?? target.full_name ?? "ce compte",
  };
}

// ---------------------------------------------------------------------------
// Supprimer un garage (et son compte de connexion)
// ---------------------------------------------------------------------------

export interface DeleteGarageState extends AuthFormState {
  /** Renseigné quand la confirmation saisie ne correspond pas au nom réel. */
  confirmMismatch?: boolean;
}

/**
 * Suppression définitive d'un garage.
 *
 * TROIS VERROUS, dont deux seulement sont dans ce fichier :
 *
 *  1. `garage_is_deletable()` — la base répond si le garage n'a émis AUCUNE
 *     facture. C'est la même règle que celle qu'appliquera de toute façon
 *     `invoices_guard_trg` en refusant la suppression en cascade : on
 *     l'interroge au lieu de la réécrire, pour que l'annonce et le refus ne
 *     divergent jamais.
 *  2. Le nom du garage doit être retapé à l'identique. Comparé au nom LU EN
 *     BASE — jamais à un nom transporté par le formulaire, qui viendrait du
 *     même navigateur que la confirmation et ne prouverait donc rien.
 *  3. Le RLS, qui refuserait l'UPDATE/DELETE à qui n'est pas administrateur
 *     même si `requireAdmin()` sautait.
 *
 * ORDRE DES OPÉRATIONS : le garage d'abord, le compte Auth ensuite. La
 * suppression du garage est celle qui peut échouer (garde-fou d'immuabilité,
 * RLS) ; si l'on détruisait les comptes Auth en premier, un échec ensuite
 * laisserait un garage vivant que plus personne ne pourrait ouvrir.
 *
 * Le compte Auth est supprimé pour ne pas laisser d'orphelin : il retiendrait
 * l'adresse e-mail en otage (« already been registered ») et pourrait encore
 * se connecter, pour atterrir sur un espace sans profil.
 */
export async function deleteGarageAction(
  _prevState: DeleteGarageState,
  formData: FormData,
): Promise<DeleteGarageState> {
  await requireAdmin();

  const parsed = garageDeletionSchema.safeParse({
    garageId: formData.get("garageId"),
    confirmName: formData.get("confirmName"),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsOf(parsed.error) };
  }

  const supabase = await createClient();

  const { data: garage, error: readError } = await supabase
    .from("garages")
    .select("id, name")
    .eq("id", parsed.data.garageId)
    .maybeSingle();

  if (readError || !garage) {
    return { error: "Garage introuvable." };
  }

  if (parsed.data.confirmName !== garage.name.trim()) {
    return {
      confirmMismatch: true,
      fieldErrors: {
        confirmName: [`Saisissez exactement « ${garage.name} » pour confirmer.`],
      },
    };
  }

  // Verrou 1 : la base a le dernier mot sur ce qui est effaçable.
  const { data: deletable, error: ruleError } = await supabase.rpc("garage_is_deletable", {
    g: garage.id,
  });

  if (ruleError) {
    return { error: `Vérification impossible : ${ruleError.message}` };
  }
  if (deletable !== true) {
    return {
      error:
        "Ce garage a émis au moins une facture : la conservation légale interdit " +
        "de l'effacer. Désactivez-le — son espace passera en lecture seule et " +
        "ses factures resteront consultables.",
    };
  }

  // Comptes à supprimer ensuite : lus AVANT, car la suppression du garage
  // efface les profils en cascade et l'information serait perdue.
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id")
    .eq("garage_id", garage.id);

  const userIds = (profiles ?? []).map((profile) => profile.id as string);

  // Fichiers du bucket privé : les lignes `logos` partent en cascade, pas les
  // objets stockés. Nettoyage au mieux — un fichier oublié ne doit pas faire
  // échouer la suppression, et le RLS de `storage.objects` autorise déjà
  // l'administrateur partout (pas besoin de la clé service role ici).
  const { data: storedFiles } = await supabase.storage.from("logos").list(garage.id);
  if (storedFiles?.length) {
    await supabase.storage
      .from("logos")
      .remove(storedFiles.map((file) => `${garage.id}/${file.name}`));
  }

  const { error: deleteError } = await supabase.from("garages").delete().eq("id", garage.id);

  if (deleteError) {
    return { error: `Suppression impossible : ${deleteError.message}` };
  }

  // Le garage n'existe plus : les comptes Auth restants sont orphelins.
  // `auth.admin` exige la clé service role — c'est le même usage que la
  // création et la réinitialisation, déjà précédé de `requireAdmin()`.
  const serviceRole = createAdminClient();
  const orphans: string[] = [];

  for (const userId of userIds) {
    const { error } = await serviceRole.auth.admin.deleteUser(userId);
    if (error) orphans.push(userId);
  }

  if (orphans.length > 0) {
    return {
      error:
        `Le garage « ${garage.name} » a bien été supprimé, mais ${orphans.length} ` +
        `compte(s) de connexion subsistent dans Supabase Auth. Supprimez-les ` +
        `depuis le tableau de bord Supabase pour libérer l'adresse e-mail.`,
    };
  }

  revalidatePath("/admin/garages");
  revalidatePath("/admin/comptes");
  revalidatePath("/admin");
  redirect(`/admin/garages?supprime=${encodeURIComponent(garage.name)}`);
}
