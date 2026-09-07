/**
 * Vérification de bout en bout des logos (phase 9).
 *
 * ---------------------------------------------------------------------------
 * CE SCRIPT LÈVE UNE RÉSERVE DU PROJET
 * ---------------------------------------------------------------------------
 * Jusqu'ici, les policies du bucket n'étaient éprouvées que par
 * `rls_isolation.sql`, sur la TABLE `storage.objects` — et, hors projet
 * Supabase, sur un stub qui reconstitue le schéma. Cela prouvait que les
 * policies écrivent ce qu'on croit ; cela ne prouvait pas que le SERVICE de
 * stockage les applique.
 *
 * Ici, on téléverse et on télécharge pour de bon, contre l'API Storage locale
 * (`/storage/v1/object/logos/…`), avec le JETON DE SESSION de chaque garage.
 * Un garage n'écrit et ne lit que dans son dossier `{garage_id}/` ; un garage
 * standard ne téléverse rien ; l'anonyme n'obtient rien. La clé service role
 * ne sert qu'à OBSERVER et à monter le décor.
 *
 * Prérequis : pile Supabase locale, `npm run dev`, `npm run db:seed`.
 */

import { Navigateur } from "./lib/navigateur.mjs";
import { contientTexte, texteDuPdf } from "./lib/pdf-texte.mjs";
import { nettoyerRun } from "./lib/nettoyage.mjs";

const APP = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const API = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

if (!ANON || !SERVICE || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error(
    "Variables manquantes. Attendues dans .env.local : NEXT_PUBLIC_SUPABASE_ANON_KEY, " +
      "SUPABASE_SERVICE_ROLE_KEY, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD.",
  );
  process.exit(1);
}

const RUN = Date.now().toString(36);

/** PREMIUM : gère sa bibliothèque. STANDARD : subit le logo de l'admin. */
const PREMIUM = {
  nom: `Logo premium ${RUN}`,
  email: `logopremium-${RUN}@verif.test`,
  motDePasse: `Logopremium-${RUN}-2026`,
  premium: true,
};
const STANDARD = {
  nom: `Logo standard ${RUN}`,
  email: `logostandard-${RUN}@verif.test`,
  motDePasse: `Logostandard-${RUN}-2026`,
  premium: false,
};

const echecs = [];

function check(label, ok, detail = "") {
  console.log(`  ${ok ? "ok  " : "ÉCHEC"}   ${label}${ok || !detail ? "" : `  — ${detail}`}`);
  if (!ok) echecs.push(label);
}

function section(titre) {
  console.log(`\n=== ${titre} ===\n`);
}

/**
 * Un PNG 1×1 valide, écrit en dur.
 *
 * Pas de fichier d'appoint dans le dépôt : le test doit tourner sur une copie
 * fraîche sans rien d'autre que le code.
 */
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Un PNG valide de plus de 2 Mio.
 *
 * Un vrai en-tête PNG suivi d'un remplissage : ce qui est éprouvé, c'est le
 * refus par la TAILLE, pas par le format — un fichier bidon serait refusé pour
 * la mauvaise raison et le test ne prouverait rien.
 */
const PNG_LOURD = Buffer.concat([PNG_1x1, Buffer.alloc(2 * 1024 * 1024 + 64 * 1024, 0x20)]);

/** Un SVG minimal : refusé par le bucket, et c'est le but. */
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>');

async function rest(jeton, methode, chemin, corps) {
  const response = await fetch(API + chemin, {
    method: methode,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${jeton}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const texte = await response.text();
  let data = null;
  try {
    data = texte ? JSON.parse(texte) : null;
  } catch {
    data = texte;
  }
  return { status: response.status, data };
}

const enService = (m, c, b) => rest(SERVICE, m, c, b);
const seul = (d) => (Array.isArray(d) ? d[0] : d);

// ---------------------------------------------------------------------------
// Appels DIRECTS au service de stockage
// ---------------------------------------------------------------------------

/** Téléverse un objet dans le bucket, avec le jeton fourni. */
async function televerser(jeton, chemin, octets, type = "image/png") {
  const response = await fetch(`${API}/storage/v1/object/logos/${chemin}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${jeton}`, "Content-Type": type },
    body: octets,
  });
  return { status: response.status, corps: await response.text() };
}

