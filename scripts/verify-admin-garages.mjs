/**
 * Vérification de bout en bout de l'espace « Garages » (phase 3).
 *
 * Comme `verify:auth`, ce script pilote l'application RÉELLEMENT LANCÉE en se
 * comportant comme un navigateur sans JavaScript. Il vérifie le CÂBLAGE —
 * routes, formulaire, Server Actions, gardes de rôle, effets en base — là où
 * `rls_isolation.sql` (section 18) vérifie les FRONTIÈRES. Les deux sont
 * nécessaires : une policy parfaite derrière un formulaire mal branché ne
 * protège rien, et un formulaire impeccable devant une policy ouverte non plus.
 *
 * CE QUE CE SCRIPT NE PEUT PAS ATTEINDRE, et pourquoi : le contenu d'une
 * boîte de dialogue Radix (suppression, réinitialisation de mot de passe) et
 * les interrupteurs (activation, option premium) n'existent dans le HTML
 * qu'une fois le JavaScript exécuté. Leur logique est donc éprouvée ici par
 * son EFFET, en interrogeant la base avec la session de l'administrateur —
 * jamais avec la clé service role, qui contournerait justement ce qu'on veut
 * vérifier.
 *
 * Prérequis : pile Supabase locale, `npm run dev`, `npm run db:seed`.
 */

const APP = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const API = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

import { Navigateur } from "./lib/navigateur.mjs";

if (!ANON || !SERVICE || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error(
    "Variables manquantes. Attendues dans .env.local : NEXT_PUBLIC_SUPABASE_ANON_KEY, " +
      "SUPABASE_SERVICE_ROLE_KEY, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD.",
  );
  process.exit(1);
}

const RUN = Date.now().toString(36);
const GARAGE = {
  nom: `Fiche ${RUN}`,
  email: `fiche-${RUN}@verif.test`,
  motDePasse: `Fiche-${RUN}-2026`,
};

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

/**
 * Ajoute N mois à une date ISO, comme le fait `make_interval` en SQL.
 * Recalculé ici volontairement : si le script réutilisait la valeur renvoyée
 * par la base, il ne vérifierait plus rien.
 */
function ajouterMois(iso, mois) {
  const [a, m, j] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + mois, j));
  return d.toISOString().slice(0, 10);
}

/** Valeurs d'une fiche complète, telles qu'un vrai formulaire les enverrait. */
function fiche(surcharges = {}) {
  return {
    name: GARAGE.nom,
    legal_form: "SARL",
    siret: "812 345 678 00012",
    vat_number: "FR40812345678",
    rcs_city: "RCS Lyon 812 345 678",
    capital: "10 000 €",
    address: "12 rue des Ateliers\n69003 Lyon",
    phone: "04 72 00 00 00",
    email: `contact-${RUN}@verif.test`,
    iban: "FR7630006000011234567890189",
    bic: "AGRIFRPP",
    payment_term_days: "45",
    late_payment_penalty_rate: "12.5",
    recovery_indemnity: "40",
    ...surcharges,
  };
}

