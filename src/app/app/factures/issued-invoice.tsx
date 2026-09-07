import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InvoicePreview } from "@/components/invoice/invoice-preview";
import { DownloadPdfButton, PrintPdfButton } from "./pdf-buttons";
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
export function IssuedInvoiceView({
  invoice,
  logoUrl,
}: {
  invoice: IssuedInvoice;
  /** URL signée du logo GELÉ à l'émission, jamais celui de la bibliothèque. */
  logoUrl: string | null;
}) {
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

          {/* Deux liens enrichis : l'élément reste un `<a href>`, donc le
              téléchargement fonctionne sans JavaScript. Avec, on montre que
              ça travaille et on transforme un échec en phrase — c'est là
              qu'atterrissait le « Failed to fetch » de la console.

              « Imprimer » sert EXACTEMENT le même document, mais `inline` :
              le lecteur PDF du navigateur s'ouvre et l'impression part de là.
              On ne réinvente pas une mise en page d'impression. */}
          <PrintPdfButton
            href={`/app/factures/${invoice.id}/pdf?impression=1`}
            nomParDefaut={`Facture_${invoice.number}.pdf`}
          />

          <DownloadPdfButton
            href={`/app/factures/${invoice.id}/pdf`}
            nomParDefaut={`Facture_${invoice.number}.pdf`}
          />
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
          logoUrl={logoUrl}
        />
      </div>
    </div>
  );
}
