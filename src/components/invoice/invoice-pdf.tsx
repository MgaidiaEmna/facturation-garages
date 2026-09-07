import "server-only";

import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import { formatAmount, formatDate, formatVatRate } from "@/lib/format";
import { getLocale } from "@/lib/locale";
import type { InvoiceDocument } from "@/lib/invoice/document";
import { invoiceTheme as C } from "@/lib/invoice/theme";

/**
 * La facture, en PDF A4.
 *
 * ---------------------------------------------------------------------------
 * SECOND MOTEUR DE RENDU, MÊME DOCUMENT
 * ---------------------------------------------------------------------------
 * Les primitives de `@react-pdf/renderer` n'ont rien de commun avec le HTML :
 * ce fichier ne peut pas réutiliser `invoice-preview.tsx`. Ce qu'il réutilise,
 * c'est le MODÈLE — `buildInvoiceDocument()` — d'où viennent l'ordre des
 * lignes d'identité, le texte des mentions légales et le calcul de l'échéance ;
 * et la PALETTE — `invoiceTheme` — d'où vient chaque couleur. Seule la mise en
 * page est écrite ici. Une mention ajoutée au modèle apparaît des deux côtés ;
 * une mention ajoutée ici seulement serait un bug.
 *
 * Les montants passent par `formatAmount()`, la même fonction qu'à l'écran :
 * un total imprimé différemment de l'aperçu serait pire qu'un total absent.
 *
 * ---------------------------------------------------------------------------
 * L'ORANGE EST CELUI DU DOCUMENT, PAS CELUI DE L'APPLICATION
 * ---------------------------------------------------------------------------
 * L'interface reste bleu marine. La facture a sa propre identité, parce
 * qu'elle est lue hors de l'application, souvent sur papier, détachée de
 * l'écran qui l'a produite. Les deux palettes vivent dans deux fichiers
 * distincts et ne se mélangent pas — voir `lib/invoice/theme.ts`.
 *
 * ---------------------------------------------------------------------------
 * LE PIÈGE DU `lineHeight` HÉRITÉ
 * ---------------------------------------------------------------------------
 * `@react-pdf/renderer` résout un `lineHeight` sans unité UNE SEULE FOIS,
 * contre la taille de police en vigueur LÀ OÙ IL EST DÉCLARÉ, puis hérite la
 * valeur absolue obtenue. Déclaré sur la `Page` (9,5 pt × 1,4), il descend
 * donc en 13,3 pt FIXES sur tous les enfants — y compris sur un titre à
 * 27 pt, dont la boîte de ligne se retrouve trois fois trop courte tandis que
 * sa ligne de base reste posée avec son ascendante réelle. Le bloc suivant
 * remonte alors DANS le titre.
 *
 * CSS ne se comporte pas ainsi : un `line-height` sans unité y est un
 * multiplicateur, réévalué par élément. L'aperçu à l'écran était donc juste
 * pendant que le PDF se chevauchait — un cas d'école de divergence entre les
 * deux rendus, invisible tant qu'on ne mesure pas la géométrie.
 *
 * RÈGLE : tout texte dont la taille s'écarte du corps de la page porte son
 * PROPRE `lineHeight`, déclaré à côté de son `fontSize`. `verify:pdf` mesure
 * l'écart entre le titre et le numéro pour que ça ne puisse pas revenir.
 *
 * ---------------------------------------------------------------------------
 * LE PIÈGE DES ESPACES FINES
 * ---------------------------------------------------------------------------
 * `Intl.NumberFormat('fr-FR')` sépare les milliers par une ESPACE FINE
 * INSÉCABLE (U+202F) et en pose une avant le « € ». Ce caractère n'existe pas
 * dans l'encodage WinAnsi des polices standard du PDF : Helvetica l'imprime
 * comme un caractère manquant, et « 1 234,56 € » sort troué. On normalise donc
 * ces espaces à l'impression — plutôt que d'embarquer une police, ce qui
 * alourdirait chaque facture pour un problème de deux caractères.
 */

