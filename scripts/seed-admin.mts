/**
 * Amorçage du compte super administrateur.
 *
 * Le super admin ne peut pas s'auto-inscrire : il n'existe aucune page
 * d'inscription publique, et la policy RLS sur `profiles` réserve l'insertion
 * aux administrateurs — donc à personne tant qu'il n'y en a aucun. Ce script
 * casse l'œuf et la poule en passant par la clé service role, qui contourne
 * le RLS.
 *
 * Lancement :  npm run db:seed
 * Variables requises dans .env.local :
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD
 *
 * Le script est idempotent : relancé, il se contente de remettre le profil
 * existant au bon rôle.
 */

import { createClient } from "@supabase/supabase-js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`\n  ✗ Variable manquante : ${name}`);
    console.error("    Renseignez-la dans .env.local (voir .env.example).\n");
    process.exit(1);
  }
  return value;
}

const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const email = requireEnv("SEED_ADMIN_EMAIL");
const password = requireEnv("SEED_ADMIN_PASSWORD");

if (password.length < 12) {
  console.error("\n  ✗ SEED_ADMIN_PASSWORD doit faire au moins 12 caractères.\n");
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Retrouve un compte Auth par e-mail, sinon le crée. */
async function ensureAuthUser(): Promise<string> {
  // `listUsers` est paginé ; on parcourt jusqu'à trouver l'adresse.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;

    const existing = data.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    if (existing) {
      console.log(`  · Compte Auth déjà présent : ${email}`);
      return existing.id;
    }
    if (data.users.length < 200) break;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // pas de boucle de confirmation pour le compte racine
  });
  if (error) throw error;

  console.log(`  · Compte Auth créé : ${email}`);
  return data.user.id;
}

/** Rattache le profil super_admin au compte Auth. */
async function ensureAdminProfile(userId: string): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .upsert(
      {
        id: userId,
        role: "super_admin",
        garage_id: null, // invariant : un super_admin n'appartient à aucun garage
        full_name: "Super administrateur",
        must_change_password: false,
      },
      { onConflict: "id" },
    );
  if (error) throw error;

  console.log("  · Profil super_admin en place");
}

async function main(): Promise<void> {
  console.log("\n  Amorçage du super administrateur\n");

  const userId = await ensureAuthUser();
  await ensureAdminProfile(userId);

  console.log(`\n  ✓ Terminé. Connectez-vous sur /login avec ${email}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n  ✗ Échec de l'amorçage : ${message}\n`);
  process.exit(1);
});