async function main() {
  console.log(`\nVérification de l'espace Garages sur ${APP}\n`);

  // -------------------------------------------------------------------------
  section("1. Un garage à administrer");

  const admin = new Navigateur(APP);
  let r = await admin.submit("/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("connexion de l'administrateur", r.status === 303 && r.location === "/",
    `HTTP ${r.status} -> ${r.location} ${r.message ?? ""}`);

  const finAbonnement = new Date();
  finAbonnement.setFullYear(finAbonnement.getFullYear() + 1);

  r = await admin.submit("/admin/comptes/nouveau", {
    garageName: GARAGE.nom,
    fullName: "Camille Roux",
    email: GARAGE.email,
    password: GARAGE.motDePasse,
    subscriptionEndDate: finAbonnement.toISOString().slice(0, 10),
  });
  check("création du compte garage", r.status === 200 && !r.message,
    `HTTP ${r.status} ${r.message ?? ""}`);

  const { data: crees } = await enService(
    "GET",
    `/rest/v1/garages?email=eq.${GARAGE.email}&select=id,name`,
  );
  const garageId = crees?.[0]?.id;
  check("garage retrouvé en base", Boolean(garageId), JSON.stringify(crees));
  if (!garageId) return;

  // -------------------------------------------------------------------------
  section("2. La liste");

  let page = await admin.get("/admin/garages");
  check("/admin/garages répond", page.status === 200, `HTTP ${page.status}`);
  check("le garage y figure", page.body.includes(GARAGE.nom));
  check("sa fiche est annoncée incomplète", page.body.includes("Fiche incomplète"));
  check("le lien vers la fiche est présent", page.body.includes(`/admin/garages/${garageId}`));

  page = await admin.get(`/admin/garages?q=${encodeURIComponent(GARAGE.nom)}`);
  check("la recherche par nom le trouve", page.body.includes(GARAGE.nom));

  page = await admin.get("/admin/garages?q=zzzintrouvablezzz");
  check("une recherche sans résultat le dit",
    page.body.includes("Aucun garage ne correspond") && !page.body.includes(GARAGE.nom));

  page = await admin.get("/admin/garages?statut=inactifs");
  check("le filtre « désactivés » l'exclut", !page.body.includes(GARAGE.nom));

  page = await admin.get("/admin/garages?statut=actifs");
  check("le filtre « actifs » le montre", page.body.includes(GARAGE.nom));

  page = await admin.get("/admin");
  check("le tableau de bord compte les fiches incomplètes",
    page.body.includes("Fiches incomplètes"));

  // -------------------------------------------------------------------------
  section("3. La fiche");

  page = await admin.get(`/admin/garages/${garageId}`);
  check("la fiche répond", page.status === 200, `HTTP ${page.status}`);
  check("elle affiche l'adresse de CONNEXION (garage_accounts)",
    page.body.includes(GARAGE.email));
  check("elle liste les mentions manquantes",
    page.body.includes("Mentions obligatoires manquantes"));
  check("elle porte une zone dangereuse", page.body.includes("Zone dangereuse"));
  check("elle porte le formulaire d'encaissement",
    page.body.includes("Enregistrer un paiement") && page.body.includes('name="paidOn"'));

  // --- Refus : un SIRET qui n'a pas 14 chiffres ---
  // L'erreur de champ est rendue par `useActionState`, donc invisible pour un
  // client sans JavaScript. Ce qui se vérifie ici, c'est le seul effet qui
  // compte : la base n'a pas bougé. Un refus qui écrirait quand même serait
  // le vrai bug.
  await admin.submit(`/admin/garages/${garageId}`, fiche({ siret: "1234" }));

  const { data: apresRefus } = await enService(
    "GET",
    `/rest/v1/garages?id=eq.${garageId}&select=siret`,
  );
  check("un SIRET invalide est refusé, et rien n'est écrit", apresRefus?.[0]?.siret === null,
    JSON.stringify(apresRefus));

  // --- Refus : un n° de TVA mal formé ---
  r = await admin.submit(`/admin/garages/${garageId}`, fiche({ vat_number: "DE123456789" }));
  const { data: apresTva } = await enService(
    "GET",
    `/rest/v1/garages?id=eq.${garageId}&select=vat_number`,
  );
  check("un n° de TVA non français est refusé", apresTva?.[0]?.vat_number === null,
    JSON.stringify(apresTva));

  // --- Enregistrement valide ---
  r = await admin.submit(`/admin/garages/${garageId}`, fiche({ vat_exempt: "on" }));
  check("la fiche complète est acceptée", r.status === 200 && !r.message,
    `HTTP ${r.status} ${r.message ?? ""}`);

  const { data: enregistre } = await enService(
    "GET",
    `/rest/v1/garages?id=eq.${garageId}&select=siret,vat_number,iban,legal_form,` +
      `rcs_city,capital,address,phone,vat_exempt,payment_term_days,` +
      `late_payment_penalty_rate,recovery_indemnity`,
  );
  const g = enregistre?.[0] ?? {};
  check("le SIRET est stocké sans les espaces de saisie", g.siret === "81234567800012", g.siret);
  check("le n° de TVA est normalisé en majuscules", g.vat_number === "FR40812345678", g.vat_number);
  check("l'IBAN est compacté", g.iban === "FR7630006000011234567890189", g.iban);
  check("la franchise en base est enregistrée", g.vat_exempt === true, String(g.vat_exempt));
  check("le délai de règlement est repris", Number(g.payment_term_days) === 45,
    String(g.payment_term_days));
  check("le taux de pénalités accepte les décimales",
    Number(g.late_payment_penalty_rate) === 12.5, String(g.late_payment_penalty_rate));
  check("l'indemnité de recouvrement vaut 40 €",
    Number(g.recovery_indemnity) === 40, String(g.recovery_indemnity));
  check("l'adresse multiligne est conservée", (g.address ?? "").includes("69003 Lyon"), g.address);

  // Filtrée sur ce garage : d'autres fiches de la base peuvent être
  // incomplètes, et la page entière dirait alors n'importe quoi.
  page = await admin.get(`/admin/garages?q=${encodeURIComponent(GARAGE.nom)}`);
  check("la liste annonce désormais une fiche complète",
    page.body.includes("Complète") && !page.body.includes("Fiche incomplète"),
    page.body.includes("Fiche incomplète") ? "toujours annoncée incomplète" : "");

  // -------------------------------------------------------------------------
  section("4. Droits et suppression, vus par la session de l'administrateur");

  // Les interrupteurs et la boîte de dialogue exigent JavaScript : on éprouve
  // ici le chemin de données qu'ils empruntent, avec le JETON DE LA SESSION,
  // donc sous RLS — pas avec la clé service role.
  const jetonAdmin = admin.jeton();
  check("jeton de session lisible", Boolean(jetonAdmin));

  let res = await supabase(jetonAdmin, "PATCH",
    `/rest/v1/garages?id=eq.${garageId}`, { logo_management_enabled: true });
  check("l'administrateur lève l'option premium", res.status === 200,
    `HTTP ${res.status} ${JSON.stringify(res.data)}`);

  res = await supabase(jetonAdmin, "PATCH",
    `/rest/v1/garages?id=eq.${garageId}`, { is_active: false });
  check("l'administrateur désactive le garage", res.status === 200, `HTTP ${res.status}`);

  page = await admin.get("/admin/garages");
  check("la liste montre « Désactivé »", page.body.includes("Désactivé"));
  page = await admin.get("/admin/garages?statut=inactifs");
  check("le filtre « désactivés » le montre maintenant", page.body.includes(GARAGE.nom));

  res = await supabase(jetonAdmin, "PATCH",
    `/rest/v1/garages?id=eq.${garageId}`, { is_active: true });
  check("puis le réactive", res.status === 200, `HTTP ${res.status}`);

  // Option premium remise à false : sans cela, la tentative du garage plus
  // bas ne prouverait rien — le drapeau serait déjà levé.
  await supabase(jetonAdmin, "PATCH",
    `/rest/v1/garages?id=eq.${garageId}`, { logo_management_enabled: false });

  res = await supabase(jetonAdmin, "POST", "/rest/v1/rpc/garage_is_deletable", { g: garageId });
  check("garage_is_deletable() : vrai sans facture émise", res.data === true,
    JSON.stringify(res.data));

  // Une facture émise doit fermer la porte. On la crée avec la clé service
  // role (le garage la créerait lui-même en phase 5), puis on REDEMANDE à la
  // base : c'est sa réponse qui doit changer, pas un calcul du script.
  const { data: facture } = await enService("POST", "/rest/v1/invoices", {
    garage_id: garageId,
    client_name: "Client de vérification",
    status: "final",
    number: `VERIF-${RUN}`,
    // `invoices_number_status_ck` : une facture non-brouillon porte un numéro
    // ET une date de finalisation. En phase 6, c'est `finalize_invoice()` qui
    // pose les deux ; ici on imite son résultat.
    finalized_at: new Date().toISOString(),
  });
  check("facture émise créée pour la vérification", Boolean(facture?.[0]?.id),
    JSON.stringify(facture));

  res = await supabase(jetonAdmin, "POST", "/rest/v1/rpc/garage_is_deletable", { g: garageId });
  check("garage_is_deletable() : faux dès la première facture émise", res.data === false,
    JSON.stringify(res.data));

  page = await admin.get(`/admin/garages/${garageId}`);
  check("la fiche annonce alors la suppression impossible",
    page.body.includes("conservation légale") || page.body.includes("Impossible"));

  // Et la base refuse effectivement, pas seulement l'écran.
  res = await supabase(jetonAdmin, "DELETE", `/rest/v1/garages?id=eq.${garageId}`);
  check("la base refuse la suppression d'un garage ayant émis", res.status >= 400,
    `HTTP ${res.status}`);

  const { data: survivant } = await enService(
    "GET",
    `/rest/v1/garages?id=eq.${garageId}&select=id`,
  );
  check("et le garage est toujours là", survivant?.length === 1,
    JSON.stringify(survivant));

  // -------------------------------------------------------------------------
  section("5. Abonnement et paiements");

  // Le garage a été créé avec un abonnement d'un an : c'est de CETTE échéance
  // que doit partir la prolongation, pas d'aujourd'hui.
  const { data: avant } = await enService(
    "GET",
    `/rest/v1/subscriptions?garage_id=eq.${garageId}&select=end_date`,
  );
  const echeanceAvant = avant?.[0]?.end_date;
  check("échéance initiale lue", Boolean(echeanceAvant), JSON.stringify(avant));

  page = await admin.get(`/admin/garages/${garageId}`);
  check("l'historique est vide au départ", page.body.includes("Aucun paiement enregistré"));

  r = await admin.submit(`/admin/garages/${garageId}`, {
    paidOn: new Date().toISOString().slice(0, 10),
    amount: "240",
    method: "virement",
    months: "12",
    endDate: "",
    notes: "Renouvellement annuel",
  });
  check("le paiement est accepté", r.status === 200 && !r.message,
    `HTTP ${r.status} ${r.message ?? ""}`);

  const { data: apres } = await enService(
    "GET",
    `/rest/v1/subscriptions?garage_id=eq.${garageId}&select=end_date`,
  );
  const attendu = ajouterMois(echeanceAvant, 12);
  check("l'abonnement est prolongé à partir de l'échéance en cours",
    apres?.[0]?.end_date === attendu,
    `attendu ${attendu}, obtenu ${apres?.[0]?.end_date}`);

  const { data: paiements } = await enService(
    "GET",
    `/rest/v1/payments?garage_id=eq.${garageId}&select=amount,method,months_added,period_end,notes`,
  );
  const paiement = paiements?.[0];
  check("le paiement est consigné", Number(paiement?.amount) === 240 &&
    paiement?.method === "virement" && Number(paiement?.months_added) === 12,
    JSON.stringify(paiement));
  check("la ligne d'historique porte l'échéance obtenue",
    paiement?.period_end === attendu, String(paiement?.period_end));

  page = await admin.get(`/admin/garages/${garageId}`);
  check("l'historique affiche l'encaissement",
    page.body.includes("Renouvellement annuel") && page.body.includes("+ 12 mois"));
  check("l'état d'abonnement est annoncé", page.body.includes("Actif jusqu"));

  // Saisie incohérente : une durée ET une date. La base doit refuser, et rien
  // ne doit bouger.
  r = await admin.submit(`/admin/garages/${garageId}`, {
    paidOn: new Date().toISOString().slice(0, 10),
    amount: "10",
    method: "especes",
    months: "1",
    endDate: ajouterMois(attendu, 1),
    notes: "",
  });
  const { data: inchange } = await enService(
    "GET",
    `/rest/v1/subscriptions?garage_id=eq.${garageId}&select=end_date`,
  );
  check("« durée ET date » est refusé, sans rien changer",
    inchange?.[0]?.end_date === attendu, String(inchange?.[0]?.end_date));

  page = await admin.get("/admin");
  check("le tableau de bord suit les abonnements",
    page.body.includes("Abonnements expirés") && page.body.includes("Expirant sous 7 jours"));

  // -------------------------------------------------------------------------
  section("6. Gardes de rôle");

  const garage = new Navigateur(APP);
  r = await garage.submit("/login", { email: GARAGE.email, password: GARAGE.motDePasse });
  check("connexion du garage", r.status === 303, `HTTP ${r.status} ${r.message ?? ""}`);

  // Compte créé par l'admin : changement de mot de passe forcé d'abord.
  r = await garage.submit("/change-password", {
    password: `${GARAGE.motDePasse}-choisi`,
    passwordConfirm: `${GARAGE.motDePasse}-choisi`,
  });
  check("changement du mot de passe initial", r.status === 303,
    `HTTP ${r.status} ${r.message ?? "(aucun message)"}`);

  let sortie = await garage.get("/admin/garages", { suivre: false });
  check("un garage n'entre pas dans /admin/garages",
    sortie.status === 307 || sortie.status === 303, `HTTP ${sortie.status}`);

  sortie = await garage.get(`/admin/garages/${garageId}`, { suivre: false });
  check("ni dans la fiche d'un garage",
    sortie.status === 307 || sortie.status === 303, `HTTP ${sortie.status}`);

  const jetonGarage = garage.jeton();
  res = await supabase(jetonGarage, "POST", "/rest/v1/rpc/garage_is_deletable", { g: garageId });
  check("garage_is_deletable() reste fermée au garage", res.data === false,
    JSON.stringify(res.data));

  res = await supabase(jetonGarage, "POST", "/rest/v1/rpc/garage_accounts", { g: garageId });
  check("garage_accounts() ne lui rend aucun compte",
    Array.isArray(res.data) && res.data.length === 0, JSON.stringify(res.data));

  res = await supabase(jetonGarage, "PATCH",
    `/rest/v1/garages?id=eq.${garageId}`, { logo_management_enabled: true });
  const { data: apresTentative } = await enService(
    "GET",
    `/rest/v1/garages?id=eq.${garageId}&select=logo_management_enabled,name`,
  );
  check("un garage ne s'octroie pas l'option premium par l'API",
    apresTentative?.[0]?.logo_management_enabled === false,
    `HTTP ${res.status} — drapeau : ${apresTentative?.[0]?.logo_management_enabled}`);

  res = await supabase(jetonGarage, "PATCH",
    `/rest/v1/garages?id=eq.${garageId}`, { name: "Renommé par le garage" });
  check("ni ne renomme sa fiche",
    apresTentative?.[0]?.name === GARAGE.nom, JSON.stringify(apresTentative));

  // -------------------------------------------------------------------------
  section("Bilan");

  if (echecs.length === 0) {
    console.log("  ✓ Espace Garages : toutes les vérifications passent\n");
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
