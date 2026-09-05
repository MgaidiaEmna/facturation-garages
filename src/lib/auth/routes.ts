import type { UserRole } from "./types";

/**
 * Carte des routes d'authentification.
 *
 * Importable partout — proxy (runtime edge), Server Components, Composants
 * Client — donc sans aucune dépendance serveur.
 *
 * Ce fichier décrit OÙ vont les gens, pas ce qu'ils ont le droit de faire :
 * le proxy s'en sert pour une redirection optimiste (y a-t-il une session ?),
 * la vraie barrière reste le contrôle de rôle dans les layouts et les Server
 * Actions.
 */
export const ROUTES = {
  home: "/",
  login: "/login",
  signup: "/signup",
  signupVerification: "/signup/verification",
  changePassword: "/change-password",
  authConfirm: "/auth/confirm",
  authError: "/auth/error",
  adminHome: "/admin",
  garageHome: "/app",
} as const;

/** Espace d'accueil correspondant au rôle. */
export function homeForRole(role: UserRole): string {
  return role === "super_admin" ? ROUTES.adminHome : ROUTES.garageHome;
}

/** Préfixes qui exigent une session. */
const PROTECTED_PREFIXES = [ROUTES.adminHome, ROUTES.garageHome, ROUTES.changePassword];

/** Pages réservées aux visiteurs : une session connectée n'a rien à y faire. */
const GUEST_ONLY_PREFIXES = [ROUTES.login, ROUTES.signup];

function matches(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function requiresAuth(pathname: string): boolean {
  return matches(pathname, PROTECTED_PREFIXES);
}

export function isGuestOnly(pathname: string): boolean {
  return matches(pathname, GUEST_ONLY_PREFIXES);
}

/**
 * Filtre une destination de redirection venue de l'URL (`?next=`).
 *
 * Un paramètre `next` est une valeur fournie par l'extérieur : sans contrôle,
 * il transforme la page de connexion en tremplin vers un site tiers
 * (« open redirect »). On n'accepte qu'un chemin interne, et on rejette
 * explicitement `//hôte` et `/\hôte`, que les navigateurs interprètent comme
 * des URL absolues.
 */
export function safeNextPath(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  return value;
}
