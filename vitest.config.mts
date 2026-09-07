import { defineConfig } from "vitest/config";

/**
 * Tests unitaires — Vitest.
 *
 * ---------------------------------------------------------------------------
 * CE QUI EST TESTÉ ICI, ET CE QUI NE L'EST PAS
 * ---------------------------------------------------------------------------
 * Ici : les modules PURS, ceux dont une erreur ne se voit pas à l'écran —
 * arrondis, ventilation de TVA, échéances, mentions légales, validation zod,
 * formatage. C'est là qu'un bug est silencieux et coûteux : une facture au
 * centime près qui ne l'est plus ne lève aucune exception.
 *
 * Pas ici : les frontières (RLS), qui restent prouvées en SQL par
 * `supabase/tests/rls_isolation.sql` ; et le câblage, que les `verify:*`
 * éprouvent sur l'application réellement lancée. Réécrire ces preuves en
 * JavaScript avec des bouchons ne prouverait que le comportement des bouchons.
 *
 * `environment: "node"` : aucun de ces modules ne touche au DOM. Ceux qui
 * importent `server-only` sont hors périmètre — ils ne sont pas purs.
 *
 * Extension `.mts` : Vite charge ce fichier en CommonJS sinon, et prévient
 * que la syntaxe ESM n'y sera plus acceptée.
 */
export default defineConfig({
  // Résolution native de `@/…` depuis tsconfig.json : Vite sait le faire
  // depuis la v8, le plugin `vite-tsconfig-paths` n'a plus lieu d'être.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    reporters: "default",
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/**/actions.ts", "src/lib/**/queries.ts", "src/lib/supabase/**"],
    },
  },
});
