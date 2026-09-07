import type { LocaleConfig } from "./types";

/**
 * Locale France — facturation en euros, conforme aux mentions obligatoires
 * du Code de commerce (art. L441-9) et du CGI (art. 242 nonies A).
 *
 * Références des mentions imposées :
 *  - identité vendeur : dénomination, adresse, SIREN/SIRET, forme juridique,
 *    capital social, RCS + ville du greffe, n° TVA intracommunautaire ;
 *  - conditions de règlement : date/délai, taux des pénalités de retard,
 *    indemnité forfaitaire de recouvrement de 40 € (art. D441-5) ;
 *  - franchise en base : « TVA non applicable, art. 293 B du CGI ».
 *
 * PAS de timbre fiscal en France.
 */
export const FR_LOCALE: LocaleConfig = {
  code: "FR",
  label: "France",

  currency: "EUR",
  intlLocale: "fr-FR",
  timeZone: "Europe/Paris",
  decimals: 2,

  vatRates: [
    { rate: 20, label: "20 % — taux normal" },
    { rate: 10, label: "10 % — taux intermédiaire" },
    { rate: 5.5, label: "5,5 % — taux réduit" },
    { rate: 2.1, label: "2,1 % — taux particulier" },
    { rate: 0, label: "0 % — exonéré / non applicable" },
  ],
  defaultVatRate: 20,

  hasStampDuty: false,

  sellerIdentityFields: [
    { key: "name", label: "Dénomination sociale", required: true },
    { key: "address", label: "Adresse du siège", required: true },
    {
      key: "siret",
      label: "SIRET",
      required: true,
      hint: "14 chiffres. Le SIREN correspond aux 9 premiers.",
    },
    {
      key: "legal_form",
      label: "Forme juridique",
      required: true,
      hint: "Ex. SARL, SAS, EURL, entreprise individuelle.",
    },
    {
      key: "capital",
      label: "Capital social",
      required: false,
      hint: "Obligatoire pour les sociétés commerciales.",
    },
    {
      key: "rcs_city",
      label: "RCS et ville du greffe",
      required: true,
      hint: "Ex. RCS Lyon 812 345 678.",
    },
    {
      key: "vat_number",
      label: "N° de TVA intracommunautaire",
      required: false,
      hint: "Ex. FR12345678901. Non requis en franchise en base.",
    },
  ],

  legalMentions: {
    vatExemptNotice: "TVA non applicable, art. 293 B du CGI",
    latePaymentPenalty:
      "En cas de retard de paiement, application de pénalités de retard au taux de {rate} % " +
      "(taux d'intérêt légal majoré), exigibles sans rappel préalable.",
    recoveryIndemnity:
      "Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40 € " +
      "(art. L441-10 et D441-5 du Code de commerce).",
    disclaimer:
      "Ce document est généré automatiquement. La conformité fiscale et comptable de vos " +
      "factures doit être validée par votre expert-comptable ; ce logiciel facilite la " +
      "conformité mais ne s'y substitue pas.",
  },

  defaultPaymentTermDays: 30,
};
