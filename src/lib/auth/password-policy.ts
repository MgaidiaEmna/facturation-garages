import { z } from "zod";

/**
 * Politique de mot de passe et schémas de saisie.
 *
 * Aucune dépendance serveur : les formulaires peuvent réutiliser ces schémas
 * pour un retour immédiat. La validation qui compte reste celle des Server
 * Actions — le navigateur n'est jamais la barrière.
 *
 * L'application ne voit un mot de passe qu'en transit, le temps de le
 * transmettre à Supabase Auth qui le hache. Rien n'est stocké, journalisé,
 * ni envoyé à l'administrateur.
 */

/**
 * 12 caractères minimum. Pas de règle de composition : imposer
 * « une majuscule, un chiffre, un symbole » produit surtout des « Garage2024! »
 * — la longueur protège davantage qu'un alphabet forcé.
 */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * 72 octets maximum : c'est la limite de bcrypt, l'algorithme de Supabase
 * Auth. Au-delà, la fin du mot de passe est silencieusement ignorée — mieux
 * vaut le dire que le laisser croire.
 */
export const PASSWORD_MAX_LENGTH = 72;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Le mot de passe doit faire au moins ${PASSWORD_MIN_LENGTH} caractères.`)
  .max(PASSWORD_MAX_LENGTH, `Le mot de passe ne peut pas dépasser ${PASSWORD_MAX_LENGTH} caractères.`);

export const emailSchema = z
  .email("Adresse e-mail invalide.")
  .max(254, "Adresse e-mail trop longue.")
  .transform((value) => value.trim().toLowerCase());

/**
 * Connexion : on ne valide PAS la longueur du mot de passe saisi. La
 * politique s'applique aux mots de passe qu'on crée, pas à ceux qu'on
 * vérifie — sinon un compte plus ancien ne pourrait plus se connecter pour
 * aller justement changer le sien.
 */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Mot de passe requis."),
});

export const signupSchema = z
  .object({
    garageName: z
      .string()
      .trim()
      .min(2, "Le nom du garage est obligatoire.")
      .max(120, "Nom trop long (120 caractères maximum)."),
    fullName: z.string().trim().max(120, "Nom trop long.").optional(),
    email: emailSchema,
    password: passwordSchema,
    passwordConfirm: z.string(),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: "Les deux mots de passe ne correspondent pas.",
    path: ["passwordConfirm"],
  });

export const changePasswordSchema = z
  .object({
    password: passwordSchema,
    passwordConfirm: z.string(),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: "Les deux mots de passe ne correspondent pas.",
    path: ["passwordConfirm"],
  });

/** Création d'un compte garage par l'administrateur (chemin sans vérification). */
export const createGarageAccountSchema = z.object({
  garageName: z
    .string()
    .trim()
    .min(2, "Le nom du garage est obligatoire.")
    .max(120, "Nom trop long (120 caractères maximum)."),
  fullName: z.string().trim().max(120, "Nom trop long.").optional(),
  email: emailSchema,
  password: passwordSchema,
  /** Date de fin de l'abonnement initial (ISO). L'admin encaisse hors ligne. */
  subscriptionEndDate: z.iso.date("Date de fin d'abonnement invalide."),
});
