import { z } from "zod";

import {
  euVatNumberSchema,
  numberFromForm,
  optionalEmailSchema,
  optionalText,
  phoneSchema,
  siretSchema,
} from "@/lib/validation/fields";

/**
 * Carnet de clients et catalogue de prestations : validation de saisie.
 *
 * Aucune dépendance serveur — les formulaires importent ces schémas pour un
 * retour immédiat. La validation qui fait autorité reste celle des Server
 * Actions ; le navigateur n'est jamais la barrière.
 *
 * ---------------------------------------------------------------------------
 * PAS DE `garage_id` ICI, ET C'EST VOULU
 * ---------------------------------------------------------------------------
 * `clients.garage_id` et `services.garage_id` sont `not null` : il faut bien
 * les remplir. Mais la valeur vient de `requireGarage()`, donc de `profiles`,
 * donc du serveur — jamais du formulaire. Un `garage_id` validé par zod
 * resterait un `garage_id` fourni par le navigateur : le valider ne le rendrait
 * pas légitime. Il n'a donc rien à faire dans ces schémas.
 *
 * ---------------------------------------------------------------------------
 * LES CLÉS SONT EN snake_case
 * ---------------------------------------------------------------------------
 * Comme pour la fiche garage : ce sont les noms des colonnes, et le résultat
 * du parse part tel quel dans `insert()` / `update()`. Une couche de
 * traduction de moins, donc un endroit de moins où un champ se perd.
 */

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

/**
 * Un client du carnet.
 *
 * Seul le nom est obligatoire. Le reste se remplit au fil des factures : on
 * enregistre souvent un client sur un nom et un téléphone, l'adresse arrive
 * quand elle arrive. Exiger tout d'un coup pousserait à saisir n'importe quoi.
 */
export const clientSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Le nom ou la raison sociale est obligatoire.")
    .max(160, "Nom trop long (160 caractères maximum)."),
  address: optionalText(300),
  phone: phoneSchema,
  email: optionalEmailSchema,
  // Client possiblement étranger : voir `euVatNumberSchema`.
  vat_number: euVatNumberSchema,
  siret: siretSchema,
});

export type ClientInput = z.infer<typeof clientSchema>;

// ---------------------------------------------------------------------------
// Prestations
// ---------------------------------------------------------------------------

/**
 * Une prestation du catalogue : un point de départ pour une ligne de facture.
 *
 * Le taux de TVA est borné 0–100 comme la contrainte SQL
 * (`services_vat_rate_ck`), et non restreint aux taux de la locale. Le
 * formulaire, lui, propose `LocaleConfig.vatRates` : c'est là que la
 * connaissance du pays vit. Verrouiller aussi le schéma rendrait
 * inenregistrable un catalogue existant le jour où un taux disparaît d'une
 * locale — et un catalogue qu'on ne peut plus enregistrer est un catalogue
 * qu'on ne peut plus corriger.
 */
export const serviceSchema = z.object({
  label: z
    .string()
    .trim()
    .min(2, "Le libellé de la prestation est obligatoire.")
    .max(200, "Libellé trop long (200 caractères maximum)."),
  default_unit: z
    .string()
    .trim()
    .min(1, "L'unité est obligatoire (U, H, L, kg…).")
    .max(16, "Unité trop longue (16 caractères maximum)."),
  default_price_ht: numberFromForm("Prix unitaire invalide.").pipe(
    z
      .number()
      .min(0, "Le prix unitaire ne peut pas être négatif.")
      .max(99_999_999, "Prix unitaire hors limites."),
  ),
  default_vat_rate: numberFromForm("Taux de TVA invalide.").pipe(
    z
      .number()
      .min(0, "Le taux de TVA ne peut pas être négatif.")
      .max(100, "Un taux supérieur à 100 % est certainement une erreur de saisie."),
  ),
});

export type ServiceInput = z.infer<typeof serviceSchema>;

// ---------------------------------------------------------------------------
// Identifiants
// ---------------------------------------------------------------------------

export const clientIdSchema = z.uuid("Client introuvable.");
export const serviceIdSchema = z.uuid("Prestation introuvable.");
