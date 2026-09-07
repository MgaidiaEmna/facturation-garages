import { renderToBuffer } from "@react-pdf/renderer";

import { InvoicePdf } from "@/components/invoice/invoice-pdf";
import { requireGarage } from "@/lib/auth/session";
import { buildInvoiceDocument } from "@/lib/invoice/document";
import { contentDisposition, nomFichierFacture } from "@/lib/invoice/pdf-filename";
import { getInvoice, getSellerIdentity } from "@/lib/invoice/queries";
import type { InvoiceDraft, IssuedInvoice } from "@/lib/invoice/types";
import { DEFAULT_LOCALE, type LocaleCode } from "@/lib/locale";

/**
 * Le PDF d'une facture.
 *
 * ---------------------------------------------------------------------------
 * UN ROUTE HANDLER REFAIT SA PROPRE CHAÎNE DE VÉRIFICATION
 * ---------------------------------------------------------------------------
 * Les layouts ne s'appliquent PAS aux Route Handlers : la garde de
 * `/app/layout.tsx` ne protège pas cette route. `requireGarage()` est donc
 * appelée ici, explicitement — session, adresse vérifiée, profil rattaché,
 * mot de passe changé, rôle. Sans elle, l'URL du PDF serait une porte de
 * service ouverte sur les factures.
 *
 * L'appartenance, elle, n'est pas vérifiée à la main : `getInvoice()` lit sous
 * RLS, donc la facture d'un autre garage n'existe pas — et la réponse est un
 * 404, la même que pour une facture inexistante. Distinguer les deux
 * renseignerait sur les factures d'autrui.
 *
 * ---------------------------------------------------------------------------
 * RENDU CÔTÉ SERVEUR, ET RIEN N'EST RECALCULÉ
 * ---------------------------------------------------------------------------
 * Le document doit être identique quel que soit le poste : c'est lui qui part
 * chez le client. Pour une facture ÉMISE, les totaux et l'identité du vendeur
 * viennent de ce que `finalize_invoice()` a figé (`seller_snapshot`), jamais
 * d'un recalcul ni de la fiche actuelle du garage. Pour un brouillon, les
 * totaux sont indicatifs — et la page porte un filigrane qui le dit.
 */

// `@react-pdf/renderer` est une bibliothèque Node : pas d'exécution Edge.
export const runtime = "nodejs";
// Une facture se lit à la demande, et son contenu dépend de la session.
export const dynamic = "force-dynamic";

/** Un identifiant malformé est une ressource inexistante, pas une erreur 500. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const introuvable = () =>
  new Response("Facture introuvable.", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });

export async function GET(
  _request: Request,
  context: RouteContext<"/app/factures/[id]/pdf">,
) {
  const { id } = await context.params;
  if (!UUID.test(id)) return introuvable();

  // Redirige vers /login si la session manque : `requireGarage()` lève le
  // `NEXT_REDIRECT` que Next transforme en réponse.
  const { garage } = await requireGarage();

  const view = await getInvoice(id);
  if (!view) return introuvable();

  const localeCode = (garage.locale as LocaleCode) || DEFAULT_LOCALE;

  const document =
    view.status === "draft"
      ? await documentDeBrouillon(view.draft, localeCode)
      : documentEmis(view.issued, localeCode);

  if (!document) return introuvable();

  const buffer = await renderToBuffer(<InvoicePdf document={document} />);
  const nom = nomFichierFacture(document.number, document.client.name);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      // Une facture émise s'archive : on la télécharge. Un brouillon se
      // regarde : il s'ouvre dans le lecteur du navigateur.
      "content-disposition": contentDisposition(
        nom,
        view.status === "draft" ? "inline" : "attachment",
      ),
      "content-length": String(buffer.length),
      // Le document dépend de la session et peut changer à chaque
      // enregistrement : aucun cache partagé.
      "cache-control": "private, no-store",
    },
  });
}

/** Brouillon : l'identité du vendeur est celle de la fiche, aujourd'hui. */
async function documentDeBrouillon(draft: InvoiceDraft, localeCode: LocaleCode) {
  const seller = await getSellerIdentity();
  if (!seller) return null;

  return buildInvoiceDocument({
    seller,
    client: {
      name: draft.clientName,
      address: draft.clientAddress,
      phone: draft.clientPhone,
      vatNumber: draft.clientVatNumber,
    },
    lines: draft.lines,
    issueDate: draft.issueDate,
    serviceDate: draft.serviceDate,
    notes: draft.notes,
    localeCode,
    status: "draft",
  });
}

/** Facture émise : tout vient du gel, y compris la locale du jour de l'émission. */
function documentEmis(issued: IssuedInvoice, localeParDefaut: LocaleCode) {
  return buildInvoiceDocument({
    seller: issued.seller,
    client: issued.client,
    lines: issued.lines,
    issueDate: issued.issueDate,
    serviceDate: issued.serviceDate,
    notes: issued.notes,
    localeCode: (issued.locale as LocaleCode) || localeParDefaut,
    status: issued.status,
    number: issued.number,
    dueDate: issued.dueDate,
    // Les totaux de la base, pas un recalcul.
    totals: issued.totals,
  });
}
