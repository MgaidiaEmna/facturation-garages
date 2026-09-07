import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AccessBanner } from "@/components/access-banner";
import { PageHeader } from "@/components/page-header";
import { requireGarage } from "@/lib/auth/session";
import { ClientForm } from "../client-form";

export const metadata: Metadata = {
  title: "Nouveau client — Facturation multi-garages",
};

export default async function NewClientPage() {
  const { garage, access } = await requireGarage();

  return (
    <div className="space-y-8">
      <Button asChild variant="ghost" size="sm" className="-ms-3">
        <Link href="/app/clients">
          <ArrowLeft aria-hidden />
          Carnet de clients
        </Link>
      </Button>

      <PageHeader
        title="Nouveau client"
        description="Seul le nom est obligatoire — le reste se complète au fil des factures."
      />

      <AccessBanner garage={garage} access={access} />

      <Card>
        <CardContent>
          <ClientForm client={null} canWrite={access.canWrite} />
        </CardContent>
      </Card>
    </div>
  );
}
