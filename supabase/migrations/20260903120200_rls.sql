-- ===========================================================================
-- Phase 1 — Row Level Security
--
-- L'isolation entre garages repose ENTIÈREMENT sur ces policies : aucune
-- requête applicative ne doit avoir à filtrer sur `garage_id` pour être sûre.
--
-- Deux principes déclinés partout :
--   1. lecture  : `is_admin() or garage_id = my_garage_id()`
--   2. écriture : idem + abonnement actif pour les tables métier
--      (`my_subscription_is_active()`), ce qui matérialise le passage en
--      lecture seule quand l'abonnement expire.
--
-- Une action sans policy est REFUSÉE : c'est le cas voulu pour
-- `invoice_counters`, que seule `finalize_invoice()` peut incrémenter.
-- ===========================================================================

alter table garages           enable row level security;
alter table profiles          enable row level security;
alter table subscriptions     enable row level security;
alter table payments          enable row level security;
alter table logos             enable row level security;
alter table clients           enable row level security;
alter table services          enable row level security;
alter table invoices          enable row level security;
alter table invoice_lines     enable row level security;
alter table invoice_counters  enable row level security;

-- Les GRANT ouvrent la porte, le RLS décide qui passe. Sans GRANT, les
-- policies ne seraient jamais évaluées ; sans RLS, le GRANT donnerait tout.
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  garages, profiles, subscriptions, payments, logos,
  clients, services, invoices, invoice_lines
  to authenticated;
grant select on invoice_counters to authenticated;

