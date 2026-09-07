import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Search, Wrench } from "lucide-react";

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
import { listServices } from "@/lib/catalog/queries";
import { formatAmount, formatVatRate } from "@/lib/format";
import { DEFAULT_LOCALE, type LocaleCode } from "@/lib/locale";
import { DeleteServiceButton } from "./delete-service-button";

export const metadata: Metadata = {
  title: "Catalogue de prestations — Facturation multi-garages",
};

/**
 * Catalogue de prestations.
 *
 * Recherche en GET, comme le carnet : l'état tient dans l'URL et le filtrage
 * se fait en base. Le RLS borne ce qui remonte — aucun filtre sur `garage_id`
 * n'est écrit dans la requête.
 */
export default async function ServicesPage(props: PageProps<"/app/prestations">) {
  const { q } = await props.searchParams;
  const query = (Array.isArray(q) ? q[0] : q) ?? "";

  const { garage, access } = await requireGarage();
  const services = await listServices(query);
  const localeCode = (garage.locale as LocaleCode) || DEFAULT_LOCALE;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Catalogue de prestations"
        description="Vos prestations habituelles avec leur prix et leur taux. Dans l'éditeur, en choisir une remplit la ligne — qui reste modifiable ensuite."
        action={
          <Button asChild disabled={!access.canWrite}>
            <Link href="/app/prestations/nouvelle">
              <Plus aria-hidden />
              Nouvelle prestation
            </Link>
          </Button>
        }
      />

      <AccessBanner garage={garage} access={access} />

      {services.length === 0 && !query ? (
        <EmptyState
          icon={<Wrench className="size-5" aria-hidden />}
          title="Aucune prestation enregistrée"
          description="Le catalogue n'est pas obligatoire : une ligne de facture peut toujours se saisir à la main. Il évite de retaper le même prix vingt fois par semaine."
          action={
            <Button asChild disabled={!access.canWrite}>
              <Link href="/app/prestations/nouvelle">
                <Plus aria-hidden />
                Nouvelle prestation
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
                placeholder="Libellé de la prestation…"
                aria-label="Rechercher une prestation"
                className="ps-9"
              />
            </div>
            <Button type="submit" variant="secondary">
              Rechercher
            </Button>
          </form>

          {services.length === 0 ? (
            <EmptyState
              variant="compact"
              title="Aucune prestation ne correspond"
              description={`Rien dans le catalogue ne contient « ${query} ».`}
              action={
                <Button asChild variant="outline">
                  <Link href="/app/prestations">Voir tout le catalogue</Link>
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Libellé</TableHead>
                    <TableHead>Unité</TableHead>
                    <TableHead className="text-right">P.U. HT</TableHead>
                    <TableHead className="text-right">TVA</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {services.map((service) => (
                    <TableRow key={service.id}>
                      <TableCell>
                        <Link
                          href={`/app/prestations/${service.id}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {service.label}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {service.defaultUnit}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatAmount(service.defaultPriceHt, localeCode)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatVatRate(service.defaultVatRate, localeCode)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button asChild variant="ghost" size="sm">
                            <Link href={`/app/prestations/${service.id}`}>Ouvrir</Link>
                          </Button>
                          {access.canWrite ? (
                            <DeleteServiceButton
                              serviceId={service.id}
                              label={service.label}
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
