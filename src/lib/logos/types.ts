/**
 * Formes de la bibliothèque de logos.
 *
 * Elles vivent ici et non dans `queries.ts`, qui importe `server-only` :
 * l'éditeur de facture est un composant client et consomme la liste pour son
 * sélecteur. Importer un type depuis un module marqué `server-only` revient à
 * parier sur l'effacement des types par le bundler ; on ne parie pas là-dessus.
 */

/** Un logo de la bibliothèque d'un garage. */
export interface Logo {
  id: string;
  label: string | null;
  /** Chemin dans le bucket privé : `{garage_id}/{fichier}`. */
  storagePath: string;
  isDefault: boolean;
  createdAt: string;
  /**
   * URL signée, valable quelques minutes. `null` si la signature a échoué —
   * l'écran affiche alors un cadre vide plutôt que de casser.
   *
   * JAMAIS une URL publique : le bucket est privé, et c'est le RLS qui décide
   * qui peut signer quoi.
   */
  signedUrl: string | null;
  /**
   * Faux dès qu'une facture ÉMISE porte ce logo. Calculé par
   * `logo_is_deletable()` en base, jamais recalculé ici : c'est la même règle
   * que celle qu'appliquera `logos_guard_trg` au moment du refus.
   */
  deletable: boolean;
}
