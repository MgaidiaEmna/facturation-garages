import type { Metadata } from "next";
import Link from "next/link";
import { Building2, CheckCircle2, ChevronRight, Search, UserPlus } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AccessBadge,
  IncompleteBadge,
  InactiveBadge,
  PremiumBadge,
} from "@/components/admin/garage-badges";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { subscriptionStatus } from "@/lib/admin/payment-schema";
import { listGarages, type GarageListItem } from "@/lib/admin/queries";

export const metadata: Metadata = {
  title: "Garages — Administration",
};

/** Onglets de filtrage. `undefined` = tous. */
const FILTERS = [
  { key: undefined, label: "Tous" },
  { key: "actifs", label: "Actifs" },
  { key: "inactifs", label: "Désactivés" },
  { key: "expires", label: "Abonnement expiré" },
  { key: "bientot", label: "Expire sous 7 j" },
] as const;

/**
 * Recherche et filtre sont portés par l'URL, pas par un état React : la page
 * reste un Composant Serveur, le formulaire fonctionne sans JavaScript, et un
 * résultat filtré se partage par simple copie du lien.
 *
 * Le filtrage se fait en mémoire plutôt qu'en SQL. Ce n'est pas un
 * relâchement de l'isolation — l'administrateur voit de toute façon tous les
 * garages, `is_admin()` le lui accorde. C'est un choix de volume : quelques
 * dizaines de fiches. À revoir en même temps que la pagination.
 */
function filterGarages(
  garages: GarageListItem[],
  query: string,
  statut: string | undefined,
): GarageListItem[] {
  const needle = query.trim().toLocaleLowerCase("fr-FR");

  return garages.filter((garage) => {
    if (statut === "actifs" && !garage.isActive) return false;
    if (statut === "inactifs" && garage.isActive) return false;

    // Les deux filtres d'abonnement emploient le même calcul que les
    // compteurs du tableau de bord : le lien depuis une tuile doit aboutir
    // exactement sur les garages qu'elle comptait.
    if (statut === "expires") {
      const status = subscriptionStatus(garage.subscriptionEndDate);
      if (garage.accountStatus !== "subscribed") return false;
      if (status === "active" || status === "expiring") return false;
    }
    if (statut === "bientot" && subscriptionStatus(garage.subscriptionEndDate) !== "expiring") {
      return false;
    }
    if (!needle) return true;

    return [garage.name, garage.email, garage.siret, garage.address]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase("fr-FR").includes(needle));
  });
}

export default async function GaragesPage(props: PageProps<"/admin/garages">) {
  const params = await props.searchParams;

  const query = typeof params.q === "string" ? params.q : "";
  const statut = typeof params.statut === "string" ? params.statut : undefined;
  const deleted = typeof params.supprime === "string" ? params.supprime : null;

  const garages = await listGarages();
  const visible = filterGarages(garages, query, statut);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Garages"
        description="Identité légale, conditions de règlement et droits de chaque garage."
        action={
          <Button asChild>
            <Link href="/admin/comptes/nouveau">
              <UserPlus aria-hidden />
              Créer un compte
            </Link>
          </Button>
        }
      />

      {deleted ? (
        <Alert>
          <CheckCircle2 aria-hidden />
          <AlertTitle>Garage supprimé</AlertTitle>
          <AlertDescription>
            « {deleted} » et son compte de connexion ont été supprimés définitivement.
          </AlertDescription>
        </Alert>
      ) : null}

      {garages.length === 0 ? (
        <NoGarages />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <form className="flex flex-1 items-center gap-2" role="search">
              <div className="relative flex-1 sm:max-w-xs">
                <Search
                  aria-hidden
                  className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="search"
                  name="q"
                  defaultValue={query}
                  placeholder="Nom, e-mail, SIRET…"
                  aria-label="Rechercher un garage"
                  className="ps-9"
                />
              </div>
              {statut ? <input type="hidden" name="statut" value={statut} /> : null}
              <Button type="submit" variant="secondary">
                Rechercher
              </Button>
            </form>

            <nav aria-label="Filtrer par état" className="flex items-center gap-1">
              {FILTERS.map((filter) => {
                const active = statut === filter.key;
                const search = new URLSearchParams();
                if (query) search.set("q", query);
                if (filter.key) search.set("statut", filter.key);
                const href = search.size ? `/admin/garages?${search}` : "/admin/garages";

                return (
                  <Button
                    key={filter.label}
                    asChild
                    size="sm"
                    variant={active ? "secondary" : "ghost"}
                  >
                    <Link href={href} aria-current={active ? "page" : undefined}>
                      {filter.label}
                    </Link>
                  </Button>
                );
              })}
            </nav>
          </div>

          {visible.length === 0 ? (
            <NoResults query={query} />
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Garage</TableHead>
                    <TableHead>Identité</TableHead>
                    <TableHead>Accès</TableHead>
                    <TableHead className="text-right">Factures</TableHead>
                    <TableHead>
                      <span className="sr-only">Ouvrir la fiche</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((garage) => (
                    <TableRow key={garage.id}>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={`/admin/garages/${garage.id}`}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {garage.name}
                          </Link>
                          {!garage.isActive ? <InactiveBadge /> : null}
                          {garage.logoManagementEnabled ? <PremiumBadge /> : null}
                        </div>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          {garage.email ?? "Adresse de contact non renseignée"}
                        </p>
                      </TableCell>

                      <TableCell>
                        {garage.missingFields.length > 0 ? (
                          <IncompleteBadge count={garage.missingFields.length} />
                        ) : (
                          <Badge variant="outline">Complète</Badge>
                        )}
                      </TableCell>

                      <TableCell>
                        <AccessBadge
                          accountStatus={garage.accountStatus}
                          trialInvoicesUsed={garage.trialInvoicesUsed}
                          trialInvoiceLimit={garage.trialInvoiceLimit}
                          subscriptionEndDate={garage.subscriptionEndDate}
                        />
                      </TableCell>

                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {garage.invoiceCount}
                      </TableCell>

                      <TableCell className="text-right">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/admin/garages/${garage.id}`}>
                            Ouvrir
                            <ChevronRight aria-hidden />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            {visible.length} garage{visible.length > 1 ? "s" : ""} affiché
            {visible.length > 1 ? "s" : ""} sur {garages.length}.
          </p>
        </>
      )}
    </div>
  );
}

/** Aucun garage en base : l'administration vient d'être installée. */
function NoGarages() {
  return (
    <EmptyState
      icon={<Building2 className="size-5" aria-hidden />}
      title="Aucun garage pour l'instant"
      description="Créez un compte vous-même, ou attendez qu'un garage s'inscrive en ligne — il démarrera alors en essai gratuit, et sa fiche apparaîtra ici."
      action={
        <Button asChild>
          <Link href="/admin/comptes/nouveau">
            <UserPlus aria-hidden />
            Créer un compte
          </Link>
        </Button>
      }
    />
  );
}

/** Le filtre ne renvoie rien : on distingue « rien à voir » de « rien trouvé ». */
function NoResults({ query }: { query: string }) {
  return (
    <EmptyState
      variant="compact"
      icon={<Search className="size-5" aria-hidden />}
      title="Aucun garage ne correspond"
      description={
        query
          ? `Aucun résultat pour « ${query} ». Essayez un autre terme, ou retirez le filtre.`
          : "Aucun garage dans cet état."
      }
      action={
        <Button asChild variant="outline">
          <Link href="/admin/garages">Voir tous les garages</Link>
        </Button>
      }
    />
  );
}
