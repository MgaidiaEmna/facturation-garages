import { z } from "zod";

import {
  bicSchema,
  checkboxSchema,
  frenchVatNumberSchema,
  ibanSchema,
  numberFromForm,
  optionalEmailSchema,
  optionalText,
  phoneSchema,
  siretSchema,
} from "@/lib/validation/fields";

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
 *
 * ---------------------------------------------------------------------------
 * OÙ VIVENT LES BRIQUES DE VALIDATION
 * ---------------------------------------------------------------------------
 * SIRET, TVA, IBAN, téléphone et nombres de formulaire sont dans
 * `@/lib/validation/fields`, partagés avec le carnet de clients et le
 * catalogue de prestations : un SIRET a quatorze chiffres, qu'il soit celui du
 * garage ou celui de son client, et deux copies de la règle finiraient par
 * diverger.
 *
 * Le numéro de TVA du VENDEUR est forcément français — c'est le garage. Celui
 * d'un CLIENT peut être belge ou allemand : d'où deux schémas distincts,
 * `frenchVatNumberSchema` ici et `euVatNumberSchema` pour le carnet.
 */

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
  vat_number: frenchVatNumberSchema,
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
