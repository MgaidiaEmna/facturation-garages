import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Vérifiez votre e-mail — Facturation multi-garages",
};

/**
 * Écran affiché après l'inscription.
 *
 * Il est volontairement IDENTIQUE que l'adresse soit nouvelle ou déjà
 * inscrite : distinguer les deux cas transformerait l'inscription en moyen de
 * savoir qui est client chez nous.
 */
export default async function VerificationPage(
  props: PageProps<"/signup/verification">,
) {
  const params = await props.searchParams;
  const raw = Array.isArray(params.email) ? params.email[0] : params.email;

  return (
    <Card>
      <CardHeader>
        <div className="mb-2 flex size-9 items-center justify-center rounded-full bg-muted">
          <MailCheck className="size-4" aria-hidden />
        </div>
        <CardTitle className="text-xl">Vérifiez votre e-mail</CardTitle>
        <CardDescription>
          {raw ? (
            <>
              Un lien de confirmation vient d&apos;être envoyé à{" "}
              <span className="font-medium text-foreground">{raw}</span>.
            </>
          ) : (
            "Un lien de confirmation vient de vous être envoyé."
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            Ouvrez ce lien pour activer votre compte. Tant que l&apos;adresse
            n&apos;est pas vérifiée, aucune donnée n&apos;est accessible.
          </p>
          <p>
            Rien reçu au bout de quelques minutes ? Vérifiez vos courriers
            indésirables.
          </p>
        </div>

        <Button asChild variant="outline" className="w-full">
          <Link href="/login">Retour à la connexion</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
