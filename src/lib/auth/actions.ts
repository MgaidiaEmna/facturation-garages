"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import {
  RATE_LIMITS,
  clearRateLimit,
  clientIp,
  consumeRateLimit,
  rateLimitMessage,
  type RateLimitTarget,
} from "./rate-limit";
import {
  changePasswordSchema,
  loginSchema,
  signupSchema,
} from "./password-policy";
import { ROUTES, homeForRole, safeNextPath } from "./routes";
import { getAuthContext } from "./session";

/**
 * Actions d'authentification.
 *
 * Chacune refait, côté serveur et dans cet ordre : limitation de débit,
 * validation zod, appel à Supabase Auth. Le navigateur ne décide de rien —
 * l'UI ne fait que présenter le résultat.
 *
 * Aucun mot de passe n'est journalisé, mis en cache ou renvoyé dans un état
 * de formulaire. Il ne fait que traverser l'action jusqu'à Supabase Auth,
 * qui le hache.
 */

/** État renvoyé aux formulaires (`useActionState`). Jamais de secret dedans. */
export interface AuthFormState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

/**
 * Traduit les messages de Supabase Auth, qui sont en anglais et parfois
 * techniques.
 *
 * Sur la connexion, on ne distingue JAMAIS « adresse inconnue » de « mot de
 * passe faux » : cela transformerait le formulaire en oracle permettant de
 * savoir qui a un compte chez nous.
 */
function translateAuthError(message: string): string {
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid login credentials")) {
    return "Adresse e-mail ou mot de passe incorrect.";
  }
  if (normalized.includes("email not confirmed")) {
    return (
      "Adresse e-mail non vérifiée. Ouvrez le lien de confirmation que nous " +
      "vous avons envoyé, puis reconnectez-vous."
    );
  }
  if (normalized.includes("should be different from the old password")) {
    return "Le nouveau mot de passe doit être différent de l'ancien.";
  }
  if (normalized.includes("email rate limit") || normalized.includes("over_email_send_rate")) {
    return "Trop d'e-mails envoyés à cette adresse. Réessayez dans quelques minutes.";
  }
  if (normalized.includes("user not found") || normalized.includes("session")) {
    return "Session expirée. Reconnectez-vous.";
  }
  return message;
}

/** URL publique de l'application, pour construire les liens des e-mails. */
async function appUrl(): Promise<string> {
  if (publicEnv.NEXT_PUBLIC_APP_URL) return publicEnv.NEXT_PUBLIC_APP_URL;

  const h = await headers();
  const host = h.get("host");
  const protocol = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return host ? `${protocol}://${host}` : "http://localhost:3000";
}

function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const flat = z.flattenError(error);
  return flat.fieldErrors as Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// Connexion
// ---------------------------------------------------------------------------

export async function signInAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsOf(parsed.error) };
  }

  const targets: RateLimitTarget[] = [
    { scope: "login:email", identifier: parsed.data.email, rule: RATE_LIMITS.loginByEmail },
    { scope: "login:ip", identifier: await clientIp(), rule: RATE_LIMITS.loginByIp },
  ];

  const blockedUntil = await consumeRateLimit(targets);
  if (blockedUntil) {
    return { error: rateLimitMessage(blockedUntil) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { error: translateAuthError(error.message) };
  }

  // Réussite : le plafond vise les échecs répétés, pas l'usage normal.
  await clearRateLimit(targets);
  revalidatePath("/", "layout");

  // La destination dépend du rôle, du provisionnement et du mot de passe
  // initial : c'est la page d'accueil qui tranche, à partir du serveur.
  // `redirect()` lève : il doit rester hors de tout try/catch.
  const next = safeNextPath(formData.get("next")?.toString());
  redirect(next ? `${ROUTES.home}?next=${encodeURIComponent(next)}` : ROUTES.home);
}

// ---------------------------------------------------------------------------
// Inscription en ligne
// ---------------------------------------------------------------------------

