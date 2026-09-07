"use client";

import Link from "next/link";
import { AlertTriangle, Home, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * L'écran qu'on voit quand quelque chose a cassé.
 *
 * ---------------------------------------------------------------------------
 * CE QU'IL DIT, ET CE QU'IL NE DIT PAS
 * ---------------------------------------------------------------------------
 * Il dit : ce qui s'est passé, que les données ne sont pas perdues, et par où
 * sortir. Il ne dit PAS la pile d'appels ni le message de l'exception : sur
 * une application multi-locataires, un message d'erreur brut raconte volontiers
 * le nom d'une table, une contrainte, parfois une valeur. Ce n'est pas au
 * garagiste de lire ça, et ce n'est pas à un visiteur de l'apprendre.
 *
 * Le `digest` de Next, lui, est affiché : c'est un identifiant opaque, sans
 * contenu, qui permet de retrouver l'erreur dans les journaux du serveur. Le
 * seul élément techniquement utile qu'on puisse montrer sans rien divulguer.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI « RÉESSAYER » AVANT « ACCUEIL »
 * ---------------------------------------------------------------------------
 * La grande majorité de ces écrans vient d'un aléa réseau ou d'une base
 * momentanément injoignable. `reset()` refait le rendu du segment sans
 * recharger la page : neuf fois sur dix, c'est suffisant, et la personne ne
 * perd pas sa navigation.
 */
export function ErrorScreen({
  titre = "Quelque chose s'est mal passé",
  description,
  digest,
  reset,
  retour,
}: {
  titre?: string;
  description?: React.ReactNode;
  /** Identifiant opaque de l'erreur, posé par Next. */
  digest?: string;
  /** Refait le rendu du segment fautif. Absent sur `global-error`. */
  reset?: () => void;
  /** Où mène le bouton de repli. */
  retour?: { href: string; libelle: string };
}) {
  const sortie = retour ?? { href: "/", libelle: "Retour à l'accueil" };

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center px-6 py-16 text-center">
      <div className="mb-5 flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <AlertTriangle aria-hidden className="size-6" />
      </div>

      <h1 className="text-xl font-semibold tracking-tight text-foreground">{titre}</h1>

      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {description ?? (
          <>
            L&apos;écran n&apos;a pas pu s&apos;afficher. Rien n&apos;a été perdu :
            vos factures et vos données sont intactes. Réessayez — si cela
            recommence, signalez-le en indiquant la référence ci-dessous.
          </>
        )}
      </p>

      <div className="mt-7 flex flex-wrap justify-center gap-2">
        {reset ? (
          <Button onClick={reset}>
            <RotateCcw aria-hidden />
            Réessayer
          </Button>
        ) : null}
        <Button asChild variant={reset ? "outline" : "default"}>
          <Link href={sortie.href}>
            <Home aria-hidden />
            {sortie.libelle}
          </Link>
        </Button>
      </div>

      {digest ? (
        <p className="mt-8 text-xs text-muted-foreground">
          Référence de l&apos;incident :{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{digest}</code>
        </p>
      ) : null}
    </div>
  );
}
