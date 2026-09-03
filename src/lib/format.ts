import { getLocale, type LocaleCode } from "@/lib/locale";

/**
 * Formatage des montants selon la locale de facturation.
 * En France : « 1 234,56 € » (2 décimales, espace insécable comme séparateur).
 */
export function formatAmount(value: number, localeCode?: LocaleCode): string {
  const locale = getLocale(localeCode);
  return new Intl.NumberFormat(locale.intlLocale, {
    style: "currency",
    currency: locale.currency,
    minimumFractionDigits: locale.decimals,
    maximumFractionDigits: locale.decimals,
  }).format(value);
}

/** Formate un nombre sans symbole monétaire (colonnes d'un tableau, saisie). */
export function formatNumber(value: number, localeCode?: LocaleCode): string {
  const locale = getLocale(localeCode);
  return new Intl.NumberFormat(locale.intlLocale, {
    minimumFractionDigits: locale.decimals,
    maximumFractionDigits: locale.decimals,
  }).format(value);
}

/** Formate un taux de TVA : 5.5 -> « 5,5 % ». */
export function formatVatRate(rate: number, localeCode?: LocaleCode): string {
  const locale = getLocale(localeCode);
  return `${new Intl.NumberFormat(locale.intlLocale, {
    maximumFractionDigits: 2,
  }).format(rate)} %`;
}

/** Date longue : « 3 septembre 2026 ». */
export function formatDate(value: Date | string, localeCode?: LocaleCode): string {
  const locale = getLocale(localeCode);
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale.intlLocale, { dateStyle: "long" }).format(date);
}

/** Date courte : « 03/09/2026 ». */
export function formatDateShort(value: Date | string, localeCode?: LocaleCode): string {
  const locale = getLocale(localeCode);
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale.intlLocale, { dateStyle: "short" }).format(date);
}
