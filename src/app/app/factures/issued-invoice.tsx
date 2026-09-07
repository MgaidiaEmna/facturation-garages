import Link from "next/link";
import { ArrowLeft, Download, Lock, Printer } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InvoicePreview } from "@/components/invoice/invoice-preview";
import { formatAmount, formatDate, formatDateTime } from "@/lib/format";
import type { IssuedInvoice } from "@/lib/invoice/types";
import { DEFAULT_LOCALE, type LocaleCode } from "@/lib/locale";

/**
 * Une facture émise, en lecture seule.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CE N'EST PAS L'ÉDITEUR EN MODE DÉSACTIVÉ
 * ---------------------------------------------------------------------------
 * Un éditeur grisé laisse croire qu'il existe un moyen de le dégriser. Une
 * facture émise n'est pas « verrouillée » : elle est finie. Elle porte un
 * numéro de la série légale, elle est peut-être déjà chez le client, et
 * `invoices_guard_trg` refusera toute modification quel que soit le chemin
 * d'écriture. L'écran doit dire cela, pas simuler une saisie impossible.
 *
 * Tout ce qui s'affiche ici est FIGÉ : totaux écrits par `finalize_invoice()`
 * en `numeric` exact, mentions du vendeur lues dans `seller_snapshot`, délai
 * et pénalités recopiés au jour de l'émission. Rien n'est recalculé — ce
 * serait risquer d'afficher autre chose que ce que le client a reçu.
 */
export function IssuedInvoiceView({ invoice }: { invoice: IssuedInvoice }) {
  const localeCode = (invoice.locale as LocaleCode) || DEFAULT_LOCALE;
  const annulee = invoice.status === "cancelled";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Button asChild variant="ghost" size="sm" className="-ms-3">
          <Link href="/app/factures?statut=emises">
            <ArrowLeft aria-hidden />
            Mes factures
          </Link>
        </Button>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">
            Total TTC{" "}
            <span className="font-semibold text-foreground tabular-nums">
              {formatAmount(invoice.totals.totalTtc, localeCode)}
            </span>
          </span>

          {/* Deux liens, aucun JavaScript : le PDF est produit par un Route
              Handler, donc les deux actions fonctionnent même si le script n'a
              pas chargé.

              « Imprimer » sert EXACTEMENT le même document, mais `inline` : le
              lecteur PDF du navigateur s'ouvre et l'impression part de là. On
              ne réinvente pas une mise en page d'impression — il n'y aurait
              plus un document de référence, mais deux à garder d'accord. */}
          <Button asChild variant="outline">
            <a
              href={`/app/factures/${invoice.id}/pdf?impression=1`}
              target="_blank"
              rel="noreferrer"
              title="Ouvre la facture dans un nouvel onglet, prête à imprimer."
            >
              <Printer aria-hidden />
              Imprimer
            </a>
          </Button>

          <Button asChild>
            <a href={`/app/factures/${invoice.id}/pdf`}>
              <Download aria-hidden />
              Télécharger le PDF
            </a>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border bg-card p-4 shadow-sm">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold tabular-nums">
              Facture {invoice.number}
            </h1>
            {annulee ? (
              <Badge variant="destructive">Annulée</Badge>
            ) : (
              <Badge variant="outline">Émise</Badge>
            )}
          </div>

          <p className="text-sm text-muted-foreground">
            Émise le {formatDate(invoice.issueDate)}
            {invoice.finalizedAt ? (
              <> — enregistrée le {formatDateTime(invoice.finalizedAt)}</>
            ) : null}
            {invoice.dueDate ? <> · échéance au {formatDate(invoice.dueDate)}</> : null}
            {annulee && invoice.cancelledAt ? (
              <> · annulée le {formatDate(invoice.cancelledAt)}</>
            ) : null}
          </p>
        </div>

        <div className="flex max-w-md items-start gap-2 text-sm text-muted-foreground">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            Cette facture porte un numéro de votre série légale : elle n&apos;est ni
            modifiable ni supprimable. Une erreur se corrige par un avoir.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl bg-muted/60 p-3">
        <InvoicePreview
          seller={invoice.seller}
          client={invoice.client}
          lines={invoice.lines}
          issueDate={invoice.issueDate}
          serviceDate={invoice.serviceDate}
          notes={invoice.notes}
          localeCode={localeCode}
          status={invoice.status}
          number={invoice.number}
          dueDate={invoice.dueDate}
          totals={invoice.totals}
        />
      </div>
    </div>
  );
}
