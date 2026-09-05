"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
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
 * précédé d'un `requireAdmin()`.
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
