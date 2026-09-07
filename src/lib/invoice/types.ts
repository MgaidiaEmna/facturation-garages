import type { DraftLine } from "./compute";

/**
 * Formes de données de la facturation, sans dépendance serveur.
 *
 * Elles vivent ici et non dans `queries.ts`, qui importe `server-only` :
 * l'aperçu et l'éditeur sont des composants client, et importer un type
 * depuis un module marqué `server-only` revient à parier sur l'effacement
 * des types par le bundler. On ne parie pas là-dessus.
 */

/** Identité du vendeur, telle que l'aperçu et la facture l'impriment. */
export interface SellerIdentity {
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
  vatExempt: boolean;
  paymentTermDays: number;
  latePaymentPenaltyRate: number;
  recoveryIndemnity: number;
}

/** Coordonnées d'une partie (le client), saisies à chaque facture. */
export interface InvoiceParty {
  name: string;
  address: string;
  phone: string;
  vatNumber: string;
}

/** Une ligne de la liste des brouillons. */
export interface DraftSummary {
  id: string;
  clientName: string | null;
  issueDate: string;
  serviceDate: string | null;
  totalTtc: number;
  lineCount: number;
  updatedAt: string;
}

/** Un brouillon complet, tel que l'éditeur le reprend. */
export interface InvoiceDraft {
  id: string;
  clientName: string;
  clientAddress: string;
  clientPhone: string;
  clientVatNumber: string;
  issueDate: string;
  serviceDate: string;
  notes: string;
  lines: DraftLine[];
}
