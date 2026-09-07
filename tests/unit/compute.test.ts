import { describe, expect, it } from "vitest";

import {
  computeTotals,
  dueDateFrom,
  emptyLine,
  isUsable,
  lineTotal,
  roundTo,
  type DraftLine,
} from "@/lib/invoice/compute";

/**
 * Le moteur de calcul d'une facture.
 *
 * C'est le module où une erreur ne se voit pas : rien ne plante, la facture
 * s'imprime, et le total est faux de quelques centimes. D'où des cas choisis
 * pour leur capacité à révéler un écart — pas pour faire du chiffre.
 *
 * Le contrat implicite : ces règles sont les MÊMES que celles de
 * `finalize_invoice()` en SQL. Ce fichier ne peut pas le prouver — seul
 * `verify:emission` compare les deux sur une vraie base — mais il fige le
 * côté JavaScript pour qu'il ne dérive pas tout seul.
 */

/** Une ligne utilisable, pour n'écrire que ce qui varie dans chaque cas. */
function ligne(partial: Partial<DraftLine> & { key: string }): DraftLine {
  return {
    description: "Prestation",
    unit: "U",
    quantity: 1,
    unitPriceHt: 0,
    vatRate: 20,
    ...partial,
  };
}

describe("roundTo", () => {
  it("arrondit à la décimale demandée", () => {
    expect(roundTo(1.004, 2)).toBe(1.0);
    expect(roundTo(2.675, 2)).toBe(2.68);
    expect(roundTo(1.115, 2)).toBe(1.12);
  });

  it("écarte de zéro de part et d'autre, comme round(numeric) en SQL", () => {
    // `Math.round(-2.5)` rend -2 : la moitié va vers +∞, pas à l'écart de
    // zéro. Sur un avoir, l'écart deviendrait visible.
    expect(roundTo(2.5, 0)).toBe(3);
    expect(roundTo(-2.5, 0)).toBe(-3);
    expect(roundTo(-1.115, 2)).toBe(-1.12);
    // Symétrique : deux montants opposés s'arrondissent en miroir.
    expect(roundTo(-2.675, 2)).toBe(-roundTo(2.675, 2));
  });

  it("laisse les entiers intacts", () => {
    expect(roundTo(100, 2)).toBe(100);
    expect(roundTo(0, 2)).toBe(0);
  });

  /**
   * Ce que `roundTo` NE fait PAS, et qu'il ne faut pas croire qu'il fait.
   *
   * `1.005` n'existe pas en IEEE 754 : le double le plus proche vaut
   * 1,00499999999999989, donc × 100 = 100,49999… et l'arrondi rend 1,00 — pas
   * 1,01. Ce n'est pas un défaut de cette fonction, c'est la limite du type
   * `number`. La parade du projet est ailleurs : les totaux qui font foi sont
   * recalculés en `numeric` exact par `finalize_invoice()`, côté base.
   *
   * On fige ce comportement pour qu'il soit CONNU. Le jour où quelqu'un
   * voudra un arrondi décimal exact en JavaScript, ce test lui dira ce qu'il
   * casse.
   */
  it("subit la représentation binaire des décimaux — et c'est documenté", () => {
    expect(roundTo(1.005, 2)).toBe(1.0);
    expect(roundTo(0.145, 2)).toBe(0.14);
  });
});

describe("lineTotal", () => {
  it("multiplie puis arrondit — dans cet ordre", () => {
    expect(lineTotal(ligne({ key: "a", quantity: 3, unitPriceHt: 33.333 }), 2)).toBe(100);
  });

  it("gère les quantités décimales", () => {
    expect(lineTotal(ligne({ key: "a", quantity: 1.5, unitPriceHt: 68 }), 2)).toBe(102);
  });
});

describe("isUsable", () => {
  it("écarte une ligne sans désignation", () => {
    expect(isUsable(ligne({ key: "a", description: "" }))).toBe(false);
    expect(isUsable(ligne({ key: "a", description: "   " }))).toBe(false);
  });

  it("écarte une quantité ou un prix non numérique", () => {
    expect(isUsable(ligne({ key: "a", quantity: Number.NaN }))).toBe(false);
    expect(isUsable(ligne({ key: "a", unitPriceHt: Number.NaN }))).toBe(false);
  });

  it("accepte une ligne à zéro euro", () => {
    // Un geste commercial se facture à 0 € et doit apparaître au document.
    expect(isUsable(ligne({ key: "a", unitPriceHt: 0 }))).toBe(true);
  });
});

describe("emptyLine", () => {
  it("prend le taux par défaut de la locale, jamais une valeur en dur", () => {
    expect(emptyLine("l1").vatRate).toBe(20);
    expect(emptyLine("l1").quantity).toBe(1);
  });

  it("est PURE : la clé vient de l'appelant", () => {
    // Un `Math.random()` interne casserait l'hydratation React — cette clé
    // sert d'`id` et de `htmlFor` aux champs de l'éditeur.
    expect(emptyLine("l1")).toEqual(emptyLine("l1"));
    expect(emptyLine("l1").key).toBe("l1");
  });
});

