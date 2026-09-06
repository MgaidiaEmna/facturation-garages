import { z } from "zod";

import { getLocale, type LocaleCode, type SellerIdentityField } from "@/lib/locale";

/**
 * Saisie d'une fiche garage : validation et complétude.
 *
 * Aucune dépendance serveur — le formulaire d'administration importe ce
 * fichier pour valider à la frappe. La validation qui fait autorité reste
 * celle de la Server Action ; le navigateur n'est jamais la barrière.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI LES CLÉS SONT EN snake_case
 * ---------------------------------------------------------------------------
 * Elles reprennent exactement les noms des colonnes de `garages`, et les
 * clés déclarées par `LocaleConfig.sellerIdentityFields`. Le résultat du
 * parse se passe donc tel quel à `update(...)`, sans table de correspondance
 * intermédiaire — une couche de traduction de moins, donc un endroit de
 * moins où un champ peut se perdre en silence.
 *
 * ---------------------------------------------------------------------------
 * CE QUI EST BLOQUANT ET CE QUI NE L'EST PAS
 * ---------------------------------------------------------------------------
 * Le format est vérifié (un SIRET a 14 chiffres, un n° de TVA français
 * commence par FR) mais la PRÉSENCE ne l'est pas, sauf pour la dénomination.
 * Un garage peut être créé avant que l'administrateur n'ait toutes ses
 * pièces ; c'est `missingSellerFields()` qui signale la fiche incomplète, et
 * la facture qui la refusera le moment venu. Bloquer l'enregistrement d'une
 * fiche partielle ferait perdre la saisie déjà faite.
 */

/**
 * Un champ absent du `FormData` arrive à `null`, pas à `""` — c'est le cas
 * d'un formulaire partiel ou d'un champ retiré du gabarit. On le traite comme
 * une saisie vide plutôt que de renvoyer « expected string, received null »,
 * qui n'apprendrait rien à personne.
 */
function fromForm<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === null || value === undefined ? "" : value), schema);
}

/** Champ texte facultatif : « » et « ␣␣ » deviennent `null`, pas `""`. */
function optionalText(max: number) {
  return fromForm(
    z
      .string()
      .trim()
      .max(max, `Texte trop long (${max} caractères maximum).`)
      .transform((value) => (value === "" ? null : value)),
  );
}

/** Retire espaces, points et tirets d'un identifiant saisi à la main. */
function compact(value: string): string {
  return value.replace(/[\s.\-]/g, "");
}

/**
 * SIRET : 14 chiffres. Saisi avec des espaces neuf fois sur dix
 * (« 812 345 678 00012 ») — on les retire au lieu de refuser.
 */
const siretSchema = fromForm(
  z
    .string()
    .trim()
    .transform(compact)
    .refine(
      (value) => value === "" || /^\d{14}$/.test(value),
      "Le SIRET doit comporter exactement 14 chiffres (le SIREN = les 9 premiers).",
    )
    .transform((value) => (value === "" ? null : value)),
);

/** TVA intracommunautaire française : FR + clé à 2 caractères + SIREN à 9 chiffres. */
const vatNumberSchema = fromForm(
  z
    .string()
    .trim()
    .transform((value) => compact(value).toUpperCase())
    .refine(
      (value) => value === "" || /^FR[0-9A-Z]{2}\d{9}$/.test(value),
      "Format attendu : FR suivi de 2 caractères de clé et des 9 chiffres du SIREN (ex. FR12345678901).",
    )
    .transform((value) => (value === "" ? null : value)),
);

const ibanSchema = fromForm(
  z
    .string()
    .trim()
    .transform((value) => compact(value).toUpperCase())
    .refine(
      (value) => value === "" || /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value),
      "IBAN invalide (2 lettres de pays, 2 chiffres de clé, puis le numéro de compte).",
    )
    .transform((value) => (value === "" ? null : value)),
);

const bicSchema = fromForm(
  z
    .string()
    .trim()
    .transform((value) => compact(value).toUpperCase())
    .refine(
      (value) => value === "" || /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(value),
      "BIC invalide (8 ou 11 caractères).",
    )
    .transform((value) => (value === "" ? null : value)),
);

const phoneSchema = fromForm(
  z
    .string()
    .trim()
    .refine(
      (value) => value === "" || /^[+()\d\s.\-]{6,25}$/.test(value),
      "Numéro de téléphone invalide.",
    )
    .transform((value) => (value === "" ? null : value)),
);

/**
 * Adresse de contact, reprise sur la facture. Facultative, contrairement à
 * l'adresse de connexion qui vit dans `auth.users` et ne se modifie pas ici.
 */
