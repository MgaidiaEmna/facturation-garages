import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { requireGarage } from "@/lib/auth/session";
import { getDraft, getSellerIdentity } from "@/lib/invoice/queries";
import { DEFAULT_LOCALE, type LocaleCode } from "@/lib/locale";
import { InvoiceEditor } from "../invoice-editor";
import { readOnlyReason } from "../read-only";

export const metadata: Metadata = {
  title: "Brouillon — Facturation multi-garages",
};

/** Un identifiant malformé est une page inexistante, pas une erreur 500. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditDraftPage(props: PageProps<"/app/factures/[id]">) {
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();

  const { garage, access } = await requireGarage();

  const [seller, draft] = await Promise.all([getSellerIdentity(), getDraft(id)]);
  if (!seller) redirect("/app");

  // `null` couvre « n'existe pas », « appartient à un autre garage » (le RLS a
  // filtré) et « n'est plus un brouillon ». Les trois donnent la même page :
  // distinguer renseignerait sur les factures d'autrui.
  if (!draft) notFound();

  return (
    <InvoiceEditor
      seller={seller}
      draft={draft}
      localeCode={(garage.locale as LocaleCode) || DEFAULT_LOCALE}
      canWrite={access.canWrite}
      readOnlyReason={readOnlyReason(garage, access)}
    />
  );
}
