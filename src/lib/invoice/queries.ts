import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { DraftLine, VatBucket } from "./compute";
import type {
  InvoiceStatus,
  InvoiceSummary,
  InvoiceView,
  IssuedInvoice,
  SellerIdentity,
} from "./types";

export type {
  InvoiceDraft,
  InvoiceStatus,
  InvoiceSummary,
  InvoiceView,
  IssuedInvoice,
  SellerIdentity,
} from "./types";

/**
 * Lectures de l'espace garage.
 *
 * Aucun filtre sur `garage_id` n'est écrit ici : `invoices_select` et
 * `invoice_lines_select` ne laissent passer que les factures du garage
 * courant. Un oubli dans ces requêtes ne peut donc pas ouvrir plus que le
 * RLS n'autorise — c'est tout l'intérêt de ne pas doubler la règle.
 */

/**
 * Fiche du garage courant.
 *
 * `garages_select` ne rend que sa propre ligne à un garage : aucun filtre
 * n'est écrit ici, et il n'y en a pas besoin. Le garage LIT sa fiche — il ne
 * la modifie pas, c'est l'affaire de l'administrateur.
 */
export async function getSellerIdentity(): Promise<SellerIdentity | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("garages")
    .select(
      `name, legal_form, siret, vat_number, rcs_city, capital, address, phone,
       email, iban, bic, vat_exempt, payment_term_days,
       late_payment_penalty_rate, recovery_indemnity`,
    )
    .maybeSingle();

  if (error) throw new Error(`Lecture de la fiche impossible : ${error.message}`);
  if (!data) return null;

  return {
    name: String(data.name),
    legalForm: (data.legal_form as string | null) ?? null,
    siret: (data.siret as string | null) ?? null,
    vatNumber: (data.vat_number as string | null) ?? null,
    rcsCity: (data.rcs_city as string | null) ?? null,
    capital: (data.capital as string | null) ?? null,
    address: (data.address as string | null) ?? null,
    phone: (data.phone as string | null) ?? null,
    email: (data.email as string | null) ?? null,
    iban: (data.iban as string | null) ?? null,
    bic: (data.bic as string | null) ?? null,
    vatExempt: Boolean(data.vat_exempt),
    paymentTermDays: Number(data.payment_term_days ?? 30),
    latePaymentPenaltyRate: Number(data.late_payment_penalty_rate ?? 0),
    recoveryIndemnity: Number(data.recovery_indemnity ?? 0),
  };
}


/** Lignes d'une facture, triées par leur position de saisie. */
function toLines(rows: unknown): DraftLine[] {
  return ((rows as Record<string, unknown>[] | null) ?? [])
    .slice()
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
    .map(
      (line): DraftLine => ({
        key: String(line.id),
        description: String(line.description ?? ""),
        unit: String(line.unit ?? "U"),
        quantity: Number(line.quantity ?? 0),
        unitPriceHt: Number(line.unit_price_ht ?? 0),
        vatRate: Number(line.vat_rate ?? 0),
      }),
    );
}

/**
 * Factures du garage courant pour un statut donné.
 *
 * Les brouillons se lisent du plus récemment modifié au plus ancien — c'est
 * l'ordre du travail en cours. Les factures émises se lisent par numéro
 * décroissant : le format `AAAA-000001` est zéro-comblé, donc l'ordre
 * alphabétique EST l'ordre de la série. Trier par date d'émission donnerait
 * un registre où deux factures du même jour s'échangent de place à chaque
 * rechargement.
 */
export async function listInvoices(status: InvoiceStatus): Promise<InvoiceSummary[]> {
  const supabase = await createClient();

  const query = supabase
    .from("invoices")
    .select(
      `id, status, number, client_name, issue_date, service_date,
       total_ttc, updated_at, finalized_at, invoice_lines(count)`,
    )
    .eq("status", status);

  const { data, error } =
    status === "draft"
      ? await query.order("updated_at", { ascending: false })
      : await query.order("number", { ascending: false });

  if (error) throw new Error(`Lecture des factures impossible : ${error.message}`);

  return (data ?? []).map((row): InvoiceSummary => {
    const counted = Array.isArray(row.invoice_lines)
      ? (row.invoice_lines[0] as { count?: number } | undefined)
      : (row.invoice_lines as { count?: number } | null);

    return {
      id: String(row.id),
      status: row.status as InvoiceStatus,
      number: (row.number as string | null) ?? null,
      clientName: (row.client_name as string | null) ?? null,
      issueDate: String(row.issue_date),
      serviceDate: (row.service_date as string | null) ?? null,
      totalTtc: Number(row.total_ttc ?? 0),
      lineCount: Number(counted?.count ?? 0),
      updatedAt: String(row.updated_at),
      finalizedAt: (row.finalized_at as string | null) ?? null,
    };
  });
}

/**
 * Combien de factures par statut, pour les compteurs des onglets.
 *
 * Trois requêtes `head` plutôt qu'un chargement complet : un garage qui
 * facture depuis trois ans a des milliers de lignes émises, et compter en
 * JavaScript reviendrait à toutes les rapatrier pour n'en afficher que le
 * nombre.
 */
