/**
 * Vérification de bout en bout du carnet et du catalogue (phase 7).
 *
 * Comme les autres `verify:*`, ce script pilote l'application RÉELLEMENT
 * LANCÉE et se comporte comme un navigateur sans JavaScript. Il vérifie le
 * CÂBLAGE — écrans, Server Actions, recherche, lecture seule — là où
 * `rls_isolation.sql` (section 22) vérifie les FRONTIÈRES.
 *
 * CE QU'IL NE PEUT PAS ATTEINDRE : le sélecteur d'autocomplétion. C'est un
 * Popover monté par le JavaScript, et son contenu n'existe pas dans le HTML
 * servi. Ce qui est éprouvé ici, c'est ce dont il dépend : les DONNÉES que la
 * page lui remet (le carnet et le catalogue sont bien dans la charge utile de
 * l'éditeur) et l'ACTION derrière chaque choix. Le clic lui-même attend le
 * test navigateur de la phase 10.
 *
 * Prérequis : pile Supabase locale, `npm run dev`, `npm run db:seed`.
 */

import { Navigateur } from "./lib/navigateur.mjs";

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

/** Deux garages : l'un travaille, l'autre sert de voisin à ne pas voir. */
const A = {
  nom: `Carnet ${RUN}`,
  email: `carnet-${RUN}@verif.test`,
  motDePasse: `Carnet-${RUN}-2026`,
};
const B = {
  nom: `Voisin ${RUN}`,
  email: `voisin-${RUN}@verif.test`,
  motDePasse: `Voisin-${RUN}-2026`,
};

const CLIENT = `Transports Bernard ${RUN}`;
const SECRET_VOISIN = `Client secret ${RUN}`;
const PRESTATION = `Vidange ${RUN}`;
const SECRET_PRESTATION = `Prestation secrete ${RUN}`;

const echecs = [];

function check(label, ok, detail = "") {
  console.log(`  ${ok ? "ok  " : "ÉCHEC"}   ${label}${ok || !detail ? "" : `  — ${detail}`}`);
  if (!ok) echecs.push(label);
}

function section(titre) {
  console.log(`\n=== ${titre} ===\n`);
}

