import { z } from "zod";

/**
 * Saisie d'un encaissement hors ligne.
 *
 * Aucune dépendance serveur : le formulaire d'administration importe ces
 * définitions. La validation qui fait autorité reste celle de la Server
 * Action, et surtout celle de `register_payment()` — la fonction SQL refait
 * ses propres contrôles, puisqu'elle s'exécute hors RLS.
 */

/** Modes de règlement, calés sur l'enum `payment_method` de la base. */
export const PAYMENT_METHODS = [
  { value: "virement", label: "Virement" },
  { value: "cheque", label: "Chèque" },
  { value: "especes", label: "Espèces" },
  { value: "cb", label: "Carte bancaire" },
  { value: "autre", label: "Autre" },
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]["value"];

/** Libellé d'un mode de règlement, pour l'historique. */
export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method;
}

/** Durées proposées en un clic. La base accepte 1 à 60 mois. */
export const QUICK_DURATIONS = [1, 3, 6, 12] as const;

/** Montant : virgule française acceptée, champ vide traité comme « non renseigné ». */
const amountSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value ?? undefined;
    const normalized = value.trim().replace(",", ".");
    return normalized === "" ? undefined : Number(normalized);
  },
  z
    .number({ error: "Montant invalide." })
    .min(0, "Le montant ne peut pas être négatif.")
    .max(1_000_000, "Montant improbable — vérifiez la saisie.")
    .optional(),
);

/**
 * Prolongation : une durée OU une date, jamais les deux.
 *
 * Le `superRefine` porte le message sur le champ concerné plutôt qu'en tête
 * de formulaire : c'est là que se corrige l'erreur. La même règle est répétée
 * dans `register_payment()`, qui est le seul garde-fou qui compte.
 */
export const registerPaymentSchema = z
  .object({
    garageId: z.uuid("Garage introuvable."),
    amount: amountSchema,
    method: z.enum(
      PAYMENT_METHODS.map((m) => m.value) as [PaymentMethod, ...PaymentMethod[]],
      { error: "Mode de règlement inconnu." },
    ),
    paidOn: z.iso.date("Date de paiement invalide."),
    notes: z
      .string()
      .trim()
      .max(500, "Note trop longue (500 caractères maximum).")
      .transform((value) => (value === "" ? undefined : value))
      .optional(),
    months: z.preprocess(
      (value) => (value === "" || value === null || value === undefined ? undefined : Number(value)),
      z
        .int("Durée invalide.")
        .min(1, "La durée doit valoir au moins un mois.")
        .max(60, "La durée ne peut pas dépasser 60 mois.")
        .optional(),
    ),
    endDate: z.preprocess(
      (value) => (value === "" || value === null ? undefined : value),
      z.iso.date("Date de fin invalide.").optional(),
    ),
  })
  .superRefine((data, ctx) => {
    if (data.months === undefined && data.endDate === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["months"],
        message: "Choisissez une durée, ou fixez une date de fin.",
      });
    }
    if (data.months !== undefined && data.endDate !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "Indiquez une durée ou une date de fin, pas les deux.",
      });
    }
  });

export type RegisterPaymentInput = z.infer<typeof registerPaymentSchema>;

// ---------------------------------------------------------------------------
// État d'un abonnement
// ---------------------------------------------------------------------------

export type SubscriptionStatus = "none" | "active" | "expiring" | "expired";

/** En deçà de ce délai, l'échéance est signalée comme proche. */
export const EXPIRING_SOON_DAYS = 7;

/**
 * Jours entiers entre aujourd'hui et l'échéance. Négatif si elle est passée.
 *
 * Comparaison faite sur des dates civiles, pas sur des instants : un
 * abonnement qui finit « aujourd'hui » est valide toute la journée, comme le
 * dit `end_date >= current_date` en SQL. Passer par l'heure ferait expirer
 * l'abonnement à midi pour qui vit à l'est de Greenwich.
 */
export function daysUntil(endDate: string, today = new Date()): number {
  const [year, month, day] = endDate.split("-").map(Number);
  const end = Date.UTC(year, month - 1, day);
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((end - start) / 86_400_000);
}

/**
 * Statut affichable d'un abonnement.
 *
 * `expiring` n'est pas un état de la base : c'est `active` avec une échéance
 * proche. La base ne connaît que la comparaison de dates — c'est elle qui
 * décide de l'accès, pas ce calcul, qui ne sert qu'à colorer un badge.
 */
export function subscriptionStatus(
  endDate: string | null,
  today = new Date(),
): SubscriptionStatus {
  if (!endDate) return "none";
  const days = daysUntil(endDate, today);
  if (days < 0) return "expired";
  if (days <= EXPIRING_SOON_DAYS) return "expiring";
  return "active";
}
