import { expect, test, type Page } from "@playwright/test";

/**
 * L'ANGLE MORT DES SCRIPTS `verify:*`.
 *
 * Ces scripts se comportent comme un navigateur sans JavaScript : ce qu'ils
 * atteignent est atteignable même quand le script n'a pas chargé. Mais tout ce
 * qui n'existe dans le HTML qu'APRÈS exécution du JavaScript leur échappe —
 * une boîte de dialogue Radix n'est montée qu'à l'ouverture, un interrupteur
 * n'a pas de `<form>`.
 *
 * Ce fichier ne refait donc PAS ce qu'ils prouvent déjà. Il vise trois choses
 * qu'eux seuls ne peuvent pas voir :
 *
 *   1. l'interrupteur premium bascule et l'effet est RÉEL (l'onglet Logos
 *      apparaît côté garage) ;
 *   2. la boîte de dialogue d'émission confirme, et la facture prend un
 *      numéro de la série légale ;
 *   3. le parcours complet connexion → brouillon → émission → PDF tient
 *      debout dans un vrai navigateur.
 *
 * PRÉREQUIS : pile Supabase locale, `npm run dev`, `npm run db:seed`.
 * Les comptes créés ici portent `@verif.test` : `npm run db:clean` les retire.
 */

const ADMIN = {
  email: process.env.SEED_ADMIN_EMAIL ?? "admin@garage.test",
  motDePasse: process.env.SEED_ADMIN_PASSWORD ?? "MotDePasseAdmin2026",
};

const RUN = Date.now().toString(36);
const GARAGE = {
  nom: `E2E ${RUN}`,
  email: `e2e-${RUN}@verif.test`,
  motDePasseInitial: `E2e-${RUN}-2026!`,
  motDePasse: `E2e-${RUN}-2026!def`,
};

