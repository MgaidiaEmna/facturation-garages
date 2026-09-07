import type { Metadata } from "next";
import Link from "next/link";
import { FilePlus2, FileCheck2, FileText, FileX2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { countInvoicesByStatus, listInvoices } from "@/lib/invoice/queries";
import type { InvoiceStatus } from "@/lib/invoice/types";
import { formatAmount, formatDateShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DeleteDraftButton } from "./delete-draft-button";

export const metadata: Metadata = {
  title: "Mes factures — Facturation multi-garages",
};

/**
 * Onglets de la liste.
 *
 * Ce sont de VRAIS liens, pas un composant à onglets : l'état tient dans
 * l'URL. Un onglet se partage, se met en favori, revient avec le bouton
 * « précédent », et fonctionne sans que le JavaScript ait chargé. Un
 * composant client aurait rendu la liste invisible aux scripts `verify:*`,
 * qui se comportent comme un navigateur sans JS.
 */
const ONGLETS = [
  { slug: "brouillons", statut: "draft", libelle: "Brouillons" },
  { slug: "emises", statut: "final", libelle: "Émises" },
  { slug: "annulees", statut: "cancelled", libelle: "Annulées" },
] as const satisfies ReadonlyArray<{ slug: string; statut: InvoiceStatus; libelle: string }>;

type Slug = (typeof ONGLETS)[number]["slug"];

/** Onglet ouvert par défaut : le travail en cours, pas le registre. */
const ONGLET_PAR_DEFAUT: Slug = "brouillons";

function ongletDe(valeur: string | string[] | undefined) {
  const slug = Array.isArray(valeur) ? valeur[0] : valeur;
  return ONGLETS.find((onglet) => onglet.slug === slug) ?? ONGLETS[0];
}

export default async function InvoicesPage(props: PageProps<"/app/factures">) {
  const { statut } = await props.searchParams;
  const onglet = ongletDe(statut);

  const { garage, access } = await requireGarage();
  const [invoices, compteurs] = await Promise.all([
    listInvoices(onglet.statut),
    countInvoicesByStatus(),
  ]);

  const brouillons = onglet.statut === "draft";

  return (
    <div className="space-y-8">
      <PageHeader
        title="Mes factures"
        description={
          brouillons
            ? "Vos brouillons en cours. Ils ne consomment ni numéro ni facture d'essai tant qu'ils ne sont pas émis."
            : "Vos factures émises, dans l'ordre de la série légale. Elles ne sont ni modifiables ni supprimables."
        }
        action={
          <Button asChild disabled={!access.canWrite}>
            <Link href="/app/factures/nouveau">
              <FilePlus2 aria-hidden />
              Nouvelle facture
            </Link>
          </Button>
        }
      />

      <AccessBanner garage={garage} access={access} />

      <nav aria-label="Filtrer par statut" className="flex flex-wrap gap-1 border-b">
        {ONGLETS.map((item) => {
          // L'onglet « Annulées » ne s'affiche que s'il contient quelque
          // chose : l'annulation par avoir n'existe pas encore, et un onglet
          // toujours vide n'apprend rien.
          if (item.statut === "cancelled" && compteurs.cancelled === 0) return null;

          const actif = item.slug === onglet.slug;
          return (
            <Link
              key={item.slug}
              href={
                item.slug === ONGLET_PAR_DEFAUT
                  ? "/app/factures"
                  : `/app/factures?statut=${item.slug}`
              }
              aria-current={actif ? "page" : undefined}
              className={cn(
                "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                actif
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {item.libelle}
              <Badge variant="secondary" className="tabular-nums">
                {compteurs[item.statut]}
              </Badge>
            </Link>
          );
        })}
      </nav>

      {invoices.length === 0 ? (
        <EmptyStatePourOnglet slug={onglet.slug} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                {brouillons ? null : <TableHead>Numéro</TableHead>}
                <TableHead>Client</TableHead>
                <TableHead>Émission</TableHead>
                <TableHead className="text-right">Lignes</TableHead>
                <TableHead className="text-right">Total TTC</TableHead>
                {brouillons ? <TableHead>Modifié</TableHead> : null}
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  {brouillons ? null : (
                    <TableCell className="font-medium tabular-nums whitespace-nowrap">
                      {invoice.number}
                    </TableCell>
                  )}
                  <TableCell>
                    <Link
                      href={`/app/factures/${invoice.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {invoice.clientName ?? "Client non renseigné"}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateShort(invoice.issueDate)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {invoice.lineCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatAmount(invoice.totalTtc)}
                  </TableCell>
                  {brouillons ? (
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDateShort(invoice.updatedAt)}
                    </TableCell>
                  ) : null}
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/app/factures/${invoice.id}`}>
                          {brouillons ? "Ouvrir" : "Consulter"}
                        </Link>
                      </Button>
                      {/* Seul un brouillon se supprime. Une facture émise est
                          retenue par `invoices_guard_trg` de toute façon :
                          le bouton absent évite de proposer un refus. */}
                      {brouillons && access.canWrite ? (
                        <DeleteDraftButton
                          invoiceId={invoice.id}
                          label={invoice.clientName ?? "ce brouillon"}
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
    </div>
  );
}

/** États vides : dire ce qui manque, pourquoi, et par où sortir. */
function EmptyStatePourOnglet({ slug }: { slug: Slug }) {
  if (slug === "emises") {
    return (
      <EmptyState
        icon={<FileCheck2 className="size-5" aria-hidden />}
        title="Aucune facture émise"
        description="Une facture apparaît ici une fois émise : elle reçoit alors son numéro définitif et devient un document légal, non modifiable."
        action={
          <Button asChild variant="outline">
            <Link href="/app/factures">Voir mes brouillons</Link>
          </Button>
        }
      />
    );
  }

  if (slug === "annulees") {
    return (
      <EmptyState
        icon={<FileX2 className="size-5" aria-hidden />}
        title="Aucune facture annulée"
        description="Une facture émise ne se supprime pas : elle s'annule par un avoir. Cette fonction n'est pas encore disponible."
      />
    );
  }

  return (
    <EmptyState
      icon={<FileText className="size-5" aria-hidden />}
      title="Aucun brouillon en cours"
      description="Créez une facture : elle se construit sous vos yeux pendant la saisie, et reste modifiable tant qu'elle n'est pas émise."
      action={
        <Button asChild>
          <Link href="/app/factures/nouveau">
            <FilePlus2 aria-hidden />
            Nouvelle facture
          </Link>
        </Button>
      }
    />
  );
}