/** Télécharge un objet du bucket, avec le jeton fourni. */
async function telechargerObjet(jeton, chemin) {
  const response = await fetch(`${API}/storage/v1/object/logos/${chemin}`, {
    headers: jeton ? { apikey: ANON, Authorization: `Bearer ${jeton}` } : { apikey: ANON },
  });
  return { status: response.status, octets: Buffer.from(await response.arrayBuffer()) };
}

/** Demande une URL signée, avec le jeton fourni. */
async function signer(jeton, chemin) {
  const response = await fetch(`${API}/storage/v1/object/sign/logos/${chemin}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 60 }),
  });
  const texte = await response.text();
  return { status: response.status, corps: texte };
}

/** Liste le contenu d'un dossier du bucket. */
async function lister(jeton, prefixe) {
  const response = await fetch(`${API}/storage/v1/object/list/logos`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: prefixe, limit: 100 }),
  });
  const data = await response.json().catch(() => []);
  return { status: response.status, objets: Array.isArray(data) ? data : [] };
}

/** Ouvre un garage abonné, fiche remplie, avec ou sans le drapeau premium. */
async function ouvrirGarage(admin, garage) {
  const fin = new Date();
  fin.setFullYear(fin.getFullYear() + 1);

  let r = await admin.submit("/admin/comptes/nouveau", {
    garageName: garage.nom,
    fullName: "Gestionnaire",
    email: garage.email,
    password: garage.motDePasse,
    subscriptionEndDate: fin.toISOString().slice(0, 10),
  });
  if (r.status !== 200 || r.message) {
    throw new Error(`création de ${garage.nom} : ${r.message ?? r.status}`);
  }

  const { data } = await enService(
    "GET",
    `/rest/v1/garages?email=eq.${garage.email}&select=id`,
  );
  garage.id = data?.[0]?.id;

  r = await admin.submit(`/admin/garages/${garage.id}`, {
    siret: "812 345 678 00012",
    name: garage.nom,
    legal_form: "SARL",
    rcs_city: "RCS Lyon 812 345 678",
    address: "24 avenue des Frères Lumière, 69008 Lyon",
    payment_term_days: "30",
    late_payment_penalty_rate: "10.75",
    recovery_indemnity: "40",
  });
  if (r.message) throw new Error(`fiche de ${garage.nom} : ${r.message}`);

  // Le drapeau premium : posé en base par l'admin (l'interrupteur de la fiche
  // est un composant Radix, hors de portée d'un navigateur sans JavaScript).
  if (garage.premium) {
    await enService("PATCH", `/rest/v1/garages?id=eq.${garage.id}`, {
      logo_management_enabled: true,
    });
  }

  const nav = new Navigateur(APP);
  await nav.submit("/login", { email: garage.email, password: garage.motDePasse });
  await nav.submit("/change-password", {
    password: `${garage.motDePasse}-choisi`,
    passwordConfirm: `${garage.motDePasse}-choisi`,
  });
  garage.motDePasseFinal = `${garage.motDePasse}-choisi`;
  garage.jeton = nav.jeton();
  return nav;
}

async function main() {
  console.log(`\nVérification des logos sur ${APP} (stockage : ${API})\n`);

  // -------------------------------------------------------------------------
  section("1. Deux garages, un premium et un standard");

  const admin = new Navigateur(APP);
  let r = await admin.submit("/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("connexion de l'administrateur", r.status === 303, `HTTP ${r.status}`);

  const navPremium = await ouvrirGarage(admin, PREMIUM);
  const navStandard = await ouvrirGarage(admin, STANDARD);
  check("les deux garages sont ouverts", Boolean(PREMIUM.id && STANDARD.id));
  check("les deux jetons sont lisibles", Boolean(PREMIUM.jeton && STANDARD.jeton));

  // -------------------------------------------------------------------------
  section("2. Stockage réel : un garage n'écrit que dans son dossier");

  const chemPremium = `${PREMIUM.id}/${RUN}-premium.png`;
  let res = await televerser(PREMIUM.jeton, chemPremium, PNG_1x1);
  check("le garage premium téléverse chez lui", res.status === 200,
    `HTTP ${res.status} ${res.corps.slice(0, 120)}`);

  // La frontière : le dossier du voisin.
  res = await televerser(PREMIUM.jeton, `${STANDARD.id}/${RUN}-pirate.png`, PNG_1x1);
  check("il ne téléverse pas chez le voisin", res.status >= 400,
    `HTTP ${res.status} ${res.corps.slice(0, 120)}`);

  // À la racine du bucket : pas de dossier, donc pas de propriétaire.
  res = await televerser(PREMIUM.jeton, `${RUN}-racine.png`, PNG_1x1);
  check("il ne téléverse pas à la racine du bucket", res.status >= 400,
    `HTTP ${res.status}`);

  // Un garage STANDARD ne gère pas ses logos : `can_manage_logos()` est faux.
  res = await televerser(STANDARD.jeton, `${STANDARD.id}/${RUN}-standard.png`, PNG_1x1);
  check("le garage standard ne téléverse rien, même chez lui", res.status >= 400,
    `HTTP ${res.status} ${res.corps.slice(0, 120)}`);

  // Le format : le bucket n'accepte que PNG et JPEG.
  res = await televerser(
    PREMIUM.jeton,
    `${PREMIUM.id}/${RUN}-vecteur.svg`,
    SVG,
    "image/svg+xml",
  );
  check("le SVG est refusé par le bucket", res.status >= 400,
    `HTTP ${res.status} ${res.corps.slice(0, 140)}`);

  // -------------------------------------------------------------------------
  section("3. Stockage réel : un garage ne lit que son dossier");

  let obj = await telechargerObjet(PREMIUM.jeton, chemPremium);
  check("le garage premium relit son fichier",
    obj.status === 200 && obj.octets.length === PNG_1x1.length,
    `HTTP ${obj.status}, ${obj.octets.length} octets`);

  // L'admin dépose un logo chez le garage standard : c'est le chemin prévu.
  const chemStandard = `${STANDARD.id}/${RUN}-assigne.png`;
  res = await televerser(admin.jeton(), chemStandard, PNG_1x1);
  check("l'administrateur téléverse chez un garage", res.status === 200,
    `HTTP ${res.status} ${res.corps.slice(0, 120)}`);

  obj = await telechargerObjet(PREMIUM.jeton, chemStandard);
  check("le premium ne lit pas le fichier du voisin", obj.status >= 400,
    `HTTP ${obj.status}`);

  obj = await telechargerObjet(STANDARD.jeton, chemPremium);
  check("le standard ne lit pas le fichier du premium", obj.status >= 400,
    `HTTP ${obj.status}`);

  obj = await telechargerObjet(null, chemPremium);
  check("un anonyme n'obtient rien : le bucket est privé", obj.status >= 400,
    `HTTP ${obj.status}`);

  // Signature : c'est elle que l'application utilise pour afficher.
  let signature = await signer(PREMIUM.jeton, chemPremium);
  check("le garage signe son propre fichier", signature.status === 200,
    `HTTP ${signature.status}`);

  signature = await signer(PREMIUM.jeton, chemStandard);
  check("il ne signe pas celui du voisin", signature.status >= 400,
    `HTTP ${signature.status} ${signature.corps.slice(0, 120)}`);

  // Le listage ne doit pas non plus révéler le dossier d'à côté.
  const listage = await lister(PREMIUM.jeton, STANDARD.id);
  check("le listage du dossier voisin ne rend rien",
    listage.objets.length === 0, `${listage.objets.length} objet(s)`);

  // -------------------------------------------------------------------------
  section("4. La bibliothèque, par les écrans");

  let page = await navPremium.get("/app/logos");
  check("/app/logos répond pour un compte premium", page.status === 200,
    `HTTP ${page.status}`);
  check("l'onglet « Mes logos » est proposé", page.body.includes("Mes logos"));
  check("le refus du SVG est annoncé à la personne",
    page.body.includes("PNG ou JPEG") && page.body.includes("SVG"));

  page = await navStandard.get("/app/logos");
  check("un garage standard n'y entre pas", page.status === 404, `HTTP ${page.status}`);

  page = await navStandard.get("/app/factures/nouveau");
  check("il n'a pas non plus le sélecteur de logo dans l'éditeur",
    !page.body.includes("Le logo de cette facture"));

  // Le sélecteur du compte premium est vérifié en section 5 : la carte ne
  // s'affiche qu'à partir du moment où la bibliothèque contient un logo — un
  // sélecteur sans rien à sélectionner n'aurait rien à dire.

  // -------------------------------------------------------------------------
  section("5. Taille : refus doux, jamais de page cassée");

  // La limite du bucket, éprouvée directement.
  res = await televerser(PREMIUM.jeton, `${PREMIUM.id}/${RUN}-lourd.png`, PNG_LOURD);
  check("le bucket refuse un fichier de plus de 2 Mio", res.status >= 400,
    `HTTP ${res.status} ${res.corps.slice(0, 120)}`);

  // La Server Action, par le vrai formulaire : elle doit RÉPONDRE, pas planter.
  // C'est le chemin qui produisait « Body exceeded 1 MB limit ».
  let envoi = await navPremium.submit("/app/logos", {
    file: new File([PNG_LOURD], "gros.png", { type: "image/png" }),
    label: "Trop lourd",
  });
  check("la Server Action répond au lieu de planter",
    envoi.status === 200, `HTTP ${envoi.status}`);
  check("elle refuse en une phrase compréhensible",
    envoi.corps.includes("Image trop lourde"),
    envoi.corps.slice(0, 200));
  check("aucun logo n'a été créé au passage",
    (await enService("GET", `/rest/v1/logos?garage_id=eq.${PREMIUM.id}&select=id`)).data
      ?.length === 0);

  // Et un fichier valide passe par ce même chemin.
  envoi = await navPremium.submit("/app/logos", {
    file: new File([PNG_1x1], "petit.png", { type: "image/png" }),
    label: "Logo léger",
  });
  check("un fichier valide est accepté par la Server Action",
    envoi.status === 200 && !envoi.corps.includes("Image trop lourde"),
    `HTTP ${envoi.status}`);

  const { data: apresEnvoi } = await enService(
    "GET",
    `/rest/v1/logos?garage_id=eq.${PREMIUM.id}&select=id,label,is_default`,
  );
  check("le logo est bien enregistré", (apresEnvoi ?? []).length === 1,
    `${(apresEnvoi ?? []).length} logo(s)`);
  check("le premier logo devient le défaut", seul(apresEnvoi)?.is_default === true);

  // Le formulaire annonce la limite avant même l'envoi.
  page = await navPremium.get("/app/logos");
  check("la limite est annoncée dans le formulaire", page.body.includes("2 Mo maximum"));

  // -------------------------------------------------------------------------
  section("6. Le logo sur la facture, et son gel");

  // On enregistre la ligne `logos` du fichier téléversé en section 2, en plus
  // de celui posé par la Server Action.
  res = await rest(PREMIUM.jeton, "POST", "/rest/v1/logos", {
    garage_id: PREMIUM.id,
    storage_path: chemPremium,
    label: "Logo de test",
  });
  const logo = seul(res.data);
  check("le logo est enregistré dans la bibliothèque", res.status === 201,
    `HTTP ${res.status} ${JSON.stringify(res.data).slice(0, 140)}`);

  // Une facture émise avec ce logo.
  const brouillon = await rest(PREMIUM.jeton, "POST", "/rest/v1/rpc/save_invoice_draft", {
    p_invoice_id: null,
    p_header: {
      client_name: "Client au logo",
      issue_date: new Date().toISOString().slice(0, 10),
      logo_id: logo?.id,
    },
    p_lines: [{ description: "Prestation", quantity: 1, unit_price_ht: 100, vat_rate: 20 }],
    p_decimals: 2,
  });
  const idFacture = seul(brouillon.data)?.id;
  check("le brouillon retient le logo", seul(brouillon.data)?.logo_id === logo?.id,
    String(seul(brouillon.data)?.logo_id));

  const emise = await rest(PREMIUM.jeton, "POST", "/rest/v1/rpc/finalize_invoice", {
    p_invoice_id: idFacture,
    p_decimals: 2,
  });
  const facture = seul(emise.data);
  check("le chemin du logo est gelé à l'émission",
    facture?.seller_snapshot?.logo_path === chemPremium,
    String(facture?.seller_snapshot?.logo_path));

  // Le PDF porte le logo : une image est embarquée dans le document.
  const cookie = [...navPremium.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  const repPdf = await fetch(`${APP}/app/factures/${idFacture}/pdf`, { headers: { cookie } });
  const pdf = Buffer.from(await repPdf.arrayBuffer());
  check("le PDF est produit", repPdf.status === 200, `HTTP ${repPdf.status}`);
  check("il embarque une image",
    pdf.includes(Buffer.from("/Image")) || pdf.includes(Buffer.from("/XObject")),
    `${pdf.length} octets`);
  check("il porte quand même la dénomination en texte",
    contientTexte(texteDuPdf(pdf), PREMIUM.nom));

  // Le gel : le logo ne se supprime plus, et la facture le garde.
  res = await rest(PREMIUM.jeton, "DELETE", `/rest/v1/logos?id=eq.${logo?.id}`);
  check("le logo d'une facture émise ne se supprime plus", res.status >= 400,
    `HTTP ${res.status} ${JSON.stringify(res.data).slice(0, 160)}`);

  const { data: toujours } = await enService(
    "GET",
    `/rest/v1/invoices?id=eq.${idFacture}&select=logo_id`,
  );
  check("la facture émise garde son logo", seul(toujours)?.logo_id === logo?.id,
    String(seul(toujours)?.logo_id));

  page = await navPremium.get("/app/logos");
  check("l'écran annonce le verrou avant le clic",
    page.body.includes("Sur des factures émises"));

  // La bibliothèque n'est plus vide : le sélecteur par facture apparaît.
  page = await navPremium.get("/app/factures/nouveau");
  check("l'éditeur du compte premium offre le sélecteur de logo",
    page.body.includes("Le logo de cette facture"));
  check("il y propose « Par défaut » et le logo enregistré",
    page.body.includes("Par défaut") && page.body.includes("Logo de test"));

  // -------------------------------------------------------------------------
  section("Bilan");

  if (echecs.length === 0) {
    console.log("  ✓ Logos : toutes les vérifications passent\n");
  } else {
    console.log(`  ✗ ${echecs.length} vérification(s) en échec :`);
    for (const e of echecs) console.log(`      · ${e}`);
    console.log();
    process.exitCode = 1;
  }
}

// Le ménage passe APRÈS le bilan et ne touche jamais au code de sortie :
// une vérification ne doit pas passer au rouge parce que la corbeille est
// pleine. Il ne retire que les comptes en `<préfixe>-<run>@verif.test`,
// donc exactement ce que CETTE exécution a créé.
main()
  .catch((error) => {
    console.error("\nInterruption :", error?.stack ?? error);
    process.exitCode = 1;
  })
  .finally(() => nettoyerRun(RUN));
