import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RetryProvisioningButton } from "@/components/auth/retry-provisioning-button";
import { SignOutButton } from "@/components/auth/sign-out-button";

export const metadata: Metadata = {
  title: "Accès impossible — Facturation multi-garages",
};

/**
 * Impasse d'authentification. Chaque motif dit ce qui s'est passé ET ce qu'il
 * faut faire ensuite — un « une erreur est survenue » n'aide personne.
 */
const REASONS: Record<string, { title: string; description: string }> = {
  lien_invalide: {
    title: "Lien de vérification invalide",
    description:
      "Ce lien n'est pas exploitable. Il a peut-être été tronqué par votre messagerie : " +
      "réessayez en le copiant entièrement dans la barre d'adresse.",
  },
  lien_expire: {
    title: "Lien de vérification expiré",
    description:
      "Ce lien a expiré ou a déjà servi. Recommencez l'inscription avec la même " +
      "adresse pour en recevoir un nouveau.",
  },
  email_non_verifie: {
    title: "Adresse e-mail non vérifiée",
    description:
      "Votre compte existe, mais son adresse n'a pas été confirmée. Tant qu'elle ne " +
      "l'est pas, aucune donnée n'est accessible. Ouvrez le lien reçu par e-mail.",
  },
  compte_non_provisionne: {
    title: "Compte sans garage rattaché",
    description:
      "Ce compte est authentifié mais n'est rattaché à aucun garage. " +
      "Contactez l'administrateur pour qu'il finalise sa création.",
  },
};

const FALLBACK = {
  title: "Accès impossible",
  description:
    "Nous n'avons pas pu ouvrir votre espace. Reconnectez-vous ; si le problème " +
    "persiste, contactez l'administrateur.",
};

export default async function AuthErrorPage(props: PageProps<"/auth/error">) {
  const params = await props.searchParams;
  const raw = Array.isArray(params.reason) ? params.reason[0] : params.reason;
  const reason = (raw && REASONS[raw]) || FALLBACK;

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-12">
      <Card>
        <CardHeader>
          <div className="mb-2 flex size-9 items-center justify-center rounded-full bg-muted">
            <ShieldAlert className="size-4" aria-hidden />
          </div>
          <CardTitle className="text-xl">{reason.title}</CardTitle>
          <CardDescription>{reason.description}</CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-2">
          {/* Provisionnement raté après vérification : le lien de confirmation
              est à usage unique, il faut une seconde chance ici. */}
          {raw === "compte_non_provisionne" ? <RetryProvisioningButton /> : null}

          <Button asChild variant="outline">
            <Link href="/login">Retour à la connexion</Link>
          </Button>
          {/* La session peut exister tout en étant inutilisable (adresse non
              vérifiée, compte non provisionné) : sans ce bouton, l'utilisateur
              est renvoyé ici en boucle par le proxy. */}
          <SignOutButton variant="ghost" label="Fermer la session" />
        </CardContent>
      </Card>
    </div>
  );
}
