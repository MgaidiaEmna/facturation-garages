import "server-only";

import { createHmac } from "node:crypto";
import { headers } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Limitation de débit sur les points d'entrée non authentifiés.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI EN BASE, ET POURQUOI PAR LA CLÉ SERVICE ROLE
 * ---------------------------------------------------------------------------
 * L'application est déployée sur Vercel : plusieurs instances sans état
 * partagé. Un compteur en mémoire ne protège rien, il suffit que deux
 * tentatives tombent sur deux instances. Le compteur vit donc dans Postgres
 * (`auth_rate_limits`).
 *
 * Cette table et ses fonctions ne sont ouvertes qu'à la clé service role,
 * jamais à `anon`. Exposées publiquement, elles permettraient à n'importe qui
 * de faire bloquer l'adresse e-mail de son choix depuis l'API REST — un déni
 * de service ciblé. C'est le seul usage de la clé service role qui ne
 * concerne pas une action d'administration : il est nécessaire précisément
 * parce que l'appelant n'est pas encore authentifié.
 *
 * ---------------------------------------------------------------------------
 * CE QUI EST STOCKÉ
 * ---------------------------------------------------------------------------
 * Jamais l'adresse e-mail ni l'IP en clair : seulement un HMAC-SHA256, dont
 * la clé est la clé service role. Le compteur reste utilisable, la table
 * n'est pas un fichier d'adresses. Les seaux inactifs sont purgés au bout de
 * 24 heures.
 */

export interface RateLimitRule {
  /** Tentatives tolérées dans la fenêtre. */
  maxAttempts: number;
  /** Largeur de la fenêtre glissante, en secondes. */
  windowSeconds: number;
  /** Durée du blocage une fois le plafond atteint, en secondes. */
  blockSeconds: number;
}

const MINUTE = 60;

/**
 * Plafonds. Deux dimensions par formulaire : l'adresse visée (protège un
 * compte du bourrage de mots de passe) et l'IP d'origine (protège l'ensemble
 * du parc d'un balayage). Le plus strict des deux l'emporte.
 */
export const RATE_LIMITS = {
  /** Connexion : 5 échecs par adresse en 15 min, puis 15 min de pause. */
  loginByEmail: { maxAttempts: 5, windowSeconds: 15 * MINUTE, blockSeconds: 15 * MINUTE },
  /** Connexion : 20 échecs depuis une même IP (bureau partagé, NAT). */
  loginByIp: { maxAttempts: 20, windowSeconds: 15 * MINUTE, blockSeconds: 15 * MINUTE },
  /** Inscription : 3 tentatives par adresse et par heure. */
  signupByEmail: { maxAttempts: 3, windowSeconds: 60 * MINUTE, blockSeconds: 60 * MINUTE },
  /** Inscription : 5 comptes par IP et par heure — la vraie garde anti-robot. */
  signupByIp: { maxAttempts: 5, windowSeconds: 60 * MINUTE, blockSeconds: 60 * MINUTE },
  /** Changement de mot de passe : 10 essais par compte en 15 min. */
  passwordChange: { maxAttempts: 10, windowSeconds: 15 * MINUTE, blockSeconds: 15 * MINUTE },
} as const satisfies Record<string, RateLimitRule>;

export interface RateLimitTarget {
  /** Portée, ex. « login:email ». Fait partie de la clé. */
  scope: string;
  /** Ce qu'on compte : adresse e-mail normalisée, IP, identifiant de compte. */
  identifier: string;
  rule: RateLimitRule;
}

/** Adresse IP de l'appelant, telle que la voit l'hébergeur. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  // `x-forwarded-for` est une liste : le premier élément est le client, les
  // suivants sont les relais. Vercel réécrit cet en-tête, il n'est pas
  // falsifiable par le navigateur en production.
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip")?.trim() || "inconnue";
}

/** Clé de seau : jamais l'identifiant en clair. */
function bucketKey(target: RateLimitTarget, secret: string | null): string {
  if (!secret) return `${target.scope}:${target.identifier}`;
  const digest = createHmac("sha256", secret)
    .update(`${target.scope}:${target.identifier}`)
    .digest("base64url");
  return `${target.scope}:${digest}`;
}

