import type { Metadata } from "next";
import { CircleDashed, FileText } from "lucide-react";

import { AccessBanner } from "@/components/access-banner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLocale } from "@/lib/locale";
import { requireGarage } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Mon espace — Facturation multi-garages",
};

export default async function GarageHomePage() {
  const { garage, access, fullName } = await requireGarage();
  const locale = getLocale();

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Bonjour{fullName ? ` ${fullName}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">
          Espace de facturation de {garage.name} — {locale.label}, {locale.currency}.
        </p>
      </div>

      <AccessBanner garage={garage} access={access} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="size-4" aria-hidden />
            Facturation
          </CardTitle>
          <CardDescription>
            L&apos;éditeur de facture, le carnet de clients et le catalogue de
            prestations arrivent aux phases suivantes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {[
              "Éditeur de facture avec aperçu temps réel",
              "Numérotation séquentielle et finalisation",
              "Carnet de clients et catalogue de prestations",
              "Export PDF conforme",
            ].map((item) => (
              <li key={item} className="flex items-center gap-2">
                <CircleDashed className="size-3.5 shrink-0" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
