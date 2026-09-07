import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AccessBanner } from "@/components/access-banner";
import { PageHeader } from "@/components/page-header";
import { requireGarage } from "@/lib/auth/session";
import { DEFAULT_LOCALE, type LocaleCode } from "@/lib/locale";
import { ServiceForm } from "../service-form";

export const metadata: Metadata = {
  title: "Nouvelle prestation — Facturation multi-garages",
};

export default async function NewServicePage() {
  const { garage, access } = await requireGarage();

  return (
    <div className="space-y-8">
      <Button asChild variant="ghost" size="sm" className="-ms-3">
        <Link href="/app/prestations">
          <ArrowLeft aria-hidden />
          Catalogue de prestations
        </Link>
      </Button>

      <PageHeader
        title="Nouvelle prestation"
        description="Un point de départ pour vos lignes de facture : prix et taux resteront modifiables ligne par ligne."
      />

      <AccessBanner garage={garage} access={access} />

      <Card>
        <CardContent>
          <ServiceForm
            service={null}
            localeCode={(garage.locale as LocaleCode) || DEFAULT_LOCALE}
            canWrite={access.canWrite}
          />
        </CardContent>
      </Card>
    </div>
  );
}
