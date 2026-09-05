import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { ROUTES } from "@/lib/auth/routes";

/**
 * Retour du lien de vérification d'e-mail.
 *
 * ---------------------------------------------------------------------------
 * DEUX FORMES DE LIEN, LES DEUX ACCEPTÉES
 * ---------------------------------------------------------------------------
 * · `?token_hash=…&type=…` — forme recommandée avec `@supabase/ssr`. Elle
 *   fonctionne depuis n'importe quel navigateur, ce qui compte : beaucoup de
 *   gens relèvent leur messagerie sur le téléphone et s'inscrivent sur
 *   l'ordinateur. Elle demande de personnaliser le gabarit d'e-mail (README).
 * · `?code=…` — forme PKCE, produite par le gabarit Supabase par défaut. Elle
 *   n'aboutit que dans le navigateur qui a lancé l'inscription, car le
 *   vérificateur est dans un cookie.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI `redirect()` ET PAS `NextResponse.redirect()`
 * ---------------------------------------------------------------------------
 * `verifyOtp()` ouvre la session en écrivant des cookies via `cookies()`.
 * Renvoyer une `NextResponse` construite à la main court le risque de partir
 * sans ces `Set-Cookie` : la personne serait renvoyée vers l'accueil…
 * déconnectée, juste après avoir cliqué sur son lien de confirmation.
 * `redirect()` laisse Next construire la réponse, cookies compris.
 *
 * Une fois l'adresse vérifiée, le compte est PROVISIONNÉ :
 * `provision_self_signup()` crée le garage en essai gratuit et le profil
 * `role = 'garage'`. Tout se décide en SQL — cette route ne transporte aucun
 * droit.
 */

const ALLOWED_TYPES: readonly EmailOtpType[] = [
  "signup",
  "email",
  "magiclink",
  "recovery",
  "invite",
  "email_change",
];

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const supabase = await createClient();

  const tokenHash = params.get("token_hash");
  const rawType = params.get("type");
  const code = params.get("code");

  // `redirect()` lève : la destination est décidée d'abord, la redirection
  // n'est déclenchée qu'une fois, en fin de fonction.
  let failure: string | null = null;

  if (tokenHash && rawType) {
    const type = ALLOWED_TYPES.find((candidate) => candidate === rawType);
    if (!type) {
      failure = "lien_invalide";
    } else {
      const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
      if (error) failure = "lien_expire";
    }
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) failure = "lien_expire";
  } else {
    failure = "lien_invalide";
  }

  if (!failure) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      failure = "lien_expire";
    } else if (user.user_metadata?.signup_source === "self") {
      // Compte issu de /signup : on lui crée son garage d'essai. La fonction
      // est idempotente et refuse tout compte sans le marqueur `signup_source`,
      // posé au moment de l'inscription.
      const { error } = await supabase.rpc("provision_self_signup");
      if (error) {
        console.error("[auth/confirm] provisionnement impossible :", error.message);
        failure = "compte_non_provisionne";
      }
    }
  }

  if (failure) {
    redirect(`${ROUTES.authError}?reason=${failure}`);
  }

  // La page d'accueil oriente ensuite vers l'espace correspondant au rôle.
  redirect(ROUTES.home);
}
