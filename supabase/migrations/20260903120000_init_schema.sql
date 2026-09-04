-- ===========================================================================
-- Phase 1 — Schéma initial
--
-- Locale active : FRANCE. Les colonnes d'identité du vendeur correspondent
-- exactement aux clés déclarées dans `src/lib/locale/fr.ts`
-- (sellerIdentityFields) : name, address, siret, legal_form, capital,
-- rcs_city, vat_number. Ajouter un pays = ajouter ses colonnes par migration
-- + son fichier de config TypeScript.
--
-- Montants en numeric(14,3) : 3 décimales de réserve pour rester compatible
-- avec les devises à 3 décimales (TND). L'arrondi effectif est appliqué à la
-- finalisation selon `LocaleConfig.decimals` (2 en France) — voir
-- `finalize_invoice()`.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type user_role as enum ('super_admin', 'garage');

create type invoice_status as enum ('draft', 'final', 'cancelled');

create type payment_method as enum ('especes', 'virement', 'cheque', 'cb', 'autre');

-- Crochet e-facture (phase 2) : cycle de vie Factur-X / PPF / PA.
create type einvoice_status as enum ('none', 'generated', 'sent', 'accepted', 'rejected');

-- ---------------------------------------------------------------------------
-- garages — un garage = un locataire (tenant)
-- ---------------------------------------------------------------------------
create table garages (
  id uuid primary key default gen_random_uuid(),

  -- Identité légale du vendeur (mentions obligatoires, art. L441-9 c. com.)
  name text not null,          -- dénomination sociale
  legal_form text,             -- SARL, SAS, EURL, entreprise individuelle...
  siret text,                  -- 14 chiffres ; le SIREN = les 9 premiers
  vat_number text,             -- TVA intracommunautaire, ex. FR12345678901
  rcs_city text,               -- ex. « RCS Lyon 812 345 678 »
  capital text,                -- capital social (texte : « 10 000 € »)

  address text,
  phone text,
  email text,
  iban text,
  bic text,

  -- Locale de facturation. Pilote devise, décimales, taux de TVA et mentions.
  locale text not null default 'FR',

  -- Franchise en base de TVA (art. 293 B du CGI). Si true : la facture
  -- n'affiche aucune TVA et porte la mention « TVA non applicable ».
  vat_exempt boolean not null default false,

  -- Conditions de règlement par défaut, reprises sur chaque facture.
  payment_term_days int not null default 30,
  late_payment_penalty_rate numeric(5,2) not null default 10.00,
  recovery_indemnity numeric(14,3) not null default 40.000,

  -- Drapeau « premium » : débloque la bibliothèque de logos et le sélecteur
  -- de logo par facture. Ce n'est PAS un rôle.
  logo_management_enabled boolean not null default false,

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint garages_payment_term_ck check (payment_term_days between 0 and 365),
  constraint garages_penalty_rate_ck check (late_payment_penalty_rate >= 0)
);

-- Le format du SIRET / n° de TVA n'est volontairement PAS contraint en base :
-- l'application avertit sans bloquer (un garage peut être créé avant d'avoir
-- toutes ses pièces). La validation stricte vit dans les schémas zod.
comment on column garages.siret is
  'SIRET 14 chiffres. Format validé côté application (avertissement, non bloquant).';

-- ---------------------------------------------------------------------------
-- profiles — lien entre un compte Auth et son rôle / son garage
-- ---------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'garage',
  garage_id uuid references garages(id) on delete cascade,
  full_name text,

  -- Force le changement du mot de passe initial fixé par l'admin.
  must_change_password boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Invariant central de l'isolation : un super_admin n'appartient à aucun
  -- garage, un garage appartient toujours à exactement un garage.
  constraint profiles_role_garage_ck check (
    (role = 'super_admin' and garage_id is null)
    or (role = 'garage' and garage_id is not null)
  )
);

create index profiles_garage_id_idx on profiles (garage_id);

-- ---------------------------------------------------------------------------
-- subscriptions — abonnement courant d'un garage (une ligne par garage)
-- ---------------------------------------------------------------------------
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  garage_id uuid not null unique references garages(id) on delete cascade,
  start_date date not null default current_date,
  end_date date not null,
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now(),

  constraint subscriptions_period_ck check (end_date >= start_date)
);

