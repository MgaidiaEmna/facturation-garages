import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ImageIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AccessBanner } from "@/components/access-banner";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requireGarage } from "@/lib/auth/session";
import { listLogos } from "@/lib/logos/queries";
import { LogoLibrary } from "./logo-library";

export const metadata: Metadata = {
  title: "Mes logos — Facturation multi-garages",
};

/**
 * Bibliothèque de logos — réservée aux comptes « premium ».
 *
 * ---------------------------------------------------------------------------
 * LA GARDE EST ICI, PAS SEULEMENT DANS LA NAVIGATION
 * ---------------------------------------------------------------------------
 * L'onglet n'apparaît pas pour un garage standard, mais un onglet caché n'a
 * jamais empêché personne de taper une URL. Cette page répond donc 404 quand
 * le drapeau est absent — et même si elle ne le faisait pas, `logos_write` et
 * les policies du bucket exigent `can_manage_logos()` : le garage verrait un
 * écran sans pouvoir y écrire. Trois barrières, dont une seule est visible.
 *
 * Le « premium » n'est pas un rôle : c'est le booléen
 * `garages.logo_management_enabled`, posé par l'administrateur.
 */
export default async function LogosPage() {
  const { garage, access } = await requireGarage();

  if (!garage.logoManagementEnabled) notFound();

  const logos = await listLogos();

  return (
    <div className="space-y-8">
      <PageHeader
        title="Mes logos"
        description="Votre bibliothèque. Le logo par défaut apparaît sur vos factures ; vous pouvez en choisir un autre facture par facture, dans l'éditeur."
      />

      <AccessBanner garage={garage} access={access} />

      {logos.length === 0 ? (
        <div className="space-y-8">
          <EmptyState
            icon={<ImageIcon className="size-5" aria-hidden />}
            title="Aucun logo dans votre bibliothèque"
            description="Sans logo, vos factures portent votre dénomination en tête — c'est parfaitement conforme. Ajoutez-en un si vous préférez votre identité visuelle."
          />
          <LogoLibrary logos={logos} canWrite={access.canWrite} />
        </div>
      ) : (
        <LogoLibrary logos={logos} canWrite={access.canWrite} />
      )}

      <p className="text-sm text-muted-foreground">
        Un logo qui figure déjà sur une facture émise ne peut plus être retiré : le
        document a été envoyé au client, il doit rester tel qu&apos;il était.{" "}
        <Button asChild variant="link" className="h-auto p-0">
          <Link href="/app/factures?statut=emises">Voir mes factures émises</Link>
        </Button>
      </p>
    </div>
  );
}