export async function countInvoicesByStatus(): Promise<Record<InvoiceStatus, number>> {
  const supabase = await createClient();

  async function countFor(status: InvoiceStatus): Promise<number> {
    const { count, error } = await supabase
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("status", status);

    if (error) throw new Error(`Comptage des factures impossible : ${error.message}`);
    return count ?? 0;
  }

  const [draft, final, cancelled] = await Promise.all([
    countFor("draft"),
    countFor("final"),
    countFor("cancelled"),
  ]);

  return { draft, final, cancelled };
}

/**
 * Une facture et ses lignes, brouillon ou émise, ou `null`.
 *
 * `null` couvre aussi bien « n'existe pas » que « appartient à un autre
 * garage » : le RLS filtre, la requête ne voit rien, et l'écran affiche une
 * page inexistante. Distinguer les deux cas renseignerait sur les factures
 * d'autrui.
 *
 * Aucun filtre sur le statut ici — c'est l'appelant qui aiguille. Interroger
 * le statut d'abord, puis la facture, ferait deux allers-retours pour une
 * question à laquelle la première réponse répond déjà.
 */
export async function getInvoice(invoiceId: string): Promise<InvoiceView | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("invoices")
    .select(
      `id, status, number, client_name, client_address, client_phone, client_vat_number,
       issue_date, service_date, due_date, notes, locale,
       seller_snapshot, vat_exempt, payment_term_days, late_payment_penalty_rate,
       recovery_indemnity, subtotal_ht, vat_total, stamp_duty, total_ttc, vat_breakdown,
       finalized_at, cancelled_at,
       invoice_lines ( id, description, unit, quantity, unit_price_ht, vat_rate, position )`,
    )
    .eq("id", invoiceId)
    .maybeSingle();

  if (error) throw new Error(`Lecture de la facture impossible : ${error.message}`);
  if (!data) return null;

  const lines = toLines(data.invoice_lines);
  const status = data.status as InvoiceStatus;

  if (status === "draft") {
    return {
      status: "draft",
      draft: {
        id: String(data.id),
        clientName: (data.client_name as string | null) ?? "",
        clientAddress: (data.client_address as string | null) ?? "",
        clientPhone: (data.client_phone as string | null) ?? "",
        clientVatNumber: (data.client_vat_number as string | null) ?? "",
        issueDate: String(data.issue_date),
        serviceDate: (data.service_date as string | null) ?? "",
        notes: (data.notes as string | null) ?? "",
        lines,
      },
    };
  }

  return { status, issued: toIssuedInvoice(data, lines) };
}

/**
 * Assemble la facture figée à partir de la ligne lue.
 *
 * L'identité du vendeur vient de `seller_snapshot`, JAMAIS de la fiche
 * actuelle du garage ; les conditions de règlement et la franchise viennent
 * des colonnes de la facture, gelées elles aussi à l'émission. Relire une
 * facture de l'an dernier avec les mentions d'aujourd'hui produirait un
 * document que le client n'a jamais reçu.
 */
function toIssuedInvoice(row: Record<string, unknown>, lines: DraftLine[]): IssuedInvoice {
  const snapshot = (row.seller_snapshot as Record<string, unknown> | null) ?? {};
  const texte = (key: string): string | null => {
    const value = snapshot[key];
    return value === null || value === undefined ? null : String(value);
  };

  const seller: SellerIdentity = {
    name: texte("name") ?? "",
    legalForm: texte("legal_form"),
    siret: texte("siret"),
    vatNumber: texte("vat_number"),
    rcsCity: texte("rcs_city"),
    capital: texte("capital"),
    address: texte("address"),
    phone: texte("phone"),
    email: texte("email"),
    iban: texte("iban"),
    bic: texte("bic"),
    vatExempt: Boolean(row.vat_exempt),
    paymentTermDays: Number(row.payment_term_days ?? 0),
    latePaymentPenaltyRate: Number(row.late_payment_penalty_rate ?? 0),
    recoveryIndemnity: Number(row.recovery_indemnity ?? 0),
  };

  const breakdown = ((row.vat_breakdown as Record<string, unknown>[] | null) ?? []).map(
    (bucket): VatBucket => ({
      rate: Number(bucket.rate ?? 0),
      baseHt: Number(bucket.base_ht ?? 0),
      vatAmount: Number(bucket.vat_amount ?? 0),
    }),
  );

  return {
    id: String(row.id),
    status: row.status as "final" | "cancelled",
    number: String(row.number ?? ""),
    issueDate: String(row.issue_date),
    serviceDate: (row.service_date as string | null) ?? "",
    dueDate: (row.due_date as string | null) ?? null,
    finalizedAt: String(row.finalized_at ?? ""),
    cancelledAt: (row.cancelled_at as string | null) ?? null,
    client: {
      name: (row.client_name as string | null) ?? "",
      address: (row.client_address as string | null) ?? "",
      phone: (row.client_phone as string | null) ?? "",
      vatNumber: (row.client_vat_number as string | null) ?? "",
    },
    notes: (row.notes as string | null) ?? "",
    lines,
    seller,
    // Les totaux ne sont pas recalculés : ce sont ceux que la base a écrits
    // en `numeric` exact au moment de l'émission.
    totals: {
      subtotalHt: Number(row.subtotal_ht ?? 0),
      vatTotal: Number(row.vat_total ?? 0),
      stampDuty: Number(row.stamp_duty ?? 0),
      totalTtc: Number(row.total_ttc ?? 0),
      breakdown,
    },
    locale: String(row.locale ?? "FR"),
  };
}
