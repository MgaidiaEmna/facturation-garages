/**
 * Un navigateur minimal : cookies + formulaires Server Action.
 *
 * Partagé par `verify:auth` et `verify:garages`. Il se comporte comme un
 * navigateur SANS JavaScript : les Server Actions de Next sont rendues en
 * amélioration progressive, donc tout ce qui est atteignable ici l'est aussi
 * pour un visiteur dont le script n'a pas chargé. Ce qui ne l'est PAS — le
 * contenu d'une boîte de dialogue Radix, monté seulement à l'ouverture —
 * échappe par construction à ces scripts et doit être couvert autrement.
 */

export class Navigateur {
  /** @param {string} app URL de base de l'application. */
  constructor(app) {
    this.app = app;
    this.cookies = new Map();
  }

  #entete() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  #absorber(response) {
    for (const brut of response.headers.getSetCookie()) {
      const [paire] = brut.split(";");
      const index = paire.indexOf("=");
      if (index < 0) continue;
      const nom = paire.slice(0, index).trim();
      const valeur = paire.slice(index + 1);
      if (valeur === "" || valeur === "deleted") this.cookies.delete(nom);
      else this.cookies.set(nom, valeur);
    }
  }

  async get(chemin, { suivre = true } = {}) {
    const response = await fetch(this.app + chemin, {
      headers: { cookie: this.#entete() },
      redirect: suivre ? "follow" : "manual",
    });
    this.#absorber(response);
    return {
      status: response.status,
      location: response.headers.get("location"),
      body: await response.text(),
    };
  }

  /**
   * Soumet le formulaire de `chemin` qui contient le premier champ fourni.
   * Renvoie le statut, la redirection et, le cas échéant, le message d'erreur
   * que l'action a renvoyé dans son état.
   */
  async submit(chemin, champs) {
    const { body } = await this.get(chemin);
    const ancre = Object.keys(champs)[0];

    const formulaires = body.match(/<form\b[\s\S]*?<\/form>/g) ?? [];
    const cible = formulaires.find((f) => f.includes(`name="${ancre}"`));
    if (!cible) {
      throw new Error(
        `${chemin} : aucun <form> ne porte le champ « ${ancre} » ` +
          `(${formulaires.length} formulaire(s) sur la page)`,
      );
    }

    const payload = new FormData();
    for (const balise of cible.match(/<input[^>]*>/g) ?? []) {
      if (!balise.includes('type="hidden"')) continue;
      const nom = balise.match(/name="([^"]*)"/);
      const valeur = balise.match(/value="([^"]*)"/);
      if (nom) payload.append(decode(nom[1]), valeur ? decode(valeur[1]) : "");
    }
    if (![...payload.keys()].some((k) => k.startsWith("$ACTION"))) {
      throw new Error(`${chemin} : pas de Server Action dans ce formulaire`);
    }
    for (const [k, v] of Object.entries(champs)) payload.set(k, v);

    const response = await fetch(this.app + chemin, {
      method: "POST",
      headers: { cookie: this.#entete(), origin: this.app },
      body: payload,
      redirect: "manual",
    });
    this.#absorber(response);

    const texte = await response.text();
    const trouve = texte.match(/"error":"((?:[^"\\]|\\.){4,300})"/);
    return {
      status: response.status,
      location: response.headers.get("location"),
      message: trouve ? JSON.parse(`"${trouve[1]}"`) : null,
      // La charge utile brute. `message` ne remonte que les états portant une
      // clé `error` : une action qui répond par des `fieldErrors` — ou une page
      // d'erreur de Next — ne s'y voit pas.
      corps: texte,
    };
  }

  /**
   * Jeton d'accès de la session, lu dans le cookie posé par @supabase/ssr.
   *
   * Au-delà d'une certaine taille, ce cookie est DÉCOUPÉ en « …-auth-token.0 »,
   * « .1 », etc. Ne lire que le cookie entier donnerait un jeton tronqué —
   * et une erreur « Expected 3 parts in JWT » à la première requête.
   */
  jeton() {
    const morceaux = new Map();
    for (const [nom, valeur] of this.cookies) {
      const decoupe = nom.match(/^(.*)\.(\d+)$/);
      if (decoupe) {
        const [, base, index] = decoupe;
        if (!morceaux.has(base)) morceaux.set(base, []);
        morceaux.get(base)[Number(index)] = valeur;
      } else {
        morceaux.set(nom, [valeur]);
      }
    }

    for (const parties of morceaux.values()) {
      const valeur = parties.join("");
      if (!valeur.startsWith("base64-")) continue;
      try {
        const data = JSON.parse(
          Buffer.from(valeur.slice("base64-".length), "base64").toString("utf8"),
        );
        if (data?.access_token) return data.access_token;
      } catch {
        // Cookie « sb-… » qui n'est pas une session (vérificateur PKCE).
      }
    }
    return null;
  }
}

export const decode = (s) =>
  s
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

