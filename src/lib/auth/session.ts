import "server-only";

import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { ROUTES, homeForRole } from "./routes";
import type { AuthContext, GarageSummary, UserRole } from "./types";

/**
 * Lecture de la session, côté serveur uniquement.
 *
 * Deux règles héritées de la phase 1, non négociables :
 *
 *   · `getUser()` et JAMAIS `getSession()` — seul le premier revalide le JWT
 *     auprès du serveur Auth. `getSession()` fait confiance à un cookie.
 *   · Le rôle, le statut et les droits viennent de `my_access_state()`, donc
 *     de `profiles` / `garages`, jamais d'une valeur envoyée par le client.
 *
 * Un seul aller-retour RPC ramène tout l'état : rôle, garage, essai,
 * abonnement, motif de blocage. Les règles restent en SQL, ce module ne fait
 * que les transporter.
 */

/** Forme brute renvoyée par `my_access_state()`. */
interface AccessStateRow {
  has_profile: boolean;
  email_verified: boolean;
  role?: UserRole;
  must_change_password?: boolean;
  full_name?: string | null;
  garage?: {
    id: string;
    name: string;
    locale: string;
    is_active: boolean;
    account_status: GarageSummary["accountStatus"];
    origin: GarageSummary["origin"];
    vat_exempt: boolean;
    logo_management_enabled: boolean;
    trial_invoices_used: number;
    trial_invoice_limit: number;
  } | null;
  subscription_end_date?: string | null;
  can_write?: boolean;
  finalize_block_reason?: AuthContext["access"]["finalizeBlockReason"];
  finalize_block_message?: string | null;
}

/**
 * Contexte de la session, ou `null` si personne n'est connecté.
 * Ne redirige pas : c'est aux gardes ci-dessous de décider.
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  // Projet Supabase pas encore branché : l'application doit rester debout et
  // afficher son écran de configuration, pas planter (cf. src/lib/env.ts).
  if (!isSupabaseConfigured()) return null;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase.rpc("my_access_state");

  // Le RPC a échoué (base injoignable, migration non appliquée) : on ne
  // fabrique surtout pas un contexte permissif par défaut.
  const state: AccessStateRow =
    error || !data
      ? { has_profile: false, email_verified: Boolean(user.email_confirmed_at) }
      : (data as AccessStateRow);

  const garage: GarageSummary | null = state.garage
    ? {
        id: state.garage.id,
        name: state.garage.name,
        locale: state.garage.locale,
        isActive: state.garage.is_active,
        accountStatus: state.garage.account_status,
        origin: state.garage.origin,
        vatExempt: state.garage.vat_exempt,
        logoManagementEnabled: state.garage.logo_management_enabled,
        trialInvoicesUsed: state.garage.trial_invoices_used,
        trialInvoiceLimit: state.garage.trial_invoice_limit,
      }
    : null;

  return {
    userId: user.id,
    email: user.email ?? null,
    fullName: state.full_name ?? null,
    role: state.has_profile ? (state.role ?? null) : null,
    garage,
    access: {
      emailVerified: state.email_verified,
      hasProfile: state.has_profile,
      mustChangePassword: state.must_change_password ?? false,
      canWrite: state.can_write ?? false,
      finalizeBlockReason: state.finalize_block_reason ?? null,
      finalizeBlockMessage: state.finalize_block_message ?? null,
      subscriptionEndDate: state.subscription_end_date ?? null,
    },
  };
}

/** Session obligatoire, sans exigence de rôle. */
export async function requireUser(): Promise<AuthContext> {
  if (!isSupabaseConfigured()) redirect(ROUTES.home);

  const context = await getAuthContext();
  if (!context) redirect(ROUTES.login);
  return context;
}

/**
 * Garde commune aux deux espaces : session, e-mail vérifié, profil rattaché,
 * mot de passe initial déjà changé.
 *
 * Le proxy a déjà écarté les visiteurs sans session — mais il ne fait qu'une
 * vérification optimiste, sans lecture de `profiles`. La barrière est ici.
 */
async function requireProvisionedUser(): Promise<AuthContext & { role: UserRole }> {
  const context = await requireUser();

  if (!context.access.emailVerified) {
    redirect(`${ROUTES.authError}?reason=email_non_verifie`);
  }
  if (!context.access.hasProfile || !context.role) {
    redirect(`${ROUTES.authError}?reason=compte_non_provisionne`);
  }
  if (context.access.mustChangePassword) {
    redirect(ROUTES.changePassword);
  }

  return context as AuthContext & { role: UserRole };
}

/** Espace super administrateur. */
export async function requireAdmin(): Promise<AuthContext> {
  const context = await requireProvisionedUser();
  if (context.role !== "super_admin") {
    redirect(homeForRole(context.role));
  }
  return context;
}

/** Espace garage. */
export async function requireGarage(): Promise<
  AuthContext & { garage: GarageSummary }
> {
  const context = await requireProvisionedUser();
  if (context.role !== "garage" || !context.garage) {
    redirect(homeForRole(context.role));
  }
  return context as AuthContext & { garage: GarageSummary };
}
