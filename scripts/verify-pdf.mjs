/**
 * Vérification de bout en bout de l'export PDF (phase 8).
 *
 * Comme les autres `verify:*`, ce script pilote l'application RÉELLEMENT
 * LANCÉE. Il télécharge de vrais PDF par la vraie route, et en LIT LE TEXTE :
 * le format de page, les mentions obligatoires françaises, le numéro, les
 * totaux figés, le filigrane du brouillon, et les frontières du point d'entrée.
 *
 * Le texte est extrait en décompressant les flux du PDF avec `zlib` — intégré
 * à Node, aucune dépendance (voir `lib/pdf-texte.mjs`). Le crénage découpe les
 * mots, donc les comparaisons se font sans les espaces.
 *
 * CE QU'IL NE PEUT PAS ATTEINDRE : l'aspect. Qu'une colonne déborde ou qu'un
 * filet soit mal placé ne se voit pas dans le texte extrait. Ce qui est
 * éprouvé ici, c'est le CONTENU et la CONFORMITÉ, pas la beauté.
 *
 * Prérequis : pile Supabase locale, `npm run dev`, `npm run db:seed`.
 */

import { Navigateur } from "./lib/navigateur.mjs";
import { contientTexte, estA4, formatDePage, texteDuPdf } from "./lib/pdf-texte.mjs";

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
const A = { nom: `Pdf ${RUN}`, email: `pdf-${RUN}@verif.test`, motDePasse: `Pdf-${RUN}-2026` };
const B = {
  nom: `Voisin pdf ${RUN}`,
  email: `voisinpdf-${RUN}@verif.test`,
  motDePasse: `Voisinpdf-${RUN}-2026`,
};

// Un nom accentué : c'est lui qui éprouve la double forme du nom de fichier.
const CLIENT = "Café Léon & Fils";

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
const seul = (d) => (Array.isArray(d) ? d[0] : d);
const today = () => new Date().toISOString().slice(0, 10);

/** Ouvre un garage abonné, fiche remplie, mot de passe définitif posé. */
async function ouvrirGarage(admin, garage, fiche = {}) {
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
    capital: "10 000 €",
    rcs_city: "RCS Lyon 812 345 678",
    vat_number: "FR12812345678",
    address: "24 avenue des Frères Lumière, 69008 Lyon",
    phone: "04 78 12 34 56",
    iban: "FR7630006000011234567890189",
    bic: "AGRIFRPP",
    payment_term_days: "30",
    late_payment_penalty_rate: "10.75",
    recovery_indemnity: "40",
    ...fiche,
  });
  if (r.message) throw new Error(`fiche de ${garage.nom} : ${r.message}`);

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

/** Enregistre un brouillon, et l'émet si demandé. */
async function creerFacture(jeton, client, lignes, { emettre = true } = {}) {
  const brouillon = await supabase(jeton, "POST", "/rest/v1/rpc/save_invoice_draft", {
    p_invoice_id: null,
    p_header: {
      client_name: client,
      client_address: "12 rue des Lilas\n69003 Lyon",
      client_vat_number: "FR40123456824",
      issue_date: today(),
      service_date: today(),
    },
    p_lines: lignes,
    p_decimals: 2,
  });
  const id = seul(brouillon.data)?.id;
  if (!emettre) return { id, facture: null };

  const emise = await supabase(jeton, "POST", "/rest/v1/rpc/finalize_invoice", {
    p_invoice_id: id,
    p_decimals: 2,
  });
  return { id, facture: seul(emise.data) };
}