describe("computeTotals", () => {
  it("ventile par taux, du plus élevé au plus faible", () => {
    const totaux = computeTotals([
      ligne({ key: "a", quantity: 1, unitPriceHt: 240, vatRate: 20 }),
      ligne({ key: "b", quantity: 2, unitPriceHt: 68, vatRate: 20 }),
      ligne({ key: "c", quantity: 1, unitPriceHt: 89.5, vatRate: 10 }),
    ]);

    expect(totaux.breakdown.map((b) => b.rate)).toEqual([20, 10]);
    expect(totaux.breakdown[0]).toEqual({ rate: 20, baseHt: 376, vatAmount: 75.2 });
    expect(totaux.breakdown[1]).toEqual({ rate: 10, baseHt: 89.5, vatAmount: 8.95 });
    expect(totaux.subtotalHt).toBe(465.5);
    expect(totaux.vatTotal).toBe(84.15);
    expect(totaux.totalTtc).toBe(549.65);
  });

  it("calcule la TVA sur la base AGRÉGÉE, pas ligne à ligne", () => {
    // Trois lignes à 0,10 € : ligne à ligne, 3 × round(0,02) = 0,06.
    // Sur la base agrégée, round(0,30 × 20 %) = 0,06 aussi ici — mais le
    // choix se lit sur des taux qui tombent mal. On fige l'invariant :
    // la base du seau est la somme des lignes, la TVA se calcule dessus.
    const totaux = computeTotals([
      ligne({ key: "a", unitPriceHt: 0.1, vatRate: 5.5 }),
      ligne({ key: "b", unitPriceHt: 0.1, vatRate: 5.5 }),
      ligne({ key: "c", unitPriceHt: 0.1, vatRate: 5.5 }),
    ]);
    expect(totaux.breakdown[0].baseHt).toBe(0.3);
    expect(totaux.breakdown[0].vatAmount).toBe(roundTo((0.3 * 5.5) / 100, 2));
    expect(totaux.vatTotal).toBe(totaux.breakdown[0].vatAmount);
  });

  it("ignore les lignes inutilisables", () => {
    const totaux = computeTotals([
      ligne({ key: "a", unitPriceHt: 100 }),
      ligne({ key: "vide", description: "", unitPriceHt: 9999 }),
    ]);
    expect(totaux.subtotalHt).toBe(100);
  });

  it("efface toute la TVA en franchise (art. 293 B)", () => {
    const lignes = [ligne({ key: "a", unitPriceHt: 150, vatRate: 20 })];
    const totaux = computeTotals(lignes, { vatExempt: true });

    expect(totaux.vatTotal).toBe(0);
    expect(totaux.breakdown).toEqual([]);
    expect(totaux.subtotalHt).toBe(150);
    // En franchise, le TTC égale le HT : c'est ce que le document affiche.
    expect(totaux.totalTtc).toBe(150);
  });

  it("ne facture jamais de timbre fiscal en France", () => {
    const totaux = computeTotals([ligne({ key: "a", unitPriceHt: 100 })]);
    expect(totaux.stampDuty).toBe(0);
  });

  it("rend des totaux à zéro sans aucune ligne", () => {
    const totaux = computeTotals([]);
    expect(totaux).toEqual({
      subtotalHt: 0,
      vatTotal: 0,
      stampDuty: 0,
      totalTtc: 0,
      breakdown: [],
    });
  });

  it("traite un taux non numérique comme 0 plutôt que de produire NaN", () => {
    const totaux = computeTotals([
      ligne({ key: "a", unitPriceHt: 100, vatRate: Number.NaN }),
    ]);
    expect(totaux.vatTotal).toBe(0);
    expect(totaux.totalTtc).toBe(100);
  });
});

describe("dueDateFrom", () => {
  it("ajoute le délai en jours civils", () => {
    expect(dueDateFrom("2026-09-07", 30)).toBe("2026-10-07");
    expect(dueDateFrom("2026-09-07", 0)).toBe("2026-09-07");
  });

  it("franchit les fins de mois et les années", () => {
    expect(dueDateFrom("2026-12-20", 30)).toBe("2027-01-19");
    expect(dueDateFrom("2026-01-31", 30)).toBe("2026-03-02");
  });

  it("gère le 29 février d'une année bissextile", () => {
    expect(dueDateFrom("2028-02-28", 1)).toBe("2028-02-29");
    expect(dueDateFrom("2026-02-28", 1)).toBe("2026-03-01");
  });

  it("reste sur UTC, quel que soit le fuseau de la machine", () => {
    // Construite avec `Date.UTC`, la date ne doit pas glisser d'un jour à
    // l'ouest de Greenwich. Sans cela, l'échéance d'une facture change selon
    // qui la regarde.
    expect(dueDateFrom("2026-01-01", 1)).toBe("2026-01-02");
  });
});
