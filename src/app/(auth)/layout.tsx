import Link from "next/link";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/brand";
import { isSupabaseConfigured } from "@/lib/env";
import { getLocale } from "@/lib/locale";

/**
 * Coquille des écrans d'authentification : connexion, inscription,
 * vérification, changement de mot de passe.
 *
 * C'est la première page que voit un client — et souvent la seule avant qu'il
 * décide de faire confiance. D'où le soin : la marque en évidence, une carte
 * centrée sur un fond retenu, et rien d'autre à l'écran.
 *
 * Le disclaimer réglementaire reste visible, y compris avant la connexion
 * (cf. CLAUDE.md, « Conformité France »).
 */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  // Sans projet Supabase, ces écrans n'ont rien à offrir : la page d'accueil
  // liste ce qui reste à brancher.
  if (!isSupabaseConfigured()) redirect("/");

  const locale = getLocale();

  return (
    <div className="relative flex min-h-full flex-1 flex-col bg-muted/40">
      {/* Voile marine en haut de page : la marque avant même la carte. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-brand/10 to-transparent"
      />

      <main className="relative mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-7 px-6 py-14">
        <Link
          href="/"
          className="self-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          <BrandMark size="lg" tone="dark" />
        </Link>

        {children}
      </main>

      <footer className="relative mx-auto w-full max-w-md px-6 pb-10">
        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          {locale.legalMentions.disclaimer}
        </p>
      </footer>
    </div>
  );
}
