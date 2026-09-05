import type { Metadata } from "next";
import { Gift } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Créer un compte — Facturation multi-garages",
};

/** Nombre de factures offertes. Reflète `garages.trial_invoice_limit`, dont
 *  la valeur fait foi côté serveur : c'est elle qui bloque, pas ce texte. */
const TRIAL_INVOICES = 3;

export default function SignupPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Créer un compte</CardTitle>
        <CardDescription>
          Essayez la facturation conforme sans engagement.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <Alert>
          <Gift aria-hidden />
          <AlertTitle>Essai gratuit</AlertTitle>
          <AlertDescription>
            {TRIAL_INVOICES} factures finalisées offertes. Les brouillons restent
            illimités. Pour aller plus loin, l&apos;administrateur active votre
            abonnement.
          </AlertDescription>
        </Alert>

        <SignupForm />
      </CardContent>
    </Card>
  );
}
