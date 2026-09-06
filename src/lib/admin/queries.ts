import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { GarageAccountStatus, GarageOrigin } from "@/lib/auth/types";
import { missingSellerFields } from "@/lib/admin/garage-schema";
import { DEFAULT_LOCALE, getLocale, type LocaleCode } from "@/lib/locale";

/**
 * Lectures de l'espace administrateur.
 *
 * Toutes passent par le client serveur SOUS RLS : c'est la policy
 * `is_admin()` qui autorise la vue globale, pas un filtre écrit ici. Un bug
 * dans ces requêtes ne peut donc pas ouvrir plus que le rôle ne permet.
 */

export interface GarageAccount {
  userId: string;
  fullName: string | null;
  mustChangePassword: boolean;
  garage: {
    id: string;
    name: string;
    email: string | null;
    isActive: boolean;
    accountStatus: GarageAccountStatus;
    origin: GarageOrigin;
    trialInvoicesUsed: number;
    trialInvoiceLimit: number;
  } | null;
  subscriptionEndDate: string | null;
}

export type AdminNotificationType =
  | "garage_signup"
  | "password_changed"
  | "password_reset_by_admin"
  | "trial_exhausted";

export interface AdminNotification {
  id: string;
  type: AdminNotificationType;
  message: string;
  createdAt: string;
  readAt: string | null;
  garageName: string | null;
}

/**
 * Déplie un embed PostgREST. Selon la cardinalité déduite des clés
 * étrangères, il arrive tantôt en objet, tantôt en tableau d'un élément.
 */
function one(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null;
  return (value as Record<string, unknown>) ?? null;
}

/** Comptes garages, avec leur statut commercial. */
export async function listGarageAccounts(): Promise<GarageAccount[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select(
      `id, full_name, must_change_password,
       garages ( id, name, email, is_active, account_status, origin,
                 trial_invoices_used, trial_invoice_limit,
                 subscriptions ( end_date ) )`,
    )
    .eq("role", "garage")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Lecture des comptes impossible : ${error.message}`);

  return (data ?? []).map((row): GarageAccount => {
    const garage = one(row.garages);
    const subscription = garage ? one(garage.subscriptions) : null;

    return {
      userId: row.id,
      fullName: row.full_name ?? null,
      mustChangePassword: Boolean(row.must_change_password),
      garage: garage
        ? {
            id: String(garage.id),
            name: String(garage.name),
            email: (garage.email as string | null) ?? null,
            isActive: Boolean(garage.is_active),
            accountStatus: garage.account_status as GarageAccountStatus,
            origin: garage.origin as GarageOrigin,
            trialInvoicesUsed: Number(garage.trial_invoices_used ?? 0),
            trialInvoiceLimit: Number(garage.trial_invoice_limit ?? 0),
          }
        : null,
      subscriptionEndDate: subscription ? String(subscription.end_date) : null,
    };
  });
}

/** Journal d'événements, du plus récent au plus ancien. */
export async function listAdminNotifications(limit = 50): Promise<AdminNotification[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("admin_notifications")
    .select("id, type, message, created_at, read_at, garages ( name )")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Lecture des notifications impossible : ${error.message}`);

  return (data ?? []).map((row): AdminNotification => {
    const garage = one(row.garages);
    return {
      id: row.id,
      type: row.type,
      message: row.message,
      createdAt: row.created_at,
      readAt: row.read_at ?? null,
      garageName: garage ? String(garage.name) : null,
    };
  });
}

