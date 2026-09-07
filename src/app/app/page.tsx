import type { Metadata } from "next";
import { CircleDashed, FilePlus2, FileText, Users, Wrench } from "lucide-react";

import Link from "next/link";

import { AccessBanner } from "@/components/access-banner";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getLocale } from "@/lib/locale";
import { requireGarage } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Mon espace — Facturation multi-garages",
};

/** Ce qui arrive, dans l'ordre des phases. Annoncé plutôt que promis. */
const A_VENIR = [
  {
    icon: FileText,
    titre: "Numérotation et émission",
    detail:
      "Le numéro séquentiel est attribué à l'émission, jamais à l'ouverture du brouillon.",
  },
  {
    icon: Users,
    titre: "Carnet de clients",
    detail: "Les coordonnées saisies une fois, reprises sur chaque facture.",
  },
  {
    icon: Wrench,
    titre: "Catalogue de prestations",
    detail: "Vos interventions courantes et leurs tarifs, prêtes à insérer.",
  },
];

export default async function GarageHomePage() {
  const { garage, access, fullName } = await requireGarage();
  const locale = getLocale();

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Bonjour${fullName ? ` ${fullName}` : ""}`}
        description={`Espace de facturation de ${garage.name} — ${locale.label}, ${locale.currency}.`}
        action={
          <Button asChild>
            <Link href="/app/factures/nouveau">
              <FilePlus2 aria-hidden />
              Nouvelle facture
            </Link>
          </Button>
        }
      />

      <AccessBanner garage={garage} access={access} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Votre facturation</CardTitle>
          <CardDescription>
            Voici ce qui arrive dans votre espace, dans l&apos;ordre où nous le
            construisons.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {A_VENIR.map(({ icon: Icone, titre, detail }) => (
              <li key={titre} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <Icone className="size-4" aria-hidden />
                </span>
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{titre}</p>
                  <p className="text-sm leading-relaxed text-muted-foreground">{detail}</p>
                </div>
              </li>
            ))}
          </ul>

          <p className="mt-5 flex items-center gap-2 border-t pt-4 text-sm text-muted-foreground">
            <CircleDashed className="size-3.5 shrink-0" aria-hidden />
            Export PDF conforme et bibliothèque de logos suivront.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
