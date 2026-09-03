"use client";

import { createBrowserClient } from "@supabase/ssr";
import { requireSupabaseEnv } from "@/lib/env";

/**
 * Client Supabase pour les Composants Client.
 * N'utilise QUE la clé anonyme : toutes les lectures/écritures passent par le
 * RLS. Ne jamais y injecter la service role key.
 */
export function createClient() {
  const { url, anonKey } = requireSupabaseEnv();
  return createBrowserClient(url, anonKey);
}
