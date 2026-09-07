import { describe, expect, it } from "vitest";

import {
  formatAmount,
  formatDate,
  formatDateShort,
  formatNumber,
  formatVatRate,
  todayInLocale,
} from "@/lib/format";
import {
  contentDisposition,
  nomFichierFacture,
  slugFichier,
} from "@/lib/invoice/pdf-filename";

/**
 * Formatage — et le piège des dates civiles.
 *
 * Le sujet n'est pas cosmétique. Une date civile mal interprétée change le
 * JOUR affiché sur une pièce comptable, et diffère entre le serveur et le
 * navigateur — donc casse aussi l'hydratation React. C'est le genre de bug
 * qu'on ne voit pas en développant à Paris et qui apparaît chez un lecteur à
 * l'ouest de Greenwich.
 */

/** Les espaces d'`Intl` (fine insécable U+202F, insécable U+00A0) normalisées. */
const lisible = (t: string) => t.replace(/[  ]/g, " ");

describe("formatAmount", () => {
  it("rend un montant français à deux décimales", () => {
    expect(lisible(formatAmount(1234.56))).toBe("1 234,56 €");
    expect(lisible(formatAmount(0))).toBe("0,00 €");
    expect(lisible(formatAmount(-42))).toBe("-42,00 €");
  });

  it("complète toujours les décimales", () => {
    expect(lisible(formatAmount(100))).toBe("100,00 €");
  });

  /**
   * Ce test fige le PROBLÈME, pas la solution : `Intl` insère des espaces
   * insécables absentes de l'encodage WinAnsi des polices standard du PDF.
   * C'est pour cela que `invoice-pdf.tsx` les normalise à l'impression. Si un
   * jour `Intl` cesse d'en produire, ce test le dira.
   */
  it("produit bien les espaces insécables que le PDF doit neutraliser", () => {
    const brut = formatAmount(1234.56);
    expect(/[  ]/.test(brut)).toBe(true);
  });
});

describe("formatNumber et formatVatRate", () => {
  it("formate sans symbole monétaire", () => {
    expect(lisible(formatNumber(1234.5))).toBe("1 234,50");
  });

  it("écrit un taux avec la virgule française", () => {
    expect(lisible(formatVatRate(20))).toBe("20 %");
    expect(lisible(formatVatRate(5.5))).toBe("5,5 %");
    expect(lisible(formatVatRate(2.1))).toBe("2,1 %");
  });
});

describe("dates civiles", () => {
  it("affiche une date « AAAA-MM-JJ » telle qu'elle a été saisie", () => {
    expect(formatDate("2026-09-07")).toBe("7 septembre 2026");
    expect(formatDateShort("2026-09-07")).toBe("07/09/2026");
  });

  /**
   * Le cas qui révèle le bug : minuit UTC le 1er janvier. Sans épinglage sur
   * UTC, une machine à l'ouest de Greenwich afficherait le 31 décembre —
   * l'année entière change sur la facture.
   */
  it("ne recule pas d'un jour selon le fuseau de la machine", () => {
    expect(formatDate("2026-01-01")).toBe("1 janvier 2026");
    expect(formatDateShort("2026-01-01")).toBe("01/01/2026");
    expect(formatDate("2026-12-31")).toBe("31 décembre 2026");
  });

  it("laisse un horodatage complet dans le fuseau du lecteur", () => {
    // Une date civile n'a pas d'heure ; un `created_at` en a une vraie et ne
    // doit PAS être épinglé sur UTC. On vérifie seulement qu'il est accepté.
    expect(formatDate(new Date("2026-09-07T12:00:00Z"))).toContain("2026");
  });
});

describe("todayInLocale", () => {
  it("rend une date civile bien formée", () => {
    expect(todayInLocale()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("répond dans le fuseau du pays de facturation, pas celui de la machine", () => {
    // On ne peut pas fixer l'horloge ici, mais on peut vérifier que la
    // réponse est cohérente avec le jour à Paris, à un jour près.
    const aParis = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(
      new Date(),
    );
    expect(todayInLocale()).toBe(aParis);
  });
});

describe("nom de fichier du PDF", () => {
  it("compose Facture_{numéro}_{client}.pdf", () => {
    expect(nomFichierFacture("2026-000042", "Transports Dupont")).toBe(
      "Facture_2026-000042_Transports_Dupont.pdf",
    );
  });

  it("ne fait pas passer un brouillon pour une facture", () => {
    // Un brouillon n'a pas de numéro : son nom ne doit pas commencer par
    // « Facture », sans quoi un fichier téléchargé pourrait être pris pour
    // une pièce comptable.
    expect(nomFichierFacture(null, "Client de brouillon")).toBe(
      "Brouillon_Client_de_brouillon.pdf",
    );
  });

  it("remplace ce qu'un système de fichiers refuse", () => {
    expect(slugFichier('Du/pont: "Cie" *?')).toBe("Du_pont_Cie");
    expect(slugFichier("   ")).toBe("sans-nom");
  });

  it("garde les accents dans le nom, mais sait les translittérer", () => {
    expect(slugFichier("Café Léon & Fils")).toBe("Café_Léon_Fils");
    expect(slugFichier("Café Léon & Fils", { translitterer: true })).toBe(
      "Cafe_Leon_Fils",
    );
  });
});

describe("contentDisposition", () => {
  /**
   * Deux formes dans le même en-tête, et c'est voulu : `filename=` en ASCII
   * pour les clients anciens, `filename*=UTF-8''` pour les autres. Un nom
   * accentué transmis en ASCII seul arriverait mutilé chez le client.
   */
  it("porte la forme ASCII ET la forme UTF-8", () => {
    const entete = contentDisposition("Facture_2026-000001_Café_Léon.pdf", "attachment");

    expect(entete.startsWith("attachment; ")).toBe(true);
    expect(entete).toContain('filename="Facture_2026-000001_Cafe_Leon.pdf"');

    const encode = entete.split("filename*=UTF-8''")[1];
    expect(decodeURIComponent(encode)).toBe("Facture_2026-000001_Café_Léon.pdf");
  });

  it("distingue le téléchargement de la lecture en ligne", () => {
    // Une facture émise se télécharge, un brouillon s'ouvre dans le lecteur.
    expect(contentDisposition("Facture_1.pdf", "attachment")).toMatch(/^attachment;/);
    expect(contentDisposition("Brouillon_1.pdf", "inline")).toMatch(/^inline;/);
  });
});
