/**
 * Formes du carnet de clients et du catalogue de prestations.
 *
 * Elles vivent ici et non dans `queries.ts`, qui importe `server-only` :
 * l'éditeur de facture est un composant client et consomme ces listes pour
 * son autocomplétion. Importer un type depuis un module marqué `server-only`
 * revient à parier sur l'effacement des types par le bundler ; on ne parie
 * pas là-dessus.
 */

/** Un client enregistré dans le carnet du garage. */
export interface CatalogClient {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  vatNumber: string | null;
  siret: string | null;
  updatedAt: string;
}

/** Une prestation du catalogue du garage. */
export interface CatalogService {
  id: string;
  label: string;
  defaultUnit: string;
  defaultPriceHt: number;
  defaultVatRate: number;
  updatedAt: string;
}

/**
 * Ce que l'éditeur reçoit pour son autocomplétion.
 *
 * Volontairement des LISTES COMPLÈTES, pas une recherche serveur : un garage
 * a quelques dizaines de clients et de prestations, et l'autocomplétion doit
 * répondre à la frappe sans aller-retour. Le jour où un garage en aura des
 * milliers, c'est ici qu'il faudra passer à une recherche paginée — et nulle
 * part ailleurs, puisque les écrans de liste ont déjà la leur.
 */
export interface EditorCatalog {
  clients: CatalogClient[];
  services: CatalogService[];
}
