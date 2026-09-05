-- Reproduction minimale de l'environnement Supabase pour tester les
-- migrations hors ligne : rôles, schéma auth, schéma storage.
-- NE FAIT PAS PARTIE DU PROJET — outil de vérification local uniquement.

create extension if not exists pgcrypto;

-- Rôles Supabase
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant anon, authenticated, service_role to postgres;

-- ---------------------------------------------------------------------------
-- Droits par défaut du schéma public
-- ---------------------------------------------------------------------------
-- Sur un projet Supabase, TOUTE table créée dans `public` est automatiquement
-- accessible aux rôles clients : seul le RLS la retient. Sans reproduire ce
-- réglage, le stub serait moins exigeant que la production — une table dont on
-- aurait oublié le RLS passerait le test local (faute de GRANT) et céderait
-- une fois déployée.
--
-- Le reproduire rend le test fidèle : c'est le RLS, et lui seul, qui doit
-- fermer la porte.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Schéma auth
-- ---------------------------------------------------------------------------
create schema if not exists auth;

create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key,
  aud varchar(255),
  role varchar(255),
  email varchar(255) unique,
  encrypted_password varchar(255),
  email_confirmed_at timestamptz,
  -- Métadonnées libres fournies à l'inscription (options.data de signUp).
  -- Fournies par le client : jamais une source d'autorisation.
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

-- Définition identique à celle de Supabase : l'identité vient du JWT.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
    ),
    ''
  )::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Schéma storage
-- ---------------------------------------------------------------------------
create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz default now()
);

alter table storage.objects enable row level security;

-- Découpe le chemin en segments et retire le nom de fichier : pour
-- « {garage_id}/logo.png », renvoie ARRAY['{garage_id}'].
create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable as $$
declare
  parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[1 : array_length(parts, 1) - 1];
end;
$$;

grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
