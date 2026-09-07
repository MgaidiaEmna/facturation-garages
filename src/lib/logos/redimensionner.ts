import { TAILLE_MAX, TYPES_ACCEPTES } from "./schema";

/**
 * Réduit un logo aux dimensions utiles AVANT de le téléverser.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI RÉDUIRE, ET POURQUOI DANS LE NAVIGATEUR
 * ---------------------------------------------------------------------------
 * Sur la facture, le logo occupe 170 × 46 points — environ 6 × 1,6 cm. Un
 * export non recadré de 1200 × 1200 pixels y est affiché à un dixième de sa
 * taille, mais il est intégré ENTIER dans le PDF : mesuré, une facture d'une
 * page pesait 959 Kio dont 955 pour le logo. Chaque téléchargement, chaque
 * impression, chaque octet en mémoire du serveur payait cette image que
 * personne ne verra jamais en grand.
 *
 * La réduction se fait ici, une fois, au téléversement — plutôt qu'à chaque
 * génération de PDF. Le fichier stocké est déjà à la bonne taille, donc tous
 * les documents en profitent, y compris ceux déjà émis qui le réutilisent.
 *
 * Le navigateur sait le faire seul : `createImageBitmap` puis un `<canvas>`.
 * Aucune dépendance, et le serveur n'a pas à décoder d'image.
 *
 * ---------------------------------------------------------------------------
 * CE QUE ÇA NE FAIT PAS
 * ---------------------------------------------------------------------------
 * Ce n'est pas une barrière : un client qui n'exécute pas ce code téléverse
 * son fichier tel quel, et c'est le bucket qui tranche sur la taille. C'est
 * une optimisation, et elle se comporte comme telle — en cas d'échec, on rend
 * le fichier d'origine plutôt que de bloquer un téléversement légitime.
 */

/**
 * Côté maximal, en pixels.
 *
 * 600 px pour une zone d'impression de 170 pt (≈ 6 cm) laisse plus de 250 dpi :
 * au-delà, on stocke des pixels qu'aucune imprimante ne restitue.
 */
export const COTE_MAX = 600;

/** Qualité JPEG des logos ré-encodés. 0,9 : aucun artefact visible à cette taille. */
const QUALITE_JPEG = 0.9;

/** L'image a-t-elle besoin d'être réduite ? */
function tropGrande(largeur: number, hauteur: number): boolean {
  return Math.max(largeur, hauteur) > COTE_MAX;
}

/**
 * Renvoie un fichier réduit, ou le fichier d'origine si la réduction n'a pas
 * lieu d'être (image déjà petite) ou n'a pas pu aboutir.
 */
export async function redimensionnerLogo(fichier: File): Promise<File> {
  // Hors des formats qu'on accepte, on ne touche à rien : la validation dira
  // ce qu'il en est.
  if (!(TYPES_ACCEPTES as readonly string[]).includes(fichier.type)) return fichier;
  if (typeof createImageBitmap !== "function") return fichier;

  let image: ImageBitmap;
  try {
    image = await createImageBitmap(fichier);
  } catch {
    // Fichier illisible : on laisse le serveur et le bucket le refuser, avec
    // leurs messages. Réduire n'est pas valider.
    return fichier;
  }

  try {
    if (!tropGrande(image.width, image.height) && fichier.size <= TAILLE_MAX) {
      return fichier;
    }

    const facteur = COTE_MAX / Math.max(image.width, image.height);
    const largeur = Math.max(1, Math.round(image.width * Math.min(1, facteur)));
    const hauteur = Math.max(1, Math.round(image.height * Math.min(1, facteur)));

    const canvas = document.createElement("canvas");
    canvas.width = largeur;
    canvas.height = hauteur;

    const contexte = canvas.getContext("2d");
    if (!contexte) return fichier;
    contexte.drawImage(image, 0, 0, largeur, hauteur);

    // Le PNG conserve la transparence, dont un logo a souvent besoin ; le JPEG
    // ne l'a pas et resterait plus lourd sur un aplat. On garde donc le format
    // d'origine plutôt que d'imposer le nôtre.
    const type = fichier.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, type === "image/jpeg" ? QUALITE_JPEG : undefined),
    );
    if (!blob) return fichier;

    // Réduire doit ALLÉGER. Sur une image déjà optimisée, le ré-encodage peut
    // grossir : dans ce cas on garde l'original.
    if (blob.size >= fichier.size && !tropGrande(image.width, image.height)) {
      return fichier;
    }

    return new File([blob], fichier.name, { type, lastModified: Date.now() });
  } finally {
    image.close();
  }
}
