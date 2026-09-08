import { requireGarage } from "@/lib/auth/session";
import { buildInvoiceDocument } from "@/lib/invoice/document";
import { contentDisposition, nomFichierFacture } from "@/lib/invoice/pdf-filename";
import { getInvoice, getSellerIdentity } from "@/lib/invoice/queries";
import { cheminLogo, logoEnDataUri } from "@/lib/logos/queries";
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
 *
 * ---------------------------------------------------------------------------
 * LE MOTEUR PDF EST CHARGÉ À LA DEMANDE, PAS AU CHARGEMENT DU MODULE
 * ---------------------------------------------------------------------------
 * `@react-pdf/renderer` et `InvoicePdf` sont importés DANS le gestionnaire,
 * jamais en tête de fichier. Ce n'est pas une coquetterie de performance :
 * c'est ce qui rend le build possible sur une machine à mémoire contrainte.
 *
 * Pendant l'étape « Collecting page data », Next ÉVALUE le module de chaque
 * route pour lire ses exports de configuration (`runtime`, `dynamic`) — donc
 * exécute ses imports de tête. Or ce moteur tire fontkit, yoga-layout (WASM)
 * et pdfkit : +23 Mo de tas et +49 Mo de RSS, mesurés au seul import. Quand
 * le constructeur n'alloue qu'UN worker, tous les modules de routes
 * s'accumulent dans le même processus, et il est tué sans message — le build
 * s'arrête net sur « Collecting page data », sans la moindre ligne `Error:`.
 *
 * La route étant `force-dynamic`, rien n'est pré-rendu : ce module n'a aucune
 * raison d'être chargé ailleurs qu'au moment de servir un PDF. Ne pas
 * remonter ces deux imports en tête de fichier, même si l'outillage le
 * propose.
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

/**
 * L'échec du RENDU, dit en français et sans détail technique.
 *
 * Le rendu d'un PDF peut échouer là où rien d'autre n'échoue : une image de
 * logo tronquée ou dans un format que `@react-pdf/renderer` ne décode pas
 * suffit à faire lever `renderToBuffer`. Sans garde, Next répond une page
 * d'erreur brute — et comme la requête attend un `application/pdf`, le
 * navigateur affiche au mieux du charabia, au pire rien.
 *
 * On répond donc un 500 en TEXTE, qui dit quoi faire. Le détail de
 * l'exception reste dans les journaux du serveur : sur une application
 * multi-locataires, un message d'erreur brut nomme volontiers une table ou
 * une valeur.
 */
const renduImpossible = () =>
  new Response(
    "Le PDF de cette facture n'a pas pu être produit.\n\n" +
      "Si le garage a un logo, il est la cause la plus probable : seuls les " +
      "formats PNG et JPEG sont lisibles par le générateur. Remplacez-le " +
      "depuis la bibliothèque de logos, puis réessayez.\n",
    { status: 500, headers: { "content-type": "text/plain; charset=utf-8" } },
  );

export async function GET(
  request: Request,
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
      : await documentEmis(view.issued, localeCode);

  if (!document) return introuvable();

  // Chargement du moteur PDF — voir l'en-tête du fichier. Volontairement HORS
  // du `try` : un import qui échoue est un défaut de déploiement, pas un logo
  // illisible, et `renduImpossible()` dirait alors une contrevérité.
  const [{ renderToBuffer }, { InvoicePdf }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("@/components/invoice/invoice-pdf"),
  ]);

  // Le seul endroit de cette route qui puisse lever pour une raison qui n'est
  // ni une absence ni un refus : la fabrication du document elle-même.
  let buffer: Buffer;
  try {
    buffer = await renderToBuffer(<InvoicePdf document={document} />);
  } catch (error) {
    console.error(`[pdf] rendu impossible pour la facture ${id} :`, error);
    return renduImpossible();
  }

  const nom = nomFichierFacture(document.number, document.client.name);

  // `?impression=1` sert le MÊME document, mais à l'écran plutôt qu'au
  // téléchargement : le lecteur PDF du navigateur s'ouvre, et l'impression
  // part de là. C'est le bouton « Imprimer ». On ne réinvente pas une mise en
  // page d'impression — il n'y aurait plus un document de référence, mais deux
  // à garder d'accord.
  const pourImpression = new URL(request.url).searchParams.get("impression") === "1";

  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      // Une facture émise s'archive : on la télécharge. Un brouillon se
      // regarde : il s'ouvre dans le lecteur du navigateur.
      "content-disposition": contentDisposition(
        nom,
        pourImpression || view.status === "draft" ? "inline" : "attachment",
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

  // Le logo choisi pour cette facture, ou à défaut celui du garage — la même
  // règle que `finalize_invoice()` applique au moment de geler.
  const chemin = (await cheminLogo(draft.logoId)) ?? seller.logoPath;

  return buildInvoiceDocument({
    seller,
    logoUrl: await logoEnDataUri(chemin),
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
async function documentEmis(issued: IssuedInvoice, localeParDefaut: LocaleCode) {
  return buildInvoiceDocument({
    seller: issued.seller,
    // Le chemin GELÉ dans `seller_snapshot` : on ne consulte jamais `logos`,
    // donc la facture d'hier garde le logo d'hier.
    logoUrl: await logoEnDataUri(issued.seller.logoPath),
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
