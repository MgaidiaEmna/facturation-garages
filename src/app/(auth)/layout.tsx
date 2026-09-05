import Link from "next/link";
import { redirect } from "next/navigation";
import { Receipt } from "lucide-react";

import { isSupabaseConfigured } from "@/lib/env";
import { getLocale } from "@/lib/locale";

/**
 * Coquille des écrans d'authentification : connexion, inscription,
 * vérification, changement de mot de passe.
 *
 * Le disclaimer réglementaire reste visible partout dans l'application, y
 * compris avant la connexion (cf. CLAUDE.md, « Conformité France »).
 */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  // Sans projet Supabase, ces écrans n'ont rien à offrir : la page d'accueil
  // liste ce qui reste à brancher.
  if (!isSupabaseConfigured()) redirect("/");

  const locale = getLocale();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-6 py-12">
        <Link href="/" className="flex items-center gap-2 self-center text-sm font-medium">
          <Receipt className="size-4" aria-hidden />
          Facturation multi-garages
        </Link>

        {children}
      </main>

      <footer className="mx-auto w-full max-w-md px-6 pb-10">
        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          {locale.legalMentions.disclaimer}
        </p>
      </footer>
    </div>
  );
}
