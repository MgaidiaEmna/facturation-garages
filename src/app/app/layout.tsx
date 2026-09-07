import { AppShell } from "@/components/app-shell";
import { requireGarage } from "@/lib/auth/session";

/**
 * Barrière de l'espace garage.
 *
 * `requireGarage()` vérifie côté serveur : session, adresse vérifiée, profil
 * rattaché, mot de passe initial changé, puis `role = 'garage'`. Le garage
 * courant vient de `profiles`, jamais d'un paramètre d'URL — c'est la règle
 * qui rend l'isolation multi-locataire vraie.
 */
export default async function GarageLayout({ children }: LayoutProps<"/app">) {
  const context = await requireGarage();

  return (
    <AppShell
      spaceLabel={context.garage.name}
      accountLabel={context.email ?? ""}
      homeHref="/app"
      nav={[
        { href: "/app", label: "Tableau de bord" },
        { href: "/app/factures", label: "Factures" },
      ]}
    >
      {children}
    </AppShell>
  );
}
