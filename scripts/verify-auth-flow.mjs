/**
 * Vérification de bout en bout de l'authentification (phase 2).
 *
 * Rejoue, à travers l'application réellement lancée, les deux chemins de
 * création de compte, le changement de mot de passe obligatoire, l'essai
 * gratuit et son plafond, la limitation de débit et la réinitialisation par
 * l'administrateur.
 *
 * ---------------------------------------------------------------------------
 * CE QUE CE SCRIPT COMPLÈTE — ET CE QU'IL NE REMPLACE PAS
 * ---------------------------------------------------------------------------
 * Les preuves qui font foi sur les FRONTIÈRES vivent en SQL :
 * `supabase/tests/rls_isolation.sql` et `supabase/tests/rate_limit.sql`. Elles
 * tiennent quel que soit le chemin d'écriture, et savent échouer (mutations
 * listées dans leurs en-têtes).
 *
 * Celui-ci vérifie le CÂBLAGE : que les Server Actions, le proxy, les gardes
 * de layout et les redirections s'enchaînent comme prévu. Un RLS parfait
 * derrière un formulaire mal branché ne sert à rien.
 *
 * ---------------------------------------------------------------------------
 * COMMENT IL PILOTE L'APPLICATION
 * ---------------------------------------------------------------------------
 * Next.js rend ses Server Actions en amélioration progressive : le <form>
 * porte des champs cachés `$ACTION_*` et un POST multipart ordinaire suffit.
 * On se comporte donc comme un navigateur SANS JavaScript — ce qui a le mérite
 * de vérifier au passage que les formulaires fonctionnent dans ce mode.
 *
 * Piège : une page peut porter PLUSIEURS formulaires (celui qu'on vise et le
 * bouton de déconnexion). On isole donc le <form> qui contient le champ visé,
 * sinon on déclenche l'autre action et le test raconte n'importe quoi.
 *
 * ---------------------------------------------------------------------------
 * PRÉREQUIS
 * ---------------------------------------------------------------------------
 *   npx supabase start     pile locale (Postgres, Auth, Mailpit)
 *   npx supabase db reset  migrations appliquées
 *   npm run db:seed        compte super administrateur
 *   npm run dev            application sur http://localhost:3000
 *   npm run verify:auth
 *
 * Chaque exécution crée des comptes horodatés : le script est rejouable sans
 * nettoyage. Pour repartir de zéro : `npx supabase db reset`.
 */

import { Navigateur, decode } from "./lib/navigateur.mjs";

const APP = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const API = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

if (!ANON || !SERVICE || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error(
    "\n  ✗ Variables manquantes. Ce script attend, dans .env.local :\n" +
      "    NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,\n" +
      "    SUPABASE_SERVICE_ROLE_KEY, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD\n",
  );
  process.exit(1);
}

/** Suffixe horodaté : chaque exécution travaille sur ses propres comptes. */
const RUN = Date.now().toString(36);
const GARAGE = {
  email: `garage-${RUN}@verif.test`,
  initial: `Initial-${RUN}-2026`,
  choisi: `Choisi-${RUN}-2026`,
};
const INSCRIT = { email: `inscrit-${RUN}@verif.test`, password: `Inscrit-${RUN}-2026` };

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------
const echecs = [];

function check(label, ok, detail = "") {
  console.log(`  ${ok ? "ok   " : "ÉCHEC"}  ${label}${ok || !detail ? "" : `   [${detail}]`}`);
  if (!ok) echecs.push(label);
}

function section(titre) {
  console.log(`\n=== ${titre} ===\n`);
}

// ---------------------------------------------------------------------------
// Accès direct à Supabase, pour constater ce que l'application a écrit
// ---------------------------------------------------------------------------
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

async function redirigeVers(nav, chemin, attendu) {
  const { status, location } = await nav.get(chemin, { suivre: false });
  check(
    `${chemin.padEnd(20)} -> ${attendu}`,
    status >= 300 && status < 400 && (location ?? "").startsWith(attendu),
    `HTTP ${status} vers ${location ?? "(rien)"}`,
  );
}

async function pageContient(nav, chemin, aiguille) {
  const { status, body } = await nav.get(chemin);
  check(
    `${chemin.padEnd(20)} affiche « ${aiguille} »`,
    status === 200 && body.includes(aiguille),
    `HTTP ${status}`,
  );
}

