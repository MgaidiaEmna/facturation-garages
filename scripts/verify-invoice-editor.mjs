/**
 * Vérification de bout en bout de l'éditeur de facture (phase 5).
 *
 * Comme `verify:auth` et `verify:garages`, ce script pilote l'application
 * RÉELLEMENT LANCÉE. Il vérifie le CÂBLAGE — routes, rendu serveur de
 * l'aperçu, enregistrement du brouillon, calcul des totaux — là où
 * `rls_isolation.sql` (section 20) vérifie les FRONTIÈRES.
 *
 * CE QU'IL NE PEUT PAS ATTEINDRE : la saisie elle-même. L'éditeur est un
 * composant client (l'aperçu se met à jour à chaque frappe), et sa Server
 * Action est appelée en JavaScript, pas par un `<form>` classique. Le script
 * emprunte donc le même chemin de données — la fonction `save_invoice_draft()`
 * avec le JETON DE SESSION DU GARAGE, donc sous RLS — et vérifie l'effet réel
 * en base. Jamais avec la clé service role, qui contournerait ce qu'on veut
 * éprouver.
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
  nom: `Editeur ${RUN}`,
  email: `editeur-${RUN}@verif.test`,
  motDePasse: `Editeur-${RUN}-2026`,
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

async function main() {
  console.log(`\nVérification de l'éditeur de facture sur ${APP}\n`);

  // -------------------------------------------------------------------------
  section("1. Un garage qui facture");

  const admin = new Navigateur(APP);
  let r = await admin.submit("/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("connexion de l'administrateur", r.status === 303, `HTTP ${r.status}`);

  const fin = new Date();
  fin.setFullYear(fin.getFullYear() + 1);
  r = await admin.submit("/admin/comptes/nouveau", {
    garageName: GARAGE.nom,
    fullName: "Camille Roux",
    email: GARAGE.email,
    password: GARAGE.motDePasse,
    subscriptionEndDate: fin.toISOString().slice(0, 10),
  });
  check("compte garage créé", r.status === 200 && !r.message, r.message ?? "");

  const garage = new Navigateur(APP);
  r = await garage.submit("/login", { email: GARAGE.email, password: GARAGE.motDePasse });
  check("connexion du garage", r.status === 303, `HTTP ${r.status}`);

  r = await garage.submit("/change-password", {
    password: `${GARAGE.motDePasse}-choisi`,
    passwordConfirm: `${GARAGE.motDePasse}-choisi`,
  });
  check("mot de passe initial remplacé", r.status === 303, `HTTP ${r.status}`);

  // -------------------------------------------------------------------------
  section("2. Les écrans");

  let page = await garage.get("/app/factures");
  check("/app/factures répond", page.status === 200, `HTTP ${page.status}`);
  check("l'état vide est soigné", /Aucun brouillon en cours/.test(page.body));

  page = await garage.get("/app/factures/nouveau");
  check("l'éditeur répond", page.status === 200, `HTTP ${page.status}`);
  check("l'aperçu est rendu dès le premier octet",
    page.body.includes("FACTURE") && page.body.includes("Brouillon"));
  check("il annonce que le numéro viendra à l'émission",
    page.body.includes("attribué à l&#x27;émission") || page.body.includes("attribué à l'émission"));
  check("les mentions légales françaises y figurent",
    page.body.includes("Indemnité forfaitaire") && page.body.includes("pénalités de retard"));
  check("les montants sont annoncés comme indicatifs",
    page.body.includes("recalculés à l&#x27;émission") || page.body.includes("recalculés à l'émission"));

  // -------------------------------------------------------------------------
  section("3. Enregistrement d'un brouillon");

  const jetonGarage = garage.jeton();
  check("jeton de session lisible", Boolean(jetonGarage));

  // Deux lignes à 20 %, une à 5,5 % : le regroupement par taux a du travail.
  //   HT  = 80 + 90 + 30      = 200,00
  //   TVA = 34,00 + 1,65      =  35,65
  //   TTC                     = 235,65
  let res = await supabase(jetonGarage, "POST", "/rest/v1/rpc/save_invoice_draft", {
    p_invoice_id: null,
    p_header: {
      client_name: "Client de vérification",
      client_address: "1 rue des Essais\n69003 Lyon",
      issue_date: today(),
    },
    p_lines: [
      { description: "Vidange", quantity: 1, unit_price_ht: 80, vat_rate: 20 },
      { description: "Main d'oeuvre", quantity: 2, unit_price_ht: 45, vat_rate: 20 },
      { description: "Piece detachee", quantity: 1, unit_price_ht: 30, vat_rate: 5.5 },
      // Ligne sans désignation : ne doit pas être persistée.
      { description: "   ", quantity: 9, unit_price_ht: 999, vat_rate: 20 },
    ],
    p_decimals: 2,
  });
  check("le brouillon est enregistré", res.status === 200,
    `HTTP ${res.status} ${JSON.stringify(res.data).slice(0, 140)}`);

  const invoice = Array.isArray(res.data) ? res.data[0] : res.data;

  check("les totaux sont calculés par le serveur",
    Number(invoice?.subtotal_ht) === 200 &&
      Number(invoice?.vat_total) === 35.65 &&
      Number(invoice?.total_ttc) === 235.65,
    `HT=${invoice?.subtotal_ht} TVA=${invoice?.vat_total} TTC=${invoice?.total_ttc}`);

  check("la TVA est ventilée par taux",
    Array.isArray(invoice?.vat_breakdown) && invoice.vat_breakdown.length === 2,
    JSON.stringify(invoice?.vat_breakdown));

  check("aucun numéro n'est attribué à un brouillon",
    invoice?.number === null && invoice?.status === "draft",
    `${invoice?.status} / ${invoice?.number}`);

  const { data: lignes } = await enService(
    "GET",
    `/rest/v1/invoice_lines?invoice_id=eq.${invoice?.id}&select=description,line_total_ht,position&order=position`,
  );
  check("la ligne sans désignation n'est pas enregistrée", lignes?.length === 3,
    `${lignes?.length} ligne(s)`);
  check("le total de ligne est calculé en base",
    Number(lignes?.[1]?.line_total_ht) === 90, String(lignes?.[1]?.line_total_ht));

  // -------------------------------------------------------------------------
  section("4. Reprise et non-consommation de l'essai");

  page = await garage.get("/app/factures");
  check("le brouillon figure dans la liste", page.body.includes("Client de vérification"));

  page = await garage.get(`/app/factures/${invoice?.id}`);
  check("le brouillon se rouvre avec ses lignes",
    page.status === 200 && page.body.includes("Vidange"), `HTTP ${page.status}`);

  const { data: garages } = await enService(
    "GET",
    `/rest/v1/garages?email=eq.${GARAGE.email}&select=id,trial_invoices_used`,
  );
  check("un brouillon ne consomme aucune facture d'essai",
    Number(garages?.[0]?.trial_invoices_used) === 0,
    String(garages?.[0]?.trial_invoices_used));

  // -------------------------------------------------------------------------
  section("5. Frontières");

  // Le garage_id transmis dans l'en-tête doit être ignoré : c'est
  // `my_garage_id()` qui décide, et lui seul.
  const autreGarage = "00000000-0000-0000-0000-0000000000ff";
  res = await supabase(jetonGarage, "POST", "/rest/v1/rpc/save_invoice_draft", {
    p_invoice_id: null,
    p_header: { client_name: "Tentative", garage_id: autreGarage, issue_date: today() },
    p_lines: [{ description: "Prestation", quantity: 1, unit_price_ht: 10, vat_rate: 20 }],
    p_decimals: 2,
  });
  const force = Array.isArray(res.data) ? res.data[0] : res.data;
  check("le garage_id envoyé par le client est ignoré",
    res.status !== 200 || force?.garage_id === garages?.[0]?.id,
    `HTTP ${res.status} — rattaché à ${force?.garage_id}`);

  // Un identifiant de facture inconnu : refus, sans révéler s'il existe.
  res = await supabase(jetonGarage, "POST", "/rest/v1/rpc/save_invoice_draft", {
    p_invoice_id: "11111111-1111-1111-1111-111111111111",
    p_header: { client_name: "Détournement", issue_date: today() },
    p_lines: [{ description: "Prestation", quantity: 1, unit_price_ht: 10, vat_rate: 20 }],
    p_decimals: 2,
  });
  check("un brouillon inconnu est refusé", res.status >= 400, `HTTP ${res.status}`);

  // L'espace admin n'est pas celui du garage.
  const sortie = await garage.get("/admin/garages", { suivre: false });
  check("un garage n'entre pas dans l'espace d'administration",
    sortie.status === 307 || sortie.status === 303, `HTTP ${sortie.status}`);

  // -------------------------------------------------------------------------
  section("Bilan");

  if (echecs.length === 0) {
    console.log("  ✓ Éditeur de facture : toutes les vérifications passent\n");
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
