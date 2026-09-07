import type { AccessState, GarageSummary } from "@/lib/auth/types";

/**
 * Pourquoi l'espace est en lecture seule, en une phrase.
 *
 * Le FAIT vient du serveur (`access.canWrite`, calculé par
 * `has_write_access()` en base) ; cette fonction ne fait que l'habiller. Elle
 * ne décide de rien et ne recalcule aucune règle — sans quoi l'écran pourrait
 * annoncer « lecture seule » à un garage qui a le droit d'écrire, ou l'inverse.
 *
 * Nuance à ne pas perdre : un essai gratuit ÉPUISÉ ne ferme pas l'écriture.
 * Le garage continue de saisir ses brouillons ; c'est l'émission qui est
 * plafonnée, et c'est le bandeau de l'espace qui le dit.
 */
export function readOnlyReason(
  garage: GarageSummary,
  access: AccessState,
): string | null {
  if (access.canWrite) return null;

  if (!garage.isActive) {
    return "Ce compte est désactivé par l'administrateur.";
  }
  return "Votre abonnement a expiré : contactez l'administrateur pour le renouveler.";
}
