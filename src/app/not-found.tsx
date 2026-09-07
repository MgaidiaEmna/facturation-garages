import Link from "next/link";
import { Compass, Home } from "lucide-react";

import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";

/**
 * 404 — l'adresse ne mène nulle part.
 *
 * ---------------------------------------------------------------------------
 * UNE PAGE VOLONTAIREMENT PEU BAVARDE
 * ---------------------------------------------------------------------------
 * Elle sert deux publics qu'on ne peut pas distinguer : quelqu'un qui s'est
 * trompé d'adresse, et quelqu'un qui cherche ce qui existe. Sur une
 * application multi-locataires, `/app/logos` répond 404 à un garage non
 * premium et `/app/factures/<id>` répond 404 pour la facture d'un autre
 * garage — c'est délibéré, et cette page ne doit surtout pas laisser deviner
 * laquelle des deux situations elle recouvre.
 *
 * D'où un texte unique, sans « vous n'avez pas accès » ni « cette facture
 * appartient à un autre » : la seule chose qu'on affirme, c'est qu'il n'y a
 * rien à cette adresse.
 *
 * Le lien de sortie pointe vers « / », l'aiguillage : il renvoie chacun dans
 * son espace sans que cette page ait à connaître le rôle du visiteur.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-6 py-16 text-center">
      <BrandMark tone="dark" className="mb-10" />

      <div className="mb-5 flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Compass aria-hidden className="size-6" />
      </div>

      <p className="text-sm font-medium tracking-wide text-muted-foreground">Erreur 404</p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">Cette page n&apos;existe pas</h1>

      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        L&apos;adresse demandée ne correspond à rien. Elle a peut-être changé, ou
        le lien que vous avez suivi est périmé.
      </p>

      <Button asChild className="mt-7">
        <Link href="/">
          <Home aria-hidden />
          Revenir à mon espace
        </Link>
      </Button>
    </main>
  );
}
