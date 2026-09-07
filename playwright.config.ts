import { defineConfig, devices } from "@playwright/test";

/**
 * Parcours de bout en bout — Playwright.
 *
 * ---------------------------------------------------------------------------
 * CE QU'IL APPORTE QUE LES `verify:*` NE PEUVENT PAS APPORTER
 * ---------------------------------------------------------------------------
 * Les scripts `verify:*` se comportent comme un navigateur SANS JavaScript.
 * C'est délibéré, et c'est une force : ce qu'ils atteignent est atteignable
 * même quand le script n'a pas chargé. Mais cela leur laisse un angle mort,
 * documenté depuis la phase 3 — tout ce qui n'existe dans le HTML qu'APRÈS
 * exécution du JavaScript : le contenu d'une boîte de dialogue Radix, un
 * interrupteur, une confirmation par saisie du nom.
 *
 * C'est cet angle mort que ce fichier vise. Refaire ici ce que les `verify:*`
 * prouvent déjà n'ajouterait qu'un second endroit à maintenir.
 *
 * ---------------------------------------------------------------------------
 * ON PILOTE LE CHROME DE LA MACHINE
 * ---------------------------------------------------------------------------
 * `channel: "chrome"` plutôt que le Chromium téléchargé par Playwright : ~200
 * Mo de moins à l'installation, et le navigateur réellement utilisé pour
 * regarder l'application. Si Chrome n'est pas installé, `npm run test:e2e`
 * le dit et s'arrête — il n'y a pas de repli silencieux sur un autre moteur.
 *
 * PRÉREQUIS, les mêmes que les `verify:*` : pile Supabase locale,
 * `npm run dev`, et `npm run db:seed`.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  // Un seul worker : ces tests créent des garages par l'écran d'administration
  // et se marchent dessus s'ils tournent en parallèle.
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    // On ne garde de trace que d'un échec : sur un parcours qui passe, elle ne
    // sert à rien et pèse.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
  },

  projects: [
    {
      name: "chrome",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
  ],
});
