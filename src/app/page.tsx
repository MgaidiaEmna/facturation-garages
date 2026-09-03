import Link from "next/link";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { isSupabaseConfigured, publicEnv } from "@/lib/env";
import { getLocale } from "@/lib/locale";
import { Button } from "@/components/ui/button";

/**
 * Page d'accueil provisoire (Phase 0).
 *
 * Tant que Supabase n'est pas branché, elle sert d'écran de configuration :
 * elle indique précisément ce qui manque plutôt que de laisser l'app planter.
 * La Phase 2 la remplacera par une redirection vers /login puis vers l'espace
 * correspondant au rôle.
 */
export default function Home() {
  const configured = isSupabaseConfigured();
  const locale = getLocale();

  const checklist = [
    { label: "Projet Next.js + Tailwind + shadcn/ui", done: true },
    { label: `Locale de facturation : ${locale.label} (${locale.currency})`, done: true },
    { label: "NEXT_PUBLIC_SUPABASE_URL", done: Boolean(publicEnv.NEXT_PUBLIC_SUPABASE_URL) },
    {
      label: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      done: Boolean(publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    },
    { label: "Migrations SQL + RLS (phase 1)", done: false },
    { label: "Authentification et rôles (phase 2)", done: false },
  ];

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground">Phase 0 — Bootstrap</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Facturation multi-garages
        </h1>
        <p className="text-muted-foreground">
          Le socle technique est en place. Renseignez les variables
          d&apos;environnement dans <code className="text-foreground">.env.local</code> pour
          brancher la base de données.
        </p>
      </div>

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

      {configured ? (
        <Button asChild className="self-start">
          <Link href="/login">Se connecter</Link>
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">
          Copiez <code className="text-foreground">.env.example</code> vers{" "}
          <code className="text-foreground">.env.local</code>, puis relancez le serveur.
        </p>
      )}

      <p className="border-t pt-6 text-xs text-muted-foreground">
        {locale.legalMentions.disclaimer}
      </p>
    </main>
  );
}
