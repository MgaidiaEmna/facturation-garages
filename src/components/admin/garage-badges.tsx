import { Badge } from "@/components/ui/badge";
import { formatDateShort } from "@/lib/format";
import type { GarageAccountStatus } from "@/lib/auth/types";

/**
 * Pastilles d'état d'un garage, partagées par la liste des comptes et celle
 * des fiches.
 *
 * Elles sont ici, et pas recopiées dans chaque écran, pour une raison
 * précise : « essai 3/3 » et « abonnement expiré » n'ont pas le même sens et
 * ne se soignent pas de la même façon. Deux copies finiraient par se
 * contredire — l'une annonçant un accès ouvert, l'autre un accès fermé, pour
 * le même garage.
 *
 * Aucune de ces règles n'est recalculée : le statut vient de
 * `garages.account_status`, la date de `subscriptions.end_date`. L'affichage
 * ne fait que les traduire.
 */

export interface AccessBadgeProps {
  accountStatus: GarageAccountStatus;
  trialInvoicesUsed: number;
  trialInvoiceLimit: number;
  subscriptionEndDate: string | null;
}

/** Essai en cours, abonnement en vigueur, ou abonnement échu. */
export function AccessBadge({
  accountStatus,
  trialInvoicesUsed,
  trialInvoiceLimit,
  subscriptionEndDate,
}: AccessBadgeProps) {
  if (accountStatus === "trial") {
    const exhausted = trialInvoicesUsed >= trialInvoiceLimit;
    return (
      <Badge variant={exhausted ? "destructive" : "secondary"}>
        Essai {trialInvoicesUsed} / {trialInvoiceLimit}
      </Badge>
    );
  }

  if (!subscriptionEndDate) {
    return <Badge variant="destructive">Sans abonnement</Badge>;
  }

  const expired = new Date(subscriptionEndDate) < new Date();
  return (
    <Badge variant={expired ? "destructive" : "outline"}>
      {expired ? "Expiré le " : "Jusqu'au "}
      {formatDateShort(subscriptionEndDate)}
    </Badge>
  );
}

/** Garage désactivé : espace en lecture seule, émission bloquée. */
export function InactiveBadge() {
  return <Badge variant="destructive">Désactivé</Badge>;
}

/** Drapeau « premium » — bibliothèque de logos débloquée. Ce n'est pas un rôle. */
export function PremiumBadge() {
  return <Badge variant="secondary">Premium</Badge>;
}

/**
 * Mentions obligatoires manquantes. La facture les exigera : mieux vaut le
 * dire tant que la fiche est ouverte que le découvrir à l'émission.
 */
export function IncompleteBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <Badge variant="outline" className="border-destructive/40 text-destructive">
      Fiche incomplète ({count})
    </Badge>
  );
}
