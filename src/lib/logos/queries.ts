import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Logo } from "./types";

export type { Logo } from "./types";

/**
 * Lectures de la bibliothèque de logos.
 *
 * Aucun filtre sur `garage_id` n'est écrit ici : `logos_select` ne laisse
 * passer que les lignes du garage courant, et les policies Storage ne signent
 * que les objets de son dossier. La section 23 de `rls_isolation.sql` prouve
 * la première, `verify:logos` prouve la seconde — avec de vrais appels au
 * service de stockage, et non sur un stub.
 */

/** Durée de validité d'une URL signée : le temps d'afficher une page. */
const SIGNATURE_SECONDES = 600;

const COLONNES = "id, label, storage_path, is_default, created_at";

/**
 * Signe plusieurs chemins d'un coup.
 *
 * `createSignedUrls` (au pluriel) ne fait qu'un aller-retour, et surtout : il
 * passe par la session du garage, donc sous les policies Storage. Signer avec
 * la clé service role afficherait les logos du voisin sans qu'aucune barrière
 * ne s'y oppose — ce serait remplacer le contrôle par la confiance.
 */
async function signer(chemins: string[]): Promise<Map<string, string>> {
  if (chemins.length === 0) return new Map();

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("logos")
    .createSignedUrls(chemins, SIGNATURE_SECONDES);

  // Une signature qui échoue n'est pas une raison de casser l'écran : la
  // bibliothèque s'affiche, les vignettes manquantes se voient.
  if (error || !data) return new Map();

  const urls = new Map<string, string>();
  for (const item of data) {
    if (item.signedUrl && item.path) urls.set(item.path, item.signedUrl);
  }
  return urls;
}

/** Une URL signée pour un seul chemin, ou `null`. */
export async function signerLogo(chemin: string | null): Promise<string | null> {
  if (!chemin) return null;
  const urls = await signer([chemin]);
  return urls.get(chemin) ?? null;
}

/** Les logos du garage courant, le défaut en tête. */
export async function listLogos(): Promise<Logo[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("logos")
    .select(COLONNES)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Lecture des logos impossible : ${error.message}`);
  const lignes = data ?? [];
  if (lignes.length === 0) return [];

  const chemins = lignes.map((row) => String(row.storage_path));
  const urls = await signer(chemins);

  // La suppressibilité vient de la base, une fois pour toutes les lignes.
  const { data: verrous } = await supabase.rpc("logos_locked", {
    p_ids: lignes.map((row) => String(row.id)),
  });
  const nonSupprimables = new Set<string>(
    Array.isArray(verrous) ? verrous.map((v: { id: string }) => String(v.id)) : [],
  );

  return lignes.map((row): Logo => {
    const chemin = String(row.storage_path);
    return {
      id: String(row.id),
      label: (row.label as string | null) ?? null,
      storagePath: chemin,
      isDefault: Boolean(row.is_default),
      createdAt: String(row.created_at),
      signedUrl: urls.get(chemin) ?? null,
      deletable: !nonSupprimables.has(String(row.id)),
    };
  });
}

/** Le logo par défaut du garage courant, signé. `null` s'il n'y en a pas. */
export async function getDefaultLogoUrl(): Promise<string | null> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("logos")
    .select("storage_path")
    .eq("is_default", true)
    .maybeSingle();

  return signerLogo((data?.storage_path as string | null) ?? null);
}

/**
 * Les logos d'un garage donné, vus par l'ADMINISTRATEUR.
 *
 * `logos_select` autorise `is_admin()` : l'administrateur voit la
 * bibliothèque de n'importe quel garage, ce dont la fiche a besoin pour
 * assigner un logo à un garage standard.
 */
export async function listLogosForGarage(garageId: string): Promise<Logo[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("logos")
    .select(COLONNES)
    .eq("garage_id", garageId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Lecture des logos impossible : ${error.message}`);
  const lignes = data ?? [];
  if (lignes.length === 0) return [];

  const urls = await signer(lignes.map((row) => String(row.storage_path)));
  const { data: verrous } = await supabase.rpc("logos_locked", {
    p_ids: lignes.map((row) => String(row.id)),
  });
  const nonSupprimables = new Set<string>(
    Array.isArray(verrous) ? verrous.map((v: { id: string }) => String(v.id)) : [],
  );

  return lignes.map((row): Logo => {
    const chemin = String(row.storage_path);
    return {
      id: String(row.id),
      label: (row.label as string | null) ?? null,
      storagePath: chemin,
      isDefault: Boolean(row.is_default),
      createdAt: String(row.created_at),
      signedUrl: urls.get(chemin) ?? null,
      deletable: !nonSupprimables.has(String(row.id)),
    };
  });
}

/** Le chemin de stockage d'un logo, sous RLS. `null` s'il n'est pas au garage. */
export async function cheminLogo(logoId: string | null): Promise<string | null> {
  if (!logoId) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("logos")
    .select("storage_path")
    .eq("id", logoId)
    .maybeSingle();

  return (data?.storage_path as string | null) ?? null;
}

/**
 * Les octets du logo, en `data:` URI — la forme que `@react-pdf/renderer` sait
 * consommer sans aller-retour réseau.
 *
 * Le téléchargement passe par la session, donc par les policies du bucket : un
 * chemin volé chez le voisin ne renvoie rien. Un échec donne `null` et la
 * facture s'imprime avec le nom en texte — un logo manquant ne doit pas
 * empêcher d'émettre un document légal.
 */
export async function logoEnDataUri(chemin: string | null): Promise<string | null> {
  if (!chemin) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("logos").download(chemin);
  if (error || !data) return null;

  const octets = Buffer.from(await data.arrayBuffer());
  const type = data.type === "image/jpeg" ? "image/jpeg" : "image/png";
  return `data:${type};base64,${octets.toString("base64")}`;
}
