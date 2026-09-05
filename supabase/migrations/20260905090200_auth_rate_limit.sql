-- ===========================================================================
-- Phase 2 — Limitation de débit sur la connexion et l'inscription
--
-- Pourquoi en base et pas en mémoire : l'application est déployée sur Vercel,
-- donc répartie sur des instances sans état partagé. Un compteur en mémoire
-- ne protège rien — il suffit que deux requêtes tombent sur deux instances.
-- Postgres est le seul point commun.
--
-- ---------------------------------------------------------------------------
-- QUI PEUT APPELER
-- ---------------------------------------------------------------------------
-- Personne côté navigateur. Ni GRANT sur la table, ni GRANT sur les
-- fonctions pour `anon` / `authenticated` : seule la CLÉ SERVICE ROLE, donc
-- seul le serveur Next.js, peut compter et bloquer.
--
-- C'est délibéré. Une fonction ouverte à `anon` permettrait à n'importe qui
-- de faire bloquer l'adresse e-mail d'un tiers en appelant l'API REST
-- publique — un déni de service sur la victime de son choix. Voir
-- `src/lib/auth/rate-limit.ts`.
-- ===========================================================================

create table auth_rate_limits (
  -- Clé du seau, ex. « login:email:a@b.fr » ou « signup:ip:1.2.3.4 ».
  -- L'e-mail y figure normalisé (minuscules) ; la table est purgée en
  -- continu, elle ne constitue pas un fichier de comptes.
  bucket text primary key,
  attempts int not null default 0,
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

create index auth_rate_limits_updated_at_idx on auth_rate_limits (updated_at);

-- RLS activé sans aucune policy : refus par défaut pour tout rôle client.
-- La clé service role contourne le RLS, c'est le seul accès prévu.
alter table auth_rate_limits enable row level security;

-- ---------------------------------------------------------------------------
-- Enregistrer une tentative
-- ---------------------------------------------------------------------------
-- Renvoie NULL si l'action est autorisée, sinon l'instant de fin de blocage.
--
-- ATOMICITÉ : `insert ... on conflict do update` pose un verrou de ligne. Des
-- tentatives simultanées sur le même seau se sérialisent, aucune ne se perd.
create or replace function auth_rate_limit_hit(
  p_bucket         text,
  p_max_attempts   int,
  p_window_seconds int,
  p_block_seconds  int
) returns timestamptz
language plpgsql as $$
declare
  v_now    timestamptz := now();
  v_window interval := make_interval(secs => p_window_seconds);
  v_row    auth_rate_limits;
  v_blocked boolean;
begin
  insert into auth_rate_limits (bucket, attempts, window_started_at, updated_at)
  values (p_bucket, 1, v_now, v_now)
  on conflict (bucket) do update set
    -- Un blocage en cours fige le compteur : inutile de le gonfler, et cela
    -- évite qu'un flot continu de tentatives prolonge le blocage sans fin.
    attempts = case
      when auth_rate_limits.blocked_until > v_now then auth_rate_limits.attempts
      when auth_rate_limits.window_started_at < v_now - v_window then 1
      else auth_rate_limits.attempts + 1
    end,
    window_started_at = case
      when auth_rate_limits.blocked_until > v_now then auth_rate_limits.window_started_at
      when auth_rate_limits.window_started_at < v_now - v_window then v_now
      else auth_rate_limits.window_started_at
    end,
    -- Le blocage échu est effacé en même temps que la fenêtre repart.
    blocked_until = case
      when auth_rate_limits.blocked_until > v_now then auth_rate_limits.blocked_until
      when auth_rate_limits.window_started_at < v_now - v_window then null
      else auth_rate_limits.blocked_until
    end,
    updated_at = v_now
  returning * into v_row;

  v_blocked := v_row.blocked_until is not null and v_row.blocked_until > v_now;

  if not v_blocked and v_row.attempts >= p_max_attempts then
    update auth_rate_limits
    set blocked_until = v_now + make_interval(secs => p_block_seconds),
        updated_at = v_now
    where bucket = p_bucket
    returning blocked_until into v_row.blocked_until;
    v_blocked := true;
  end if;

  if v_blocked then
    return v_row.blocked_until;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Effacer un seau (tentative réussie)
-- ---------------------------------------------------------------------------
-- Une connexion réussie remet le compteur à zéro : le plafond vise les
-- échecs répétés, pas l'usage normal.
--
-- Purge opportuniste au passage : les seaux inactifs depuis 24 h n'ont plus
-- de valeur. Cela évite d'avoir à programmer une tâche planifiée pour une
-- table qui, sinon, ne ferait que grossir.
create or replace function auth_rate_limit_clear(p_bucket text) returns void
language plpgsql as $$
begin
  delete from auth_rate_limits where bucket = p_bucket;
  delete from auth_rate_limits
  where updated_at < now() - interval '24 hours'
    and (blocked_until is null or blocked_until < now());
end;
$$;

revoke all on function auth_rate_limit_hit(text, int, int, int)
  from public, anon, authenticated;
revoke all on function auth_rate_limit_clear(text)
  from public, anon, authenticated;

grant execute on function auth_rate_limit_hit(text, int, int, int) to service_role;
grant execute on function auth_rate_limit_clear(text) to service_role;
