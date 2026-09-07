import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { requireGarage } from "@/lib/auth/session";
import { getInvoice, getSellerIdentity } from "@/lib/invoice/queries";
import { DEFAULT_LOCALE, type LocaleCode } from "@/lib/locale";
import { todayInLocale } from "@/lib/format";
import { InvoiceEditor } from "../invoice-editor";
import { IssuedInvoiceView } from "../issued-invoice";
import { readOnlyReason } from "../read-only";

export const metadata: Metadata = {
  title: "Facture — Facturation multi-garages",
};

/** Un identifiant malformé est une page inexistante, pas une erreur 500. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Une facture : brouillon à reprendre, ou document émis à relire.
 *
 * L'aiguillage se fait sur le statut lu en base, jamais sur l'URL. Une
 * facture émise ne peut donc pas être ramenée dans l'éditeur en tapant son
 * identifiant à la main — et si elle l'était, `invoices_guard_trg` refuserait
 * l'écriture. Deux barrières, dont une seule est visible.
 */
export default async function InvoicePage(props: PageProps<"/app/factures/[id]">) {
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();

  const { garage, access } = await requireGarage();

  const [seller, view] = await Promise.all([getSellerIdentity(), getInvoice(id)]);
  if (!seller) redirect("/app");

  // `null` couvre « n'existe pas » et « appartient à un autre garage » (le RLS
  // a filtré). Les deux donnent la même page : distinguer renseignerait sur
  // les factures d'autrui.
  if (!view) notFound();

  if (view.status !== "draft") {
    return <IssuedInvoiceView invoice={view.issued} />;
  }

  const locale = (garage.locale as LocaleCode) || DEFAULT_LOCALE;

  return (
    <InvoiceEditor
      seller={seller}
      draft={view.draft}
      localeCode={locale}
      today={todayInLocale(locale)}
      canWrite={access.canWrite}
      readOnlyReason={readOnlyReason(garage, access)}
      finalizeBlockMessage={access.finalizeBlockMessage}
    />
  );
}