/**
 * Espaces fine (U+202F) et insécable (U+00A0) ramenées à une espace ordinaire.
 *
 * Écrites en ÉCHAPPEMENTS, jamais en caractères littéraux : invisibles dans un
 * éditeur, elles se font remplacer par de vraies espaces au premier copier-coller
 * — et la parade devient un no-op silencieux. C'est arrivé.
 */
function pdfSafe(texte: string): string {
  return texte.replace(/[\u202f\u00a0]/g, " ");
}

const styles = StyleSheet.create({
  /**
   * ZONE DE CONTENU : 842 - 30 - 34 = 778 pt. Ce budget n'est pas décoratif.
   *
   * Le pied est INSÉCABLE (`wrap={false}`) et haut d'environ 120 pt : dès que
   * le corps dépasse ~655 pt, il ne tient plus dans ce qui reste et bascule
   * EN ENTIER sur une seconde page, laissant la première à moitié vide. Une
   * facture d'atelier de dix lignes tombait exactement dans ce cas.
   *
   * D'où des marges et des interlignes mesurés plutôt que confortables :
   * chaque point gagné ici est un point de contenu qui tient sur la feuille.
   * Avant de rallonger quoi que ce soit, mesurer — pas estimer.
   */
  page: {
    paddingTop: 30,
    paddingBottom: 34,
    paddingHorizontal: 40,
    fontSize: 9.5,
    fontFamily: "Helvetica",
    color: C.encre,
    lineHeight: 1.4,
    flexDirection: "column",
  },

  /**
   * Le corps s'étire pour occuper la hauteur disponible : c'est lui qui
   * repousse le pied au bas de la feuille quand la facture est courte.
   *
   * Un `flexGrow` plutôt qu'un `position: "absolute"` : un bloc absolu sort du
   * flux, donc le contenu d'une facture longue lui passerait DESSOUS et le
   * chevaucherait. Et un pied `fixed` se répéterait sur chaque page, ce qui
   * n'est pas ce qu'on veut d'un bloc de mentions.
   */
  corps: { flexGrow: 1 },

  // ---------------------------------------------------------------- en-tête
  entete: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 24,
  },
  enteteGauche: { flexGrow: 1, flexShrink: 1, maxWidth: "58%" },
  /** Le logo tient la droite ; il est le premier repère visuel du document. */
  enteteDroite: { flexShrink: 0, maxWidth: "40%", alignItems: "flex-end" },

  logo: { maxHeight: 68, maxWidth: 190, marginBottom: 5, objectFit: "contain" },
  logoNom: {
    fontSize: 12,
    lineHeight: 1.3,
    fontFamily: "Helvetica-Bold",
    textAlign: "right",
  },

  /**
   * Grand, en accent : à 27 pt le seuil « grand texte » est largement tenu.
   *
   * `lineHeight` EXPLICITE, et non hérité de la page : sans lui, la boîte de
   * ligne vaudrait 13,3 pt (9,5 × 1,4) pour des glyphes de 27 pt, et le
   * numéro viendrait se superposer au titre. Voir « LE PIÈGE DU lineHeight
   * HÉRITÉ » en tête de fichier.
   */
  titre: { fontSize: 27, lineHeight: 1.2, fontFamily: "Helvetica-Bold", color: C.accent },
  /** Le numéro, juste sous le titre : c'est la référence qu'on cherche. */
  numero: {
    fontSize: 13.5,
    lineHeight: 1.3,
    marginTop: 2,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.3,
  },
  numeroAbsent: { fontSize: 10, lineHeight: 1.4, marginTop: 2, color: C.discret },
  etat: {
    marginTop: 4,
    alignSelf: "flex-start",
    backgroundColor: C.accentPale,
    borderRadius: 9,
    paddingVertical: 2,
    paddingHorizontal: 7,
    fontSize: 7,
    color: C.accentTexte,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.5,
  },
  meta: { marginTop: 6, fontSize: 8.5, color: C.attenue },
  metaValeur: { color: C.encre, fontFamily: "Helvetica-Bold" },

  // ------------------------------------------- vendeur et client, en regard
  /** Deux cartouches arrondies, côte à côte : qui vend, à qui. */
  parties: { marginTop: 16, flexDirection: "row", justifyContent: "space-between", gap: 12 },
  carte: { width: "48.5%", backgroundColor: C.surface, borderRadius: 9, padding: 10 },
  /** Le bloc client est teinté : c'est lui qu'on cherche des yeux en premier. */
  carteClient: { width: "48.5%", backgroundColor: C.accentPale, borderRadius: 9, padding: 10 },
  surtitre: {
    fontSize: 7,
    color: C.accentTexte,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.3,
    marginBottom: 4,
  },
  partieNom: { fontFamily: "Helvetica-Bold", fontSize: 11.5, lineHeight: 1.3 },
  partieLigne: { fontSize: 8.8, color: C.texte },
  partieAbsente: { fontSize: 8.5, color: C.discret },

  // ---------------------------------------------------------------- tableau
  /** Aucun filet : ce sont les tuiles alternées qui tiennent les lignes. */
  table: { marginTop: 18 },
  tableEntete: {
    flexDirection: "row",
    paddingBottom: 5,
    paddingHorizontal: 7,
    fontSize: 7,
    color: C.accentTexte,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.1,
  },
  ligne: { flexDirection: "row", paddingVertical: 5, paddingHorizontal: 7, borderRadius: 6 },
  lignePaire: { backgroundColor: C.surface },
  colDesignation: { flexGrow: 1, flexShrink: 1, paddingRight: 8, fontFamily: "Helvetica-Bold" },
  colQte: { width: 36, textAlign: "right", paddingHorizontal: 3 },
  colUnite: { width: 40, paddingHorizontal: 3 },
  colPu: { width: 62, textAlign: "right", paddingHorizontal: 3 },
  colTva: { width: 42, textAlign: "right", paddingHorizontal: 3 },
  colTotal: { width: 68, textAlign: "right", paddingLeft: 6, fontFamily: "Helvetica-Bold" },
  cellule: { color: C.texte },
  tableVide: { paddingVertical: 20, textAlign: "center", color: C.discret },

  // ----------------------------------------------------------------- totaux
  totaux: { marginTop: 13, alignItems: "flex-end" },
  totauxBloc: { width: 248 },
  totalRang: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1 },
  totalLibelle: { color: C.attenue },
  totalValeur: { color: C.encre },
  /**
   * La pastille orange. 14 pt gras : au-delà du seuil « grand texte » de
   * WCAG, donc le blanc sur l'accent (3,5:1) y est conforme. La descendre en
   * taille exigerait d'assombrir le fond — voir `theme.ts`.
   */
  totalTtc: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
    paddingVertical: 7,
    paddingHorizontal: 15,
    borderRadius: 18,
    backgroundColor: C.accent,
    color: C.surAccent,
    fontSize: 14,
    lineHeight: 1.25,
    fontFamily: "Helvetica-Bold",
  },

  note: { marginTop: 14, backgroundColor: C.surface, borderRadius: 9, padding: 10 },
  noteTexte: { color: C.texte },

  // ------------------------------------------------------------------- pied
  pied: { marginTop: 16, backgroundColor: C.surface, borderRadius: 9, padding: 10 },
  piedCols: { flexDirection: "row", justifyContent: "space-between", gap: 20 },
  piedColonne: { width: "48%" },
  piedNom: { color: C.encre, fontFamily: "Helvetica-Bold", fontSize: 9, marginBottom: 1 },
  piedLigne: { color: C.texte, fontSize: 8 },
  piedAbsent: { color: C.discret, fontSize: 8 },
  /**
   * Les mentions de règlement : allégées, jamais effacées. 7 pt en `attenue`
   * (4,8:1) plutôt qu'un gris plus clair — une mention que la loi impose et
   * qu'on ne peut pas lire n'est pas une mention.
   */
  mentionsFines: {
    marginTop: 6,
    paddingHorizontal: 2,
    fontSize: 7,
    color: C.attenue,
    lineHeight: 1.5,
  },
  mentionForte: { color: C.accentTexte, fontFamily: "Helvetica-Bold" },

  numeroPage: {
    position: "absolute",
    bottom: 14,
    left: 40,
    right: 40,
    textAlign: "center",
    fontSize: 7,
    color: C.discret,
  },

  filigrane: {
    position: "absolute",
    top: 320,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 46,
    lineHeight: 1.2,
    fontFamily: "Helvetica-Bold",
    color: "#f7ece4",
    transform: "rotate(-24deg)",
  },
});