// ---------------------------------------------------------------------------
// Repli en mémoire
// ---------------------------------------------------------------------------
// Utilisé uniquement quand la clé service role n'est pas configurée — donc en
// développement local, avant que le projet Supabase n'existe. Il ne protège
// qu'une instance : ce n'est PAS une solution de production, et l'avertir est
// plus utile que de faire semblant.
interface MemoryBucket {
  attempts: number;
  windowStartedAt: number;
  blockedUntil: number | null;
}

const memoryBuckets = new Map<string, MemoryBucket>();
let memoryFallbackWarned = false;

function hitInMemory(key: string, rule: RateLimitRule): Date | null {
  const now = Date.now();
  const windowMs = rule.windowSeconds * 1000;
  const existing = memoryBuckets.get(key);

  if (existing?.blockedUntil && existing.blockedUntil > now) {
    return new Date(existing.blockedUntil);
  }

  const bucket: MemoryBucket =
    !existing || existing.windowStartedAt < now - windowMs
      ? { attempts: 1, windowStartedAt: now, blockedUntil: null }
      : { ...existing, attempts: existing.attempts + 1, blockedUntil: null };

  if (bucket.attempts >= rule.maxAttempts) {
    bucket.blockedUntil = now + rule.blockSeconds * 1000;
  }
  memoryBuckets.set(key, bucket);

  return bucket.blockedUntil ? new Date(bucket.blockedUntil) : null;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Enregistre une tentative sur chaque cible et dit si l'action doit être
 * refusée. Renvoie la fin du blocage la plus lointaine, ou `null` si tout
 * passe.
 *
 * Toutes les cibles sont comptées même si l'une est déjà bloquée : un
 * attaquant ne doit pas pouvoir épargner son compteur d'IP en saturant
 * d'abord celui d'une adresse.
 */
export async function consumeRateLimit(
  targets: RateLimitTarget[],
): Promise<Date | null> {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;

  if (!serviceRoleKey) {
    if (!memoryFallbackWarned) {
      memoryFallbackWarned = true;
      console.warn(
        "[rate-limit] SUPABASE_SERVICE_ROLE_KEY absente : repli sur un compteur " +
          "EN MÉMOIRE, valable pour une seule instance. Ne pas déployer ainsi.",
      );
    }
    let latest: Date | null = null;
    for (const target of targets) {
      const until = hitInMemory(bucketKey(target, null), target.rule);
      if (until && (!latest || until > latest)) latest = until;
    }
    return latest;
  }

  const admin = createAdminClient();
  let latest: Date | null = null;

  for (const target of targets) {
    const { data, error } = await admin.rpc("auth_rate_limit_hit", {
      p_bucket: bucketKey(target, serviceRoleKey),
      p_max_attempts: target.rule.maxAttempts,
      p_window_seconds: target.rule.windowSeconds,
      p_block_seconds: target.rule.blockSeconds,
    });

    // Le compteur est injoignable : on laisse passer plutôt que de fermer la
    // connexion à tout le monde. C'est un arbitrage assumé — un limiteur en
    // panne ne doit pas devenir une panne d'authentification.
    if (error) {
      console.error("[rate-limit] compteur injoignable :", error.message);
      continue;
    }

    if (data) {
      const until = new Date(data as string);
      if (!latest || until > latest) latest = until;
    }
  }

  return latest;
}

/** Remet les compteurs à zéro après une tentative réussie. */
export async function clearRateLimit(targets: RateLimitTarget[]): Promise<void> {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;

  if (!serviceRoleKey) {
    for (const target of targets) memoryBuckets.delete(bucketKey(target, null));
    return;
  }

  const admin = createAdminClient();
  for (const target of targets) {
    const { error } = await admin.rpc("auth_rate_limit_clear", {
      p_bucket: bucketKey(target, serviceRoleKey),
    });
    if (error) console.error("[rate-limit] purge impossible :", error.message);
  }
}

/** « Trop de tentatives. Réessayez dans 12 minutes. » */
export function rateLimitMessage(blockedUntil: Date): string {
  const seconds = Math.max(0, Math.ceil((blockedUntil.getTime() - Date.now()) / 1000));
  const minutes = Math.ceil(seconds / 60);
  const delay =
    minutes <= 1 ? "une minute" : `${minutes} minutes`;
  return `Trop de tentatives. Réessayez dans ${delay}.`;
}
