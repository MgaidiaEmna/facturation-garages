import { FR_LOCALE } from "./fr";
import type { LocaleCode, LocaleConfig } from "./types";

export type { LocaleCode, LocaleConfig, VatRate, SellerIdentityField } from "./types";

/**
 * Registre des locales supportées.
 * Pour ajouter la Tunisie : créer `tn.ts` (TND, 3 décimales, TVA 19/13/7/0,
 * hasStampDuty = true, matricule fiscal 13 caractères), l'enregistrer ici et
 * élargir le type `LocaleCode`. Aucun autre fichier ne doit changer.
 */
const LOCALES = {
  FR: FR_LOCALE,
} satisfies Record<LocaleCode, LocaleConfig>;

/** Locale utilisée tant qu'aucune n'est définie sur le garage. */
export const DEFAULT_LOCALE: LocaleCode = "FR";

export function getLocale(code: LocaleCode = DEFAULT_LOCALE): LocaleConfig {
  return LOCALES[code];
}

export function listLocales(): LocaleConfig[] {
  return Object.values(LOCALES);
}