export function InvoicePdf({ document }: { document: InvoiceDocument }) {
  const { localeCode, seller, client, dates, lines, totals, legalMentions } = document;
  const locale = getLocale(localeCode);

  const montant = (valeur: number) => pdfSafe(formatAmount(valeur, localeCode));
  const taux = (valeur: number) => pdfSafe(formatVatRate(valeur, localeCode));
  const date = (valeur: string) => pdfSafe(formatDate(valeur, localeCode));

  const brouillon = document.status === "draft";
  // Une fiche vide ne doit pas produire deux colonnes vides : on le dit.
  const identiteComplete =
    seller.footerIdentityLines.length > 0 || seller.footerLegalLines.length > 0;

  return (
    <Document
      title={document.number ? `Facture ${document.number}` : "Brouillon de facture"}
      author={seller.name}
      subject={client.name ? `Facture pour ${client.name}` : "Facture"}
      creator="Facturation multi-garages"
      producer="Facturation multi-garages"
    >
      <Page size="A4" style={styles.page}>
        {/* Un brouillon ne doit jamais pouvoir passer pour une facture émise :
            il n'a pas de numéro, et il le dit en travers de la page. */}
        {brouillon ? (
          <Text style={styles.filigrane} fixed>
            BROUILLON
          </Text>
        ) : null}

        <View style={styles.corps}>
          {/* ---------- En-tête : l'objet à gauche, l'émetteur à droite ---------- */}
          <View style={styles.entete}>
            <View style={styles.enteteGauche}>
              <Text style={styles.titre}>Facture</Text>
              {document.number ? (
                <Text style={styles.numero}>{document.number}</Text>
              ) : (
                <Text style={styles.numeroAbsent}>
                  Numéro attribué à l&apos;émission
                </Text>
              )}
              {brouillon ? <Text style={styles.etat}>BROUILLON — NON EMIS</Text> : null}
              {document.status === "cancelled" ? (
                <Text style={styles.etat}>ANNULEE</Text>
              ) : null}

              <View style={styles.meta}>
                <Text>
                  Date d&apos;émission :{" "}
                  <Text style={styles.metaValeur}>
                    {dates.issue ? date(dates.issue) : "—"}
                  </Text>
                </Text>
                {dates.service ? (
                  <Text>
                    Date de prestation :{" "}
                    <Text style={styles.metaValeur}>{date(dates.service)}</Text>
                  </Text>
                ) : null}
              </View>
            </View>

            {/* Le logo, en grand, et la dénomination dessous — rien d'autre.
                `src` est une `data:` URI : les octets ont été téléchargés par
                le serveur depuis le bucket privé. Passer l'URL signée ferait
                dépendre le rendu d'un aller-retour réseau au moment de
                l'impression — et d'une signature qui peut avoir expiré. */}
            <View style={styles.enteteDroite}>
              {seller.logoUrl ? (
                // `Image` vient de @react-pdf/renderer, pas du DOM : il n'a pas
                // d'attribut `alt`, et un PDF n'a pas de texte alternatif. La
                // dénomination du vendeur figure juste en dessous, en texte.
                // eslint-disable-next-line jsx-a11y/alt-text
                <Image style={styles.logo} src={seller.logoUrl} />
              ) : null}
              <Text style={styles.logoNom}>{pdfSafe(seller.name)}</Text>
            </View>
          </View>

          {/* ---------- Vendeur et client, côte à côte ---------- */}
          <View style={styles.parties}>
            <View style={styles.carte}>
              <Text style={styles.surtitre}>VENDEUR</Text>
              <Text style={styles.partieNom}>{pdfSafe(seller.name)}</Text>
              {/* L'adresse du siège, et rien d'autre : les mentions légales
                  d'identité sont rassemblées en pied de page. */}
              {seller.addressLines.length === 0 ? (
                <Text style={styles.partieAbsente}>Adresse du siège non renseignée.</Text>
              ) : (
                seller.addressLines.map((ligne) => (
                  <Text key={ligne} style={styles.partieLigne}>
                    {pdfSafe(ligne)}
                  </Text>
                ))
              )}
            </View>

            <View style={styles.carteClient}>
              <Text style={styles.surtitre}>FACTURÉ À</Text>
              <Text style={styles.partieNom}>
                {client.name ? pdfSafe(client.name) : "—"}
              </Text>
              {client.address ? (
                <Text style={styles.partieLigne}>{pdfSafe(client.address)}</Text>
              ) : null}
              {client.phone ? (
                <Text style={styles.partieLigne}>{pdfSafe(client.phone)}</Text>
              ) : null}
              {client.vatNumber ? (
                <Text style={styles.partieLigne}>
                  N° TVA / SIRET : {pdfSafe(client.vatNumber)}
                </Text>
              ) : null}
            </View>
          </View>

          {/* ---------- Prestations ---------- */}
          <View style={styles.table}>
            <View style={styles.tableEntete} fixed>
              <Text style={styles.colDesignation}>DÉSIGNATION</Text>
              <Text style={styles.colQte}>QTÉ</Text>
              <Text style={styles.colUnite}>UNITÉ</Text>
              <Text style={styles.colPu}>P.U. HT</Text>
              {seller.vatExempt ? null : <Text style={styles.colTva}>TVA</Text>}
              <Text style={styles.colTotal}>TOTAL HT</Text>
            </View>

            {lines.length === 0 ? (
              <Text style={styles.tableVide}>Aucune prestation.</Text>
            ) : (
              lines.map((line, index) => (
                <View
                  key={line.key}
                  style={index % 2 === 0 ? [styles.ligne, styles.lignePaire] : styles.ligne}
                  wrap={false}
                >
                  <Text style={styles.colDesignation}>{pdfSafe(line.description)}</Text>
                  <Text style={[styles.colQte, styles.cellule]}>{line.quantity}</Text>
                  <Text style={[styles.colUnite, styles.cellule]}>
                    {pdfSafe(line.unit)}
                  </Text>
                  <Text style={[styles.colPu, styles.cellule]}>
                    {montant(line.unitPriceHt)}
                  </Text>
                  {seller.vatExempt ? null : (
                    <Text style={[styles.colTva, styles.cellule]}>{taux(line.vatRate)}</Text>
                  )}
                  <Text style={styles.colTotal}>{montant(line.lineTotalHt)}</Text>
                </View>
              ))
            )}
          </View>

          {/* ---------- Totaux ---------- */}
          <View style={styles.totaux} wrap={false}>
            <View style={styles.totauxBloc}>
              <View style={styles.totalRang}>
                <Text style={styles.totalLibelle}>Total HT</Text>
                <Text style={styles.totalValeur}>{montant(totals.subtotalHt)}</Text>
              </View>

              {seller.vatExempt ? null : (
                <>
                  {totals.breakdown.map((bucket) => (
                    <View key={bucket.rate} style={styles.totalRang}>
                      <Text style={styles.totalLibelle}>
                        TVA {taux(bucket.rate)} sur {montant(bucket.baseHt)}
                      </Text>
                      <Text style={styles.totalValeur}>{montant(bucket.vatAmount)}</Text>
                    </View>
                  ))}
                  <View style={styles.totalRang}>
                    <Text style={styles.totalLibelle}>Total TVA</Text>
                    <Text style={styles.totalValeur}>{montant(totals.vatTotal)}</Text>
                  </View>
                </>
              )}

              {/* Faux en France : la colonne existe pour le multi-locale. */}
              {locale.hasStampDuty ? (
                <View style={styles.totalRang}>
                  <Text style={styles.totalLibelle}>Timbre fiscal</Text>
                  <Text style={styles.totalValeur}>{montant(totals.stampDuty)}</Text>
                </View>
              ) : null}

              <View style={styles.totalTtc}>
                <Text>Total TTC</Text>
                <Text>{montant(totals.totalTtc)}</Text>
              </View>
            </View>
          </View>

          {document.notes ? (
            <View style={styles.note} wrap={false}>
              <Text style={styles.surtitre}>NOTE</Text>
              <Text style={styles.noteTexte}>{pdfSafe(document.notes)}</Text>
            </View>
          ) : null}
        </View>

        {/* ---------- Mentions légales obligatoires ----------
            `wrap={false}` : mesuré sur une facture de 45 lignes, le bloc se
            coupait en deux — la dénomination et le SIRET en bas d'une page, le
            reste des mentions en haut de la suivante. Un bloc légal qui se
            scinde se lit mal et donne l'impression d'un document tronqué. */}
        <View wrap={false}>
          {/* Identité légale du vendeur : descendue de l'en-tête, jamais
              retirée. Le Code de commerce l'exige sur la facture, pas en haut
              de la facture. Deux colonnes dans une cartouche — identification
              à gauche, forme sociale et banque à droite. La LISTE, elle, n'a
              pas changé. */}
          <View style={styles.pied}>
            {identiteComplete ? (
              <View style={styles.piedCols}>
                <View style={styles.piedColonne}>
                  <Text style={styles.piedNom}>{pdfSafe(seller.name)}</Text>
                  {seller.footerIdentityLines.map((ligne) => (
                    <Text key={ligne} style={styles.piedLigne}>
                      {pdfSafe(ligne)}
                    </Text>
                  ))}
                </View>
                <View style={styles.piedColonne}>
                  {seller.footerLegalLines.map((ligne) => (
                    <Text key={ligne} style={styles.piedLigne}>
                      {pdfSafe(ligne)}
                    </Text>
                  ))}
                </View>
              </View>
            ) : (
              <Text style={styles.piedAbsent}>
                Mentions légales du vendeur incomplètes.
              </Text>
            )}
          </View>

          {/* Les mentions de règlement restent en PLEINE LARGEUR et sous la
              cartouche : ce sont des phrases, pas des identifiants. Allégées
              — plus petites, en gris — mais toutes présentes. */}
          <View style={styles.mentionsFines}>
            {legalMentions.vatExempt ? (
              <Text style={styles.mentionForte}>{pdfSafe(legalMentions.vatExempt)}</Text>
            ) : null}
            <Text>{pdfSafe(legalMentions.paymentTerms)}</Text>
            <Text>{pdfSafe(legalMentions.latePayment)}</Text>
            <Text>{pdfSafe(legalMentions.recoveryIndemnity)}</Text>
          </View>
        </View>

        <Text
          style={styles.numeroPage}
          fixed
          render={({ pageNumber, totalPages }) =>
            totalPages > 1 ? `Page ${pageNumber} / ${totalPages}` : ""
          }
        />
      </Page>
    </Document>
  );
}
