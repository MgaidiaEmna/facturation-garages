import { formatAmount, formatDate, formatVatRate } from "@/lib/format";
import { getLocale, type LocaleCode } from "@/lib/locale";
import type { DraftLine, InvoiceTotals } from "@/lib/invoice/compute";
import { buildInvoiceDocument, type InvoiceDocument } from "@/lib/invoice/document";
import type { InvoiceParty, InvoiceStatus, SellerIdentity } from "@/lib/invoice/types";

/**
 * Aperçu d'une facture, à l'écran.
 *
 * Volontairement à contre-courant du reste de l'application : fond blanc,
 * bordures fines, pas de bleu marine hors des filets. Ce qu'on regarde ici,
 * ce n'est pas un écran, c'est le document que le client recevra — et une
 * facture se lit sur du papier blanc.
 *
 * ---------------------------------------------------------------------------
 * LE CONTENU VIENT DE `buildInvoiceDocument()`
 * ---------------------------------------------------------------------------
 * Ce composant ne décide plus de ce qui s'imprime : ni l'ordre des lignes
 * d'identité, ni le texte des mentions légales, ni le calcul de l'échéance.
 * Tout cela vient du modèle, que le PDF consomme aussi — sans quoi l'écran et
 * le papier finiraient par dire deux choses différentes. Ce composant décide
 * de la MISE EN PAGE, rien d'autre.
 *
 * ---------------------------------------------------------------------------
 * LES MONTANTS AFFICHÉS SONT INDICATIFS (sur un brouillon)
 * ---------------------------------------------------------------------------
 * Ils viennent de `computeTotals()`, en JavaScript, pour suivre la frappe.
 * Ceux qui comptent sont recalculés en `numeric` exact par
 * `finalize_invoice()` à l'émission ; l'algorithme est le même des deux côtés,
 * et en cas d'écart c'est le serveur qui a raison. Une facture ÉMISE, elle,
 * reçoit ses totaux figés en propriété et ne recalcule rien.
 */

export function InvoicePreview({
  seller,
  client,
  lines,
  issueDate,
  serviceDate,
  notes,
  localeCode,
  status = "draft",
  number = null,
  dueDate = null,
  totals,
}: {
  seller: SellerIdentity;
  client: InvoiceParty;
  lines: DraftLine[];
  issueDate: string;
  serviceDate: string;
  notes: string;
  localeCode?: LocaleCode;
  /** `draft` par défaut : c'est l'usage de l'éditeur temps réel. */
  status?: InvoiceStatus;
  /** Numéro attribué à l'émission. `null` sur un brouillon — il n'en a pas. */
  number?: string | null;
  /** Échéance gelée à l'émission. `null` : on la déduit du délai de règlement. */
  dueDate?: string | null;
  /** Totaux écrits par la base, pour une facture émise. */
  totals?: InvoiceTotals;
}) {
  const document = buildInvoiceDocument({
    seller,
    client,
    lines,
    issueDate,
    serviceDate,
    notes,
    localeCode,
    status,
    number,
    dueDate,
    totals,
  });

  return <InvoiceDocumentView document={document} />;
}

