import { z } from "zod";

/**
 * Téléversement d'un logo : validation de saisie.
 *
 * Aucune dépendance serveur — le formulaire peut refuser un fichier avant même
 * de l'envoyer. La validation qui fait autorité reste celle de la Server
 * Action ; et derrière elle, le bucket lui-même refuse ce qu'il n'accepte pas.
 * Trois barrières, aucune redondante : le navigateur épargne un aller-retour,
 * l'action protège l'API, le bucket protège le stockage.
 */

/**
 * PNG et JPEG, et rien d'autre.
 *
 * `@react-pdf/renderer` ne décode que ces deux formats : son `<Image>` ignore
 * le SVG et le WebP. Les accepter produirait un logo visible à l'écran et
 * ABSENT du PDF — deux documents différents pour une même facture, ce que tout
 * le modèle `document.ts` existe pour empêcher. On refuse donc à l'entrée,
 * avec un message qui dit quoi faire, plutôt que de livrer une facture amputée.
 *
 * Cette liste doit rester d'accord avec `allowed_mime_types` du bucket
 * (migration `20260908090000_logos.sql`).
 */
export const TYPES_ACCEPTES = ["image/png", "image/jpeg"] as const;

/** Ce que l'attribut `accept` d'un `<input type="file">` doit annoncer. */
export const ACCEPT_HTML = ".png,.jpg,.jpeg,image/png,image/jpeg";

/**
 * 2 Mio, comme `file_size_limit` du bucket.
 *
 * Un logo de facture fait quelques dizaines de kilooctets ; 2 Mio laisse
 * passer une photo mal recadrée sans laisser passer un scan de 40 pages.
 */
export const TAILLE_MAX = 2 * 1024 * 1024;

const LIBELLE_MAX = 80;

/** Message unique, pour que l'écran et le serveur disent la même chose. */
export const MESSAGE_TYPE =
  "Format non accepté : seuls le PNG et le JPEG peuvent figurer sur une facture PDF.";
export const MESSAGE_TAILLE = "Fichier trop lourd : 2 Mio maximum.";

export const logoUploadSchema = z.object({
  label: z
    .string()
    .trim()
    .max(LIBELLE_MAX, `Libellé trop long (${LIBELLE_MAX} caractères maximum).`)
    .transform((valeur) => (valeur === "" ? null : valeur)),
  file: z
    .instanceof(File, { error: "Choisissez un fichier image." })
    .refine((f) => f.size > 0, "Le fichier est vide.")
    .refine((f) => f.size <= TAILLE_MAX, MESSAGE_TAILLE)
    .refine(
      (f) => (TYPES_ACCEPTES as readonly string[]).includes(f.type),
      MESSAGE_TYPE,
    ),
});

export type LogoUploadInput = z.infer<typeof logoUploadSchema>;

/** Renommer un logo, ou le désigner par défaut. */
export const logoIdSchema = z.uuid("Logo introuvable.");

export const logoLabelSchema = z.object({
  logoId: logoIdSchema,
  label: z
    .string()
    .trim()
    .max(LIBELLE_MAX, `Libellé trop long (${LIBELLE_MAX} caractères maximum).`)
    .transform((valeur) => (valeur === "" ? null : valeur)),
});

/**
 * Extension déduite du type MIME, jamais du nom du fichier téléversé.
 *
 * Le nom vient du navigateur : il peut contenir des séparateurs de chemin, des
 * caractères de contrôle, ou mentir sur le contenu. Le type, lui, a été validé
 * juste au-dessus — et le chemin de stockage se construit à partir de ce qui
 * est vérifié, pas de ce qui est reçu.
 */
export function extensionPour(type: string): string {
  return type === "image/png" ? "png" : "jpg";
}
