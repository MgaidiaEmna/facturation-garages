import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { CatalogClient, CatalogService, EditorCatalog } from "./types";

export type { CatalogClient, CatalogService, EditorCatalog } from "./types";

/**
 * Lectures du carnet et du catalogue.
 *
 * Aucun filtre sur `garage_id` n'est écrit ici : `clients_select` et
 * `services_select` ne laissent passer que les lignes du garage courant. Un
 * oubli dans ces requêtes ne peut donc pas ouvrir plus que le RLS n'autorise —
 * c'est tout l'intérêt de ne pas doubler la règle. La section 22 de
 * `rls_isolation.sql` le prouve.
 */

const CLIENT_COLUMNS = "id, name, address, phone, email, vat_number, siret, updated_at";
const SERVICE_COLUMNS =
  "id, label, default_unit, default_price_ht, default_vat_rate, updated_at";

function toClient(row: Record<string, unknown>): CatalogClient {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    address: (row.address as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    vatNumber: (row.vat_number as string | null) ?? null,
    siret: (row.siret as string | null) ?? null,
    updatedAt: String(row.updated_at),
  };
}

function toService(row: Record<string, unknown>): CatalogService {
  return {
    id: String(row.id),
    label: String(row.label ?? ""),
    defaultUnit: String(row.default_unit ?? "U"),
    defaultPriceHt: Number(row.default_price_ht ?? 0),
    defaultVatRate: Number(row.default_vat_rate ?? 0),
    updatedAt: String(row.updated_at),
  };
}

/**
 * Échappe les caractères que PostgREST interprète dans un filtre `ilike`.
 *
 * Sans cela, taper « % » dans la recherche retourne tout le carnet et « _ »
 * remplace n'importe quel caractère : ce n'est pas une faille — le RLS tient
 * la frontière — mais c'est une recherche qui ment sur ce qu'elle a trouvé.
 */
function motifRecherche(terme: string): string {
  return `%${terme.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
}

/** Clients du garage courant, par ordre alphabétique. */
export async function listClients(search?: string): Promise<CatalogClient[]> {
  const supabase = await createClient();

  let query = supabase.from("clients").select(CLIENT_COLUMNS).order("name");
  const terme = search?.trim();
  if (terme) query = query.ilike("name", motifRecherche(terme));

  const { data, error } = await query;
  if (error) throw new Error(`Lecture du carnet impossible : ${error.message}`);

  return (data ?? []).map(toClient);
}

/** Un client, ou `null` — « inconnu » et « à quelqu'un d'autre » se ressemblent. */
export async function getClient(clientId: string): Promise<CatalogClient | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("clients")
    .select(CLIENT_COLUMNS)
    .eq("id", clientId)
    .maybeSingle();

  if (error) throw new Error(`Lecture du client impossible : ${error.message}`);
  return data ? toClient(data) : null;
}

/** Prestations du garage courant, par ordre alphabétique. */
export async function listServices(search?: string): Promise<CatalogService[]> {
  const supabase = await createClient();

  let query = supabase.from("services").select(SERVICE_COLUMNS).order("label");
  const terme = search?.trim();
  if (terme) query = query.ilike("label", motifRecherche(terme));

  const { data, error } = await query;
  if (error) throw new Error(`Lecture du catalogue impossible : ${error.message}`);

  return (data ?? []).map(toService);
}

/** Une prestation, ou `null`. */
export async function getService(serviceId: string): Promise<CatalogService | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("services")
    .select(SERVICE_COLUMNS)
    .eq("id", serviceId)
    .maybeSingle();

  if (error) throw new Error(`Lecture de la prestation impossible : ${error.message}`);
  return data ? toService(data) : null;
}

/** Carnet et catalogue en un seul aller-retour, pour l'éditeur de facture. */
export async function getEditorCatalog(): Promise<EditorCatalog> {
  const [clients, services] = await Promise.all([listClients(), listServices()]);
  return { clients, services };
}
