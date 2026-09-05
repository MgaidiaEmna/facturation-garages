-- ===========================================================================
-- COMPORTEMENT DU LIMITEUR DE DÉBIT
--
-- `rls_isolation.sql` prouve que les compteurs sont HORS DE PORTÉE des
-- clients (section 17). Ce fichier-ci prouve qu'ils COMPTENT JUSTE : un
-- limiteur inaccessible mais qui ne bloque jamais ne protège de rien.
--
-- EXÉCUTION :
--   psql "$DATABASE_URL" -f supabase/tests/rate_limit.sql
-- Sous Windows, exporter PGCLIENTENCODING=UTF8 au préalable.
--
-- Le script se termine par un ROLLBACK : il ne laisse aucune trace.
--
-- ---------------------------------------------------------------------------
-- VÉRIFIER QUE CE TEST SAIT ÉCHOUER
-- ---------------------------------------------------------------------------
-- Injecter juste après le `begin;` — le test DOIT alors s'interrompre. Les
-- quatre mutations ci-dessous ont été injectées et vérifiées :
--
--   1. Un limiteur qui ne bloque jamais           -> section 1 hurle
--      create or replace function auth_rate_limit_hit(
--        p_bucket text, p_max_attempts int, p_window_seconds int,
--        p_block_seconds int) returns timestamptz
--      language sql as $m$ select null::timestamptz $m$;
--
--   2. Une remise à zéro inopérante               -> section 2 hurle
--      create or replace function auth_rate_limit_clear(p_bucket text)
--      returns void language sql as $m$ select null::void $m$;
--
--   3. Des seaux non cloisonnés (tout dans « global »)  -> section 2 hurle
--   4. Un blocage prolongé à chaque tentative          -> section 1 hurle
--
-- Attention aux assertions portant sur le TEMPS : `now()` est figé pour toute
-- la durée d'une transaction. Une comparaison entre deux échéances calculées
-- ici est toujours vraie — elle ne sait pas échouer. Vieillir une ligne par
-- UPDATE, ou observer le compteur, sont les deux façons honnêtes de tester.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Le plafond bloque, et le blocage ne s'auto-prolonge pas
-- ---------------------------------------------------------------------------
do $$
declare
  i             int;
  v_until       timestamptz;
  v_first_block int := 0;
  v_attempts    int;
begin
  for i in 1..7 loop
    v_until := auth_rate_limit_hit('test:plafond', 5, 900, 900);
    if v_until is not null and v_first_block = 0 then
      v_first_block := i;
    end if;
  end loop;

  if v_first_block <> 5 then
    raise exception 'Blocage à la tentative % au lieu de la 5e.', v_first_block;
  end if;

  -- Un flot continu de tentatives ne doit pas repousser indéfiniment la fin
  -- du blocage : sinon un attaquant condamne une adresse pour toujours.
  --
  -- On l'observe sur le COMPTEUR, pas sur l'échéance : `now()` est figé pour
  -- toute la durée d'une transaction, donc comparer deux `blocked_until`
  -- calculés ici donnerait toujours l'égalité — une assertion qui ne peut pas
  -- échouer. Le compteur, lui, est gelé pendant un blocage par le `case` de
  -- `auth_rate_limit_hit()` : c'est précisément ce qui empêche la
  -- prolongation, et c'est vérifiable.
  select attempts into v_attempts from auth_rate_limits where bucket = 'test:plafond';
  if v_attempts <> 5 then
    raise exception 'Le compteur continue de monter pendant le blocage : % au lieu de 5.',
      v_attempts;
  end if;

  raise notice '1. Plafond atteint, blocage stable ....... OK';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Une tentative réussie remet le compteur à zéro
