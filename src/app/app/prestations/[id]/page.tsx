import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AccessBanner } from "@/components/access-banner";
import { PageHeader } from "@/components/page-header";
import { requireGarage } from "@/lib/auth/session";
import { getService } from "@/lib/catalog/queries";
import { formatDateShort } from "@/lib/format";
import { DEFAULT_LOCALE, type LocaleCode } from "@/lib/locale";
import { ServiceForm } from "../service-form";
import { DeleteServiceButton } from "../delete-service-button";

export const metadata: Metadata = {
  title: "Prestation — Facturation multi-garages",
};

/** Un identifiant malformé est une page inexistante, pas une erreur 500. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ServicePage(props: PageProps<"/app/prestations/[id]">) {
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();

  const { garage, access } = await requireGarage();
  const service = await getService(id);

  // `null` couvre « n'existe pas » et « appartient à un autre garage ».
  if (!service) notFound();

  return (
    <div className="space-y-8">
      <Button asChild variant="ghost" size="sm" className="-ms-3">
        <Link href="/app/prestations">
          <ArrowLeft aria-hidden />
          Catalogue de prestations
        </Link>
      </Button>

      <PageHeader
        title={service.label}
        description={`Prestation modifiée le ${formatDateShort(service.updatedAt)}.`}
        action={
          access.canWrite ? (
            <DeleteServiceButton
              serviceId={service.id}
              label={service.label}
              redirectTo="/app/prestations"
            />
          ) : null
        }
      />

      <AccessBanner garage={garage} access={access} />

      <Card>
        <CardContent>
          <ServiceForm
            service={service}
            localeCode={(garage.locale as LocaleCode) || DEFAULT_LOCALE}
            canWrite={access.canWrite}
          />
        </CardContent>
      </Card>
    </div>
  );
}