const optionalEmailSchema = fromForm(
  z
    .string()
    .trim()
    .toLowerCase()
    .max(254, "Adresse e-mail trop longue.")
    .refine(
      (value) => value === "" || z.email().safeParse(value).success,
      "Adresse e-mail invalide.",
    )
    .transform((value) => (value === "" ? null : value)),
);

/**
 * Nombre saisi dans un formulaire. Le navigateur envoie « 10.5 » avec
 * `type="number"`, mais un collage depuis un tableur donne « 10,5 » : on
 * accepte les deux plutôt que de rejeter une virgule française.
 */
function numberFromForm(message: string) {
  return z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const normalized = value.trim().replace(",", ".");
    return normalized === "" ? undefined : Number(normalized);
  }, z.number({ error: message }));
}

/** Case à cocher / interrupteur : absent du FormData quand il est décoché. */
const checkboxSchema = z.preprocess(
  (value) => value === "on" || value === "true" || value === true,
  z.boolean(),
);

/**
 * Fiche garage — identité légale, contact et conditions de règlement.
 *
 * Les bornes reprennent celles des contraintes SQL (`garages_payment_term_ck`,
 * `garages_penalty_rate_ck`) : le message d'erreur doit venir du formulaire,
 * pas d'une violation de contrainte remontée brute depuis Postgres.
 */
export const garageIdentitySchema = z.object({
  // --- Identité du vendeur (mentions obligatoires) ---
  name: z
    .string()
    .trim()
    .min(2, "La dénomination sociale est obligatoire.")
    .max(120, "Nom trop long (120 caractères maximum)."),
  legal_form: optionalText(60),
  siret: siretSchema,
  vat_number: vatNumberSchema,
  rcs_city: optionalText(120),
  capital: optionalText(60),
  address: optionalText(300),

  // --- Contact et coordonnées bancaires ---
  phone: phoneSchema,
  email: optionalEmailSchema,
  iban: ibanSchema,
  bic: bicSchema,

  // --- Réglages de facturation ---
  vat_exempt: checkboxSchema,
  payment_term_days: numberFromForm("Délai de règlement invalide.")
    .pipe(
      z
        .int("Le délai de règlement s'exprime en jours entiers.")
        .min(0, "Le délai ne peut pas être négatif.")
        .max(365, "Le délai ne peut pas dépasser 365 jours."),
    ),
  late_payment_penalty_rate: numberFromForm("Taux de pénalités invalide.").pipe(
    z
      .number()
      .min(0, "Le taux ne peut pas être négatif.")
      .max(100, "Un taux supérieur à 100 % est certainement une erreur de saisie."),
  ),
  recovery_indemnity: numberFromForm("Indemnité de recouvrement invalide.").pipe(
    z.number().min(0, "L'indemnité ne peut pas être négative."),
  ),
});

export type GarageIdentityInput = z.infer<typeof garageIdentitySchema>;

/** Identifiant de garage, pour les actions qui ne portent que sur lui. */
export const garageIdSchema = z.object({
  garageId: z.uuid("Garage introuvable."),
});

/** Bascule d'un drapeau booléen (premium, activation). */
export const garageFlagSchema = garageIdSchema.extend({
  enabled: z.boolean(),
});

/**
 * Suppression : le nom du garage doit être retapé à l'identique.
 *
 * Le rapprochement des deux valeurs se fait dans la Server Action, contre le
 * nom LU EN BASE — jamais contre un nom transporté par le formulaire, qui
 * serait fourni par le même navigateur que la confirmation.
 */
export const garageDeletionSchema = garageIdSchema.extend({
  confirmName: z.string().trim().min(1, "Saisissez le nom du garage pour confirmer."),
});

// ---------------------------------------------------------------------------
// Complétude de la fiche
// ---------------------------------------------------------------------------

/** Sous-ensemble de la fiche interrogé par `missingSellerFields()`. */
export type SellerIdentityValues = Record<string, unknown>;

/**
 * Mentions obligatoires encore absentes, d'après la locale du garage.
 *
 * La liste des champs requis n'est PAS écrite ici : elle vient de
 * `LocaleConfig.sellerIdentityFields`. Ajouter un pays ne demande donc pas de
 * rouvrir ce fichier, et la France ne peut pas dériver de ce que la facture
 * exigera au moment de l'émission.
 */
export function missingSellerFields(
  values: SellerIdentityValues,
  localeCode?: LocaleCode,
): SellerIdentityField[] {
  const locale = getLocale(localeCode);

  return locale.sellerIdentityFields.filter((field) => {
    if (!field.required) return false;
    const value = values[field.key];
    return value === null || value === undefined || String(value).trim() === "";
  });
}

/** Raccourci d'affichage : la fiche porte-t-elle toutes les mentions requises ? */
export function isSellerIdentityComplete(
  values: SellerIdentityValues,
  localeCode?: LocaleCode,
): boolean {
  return missingSellerFields(values, localeCode).length === 0;
}
