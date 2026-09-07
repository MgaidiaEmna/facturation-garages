/**
 * Le ménage des scripts `verify:*`.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CE N'EST PAS UNE SUITE D'APPELS POSTGREST
 * ---------------------------------------------------------------------------
 * `invoices_guard_trg` rend une facture émise indestructible — conservation
 * légale — et deux scripts de vérification émettent. Leurs garages ne se
 * suppriment donc ni par l'écran d'administration, ni par la clé service role.
 * Désactiver la garde le temps d'une transaction exige les droits du
 * propriétaire des tables : on passe par du SQL exécuté DANS le conteneur
 * Postgres, via `supabase/tests/purge_donnees_verification.sql`.
 *
 * C'est une contrainte de plus, mais pas une contrainte nouvelle : les
 * `verify:*` exigeaient déjà la pile Supabase locale et le serveur de dev.
 *
 * ---------------------------------------------------------------------------
 * LE MÉNAGE NE DOIT JAMAIS FAIRE ÉCHOUER UNE VÉRIFICATION
 * ---------------------------------------------------------------------------
 * Il tourne dans un `finally`, APRÈS que le bilan a été rendu. S'il échoue —
 * Docker éteint, conteneur renommé — il le DIT et rend la main sans toucher au
 * code de sortie. Un script qui passerait au rouge parce que la corbeille est
 * pleine ferait douter de la mauvaise chose.
 */

import { execFile as execFileCb, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const execFile = promisify(execFileCb);

/**
 * Lance une commande en lui POUSSANT du texte sur l'entrée standard.
 *
 * `execFile` n'a pas d'option `input` — seul `execFileSync` en a une. Passer
 * `input` à la version asynchrone ne provoque aucune erreur : stdin reste
 * simplement vide, et `psql -f -` attend indéfiniment de quoi lire. D'où
 * `spawn`, où l'on ferme explicitement le tuyau.
 */
function executerAvecEntree(commande, args, entree) {
  return new Promise((resoudre, rejeter) => {
    const enfant = spawn(commande, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    enfant.stdout.on("data", (m) => (stdout += m));
    enfant.stderr.on("data", (m) => (stderr += m));
    enfant.on("error", rejeter);
    enfant.on("close", (code) => {
      if (code === 0) resoudre({ stdout, stderr });
      else rejeter(new Error(stderr.trim() || `code de sortie ${code}`));
    });
    enfant.stdin.end(entree);
  });
}

const ICI = dirname(fileURLToPath(import.meta.url));
const PURGE = join(ICI, "..", "..", "supabase", "tests", "purge_donnees_verification.sql");

/**
 * Le conteneur Postgres de la pile locale.
 *
 * Son nom dépend du dossier du projet (`supabase_db_Facture` ici) : on le
 * cherche par préfixe plutôt que de l'écrire en dur, pour que le dépôt cloné
 * ailleurs continue de fonctionner.
 */
async function conteneurPostgres() {
  const { stdout } = await execFile("docker", [
    "ps",
    "--filter",
    "name=supabase_db_",
    "--format",
    "{{.Names}}",
  ]);
  const noms = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  if (noms.length === 0) throw new Error("aucun conteneur `supabase_db_*` en marche");
  return noms[0];
}

/**
 * Supprime les données portant `motif` (un motif SQL `like` sur l'adresse des
 * comptes de connexion).
 *
 * @param {string} motif  ex. `%-mtrr67lj@verif.test` pour un run précis.
 * @param {{ silencieux?: boolean }} options
 * @returns {Promise<boolean>} vrai si la purge a bien eu lieu.
 */
export async function purger(motif, { silencieux = false } = {}) {
  const dire = (texte) => {
    if (!silencieux) console.log(texte);
  };

  let conteneur;
  try {
    conteneur = await conteneurPostgres();
  } catch (error) {
    dire(`  · ménage impossible (${error.message}) — données de test conservées`);
    return false;
  }

  try {
    const { stdout, stderr } = await executerAvecEntree(
      "docker",
      [
        "exec",
        "-i",
        conteneur,
        "psql",
        // `supabase_admin`, et non `postgres` : seul le superutilisateur peut
        // mettre en sourdine le garde-fou de `storage.objects`, dont il n'est
        // pas propriétaire.
        "-U",
        "supabase_admin",
        "-d",
        "postgres",
        "-q",
        "-v",
        "ON_ERROR_STOP=1",
        "-v",
        `motif=${motif}`,
        "-f",
        "-",
      ],
      readFileSync(PURGE, "utf8"),
    );
    const bruit = `${stdout}${stderr}`.trim();
    if (bruit && !silencieux) console.log(`  ${bruit.replace(/\n/g, "\n  ")}`);
    dire(`  · ménage fait (${motif})`);
    return true;
  } catch (error) {
    dire(`  · ménage en échec : ${error.message.trim()}`);
    return false;
  }
}

/**
 * Le ménage d'un run, à appeler dans un `finally`.
 *
 * Les scripts nomment leurs comptes `<préfixe>-<run>@verif.test` : le run
 * suffit donc à désigner exactement ce qu'ils ont créé, sans risquer
 * d'emporter les données d'une autre exécution lancée en parallèle.
 */
export async function nettoyerRun(run) {
  console.log("\n=== Ménage ===\n");
  return purger(`%-${run}@verif.test`);
}
