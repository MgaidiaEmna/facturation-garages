import { describe, expect, it } from "vitest";

import {
  bicSchema,
  compact,
  euVatNumberSchema,
  frenchVatNumberSchema,
  ibanSchema,
  optionalEmailSchema,
  phoneSchema,
  siretSchema,
} from "@/lib/validation/fields";

/**
 * Les briques de validation, partagées par la fiche garage et le carnet de
 * clients.
 *
 * Deux propriétés comptent ici, et une seule des deux est évidente :
 *
 * · REFUSER ce qui est invalide — un SIRET à 13 chiffres n'a pas à passer ;
 * · ACCEPTER ce qui est valide mal saisi. Un SIRET se tape avec des espaces
 *   neuf fois sur dix. Refuser « 812 345 678 00012 » serait un bug, pas une
 *   rigueur : l'utilisateur verrait une erreur sur une saisie correcte.
 */

/** Le résultat d'un schéma, réduit à ce qui nous intéresse. */
function parse(schema: { safeParse: (v: unknown) => { success: boolean; data?: unknown } }, valeur: string) {
  const r = schema.safeParse(valeur);
  return r.success ? { ok: true as const, valeur: r.data } : { ok: false as const };
}

describe("compact", () => {
  it("retire espaces, points et tirets d'un identifiant", () => {
    expect(compact("812 345 678 00012")).toBe("81234567800012");
    expect(compact("FR-76.3000")).toBe("FR763000");
  });
});

describe("siretSchema", () => {
  it("accepte 14 chiffres, avec ou sans espaces", () => {
    expect(parse(siretSchema, "81234567800012")).toEqual({
      ok: true,
      valeur: "81234567800012",
    });
    expect(parse(siretSchema, "812 345 678 00012")).toEqual({
      ok: true,
      valeur: "81234567800012",
    });
  });

  it("refuse un compte de chiffres qui n'est pas 14", () => {
    expect(parse(siretSchema, "8123456780001").ok).toBe(false); // 13
    expect(parse(siretSchema, "812345678000123").ok).toBe(false); // 15
  });

  it("refuse ce qui n'est pas numérique", () => {
    expect(parse(siretSchema, "8123456780001A").ok).toBe(false);
  });

  it("laisse passer le vide — une fiche incomplète s'enregistre", () => {
    // Le format est validé, la PRÉSENCE ne l'est pas : l'admin doit pouvoir
    // enregistrer une fiche à moitié remplie.
    expect(parse(siretSchema, "")).toEqual({ ok: true, valeur: null });
    expect(parse(siretSchema, "   ")).toEqual({ ok: true, valeur: null });
  });
});

describe("numéro de TVA — vendeur vs client", () => {
  it("exige un numéro FRANÇAIS pour le vendeur", () => {
    expect(parse(frenchVatNumberSchema, "FR12812345678")).toEqual({
      ok: true,
      valeur: "FR12812345678",
    });
    expect(parse(frenchVatNumberSchema, "fr12812345678").valeur).toBe("FR12812345678");
    expect(parse(frenchVatNumberSchema, "BE0123456789").ok).toBe(false);
  });

  /**
   * L'exception délibérée du projet. Un garage français peut parfaitement
   * facturer un client belge ou allemand ; appliquer le schéma du vendeur au
   * client interdirait purement et simplement de l'enregistrer.
   */
  it("accepte un numéro EUROPÉEN pour le client", () => {
    expect(parse(euVatNumberSchema, "BE0123456789").ok).toBe(true);
    expect(parse(euVatNumberSchema, "DE123456789").ok).toBe(true);
    expect(parse(euVatNumberSchema, "FR40123456824").ok).toBe(true);
  });

  it("refuse tout de même une forme qui n'a rien d'un numéro de TVA", () => {
    expect(parse(euVatNumberSchema, "123456789").ok).toBe(false); // sans pays
    expect(parse(euVatNumberSchema, "B1").ok).toBe(false);
  });
});

describe("ibanSchema", () => {
  it("accepte un IBAN espacé et le compacte en majuscules", () => {
    expect(parse(ibanSchema, "fr76 3000 6000 0112 3456 7890 189").valeur).toBe(
      "FR7630006000011234567890189",
    );
  });

  it("refuse une forme qui n'est pas un IBAN", () => {
    expect(parse(ibanSchema, "FR76").ok).toBe(false);
    expect(parse(ibanSchema, "7630006000011234567890189").ok).toBe(false);
  });
});

describe("bicSchema", () => {
  it("accepte 8 ou 11 caractères", () => {
    expect(parse(bicSchema, "AGRIFRPP").ok).toBe(true);
    expect(parse(bicSchema, "AGRIFRPP123").ok).toBe(true);
  });

  it("refuse les autres longueurs", () => {
    expect(parse(bicSchema, "AGRIFRP").ok).toBe(false);
    expect(parse(bicSchema, "AGRIFRPP1").ok).toBe(false);
  });
});

describe("phoneSchema", () => {
  it("accepte les formats français courants", () => {
    for (const numero of ["04 78 61 24 90", "+33 4 78 61 24 90", "04.78.61.24.90"]) {
      expect(parse(phoneSchema, numero).ok).toBe(true);
    }
  });

  it("refuse du texte", () => {
    expect(parse(phoneSchema, "appelez-moi").ok).toBe(false);
  });
});

describe("optionalEmailSchema", () => {
  it("accepte une adresse valide et la met en minuscules", () => {
    expect(parse(optionalEmailSchema, "Contact@Garage.FR").valeur).toBe(
      "contact@garage.fr",
    );
  });

  it("refuse une adresse malformée", () => {
    expect(parse(optionalEmailSchema, "contact@").ok).toBe(false);
    expect(parse(optionalEmailSchema, "arobase-absente.fr").ok).toBe(false);
  });

  it("accepte le vide", () => {
    expect(parse(optionalEmailSchema, "")).toEqual({ ok: true, valeur: null });
  });
});
