import { AppShell } from "@/components/app-shell";
import { requireAdmin } from "@/lib/auth/session";

/**
 * Barrière de l'espace super administrateur.
 *
 * `requireAdmin()` vérifie côté serveur : session, adresse vérifiée, profil
 * rattaché, mot de passe initial changé, puis `role = 'super_admin'` lu dans
 * `profiles`. Le proxy n'a fait qu'écarter les visiteurs sans session — il ne
 * sait rien des rôles.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const context = await requireAdmin();

  return (
    <AppShell
      spaceLabel="Administration"
      accountLabel={context.email ?? "Super administrateur"}
      nav={[
        { href: "/admin", label: "Tableau de bord" },
        { href: "/admin/comptes", label: "Comptes" },
        { href: "/admin/notifications", label: "Notifications" },
      ]}
    >
      {children}
    </AppShell>
  );
}
