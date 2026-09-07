import type { DraftLine, InvoiceTotals } from "./compute";

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

/**
 * Cycle de vie d'une facture. `cancelled` n'est pas atteignable depuis
 * l'espace garage : l'annulation se fera par avoir, plus tard. Le statut
 * existe néanmoins ici parce que la base le connaît et que la liste doit
 * savoir l'afficher si une facture y arrive par un autre chemin.
 */
export type InvoiceStatus = "draft" | "final" | "cancelled";

/** Une ligne de la liste des factures, quel que soit son statut. */
export interface InvoiceSummary {
  id: string;
  status: InvoiceStatus;
  /** `null` tant que la facture est un brouillon — le numéro naît à l'émission. */
  number: string | null;
  clientName: string | null;
  issueDate: string;
  serviceDate: string | null;
  totalTtc: number;
  lineCount: number;
  updatedAt: string;
  finalizedAt: string | null;
}

/**
 * Une facture émise, telle qu'elle se relit — figée.
 *
 * Rien ici n'est recalculé : les totaux sont ceux que `finalize_invoice()` a
 * écrits en `numeric` exact, et l'identité du vendeur vient de
 * `seller_snapshot`, pas de la fiche actuelle du garage. C'est toute la
 * raison d'être de ce gel : si le garage déménage demain, la facture d'hier
 * porte toujours l'adresse d'hier.
 */
export interface IssuedInvoice {
  id: string;
  status: "final" | "cancelled";
  number: string;
  issueDate: string;
  serviceDate: string;
  dueDate: string | null;
  finalizedAt: string;
  cancelledAt: string | null;
  client: InvoiceParty;
  notes: string;
  lines: DraftLine[];
  totals: InvoiceTotals;
  /** Reconstituée depuis `seller_snapshot` et les colonnes gelées. */
  seller: SellerIdentity;
  /** `garages.locale` au jour de l'émission. */
  locale: string;
}

/**
 * Ce que `/app/factures/[id]` reçoit : soit un brouillon à éditer, soit une
 * facture émise à relire. Une union plutôt que deux requêtes, pour que la
 * page n'ait pas à demander le statut avant de savoir quoi demander.
 */
export type InvoiceView =
  | { status: "draft"; draft: InvoiceDraft }
  | { status: "final" | "cancelled"; issued: IssuedInvoice };

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
