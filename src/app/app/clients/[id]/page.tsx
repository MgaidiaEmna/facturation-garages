import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AccessBanner } from "@/components/access-banner";
import { PageHeader } from "@/components/page-header";
import { requireGarage } from "@/lib/auth/session";
import { getClient } from "@/lib/catalog/queries";
import { formatDateShort } from "@/lib/format";
import { ClientForm } from "../client-form";
import { DeleteClientButton } from "../delete-client-button";

export const metadata: Metadata = {
  title: "Fiche client — Facturation multi-garages",
};

/** Un identifiant malformé est une page inexistante, pas une erreur 500. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ClientPage(props: PageProps<"/app/clients/[id]">) {
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();

  const { garage, access } = await requireGarage();
  const client = await getClient(id);

  // `null` couvre « n'existe pas » et « appartient à un autre garage » : le
  // RLS a filtré, la requête ne voit rien. Les deux donnent la même page.
  if (!client) notFound();

  return (
    <div className="space-y-8">
      <Button asChild variant="ghost" size="sm" className="-ms-3">
        <Link href="/app/clients">
          <ArrowLeft aria-hidden />
          Carnet de clients
        </Link>
      </Button>

      <PageHeader
        title={client.name}
        description={`Fiche modifiée le ${formatDateShort(client.updatedAt)}.`}
        action={
          access.canWrite ? (
            <DeleteClientButton
              clientId={client.id}
              label={client.name}
              redirectTo="/app/clients"
            />
          ) : null
        }
      />

      <AccessBanner garage={garage} access={access} />

      <Card>
        <CardContent>
          <ClientForm client={client} canWrite={access.canWrite} />
        </CardContent>
      </Card>
    </div>
  );
}