/** Nombre de notifications non lues, pour la pastille du tableau de bord. */
export async function countUnreadNotifications(): Promise<number> {
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("admin_notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);

  if (error) return 0;
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Fiches garages (phase 3)
// ---------------------------------------------------------------------------

/** Colonnes de la fiche, telles qu'elles sont saisies et affichées. */
export interface GarageRecord {
  id: string;
  name: string;
  legalForm: string | null;
  siret: string | null;
  vatNumber: string | null;
  rcsCity: string | null;
  capital: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  iban: string | null;
  bic: string | null;
  locale: LocaleCode;
  vatExempt: boolean;
  paymentTermDays: number;
  latePaymentPenaltyRate: number;
  recoveryIndemnity: number;
  logoManagementEnabled: boolean;
  isActive: boolean;
  accountStatus: GarageAccountStatus;
  origin: GarageOrigin;
  trialInvoicesUsed: number;
  trialInvoiceLimit: number;
  createdAt: string;
  /**
   * Champs d'identité du vendeur, indexés par la clé déclarée dans
   * `LocaleConfig.sellerIdentityFields` — donc par le nom de la colonne.
   * Le formulaire se génère depuis la locale et lit ici : ajouter un pays
   * n'oblige pas à rouvrir l'écran de saisie.
   */
  identity: Record<string, string | null>;
}

/** Une ligne de la liste `/admin/garages`. */
export interface GarageListItem extends GarageRecord {
  /** Fin de l'abonnement en cours, `null` en essai. Lecture seule — phase 4. */
  subscriptionEndDate: string | null;
  /** Comptes de connexion rattachés (nom et drapeau, sans l'adresse). */
  accounts: { userId: string; fullName: string | null; mustChangePassword: boolean }[];
  /** Factures de toutes natures, brouillons compris. */
  invoiceCount: number;
  /** Libellés des mentions obligatoires encore absentes. */
  missingFields: string[];
}

/** Une ligne de l'historique des encaissements. */
export interface GaragePayment {
  id: string;
  /** Date de l'encaissement réel, pas de la saisie. */
  paidOn: string;
  amount: number | null;
  method: string;
  /** Durée ajoutée, `null` pour une prolongation à date personnalisée. */
  monthsAdded: number | null;
  /** Échéance obtenue par ce paiement — rend la ligne lisible seule. */
  periodEnd: string | null;
  notes: string | null;
  /** Qui a enregistré l'encaissement. */
  recordedBy: string | null;
  createdAt: string;
}

/** La fiche complète, telle que l'écran de détail en a besoin. */
export interface GarageDetail extends GarageListItem {
  /** Comptes de connexion, avec l'adresse réelle lue dans `auth.users`. */
  loginAccounts: {
    userId: string;
    email: string | null;
    fullName: string | null;
    mustChangePassword: boolean;
    emailConfirmed: boolean;
    lastSignInAt: string | null;
  }[];
  /** Factures déjà émises (non-`draft`) : ce sont elles qui figent la fiche. */
  issuedInvoiceCount: number;
  /** Réponse de `garage_is_deletable()` — la règle vient de la base. */
  isDeletable: boolean;
  /** Début de l'abonnement, `null` si aucun paiement n'a jamais été encaissé. */
  subscriptionStartDate: string | null;
  /** Encaissements, du plus récent au plus ancien. */
  payments: GaragePayment[];
}

/** Toutes les colonnes de la fiche, dans l'ordre du formulaire. */
const GARAGE_COLUMNS = `id, name, legal_form, siret, vat_number, rcs_city, capital,
   address, phone, email, iban, bic, locale, vat_exempt, payment_term_days,
   late_payment_penalty_rate, recovery_indemnity, logo_management_enabled,
   is_active, account_status, origin, trial_invoices_used, trial_invoice_limit,
   created_at`;

/** Embed commun à la liste et au détail. */
const GARAGE_EMBEDS = `profiles ( id, full_name, must_change_password ),
   subscriptions ( start_date, end_date ),
   invoices ( count )`;

/** Traduit une ligne `garages` brute en `GarageRecord`. */
function toGarageRecord(row: Record<string, unknown>): GarageRecord {
  const locale = ((row.locale as LocaleCode | null) ?? DEFAULT_LOCALE) as LocaleCode;

  return {
    id: String(row.id),
    name: String(row.name),
    legalForm: (row.legal_form as string | null) ?? null,
    siret: (row.siret as string | null) ?? null,
    vatNumber: (row.vat_number as string | null) ?? null,
    rcsCity: (row.rcs_city as string | null) ?? null,
    capital: (row.capital as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    iban: (row.iban as string | null) ?? null,
    bic: (row.bic as string | null) ?? null,
    locale,
    vatExempt: Boolean(row.vat_exempt),
    paymentTermDays: Number(row.payment_term_days ?? 0),
    latePaymentPenaltyRate: Number(row.late_payment_penalty_rate ?? 0),
    recoveryIndemnity: Number(row.recovery_indemnity ?? 0),
    logoManagementEnabled: Boolean(row.logo_management_enabled),
    isActive: Boolean(row.is_active),
    accountStatus: row.account_status as GarageAccountStatus,
    origin: row.origin as GarageOrigin,
    trialInvoicesUsed: Number(row.trial_invoices_used ?? 0),
    trialInvoiceLimit: Number(row.trial_invoice_limit ?? 0),
    createdAt: String(row.created_at),
    identity: Object.fromEntries(
      getLocale(locale).sellerIdentityFields.map((field) => [
        field.key,
        (row[field.key] as string | null) ?? null,
      ]),
    ),
  };
}

/** Comptes rattachés, tels que les renvoie l'embed `profiles`. */
function toAccounts(value: unknown): GarageListItem["accounts"] {
  const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  return rows.map((profile) => ({
    userId: String(profile.id),
    fullName: (profile.full_name as string | null) ?? null,
    mustChangePassword: Boolean(profile.must_change_password),
  }));
}

/**
 * Mentions obligatoires manquantes, d'après la locale DU GARAGE.
 *
 * Les clés interrogées sont celles de `LocaleConfig.sellerIdentityFields`,
 * qui sont aussi les noms des colonnes : on repasse donc la ligne brute, pas
 * l'objet traduit en camelCase.
 */
function missingFieldLabels(row: Record<string, unknown>, locale: LocaleCode): string[] {
  return missingSellerFields(row, locale).map((field) => field.label);
}

/**
 * Toutes les fiches garages, la plus récente d'abord.
 *
 * Le comptage des factures est délégué à PostgREST (`invoices(count)`) : la
 * liste ne rapatrie pas les factures elles-mêmes, seulement leur nombre.
 */
export async function listGarages(): Promise<GarageListItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("garages")
    .select(`${GARAGE_COLUMNS}, ${GARAGE_EMBEDS}`)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Lecture des garages impossible : ${error.message}`);

  return (data ?? []).map((row): GarageListItem => {
    const record = toGarageRecord(row);
    const subscription = one(row.subscriptions);
    const counted = one(row.invoices);

    return {
      ...record,
      subscriptionEndDate: subscription ? String(subscription.end_date) : null,
      accounts: toAccounts(row.profiles),
      invoiceCount: Number(counted?.count ?? 0),
      missingFields: missingFieldLabels(row, record.locale),
    };
  });
}

/**
 * Une fiche et tout ce qui l'entoure : comptes de connexion, factures,
 * possibilité de suppression.
 *
 * `garage_is_deletable()` et `garage_accounts()` sont interrogées plutôt que
 * recalculées : la règle de suppression et l'adresse de connexion
 * appartiennent à la base. L'écran ne fait que les afficher.
 */
export async function getGarageDetail(garageId: string): Promise<GarageDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("garages")
    .select(`${GARAGE_COLUMNS}, ${GARAGE_EMBEDS}`)
    .eq("id", garageId)
    .maybeSingle();

  if (error) throw new Error(`Lecture de la fiche impossible : ${error.message}`);
  if (!data) return null;

  const record = toGarageRecord(data);
  const subscription = one(data.subscriptions);
  const counted = one(data.invoices);

  const [accountsResult, issuedResult, deletableResult, paymentsResult] = await Promise.all([
    supabase.rpc("garage_accounts", { g: garageId }),
    supabase
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("garage_id", garageId)
      .neq("status", "draft"),
    supabase.rpc("garage_is_deletable", { g: garageId }),
    supabase
      .from("payments")
      .select(
        `id, paid_on, amount, method, months_added, period_end, notes, created_at,
         profiles ( full_name )`,
      )
      .eq("garage_id", garageId)
      .order("paid_on", { ascending: false })
      .order("created_at", { ascending: false }),
  ]);

  const loginAccounts = (
    (accountsResult.data as Record<string, unknown>[] | null) ?? []
  ).map((account) => ({
    userId: String(account.user_id),
    email: (account.email as string | null) ?? null,
    fullName: (account.full_name as string | null) ?? null,
    mustChangePassword: Boolean(account.must_change_password),
    emailConfirmed: Boolean(account.email_confirmed),
    lastSignInAt: (account.last_sign_in_at as string | null) ?? null,
  }));

  const payments = ((paymentsResult.data as Record<string, unknown>[] | null) ?? []).map(
    (row): GaragePayment => {
      const author = one(row.profiles);
      return {
        id: String(row.id),
        paidOn: String(row.paid_on),
        amount: row.amount === null || row.amount === undefined ? null : Number(row.amount),
        method: String(row.method),
        monthsAdded:
          row.months_added === null || row.months_added === undefined
            ? null
            : Number(row.months_added),
        periodEnd: (row.period_end as string | null) ?? null,
        notes: (row.notes as string | null) ?? null,
        recordedBy: author ? ((author.full_name as string | null) ?? null) : null,
        createdAt: String(row.created_at),
      };
    },
  );

  return {
    ...record,
    subscriptionEndDate: subscription ? String(subscription.end_date) : null,
    subscriptionStartDate: subscription ? String(subscription.start_date) : null,
    payments,
    accounts: toAccounts(data.profiles),
    invoiceCount: Number(counted?.count ?? 0),
    missingFields: missingFieldLabels(data, record.locale),
    loginAccounts,
    issuedInvoiceCount: issuedResult.count ?? 0,
    // En cas d'échec du RPC, on refuse la suppression : un doute ne doit
    // jamais se résoudre en faveur de l'effacement.
    isDeletable: deletableResult.data === true,
  };
}
