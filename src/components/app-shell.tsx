import Link from "next/link";

import { BrandMark } from "@/components/brand";
import { MainNav, type NavItem } from "@/components/main-nav";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { getLocale } from "@/lib/locale";

export type { NavItem };

/**
 * Coquille commune aux deux espaces authentifiés.
 *
 * Un bandeau marine tient l'identité : icône, nom de l'application, espace
 * courant, navigation. Le contenu, lui, reste sur fond clair — une facture se
 * lit sur du blanc, et l'écran qui la prépare doit s'en approcher.
 *
 * Le disclaimer réglementaire reste en pied de page, visible partout dans
 * l'application (cf. CLAUDE.md, « Conformité France »).
 */
export function AppShell({
  spaceLabel,
  accountLabel,
  nav,
  homeHref,
  children,
}: {
  /** Espace courant : « Administration », ou le nom du garage. */
  spaceLabel: string;
  accountLabel: string;
  nav: NavItem[];
  /** Racine de l'espace, pour que l'onglet d'accueil ne reste pas allumé partout. */
  homeHref: string;
  children: React.ReactNode;
}) {
  const locale = getLocale();

  return (
    <div className="flex min-h-full flex-1 flex-col bg-muted/40">
      {/*
        Lien d'évitement : le premier élément focalisable de la page, invisible
        tant qu'il n'a pas le focus. Sans lui, quelqu'un qui navigue au clavier
        retraverse l'en-tête, les cinq onglets et le bouton de déconnexion
        AVANT d'atteindre le contenu — sur chaque écran, à chaque fois.
      */}
      <a
        href="#contenu"
        className="sr-only rounded-md bg-brand-dark px-4 py-2 text-sm font-medium text-white focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50"
      >
        Aller au contenu
      </a>

      <header className="bg-brand text-white">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-4 px-6 py-3.5">
          <Link
            href={homeHref}
            className="flex items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            <BrandMark size="sm" />
            <span aria-hidden className="h-5 w-px bg-white/25" />
            <span className="text-sm text-white/85">{spaceLabel}</span>
          </Link>

          <MainNav items={nav} homeHref={homeHref} />

          <div className="ms-auto flex items-center gap-3">
            <span className="hidden text-sm text-white/75 sm:inline">{accountLabel}</span>
            <div className="w-auto [&_button]:w-auto [&_button]:text-white [&_button:hover]:bg-white/10 [&_button:hover]:text-white">
              <SignOutButton variant="ghost" />
            </div>
          </div>
        </div>
      </header>

      {/* `tabIndex={-1}` : sans lui, le saut déplace le défilement mais pas le
          FOCUS, et la tabulation suivante repartirait du haut de la page. */}
      <main
        id="contenu"
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl flex-1 px-6 py-10 focus:outline-none"
      >
        {children}
      </main>

      <footer className="mx-auto w-full max-w-6xl px-6 pb-10">
        <p className="border-t pt-6 text-xs leading-relaxed text-muted-foreground">
          {locale.legalMentions.disclaimer}
        </p>
      </footer>
    </div>
  );
}