// ---------------------------------------------------------------------------
async function main() {
  console.log(`\n  Vérification du parcours d'authentification — exécution ${RUN}`);
  console.log(`  Application : ${APP}   Supabase : ${API}\n`);

  // -------------------------------------------------------------------------
  section("1. L'administrateur crée un compte garage (sans vérification d'e-mail)");

  const admin = new Navigateur(APP);
  let r = await admin.submit("/login", {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  check("connexion de l'administrateur", r.status === 303 && r.location === "/",
    `HTTP ${r.status} -> ${r.location} ${r.message ?? ""}`);

  await redirigeVers(admin, "/", "/admin");
  await redirigeVers(admin, "/app", "/admin");
  await redirigeVers(admin, "/login", "/");

  const finAbonnement = new Date();
  finAbonnement.setFullYear(finAbonnement.getFullYear() + 1);

  r = await admin.submit("/admin/comptes/nouveau", {
    garageName: `Garage ${RUN}`,
    fullName: "Jean Dupont",
    email: GARAGE.email,
    password: GARAGE.initial,
    subscriptionEndDate: finAbonnement.toISOString().slice(0, 10),
  });
  check("création du compte garage", r.status === 200 && !r.message,
    `HTTP ${r.status} ${r.message ?? ""}`);

  const { data: garages } = await enService(
    "GET",
    `/rest/v1/garages?email=eq.${GARAGE.email}&select=id,origin,account_status,subscriptions(end_date)`,
  );
  const garageAdmin = garages?.[0];
  // `subscriptions` a une contrainte d'unicité sur garage_id : PostgREST en
  // déduit une relation « vers-un » et renvoie un objet, pas un tableau.
  const abonnement = Array.isArray(garageAdmin?.subscriptions)
    ? garageAdmin.subscriptions[0]
    : garageAdmin?.subscriptions;
  check("garage créé, marqué « créé par l'admin » et abonné",
    garageAdmin?.origin === "admin" &&
      garageAdmin?.account_status === "subscribed" &&
      Boolean(abonnement?.end_date),
    JSON.stringify(garageAdmin));

  const { data: profils } = await enService(
    "GET",
    `/rest/v1/profiles?garage_id=eq.${garageAdmin?.id}&select=id,role,must_change_password`,
  );
  check("changement de mot de passe imposé",
    profils?.[0]?.role === "garage" && profils?.[0]?.must_change_password === true,
    JSON.stringify(profils?.[0]));

  const { data: comptes } = await enService(
    "GET", `/auth/v1/admin/users?page=1&per_page=1000`);
  const compteAuth = (comptes?.users ?? []).find((u) => u.email === GARAGE.email);
  check("compte Auth pré-confirmé (aucun e-mail à ouvrir)",
    Boolean(compteAuth?.email_confirmed_at), JSON.stringify(compteAuth?.email_confirmed_at));

  const boite = await fetch(`${MAILPIT}/api/v1/messages`).then((x) => x.json());
  check("et aucun e-mail de vérification envoyé",
    !(boite.messages ?? []).some((m) => m.To?.[0]?.Address === GARAGE.email));

  await pageContient(admin, "/admin/comptes", `Garage ${RUN}`);
  await pageContient(admin, "/admin/comptes", "Changement en attente");

  // -------------------------------------------------------------------------
  section("2. Le garage doit remplacer le mot de passe fixé par l'administrateur");

  const garage = new Navigateur(APP);
  r = await garage.submit("/login", { email: GARAGE.email, password: GARAGE.initial });
  check("connexion avec le mot de passe initial", r.status === 303 && r.location === "/",
    `HTTP ${r.status} -> ${r.location} ${r.message ?? ""}`);

  await redirigeVers(garage, "/", "/change-password");
  await redirigeVers(garage, "/app", "/change-password");
  await redirigeVers(garage, "/admin", "/change-password");
  await pageContient(garage, "/change-password", "Choisissez votre mot de passe");

  r = await garage.submit("/change-password", {
    password: GARAGE.choisi,
    passwordConfirm: GARAGE.choisi,
  });
  check("changement accepté", r.status === 303 && r.location === "/app",
    `HTTP ${r.status} -> ${r.location} ${r.message ?? ""}`);

  const { data: apres } = await enService(
    "GET", `/rest/v1/profiles?id=eq.${profils?.[0]?.id}&select=must_change_password`);
  check("drapeau levé en base", apres?.[0]?.must_change_password === false);

  await pageContient(garage, "/app", `Garage ${RUN}`);
  await pageContient(garage, "/app", "Abonnement actif");

  const { data: journal } = await enService(
    "GET",
    `/rest/v1/admin_notifications?garage_id=eq.${garageAdmin?.id}&type=eq.password_changed`,
  );
  const trace = JSON.stringify(journal ?? []);
  check("l'administrateur est notifié de l'événement",
    trace.includes("a modifié son mot de passe"), trace.slice(0, 140));
  check("la notification ne transporte AUCUN mot de passe",
    !trace.includes(GARAGE.initial) && !trace.includes(GARAGE.choisi));

  const ancien = new Navigateur(APP); // session neuve : /login est fermé à un connecté
  r = await ancien.submit("/login", { email: GARAGE.email, password: GARAGE.initial });
  check("l'ancien mot de passe ne fonctionne plus", r.location === null,
    `-> ${r.location}`);

  // -------------------------------------------------------------------------
  section("3. Inscription en ligne : vérification d'e-mail obligatoire");

  const visiteur = new Navigateur(APP);
  r = await visiteur.submit("/signup", {
    garageName: `Inscrit ${RUN}`,
    fullName: "Gaëlle Martin",
    email: INSCRIT.email,
    password: INSCRIT.password,
    passwordConfirm: INSCRIT.password,
  });
  check("inscription acceptée",
    r.status === 303 && (r.location ?? "").startsWith("/signup/verification"),
    `HTTP ${r.status} -> ${r.location} ${r.message ?? ""}`);
  check("aucune session tant que l'adresse n'est pas vérifiée", visiteur.jeton() === null);

  const { data: avant } = await enService(
    "GET", `/rest/v1/garages?email=eq.${INSCRIT.email}&select=id`);
  check("aucun garage créé à ce stade", (avant ?? []).length === 0);

  const refuse = new Navigateur(APP);
  r = await refuse.submit("/login", { email: INSCRIT.email, password: INSCRIT.password });
  check("connexion refusée avant vérification",
    r.location === null && (r.message ?? "").includes("vérifi"),
    `-> ${r.location} ${r.message ?? ""}`);

  const messages = await fetch(`${MAILPIT}/api/v1/messages`).then((x) => x.json());
  const courriel = (messages.messages ?? []).find(
    (m) => m.To?.[0]?.Address === INSCRIT.email);
  check("un e-mail de vérification est arrivé", Boolean(courriel));

  const detail = await fetch(`${MAILPIT}/api/v1/message/${courriel.ID}`).then((x) => x.json());
  const lien = decode((detail.HTML ?? detail.Text ?? "").match(/href="([^"]+)"/)[1]);

  // GoTrue valide le jeton puis renvoie vers l'application. On suit ce retour
  // AVEC la session qui s'est inscrite : le flux PKCE de @supabase/ssr a
  // déposé son vérificateur dans un cookie chez elle. C'est la limite connue
  // de ce flux — d'où le gabarit `token_hash` recommandé dans le README.
  const verif = await fetch(lien, { redirect: "manual" });
  const retour = verif.headers.get("location") ?? "";
  check("le lien revient sur /auth/confirm", retour.includes("/auth/confirm"),
    retour.slice(0, 90));

  const { status: statutConfirm, location: apresConfirm } = await visiteur.get(
    retour.replace(APP, ""), { suivre: false });
  check("confirmation acceptée et compte provisionné",
    statutConfirm >= 300 && statutConfirm < 400 && !(apresConfirm ?? "").includes("auth/error"),
    `HTTP ${statutConfirm} -> ${apresConfirm}`);

  const { data: nouveaux } = await enService(
    "GET",
    `/rest/v1/garages?email=eq.${INSCRIT.email}` +
      `&select=id,origin,account_status,trial_invoices_used,trial_invoice_limit,profiles(must_change_password)`,
  );
  const garageEssai = nouveaux?.[0];
  const profilEssai = Array.isArray(garageEssai?.profiles)
    ? garageEssai.profiles[0]
    : garageEssai?.profiles;
  check("garage créé en essai gratuit 0/3, sans changement forcé",
    garageEssai?.origin === "self_signup" &&
      garageEssai?.account_status === "trial" &&
      garageEssai?.trial_invoices_used === 0 &&
      garageEssai?.trial_invoice_limit === 3 &&
      profilEssai?.must_change_password === false,
    JSON.stringify(garageEssai));

  const { data: notifsInscription } = await enService(
    "GET",
    `/rest/v1/admin_notifications?garage_id=eq.${garageEssai?.id}&type=eq.garage_signup`);
  check("l'administrateur est notifié de l'inscription",
    (notifsInscription ?? []).length === 1);

  const inscrit = new Navigateur(APP);
  r = await inscrit.submit("/login", { email: INSCRIT.email, password: INSCRIT.password });
  check("connexion possible une fois l'adresse vérifiée",
    r.status === 303 && r.location === "/", `HTTP ${r.status} -> ${r.location}`);
  await pageContient(inscrit, "/app", "Essai gratuit");
  await pageContient(inscrit, "/app", "offertes");

  // -------------------------------------------------------------------------
  section("4. Essai gratuit : 3 factures émises, la 4e refusée");

  const jetonEssai = inscrit.jeton();

  /** Crée une facture et tente de l'émettre, sous l'identité du garage. */
  async function emettre(numero) {
    const { data: facture } = await supabase(jetonEssai, "POST", "/rest/v1/invoices", {
      garage_id: garageEssai.id,
      client_name: `Client ${numero}`,
    });
    if (!facture?.[0]?.id) return { erreur: JSON.stringify(facture) };

    await supabase(jetonEssai, "POST", "/rest/v1/invoice_lines", {
      invoice_id: facture[0].id,
      description: "Révision",
      quantity: 1,
      unit_price_ht: 100,
      vat_rate: 20,
    });
    const { status, data } = await supabase(jetonEssai, "POST",
      "/rest/v1/rpc/finalize_invoice", { p_invoice_id: facture[0].id, p_decimals: 2 });
    return { status, data, erreur: status >= 400 ? data?.message : null };
  }

  for (const n of [1, 2, 3]) {
    const { status, data, erreur } = await emettre(n);
    check(`facture ${n} émise`, status === 200 && typeof data?.number === "string",
      erreur ?? JSON.stringify(data)?.slice(0, 120));
  }

  const { data: apresTrois } = await enService(
    "GET", `/rest/v1/garages?id=eq.${garageEssai.id}&select=trial_invoices_used`);
  check("compteur d'essai à 3/3", apresTrois?.[0]?.trial_invoices_used === 3,
    JSON.stringify(apresTrois?.[0]));

  const quatrieme = await emettre(4);
  check("la 4e émission est refusée", quatrieme.status >= 400,
    JSON.stringify(quatrieme.data)?.slice(0, 140));
  check("avec le message annoncé au client",
    (quatrieme.erreur ?? "").includes(
      "Essai terminé (3 factures) — contactez l'administrateur pour activer votre abonnement"),
    quatrieme.erreur ?? "");

  const { data: brouillons } = await supabase(jetonEssai, "GET",
    `/rest/v1/invoices?garage_id=eq.${garageEssai.id}&status=eq.draft&select=id`);
  check("le brouillon, lui, a bien pu être créé", (brouillons ?? []).length >= 1,
    JSON.stringify(brouillons)?.slice(0, 100));

  const { data: notifsEssai } = await enService("GET",
    `/rest/v1/admin_notifications?garage_id=eq.${garageEssai.id}&type=eq.trial_exhausted`);
  check("l'administrateur est prévenu de l'essai épuisé",
    (notifsEssai ?? []).length === 1);

  await pageContient(inscrit, "/app", "Essai gratuit terminé");
  await pageContient(inscrit, "/app", "brouillons restent modifiables");

  // L'abonnement enregistré par l'administrateur lève la limite.
  const fin = new Date();
  fin.setFullYear(fin.getFullYear() + 1);
  await enService("POST", "/rest/v1/subscriptions", {
    garage_id: garageEssai.id,
    end_date: fin.toISOString().slice(0, 10),
  });
  const { data: bascule } = await enService("GET",
    `/rest/v1/garages?id=eq.${garageEssai.id}&select=account_status`);
  check("l'abonnement fait sortir de l'essai",
    bascule?.[0]?.account_status === "subscribed", JSON.stringify(bascule?.[0]));

  const cinquieme = await emettre(5);
  check("l'émission redevient possible", cinquieme.status === 200,
    cinquieme.erreur ?? "");

  // -------------------------------------------------------------------------
  section("5. Limitation de débit sur la connexion");

  // Les tentatives ratées des sections précédentes ont déjà entamé le seau de
  // cette adresse : on repart de compteurs vierges, sinon le rang du blocage
  // dépend de l'ordre des sections.
  const purge = await enService("DELETE", "/rest/v1/auth_rate_limits?bucket=not.is.null");
  check("compteurs remis à zéro pour la mesure", purge.status < 300,
    `HTTP ${purge.status} ${JSON.stringify(purge.data)?.slice(0, 100)}`);

  const attaquant = new Navigateur(APP);
  let bloqueAu = null;
  for (let essai = 1; essai <= 8 && bloqueAu === null; essai++) {
    const { message } = await attaquant.submit("/login", {
      email: GARAGE.email,
      password: `faux-${essai}`,
    });
    if ((message ?? "").includes("Trop de tentatives")) bloqueAu = essai;
  }
  check("le formulaire se ferme au 5e échec", bloqueAu === 5, `bloqué au ${bloqueAu}e essai`);

  r = await attaquant.submit("/login", { email: GARAGE.email, password: GARAGE.choisi });
  check("même le bon mot de passe est refusé pendant le blocage",
    (r.message ?? "").includes("Trop de tentatives"), r.message ?? "");

  const { data: seaux } = await enService("GET", "/rest/v1/auth_rate_limits?select=bucket");
  const clefs = JSON.stringify(seaux ?? []);
  check("les compteurs vivent en base", (seaux ?? []).length > 0);
  check("aucune adresse e-mail en clair dans les compteurs",
    !clefs.includes(GARAGE.email), clefs.slice(0, 120));

  // -------------------------------------------------------------------------
  section("6. Réinitialisation du mot de passe par l'administrateur");

  // Le formulaire vit dans une boîte de dialogue : il n'est pas dans le HTML
  // initial, donc hors de portée d'un navigateur sans JavaScript. On rejoue
  // alors chaque étape de `resetGaragePasswordAction` par les MÊMES
  // interfaces qu'elle utilise : API d'administration Auth, REST sous RLS, RPC.
  // La section précédente a laissé cette adresse bloquée : sans ce nettoyage,
  // on mesurerait le limiteur au lieu de la réinitialisation.
  await enService("DELETE", "/rest/v1/auth_rate_limits?bucket=not.is.null");

  const jetonAdmin = admin.jeton();
  const idGarage = profils?.[0]?.id;

  const cible = await supabase(jetonAdmin, "GET",
    `/rest/v1/profiles?id=eq.${idGarage}&select=id,role,full_name,garages(name,email)`);
  check("la cible est lisible par l'administrateur (embed PostgREST valide)",
    cible.status === 200 && cible.data?.[0]?.role === "garage",
    JSON.stringify(cible.data)?.slice(0, 140));

  const temporaire = `Temporaire-${RUN}-2026`;
  const pose = await enService("PUT", `/auth/v1/admin/users/${idGarage}`,
    { password: temporaire });
  check("mot de passe temporaire appliqué", pose.status === 200,
    JSON.stringify(pose.data)?.slice(0, 120));

  const drapeau = await supabase(jetonAdmin, "PATCH", `/rest/v1/profiles?id=eq.${idGarage}`,
    { must_change_password: true });
  check("changement forcé réactivé", drapeau.status === 200,
    JSON.stringify(drapeau.data)?.slice(0, 120));

  const notif = await supabase(jetonAdmin, "POST", "/rest/v1/rpc/notify_password_reset",
    { p_user_id: idGarage });
  check("l'événement est journalisé", notif.status < 300,
    JSON.stringify(notif.data)?.slice(0, 120));

  const { data: journalReset } = await enService("GET",
    `/rest/v1/admin_notifications?type=eq.password_reset_by_admin&garage_id=eq.${garageAdmin.id}`);
  const traceReset = JSON.stringify(journalReset ?? []);
  check("la trace décrit l'événement", traceReset.includes("Mot de passe temporaire"),
    traceReset.slice(0, 120));
  check("et ne contient PAS le mot de passe temporaire", !traceReset.includes(temporaire));

  const apresReset = new Navigateur(APP);
  r = await apresReset.submit("/login", { email: GARAGE.email, password: temporaire });
  check("connexion avec le mot de passe temporaire",
    r.status === 303 && r.location === "/", `HTTP ${r.status} -> ${r.location} ${r.message ?? ""}`);
  await redirigeVers(apresReset, "/app", "/change-password");

  const perime = new Navigateur(APP);
  r = await perime.submit("/login", { email: GARAGE.email, password: GARAGE.choisi });
  check("le mot de passe choisi par le garage est invalidé", r.location === null,
    `-> ${r.location}`);

  // -------------------------------------------------------------------------
  console.log();
  if (echecs.length) {
    console.log(`  ✗ ${echecs.length} vérification(s) en échec :`);
    for (const e of echecs) console.log(`      - ${e}`);
    process.exit(1);
  }
  console.log("  ✓ Parcours d'authentification : toutes les vérifications passent\n");
}

main().catch((error) => {
  console.error(`\n  ✗ ${error instanceof Error ? error.message : String(error)}\n`);
  if (error instanceof Error && error.cause) console.error(error.cause);
  process.exit(1);
});
