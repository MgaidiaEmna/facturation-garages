import { formatAmount, formatDate, formatVatRate } from "@/lib/format";
import { getLocale, type LocaleCode } from "@/lib/locale";
import type { DraftLine, InvoiceTotals } from "@/lib/invoice/compute";
import { buildInvoiceDocument, type InvoiceDocument } from "@/lib/invoice/document";
import { invoiceTheme as C } from "@/lib/invoice/theme";
import type { InvoiceParty, InvoiceStatus, SellerIdentity } from "@/lib/invoice/types";

/**
 * Aperçu d'une facture, à l'écran.
 *
 * Volontairement à contre-courant du reste de l'application : fond blanc,
 * cartouches arrondies, accent orange. Ce qu'on regarde ici, ce n'est pas un
 * écran, c'est le document que le client recevra — et une facture se lit sur
 * du papier blanc, loin du bandeau marine de l'interface.
 *
 * ---------------------------------------------------------------------------
 * LE CONTENU VIENT DE `buildInvoiceDocument()`, LA COULEUR DE `invoiceTheme`
 * ---------------------------------------------------------------------------
 * Ce composant ne décide plus de ce qui s'imprime : ni l'ordre des lignes
 * d'identité, ni le texte des mentions légales, ni le calcul de l'échéance.
 * Tout cela vient du modèle, que le PDF consomme aussi — sans quoi l'écran et
 * le papier finiraient par dire deux choses différentes. Ce composant décide
 * de la MISE EN PAGE, rien d'autre.
 *
 * Les COULEURS sont dans le même cas. Elles ne sont pas écrites ici : elles
 * sont importées de `lib/invoice/theme.ts`, que le PDF importe aussi. Un
 * `StyleSheet` de `@react-pdf/renderer` ne sait pas lire une variable CSS ;
 * poser la palette dans un module TypeScript pur est donc la seule façon
 * d'être certain que les deux rendus emploient le même orange. C'est aussi
 * pourquoi la couleur passe ici par `style={{ … }}` et non par une classe
 * Tailwind : la classe serait invisible du côté PDF, et les deux
 * divergeraient à la première retouche. Tailwind garde tout le reste — la
 * grille, les espacements, le responsive.
 *
 * Les jetons `--brand` de `globals.css` ne sont PAS concernés : l'interface
 * reste bleu marine, seul le document est orange.
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
  logoUrl = null,
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
  /** URL signée du logo. `null` : l'en-tête reste le nom en texte. */
  logoUrl?: string | null;
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
    logoUrl,
  });

  return <InvoiceDocumentView document={document} />;
}

