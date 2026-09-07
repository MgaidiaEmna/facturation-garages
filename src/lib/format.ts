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

/**
 * Une date CIVILE (« AAAA-MM-JJ ») n'a pas d'heure.
 *
 * `new Date("2026-09-07")` la place à minuit UTC ; l'afficher dans le fuseau
 * de la machine la recule d'un jour partout à l'ouest de Greenwich. Le
 * serveur écrirait « 7 septembre » et le navigateur « 6 septembre » : mêmes
 * données, deux rendus — donc une erreur d'hydratation React, et surtout une
 * fausse date d'émission sur un document légal.
 *
 * On épingle donc l'affichage de ces chaînes sur UTC, le fuseau dans lequel
 * elles ont été construites. Un horodatage complet (`created_at`), lui, porte
 * une vraie heure : il reste affiché dans le fuseau du lecteur.
 */
const DATE_CIVILE = /^\d{4}-\d{2}-\d{2}$/;

function interpreter(value: Date | string): { date: Date; timeZone?: string } {
  if (typeof value !== "string") return { date: value };
  return { date: new Date(value), timeZone: DATE_CIVILE.test(value) ? "UTC" : undefined };
}

/** Date longue : « 3 septembre 2026 ». */
export function formatDate(value: Date | string, localeCode?: LocaleCode): string {
  const locale = getLocale(localeCode);
  const { date, timeZone } = interpreter(value);
  return new Intl.DateTimeFormat(locale.intlLocale, { dateStyle: "long", timeZone }).format(date);
}

/** Date courte : « 03/09/2026 ». */
export function formatDateShort(value: Date | string, localeCode?: LocaleCode): string {
  const locale = getLocale(localeCode);
  const { date, timeZone } = interpreter(value);
  return new Intl.DateTimeFormat(locale.intlLocale, { dateStyle: "short", timeZone }).format(date);
}

/** Date et heure : « 5 sept. 2026, 14:32 ». Utilisé pour l'horodatage des
 *  événements (journal de l'administrateur), jamais sur une facture. */
export function formatDateTime(value: Date | string, localeCode?: LocaleCode): string {
  const locale = getLocale(localeCode);
  const { date, timeZone } = interpreter(value);
  return new Intl.DateTimeFormat(locale.intlLocale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(date);
}

/**
 * Aujourd'hui, en « AAAA-MM-JJ », dans le fuseau du pays de facturation.
 *
 * À appeler CÔTÉ SERVEUR et à transmettre au navigateur : deux horloges ne
 * donnent pas forcément le même jour, et un éditeur qui recalcule la date à
 * l'hydratation se contredit lui-même. Le fuseau vient de la locale, jamais
 * de la machine — voir `LocaleConfig.timeZone`.
 */
export function todayInLocale(localeCode?: LocaleCode): string {
  const locale = getLocale(localeCode);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: locale.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const lire = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${lire("year")}-${lire("month")}-${lire("day")}`;
}