-- ---------------------------------------------------------------------------
-- Le plafond vise les échecs répétés, pas l'usage normal : quelqu'un qui se
-- trompe deux fois puis réussit ne doit pas rester à deux doigts du blocage.
do $$
begin
  perform auth_rate_limit_hit('test:reussite', 5, 900, 900);
  perform auth_rate_limit_hit('test:reussite', 5, 900, 900);
  perform auth_rate_limit_clear('test:reussite');

  if exists (select 1 from auth_rate_limits where bucket = 'test:reussite') then
    raise exception 'Le seau survit à une tentative réussie.';
  end if;

  if auth_rate_limit_hit('test:reussite', 5, 900, 900) is not null then
    raise exception 'Le compteur bloque après avoir été remis à zéro.';
  end if;

  raise notice '2. Remise à zéro après réussite .......... OK';
end $$;

-- ---------------------------------------------------------------------------
-- 3. Fenêtre glissante : le compteur repart, sans blocage résiduel
-- ---------------------------------------------------------------------------
do $$
declare v_attempts int;
begin
  for i in 1..4 loop
    perform auth_rate_limit_hit('test:fenetre', 5, 900, 900);
  end loop;

  -- On vieillit la fenêtre plutôt que d'attendre un quart d'heure.
  update auth_rate_limits
  set window_started_at = now() - interval '20 minutes'
  where bucket = 'test:fenetre';

  if auth_rate_limit_hit('test:fenetre', 5, 900, 900) is not null then
    raise exception 'Une fenêtre expirée bloque encore.';
  end if;

  select attempts into v_attempts from auth_rate_limits where bucket = 'test:fenetre';
  if v_attempts <> 1 then
    raise exception 'La fenêtre expirée repart à % au lieu de 1.', v_attempts;
  end if;

  raise notice '3. Fenêtre glissante ..................... OK';
end $$;

-- ---------------------------------------------------------------------------
-- 4. Le blocage s'efface tout seul une fois écoulé
-- ---------------------------------------------------------------------------
do $$
begin
  for i in 1..5 loop
    perform auth_rate_limit_hit('test:expiration', 5, 900, 900);
  end loop;

  if auth_rate_limit_hit('test:expiration', 5, 900, 900) is null then
    raise exception 'Jeu d''essai incohérent : le seau n''est pas bloqué.';
  end if;

  -- Blocage échu ET fenêtre expirée : le seau doit repartir de zéro.
  update auth_rate_limits
  set blocked_until = now() - interval '1 minute',
      window_started_at = now() - interval '20 minutes'
  where bucket = 'test:expiration';

  if auth_rate_limit_hit('test:expiration', 5, 900, 900) is not null then
    raise exception 'Le blocage survit à sa propre échéance.';
  end if;

  raise notice '4. Blocage échu, accès rendu ............. OK';
end $$;

-- ---------------------------------------------------------------------------
-- 5. Les seaux sont indépendants
-- ---------------------------------------------------------------------------
-- Sans cela, bloquer une adresse bloquerait tout le monde — ou pire, une
-- adresse saturée épargnerait le compteur d'IP.
do $$
begin
  for i in 1..5 loop
    perform auth_rate_limit_hit('test:cloison:a', 5, 900, 900);
  end loop;

  if auth_rate_limit_hit('test:cloison:b', 5, 900, 900) is not null then
    raise exception 'Le blocage d''un seau déborde sur un autre.';
  end if;

  raise notice '5. Cloisonnement des seaux ............... OK';
end $$;

-- ---------------------------------------------------------------------------
-- 6. Purge : les seaux inactifs ne s'accumulent pas
-- ---------------------------------------------------------------------------
do $$
begin
  perform auth_rate_limit_hit('test:vieux', 5, 900, 900);
  update auth_rate_limits
  set updated_at = now() - interval '48 hours', blocked_until = null
  where bucket = 'test:vieux';

  -- La purge est opportuniste : elle se déclenche sur une remise à zéro.
  perform auth_rate_limit_clear('test:declencheur');

  if exists (select 1 from auth_rate_limits where bucket = 'test:vieux') then
    raise exception 'Un seau inactif depuis 48 h n''a pas été purgé.';
  end if;

  raise notice '6. Purge des seaux inactifs .............. OK';
end $$;

do $$
begin
  raise notice '';
  raise notice '=== LIMITATION DE DÉBIT : TOUTES LES VÉRIFICATIONS PASSENT ===';
end $$;

rollback;
