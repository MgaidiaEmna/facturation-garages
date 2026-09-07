import "server-only";

import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import { formatAmount, formatDate, formatVatRate } from "@/lib/format";
import { getLocale } from "@/lib/locale";
import type { InvoiceDocument } from "@/lib/invoice/document";

/**
 * La facture, en PDF A4.
 *
 * ---------------------------------------------------------------------------
 * SECOND MOTEUR DE RENDU, MÊME DOCUMENT
 * ---------------------------------------------------------------------------
 * Les primitives de `@react-pdf/renderer` n'ont rien de commun avec le HTML :
 * ce fichier ne peut pas réutiliser `invoice-preview.tsx`. Ce qu'il réutilise,
 * c'est le MODÈLE — `buildInvoiceDocument()` — d'où viennent l'ordre des
 * lignes d'identité, le texte des mentions légales et le calcul de l'échéance.
 * Seule la mise en page est écrite ici. Une mention ajoutée au modèle apparaît
 * des deux côtés ; une mention ajoutée ici seulement serait un bug.
 *
 * Les montants passent par `formatAmount()`, la même fonction qu'à l'écran :
 * un total imprimé différemment de l'aperçu serait pire qu'un total absent.
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

/** Espaces fine et insécable ramenées à une espace ordinaire. */
function pdfSafe(texte: string): string {
  return texte.replace(/[  ]/g, " ");
}

