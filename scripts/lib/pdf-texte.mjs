import { inflateSync } from "node:zlib";

/**
 * Extrait le texte d'un PDF, sans dépendance.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI PAS UNE BIBLIOTHÈQUE
 * ---------------------------------------------------------------------------
 * Il ne s'agit pas de rendre un PDF, seulement de vérifier que les mentions
 * obligatoires y figurent. Les flux de contenu produits par
 * `@react-pdf/renderer` sont compressés en Flate — `zlib` est dans Node — et
 * le texte y apparaît dans des opérateurs `Tj` / `TJ`. Une dépendance de plus
 * pour lire quatre parenthèses serait une dépendance de trop dans un projet
 * qui n'a même pas de framework de test.
 *
 * CE QUE ÇA NE FAIT PAS : décoder les polices embarquées à encodage
 * personnalisé, ni reconstituer l'ordre de lecture d'une mise en page à
 * colonnes. Les polices standard du PDF (Helvetica) utilisent WinAnsi, très
 * proche de Latin-1 : c'est suffisant pour chercher « Indemnité forfaitaire »
 * dans une facture.
 */

/** Les flux `stream … endstream`, décompressés quand ils le sont. */
function fluxDecompresses(pdf) {
  const flux = [];
  let position = 0;

  while (true) {
    const debut = pdf.indexOf("stream", position);
    if (debut < 0) break;

    // Le contenu commence après le saut de ligne qui suit « stream ».
    let contenu = debut + "stream".length;
    if (pdf[contenu] === 0x0d) contenu++;
    if (pdf[contenu] === 0x0a) contenu++;

    const fin = pdf.indexOf("endstream", contenu);
    if (fin < 0) break;

    const brut = pdf.subarray(contenu, fin);
    try {
      flux.push(inflateSync(brut));
    } catch {
      // Flux non compressé, ou compressé autrement : on le prend tel quel.
      flux.push(brut);
    }
    position = fin + "endstream".length;
  }

  return flux;
}

/**
 * Chaînes de texte d'un flux de contenu.
 *
 * `@react-pdf/renderer` écrit ses chaînes en HEXADÉCIMAL dans des tableaux
 * `TJ` — `[<45> 0 <6d> 0 <6e61>] TJ` — et non en littérales `( … )`. Les deux
 * formes sont acceptées ici : la première est ce que produit ce projet, la
 * seconde reste la plus répandue et ne coûte rien à couvrir.
 *
 * Les octets sont interprétés en Latin-1, ce qui rend les accents lisibles ;
 * les deux divergences de WinAnsi qui comptent ici (€ et œ) sont remises en
 * place ensuite.
 */
function chainesTexte(flux) {
  const texte = flux.toString("latin1");
  const morceaux = [];

  // --- Chaînes hexadécimales ---
  for (const trouve of texte.matchAll(/<([0-9a-fA-F\s]+)>/g)) {
    const hex = trouve[1].replace(/\s+/g, "");
    if (hex.length === 0 || hex.length % 2 !== 0) continue;

    let mot = "";
    for (let i = 0; i < hex.length; i += 2) {
      const code = parseInt(hex.slice(i, i + 2), 16);
      // Les polices à deux octets intercalent des zéros : on les écarte
      // plutôt que de produire du texte troué.
      if (code !== 0) mot += String.fromCharCode(code);
    }
    morceaux.push(mot);
  }

  // --- Chaînes littérales ---
  for (let i = 0; i < texte.length; i++) {
    if (texte[i] !== "(") continue;

    let profondeur = 1;
    let out = "";
    i++;

    for (; i < texte.length && profondeur > 0; i++) {
      const c = texte[i];

      if (c === "\\") {
        const suivant = texte[i + 1];
        const octal = texte.slice(i + 1, i + 4).match(/^[0-7]{1,3}/);
        if (octal) {
          out += String.fromCharCode(parseInt(octal[0], 8));
          i += octal[0].length;
        } else {
          const echappes = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
          out += echappes[suivant] ?? suivant;
          i += 1;
        }
        continue;
      }

      if (c === "(") profondeur++;
      if (c === ")") {
        profondeur--;
        if (profondeur === 0) break;
      }
      out += c;
    }

    morceaux.push(out);
  }

  return morceaux;
}

/**
 * La plage 0x80–0x9F, là où WinAnsi et Latin-1 divergent.
 *
 * Latin-1 y met des caractères de contrôle ; WinAnsi y met de la ponctuation
 * courante. Sans cette table, « SARL — capital » ressortait « SARL  capital »
 * et une assertion échouait alors que le PDF était juste : c'est le LECTEUR
 * qui perdait le tiret, pas le document qui l'omettait.
 */
