import { formatDate } from "@/lib/format";
import { getLocale, type LocaleCode } from "@/lib/locale";
import {
  computeTotals,
  isUsable,
  lineTotal,
  type DraftLine,
  type InvoiceTotals,
} from "./compute";
import type { InvoiceParty, InvoiceStatus, SellerIdentity } from "./types";

/**
 * Modèle sémantique d'une facture : ce qu'elle DIT, pas comment elle s'affiche.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CE MODULE EXISTE
 * ---------------------------------------------------------------------------
 * L'aperçu à l'écran est du HTML ; le PDF est rendu par `@react-pdf/renderer`,
 * dont les primitives n'ont rien à voir. Il y a donc DEUX moteurs de rendu, et
 * deux occasions d'imprimer des choses différentes — un ordre de lignes qui
 * change, une mention légale oubliée d'un côté, un taux de pénalités substitué
 * ici et pas là. Sur une facture, cet écart n'est pas cosmétique : c'est une
 * pièce comptable qui ne correspond plus à ce que le client a vu.
 *
 * Ce module est la réponse : les deux rendus consomment le MÊME document. Ce
 * qui reste propre à chacun, c'est la mise en page. Ce qui ne peut plus
 * diverger, c'est le contenu, son ordre, et les chiffres.
 *
 * ---------------------------------------------------------------------------
 * CE QUI EST PRÉ-RÉSOLU, ET CE QUI RESTE BRUT
 * ---------------------------------------------------------------------------
 * · Les PHRASES sont résolues ici — mentions légales, taux substitué, échéance
 *   calculée. C'est là que la divergence coûte cher, et ça ne se formate pas
 *   deux fois.
 * · Les NOMBRES restent bruts. Chaque rendu appelle `formatAmount()` de
 *   `format.ts`, qui est déjà une implémentation unique : aucun risque de
 *   divergence, et le futur export Factur-X a besoin des valeurs, pas de
 *   « 1 234,56 € ».
 *
 * ---------------------------------------------------------------------------
 * PRÉPARATION FACTUR-X
 * ---------------------------------------------------------------------------
 * C'est cette forme-là — parties, lignes, taxes, dates, références — que le
 * CII de Factur-X demandera. Le générateur XML de la phase e-facture se
 * branchera ici, et non sur un composant d'affichage.
 */

/** Une ligne de prestation, son total de ligne déjà arrondi. */
export interface DocumentLine {
  key: string;
  description: string;
  quantity: number;
  unit: string;
  unitPriceHt: number;
  vatRate: number;
  /** `round(quantité × PU, décimales de la locale)`. */
  lineTotalHt: number;
}

/** Le vendeur, tel qu'il s'imprime en haut de la facture. */
export interface DocumentSeller {
  name: string;
  /**
   * Où trouver le logo — ou `null` : l'en-tête reste alors le nom en texte.
   *
   * UN SEUL champ pour les deux rendus, chacun recevant la forme qu'il sait
   * consommer : l'écran une URL signée (le bucket est privé), le PDF une
   * `data:` URI dont les octets ont été téléchargés par le serveur. Deux
   * champs auraient rouvert la porte à deux logos différents sur le même
   * document.
   */
  logoUrl: string | null;
  /**
   * Ce qui s'imprime EN TÊTE, sous le nom : l'adresse du siège, et rien
   * d'autre. Un en-tête de facture doit se lire d'un coup d'œil — qui émet,
   * à qui, quand, pour combien.
   */
  headerLines: string[];
  /**
   * Les mentions d'identité obligatoires, imprimées EN PIED : SIRET, forme
   * juridique et capital, RCS et ville du greffe, n° de TVA
   * intracommunautaire, contact.
   *
   * Déplacées, jamais retirées. Le Code de commerce les exige sur la facture,
   * pas en haut de la facture — mais il les exige. Un rendu qui les omettrait
   * produirait un document non conforme, et c'est ce modèle qui empêche l'un
   * des deux rendus de les oublier tout seul.
   *
   * Vide quand la fiche n'a rien : c'est au rendu de le signaler, pas au
   * modèle de mentir.
   */
  legalIdentityLines: string[];
  vatExempt: boolean;
  paymentTermDays: number;
}

/** Le client facturé. `null` = non renseigné, à distinguer de « vide ». */
export interface DocumentClient {
  name: string | null;
  address: string | null;
  phone: string | null;
  vatNumber: string | null;
}

/** Mentions obligatoires, déjà rédigées. `null` = sans objet ici. */
export interface DocumentLegalMentions {
  /** « TVA non applicable, art. 293 B du CGI » — seulement en franchise. */
  vatExempt: string | null;
  /** « Règlement à 30 jours — échéance au 7 octobre 2026. » */
  paymentTerms: string;
  /** Pénalités de retard, taux du vendeur substitué. */
  latePayment: string;
  /** Indemnité forfaitaire de 40 € (art. L441-10 et D441-5). */
  recoveryIndemnity: string;
  /** Coordonnées bancaires, si le vendeur en a renseigné. */
  bankDetails: string | null;
}

export interface InvoiceDocument {
  status: InvoiceStatus;
  /** `null` sur un brouillon : le numéro naît à l'émission. */
  number: string | null;
  localeCode: LocaleCode;

  seller: DocumentSeller;
  client: DocumentClient;

