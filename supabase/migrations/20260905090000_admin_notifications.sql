-- ===========================================================================
-- Phase 2 — Notifications de l'administrateur
--
-- Journal d'événements destiné au super administrateur : inscription en
-- ligne vérifiée, changement de mot de passe par un garage, réinitialisation
-- par l'admin, essai gratuit épuisé.
--
-- ---------------------------------------------------------------------------
-- RÈGLE ABSOLUE : AUCUN SECRET DANS UNE NOTIFICATION
-- ---------------------------------------------------------------------------
-- `message` et `metadata` décrivent l'ÉVÉNEMENT, jamais sa valeur. Un mot de
-- passe — choisi par un garage ou généré temporairement par l'admin — ne
-- transite JAMAIS par cette table. Le hachage est l'affaire exclusive de
-- Supabase Auth ; l'application ne stocke aucun mot de passe, nulle part.
--
-- Les notifications ne sont écrites que par des fonctions SECURITY DEFINER :
-- aucun GRANT d'INSERT n'est accordé aux clients, pour qu'un garage ne
-- puisse pas forger un événement qui n'a pas eu lieu.
-- ===========================================================================

create type admin_notification_type as enum (
  'garage_signup',            -- inscription en ligne, e-mail vérifié
  'password_changed',         -- un garage a modifié son mot de passe
  'password_reset_by_admin',  -- l'admin a généré un mot de passe temporaire
  'trial_exhausted'           -- l'essai gratuit vient d'être consommé
);

create table admin_notifications (
  id uuid primary key default gen_random_uuid(),
  type admin_notification_type not null,

  garage_id uuid references garages(id) on delete set null,
  actor_id  uuid references profiles(id) on delete set null,

  -- Phrase prête à afficher. Contient le QUOI, jamais le SECRET.
  message text not null,
  -- Contexte non sensible (e-mail du compte, compteurs). Jamais de mot de passe.
  metadata jsonb not null default '{}'::jsonb,

  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index admin_notifications_created_at_idx on admin_notifications (created_at desc);
create index admin_notifications_unread_idx on admin_notifications (created_at desc)
  where read_at is null;
create index admin_notifications_garage_id_idx on admin_notifications (garage_id);

comment on column admin_notifications.message is
  'Description de l''événement. Ne doit JAMAIS contenir de mot de passe.';

-- ---------------------------------------------------------------------------
-- RLS — lecture et gestion réservées à l'administrateur
-- ---------------------------------------------------------------------------
alter table admin_notifications enable row level security;

-- Pas d'INSERT dans le GRANT : la porte est fermée pour tout le monde, y
-- compris l'admin. Seules les fonctions SECURITY DEFINER ci-dessous écrivent.
grant select, update, delete on admin_notifications to authenticated;

create policy "admin_notifications_select" on admin_notifications
  for select to authenticated using (is_admin());

-- L'admin ne peut que marquer comme lu : le contenu de l'événement n'est pas
-- réécrivable (journal d'audit) — garanti par le trigger ci-dessous.
create policy "admin_notifications_update" on admin_notifications
  for update to authenticated using (is_admin()) with check (is_admin());

create policy "admin_notifications_delete" on admin_notifications
  for delete to authenticated using (is_admin());

create or replace function admin_notifications_guard() returns trigger
language plpgsql as $$
begin
  if new.type       is distinct from old.type
     or new.message    is distinct from old.message
     or new.metadata   is distinct from old.metadata
     or new.created_at is distinct from old.created_at then
    raise exception 'Une notification est un journal : seule sa lecture (read_at) évolue.';
  end if;

  -- Les deux clés étrangères sont en `on delete set null` : supprimer un
  -- compte ou un garage DOIT rester possible, sinon le journal prendrait en
  -- otage toute suppression. On autorise donc le détachement (vers NULL) —
  -- mais jamais la réattribution d'un événement à quelqu'un d'autre, qui
  -- serait une falsification.
  if new.garage_id is distinct from old.garage_id and new.garage_id is not null then
    raise exception 'Une notification ne peut pas être réattribuée à un autre garage.';
  end if;
  if new.actor_id is distinct from old.actor_id and new.actor_id is not null then
    raise exception 'Une notification ne peut pas être réattribuée à un autre compte.';
  end if;

  return new;
end;
$$;

create trigger admin_notifications_guard_trg
  before update on admin_notifications
  for each row execute function admin_notifications_guard();

-- ---------------------------------------------------------------------------
-- Écriture : uniquement par fonction SECURITY DEFINER
-- ---------------------------------------------------------------------------
-- Point d'entrée interne. Non exposé aux clients : il permettrait d'écrire un
-- message arbitraire dans le journal de l'administrateur.
create or replace function notify_admin(
  p_type      admin_notification_type,
  p_garage_id uuid,
  p_actor_id  uuid,
  p_message   text,
  p_metadata  jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into admin_notifications (type, garage_id, actor_id, message, metadata)
  values (p_type, p_garage_id, p_actor_id, p_message, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function notify_admin(admin_notification_type, uuid, uuid, text, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- « Le garage X a modifié son mot de passe »
-- ---------------------------------------------------------------------------
-- Appelée par le garage lui-même, juste après un changement réussi. Aucun
-- paramètre : rien n'est falsifiable, tout est relu depuis le serveur
-- (`auth.uid()` -> profiles -> garages). La date affichée vient de
-- `created_at`, formatée côté TypeScript selon la locale active.
create or replace function notify_password_changed() returns void
language plpgsql security definer set search_path = public as $$
declare
  v_profile profiles;
  v_garage  garages;
  v_email   text;
begin
  select * into v_profile from profiles where id = auth.uid();
  if not found then
    raise exception 'Aucun profil pour la session courante.' using errcode = '42501';
  end if;

  -- L'administrateur ne se notifie pas lui-même.
  if v_profile.role <> 'garage' then
    return;
  end if;

  select * into v_garage from garages where id = v_profile.garage_id;
  select u.email into v_email from auth.users u where u.id = v_profile.id;

  perform notify_admin(
    'password_changed',
    v_garage.id,
    v_profile.id,
    format('Le garage « %s » a modifié son mot de passe.',
           coalesce(v_garage.name, 'sans nom')),
    -- Aucun mot de passe ici : uniquement de quoi identifier le compte.
    jsonb_build_object('email', v_email)
  );
end;
$$;

grant execute on function notify_password_changed() to authenticated;

-- ---------------------------------------------------------------------------
-- « L'administrateur a réinitialisé le mot de passe du garage X »
-- ---------------------------------------------------------------------------
-- Le mot de passe temporaire est généré côté application (clé service role)
-- et remis à l'admin pour transmission au garage. Il n'est PAS journalisé.
create or replace function notify_password_reset(p_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_profile profiles;
  v_garage  garages;
  v_email   text;
begin
  if not is_admin() then
    raise exception 'Réservé à l''administrateur.' using errcode = '42501';
  end if;

  select * into v_profile from profiles where id = p_user_id;
  if not found then
    raise exception 'Profil introuvable.' using errcode = 'P0002';
  end if;

  select * into v_garage from garages where id = v_profile.garage_id;
  select u.email into v_email from auth.users u where u.id = p_user_id;

  perform notify_admin(
    'password_reset_by_admin',
    v_garage.id,
    auth.uid(),
    format('Mot de passe temporaire généré pour « %s ». Changement forcé à la prochaine connexion.',
           coalesce(v_garage.name, v_email, 'compte')),
    jsonb_build_object('email', v_email, 'target_user_id', p_user_id)
  );
end;
$$;

grant execute on function notify_password_reset(uuid) to authenticated;
