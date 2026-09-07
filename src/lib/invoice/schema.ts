import { z } from "zod";

/**
 * Validation d'un brouillon de facture.
 *
 * Sans dépendance serveur : l'éditeur importe ces schémas pour un retour
 * immédiat. La validation qui fait autorité est celle de la Server Action,
 * doublée par la base — `invoice_lines_quantity_ck`, `invoice_lines_vat_rate_ck`
 * et les policies refuseraient de toute façon une saisie hors bornes.
 *
 * Ce qui est exigé ici est le minimum pour qu'un BROUILLON tienne debout. Les
 * mentions obligatoires d'une facture émise (nom du client, au moins une
 * ligne) sont contrôlées par `finalize_invoice()` au moment de l'émission :
 * on doit pouvoir enregistrer un brouillon incomplet et y revenir demain.
 */

/** Nombre saisi dans un champ de formulaire ; la virgule française passe. */
function numberField(message: string, fallback: number) {
  return z.preprocess((value) => {
    if (typeof value === "number") return value;
    if (typeof value !== "string") return fallback;
    const normalized = value.trim().replace(",", ".");
    return normalized === "" ? fallback : Number(normalized);
  }, z.number({ error: message }));
}

export const invoiceLineSchema = z.object({
  description: z.string().trim().max(300, "Désignation trop longue (300 caractères max)."),
  unit: z.string().trim().max(20, "Unité trop longue.").default("U"),
  quantity: numberField("Quantité invalide.", 0)
    .pipe(z.number().min(0, "La quantité ne peut pas être négative.").max(1_000_000)),
  unitPriceHt: numberField("Prix unitaire invalide.", 0)
    .pipe(z.number().min(0, "Le prix ne peut pas être négatif.").max(10_000_000)),
  vatRate: numberField("Taux de TVA invalide.", 0)
    .pipe(z.number().min(0, "Taux négatif impossible.").max(100, "Taux supérieur à 100 %.")),
});

export const invoiceDraftSchema = z.object({
  /** `null` pour une création, l'identifiant du brouillon pour une reprise. */
  invoiceId: z.uuid("Brouillon introuvable.").nullish(),

  clientName: z.string().trim().max(200, "Nom trop long (200 caractères max)."),
  clientAddress: z.string().trim().max(400, "Adresse trop longue."),
  clientPhone: z.string().trim().max(40, "Téléphone trop long."),
  clientVatNumber: z.string().trim().max(40, "Identifiant fiscal trop long."),

  issueDate: z.iso.date("Date d'émission invalide."),
  serviceDate: z
    .union([z.iso.date("Date de prestation invalide."), z.literal("")])
    .optional(),

  notes: z.string().trim().max(1000, "Note trop longue (1000 caractères max)."),

  /**
   * Plafond volontaire : au-delà, ce n'est plus une facture d'atelier mais un
   * envoi qui mérite un autre outil. Il protège aussi la charge utile.
   */
  lines: z.array(invoiceLineSchema).max(200, "Trop de lignes (200 maximum)."),
});

export type InvoiceDraftInput = z.infer<typeof invoiceDraftSchema>;
export type InvoiceLineInput = z.infer<typeof invoiceLineSchema>;
