import type { Metadata } from "next";
import Link from "next/link";
import { Search, UserPlus, Users } from "lucide-react";

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
import { AccessBanner } from "@/components/access-banner";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requireGarage } from "@/lib/auth/session";
import { listClients } from "@/lib/catalog/queries";
import { DeleteClientButton } from "./delete-client-button";

export const metadata: Metadata = {
  title: "Carnet de clients — Facturation multi-garages",
};

/**
 * Carnet de clients.
 *
 * La recherche est un `<form>` en GET : l'état tient dans l'URL, se partage,
 * revient avec le bouton « précédent » et fonctionne sans JavaScript — comme
 * les onglets de la liste des factures. Le filtrage se fait en base
 * (`ilike`), pas dans le navigateur : c'est le RLS qui borne ce qui remonte.
 */
export default async function ClientsPage(props: PageProps<"/app/clients">) {
  const { q } = await props.searchParams;
  const query = (Array.isArray(q) ? q[0] : q) ?? "";

  const { garage, access } = await requireGarage();
  const clients = await listClients(query);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Carnet de clients"
        description="Les clients que vous facturez régulièrement. Choisir un client dans l'éditeur pré-remplit ses coordonnées — et tout y reste modifiable."
        action={
          <Button asChild disabled={!access.canWrite}>
            <Link href="/app/clients/nouveau">
              <UserPlus aria-hidden />
              Nouveau client
            </Link>
          </Button>
        }
      />

      <AccessBanner garage={garage} access={access} />

      {clients.length === 0 && !query ? (
        <EmptyState
          icon={<Users className="size-5" aria-hidden />}
          title="Aucun client enregistré"
          description="Le carnet n'est pas obligatoire : une facture peut toujours viser un client ponctuel. Il fait gagner du temps sur ceux qui reviennent."
          action={
            <Button asChild disabled={!access.canWrite}>
              <Link href="/app/clients/nouveau">
                <UserPlus aria-hidden />
                Nouveau client
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          <form className="flex items-center gap-2" role="search">
            <div className="relative flex-1 sm:max-w-xs">
              <Search
                aria-hidden
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                name="q"
                defaultValue={query}
                placeholder="Nom ou raison sociale…"
                aria-label="Rechercher un client"
                className="ps-9"
              />
            </div>
            <Button type="submit" variant="secondary">
              Rechercher
            </Button>
          </form>

          {clients.length === 0 ? (
            <EmptyState
              variant="compact"
              title="Aucun client ne correspond"
              description={`Rien dans le carnet ne contient « ${query} ».`}
              action={
                <Button asChild variant="outline">
                  <Link href="/app/clients">Voir tout le carnet</Link>
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nom ou raison sociale</TableHead>
                    <TableHead>Téléphone</TableHead>
                    <TableHead>N° de TVA</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients.map((client) => (
                    <TableRow key={client.id}>
                      <TableCell>
                        <Link
                          href={`/app/clients/${client.id}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {client.name}
                        </Link>
                        {client.address ? (
                          <p className="text-xs text-muted-foreground">
                            {client.address.split("\n")[0]}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {client.phone ?? "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {client.vatNumber ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button asChild variant="ghost" size="sm">
                            <Link href={`/app/clients/${client.id}`}>Ouvrir</Link>
                          </Button>
                          {access.canWrite ? (
                            <DeleteClientButton
                              clientId={client.id}
                              label={client.name}
                            />
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