async function supabase(jeton, methode, chemin, corps) {
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

const enService = (m, c, b) => supabase(SERVICE, m, c, b);

/** Crée un garage abonné, connecte-le et remplace son mot de passe initial. */
async function ouvrirGarage(admin, garage) {
  const fin = new Date();
  fin.setFullYear(fin.getFullYear() + 1);

  const r = await admin.submit("/admin/comptes/nouveau", {
    garageName: garage.nom,
    fullName: "Gestionnaire",
    email: garage.email,
    password: garage.motDePasse,
    subscriptionEndDate: fin.toISOString().slice(0, 10),
  });
  if (r.status !== 200 || r.message) {
    throw new Error(`création du garage ${garage.nom} : ${r.message ?? r.status}`);
  }

  const nav = new Navigateur(APP);
  await nav.submit("/login", { email: garage.email, password: garage.motDePasse });
  await nav.submit("/change-password", {
    password: `${garage.motDePasse}-choisi`,
    passwordConfirm: `${garage.motDePasse}-choisi`,
  });
  garage.motDePasseFinal = `${garage.motDePasse}-choisi`;
  return nav;
}

async function main() {
  console.log(`\nVérification du carnet et du catalogue sur ${APP}\n`);

  // -------------------------------------------------------------------------
  section("1. Deux garages");

  const admin = new Navigateur(APP);
  let r = await admin.submit("/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("connexion de l'administrateur", r.status === 303, `HTTP ${r.status}`);

  const garage = await ouvrirGarage(admin, A);
  const voisin = await ouvrirGarage(admin, B);
  check("les deux garages sont ouverts", true);

  // -------------------------------------------------------------------------
  section("2. Carnet de clients : créer, retrouver, corriger");

  let page = await garage.get("/app/clients");
  check("/app/clients répond", page.status === 200, `HTTP ${page.status}`);
  check("l'état vide est soigné", page.body.includes("Aucun client enregistré"));

  r = await garage.submit("/app/clients/nouveau", {
    name: CLIENT,
    address: "12 rue des Lilas\n69003 Lyon",
    phone: "04 72 11 22 33",
    email: "contact@transports-bernard.test",
    vat_number: "FR40123456824",
    siret: "123 456 824 00017",
  });
  check("le client est créé", r.status === 200 && !r.message, r.message ?? `HTTP ${r.status}`);

  page = await garage.get("/app/clients");
  check("il figure dans le carnet", page.body.includes(CLIENT));

  // Le SIRET est compacté à l'enregistrement : la règle vient du schéma
  // partagé avec la fiche garage, pas d'une copie locale.
  const { data: enBase } = await enService(
    "GET",
    `/rest/v1/clients?name=eq.${encodeURIComponent(CLIENT)}&select=id,siret,vat_number,garage_id`,
  );
  const client = enBase?.[0];
  check("le SIRET est normalisé (14 chiffres)", client?.siret === "12345682400017",
    String(client?.siret));
  check("le n° de TVA est mis en forme", client?.vat_number === "FR40123456824",
    String(client?.vat_number));

  page = await garage.get(`/app/clients?q=${encodeURIComponent(CLIENT.slice(0, 12))}`);
  check("la recherche le retrouve", page.body.includes(CLIENT));

  page = await garage.get("/app/clients?q=zzz-introuvable-zzz");
  check("une recherche vide le dit sans mentir",
    page.body.includes("Aucun client ne correspond") && !page.body.includes(CLIENT));

  r = await garage.submit(`/app/clients/${client?.id}`, {
    name: `${CLIENT} (corrigé)`,
    address: "12 rue des Lilas\n69003 Lyon",
    phone: "04 72 11 22 33",
    email: "contact@transports-bernard.test",
    vat_number: "FR40123456824",
    siret: "123 456 824 00017",
  });
  check("la fiche se corrige", r.status === 200 && !r.message, r.message ?? "");

  // Un format invalide est refusé, et le dit — sans perdre la saisie.
  r = await garage.submit(`/app/clients/${client?.id}`, {
    name: `${CLIENT} (corrigé)`,
    siret: "123",
    address: "",
    phone: "",
    email: "",
    vat_number: "",
  });
  const { data: apresRefus } = await enService(
    "GET",
    `/rest/v1/clients?id=eq.${client?.id}&select=siret`,
  );
  check("un SIRET invalide est refusé", apresRefus?.[0]?.siret === "12345682400017",
    String(apresRefus?.[0]?.siret));

  // -------------------------------------------------------------------------
  section("3. Catalogue de prestations");

  page = await garage.get("/app/prestations");
  check("/app/prestations répond", page.status === 200, `HTTP ${page.status}`);
  check("l'état vide est soigné", page.body.includes("Aucune prestation enregistrée"));

  r = await garage.submit("/app/prestations/nouvelle", {
    label: PRESTATION,
    default_unit: "U",
    default_price_ht: "89",
    default_vat_rate: "20",
  });
  check("la prestation est créée", r.status === 200 && !r.message, r.message ?? "");

  page = await garage.get("/app/prestations");
  check("elle figure au catalogue", page.body.includes(PRESTATION));
  check("son prix est formaté selon la locale",
    page.body.includes("89,00") && page.body.includes("20 %"));

  // Une virgule française doit passer : on facture en France.
  r = await garage.submit("/app/prestations/nouvelle", {
    label: `${PRESTATION} bis`,
    default_unit: "H",
    default_price_ht: "62,50",
    default_vat_rate: "10",
  });
  const { data: prestations } = await enService(
    "GET",
    `/rest/v1/services?label=eq.${encodeURIComponent(PRESTATION + " bis")}&select=default_price_ht,default_unit`,
  );
  check("un prix saisi avec une virgule est accepté",
    Number(prestations?.[0]?.default_price_ht) === 62.5,
    String(prestations?.[0]?.default_price_ht));

  // -------------------------------------------------------------------------
  section("4. Ce que l'éditeur reçoit");

  // Le sélecteur est monté par le JavaScript ; ce qui se vérifie ici, c'est
  // que la page lui remet bien le carnet et le catalogue du garage.
  page = await garage.get("/app/factures/nouveau");
  check("l'éditeur répond", page.status === 200, `HTTP ${page.status}`);
  check("le carnet est servi à l'éditeur", page.body.includes(CLIENT));
  check("le catalogue est servi à l'éditeur", page.body.includes(PRESTATION));
  check("le client ponctuel reste possible",
    page.body.includes("client ponctuel"));

  // -------------------------------------------------------------------------
  section("5. Isolation, vue de l'application");

  await voisin.submit("/app/clients/nouveau", {
    name: SECRET_VOISIN,
    address: "",
    phone: "",
    email: "",
    vat_number: "",
    siret: "",
  });
  await voisin.submit("/app/prestations/nouvelle", {
    label: SECRET_PRESTATION,
    default_unit: "U",
    default_price_ht: "10",
    default_vat_rate: "20",
  });

  page = await garage.get("/app/clients");
  check("le carnet du voisin est invisible", !page.body.includes(SECRET_VOISIN));

  page = await garage.get("/app/prestations");
  check("le catalogue du voisin est invisible", !page.body.includes(SECRET_PRESTATION));

  page = await garage.get("/app/factures/nouveau");
  check("l'éditeur ne sert pas le carnet du voisin",
    !page.body.includes(SECRET_VOISIN) && !page.body.includes(SECRET_PRESTATION));

  const { data: duVoisin } = await enService(
    "GET",
    `/rest/v1/clients?name=eq.${encodeURIComponent(SECRET_VOISIN)}&select=id`,
  );
  const idVoisin = duVoisin?.[0]?.id;

  page = await garage.get(`/app/clients/${idVoisin}`);
  check("la fiche du voisin n'existe pas pour ce garage", page.status === 404,
    `HTTP ${page.status}`);

  // Écrire chez le voisin par la Server Action. On part de SA PROPRE fiche —
  // la page du voisin est un 404, elle ne porte aucun formulaire — et on
  // remplace le `clientId` caché par celui du voisin. C'est exactement ce que
  // ferait quelqu'un avec les outils de développement.
  r = await garage.submit(`/app/clients/${client?.id}`, {
    name: "Détournement",
    clientId: idVoisin,
    address: "",
    phone: "",
    email: "",
    vat_number: "",
    siret: "",
  });
  check("le détournement est refusé, et le dit", Boolean(r.message),
    r.message ?? "(aucun message)");
  const { data: intact } = await enService(
    "GET",
    `/rest/v1/clients?id=eq.${idVoisin}&select=name`,
  );
  check("le client du voisin n'a pas été réécrit", intact?.[0]?.name === SECRET_VOISIN,
    String(intact?.[0]?.name));

  // Le `garage_id` ne vient jamais du formulaire : glissé dans la charge
  // utile, il doit être ignoré au profit de celui du profil.
  const { data: fichesVoisin } = await enService(
    "GET",
    `/rest/v1/garages?email=eq.${B.email}&select=id`,
  );
  r = await garage.submit("/app/clients/nouveau", {
    name: `Tentative ${RUN}`,
    garage_id: fichesVoisin?.[0]?.id,
    address: "",
    phone: "",
    email: "",
    vat_number: "",
    siret: "",
  });
  const { data: tentative } = await enService(
    "GET",
    `/rest/v1/clients?name=eq.${encodeURIComponent("Tentative " + RUN)}&select=garage_id`,
  );
  check("le garage_id envoyé par le client est ignoré",
    tentative?.[0]?.garage_id === client?.garage_id,
    `rattaché à ${tentative?.[0]?.garage_id}`);

  // -------------------------------------------------------------------------
  section("6. Lecture seule");

  // L'administrateur désactive le garage : l'espace passe en lecture seule.
  const { data: fichesA } = await enService(
    "GET",
    `/rest/v1/garages?email=eq.${A.email}&select=id`,
  );
  await enService("PATCH", `/rest/v1/garages?id=eq.${fichesA?.[0]?.id}`, {
    is_active: false,
  });

  const bloque = new Navigateur(APP);
  await bloque.submit("/login", { email: A.email, password: A.motDePasseFinal });

  page = await bloque.get("/app/clients");
  check("le carnet reste CONSULTABLE en lecture seule",
    page.status === 200 && page.body.includes(CLIENT), `HTTP ${page.status}`);
  check("le bandeau explique pourquoi", page.body.includes("Compte désactivé"));

  r = await bloque.submit("/app/clients/nouveau", {
    name: `Malgré la lecture seule ${RUN}`,
    address: "",
    phone: "",
    email: "",
    vat_number: "",
    siret: "",
  });
  const { data: refuse } = await enService(
    "GET",
    `/rest/v1/clients?name=eq.${encodeURIComponent("Malgré la lecture seule " + RUN)}&select=id`,
  );
  check("la création est refusée", (refuse ?? []).length === 0,
    `${(refuse ?? []).length} ligne(s) créée(s)`);
  check("le refus est expliqué", Boolean(r.message), r.message ?? "(aucun message)");

  // -------------------------------------------------------------------------
  section("Bilan");

  if (echecs.length === 0) {
    console.log("  ✓ Carnet et catalogue : toutes les vérifications passent\n");
  } else {
    console.log(`  ✗ ${echecs.length} vérification(s) en échec :`);
    for (const e of echecs) console.log(`      · ${e}`);
    console.log();
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("\nInterruption :", error);
  process.exit(1);
});
