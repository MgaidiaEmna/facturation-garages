/**
 * Vocabulaire de l'authentification, partagé serveur et navigateur.
 *
 * Ce fichier ne contient QUE des types et des constantes : il est importable
 * depuis un Composant Client. Tout ce qui décide — rôle, statut, droit
 * d'écrire — est calculé côté serveur (`my_access_state()` en SQL, lu par
 * `getAuthContext()`), jamais reconstruit à partir de ces types.
 */

/** Les deux seuls rôles. Le « premium » n'en est pas un : c'est un drapeau. */
export type UserRole = "super_admin" | "garage";

/** Comment l'accès d'un garage est financé. */
export type GarageAccountStatus = "trial" | "subscribed";

/** Par quel chemin le compte a été créé. */
export type GarageOrigin = "admin" | "self_signup";

/**
 * Motif pour lequel une facture ne peut pas être émise. Codes stables,
 * produits par `finalize_block_reason()` : l'UI s'en sert pour choisir un
 * ton, la base pour refuser.
 */
export type FinalizeBlockReason =
  | "unknown"
  | "inactive"
  | "trial_exhausted"
  | "subscription_expired";

/** Fiche du garage telle qu'elle est utile à l'affichage de l'espace. */
export interface GarageSummary {
  id: string;
  name: string;
  locale: string;
  isActive: boolean;
  accountStatus: GarageAccountStatus;
  origin: GarageOrigin;
  vatExempt: boolean;
  logoManagementEnabled: boolean;
  trialInvoicesUsed: number;
  trialInvoiceLimit: number;
}

/** Où en est le compte : ce qu'il peut faire, et ce qui le bloque. */
export interface AccessState {
  /** L'adresse a-t-elle été confirmée ? Sans cela, aucune donnée n'est lisible. */
  emailVerified: boolean;
  /** Un profil est-il rattaché au compte Auth ? */
  hasProfile: boolean;
  /** Mot de passe initial encore en place : passage forcé par /change-password. */
  mustChangePassword: boolean;
  /** Écriture métier ouverte (essai en cours ou abonnement valide). */
  canWrite: boolean;
  /** Motif de refus d'émission, `null` si l'émission est permise. */
  finalizeBlockReason: FinalizeBlockReason | null;
  /** Phrase affichable correspondante, produite par la base. */
  finalizeBlockMessage: string | null;
  /** Fin de l'abonnement en cours (ISO), `null` pour un compte en essai. */
  subscriptionEndDate: string | null;
}

/** Tout ce que le serveur sait de la session courante. */
export interface AuthContext {
  userId: string;
  email: string | null;
  fullName: string | null;
  /** `null` tant qu'aucun profil n'est rattaché (inscription non provisionnée). */
  role: UserRole | null;
  garage: GarageSummary | null;
  access: AccessState;
}

/** Reste-t-il des factures sur l'essai gratuit ? */
export function trialRemaining(garage: GarageSummary): number {
  return Math.max(0, garage.trialInvoiceLimit - garage.trialInvoicesUsed);
}
