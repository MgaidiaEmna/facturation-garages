import { describe, expect, it } from "vitest";

import {
  buildInvoiceDocument,
  sellerAddressLines,
  sellerFooterIdentityLines,
  sellerFooterLegalLines,
} from "@/lib/invoice/document";
import type { DraftLine } from "@/lib/invoice/compute";
import type { InvoiceParty, SellerIdentity } from "@/lib/invoice/types";

/**
 * Le modèle sémantique de la facture.
 *
 * `buildInvoiceDocument()` est la parade à la divergence entre l'écran et le
 * PDF : ordre des lignes d'identité, texte des mentions légales, calcul de
 * l'échéance. Ce que ces tests protègent, c'est la CONFORMITÉ — une mention
 * obligatoire qui disparaît du modèle disparaît des deux rendus à la fois, et
 * aucune page d'erreur ne le signalera.
 */

const VENDEUR: SellerIdentity = {
  name: "Auto Service Martin",
  address: "12 rue des Ateliers, 69007 Lyon",
  siret: "81234567800012",
  legalForm: "SASU",
  capital: "5 000 €",
  rcsCity: "RCS Lyon 812 345 678",
  vatNumber: "FR12812345678",
  phone: "04 78 61 24 90",
  email: "contact@autoservicemartin.fr",
  iban: "FR7630006000011234567890189",
  bic: "AGRIFRPP",
  paymentTermDays: 30,
  latePaymentPenaltyRate: 10.75,
  recoveryIndemnity: 40,
  vatExempt: false,
  logoPath: null,
};

const CLIENT: InvoiceParty = {
  name: "Transports Dupont",
  address: "45 avenue de la Gare\n69003 Lyon",
  phone: "",
  vatNumber: "FR40123456824",
};

const LIGNES: DraftLine[] = [
  {
    key: "l1",
    description: "Révision complète",
    unit: "forfait",
    quantity: 1,
    unitPriceHt: 240,
    vatRate: 20,
  },
];

function document(surcharge: Partial<Parameters<typeof buildInvoiceDocument>[0]> = {}) {
  return buildInvoiceDocument({
    seller: VENDEUR,
    client: CLIENT,
    lines: LIGNES,
    issueDate: "2026-09-07",
    serviceDate: "2026-09-05",
    notes: "",
    ...surcharge,
  });
}

describe("lignes d'identité du vendeur", () => {
  it("ne met QUE l'adresse dans le bloc du haut", () => {
    expect(sellerAddressLines(VENDEUR)).toEqual(["12 rue des Ateliers, 69007 Lyon"]);
  });

  it("place identification et contact dans la colonne gauche du pied", () => {
    expect(sellerFooterIdentityLines(VENDEUR)).toEqual([
      "12 rue des Ateliers, 69007 Lyon",
      "SIRET 81234567800012",
      "TVA FR12812345678",
      "04 78 61 24 90 · contact@autoservicemartin.fr",
    ]);
  });

  it("place forme sociale et banque dans la colonne droite du pied", () => {
    expect(sellerFooterLegalLines(VENDEUR)).toEqual([
      "SASU — capital 5 000 €",
      "RCS Lyon 812 345 678",
      "IBAN FR7630006000011234567890189",
      "BIC AGRIFRPP",
    ]);
  });

  /**
   * Le test qui compte vraiment : AUCUNE mention obligatoire ne doit pouvoir
   * disparaître du document, où qu'on décide de la placer. Il regarde les
   * trois listes réunies, donc il survit à une réorganisation de la mise en
   * page — et tombe si quelqu'un en retire une.
   */
  it("n'égare aucune mention imposée par le Code de commerce", () => {
    const tout = [
      ...sellerAddressLines(VENDEUR),
      ...sellerFooterIdentityLines(VENDEUR),
      ...sellerFooterLegalLines(VENDEUR),
    ].join(" | ");

    for (const mention of [
      "81234567800012", // SIRET
      "FR12812345678", // TVA intracommunautaire
      "SASU", // forme juridique
      "5 000 €", // capital social
      "RCS Lyon", // RCS et ville du greffe
      "12 rue des Ateliers", // adresse du siège
      "FR7630006000011234567890189", // IBAN
      "AGRIFRPP", // BIC
    ]) {
      expect(tout).toContain(mention);
    }
  });

  it("omet proprement ce qui n'est pas renseigné, sans trou ni « undefined »", () => {
    const nu: SellerIdentity = {
      ...VENDEUR,
      siret: null,
      legalForm: null,
      capital: null,
      rcsCity: null,
      vatNumber: null,
      iban: null,
      bic: null,
      phone: null,
      email: null,
    };
    expect(sellerFooterIdentityLines(nu)).toEqual(["12 rue des Ateliers, 69007 Lyon"]);
    expect(sellerFooterLegalLines(nu)).toEqual([]);
  });

  it("ne laisse pas un tiret orphelin quand seule la forme juridique est connue", () => {
    expect(sellerFooterLegalLines({ ...VENDEUR, capital: null })[0]).toBe("SASU");
  });
});

