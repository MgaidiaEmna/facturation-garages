/**
 * La palette du DOCUMENT facture — et d'elle seule.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI UNE PALETTE À PART
 * ---------------------------------------------------------------------------
 * L'application est bleu marine (`--brand`, dans `globals.css`) : bandeau,
 * navigation, boutons, interrupteurs. La facture, elle, n'est pas un écran :
 * c'est une pièce que le client reçoit, souvent imprimée, détachée de
 * l'interface qui l'a produite. Elle a donc le droit d'avoir sa propre
 * identité — ici un orange vif — sans que cela repeigne quoi que ce soit
 * d'autre.
 *
 * La règle du projet reste entière : aucune page n'écrit une couleur en dur,
 * elle la NOMME. Ce fichier est la source, `globals.css` reste celle du
 * marine, et les deux ne se croisent jamais.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI ICI, ET PAS DANS `globals.css`
 * ---------------------------------------------------------------------------
 * Parce que le PDF ne lit pas de CSS. `@react-pdf/renderer` veut des chaînes
 * de couleur dans un `StyleSheet` JavaScript ; une variable CSS ne lui
 * parviendrait jamais. Poser la palette dans un module PUR, importé par les
 * DEUX rendus, est la seule façon d'être certain que l'écran et le papier
 * emploient le même orange — exactement l'argument qui a fait naître
 * `document.ts` pour le contenu.
 *
 * Ce module ne dépend de rien : ni React, ni serveur. Il est importable
 * depuis un Composant Client.
 *
 * ---------------------------------------------------------------------------
 * CONTRASTES (WCAG 2.1, mesurés sur fond blanc sauf mention)
 * ---------------------------------------------------------------------------
 *   accent      #ea5b0c sur blanc ......  3,5:1  → AA pour GRAND texte (≥ 3:1)
 *   blanc sur   #ea5b0c ................  3,5:1  → AA pour GRAND texte
 *   accentTexte #c2410c sur blanc ......  5,1:1  → AA partout
 *   encre       #1c1917 sur blanc ...... 16,9:1  → AAA
 *   texte       #57534e sur blanc ......  7,6:1  → AAA
 *   attenue     #78716c sur blanc ......  4,8:1  → AA
 *   discret     #a8a29e sur blanc ......  2,5:1  → décoratif UNIQUEMENT
 *
 * Deux conséquences, à ne pas défaire :
 *
 * · `accent` ne porte du texte que s'il est GRAND — le total TTC est à 14 pt
 *   gras (PDF) et 19 px semi-gras (écran), au-dessus du seuil « grand texte »
 *   de WCAG. Un libellé de 7 pt en `accent` serait sous le seuil : c'est à ça
 *   que sert `accentTexte`, visuellement identique à cette taille-là.
 * · `discret` est réservé aux textes de REMPLISSAGE (« Nom du client »,
 *   « attribué à l'émission »). Les mentions légales obligatoires, elles,
 *   sont en `attenue` : discrètes, mais lisibles. Une mention que la loi
 *   impose et qu'on ne peut pas lire n'est pas une mention.
 */

export const invoiceTheme = {
  /** L'orange de la facture. Aplats, filets, et grand texte seulement. */
  accent: "#ea5b0c",
  /** Le même orange, assombri pour le PETIT texte accentué (surtitres). */
  accentTexte: "#c2410c",
  /** Voile orange des cartouches — le bloc client s'en sert. */
  accentPale: "#fdf1e8",
  /** Ce qui s'écrit SUR l'accent. */
  surAccent: "#ffffff",

  /** Titres et montants. */
  encre: "#1c1917",
  /** Corps de texte du document. */
  texte: "#57534e",
  /** Libellés secondaires et mentions légales allégées. */
  attenue: "#78716c",
  /** Texte de remplissage, jamais une information obligatoire. */
  discret: "#a8a29e",

  /** Cartouches et pied : un gris chaud, assorti à l'orange. */
  surface: "#fafaf9",
  /** Lignes paires du tableau. */
  surfaceAlt: "#f5f5f4",
  /** Filets, quand il en faut vraiment un. */
  filet: "#e7e5e4",
  /** Le papier. */
  papier: "#ffffff",
} as const;

export type InvoiceTheme = typeof invoiceTheme;
