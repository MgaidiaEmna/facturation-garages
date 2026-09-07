import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireGarage } from "@/lib/auth/session";
import { getSellerIdentity } from "@/lib/invoice/queries";
import { DEFAULT_LOCALE, type LocaleCode } from "@/lib/locale";
import { todayInLocale } from "@/lib/format";
import { InvoiceEditor } from "../invoice-editor";
import { readOnlyReason } from "../read-only";

export const metadata: Metadata = {
  title: "Nouvelle facture — Facturation multi-garages",
};

export default async function NewInvoicePage() {
  const { garage, access } = await requireGarage();

  const seller = await getSellerIdentity();
  // La fiche du garage est créée en même temps que le compte : son absence
  // signalerait une base incohérente, pas un cas à gérer dans l'écran.
  if (!seller) redirect("/app");

  const locale = (garage.locale as LocaleCode) || DEFAULT_LOCALE;

  return (
    <InvoiceEditor
      seller={seller}
      draft={null}
      localeCode={locale}
      today={todayInLocale(locale)}
      canWrite={access.canWrite}
      readOnlyReason={readOnlyReason(garage, access)}
      finalizeBlockMessage={access.finalizeBlockMessage}
    />
  );
}