/** Rendu HTML d'un document déjà assemblé. */
function InvoiceDocumentView({ document }: { document: InvoiceDocument }) {
  const { localeCode, seller, client, dates, lines, totals, legalMentions } = document;
  const locale = getLocale(localeCode);
  const colonnes = seller.vatExempt ? 5 : 6;

  return (
    <article className="mx-auto w-full max-w-[210mm] bg-white p-8 text-[13px] leading-relaxed text-zinc-900 shadow-sm ring-1 ring-zinc-200 sm:p-10">
      {/* ---------- En-tête : vendeur ---------- */}
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-zinc-300 pb-6">
        <div className="space-y-1">
          {/* La bibliothèque de logos arrive en phase 9 : d'ici là, le nom
              du garage tient le haut de la facture. */}
          <p className="text-lg font-semibold text-zinc-900">{seller.name}</p>

          {seller.identityLines.length === 0 ? (
            <p className="text-[12px] text-zinc-400">
              Identité légale incomplète — l&apos;administrateur la renseigne sur votre
              fiche.
            </p>
          ) : (
            <div className="space-y-0.5 text-[12px] text-zinc-600">
              {seller.identityLines.map((ligne) => (
                <p key={ligne} className="whitespace-pre-line">
                  {ligne}
                </p>
              ))}
            </div>
          )}
        </div>

        <div className="text-right">
          <p className="text-2xl font-semibold tracking-tight text-zinc-900">FACTURE</p>
          {/* Une facture émise ne porte aucune mention d'état : c'est le
              document tel qu'il part chez le client. Seuls le brouillon et
              l'avoir annoncent ce qu'ils sont. */}
          {document.status === "draft" ? (
            <p className="mt-1 inline-block rounded border border-zinc-300 px-2 py-0.5 text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
              Brouillon — non émis
            </p>
          ) : null}
          {document.status === "cancelled" ? (
            <p className="mt-1 inline-block rounded border border-zinc-400 px-2 py-0.5 text-[11px] font-medium tracking-wide text-zinc-700 uppercase">
              Annulée
            </p>
          ) : null}
          <dl className="mt-3 space-y-0.5 text-[12px] text-zinc-600">
            <div className="flex justify-end gap-2">
              <dt>Date d&apos;émission :</dt>
              <dd className="font-medium text-zinc-900">
                {dates.issue ? formatDate(dates.issue, localeCode) : "—"}
              </dd>
            </div>
            {dates.service ? (
              <div className="flex justify-end gap-2">
                <dt>Date de prestation :</dt>
                <dd className="font-medium text-zinc-900">
                  {formatDate(dates.service, localeCode)}
                </dd>
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <dt>Numéro :</dt>
              {document.number ? (
                <dd className="font-medium tabular-nums text-zinc-900">
                  {document.number}
                </dd>
              ) : (
                <dd className="text-zinc-400">attribué à l&apos;émission</dd>
              )}
            </div>
          </dl>
        </div>
      </header>

      {/* ---------- Client ---------- */}
      <section className="mt-6 flex justify-end">
        <div className="w-full max-w-[58%] space-y-0.5">
          <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
            Facturé à
          </p>
          <p className="font-medium text-zinc-900">
            {client.name ?? <span className="text-zinc-400">Nom du client</span>}
          </p>
          {client.address ? (
            <p className="whitespace-pre-line text-zinc-700">{client.address}</p>
          ) : null}
          {client.phone ? <p className="text-zinc-700">{client.phone}</p> : null}
          {client.vatNumber ? (
            <p className="text-zinc-700">N° TVA / SIRET : {client.vatNumber}</p>
          ) : null}
        </div>
      </section>

      {/* ---------- Prestations ---------- */}
      <section className="mt-8">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-y border-zinc-300 text-left text-[11px] tracking-wide text-zinc-500 uppercase">
              <th className="py-2 pe-2 font-medium">Désignation</th>
              <th className="w-16 py-2 px-2 text-right font-medium">Qté</th>
              <th className="w-14 py-2 px-2 font-medium">Unité</th>
              <th className="w-24 py-2 px-2 text-right font-medium">P.U. HT</th>
              {seller.vatExempt ? null : (
                <th className="w-16 py-2 px-2 text-right font-medium">TVA</th>
              )}
              <th className="w-28 py-2 ps-2 text-right font-medium">Total HT</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={colonnes} className="py-8 text-center text-zinc-400">
                  Ajoutez une prestation pour la voir apparaître ici.
                </td>
              </tr>
            ) : (
              lines.map((line) => (
                <tr key={line.key} className="border-b border-zinc-200 align-top">
                  <td className="py-2 pe-2 text-zinc-900">{line.description}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-zinc-700">
                    {line.quantity}
                  </td>
                  <td className="py-2 px-2 text-zinc-700">{line.unit}</td>
                  <td className="py-2 px-2 text-right tabular-nums text-zinc-700">
                    {formatAmount(line.unitPriceHt, localeCode)}
                  </td>
                  {seller.vatExempt ? null : (
                    <td className="py-2 px-2 text-right tabular-nums text-zinc-700">
                      {formatVatRate(line.vatRate, localeCode)}
                    </td>
                  )}
                  <td className="py-2 ps-2 text-right font-medium tabular-nums text-zinc-900">
                    {formatAmount(line.lineTotalHt, localeCode)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {/* ---------- Totaux ---------- */}
      <section className="mt-6 flex justify-end">
        <dl className="w-full max-w-xs space-y-1 text-[12.5px]">
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-600">Total HT</dt>
            <dd className="tabular-nums text-zinc-900">
              {formatAmount(totals.subtotalHt, localeCode)}
            </dd>
          </div>

          {seller.vatExempt ? null : (
            <>
              {totals.breakdown.map((bucket) => (
                <div key={bucket.rate} className="flex justify-between gap-4">
                  <dt className="text-zinc-600">
                    TVA {formatVatRate(bucket.rate, localeCode)} sur{" "}
                    {formatAmount(bucket.baseHt, localeCode)}
                  </dt>
                  <dd className="tabular-nums text-zinc-900">
                    {formatAmount(bucket.vatAmount, localeCode)}
                  </dd>
                </div>
              ))}
              <div className="flex justify-between gap-4">
                <dt className="text-zinc-600">Total TVA</dt>
                <dd className="tabular-nums text-zinc-900">
                  {formatAmount(totals.vatTotal, localeCode)}
                </dd>
              </div>
            </>
          )}

          {/* `hasStampDuty` est faux en France : le timbre n'apparaît pas.
              La condition existe pour les locales qui en ont un. */}
          {locale.hasStampDuty ? (
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-600">Timbre fiscal</dt>
              <dd className="tabular-nums text-zinc-900">
                {formatAmount(totals.stampDuty, localeCode)}
              </dd>
            </div>
          ) : null}

          <div className="mt-1 flex justify-between gap-4 border-t border-zinc-300 pt-2 text-[15px] font-semibold">
            <dt className="text-zinc-900">Total TTC</dt>
            <dd className="tabular-nums text-zinc-900">
              {formatAmount(totals.totalTtc, localeCode)}
            </dd>
          </div>
        </dl>
      </section>

      {document.notes ? (
        <section className="mt-6 border-t border-zinc-200 pt-4">
          <p className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
            Note
          </p>
          <p className="mt-1 whitespace-pre-line text-zinc-700">{document.notes}</p>
        </section>
      ) : null}

      {/* ---------- Mentions légales ---------- */}
      <footer className="mt-8 space-y-1.5 border-t border-zinc-300 pt-4 text-[11px] leading-relaxed text-zinc-600">
        {legalMentions.vatExempt ? (
          <p className="font-medium text-zinc-800">{legalMentions.vatExempt}</p>
        ) : null}
        <p>{legalMentions.paymentTerms}</p>
        <p>{legalMentions.latePayment}</p>
        <p>{legalMentions.recoveryIndemnity}</p>
        {legalMentions.bankDetails ? <p>{legalMentions.bankDetails}</p> : null}
      </footer>
    </article>
  );
}
