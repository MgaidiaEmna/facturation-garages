import type { Metadata } from "next";
import Link from "next/link";
import { FilePlus2, FileText } from "lucide-react";

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
import { listDrafts } from "@/lib/invoice/queries";
import { formatAmount, formatDateShort } from "@/lib/format";
import { DeleteDraftButton } from "./delete-draft-button";

export const metadata: Metadata = {
  title: "Mes factures — Facturation multi-garages",
};

/**
 * Brouillons en cours.
 *
 * Volontairement minimale : la liste complète — factures émises, filtres,
 * recherche, annulation par avoir — arrive en phase 6, avec la numérotation.
 * Ce qu'il fallait ici, c'est pouvoir retrouver un brouillon commencé hier.
 */
export default async function InvoicesPage() {
  const { garage, access } = await requireGarage();
  const drafts = await listDrafts();

  return (
    <div className="space-y-8">
      <PageHeader
        title="Mes factures"
        description="Vos brouillons en cours. Ils ne consomment ni numéro ni facture d'essai tant qu'ils ne sont pas émis."
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

      {drafts.length === 0 ? (
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
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Émission</TableHead>
                <TableHead className="text-right">Lignes</TableHead>
                <TableHead className="text-right">Total TTC</TableHead>
                <TableHead>Modifié</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drafts.map((draft) => (
                <TableRow key={draft.id}>
                  <TableCell>
                    <Link
                      href={`/app/factures/${draft.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {draft.clientName ?? "Client non renseigné"}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateShort(draft.issueDate)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {draft.lineCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatAmount(draft.totalTtc)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateShort(draft.updatedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/app/factures/${draft.id}`}>Ouvrir</Link>
                      </Button>
                      {access.canWrite ? (
                        <DeleteDraftButton
                          invoiceId={draft.id}
                          label={draft.clientName ?? "ce brouillon"}
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
