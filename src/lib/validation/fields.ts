import { z } from "zod";

/**
 * Briques de validation partagées par les formulaires.
 *
 * Aucune dépendance serveur : un Composant Client peut les importer pour un
 * retour immédiat à la frappe. La validation qui fait autorité reste celle
 * des Server Actions.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CE MODULE EXISTE
 * ---------------------------------------------------------------------------
 * Un SIRET a quatorze chiffres, qu'il soit celui du garage ou celui de son
 * client. Recopier la règle dans chaque schéma revient à parier qu'aucune des
 * copies ne dérivera — et c'est un pari qu'on perd toujours : le jour où l'on
 * accepte les points de séparation dans un formulaire, l'autre les refuse
 * encore, et personne ne comprend pourquoi la même saisie passe ici et pas là.
 */

/**
 * Un champ absent du `FormData` arrive à `null`, pas à `""` — c'est le cas
 * d'un formulaire partiel ou d'un champ retiré du gabarit. On le traite comme
 * une saisie vide plutôt que de renvoyer « expected string, received null »,
 * qui n'apprendrait rien à personne.
 */
export function fromForm<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (value === null || value === undefined ? "" : value), schema);
}

/** Champ texte facultatif : « » et « ␣␣ » deviennent `null`, pas `""`. */
export function optionalText(max: number) {
  return fromForm(
    z
      .string()
      .trim()
      .max(max, `Texte trop long (${max} caractères maximum).`)
      .transform((value) => (value === "" ? null : value)),
  );
}

/** Retire espaces, points et tirets d'un identifiant saisi à la main. */
export function compact(value: string): string {
  return value.replace(/[\s.\-]/g, "");
}

/**
 * SIRET : 14 chiffres. Saisi avec des espaces neuf fois sur dix
 * (« 812 345 678 00012 ») — on les retire au lieu de refuser.
 */
export const siretSchema = fromForm(
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
export const frenchVatNumberSchema = fromForm(
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

/**
 * TVA intracommunautaire d'un CLIENT — pas forcément française.
 *
 * Le vendeur, lui, est le garage : son numéro est nécessairement français, et
 * `frenchVatNumberSchema` peut donc être strict. Un client facturé en B2B
 * intracommunautaire peut être belge, allemand ou italien ; refuser
 * « BE0123456789 » interdirait purement et simplement de le facturer. On
 * vérifie donc la FORME commune — deux lettres de pays puis 2 à 13 caractères
 * alphanumériques — sans prétendre valider la clé de contrôle de chaque pays.
 */
export const euVatNumberSchema = fromForm(
  z
    .string()
    .trim()
    .transform((value) => compact(value).toUpperCase())
    .refine(
      (value) => value === "" || /^[A-Z]{2}[0-9A-Z]{2,13}$/.test(value),
      "Format attendu : 2 lettres de pays puis le numéro (ex. FR12345678901, BE0123456789).",
    )
    .transform((value) => (value === "" ? null : value)),
);

export const ibanSchema = fromForm(
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

export const bicSchema = fromForm(
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

export const phoneSchema = fromForm(
  z
    .string()
    .trim()
    .refine(
      (value) => value === "" || /^[+()\d\s.\-]{6,25}$/.test(value),
      "Numéro de téléphone invalide.",
    )
    .transform((value) => (value === "" ? null : value)),
);

/** Adresse e-mail facultative. */
export const optionalEmailSchema = fromForm(
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
export function numberFromForm(message: string) {
  return z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const normalized = value.trim().replace(",", ".");
    return normalized === "" ? undefined : Number(normalized);
  }, z.number({ error: message }));
}

/** Case à cocher / interrupteur : absent du FormData quand il est décoché. */
export const checkboxSchema = z.preprocess(
  (value) => value === "on" || value === "true" || value === true,
  z.boolean(),
);

/** Erreurs zod aplaties, dans la forme attendue par les états de formulaire. */
export function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  return z.flattenError(error).fieldErrors as Record<string, string[]>;
}
