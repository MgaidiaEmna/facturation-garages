/**
 * Contrat d'une locale de facturation.
 *
 * Le produit est multi-locale par conception : toute règle qui dépend du pays
 * (devise, taux de TVA, mentions légales, présence d'un timbre fiscal, champs
 * d'identité du vendeur) est décrite ici et JAMAIS codée en dur ailleurs.
 * Ajouter un pays = ajouter un fichier de config, pas modifier le moteur.
 */

/** Code ISO du pays de facturation. Ajouter "TN" ici pour brancher la Tunisie. */
export type LocaleCode = "FR";

/** Un taux de TVA proposé dans l'éditeur de facture. */
export interface VatRate {
  /** Taux en pourcentage, ex. 20 pour 20 %. */
  rate: number;
  /** Libellé affiché dans le sélecteur, ex. « 20 % (normal) ». */
  label: string;
}

/**
 * Champs d'identité du vendeur exigés par la réglementation locale.
 * Pilote l'affichage du formulaire « garage » ET du pied de facture.
 */
export interface SellerIdentityField {
  /** Clé de la colonne correspondante dans la table `garages`. */
  key: string;
  /** Libellé du champ dans l'UI. */
  label: string;
  /** Obligatoire pour qu'une facture soit conforme. */
  required: boolean;
  /** Aide contextuelle affichée sous le champ. */
  hint?: string;
}

export interface LocaleConfig {
  code: LocaleCode;
  label: string;

  /** Code ISO 4217, ex. "EUR". */
  currency: string;
  /** Locale Intl utilisée pour formater montants et dates, ex. "fr-FR". */
  intlLocale: string;
  /**
   * Fuseau du pays de facturation, ex. "Europe/Paris".
   *
   * Sert à répondre à « quel jour sommes-nous ? » sans dépendre de l'horloge
   * de la machine : un serveur en UTC et un navigateur à Paris ne sont pas du
   * même jour entre minuit et 2 h. La date d'émission d'une facture française
   * est la date française, pas celle de l'hébergeur ni celle du visiteur.
   */
  timeZone: string;
  /** Nombre de décimales des montants (2 en zone euro, 3 en TND). */
  decimals: number;

  /** Taux de TVA proposés, du plus courant au plus rare. */
  vatRates: VatRate[];
  /** Taux appliqué par défaut à une nouvelle ligne de facture. */
  defaultVatRate: number;

  /**
   * Le pays applique-t-il un droit de timbre par facture ?
   * En France : non. La colonne `stamp_duty` reste en base (=0) pour le
   * multi-locale, mais l'UI ne doit ni l'afficher ni la saisir.
   */
  hasStampDuty: boolean;

  /** Champs d'identité du vendeur exigés localement. */
  sellerIdentityFields: SellerIdentityField[];

  /** Mentions légales à imprimer sur la facture. */
  legalMentions: {
    /** Mention affichée quand le vendeur n'est pas assujetti à la TVA. */
    vatExemptNotice: string;
    /** Pénalités de retard : texte + taux par défaut. */
    latePaymentPenalty: string;
    /** Indemnité forfaitaire de recouvrement (montant fixe légal). */
    recoveryIndemnity: string;
    /** Rappel affiché dans l'app : le logiciel ne remplace pas un comptable. */
    disclaimer: string;
  };

  /** Délai de règlement proposé par défaut, en jours. */
  defaultPaymentTermDays: number;
}