  dates: {
    issue: string | null;
    service: string | null;
    /** Échéance figée à l'émission, ou déduite du délai de règlement. */
    due: string | null;
  };

  lines: DocumentLine[];
  totals: InvoiceTotals;
  notes: string | null;
  legalMentions: DocumentLegalMentions;
}

export interface BuildInvoiceDocumentInput {
  seller: SellerIdentity;
  client: InvoiceParty;
  lines: DraftLine[];
  issueDate: string;
  serviceDate: string;
  notes: string;
  localeCode?: LocaleCode;
  status?: InvoiceStatus;
  number?: string | null;
  /** Échéance gelée. Absente : on la déduit du délai de règlement. */
  dueDate?: string | null;
  /**
   * Totaux écrits par `finalize_invoice()`. Fournis pour une facture ÉMISE,
   * absents pour un brouillon — auquel cas ils sont recalculés à titre
   * indicatif. Une facture émise ne doit jamais réafficher un total
   * recalculé : ce qui a été imprimé et envoyé au client, c'est ce que la base
   * a écrit.
   */
  totals?: InvoiceTotals;
  /** Logo résolu par l'appelant : URL signée à l'écran, `data:` URI en PDF. */
  logoUrl?: string | null;
}

const vide = (valeur: string | null | undefined): string | null => {
  const texte = (valeur ?? "").trim();
  return texte === "" ? null : texte;
};

/** Échéance = date d'émission + délai, en dates civiles (jamais en heures). */
function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * L'en-tête : l'adresse du siège, sous le nom du vendeur.
 *
 * L'ordre et le contenu sont des décisions d'impression, pas des détails : ils
 * sont ici pour que l'écran et le papier ne les prennent pas chacun de leur
 * côté.
 */
export function sellerHeaderLines(seller: SellerIdentity): string[] {
  return [seller.address].filter((part): part is string => Boolean(part));
}

/**
 * Le pied : toutes les mentions d'identité que la loi impose.
 *
 * Rien n'est perdu en descendant ici — c'est la même liste qu'avant, moins
 * l'adresse restée en tête. Les coordonnées bancaires, elles, sont déjà une
 * mention de pied (`legalMentions.bankDetails`) et n'ont pas à être répétées.
 */
export function sellerLegalLines(seller: SellerIdentity): string[] {
  return [
    [seller.legalForm, seller.capital ? `capital ${seller.capital}` : null]
      .filter(Boolean)
      .join(" — ") || null,
    seller.siret ? `SIRET ${seller.siret}` : null,
    seller.rcsCity,
    seller.vatNumber ? `TVA ${seller.vatNumber}` : null,
    [seller.phone, seller.email].filter(Boolean).join(" · ") || null,
  ].filter((part): part is string => Boolean(part));
}

/** Assemble le document. Fonction PURE : ni React, ni serveur, ni horloge. */
export function buildInvoiceDocument(
  input: BuildInvoiceDocumentInput,
): InvoiceDocument {
  const { seller, client, localeCode } = input;
  const locale = getLocale(localeCode);
  const status = input.status ?? "draft";

  const totals =
    input.totals ?? computeTotals(input.lines, { localeCode, vatExempt: seller.vatExempt });

  const issue = vide(input.issueDate);
  const due =
    vide(input.dueDate ?? null) ??
    (issue ? addDays(issue, seller.paymentTermDays) : null);

  const echeance = due ? ` — échéance au ${formatDate(due, localeCode)}` : "";

  return {
    status,
    number: vide(input.number ?? null),
    localeCode: locale.code,

    seller: {
      name: seller.name,
      logoUrl: input.logoUrl ?? null,
      headerLines: sellerHeaderLines(seller),
      legalIdentityLines: sellerLegalLines(seller),
      vatExempt: seller.vatExempt,
      paymentTermDays: seller.paymentTermDays,
    },

    client: {
      name: vide(client.name),
      address: vide(client.address),
      phone: vide(client.phone),
      vatNumber: vide(client.vatNumber),
    },

    dates: { issue, service: vide(input.serviceDate), due },

    // Une ligne sans désignation n'est pas un oubli d'affichage : elle n'est
    // pas non plus enregistrée par `save_invoice_draft()`. Même règle des deux
    // côtés, donc même document.
    lines: input.lines.filter(isUsable).map((line) => ({
      key: line.key,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitPriceHt: line.unitPriceHt,
      vatRate: line.vatRate,
      lineTotalHt: lineTotal(line, locale.decimals),
    })),

    totals,
    notes: vide(input.notes),

    legalMentions: {
      vatExempt: seller.vatExempt ? locale.legalMentions.vatExemptNotice : null,
      paymentTerms: `Règlement à ${seller.paymentTermDays} jours${echeance}.`,
      // Le taux vient du vendeur ; la phrase, de la locale. Ni l'un ni l'autre
      // n'est écrit en dur dans un composant.
      latePayment: locale.legalMentions.latePaymentPenalty.replace(
        "{rate}",
        String(seller.latePaymentPenaltyRate).replace(".", ","),
      ),
      recoveryIndemnity: locale.legalMentions.recoveryIndemnity,
      bankDetails: seller.iban
        ? `Coordonnées bancaires : ${seller.iban}${seller.bic ? ` — BIC ${seller.bic}` : ""}`
        : null,
    },
  };
}