describe("buildInvoiceDocument", () => {
  it("déduit l'échéance du délai de règlement", () => {
    expect(document().dates.due).toBe("2026-10-07");
  });

  it("préfère l'échéance GELÉE quand elle est fournie", () => {
    // Une facture émise ne recalcule rien : l'échéance vient de la base.
    expect(document({ dueDate: "2026-11-30" }).dates.due).toBe("2026-11-30");
  });

  it("n'invente pas d'échéance sans date d'émission", () => {
    expect(document({ issueDate: "" }).dates.due).toBeNull();
  });

  it("substitue le taux de pénalités du vendeur, avec une virgule", () => {
    const mentions = document().legalMentions;
    expect(mentions.latePayment).toContain("10,75 %");
    expect(mentions.latePayment).not.toContain("{rate}");
  });

  it("rappelle le délai ET l'échéance dans la même phrase", () => {
    expect(document().legalMentions.paymentTerms).toBe(
      "Règlement à 30 jours — échéance au 7 octobre 2026.",
    );
  });

  it("porte toujours l'indemnité forfaitaire de 40 €", () => {
    expect(document().legalMentions.recoveryIndemnity).toContain("40 €");
  });

  it("n'annonce l'art. 293 B qu'en franchise", () => {
    expect(document().legalMentions.vatExempt).toBeNull();
    expect(
      document({ seller: { ...VENDEUR, vatExempt: true } }).legalMentions.vatExempt,
    ).toBe("TVA non applicable, art. 293 B du CGI");
  });

  it("écarte les lignes inutilisables, comme save_invoice_draft()", () => {
    const doc = document({
      lines: [
        ...LIGNES,
        { key: "vide", description: "  ", unit: "U", quantity: 1, unitPriceHt: 99, vatRate: 20 },
      ],
    });
    expect(doc.lines).toHaveLength(1);
    expect(doc.totals.subtotalHt).toBe(240);
  });

  it("REPREND les totaux figés sans les recalculer", () => {
    // Le cas qui compte : une facture émise affiche ce que la base a écrit,
    // même si le recalcul JavaScript donnerait autre chose. Ici les totaux
    // fournis sont volontairement incohérents avec les lignes.
    const figes = {
      subtotalHt: 999,
      vatTotal: 1,
      stampDuty: 0,
      totalTtc: 1000,
      breakdown: [{ rate: 20, baseHt: 999, vatAmount: 1 }],
    };
    expect(document({ totals: figes, status: "final" }).totals).toEqual(figes);
  });

  it("normalise les champs vides du client en null", () => {
    const doc = document({ client: { name: "  ", address: "", phone: "  ", vatNumber: "" } });
    expect(doc.client).toEqual({ name: null, address: null, phone: null, vatNumber: null });
  });

  it("n'a pas de numéro sur un brouillon", () => {
    expect(document().number).toBeNull();
    expect(document().status).toBe("draft");
    expect(document({ number: "2026-000042", status: "final" }).number).toBe("2026-000042");
  });

  it("transporte le logo tel qu'on le lui donne, sans le dupliquer", () => {
    // UN SEUL champ pour les deux rendus : l'écran reçoit une URL signée, le
    // PDF une `data:` URI. Deux champs rouvriraient la porte à deux logos.
    expect(document({ logoUrl: "data:image/png;base64,AA" }).seller.logoUrl).toBe(
      "data:image/png;base64,AA",
    );
    expect(document().seller.logoUrl).toBeNull();
  });

  it("est PURE : deux appels identiques donnent le même document", () => {
    expect(document()).toEqual(document());
  });
});