/** Télécharge le PDF avec la session fournie. */
async function telecharger(nav, id, { impression = false } = {}) {
  const cookie = [...nav.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  const requete = `${APP}/app/factures/${id}/pdf${impression ? "?impression=1" : ""}`;
  const r = await fetch(requete, {
    headers: { cookie },
    redirect: "manual",
  });
  const buffer = Buffer.from(await r.arrayBuffer());
  return {
    status: r.status,
    type: r.headers.get("content-type"),
    disposition: r.headers.get("content-disposition") ?? "",
    buffer,
    texte: r.status === 200 ? texteDuPdf(buffer) : "",
  };
}

async function main() {
  console.log(`\nVérification de l'export PDF sur ${APP}\n`);

  // -------------------------------------------------------------------------
  section("1. Une facture émise");

  const admin = new Navigateur(APP);
  let r = await admin.submit("/login", { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  check("connexion de l'administrateur", r.status === 303, `HTTP ${r.status}`);

  // `navA` est le NAVIGATEUR, `A` la fiche du garage : deux choses
  // différentes, et `A.jeton` est bien le jeton, pas la méthode.
  const navA = await ouvrirGarage(admin, A);

  //   80 + 90 = 170,00 à 20 %  ·  30,00 à 5,5 %
  //   HT  = 200,00 · TVA = 34,00 + 1,65 = 35,65 · TTC = 235,65
  const { id, facture } = await creerFacture(A.jeton, CLIENT, [
    { description: "Vidange + filtre à huile", quantity: 1, unit_price_ht: 80, vat_rate: 20 },
    { description: "Main d'oeuvre", quantity: 2, unit_price_ht: 45, vat_rate: 20 },
    { description: "Pièce détachée", quantity: 1, unit_price_ht: 30, vat_rate: 5.5 },
  ]);
  check("la facture est émise", /^\d{4}-000001$/.test(facture?.number ?? ""),
    String(facture?.number));

  // -------------------------------------------------------------------------
  section("2. Le PDF de la facture émise");

  const pdf = await telecharger(navA, id);
  check("la route répond", pdf.status === 200, `HTTP ${pdf.status}`);
  check("c'est bien un PDF",
    pdf.type === "application/pdf" && pdf.buffer.subarray(0, 5).toString() === "%PDF-",
    `${pdf.type} / ${pdf.buffer.subarray(0, 8).toString("latin1")}`);
  check("le format est A4", estA4(pdf.buffer), JSON.stringify(formatDePage(pdf.buffer)));

  check("il est proposé au téléchargement", pdf.disposition.startsWith("attachment"),
    pdf.disposition);
  check("le nom suit Facture_{numéro}_{client}.pdf",
    pdf.disposition.includes(`filename="Facture_${facture?.number}_Cafe_Leon_Fils.pdf"`),
    pdf.disposition);
  check("le nom accentué est transmis en UTF-8",
    pdf.disposition.includes("filename*=UTF-8''") &&
      decodeURIComponent(pdf.disposition.split("filename*=UTF-8''")[1]) ===
        `Facture_${facture?.number}_Café_Léon_Fils.pdf`,
    pdf.disposition);

  // --- Mentions du vendeur, figées à l'émission ---
  const contient = (aiguille) => contientTexte(pdf.texte, aiguille);
  check("l'en-tête porte la dénomination du vendeur", contient(A.nom));
  check("le SIRET y figure", contient("SIRET 81234567800012"));
  check("la forme juridique et le capital y figurent", contient("SARL — capital 10 000 €"));
  check("le RCS y figure", contient("RCS Lyon 812 345 678"));
  check("le n° de TVA intracommunautaire y figure", contient("TVA FR12812345678"));

  // --- Client et facture ---
  check("le client est imprimé", contient(CLIENT));
  check("le n° de TVA du client est imprimé", contient("FR40123456824"));
  check("le numéro de facture est imprimé", contient(facture?.number ?? "###"));
  check("la date d'émission est imprimée", contient("Date d'émission"));
  check("la date de prestation est imprimée", contient("Date de prestation"));

  // --- Prestations et totaux : ceux de la BASE, pas un recalcul ---
  check("les désignations sont imprimées",
    contient("Vidange + filtre à huile") && contient("Pièce détachée"));
  check("le total HT est celui de la base",
    contient("Total HT") && contient("200,00 €"), `base : ${facture?.subtotal_ht}`);
  check("la TVA est ventilée par taux",
    contient("TVA 20 % sur 170,00 €") && contient("TVA 5,5 % sur 30,00 €"));
  check("le total de TVA est imprimé", contient("Total TVA") && contient("35,65 €"));
  check("le total TTC est celui de la base",
    contient("Total TTC") && contient("235,65 €"), `base : ${facture?.total_ttc}`);

  // --- Mentions légales obligatoires ---
  check("le délai de règlement et l'échéance sont imprimés",
    contient("Règlement à 30 jours") && contient("échéance au"));
  check("les pénalités de retard sont imprimées",
    contient("pénalités de retard au taux de 10,75 %"));
  check("l'indemnité forfaitaire de 40 € est imprimée",
    contient("Indemnité forfaitaire pour frais de recouvrement") && contient("40 €"));
  check("les coordonnées bancaires sont imprimées",
    contient("FR7630006000011234567890189") && contient("BIC AGRIFRPP"));

  check("aucune mention de brouillon sur une facture émise", !contient("BROUILLON"));

  // --- Le piège des espaces fines ---
  // `Intl` sépare les milliers par une espace fine insécable, absente de
  // WinAnsi. Si elle passait telle quelle, le montant sortirait troué.
  check("aucune espace fine insécable n'a survécu dans le PDF",
    !pdf.texte.includes(" ") && !pdf.texte.includes(" "));

  // -------------------------------------------------------------------------
  section("3. Fidélité à l'aperçu affiché");

  const page = await navA.get(`/app/factures/${id}`);
  const montants = ["200,00", "35,65", "235,65"];
  check("les mêmes totaux sont à l'écran et sur le papier",
    montants.every((m) => page.body.includes(m) && contientTexte(pdf.texte, m)),
    montants.filter((m) => !page.body.includes(m)).join(", "));

  // -------------------------------------------------------------------------
  section("4. Le bouton Imprimer sert le MÊME document");

  // « Imprimer » ne doit pas produire une seconde mise en page : c'est le même
  // PDF, servi `inline` pour que le lecteur du navigateur s'ouvre.
  const impression = await telecharger(navA, id, { impression: true });
  check("la variante d'impression répond", impression.status === 200,
    `HTTP ${impression.status}`);
  check("elle s'ouvre dans le lecteur plutôt que de se télécharger",
    impression.disposition.startsWith("inline"), impression.disposition);
  check("elle porte le même nom de fichier",
    impression.disposition.includes(`Facture_${facture?.number}_Cafe_Leon_Fils.pdf`),
    impression.disposition);
  // Pas une comparaison octet pour octet : un PDF embarque sa date de création
  // et un identifiant de document, différents à chaque rendu. Ce qui doit être
  // identique, c'est le CONTENU — et c'est bien ce qu'on imprime.
  check("c'est le même document, au caractère près",
    texteDuPdf(impression.buffer) === pdf.texte,
    `${texteDuPdf(impression.buffer).length} vs ${pdf.texte.length} caractères`);
  check("il est A4 comme l'autre", estA4(impression.buffer));

  // -------------------------------------------------------------------------
  section("5. Le PDF d'un brouillon");

  const brouillon = await creerFacture(
    A.jeton,
    "Client de brouillon",
    [{ description: "Devis atelier", quantity: 1, unit_price_ht: 100, vat_rate: 20 }],
    { emettre: false },
  );
  const pdfBrouillon = await telecharger(navA, brouillon.id);

  check("le brouillon a son PDF", pdfBrouillon.status === 200, `HTTP ${pdfBrouillon.status}`);
  check("il s'ouvre dans le navigateur plutôt que de se télécharger",
    pdfBrouillon.disposition.startsWith("inline"), pdfBrouillon.disposition);
  check("son nom ne prétend pas être une facture",
    pdfBrouillon.disposition.includes('filename="Brouillon_Client_de_brouillon.pdf"'),
    pdfBrouillon.disposition);
  check("il porte le filigrane BROUILLON", contientTexte(pdfBrouillon.texte, "BROUILLON"));
  check("il annonce qu'aucun numéro n'est attribué",
    contientTexte(pdfBrouillon.texte, "attribué à l'émission"));

  // -------------------------------------------------------------------------
  section("6. Franchise en base de TVA");

  const franchise = {
    nom: `Franchise ${RUN}`,
    email: `franchise-${RUN}@verif.test`,
    motDePasse: `Franchise-${RUN}-2026`,
  };
  const navFranchise = await ouvrirGarage(admin, franchise, { vat_exempt: "on" });
  const exoneree = await creerFacture(franchise.jeton, "Client en franchise", [
    { description: "Réparation", quantity: 1, unit_price_ht: 150, vat_rate: 20 },
  ]);
  const pdfFranchise = await telecharger(navFranchise, exoneree.id);

  check("le PDF en franchise est produit", pdfFranchise.status === 200,
    `HTTP ${pdfFranchise.status}`);
  check("il porte la mention de l'art. 293 B",
    contientTexte(pdfFranchise.texte, "TVA non applicable, art. 293 B du CGI"));
  check("aucune TVA n'y figure",
    !contientTexte(pdfFranchise.texte, "Total TVA"));
  check("le total TTC égale le total HT",
    contientTexte(pdfFranchise.texte, "150,00 €") &&
      Number(exoneree.facture?.vat_total) === 0,
    `TVA en base : ${exoneree.facture?.vat_total}`);

  // -------------------------------------------------------------------------
  section("7. Frontières du point d'entrée");

  // Les layouts ne s'appliquent pas aux Route Handlers : c'est la route
  // elle-même qui doit refuser.
  const anonyme = await fetch(`${APP}/app/factures/${id}/pdf`, { redirect: "manual" });
  check("un visiteur sans session n'obtient pas le PDF", anonyme.status !== 200,
    `HTTP ${anonyme.status}`);
  check("il n'obtient pas non plus un corps PDF",
    (anonyme.headers.get("content-type") ?? "").includes("application/pdf") === false,
    String(anonyme.headers.get("content-type")));

  // L'ADMINISTRATEUR non plus : `invoices_select` le laisse tout lire, donc
  // ce n'est pas le RLS qui l'arrête ici — c'est `requireGarage()`. Sans cette
  // assertion, retirer la garde du Route Handler passerait inaperçu, puisque
  // l'anonyme, lui, resterait bloqué par le RLS.
  const pdfAdmin = await telecharger(admin, id);
  check("l'administrateur n'obtient pas le PDF par cette route",
    pdfAdmin.status !== 200, `HTTP ${pdfAdmin.status}`);

  const navB = await ouvrirGarage(admin, B);
  const vol = await telecharger(navB, id);
  check("un autre garage n'obtient pas le PDF", vol.status === 404, `HTTP ${vol.status}`);

  const malforme = await telecharger(navA, "pas-un-uuid");
  check("un identifiant malformé donne 404", malforme.status === 404,
    `HTTP ${malforme.status}`);

  const inconnu = await telecharger(navA, "11111111-1111-1111-1111-111111111111");
  check("une facture inconnue donne 404", inconnu.status === 404, `HTTP ${inconnu.status}`);

  // -------------------------------------------------------------------------
  section("8. Les écrans proposent le PDF");

  check("la facture émise offre le téléchargement",
    page.body.includes(`/app/factures/${id}/pdf`) &&
      page.body.includes("Télécharger le PDF"));
  check("elle offre aussi l'impression, à côté et sans remplacer",
    page.body.includes(`/app/factures/${id}/pdf?impression=1`) &&
      page.body.includes("Imprimer"));

  const editeur = await navA.get(`/app/factures/${brouillon.id}`);
  check("l'éditeur offre l'aperçu PDF",
    editeur.body.includes(`/app/factures/${brouillon.id}/pdf`) &&
      editeur.body.includes("Aperçu PDF"));

  // -------------------------------------------------------------------------
  section("Bilan");

  if (echecs.length === 0) {
    console.log("  ✓ Export PDF : toutes les vérifications passent\n");
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
