import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { CreateAccountForm } from "./create-account-form";

export const metadata: Metadata = {
  title: "Nouveau compte garage — Administration",
};

/** Un an d'abonnement par défaut, modifiable dans le formulaire. */
function defaultSubscriptionEnd(): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);
  return date.toISOString().slice(0, 10);
}

export default function NewAccountPage() {
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHeader
        title="Nouveau compte garage"
        description="Création directe, sans vérification d'e-mail : le compte est actif immédiatement."
      />

      <Alert>
        <ShieldCheck aria-hidden />
        <AlertTitle>Ce que vous saurez du mot de passe</AlertTitle>
        <AlertDescription>
          Vous fixez ici un mot de passe initial, que vous transmettez au garage. Il
          devra le remplacer dès sa première connexion, et le nouveau vous sera
          définitivement inconnu — vous serez seulement averti·e du changement.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Identité et accès</CardTitle>
          <CardDescription>
            L&apos;identité légale complète (SIRET, RCS, capital) se renseigne
            ensuite sur la fiche du garage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateAccountForm defaultEndDate={defaultSubscriptionEnd()} />
        </CardContent>
      </Card>
    </div>
  );
}