-- ---------------------------------------------------------------------------
-- payments — historique des règlements / prolongations
-- ---------------------------------------------------------------------------
create table payments (
  id uuid primary key default gen_random_uuid(),
  garage_id uuid not null references garages(id) on delete cascade,
  amount numeric(14,3),
  method payment_method not null default 'virement',
  months_added int,
  notes text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index payments_garage_id_created_at_idx on payments (garage_id, created_at desc);

-- ---------------------------------------------------------------------------
-- logos — bibliothèque de logos (un seul par défaut par garage)
-- ---------------------------------------------------------------------------
create table logos (
  id uuid primary key default gen_random_uuid(),
  garage_id uuid not null references garages(id) on delete cascade,
  storage_path text not null,   -- chemin dans le bucket privé « logos »
  label text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index logos_garage_id_idx on logos (garage_id);

-- Au plus un logo par défaut par garage.
create unique index logos_one_default_per_garage_idx
  on logos (garage_id) where is_default;

-- ---------------------------------------------------------------------------
-- clients — carnet d'adresses réutilisable (facultatif)
-- ---------------------------------------------------------------------------
create table clients (
  id uuid primary key default gen_random_uuid(),
  garage_id uuid not null references garages(id) on delete cascade,
  name text not null,
  address text,
  phone text,
  email text,
  vat_number text,   -- TVA intracommunautaire (B2B)
  siret text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index clients_garage_id_idx on clients (garage_id);
create index clients_garage_id_name_idx on clients (garage_id, lower(name));

-- ---------------------------------------------------------------------------
-- services — catalogue de prestations réutilisables
-- ---------------------------------------------------------------------------
create table services (
  id uuid primary key default gen_random_uuid(),
  garage_id uuid not null references garages(id) on delete cascade,
  label text not null,
  default_unit text not null default 'U',
  default_price_ht numeric(14,3) not null default 0,
  default_vat_rate numeric(5,2) not null default 20,   -- taux normal France
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint services_vat_rate_ck check (default_vat_rate between 0 and 100)
);

create index services_garage_id_idx on services (garage_id);
create index services_garage_id_label_idx on services (garage_id, lower(label));

-- ---------------------------------------------------------------------------
-- invoices — factures
-- ---------------------------------------------------------------------------
create table invoices (
  id uuid primary key default gen_random_uuid(),
  garage_id uuid not null references garages(id) on delete cascade,

  -- NULL tant que la facture est un brouillon : le numéro n'est consommé
  -- qu'à la finalisation, pour garantir une série sans trou.
  number text,
  series text not null default 'A',

  issue_date date not null default current_date,
  service_date date,        -- date de la prestation (mention obligatoire)
  due_date date,            -- date limite de règlement

  -- Client : recopié sur la facture (le carnet n'est qu'une commodité de
  -- saisie ; une facture émise ne doit pas bouger si la fiche client change).
  client_id uuid references clients(id) on delete set null,
  client_name text,
  client_address text,
  client_phone text,
  client_vat_number text,

  -- Vendeur : figé à la finalisation. Si le garage déménage ou change de
  -- forme juridique, les factures déjà émises conservent les mentions
  -- exactes du jour de l'émission.
  seller_snapshot jsonb,

  logo_id uuid references logos(id) on delete set null,

  locale text not null default 'FR',
  currency text not null default 'EUR',

  -- Recopié du garage à la finalisation : une facture émise en franchise
  -- reste en franchise même si le garage devient assujetti ensuite.
  vat_exempt boolean not null default false,

  -- Totaux : recalculés côté serveur, jamais acceptés du navigateur.
  subtotal_ht numeric(14,3) not null default 0,
  vat_total numeric(14,3) not null default 0,
  -- Droit de timbre : toujours 0 en France. La colonne n'existe que pour le
  -- multi-locale (pilotée par LocaleConfig.hasStampDuty).
  stamp_duty numeric(14,3) not null default 0,
  total_ttc numeric(14,3) not null default 0,
  -- Détail par taux : [{ "rate": 20, "base_ht": 100, "vat_amount": 20 }, ...]
  -- Structure réutilisée telle quelle par le futur export Factur-X.
  vat_breakdown jsonb not null default '[]'::jsonb,

  -- Conditions de règlement recopiées du garage (mentions obligatoires).
  payment_term_days int,
  late_payment_penalty_rate numeric(5,2),
  recovery_indemnity numeric(14,3),

  status invoice_status not null default 'draft',
  notes text,

  finalized_at timestamptz,
  cancelled_at timestamptz,

  -- Crochets e-facture (phase 2) : Factur-X, PPF, Plateforme Agréée.
  facturx_status einvoice_status not null default 'none',
  facturx_xml_path text,
  pa_reference text,
  ppf_reference text,

  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Unicité du numéro dans un garage. Les NULL (brouillons) sont considérés
  -- distincts par Postgres : plusieurs brouillons coexistent sans conflit.
  constraint invoices_garage_number_uk unique (garage_id, number),

  -- Une facture finalisée porte forcément un numéro et une date de
  -- finalisation ; un brouillon n'en a jamais.
  constraint invoices_number_status_ck check (
    (status = 'draft' and number is null and finalized_at is null)
    or (status <> 'draft' and number is not null and finalized_at is not null)
  )
);

create index invoices_garage_id_issue_date_idx on invoices (garage_id, issue_date desc);
create index invoices_garage_id_status_idx on invoices (garage_id, status);
create index invoices_client_id_idx on invoices (client_id);

-- ---------------------------------------------------------------------------
-- invoice_lines — lignes de prestation
-- ---------------------------------------------------------------------------
create table invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  description text not null,
  unit text not null default 'U',
  quantity numeric(12,3) not null default 1,
  unit_price_ht numeric(14,3) not null default 0,
  vat_rate numeric(5,2) not null default 20,
  position int not null default 0,

  -- Colonne générée : le total de ligne ne peut pas diverger de ses facteurs.
  line_total_ht numeric(14,3)
    generated always as (round(quantity * unit_price_ht, 3)) stored,

  constraint invoice_lines_vat_rate_ck check (vat_rate between 0 and 100),
  constraint invoice_lines_quantity_ck check (quantity >= 0)
);

create index invoice_lines_invoice_id_position_idx on invoice_lines (invoice_id, position);

-- ---------------------------------------------------------------------------
-- invoice_counters — compteur de numérotation, par garage et par année
-- ---------------------------------------------------------------------------
create table invoice_counters (
  garage_id uuid not null references garages(id) on delete cascade,
  year int not null,
  last_number int not null default 0,
  primary key (garage_id, year)
);

-- ---------------------------------------------------------------------------
-- updated_at automatique
-- ---------------------------------------------------------------------------
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger garages_set_updated_at
  before update on garages for each row execute function set_updated_at();
create trigger profiles_set_updated_at
  before update on profiles for each row execute function set_updated_at();
create trigger clients_set_updated_at
  before update on clients for each row execute function set_updated_at();
create trigger services_set_updated_at
  before update on services for each row execute function set_updated_at();
create trigger invoices_set_updated_at
  before update on invoices for each row execute function set_updated_at();
