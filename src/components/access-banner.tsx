import { CalendarClock, Gift, Lock, TriangleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatDate } from "@/lib/format";
import { daysUntil, subscriptionStatus } from "@/lib/admin/payment-schema";
import { trialRemaining, type AccessState, type GarageSummary } from "@/lib/auth/types";

/**
 * Bandeau d'état commercial d'un garage : essai en cours, essai épuisé,
 * abonnement échu, compte désactivé.
 *
 * ---------------------------------------------------------------------------
 * CE BANDEAU N'EST PAS UNE PROTECTION
 * ---------------------------------------------------------------------------
 * Il informe. Ce qui bloque réellement, c'est `finalize_invoice()` en base,
 * qui refait le contrôle et refuse d'émettre — quel que soit le chemin
 * d'écriture. Le texte affiché ici est d'ailleurs celui que produit la base
 * (`finalize_block_message()`), pour qu'annonce et refus ne puissent pas
 * diverger.
 */
export function AccessBanner({
  garage,
  access,
}: {
  garage: GarageSummary;
  access: AccessState;
}) {
  if (!garage.isActive) {
    return (
      <Alert variant="destructive" className="border-destructive/30">
        <Lock aria-hidden />
        <AlertTitle>Compte désactivé</AlertTitle>
        <AlertDescription>
          Vos factures restent consultables, mais aucune écriture n&apos;est
          possible. Contactez l&apos;administrateur.
        </AlertDescription>
      </Alert>
    );
  }

  // Abonnement échu : l'espace passe en lecture seule. Le titre le dit et
  // indique quoi faire — « suspendu » sans suite laisse la personne devant
  // un écran mort.
  if (access.finalizeBlockReason === "subscription_expired") {
    return (
      <Alert variant="destructive" className="border-destructive/30">
        <Lock aria-hidden />
        <AlertTitle>Abonnement expiré — contactez l&apos;administrateur</AlertTitle>
        <AlertDescription>
          <p>
            {access.finalizeBlockMessage ??
              "Abonnement expiré : impossible de finaliser une facture."}{" "}
            {access.subscriptionEndDate ? (
              <>Il a pris fin le {formatDate(access.subscriptionEndDate)}. </>
            ) : null}
            Votre espace passe en lecture seule.
          </p>
          <p>
            Vos factures, vos clients et vos prestations restent consultables et
            intacts. Tout redevient modifiable dès que le paiement est enregistré.
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  // Essai gratuit épuisé, ou autre motif : le message vient de la base.
  if (access.finalizeBlockReason) {
    return (
      <Alert variant="destructive" className="border-destructive/30">
        <TriangleAlert aria-hidden />
        <AlertTitle>
          {access.finalizeBlockReason === "trial_exhausted"
            ? "Essai gratuit terminé"
            : "Émission de factures suspendue"}
        </AlertTitle>
        <AlertDescription>
          {access.finalizeBlockMessage ??
            "Impossible de finaliser une facture pour le moment."}
          {access.finalizeBlockReason === "trial_exhausted" ? (
            <> Vos brouillons restent modifiables en attendant.</>
          ) : null}
        </AlertDescription>
      </Alert>
    );
  }

  if (garage.accountStatus === "trial") {
    const remaining = trialRemaining(garage);
    return (
      <Alert>
        <Gift aria-hidden />
        <AlertTitle>Essai gratuit</AlertTitle>
        <AlertDescription>
          Il vous reste {remaining} facture{remaining > 1 ? "s" : ""} à finaliser sur
          les {garage.trialInvoiceLimit} offertes. Les brouillons sont illimités.
        </AlertDescription>
      </Alert>
    );
  }

  if (access.subscriptionEndDate) {
    // Échéance proche : on prévient AVANT la coupure. Découvrir qu'on ne peut
    // plus facturer le matin où l'on doit facturer, c'est le pire moment.
    if (subscriptionStatus(access.subscriptionEndDate) === "expiring") {
      const jours = daysUntil(access.subscriptionEndDate);
      return (
        <Alert>
          <CalendarClock aria-hidden />
          <AlertTitle>Abonnement à renouveler</AlertTitle>
          <AlertDescription>
            Abonnement actif jusqu&apos;au {formatDate(access.subscriptionEndDate)} —{" "}
            {jours === 0
              ? "dernier jour"
              : `plus que ${jours} jour${jours > 1 ? "s" : ""}`}
            . Contactez l&apos;administrateur pour le prolonger, sans quoi
            l&apos;émission de factures sera suspendue.
          </AlertDescription>
        </Alert>
      );
    }

    return (
      <p className="text-sm text-muted-foreground">
        Abonnement actif jusqu&apos;au {formatDate(access.subscriptionEndDate)}.
      </p>
    );
  }

  return null;
}