const WINANSI = {
  "": "€", "": "‚", "": "ƒ", "": "„", "": "…",
  "": "†", "": "‡", "": "ˆ", "": "‰", "": "Š",
  "": "‹", "": "Œ", "": "Ž", "": "‘", "": "’",
  "": "“", "": "”", "": "•", "": "–", "": "—",
  "": "˜", "": "™", "": "š", "": "›", "": "œ",
  "": "ž", "": "Ÿ",
};

/** Tout le texte d'un PDF, flux par flux, séparé par des espaces. */
export function texteDuPdf(buffer) {
  const morceaux = [];
  for (const flux of fluxDecompresses(buffer)) {
    morceaux.push(...chainesTexte(flux));
  }
  return morceaux.join(" ").replace(/[-]/g, (c) => WINANSI[c] ?? c);
}

/** Dimensions de la première page, en points PostScript. */
export function formatDePage(buffer) {
  const trouve = buffer
    .toString("latin1")
    .match(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/);
  if (!trouve) return null;
  return { largeur: Number(trouve[3]), hauteur: Number(trouve[4]) };
}

/** A4 = 210 × 297 mm, soit 595 × 842 points (à un point près). */
export function estA4(buffer) {
  const format = formatDePage(buffer);
  if (!format) return false;
  return Math.abs(format.largeur - 595.28) < 1.5 && Math.abs(format.hauteur - 841.89) < 1.5;
}

/**
 * Texte sans aucune espace.
 *
 * Le crénage de `@react-pdf/renderer` découpe les mots en fragments —
 * « Indemnité forfaitaire » sort en « Indemni té f or f ai tai r e ». Chercher
 * la phrase telle qu'on l'a écrite échouerait alors que le PDF est correct.
 * On compare donc des textes dont toutes les espaces ont été retirées : ce
 * qu'on éprouve, c'est la PRÉSENCE de la mention, pas sa typographie.
 */
export function compacter(texte) {
  return texte.replace(/\s+/g, "");
}

/** La mention figure-t-elle dans le PDF, quelle que soit la césure ? */
export function contientTexte(texteDuPdfExtrait, aiguille) {
  return compacter(texteDuPdfExtrait).includes(compacter(aiguille));
}

/**
 * Position VERTICALE d'un texte dans le PDF, en points depuis le haut.
 *
 * Sert à éprouver la mise en page, pas seulement le contenu : un pied de page
 * censé être ancré en bas de la feuille doit pouvoir se PROUVER en bas, sinon
 * il redeviendra flottant à la première refonte sans que rien ne le signale.
 *
 * Le flux de contenu de `@react-pdf/renderer` commence par `1 0 0 -1 0 H cm` :
 * l'axe vertical est retourné, donc les translations qui suivent se lisent
 * depuis le haut. On suit la pile `q`/`Q` pour accumuler les `1 0 0 1 x y cm`
 * et on relève la position au moment où le texte est dessiné.
 *
 * Le texte cherché doit être ASCII : il est comparé à sa forme hexadécimale,
 * telle que react-pdf l'écrit dans les tableaux `TJ`.
 */
export function positionsVerticales(buffer, texte) {
  const aiguille = Buffer.from(texte, "latin1").toString("hex");
  const resultats = [];
  let position = 0;

  while (true) {
    const debut = buffer.indexOf("stream", position);
    if (debut < 0) break;
    let contenu = debut + "stream".length;
    if (buffer[contenu] === 0x0d) contenu++;
    if (buffer[contenu] === 0x0a) contenu++;
    const fin = buffer.indexOf("endstream", contenu);
    if (fin < 0) break;
    position = fin + "endstream".length;

    let flux;
    try {
      flux = inflateSync(buffer.subarray(contenu, fin)).toString("latin1");
    } catch {
      continue;
    }
    if (!flux.includes(" cm")) continue;

    let y = 0;
    const pile = [];
    for (const ligne of flux.split("\n")) {
      const t = ligne.trim();
      if (t === "q") {
        pile.push(y);
      } else if (t === "Q") {
        y = pile.pop() ?? y;
      } else {
        const cm = t.match(/^1 0 0 1 (-?[\d.]+) (-?[\d.]+) cm$/);
        if (cm) y += Number(cm[2]);
        else if (t.includes(aiguille)) resultats.push(y);
      }
    }
  }
  return resultats;
}