-- ---------------------------------------------------------------------------
-- garages
-- ---------------------------------------------------------------------------
-- Un garage lit sa propre fiche (pour l'afficher sur ses factures) mais ne la
-- modifie pas : l'identité légale du vendeur — SIRET, RCS, capital — est
-- renseignée et maintenue par l'administrateur.
create policy "garages_select" on garages
  for select to authenticated
  using (is_admin() or id = my_garage_id());

create policy "garages_admin_write" on garages
  for all to authenticated
  using (is_admin())
  with check (is_admin());

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy "profiles_select_self_or_admin" on profiles
  for select to authenticated
  using (id = auth.uid() or is_admin());

create policy "profiles_update_self_or_admin" on profiles
  for update to authenticated
  using (id = auth.uid() or is_admin())
  with check (id = auth.uid() or is_admin());

create policy "profiles_admin_insert" on profiles
  for insert to authenticated
  with check (is_admin());

create policy "profiles_admin_delete" on profiles
  for delete to authenticated
  using (is_admin());

-- Le RLS raisonne par ligne, pas par colonne : sans ce garde-fou, un
-- utilisateur autorisé à modifier SA ligne pourrait s'attribuer
-- `role = 'super_admin'` ou se rattacher à un autre garage. Escalade de
-- privilège fermée ici, au plus près de la donnée.
create or replace function profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if is_admin() then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'Modification du rôle réservée à l''administrateur.'
      using errcode = '42501';
  end if;

  if new.garage_id is distinct from old.garage_id then
    raise exception 'Changement de garage réservé à l''administrateur.'
      using errcode = '42501';
  end if;

  if new.id is distinct from old.id then
    raise exception 'Identifiant de profil non modifiable.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger profiles_guard_trg
  before update on profiles
  for each row execute function profiles_guard();

-- ---------------------------------------------------------------------------
-- subscriptions — le garage consulte, l'admin décide
-- ---------------------------------------------------------------------------
create policy "subscriptions_select" on subscriptions
  for select to authenticated
  using (is_admin() or garage_id = my_garage_id());

create policy "subscriptions_admin_write" on subscriptions
  for all to authenticated
  using (is_admin())
  with check (is_admin());

-- ---------------------------------------------------------------------------
-- payments — même logique : historique visible, écriture réservée
-- ---------------------------------------------------------------------------
create policy "payments_select" on payments
  for select to authenticated
  using (is_admin() or garage_id = my_garage_id());

create policy "payments_admin_write" on payments
  for all to authenticated
  using (is_admin())
  with check (is_admin());

-- ---------------------------------------------------------------------------
-- logos — écriture réservée aux garages « premium »
-- ---------------------------------------------------------------------------
create policy "logos_select" on logos
  for select to authenticated
  using (is_admin() or garage_id = my_garage_id());

create policy "logos_write" on logos
  for all to authenticated
  using (
    is_admin()
    or (garage_id = my_garage_id() and can_manage_logos())
  )
  with check (
    is_admin()
    or (garage_id = my_garage_id() and can_manage_logos())
  );

-- ---------------------------------------------------------------------------
-- clients — carnet d'adresses du garage
-- ---------------------------------------------------------------------------
create policy "clients_select" on clients
  for select to authenticated
  using (is_admin() or garage_id = my_garage_id());

create policy "clients_write" on clients
  for all to authenticated
  using (
    is_admin()
    or (garage_id = my_garage_id() and my_subscription_is_active())
  )
  with check (
    is_admin()
    or (garage_id = my_garage_id() and my_subscription_is_active())
  );

-- ---------------------------------------------------------------------------
-- services — catalogue de prestations
-- ---------------------------------------------------------------------------
create policy "services_select" on services
  for select to authenticated
  using (is_admin() or garage_id = my_garage_id());

create policy "services_write" on services
  for all to authenticated
  using (
    is_admin()
    or (garage_id = my_garage_id() and my_subscription_is_active())
  )
  with check (
    is_admin()
    or (garage_id = my_garage_id() and my_subscription_is_active())
  );

-- ---------------------------------------------------------------------------
-- invoices
-- ---------------------------------------------------------------------------
create policy "invoices_select" on invoices
  for select to authenticated
  using (is_admin() or garage_id = my_garage_id());

-- Abonnement expiré => plus aucune création : l'espace passe en lecture seule.
create policy "invoices_insert" on invoices
  for insert to authenticated
  with check (
    is_admin()
    or (garage_id = my_garage_id() and my_subscription_is_active())
  );

-- Le `using` empêche de toucher la facture d'un autre garage ; le
-- `with check` empêche de la déplacer vers un autre garage. L'immuabilité
-- des factures émises est assurée en plus par le trigger `invoices_guard`.
create policy "invoices_update" on invoices
  for update to authenticated
  using (
    is_admin()
    or (garage_id = my_garage_id() and my_subscription_is_active())
  )
  with check (
    is_admin()
    or (garage_id = my_garage_id() and my_subscription_is_active())
  );

create policy "invoices_delete" on invoices
  for delete to authenticated
  using (
    is_admin()
    or (garage_id = my_garage_id() and my_subscription_is_active())
  );

-- ---------------------------------------------------------------------------
-- invoice_lines — l'appartenance remonte à la facture parente
-- ---------------------------------------------------------------------------
create policy "invoice_lines_select" on invoice_lines
  for select to authenticated
  using (
    exists (
      select 1 from invoices i
      where i.id = invoice_lines.invoice_id
        and (is_admin() or i.garage_id = my_garage_id())
    )
  );

create policy "invoice_lines_insert" on invoice_lines
  for insert to authenticated
  with check (
    exists (
      select 1 from invoices i
      where i.id = invoice_lines.invoice_id
        and (is_admin() or (i.garage_id = my_garage_id() and my_subscription_is_active()))
    )
  );

create policy "invoice_lines_update" on invoice_lines
  for update to authenticated
  using (
    exists (
      select 1 from invoices i
      where i.id = invoice_lines.invoice_id
        and (is_admin() or (i.garage_id = my_garage_id() and my_subscription_is_active()))
    )
  )
  with check (
    exists (
      select 1 from invoices i
      where i.id = invoice_lines.invoice_id
        and (is_admin() or (i.garage_id = my_garage_id() and my_subscription_is_active()))
    )
  );

create policy "invoice_lines_delete" on invoice_lines
  for delete to authenticated
  using (
    exists (
      select 1 from invoices i
      where i.id = invoice_lines.invoice_id
        and (is_admin() or (i.garage_id = my_garage_id() and my_subscription_is_active()))
    )
  );

-- ---------------------------------------------------------------------------
-- invoice_counters — lecture seule côté client
-- ---------------------------------------------------------------------------
-- Aucune policy d'écriture : le compteur n'est modifiable que par
-- `finalize_invoice()`, qui s'exécute en SECURITY DEFINER.
create policy "invoice_counters_select" on invoice_counters
  for select to authenticated
  using (is_admin() or garage_id = my_garage_id());
