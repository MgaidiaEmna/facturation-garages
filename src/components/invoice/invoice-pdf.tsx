import "server-only";

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

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
  },

  entete: { flexDirection: "row", justifyContent: "space-between", gap: 24 },
  enteteGauche: { flexGrow: 1, flexShrink: 1, maxWidth: "58%" },
  enteteDroite: { textAlign: "right", flexShrink: 0 },
  filetEntete: { borderBottomWidth: 1, borderBottomColor: ZINC[300], paddingBottom: 14 },

  vendeurNom: { fontSize: 13, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  vendeurLigne: { fontSize: 8, color: ZINC[600] },
  vendeurAbsent: { fontSize: 8, color: ZINC[400] },

  titre: { fontSize: 18, fontFamily: "Helvetica-Bold", letterSpacing: 0.5 },
  etat: {
    marginTop: 4,
    alignSelf: "flex-end",
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

  client: { marginTop: 22, alignItems: "flex-end" },
  clientBloc: { width: "58%" },
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

        {/* ---------- En-tête ---------- */}
        <View style={[styles.entete, styles.filetEntete]}>
          <View style={styles.enteteGauche}>
            <Text style={styles.vendeurNom}>{pdfSafe(seller.name)}</Text>
            {seller.identityLines.length === 0 ? (
              <Text style={styles.vendeurAbsent}>Identité légale incomplète.</Text>
            ) : (
              seller.identityLines.map((ligne) => (
                <Text key={ligne} style={styles.vendeurLigne}>
                  {pdfSafe(ligne)}
                </Text>
              ))
            )}
          </View>

          <View style={styles.enteteDroite}>
            <Text style={styles.titre}>FACTURE</Text>
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
              <Text>
                Numéro :{" "}
                {document.number ? (
                  <Text style={styles.metaValeur}>{document.number}</Text>
                ) : (
                  <Text style={{ color: ZINC[400] }}>attribué à l&apos;émission</Text>
                )}
              </Text>
            </View>
          </View>
        </View>

        {/* ---------- Client ---------- */}
        <View style={styles.client}>
          <View style={styles.clientBloc}>
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

        {/* ---------- Mentions légales obligatoires ---------- */}
        <View style={styles.mentions}>
          {legalMentions.vatExempt ? (
            <Text style={styles.mentionForte}>{pdfSafe(legalMentions.vatExempt)}</Text>
          ) : null}
          <Text>{pdfSafe(legalMentions.paymentTerms)}</Text>
          <Text>{pdfSafe(legalMentions.latePayment)}</Text>
          <Text>{pdfSafe(legalMentions.recoveryIndemnity)}</Text>
          {legalMentions.bankDetails ? (
            <Text>{pdfSafe(legalMentions.bankDetails)}</Text>
          ) : null}
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