export async function signUpAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signupSchema.safeParse({
    garageName: formData.get("garageName"),
    fullName: formData.get("fullName") || undefined,
    email: formData.get("email"),
    password: formData.get("password"),
    passwordConfirm: formData.get("passwordConfirm"),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsOf(parsed.error) };
  }

  const targets: RateLimitTarget[] = [
    { scope: "signup:email", identifier: parsed.data.email, rule: RATE_LIMITS.signupByEmail },
    { scope: "signup:ip", identifier: await clientIp(), rule: RATE_LIMITS.signupByIp },
  ];

  const blockedUntil = await consumeRateLimit(targets);
  if (blockedUntil) {
    return { error: rateLimitMessage(blockedUntil) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${await appUrl()}${ROUTES.authConfirm}`,
      // Étiquettes, pas des droits. Elles sont relues côté serveur par
      // `provision_self_signup()` ; le rôle et le statut d'essai y sont posés
      // en SQL, hors de portée du navigateur.
      data: {
        garage_name: parsed.data.garageName,
        full_name: parsed.data.fullName ?? parsed.data.garageName,
        signup_source: "self",
      },
    },
  });

  if (error) {
    return { error: translateAuthError(error.message) };
  }

  // Une session immédiate signifie que « Confirm email » est désactivé dans
  // le projet Supabase. L'inscription en ligne EXIGE la vérification : on
  // referme plutôt que de laisser entrer un compte non vérifié.
  if (data.session) {
    await supabase.auth.signOut();
    return {
      error:
        "Configuration incomplète : la vérification d'e-mail est désactivée sur " +
        "le projet Supabase. Activez « Confirm email » dans Authentication → " +
        "Providers → Email avant d'ouvrir les inscriptions.",
    };
  }

  // Adresse déjà inscrite : Supabase renvoie un utilisateur sans identité
  // plutôt qu'une erreur, pour ne pas révéler l'existence du compte. On
  // affiche exactement le même écran, sans rien laisser deviner.
  redirect(`${ROUTES.signupVerification}?email=${encodeURIComponent(parsed.data.email)}`);
}

// ---------------------------------------------------------------------------
// Changement de mot de passe
// ---------------------------------------------------------------------------

/**
 * Sert les deux cas : le changement obligatoire à la première connexion
 * (compte créé par l'admin, ou mot de passe réinitialisé) et le changement
 * volontaire.
 *
 * L'administrateur est prévenu par une NOTIFICATION décrivant l'événement —
 * jamais la valeur du mot de passe, qu'aucune partie de l'application ne
 * conserve.
 */
export async function changePasswordAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const context = await getAuthContext();
  if (!context) redirect(ROUTES.login);

  const blockedUntil = await consumeRateLimit([
    {
      scope: "password:change",
      identifier: context.userId,
      rule: RATE_LIMITS.passwordChange,
    },
  ]);
  if (blockedUntil) {
    return { error: rateLimitMessage(blockedUntil) };
  }

  const parsed = changePasswordSchema.safeParse({
    password: formData.get("password"),
    passwordConfirm: formData.get("passwordConfirm"),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsOf(parsed.error) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { error: translateAuthError(error.message) };
  }

  // Lève `must_change_password` et notifie l'administrateur. Seul chemin
  // possible : un UPDATE direct sur le drapeau est refusé par
  // `profiles_guard_trg`.
  const { error: rpcError } = await supabase.rpc("complete_password_change");
  if (rpcError) {
    return {
      error:
        "Mot de passe modifié, mais la confirmation n'a pas pu être enregistrée. " +
        "Reconnectez-vous ; si le problème persiste, contactez l'administrateur.",
    };
  }

  revalidatePath("/", "layout");
  redirect(context.role ? homeForRole(context.role) : ROUTES.home);
}

// ---------------------------------------------------------------------------
// Déconnexion
// ---------------------------------------------------------------------------

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect(ROUTES.login);
}

// ---------------------------------------------------------------------------
// Rattrapage d'un provisionnement raté
// ---------------------------------------------------------------------------

/**
 * Relance `provision_self_signup()` pour une inscription en ligne dont la
 * création du garage a échoué après la vérification de l'e-mail (erreur
 * réseau, base momentanément indisponible).
 *
 * Sans ce rattrapage, la personne est dans une impasse : son adresse est
 * vérifiée, sa session valide, mais aucun profil ne la rattache à un garage —
 * et le lien de confirmation, à usage unique, ne peut plus être rejoué.
 *
 * La fonction SQL est idempotente et refuse tout compte dépourvu du marqueur
 * `signup_source = 'self'` : ce bouton ne crée donc rien qui n'ait déjà été
 * demandé lors de l'inscription.
 */
export async function retryProvisioningAction(
  _prevState: AuthFormState,
): Promise<AuthFormState> {
  const context = await getAuthContext();
  if (!context) redirect(ROUTES.login);

  const supabase = await createClient();
  const { error } = await supabase.rpc("provision_self_signup");

  if (error) {
    return {
      error:
        "Impossible de rattacher ce compte à un garage. Contactez l'administrateur " +
        "en lui indiquant votre adresse e-mail.",
    };
  }

  revalidatePath("/", "layout");
  redirect(ROUTES.home);
}
