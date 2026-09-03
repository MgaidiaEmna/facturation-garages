import { z } from "zod";

/**
 * Variables d'environnement.
 *
 * Volontairement TOLÉRANT au démarrage : tant que le projet Supabase n'est pas
 * créé, l'application doit pouvoir se lancer et afficher un écran de
 * configuration plutôt que planter au boot. Les accès réellement dépendants de
 * Supabase appellent `requireSupabaseEnv()`, qui lève une erreur explicite.
 */

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
});

/**
 * Les NEXT_PUBLIC_* doivent être lues littéralement (`process.env.NOM`) pour
 * que Next.js puisse les inliner au build — un accès dynamique renverrait
 * `undefined` côté navigateur.
 */
export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});

/** Vrai si l'application dispose du minimum pour parler à Supabase. */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL && publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/** Retourne l'URL + la clé anonyme, ou lève une erreur lisible. */
export function requireSupabaseEnv(): { url: string; anonKey: string } {
  const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey } = publicEnv;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase n'est pas configuré : renseignez NEXT_PUBLIC_SUPABASE_URL et " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY dans .env.local (voir .env.example).",
    );
  }
  return { url, anonKey };
}
