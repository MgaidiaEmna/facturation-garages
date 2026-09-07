import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { DraftLine } from "./compute";
import type { DraftSummary, InvoiceDraft, SellerIdentity } from "./types";

export type { DraftSummary, InvoiceDraft, SellerIdentity } from "./types";

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

/** Brouillons du garage courant, du plus récemment modifié au plus ancien. */
export async function listDrafts(): Promise<DraftSummary[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("invoices")
    .select("id, client_name, issue_date, service_date, total_ttc, updated_at, invoice_lines(count)")
    .eq("status", "draft")
    .order("updated_at", { ascending: false });

  if (error) throw new Error(`Lecture des brouillons impossible : ${error.message}`);

  return (data ?? []).map((row): DraftSummary => {
    const counted = Array.isArray(row.invoice_lines)
      ? (row.invoice_lines[0] as { count?: number } | undefined)
      : (row.invoice_lines as { count?: number } | null);

    return {
      id: String(row.id),
      clientName: (row.client_name as string | null) ?? null,
      issueDate: String(row.issue_date),
      serviceDate: (row.service_date as string | null) ?? null,
      totalTtc: Number(row.total_ttc ?? 0),
      lineCount: Number(counted?.count ?? 0),
      updatedAt: String(row.updated_at),
    };
  });
}

/**
 * Un brouillon et ses lignes, ou `null`.
 *
 * `null` couvre aussi bien « n'existe pas » que « appartient à un autre
 * garage » : le RLS filtre, la requête ne voit rien, et l'écran affiche une
 * page inexistante. Distinguer les deux cas renseignerait sur les factures
 * d'autrui.
 */
export async function getDraft(invoiceId: string): Promise<InvoiceDraft | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("invoices")
    .select(
      `id, client_name, client_address, client_phone, client_vat_number,
       issue_date, service_date, notes, status,
       invoice_lines ( id, description, unit, quantity, unit_price_ht, vat_rate, position )`,
    )
    .eq("id", invoiceId)
    .eq("status", "draft")
    .maybeSingle();

  if (error) throw new Error(`Lecture du brouillon impossible : ${error.message}`);
  if (!data) return null;

  const lines = ((data.invoice_lines as Record<string, unknown>[] | null) ?? [])
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

  return {
    id: String(data.id),
    clientName: (data.client_name as string | null) ?? "",
    clientAddress: (data.client_address as string | null) ?? "",
    clientPhone: (data.client_phone as string | null) ?? "",
    clientVatNumber: (data.client_vat_number as string | null) ?? "",
    issueDate: String(data.issue_date),
    serviceDate: (data.service_date as string | null) ?? "",
    notes: (data.notes as string | null) ?? "",
    lines,
  };
}
