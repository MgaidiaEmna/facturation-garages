import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { safeNextPath } from "@/lib/auth/routes";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Connexion — Facturation multi-garages",
};

/**
 * Page de connexion, unique porte d'entrée des deux espaces.
 *
 * La destination après connexion est décidée par la page d'accueil, à partir
 * du rôle lu en base. `next` n'est qu'une préférence, filtrée par
 * `safeNextPath()` pour qu'elle ne serve pas de tremplin vers un site tiers.
 */
export default async function LoginPage(props: PageProps<"/login">) {
  const params = await props.searchParams;
  const raw = Array.isArray(params.next) ? params.next[0] : params.next;
  const next = safeNextPath(raw);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Connexion</CardTitle>
        <CardDescription>
          Accédez à votre espace de facturation.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm next={next ?? undefined} />
      </CardContent>
    </Card>
  );
}
