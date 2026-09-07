/**
 * `npm run db:clean` — retire les données laissées par les scripts `verify:*`.
 *
 * Le geste DOUX : il ne supprime que ce dont un compte de connexion porte une
 * adresse en `@verif.test`. Le super admin, vos garages réels et leurs
 * factures ne sont jamais dans le filtre.
 *
 * Pour repartir d'une base entièrement vierge — migrations rejouées, TOUT
 * effacé, y compris vos données — c'est `npm run db:reset`.
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { purger } from "./lib/nettoyage.mjs";

const execFile = promisify(execFileCb);

/** Ce qui reste en base, pour dire ce que la purge a emporté. */
async function compter() {
  const { stdout } = await execFile("docker", [
    "ps",
    "--filter",
    "name=supabase_db_",
    "--format",
    "{{.Names}}",
  ]);
  const conteneur = stdout.split("\n").map((l) => l.trim()).filter(Boolean)[0];
  if (!conteneur) return null;

  const requete = `
    select
      (select count(*) from garages),
      (select count(*) from garages g where exists (
         select 1 from profiles p join auth.users u on u.id = p.id
         where p.garage_id = g.id and u.email like '%@verif.test')),
      (select count(*) from invoices),
      (select count(*) from admin_notifications),
      (select count(*) from auth.users);`;

  const { stdout: brut } = await execFile("docker", [
    "exec", "-i", conteneur, "psql", "-U", "postgres", "-d", "postgres",
    "-t", "-A", "-F", "|", "-c", requete,
  ]);
  const [garages, verif, factures, notifications, comptes] = brut
    .trim()
    .split("|")
    .map(Number);
  return { garages, verif, factures, notifications, comptes };
}

function ligne(titre, avant, apres) {
  const delta = avant - apres;
  console.log(
    `  ${titre.padEnd(16)} ${String(avant).padStart(5)} → ${String(apres).padStart(5)}` +
      (delta > 0 ? `   (−${delta})` : ""),
  );
}

async function main() {
  console.log("\n  Nettoyage des données de vérification\n");

  const avant = await compter();
  if (!avant) {
    console.error(
      "  ✗ Aucun conteneur `supabase_db_*` en marche.\n" +
        "    Lancez la pile locale : npx supabase start\n",
    );
    process.exit(1);
  }

  if (avant.verif === 0) {
    console.log("  Rien à retirer : aucun garage de vérification en base.\n");
    return;
  }

  const ok = await purger("%@verif.test", { silencieux: true });
  if (!ok) {
    console.error("  ✗ La purge a échoué. Rien n'a été supprimé.\n");
    process.exit(1);
  }

  const apres = await compter();
  console.log("");
  ligne("garages", avant.garages, apres.garages);
  ligne("dont vérif.", avant.verif, apres.verif);
  ligne("factures", avant.factures, apres.factures);
  ligne("notifications", avant.notifications, apres.notifications);
  ligne("comptes Auth", avant.comptes, apres.comptes);

  console.log(
    `\n  ✓ Base nettoyée. ${apres.garages} garage(s) réel(s) conservé(s).\n`,
  );
}

main().catch((error) => {
  console.error("\n  ✗ Interruption :", error.message, "\n");
  process.exit(1);
});
