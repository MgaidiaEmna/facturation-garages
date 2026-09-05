import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isSupabaseConfigured, requireSupabaseEnv } from "@/lib/env";
import { ROUTES, isGuestOnly, requiresAuth } from "@/lib/auth/routes";

/**
 * Rafraîchit la session Supabase à chaque requête et propage les cookies mis à
 * jour vers la réponse. Sans cela, le token d'accès expire et les Server
 * Components voient un utilisateur déconnecté.
 *
 * ---------------------------------------------------------------------------
 * CE QUE LE PROXY FAIT — ET CE QU'IL NE FAIT PAS
 * ---------------------------------------------------------------------------
 * Il tranche UNIQUEMENT sur la présence d'une session : rediriger un visiteur
 * vers /login, écarter un connecté de /login. C'est une commodité de
 * navigation, pas un contrôle d'accès.
 *
 * Le rôle, le provisionnement du compte et le changement de mot de passe
 * obligatoire exigent de lire `profiles` : cette lecture appartient aux
 * layouts (`requireAdmin()` / `requireGarage()`) et aux Server Actions, pas au
 * proxy, qui s'exécute sur chaque requête et n'a pas à faire d'aller-retour en
 * base. Un proxy contourné ne doit rien ouvrir — la barrière est le RLS, puis
 * les gardes serveur.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Tant que Supabase n'est pas configuré, on laisse simplement passer.
  if (!isSupabaseConfigured()) return response;

  const { url, anonKey } = requireSupabaseEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // `getUser()` (et non `getSession()`) : il revalide le token auprès du
  // serveur Auth. Ne jamais faire confiance à un JWT non revalidé.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  if (!user && requiresAuth(pathname)) {
    return redirectPreservingCookies(request, response, ROUTES.login, {
      next: `${pathname}${search}`,
    });
  }

  if (user && isGuestOnly(pathname)) {
    // La page d'accueil route ensuite selon le rôle, lu côté serveur.
    return redirectPreservingCookies(request, response, ROUTES.home);
  }

  return response;
}

/**
 * Redirige sans perdre les cookies de session rafraîchis juste avant.
 * Les oublier reconnecterait l'utilisateur à chaque expiration de token.
 */
function redirectPreservingCookies(
  request: NextRequest,
  response: NextResponse,
  pathname: string,
  params?: Record<string, string>,
): NextResponse {
  const target = request.nextUrl.clone();
  target.pathname = pathname;
  target.search = "";
  for (const [key, value] of Object.entries(params ?? {})) {
    target.searchParams.set(key, value);
  }

  const redirect = NextResponse.redirect(target);
  for (const cookie of response.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  return redirect;
}