const ZINC = {
  900: "#18181b",
  700: "#3f3f46",
  600: "#52525b",
  500: "#71717a",
  400: "#a1a1aa",
  300: "#d4d4d8",
  200: "#e4e4e7",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 44,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: ZINC[900],
    lineHeight: 1.5,
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

  entete: { flexDirection: "row", justifyContent: "space-between", gap: 24 },
  enteteGauche: { flexGrow: 1, flexShrink: 1, maxWidth: "58%" },
  /** Le logo tient la droite ; il est le premier repère visuel du document. */
  enteteDroite: { flexShrink: 0, maxWidth: "40%", alignItems: "flex-end" },
  filetEntete: { borderBottomWidth: 1, borderBottomColor: ZINC[300], paddingBottom: 14 },

  logo: { maxHeight: 76, maxWidth: 200, marginBottom: 6, objectFit: "contain" },
  logoNom: { fontSize: 13, fontFamily: "Helvetica-Bold", textAlign: "right" },
  vendeurNom: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  vendeurLigne: { fontSize: 8.5, color: ZINC[700] },
  vendeurAbsent: { fontSize: 8, color: ZINC[400] },

  titre: { fontSize: 18, fontFamily: "Helvetica-Bold", letterSpacing: 0.5 },
  etat: {
    marginTop: 4,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: ZINC[300],
    borderRadius: 2,
    paddingVertical: 2,
    paddingHorizontal: 5,
    fontSize: 7,
    color: ZINC[500],
    fontFamily: "Helvetica-Bold",
  },
  meta: { marginTop: 8, fontSize: 8, color: ZINC[600] },
  metaValeur: { color: ZINC[900], fontFamily: "Helvetica-Bold" },

  /** Vendeur et client CÔTE À CÔTE : deux colonnes, une seule ligne de lecture. */
  parties: { marginTop: 22, flexDirection: "row", justifyContent: "space-between", gap: 24 },
  partie: { width: "48%" },
  surtitre: {
    fontSize: 7,
    color: ZINC[500],
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.6,
    marginBottom: 2,
  },
  clientNom: { fontFamily: "Helvetica-Bold" },
  clientLigne: { color: ZINC[700] },

  table: { marginTop: 26 },
  tableEntete: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: ZINC[300],
    paddingVertical: 5,
    fontSize: 7,
    color: ZINC[500],
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.4,
  },
  ligne: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: ZINC[200],
    paddingVertical: 5,
  },
  colDesignation: { flexGrow: 1, flexShrink: 1, paddingRight: 6 },
  colQte: { width: 38, textAlign: "right", paddingHorizontal: 4 },
  colUnite: { width: 34, paddingHorizontal: 4 },
  colPu: { width: 62, textAlign: "right", paddingHorizontal: 4 },
  colTva: { width: 44, textAlign: "right", paddingHorizontal: 4 },
  colTotal: { width: 68, textAlign: "right", paddingLeft: 6 },
  cellule: { color: ZINC[700] },
  celluleForte: { color: ZINC[900], fontFamily: "Helvetica-Bold" },
  tableVide: { paddingVertical: 22, textAlign: "center", color: ZINC[400] },

  totaux: { marginTop: 18, alignItems: "flex-end" },
  totauxBloc: { width: 220 },
  totalRang: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1 },
  totalLibelle: { color: ZINC[600] },
  totalValeur: { color: ZINC[900] },
  totalTtc: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 5,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: ZINC[300],
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
  },

  note: {
    marginTop: 20,
    borderTopWidth: 1,
    borderTopColor: ZINC[200],
    paddingTop: 10,
  },
  noteTexte: { color: ZINC[700] },

  mentions: {
    marginTop: 24,
    borderTopWidth: 1,
    borderTopColor: ZINC[300],
    paddingTop: 10,
    fontSize: 7.5,
    color: ZINC[600],
    lineHeight: 1.55,
  },
  mentionForte: { color: ZINC[900], fontFamily: "Helvetica-Bold", marginBottom: 3 },
  /** Les deux colonnes d'identité du pied, au-dessus des mentions de règlement. */
  pieds: { flexDirection: "row", justifyContent: "space-between", gap: 20 },
  piedColonne: { width: "48%" },
  piedNom: { color: ZINC[900], fontFamily: "Helvetica-Bold", marginBottom: 1 },
  piedLigne: { color: ZINC[600] },
  reglement: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: ZINC[200],
    paddingTop: 6,
  },
  mentionAbsente: { color: ZINC[400], marginBottom: 5 },

  pied: {
    position: "absolute",
    bottom: 24,
    left: 44,
    right: 44,
    textAlign: "center",
    fontSize: 7,
    color: ZINC[400],
  },

  filigrane: {
    position: "absolute",
    top: 320,
    left: 0,
    right: 0,
    textAlign: "center",
    fontSize: 46,
    fontFamily: "Helvetica-Bold",
    color: "#ececed",
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
          <View style={[styles.entete, styles.filetEntete]}>
            <View style={styles.enteteGauche}>
              <Text style={styles.titre}>FACTURE</Text>
              {brouillon ? <Text style={styles.etat}>BROUILLON — NON EMIS</Text> : null}
              {document.status === "cancelled" ? (
                <Text style={styles.etat}>ANNULEE</Text>
              ) : null}

              <View style={styles.meta}>
                <Text>
                  Numéro :{" "}
                  {document.number ? (
                    <Text style={styles.metaValeur}>{document.number}</Text>
                  ) : (
                    <Text style={{ color: ZINC[400] }}>attribué à l&apos;émission</Text>
                  )}
                </Text>
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
            <View style={styles.partie}>
              <Text style={styles.surtitre}>VENDEUR</Text>
              <Text style={styles.vendeurNom}>{pdfSafe(seller.name)}</Text>
              {/* L'adresse du siège, et rien d'autre : les mentions légales
                  d'identité sont rassemblées en pied de page. */}
              {seller.addressLines.length === 0 ? (
                <Text style={styles.vendeurAbsent}>Adresse du siège non renseignée.</Text>
              ) : (
                seller.addressLines.map((ligne) => (
                  <Text key={ligne} style={styles.vendeurLigne}>
                    {pdfSafe(ligne)}
                  </Text>
                ))
              )}
            </View>

            <View style={styles.partie}>
              <Text style={styles.surtitre}>FACTURÉ À</Text>
              <Text style={styles.clientNom}>
                {client.name ? pdfSafe(client.name) : "—"}
              </Text>
              {client.address ? (
                <Text style={styles.clientLigne}>{pdfSafe(client.address)}</Text>
              ) : null}
              {client.phone ? (
                <Text style={styles.clientLigne}>{pdfSafe(client.phone)}</Text>
              ) : null}
              {client.vatNumber ? (
                <Text style={styles.clientLigne}>
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
              lines.map((line) => (
                <View key={line.key} style={styles.ligne} wrap={false}>
                  <Text style={[styles.colDesignation, styles.celluleForte]}>
                    {pdfSafe(line.description)}
                  </Text>
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
                  <Text style={[styles.colTotal, styles.celluleForte]}>
                    {montant(line.lineTotalHt)}
                  </Text>
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
        <View style={styles.mentions} wrap={false}>
          {/* Identité légale du vendeur : descendue de l'en-tête, jamais
              retirée. Le Code de commerce l'exige sur la facture, pas en haut
              de la facture. Deux colonnes — identification à gauche, forme
              sociale et coordonnées bancaires à droite — parce qu'une seule
              phrase à points médians devenait illisible. La LISTE, elle, n'a
              pas changé. */}
          {identiteComplete ? (
            <View style={styles.pieds}>
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
            <Text style={styles.mentionAbsente}>
              Mentions légales du vendeur incomplètes.
            </Text>
          )}

          {/* Les mentions de règlement restent en PLEINE LARGEUR : ce sont des
              phrases, pas des identifiants, et les couper en deux colonnes les
              rendrait pénibles à lire. */}
          <View style={styles.reglement}>
            {legalMentions.vatExempt ? (
              <Text style={styles.mentionForte}>{pdfSafe(legalMentions.vatExempt)}</Text>
            ) : null}
            <Text>{pdfSafe(legalMentions.paymentTerms)}</Text>
            <Text>{pdfSafe(legalMentions.latePayment)}</Text>
            <Text>{pdfSafe(legalMentions.recoveryIndemnity)}</Text>
          </View>
        </View>

        <Text
          style={styles.pied}
          fixed
          render={({ pageNumber, totalPages }) =>
            totalPages > 1 ? `Page ${pageNumber} / ${totalPages}` : ""
          }
        />
      </Page>
    </Document>
  );
}