async function seConnecter(page: Page, email: string, motDePasse: string) {
  await page.goto("/login");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(motDePasse);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

async function seDeconnecter(page: Page) {
  await page.context().clearCookies();
}

test.describe.configure({ mode: "serial" });

let garageId = "";

test("l'administrateur crée un compte garage", async ({ page }) => {
  await seConnecter(page, ADMIN.email, ADMIN.motDePasse);

  const echeance = new Date();
  echeance.setFullYear(echeance.getFullYear() + 1);

  await page.goto("/admin/comptes/nouveau");
  await page.getByLabel("Nom du garage").fill(GARAGE.nom);
  await page.getByLabel("Contact (facultatif)").fill("Gérant E2E");
  await page.getByLabel("Adresse e-mail de connexion").fill(GARAGE.email);
  await page.getByLabel("Mot de passe initial").fill(GARAGE.motDePasseInitial);
  await page.getByLabel(/Abonnement jusqu/).fill(echeance.toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Créer le compte" }).click();

  // La création ne redirige pas : elle remplace le formulaire par un accusé.
  await expect(page.getByText(`Compte créé — « ${GARAGE.nom} »`)).toBeVisible({
    timeout: 20_000,
  });

  // On retrouve la fiche par la recherche de la liste des garages.
  await page.goto(`/admin/garages?q=${encodeURIComponent(GARAGE.nom)}`);
  await page.getByRole("link", { name: GARAGE.nom }).first().click();
  await page.waitForURL(/\/admin\/garages\/[0-9a-f-]{36}/, { timeout: 20_000 });

  garageId = page.url().split("/admin/garages/")[1].split(/[?#]/)[0];
  expect(garageId).toMatch(/^[0-9a-f-]{36}$/);
});

/**
 * LE test que les `verify:*` ne peuvent pas écrire.
 *
 * L'interrupteur est un composant Radix : sans JavaScript, il n'existe pas
 * dans le HTML rendu. On le bascule ici pour de vrai, et surtout on vérifie
 * son EFFET côté garage — pas seulement que la case a l'air cochée.
 */
test("l'interrupteur premium débloque réellement la bibliothèque de logos", async ({
  page,
}) => {
  await seConnecter(page, ADMIN.email, ADMIN.motDePasse);
  await page.goto(`/admin/garages/${garageId}`);

  const premium = page.getByRole("switch", { name: /premium/i });
  await expect(premium).toBeVisible();
  await expect(premium).toHaveAttribute("aria-checked", "false");

  await premium.click();
  await expect(premium).toHaveAttribute("aria-checked", "true");

  // L'interrupteur est OPTIMISTE : il bascule avant la réponse du serveur, et
  // revient en arrière si celui-ci refuse. Recharger tout de suite ne
  // prouverait donc rien — on attendrait la fin de l'écriture. `disabled` est
  // levé quand la transition se termine : c'est le signal.
  await expect(premium).toBeEnabled();

  // Le drapeau doit avoir atteint la BASE, pas seulement l'écran.
  await page.reload();
  await expect(page.getByRole("switch", { name: /premium/i })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("le garage change son mot de passe imposé, puis voit ses écrans", async ({ page }) => {
  await seDeconnecter(page);
  await seConnecter(page, GARAGE.email, GARAGE.motDePasseInitial);

  // Compte créé par l'admin : changement de mot de passe forcé.
  await expect(page).toHaveURL(/\/change-password/);
  await page.getByLabel("Nouveau mot de passe").fill(GARAGE.motDePasse);
  await page.getByLabel("Confirmation").fill(GARAGE.motDePasse);
  await page
    .getByRole("button", { name: "Enregistrer le nouveau mot de passe" })
    .click();
  await page.waitForURL((url) => !url.pathname.startsWith("/change-password"));

  // L'effet du drapeau premium, vu depuis l'espace garage.
  await page.goto("/app/logos");
  await expect(page.getByRole("heading", { name: /logo/i }).first()).toBeVisible();
});

test("parcours complet : brouillon → émission → PDF", async ({ page }) => {
  await seDeconnecter(page);
  await seConnecter(page, GARAGE.email, GARAGE.motDePasse);

  // --- Le brouillon ---
  await page.goto("/app/factures/nouveau");
  await page.getByLabel("Nom ou raison sociale").fill("Transports Dupont");
  await page.getByLabel("Désignation").first().fill("Révision complète");
  await page.getByLabel("P.U. HT").first().fill("240");

  // L'aperçu temps réel recalcule à la frappe : c'est du JavaScript, donc
  // strictement invisible pour les `verify:*`. 240 HT à 20 % = 288,00 TTC.
  await expect(page.getByText("288,00").first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
  await page.waitForURL(/\/app\/factures\/[0-9a-f-]{36}/, { timeout: 20_000 });
  const factureId = page.url().split("/app/factures/")[1].split(/[?#]/)[0];

  // --- L'émission, par la boîte de dialogue ---
  await page.getByRole("button", { name: "Émettre la facture" }).click();

  // La boîte Radix n'est montée qu'à l'ouverture : sans JavaScript, ce bloc
  // n'existe tout simplement pas dans le HTML.
  const dialogue = page.getByRole("dialog");
  await expect(dialogue.getByText("Émettre cette facture ?")).toBeVisible();
  await expect(dialogue.getByText(/ne sera plus modifiable/)).toBeVisible();
  await dialogue.getByRole("button", { name: "Émettre", exact: true }).click();

  // Un numéro de la série légale, au format AAAA-000001.
  await expect(page.getByText(/\d{4}-\d{6}/).first()).toBeVisible({ timeout: 20_000 });

  // --- Le PDF ---
  const reponse = await page.request.get(`/app/factures/${factureId}/pdf`);
  expect(reponse.status()).toBe(200);
  expect(reponse.headers()["content-type"]).toContain("application/pdf");
  const corps = await reponse.body();
  expect(corps.subarray(0, 5).toString()).toBe("%PDF-");
});
