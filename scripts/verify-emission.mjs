/**
 * Vérification de bout en bout de l'émission (phase 6).
 *
 * Comme les autres `verify:*`, ce script pilote l'application RÉELLEMENT
 * LANCÉE et se comporte comme un navigateur sans JavaScript. Il vérifie le
 * CÂBLAGE — numérotation, refus après émission, onglets de la liste, écran de
 * relecture figé — là où `rls_isolation.sql` (sections 4 à 6 et 21) vérifie
 * les FRONTIÈRES.
 *
 * CE QU'IL NE PEUT PAS ATTEINDRE : le clic sur « Émettre la facture ». Le
 * bouton ouvre une boîte de dialogue Radix, montée par le JavaScript, et
 * appelle une Server Action depuis un gestionnaire d'événement. Le script
 * emprunte donc le même chemin de données — `finalize_invoice()` AVEC LE
 * JETON DE SESSION DU GARAGE, donc sous les mêmes contrôles — et vérifie
 * l'effet réel en base et à l'écran. Jamais avec la clé service role, qui
 * contournerait ce qu'on veut éprouver ; elle ne sert ici qu'à OBSERVER.
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
const GARAGE = {
  nom: `Emission ${RUN}`,
  nomApres: `Emission ${RUN} — enseigne changee`,
  email: `emission-${RUN}@verif.test`,
  motDePasse: `Emission-${RUN}-2026`,
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
const today = () => new Date().toISOString().slice(0, 10);
const seul = (data) => (Array.isArray(data) ? data[0] : data);

/** Enregistre un brouillon avec la session du garage, puis l'émet. */
async function emettre(jeton, client, lignes) {
  const brouillon = await supabase(jeton, "POST", "/rest/v1/rpc/save_invoice_draft", {
    p_invoice_id: null,
    p_header: { client_name: client, issue_date: today() },
    p_lines: lignes,
    p_decimals: 2,
  });
  const id = seul(brouillon.data)?.id;
  if (!id) return { status: brouillon.status, data: brouillon.data, id: null };

  const emise = await supabase(jeton, "POST", "/rest/v1/rpc/finalize_invoice", {
    p_invoice_id: id,
    p_decimals: 2,
  });
  return { status: emise.status, data: seul(emise.data), id };
}

