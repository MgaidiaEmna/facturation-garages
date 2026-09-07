import { getLocale, type LocaleCode } from "@/lib/locale";

/**
 * Moteur de calcul d'une facture.
 *
 * ---------------------------------------------------------------------------
 * CE MODULE N'EST PAS LA SOURCE DE VÉRITÉ
 * ---------------------------------------------------------------------------
 * Il sert l'aperçu temps réel, où l'on a besoin d'un total à chaque frappe.
 * Les montants qui comptent — ceux qui sont persistés et imprimés — sont
 * recalculés côté serveur par `finalize_invoice()` à l'émission, en `numeric`
 * exact. Aucun total venant du navigateur n'est jamais enregistré.
 *
 * L'algorithme reproduit néanmoins **exactement** celui du SQL, pour que
 * l'aperçu ne mente pas :
 *   1. chaque ligne est arrondie      round(quantité × PU, d)
 *   2. les lignes sont groupées par taux, la base du taux est la somme
 *      arrondie de ses lignes
 *   3. la TVA est calculée sur la BASE AGRÉGÉE de chaque taux, pas ligne à
 *      ligne — sinon les centimes divergent dès trois lignes au même taux
 *   4. total TTC = HT + TVA + timbre, arrondi
 *
 * Écart résiduel possible : JavaScript calcule en binaire (0,1 + 0,2 ≠ 0,3),
 * Postgres en décimal exact. Sur des montants de facture l'écart reste sous
 * le centime, et c'est le serveur qui tranche — mais c'est la raison pour
 * laquelle cet aperçu est indicatif, et le dit.
 *
 * ---------------------------------------------------------------------------
 * RÉUTILISABLE TEL QUEL
 * ---------------------------------------------------------------------------
 * Aucune dépendance à React, au DOM ni au serveur : le futur export PDF et
 * l'export Factur-X consommeront ces mêmes fonctions et ces mêmes types. La
 * structuration des données (parties, lignes, taxes) vit ici, pas dans un
 * composant d'affichage.
 */

/** Une ligne de prestation en cours de saisie. */
export interface DraftLine {
  /** Identifiant local, le temps de la saisie. Pas celui de la base. */
  key: string;
  description: string;
  unit: string;
  quantity: number;
  unitPriceHt: number;
  vatRate: number;
}

/** Base et TVA pour un taux donné. Structure reprise dans `vat_breakdown`. */
export interface VatBucket {
  rate: number;
  baseHt: number;
  vatAmount: number;
}

export interface InvoiceTotals {
  subtotalHt: number;
  vatTotal: number;
  /** Toujours 0 en France ; la colonne existe pour le multi-locale. */
  stampDuty: number;
  totalTtc: number;
  /** Détail par taux, du plus élevé au plus faible. Vide en franchise. */
  breakdown: VatBucket[];
}

/**
 * Arrondi commercial, moitié à l'écart de zéro — comme `round(numeric, int)`
 * en SQL. `Math.round()` seul arrondit −2,5 vers −2 : ce n'est pas la même
 * règle, et un avoir la ferait apparaître.
 */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  const scaled = value * factor;
  const rounded = scaled >= 0 ? Math.round(scaled) : -Math.round(-scaled);
  return rounded / factor;
}

/** Total d'une ligne : quantité × prix unitaire HT, arrondi. */
export function lineTotal(line: DraftLine, decimals: number): number {
  return roundTo(line.quantity * line.unitPriceHt, decimals);
}

/**
 * Une ligne vierge, prête à saisir. Le taux par défaut vient de la locale —
 * 20 % en France, et rien de tout cela n'est écrit en dur ici.
 *
 * La clé est FOURNIE PAR L'APPELANT, elle n'est pas tirée au sort ici. Ce
 * module est pur : un `Math.random()` en ferait une fonction qui ne rend pas
 * deux fois le même résultat, et cette clé finit dans les attributs `id` et
 * `htmlFor` des champs. Rendue sur le serveur puis rejouée à l'hydratation,
 * elle donnait deux valeurs différentes — l'erreur « some attributes of the
 * server rendered HTML didn't match ». Voir `invoice-editor.tsx`.
 */
export function emptyLine(key: string, localeCode?: LocaleCode): DraftLine {
  const locale = getLocale(localeCode);
  return {
    key,
    description: "",
    unit: "U",
    quantity: 1,
    unitPriceHt: 0,
    vatRate: locale.defaultVatRate,
  };
}

/**
 * Totaux d'une facture, à partir de ses lignes.
 *
 * `vatExempt` vient du garage (franchise en base, art. 293 B du CGI) : la
 * facture n'affiche alors aucune TVA, et le détail par taux est vide. Le même
 * effacement a lieu dans `finalize_invoice()`.
 */
export function computeTotals(
  lines: DraftLine[],
  options: { localeCode?: LocaleCode; vatExempt?: boolean } = {},
): InvoiceTotals {
  const locale = getLocale(options.localeCode);
  const decimals = locale.decimals;
  const stampDuty = 0;

  // 1 & 2 — regroupement par taux, base = somme des lignes arrondies.
  const bases = new Map<number, number>();
  for (const line of lines) {
    if (!isUsable(line)) continue;
    const rate = Number.isFinite(line.vatRate) ? line.vatRate : 0;
    bases.set(rate, roundTo((bases.get(rate) ?? 0) + lineTotal(line, decimals), decimals));
  }

  // 3 — TVA sur la base agrégée, du taux le plus élevé au plus faible.
  const breakdown: VatBucket[] = [...bases.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, baseHt]) => ({
      rate,
      baseHt,
      vatAmount: roundTo((baseHt * rate) / 100, decimals),
    }));

  const subtotalHt = roundTo(
    breakdown.reduce((sum, bucket) => sum + bucket.baseHt, 0),
    decimals,
  );

  if (options.vatExempt) {
    return {
      subtotalHt,
      vatTotal: 0,
      stampDuty,
      totalTtc: roundTo(subtotalHt + stampDuty, decimals),
      breakdown: [],
    };
  }

  const vatTotal = roundTo(
    breakdown.reduce((sum, bucket) => sum + bucket.vatAmount, 0),
    decimals,
  );

  return {
    subtotalHt,
    vatTotal,
    stampDuty,
    totalTtc: roundTo(subtotalHt + vatTotal + stampDuty, decimals),
    breakdown,
  };
}

/**
 * Une ligne compte-t-elle dans les totaux ?
 *
 * Une ligne encore vide — celle qu'on vient d'ajouter — ne doit pas peser sur
 * l'aperçu. Une ligne à quantité nulle non plus. La règle est la même à
 * l'enregistrement : les lignes sans désignation ne sont pas persistées.
 */
export function isUsable(line: DraftLine): boolean {
  return (
    line.description.trim() !== "" &&
    Number.isFinite(line.quantity) &&
    Number.isFinite(line.unitPriceHt)
  );
}

/** Échéance de règlement = date d'émission + délai du garage. */
export function dueDateFrom(issueDate: string, paymentTermDays: number): string {
  const [year, month, day] = issueDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + paymentTermDays));
  return date.toISOString().slice(0, 10);
}
