import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, CircleDashed, LogIn, UserPlus } from "lucide-react";

import { isSupabaseConfigured, publicEnv } from "@/lib/env";
import { getLocale } from "@/lib/locale";
import { ROUTES, homeForRole, safeNextPath } from "@/lib/auth/routes";
import { getAuthContext } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";

/**
 * Page d'accueil et AIGUILLAGE.
 *
 * C'est ici — et nulle part ailleurs — qu'on décide où atterrit une personne
 * connectée. La connexion, la confirmation d'e-mail et le changement de mot
 * de passe renvoient tous vers `/` plutôt que de recalculer chacun leur
 * destination : une seule règle, lue depuis le serveur.
 *
 * Le proxy, lui, ne sait que dire s'il y a une session. L'ordre ci-dessous
 * (adresse vérifiée -> profil rattaché -> mot de passe changé -> espace du
 * rôle) est le même que celui des gardes de layout ; c'est voulu, une
 * personne qui contourne cette page tombe sur la même barrière.
 */
export default async function Home(props: PageProps<"/">) {
  const configured = isSupabaseConfigured();

  if (configured) {
    const context = await getAuthContext();

    if (context) {
      if (!context.access.emailVerified) {
        redirect(`${ROUTES.authError}?reason=email_non_verifie`);
      }
      if (!context.access.hasProfile || !context.role) {
        redirect(`${ROUTES.authError}?reason=compte_non_provisionne`);
      }
      if (context.access.mustChangePassword) {
        redirect(ROUTES.changePassword);
      }

      const home = homeForRole(context.role);
      const params = await props.searchParams;
      const raw = Array.isArray(params.next) ? params.next[0] : params.next;
      const next = safeNextPath(raw);

      // `next` ne peut ramener que dans l'espace du rôle : il ne sert pas à
      // faire un tour chez le voisin.
      redirect(next && (next === home || next.startsWith(`${home}/`)) ? next : home);
    }
  }

  return <LandingScreen configured={configured} />;
}

function LandingScreen({ configured }: { configured: boolean }) {
  const locale = getLocale();

  const checklist = [
    { label: "Projet Next.js + Tailwind + shadcn/ui", done: true },
    { label: `Locale de facturation : ${locale.label} (${locale.currency})`, done: true },
    { label: "NEXT_PUBLIC_SUPABASE_URL", done: Boolean(publicEnv.NEXT_PUBLIC_SUPABASE_URL) },
    {
      label: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      done: Boolean(publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    },
  ];

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">
          Facturation multi-garages
        </h1>
        <p className="text-muted-foreground">
          Créez une facture conforme en deux minutes : client, prestations, calcul
          HT / TVA / TTC en temps réel et export PDF.
        </p>
      </div>

      {configured ? (
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href={ROUTES.signup}>
              <UserPlus aria-hidden />
              Essayer gratuitement
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href={ROUTES.login}>
              <LogIn aria-hidden />
              Se connecter
            </Link>
          </Button>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Renseignez les variables d&apos;environnement dans{" "}
            <code className="text-foreground">.env.local</code> pour brancher la base
            de données.
          </p>
          <ul className="divide-y rounded-lg border">
            {checklist.map((item) => (
              <li key={item.label} className="flex items-center gap-3 px-4 py-3 text-sm">
                {item.done ? (
                  <CheckCircle2 className="size-4 shrink-0 text-foreground" aria-hidden />
                ) : (
                  <CircleDashed className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className={item.done ? "" : "text-muted-foreground"}>{item.label}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        {locale.legalMentions.disclaimer}
      </p>
    </main>
  );
}