async function main() {
  console.log(`\nVérification de l'émission sur ${APP}\n`);

  // -------------------------------------------------------------------------
  section("1. Un garage prêt à émettre");

  const admin = new Navigateur(APP);
  let r = await admin.submit("/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("connexion de l'administrateur", r.status === 303, `HTTP ${r.status}`);

  const fin = new Date();
  fin.setFullYear(fin.getFullYear() + 1);
  r = await admin.submit("/admin/comptes/nouveau", {
    garageName: GARAGE.nom,
    fullName: "Dominique Perrin",
    email: GARAGE.email,
    password: GARAGE.motDePasse,
    subscriptionEndDate: fin.toISOString().slice(0, 10),
  });
  check("compte garage créé", r.status === 200 && !r.message, r.message ?? "");

  const { data: fiches } = await enService(
    "GET",
    `/rest/v1/garages?email=eq.${GARAGE.email}&select=id`,
  );
  const garageId = fiches?.[0]?.id;
  check("garage retrouvé", Boolean(garageId));

  // Une identité complète : c'est elle que la finalisation doit figer.
  r = await admin.submit(`/admin/garages/${garageId}`, {
    siret: "812 345 678 00012",
    name: GARAGE.nom,
    legal_form: "SARL",
    rcs_city: "RCS Lyon 812 345 678",
    address: "1 rue Ancienne, 69003 Lyon",
    payment_term_days: "30",
    late_payment_penalty_rate: "10.75",
    recovery_indemnity: "40",
  });
  check("fiche d'identité renseignée", r.status === 200 && !r.message, r.message ?? "");

  const garage = new Navigateur(APP);
  r = await garage.submit("/login", { email: GARAGE.email, password: GARAGE.motDePasse });
  check("connexion du garage", r.status === 303, `HTTP ${r.status}`);

  r = await garage.submit("/change-password", {
    password: `${GARAGE.motDePasse}-choisi`,
    passwordConfirm: `${GARAGE.motDePasse}-choisi`,
  });
  check("mot de passe initial remplacé", r.status === 303, `HTTP ${r.status}`);

  const jeton = garage.jeton();
  check("jeton de session lisible", Boolean(jeton));

  // -------------------------------------------------------------------------
  section("2. Numérotation séquentielle");

  //   HT  = 80 + 90 = 170,00 à 20 %
  //   TVA = 34,00
  //   TTC = 204,00
  const premiere = await emettre(jeton, "Client émission 1", [
    { description: "Vidange", quantity: 1, unit_price_ht: 80, vat_rate: 20 },
    { description: "Main d'oeuvre", quantity: 2, unit_price_ht: 45, vat_rate: 20 },
  ]);
  check("la première facture est émise", premiere.status === 200,
    `HTTP ${premiere.status} ${JSON.stringify(premiere.data).slice(0, 140)}`);
  check("elle reçoit le numéro AAAA-000001",
    /^\d{4}-000001$/.test(premiere.data?.number ?? ""), String(premiere.data?.number));
  check("son statut passe à « final »", premiere.data?.status === "final",
    String(premiere.data?.status));
  check("les totaux sont ceux du serveur",
    Number(premiere.data?.subtotal_ht) === 170 &&
      Number(premiere.data?.vat_total) === 34 &&
      Number(premiere.data?.total_ttc) === 204,
    `HT=${premiere.data?.subtotal_ht} TVA=${premiere.data?.vat_total} TTC=${premiere.data?.total_ttc}`);
  check("l'échéance est calculée (mention obligatoire)",
    Boolean(premiere.data?.due_date), String(premiere.data?.due_date));
  check("les mentions du vendeur sont figées",
    premiere.data?.seller_snapshot?.siret === "81234567800012",
    JSON.stringify(premiere.data?.seller_snapshot?.siret));

  const deuxieme = await emettre(jeton, "Client émission 2", [
    { description: "Diagnostic", quantity: 1, unit_price_ht: 50, vat_rate: 20 },
  ]);
  check("la série s'incrémente sans trou",
    /^\d{4}-000002$/.test(deuxieme.data?.number ?? ""), String(deuxieme.data?.number));

  // Un brouillon laissé en plan ne consomme aucun numéro : c'est toute la
  // raison pour laquelle `next_invoice_number()` est appelée à l'émission.
  await supabase(jeton, "POST", "/rest/v1/rpc/save_invoice_draft", {
    p_invoice_id: null,
    p_header: { client_name: "Brouillon abandonné", issue_date: today() },
    p_lines: [{ description: "Devis", quantity: 1, unit_price_ht: 10, vat_rate: 20 }],
    p_decimals: 2,
  });
  const troisieme = await emettre(jeton, "Client émission 3", [
    { description: "Pneus", quantity: 4, unit_price_ht: 60, vat_rate: 20 },
  ]);
  check("un brouillon abandonné ne consomme pas de numéro",
    /^\d{4}-000003$/.test(troisieme.data?.number ?? ""), String(troisieme.data?.number));

  // -------------------------------------------------------------------------
  section("3. Ce qui se ferme après l'émission");

  let res = await supabase(jeton, "POST", "/rest/v1/rpc/finalize_invoice", {
    p_invoice_id: premiere.id,
    p_decimals: 2,
  });
  check("une facture émise ne se réémet pas", res.status >= 400, `HTTP ${res.status}`);

  res = await supabase(jeton, "POST", "/rest/v1/rpc/save_invoice_draft", {
    p_invoice_id: premiere.id,
    p_header: { client_name: "Réécriture après émission", issue_date: today() },
    p_lines: [{ description: "Ligne ajoutée", quantity: 1, unit_price_ht: 1, vat_rate: 20 }],
    p_decimals: 2,
  });
  check("elle ne se rouvre pas comme brouillon", res.status >= 400, `HTTP ${res.status}`);

  res = await supabase(jeton, "DELETE", `/rest/v1/invoices?id=eq.${premiere.id}`);
  const restante = await enService(
    "GET",
    `/rest/v1/invoices?id=eq.${premiere.id}&select=id,number,status`,
  );
  check("elle ne se supprime pas",
    seul(restante.data)?.status === "final", `HTTP ${res.status}`);

  // -------------------------------------------------------------------------
  section("4. Les écrans");

  let page = await garage.get("/app/factures");
  // Le brouillon abandonné plus haut est le témoin : s'il apparaît sans
  // paramètre d'URL, c'est bien l'onglet « Brouillons » qui s'ouvre.
  check("l'onglet Brouillons est celui qui s'ouvre par défaut",
    page.status === 200 && page.body.includes("Brouillon abandonné"),
    `HTTP ${page.status}`);
  check("l'onglet par défaut ne montre pas les factures émises",
    !page.body.includes(premiere.data?.number ?? "###"));
  check("les trois onglets annoncent leur nombre",
    page.body.includes("Brouillons") && page.body.includes("Émises"));

  page = await garage.get("/app/factures?statut=emises");
  check("l'onglet Émises répond", page.status === 200, `HTTP ${page.status}`);
  check("il liste les numéros de la série",
    page.body.includes(premiere.data?.number ?? "###") &&
      page.body.includes(deuxieme.data?.number ?? "###"));
  check("il ne montre pas les brouillons",
    !page.body.includes("Brouillon abandonné"));

  page = await garage.get(`/app/factures/${premiere.id}`);
  check("la facture émise se relit", page.status === 200, `HTTP ${page.status}`);
  check("l'écran porte son numéro", page.body.includes(premiere.data?.number ?? "###"));
  check("il dit qu'elle n'est plus modifiable",
    page.body.includes("ni modifiable ni supprimable"));
  check("l'éditeur n'est pas monté dessus",
    !page.body.includes("Enregistrer le brouillon"));
  check("l'aperçu ne l'annonce plus comme un brouillon",
    !page.body.includes("Brouillon — non émis") &&
      !page.body.includes("Brouillon &#x2014; non émis"));

  // -------------------------------------------------------------------------
  section("5. Le gel des mentions tient dans le temps");

  // L'administrateur change l'enseigne APRÈS l'émission : la facture déjà
  // émise ne doit pas suivre, la suivante doit porter la nouvelle.
  r = await admin.submit(`/admin/garages/${garageId}`, {
    siret: "812 345 678 00012",
    name: GARAGE.nomApres,
    legal_form: "SAS",
    rcs_city: "RCS Lyon 812 345 678",
    address: "2 avenue Nouvelle, 69003 Lyon",
    payment_term_days: "30",
    late_payment_penalty_rate: "10.75",
    recovery_indemnity: "40",
  });
  check("la fiche du garage est modifiée", r.status === 200 && !r.message, r.message ?? "");

  page = await garage.get(`/app/factures/${premiere.id}`);
  // On regarde l'ADRESSE et la FORME JURIDIQUE, pas la dénomination : le
  // bandeau de l'application affiche, lui, le nom courant du garage — c'est
  // normal, il ne fait pas partie du document.
  check("la facture émise garde les mentions du jour de l'émission",
    page.body.includes("1 rue Ancienne") && page.body.includes("SARL"));
  check("elle n'a pas repris les nouvelles",
    !page.body.includes("2 avenue Nouvelle") && !page.body.includes("SAS"));

  const apres = await emettre(jeton, "Client après changement", [
    { description: "Révision", quantity: 1, unit_price_ht: 120, vat_rate: 20 },
  ]);
  check("une facture émise après le changement porte la nouvelle",
    apres.data?.seller_snapshot?.legal_form === "SAS",
    JSON.stringify(apres.data?.seller_snapshot?.legal_form));

  // -------------------------------------------------------------------------
  section("6. Frontières");

  // La facture d'un autre garage n'est pas émissible, et n'existe pas non
  // plus du point de vue de ce garage.
  const { data: ailleurs } = await enService(
    "GET",
    `/rest/v1/invoices?garage_id=neq.${garageId}&status=eq.draft&select=id&limit=1`,
  );
  const cible = ailleurs?.[0]?.id;
  if (cible) {
    res = await supabase(jeton, "POST", "/rest/v1/rpc/finalize_invoice", {
      p_invoice_id: cible,
      p_decimals: 2,
    });
    check("émettre la facture d'un autre garage est refusé", res.status >= 400,
      `HTTP ${res.status}`);

    page = await garage.get(`/app/factures/${cible}`);
    check("elle n'existe pas pour ce garage", page.status === 404, `HTTP ${page.status}`);
  } else {
    console.log("  (aucun brouillon d'un autre garage : frontière non éprouvée ici)");
  }

  // -------------------------------------------------------------------------
  section("Bilan");

  if (echecs.length === 0) {
    console.log("  ✓ Émission : toutes les vérifications passent\n");
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