/** Rendu HTML d'un document déjà assemblé. */
function InvoiceDocumentView({ document }: { document: InvoiceDocument }) {
  const { localeCode, seller, client, dates, lines, totals, legalMentions } = document;
  const locale = getLocale(localeCode);
  const colonnes = seller.vatExempt ? 5 : 6;
  // Une fiche vide ne doit pas produire deux colonnes vides : on le dit.
  const identiteComplete =
    seller.footerIdentityLines.length > 0 || seller.footerLegalLines.length > 0;

  /** Le surtitre des cartouches et des colonnes : petit, donc en accent foncé. */
  const surtitre = {
    color: C.accentTexte,
    letterSpacing: "0.08em",
  } as const;

  return (
    /* La feuille : hauteur A4 minimale et colonne flex, pour que le pied de
       page se colle au bas comme dans le PDF. `min-h` et non `h` : une facture
       longue s'étire au lieu de déborder. */
    <article
      className="mx-auto flex w-full max-w-[210mm] flex-col p-8 text-[13px] leading-relaxed shadow-sm ring-1 ring-zinc-200 sm:min-h-[297mm] sm:p-10"
      style={{ backgroundColor: C.papier, color: C.encre }}
    >
      {/* ---------- En-tête : l'objet à gauche, l'émetteur à droite ---------- */}
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="text-[31px] leading-none font-semibold" style={{ color: C.accent }}>
            Facture
          </p>
          {document.number ? (
            <p className="mt-1.5 text-[17px] font-semibold tracking-wide tabular-nums">
              {document.number}
            </p>
          ) : (
            <p className="mt-1.5 text-[12px]" style={{ color: C.discret }}>
              Numéro attribué à l&apos;émission
            </p>
          )}

          {/* Une facture émise ne porte aucune mention d'état : c'est le
              document tel qu'il part chez le client. Seuls le brouillon et
              l'avoir annoncent ce qu'ils sont. */}
          {document.status === "draft" ? (
            <p
              className="mt-2 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase"
              style={{ backgroundColor: C.accentPale, color: C.accentTexte }}
            >
              Brouillon — non émis
            </p>
          ) : null}
          {document.status === "cancelled" ? (
            <p
              className="mt-2 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase"
              style={{ backgroundColor: C.accentPale, color: C.accentTexte }}
            >
              Annulée
            </p>
          ) : null}

          <dl className="mt-3 space-y-0.5 text-[12px]" style={{ color: C.attenue }}>
            <div className="flex gap-2">
              <dt>Date d&apos;émission :</dt>
              <dd className="font-medium" style={{ color: C.encre }}>
                {dates.issue ? formatDate(dates.issue, localeCode) : "—"}
              </dd>
            </div>
            {dates.service ? (
              <div className="flex gap-2">
                <dt>Date de prestation :</dt>
                <dd className="font-medium" style={{ color: C.encre }}>
                  {formatDate(dates.service, localeCode)}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>

        {/* Le logo, en grand, et la dénomination dessous — rien d'autre à
            droite. `<img>` et non un composant d'image optimisée : l'URL est
            signée et expire, elle n'a rien à faire dans un cache partagé. */}
        <div className="flex flex-col items-end text-right">
          {seller.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={seller.logoUrl}
              alt={seller.name}
              className="mb-2 max-h-24 w-auto max-w-[260px] object-contain"
            />
          ) : null}
          <p className="text-lg font-semibold">{seller.name}</p>
        </div>
      </header>

      {/* ---------- Vendeur et client, côte à côte ---------- */}
      {/* Deux cartouches sur la même ligne : qui vend, à qui. Celle du client
          est teintée — c'est elle qu'on cherche des yeux en premier. Sur un
          écran étroit elles se replient l'une sous l'autre ; le PDF, lui, a
          toujours la largeur d'une A4. */}
      <section className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl p-3.5" style={{ backgroundColor: C.surface }}>
          <p className="text-[11px] font-semibold uppercase" style={surtitre}>
            Vendeur
          </p>
          <p className="mt-1 font-semibold">{seller.name}</p>

          {/* L'adresse du siège, et rien d'autre : les mentions légales
              d'identité sont rassemblées en pied de facture. Elles n'ont pas
              disparu — voir le bloc « mentions » plus bas. */}
          {seller.addressLines.length === 0 ? (
            <p className="text-[12px]" style={{ color: C.discret }}>
              Adresse du siège non renseignée — l&apos;administrateur la complète sur
              votre fiche.
            </p>
          ) : (
            seller.addressLines.map((ligne) => (
              <p key={ligne} className="whitespace-pre-line" style={{ color: C.texte }}>
                {ligne}
              </p>
            ))
          )}
        </div>

        <div className="rounded-xl p-3.5" style={{ backgroundColor: C.accentPale }}>
          <p className="text-[11px] font-semibold uppercase" style={surtitre}>
            Facturé à
          </p>
          <p className="mt-1 font-semibold">
            {client.name ?? <span style={{ color: C.discret }}>Nom du client</span>}
          </p>
          {client.address ? (
            <p className="whitespace-pre-line" style={{ color: C.texte }}>
              {client.address}
            </p>
          ) : null}
          {client.phone ? <p style={{ color: C.texte }}>{client.phone}</p> : null}
          {client.vatNumber ? (
            <p style={{ color: C.texte }}>N° TVA / SIRET : {client.vatNumber}</p>
          ) : null}
        </div>
      </section>

      {/* ---------- Prestations ---------- */}
      {/* Aucun filet : ce sont les tuiles alternées qui tiennent les lignes.
          `border-separate` avec un espacement nul permet d'arrondir les coins
          d'une ligne entière, ce qu'un `border-collapse` interdit. */}
      <section className="mt-6">
        <table className="w-full border-separate border-spacing-0 text-[12.5px]">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase" style={surtitre}>
              <th className="px-2 pb-2 font-semibold">Désignation</th>
              <th className="w-16 px-2 pb-2 text-right font-semibold">Qté</th>
              <th className="w-14 px-2 pb-2 font-semibold">Unité</th>
              <th className="w-24 px-2 pb-2 text-right font-semibold">P.U. HT</th>
              {seller.vatExempt ? null : (
                <th className="w-16 px-2 pb-2 text-right font-semibold">TVA</th>
              )}
              <th className="w-28 px-2 pb-2 text-right font-semibold">Total HT</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td
                  colSpan={colonnes}
                  className="py-8 text-center"
                  style={{ color: C.discret }}
                >
                  Ajoutez une prestation pour la voir apparaître ici.
                </td>
              </tr>
            ) : (
              lines.map((line, index) => (
                <tr
                  key={line.key}
                  className="align-top"
                  style={
                    index % 2 === 0 ? { backgroundColor: C.surface } : undefined
                  }
                >
                  <td className="rounded-l-lg px-2 py-2 font-medium">{line.description}</td>
                  <td
                    className="px-2 py-2 text-right tabular-nums"
                    style={{ color: C.texte }}
                  >
                    {line.quantity}
                  </td>
                  <td className="px-2 py-2" style={{ color: C.texte }}>
                    {line.unit}
                  </td>
                  <td
                    className="px-2 py-2 text-right tabular-nums"
                    style={{ color: C.texte }}
                  >
                    {formatAmount(line.unitPriceHt, localeCode)}
                  </td>
                  {seller.vatExempt ? null : (
                    <td
                      className="px-2 py-2 text-right tabular-nums"
                      style={{ color: C.texte }}
                    >
                      {formatVatRate(line.vatRate, localeCode)}
                    </td>
                  )}
                  <td className="rounded-r-lg px-2 py-2 text-right font-semibold tabular-nums">
                    {formatAmount(line.lineTotalHt, localeCode)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {/* ---------- Totaux ---------- */}
      <section className="mt-5 flex justify-end">
        <dl className="w-full max-w-xs space-y-1 text-[12.5px]">
          <div className="flex justify-between gap-4">
            <dt style={{ color: C.attenue }}>Total HT</dt>
            <dd className="tabular-nums">{formatAmount(totals.subtotalHt, localeCode)}</dd>
          </div>

          {seller.vatExempt ? null : (
            <>
              {totals.breakdown.map((bucket) => (
                <div key={bucket.rate} className="flex justify-between gap-4">
                  <dt style={{ color: C.attenue }}>
                    TVA {formatVatRate(bucket.rate, localeCode)} sur{" "}
                    {formatAmount(bucket.baseHt, localeCode)}
                  </dt>
                  <dd className="tabular-nums">
                    {formatAmount(bucket.vatAmount, localeCode)}
                  </dd>
                </div>
              ))}
              <div className="flex justify-between gap-4">
                <dt style={{ color: C.attenue }}>Total TVA</dt>
                <dd className="tabular-nums">{formatAmount(totals.vatTotal, localeCode)}</dd>
              </div>
            </>
          )}

          {/* `hasStampDuty` est faux en France : le timbre n'apparaît pas.
              La condition existe pour les locales qui en ont un. */}
          {locale.hasStampDuty ? (
            <div className="flex justify-between gap-4">
              <dt style={{ color: C.attenue }}>Timbre fiscal</dt>
              <dd className="tabular-nums">{formatAmount(totals.stampDuty, localeCode)}</dd>
            </div>
          ) : null}

          {/* La pastille orange. 19 px semi-gras : au-delà du seuil « grand
              texte » de WCAG, donc le blanc sur l'accent (3,5:1) y est
              conforme. Voir `theme.ts` avant de réduire cette taille. */}
          <div
            className="mt-2.5 flex items-center justify-between gap-4 rounded-full px-5 py-2 text-[19px] font-semibold"
            style={{ backgroundColor: C.accent, color: C.surAccent }}
          >
            <dt>Total TTC</dt>
            <dd className="tabular-nums">{formatAmount(totals.totalTtc, localeCode)}</dd>
          </div>
        </dl>
      </section>

      {document.notes ? (
        <section className="mt-5 rounded-xl p-3.5" style={{ backgroundColor: C.surface }}>
          <p className="text-[11px] font-semibold uppercase" style={surtitre}>
            Note
          </p>
          <p className="mt-1 whitespace-pre-line" style={{ color: C.texte }}>
            {document.notes}
          </p>
        </section>
      ) : null}

      {/* ---------- Mentions légales ---------- */}
      {/* `mt-auto` : dans une colonne flex, la marge automatique absorbe
          l'espace restant et pousse le pied au bas de la feuille. Le grand
          blanc entre le tableau et les mentions est voulu — c'est ce que
          fait le PDF, et les deux doivent se ressembler. */}
      <footer className="mt-auto pt-6">
        {/* Identité légale du vendeur : descendue de l'en-tête, jamais retirée.
            Le Code de commerce l'exige sur la facture, pas en haut de la
            facture. Deux colonnes dans une cartouche — identification à
            gauche, forme sociale et banque à droite. La LISTE, elle, n'a pas
            changé. */}
        <div className="rounded-xl p-3.5 text-[11px]" style={{ backgroundColor: C.surface }}>
          {identiteComplete ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="font-semibold">{seller.name}</p>
                {seller.footerIdentityLines.map((ligne) => (
                  <p key={ligne} className="whitespace-pre-line" style={{ color: C.texte }}>
                    {ligne}
                  </p>
                ))}
              </div>
              <div>
                {seller.footerLegalLines.map((ligne) => (
                  <p key={ligne} style={{ color: C.texte }}>
                    {ligne}
                  </p>
                ))}
              </div>
            </div>
          ) : (
            <p style={{ color: C.discret }}>
              Mentions légales du vendeur incomplètes — l&apos;administrateur les
              renseigne sur votre fiche.
            </p>
          )}
        </div>

        {/* Les mentions de règlement, sous la cartouche et en pleine largeur.
            Allégées — plus petites, en gris — mais toutes présentes : une
            mention que la loi impose et qu'on ne peut pas lire n'est pas une
            mention. C'est `attenue` (4,8:1) et non `discret` (2,5:1). */}
        <div className="mt-2.5 space-y-0.5 px-1 text-[10px] leading-relaxed" style={{ color: C.attenue }}>
          {legalMentions.vatExempt ? (
            <p className="font-semibold" style={{ color: C.accentTexte }}>
              {legalMentions.vatExempt}
            </p>
          ) : null}
          <p>{legalMentions.paymentTerms}</p>
          <p>{legalMentions.latePayment}</p>
          <p>{legalMentions.recoveryIndemnity}</p>
        </div>
      </footer>
    </article>
  );
}
