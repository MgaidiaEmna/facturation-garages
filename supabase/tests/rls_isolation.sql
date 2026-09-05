-- ===========================================================================
-- PREUVE D'ISOLATION RLS
--
-- Démontre qu'un garage ne peut ni lire ni écrire les données d'un autre
-- garage, y compris par les tables filles ; et vérifie la numérotation,
-- l'immuabilité des factures émises, le blocage sur abonnement expiré et
-- l'impossibilité de s'auto-promouvoir administrateur.
--
-- EXÉCUTION : coller dans le SQL Editor Supabase, ou
--   psql "$DATABASE_URL" -f supabase/tests/rls_isolation.sql
--
-- Le script se termine par un ROLLBACK : il ne laisse aucune trace.
--
-- ---------------------------------------------------------------------------
-- POURQUOI `expect_blocked` ET PAS UN SIMPLE `begin ... exception ... end`
-- ---------------------------------------------------------------------------
-- Première version de ce test : chaque action interdite était tentée dans un
-- bloc `begin ... exception when raise_exception then null; end`, et le cas
-- « ça a marché » levait `raise exception 'FUITE'`. Or `raise exception` EST
-- un `raise_exception` : le gestionnaire avalait l'alerte qu'il était censé
-- laisser passer. Test de mutation à l'appui — garde-fou d'immuabilité
-- retiré, le test annonçait toujours « OK ».
--
-- `expect_blocked` lève l'alerte HORS du bloc protégé, avec un SQLSTATE
-- dédié (F0001) : elle ne peut plus être confondue avec un refus attendu.
-- Les erreurs d'une autre nature (colonne inexistante, faute de frappe)
-- remontent au lieu d'être prises pour un refus.
--
-- ---------------------------------------------------------------------------
-- VÉRIFIER QUE CE TEST SAIT ÉCHOUER (à refaire après toute modification)
-- ---------------------------------------------------------------------------
-- Insérer l'une de ces lignes juste après le `begin;` : le test DOIT alors
-- s'interrompre sur une FUITE.
--   drop trigger invoices_guard_trg on invoices;
--   drop policy "invoices_select" on invoices;
--   drop trigger profiles_guard_trg on profiles;
--   alter table invoice_lines disable row level security;
-- Phase 2 — chaque ligne a été injectée et vérifiée :
--   create or replace function my_garage_id() returns uuid language sql stable
--     security definer set search_path = public as
--     $m$ select garage_id from profiles where id = auth.uid() $m$;
--       retire la garde « e-mail vérifié »        -> section 11 hurle
--   create or replace function finalize_block_reason(g uuid) returns text
--     language sql stable security definer set search_path = public as
--     $m$ select null::text $m$;
--       retire le plafond d'essai                 -> section 13 hurle
--   drop trigger admin_notifications_guard_trg on admin_notifications;
--       rend le journal réécrivable               -> section 16 hurle
--   grant execute on function notify_admin(admin_notification_type, uuid, uuid,
--     text, jsonb) to authenticated;
--       laisse forger un événement                -> section 17 hurle
--   grant execute on function auth_rate_limit_hit(text,int,int,int) to authenticated;
--     grant select, insert, update on auth_rate_limits to authenticated;
--     create policy rl_open on auth_rate_limits for all to authenticated
--       using (true) with check (true);
--       ouvre les compteurs de limitation         -> section 17 hurle
--
--   PIÈGE : n'ouvrir que le GRANT sur `auth_rate_limit_hit` ne prouve RIEN.
--   La fonction échoue quand même sur l'absence de droits table + RLS, le
--   test annonce « bloqué » et il a raison — aucune frontière n'a bougé. Une
--   mutation utile OUVRE une frontière, elle ne gratte pas une des couches.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- Outil d'assertion
-- ---------------------------------------------------------------------------
create or replace function public.expect_blocked(p_sql text, p_label text)
returns void language plpgsql as $$
declare
  v_rows int := 0;
begin
  begin
    execute p_sql;
    get diagnostics v_rows = row_count;
  exception
    -- 42501 : refus par le RLS ou par un garde-fou d'autorisation.
    -- P0001 : refus par un trigger métier (immuabilité, transition de statut).
    when insufficient_privilege or raise_exception then
      return;
  end;

  -- Pas d'erreur : soit la ligne a été filtrée par le RLS (0 ligne touchée,
  -- ce qui est un refus valable), soit l'action est passée — et c'est une
  -- fuite. Le SQLSTATE dédié interdit toute confusion avec un refus attendu.
  if v_rows > 0 then
    raise exception 'FUITE : % — % ligne(s) affectée(s).', p_label, v_rows
      using errcode = 'F0001';
  end if;
end;
$$;

grant execute on function public.expect_blocked(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Jeu d'essai (créé en tant que propriétaire, hors RLS)
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000',
   'aaaaaaaa-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'garage-a@test.local', 'x', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   'bbbbbbbb-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'garage-b@test.local', 'x', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   'cccccccc-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'garage-c@test.local', 'x', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   'dddddddd-0000-0000-0000-000000000004', 'authenticated', 'authenticated',
   'admin@test.local', 'x', now(), now(), now()),
  -- E : garage D, inscrit en ligne, en essai gratuit.
  ('00000000-0000-0000-0000-000000000000',
   'eeeeeeee-0000-0000-0000-000000000005', 'authenticated', 'authenticated',
   'garage-d@test.local', 'x', now(), now(), now()),
  -- F : rattache au garage A mais e-mail JAMAIS confirme.
  ('00000000-0000-0000-0000-000000000000',
   'ffffffff-0000-0000-0000-000000000006', 'authenticated', 'authenticated',
   'non-verifie@test.local', 'x', null, now(), now()),
  -- G : inscription en ligne verifiee, pas encore provisionnee.
  ('00000000-0000-0000-0000-000000000000',
   '11111111-0000-0000-0000-000000000007', 'authenticated', 'authenticated',
   'gaelle@test.local', 'x', now(), now(), now()),
  -- H : compte verifie sans marqueur d'inscription en ligne (cas d'un compte
  -- cree par l'admin dont le profil manquerait).
  ('00000000-0000-0000-0000-000000000000',
   '22222222-0000-0000-0000-000000000008', 'authenticated', 'authenticated',
   'orphelin@test.local', 'x', now(), now(), now());

-- Metadonnees d'inscription : fournies par le NAVIGATEUR a signUp(). Elles ne
-- portent qu'une etiquette (le nom du garage) et le marqueur de provenance ;
-- le role et le statut sont poses par le SQL, jamais lus ici.
update auth.users set raw_user_meta_data =
  jsonb_build_object('signup_source', 'self', 'garage_name', 'Garage de Ga' || chr(235) || 'lle')
where id = '11111111-0000-0000-0000-000000000007';

insert into garages (id, name, siret, address, locale, logo_management_enabled)
values
  ('a0000000-0000-0000-0000-0000000000a1', 'Garage A', '11111111111111', '1 rue A', 'FR', true),
  ('b0000000-0000-0000-0000-0000000000b1', 'Garage B', '22222222222222', '2 rue B', 'FR', false),
  ('c0000000-0000-0000-0000-0000000000c1', 'Garage C', '33333333333333', '3 rue C', 'FR', false);

-- Garage D : issu de l'inscription en ligne, en essai gratuit (0/3), sans
-- aucune ligne d'abonnement.
insert into garages (id, name, address, locale, account_status, origin)
values ('d0000000-0000-0000-0000-0000000000d1', 'Garage D', '4 rue D', 'FR',
        'trial', 'self_signup');

insert into profiles (id, role, garage_id, full_name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'garage', 'a0000000-0000-0000-0000-0000000000a1', 'Alice'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'garage', 'b0000000-0000-0000-0000-0000000000b1', 'Bruno'),
  ('cccccccc-0000-0000-0000-000000000003', 'garage', 'c0000000-0000-0000-0000-0000000000c1', 'Chloé'),
  ('dddddddd-0000-0000-0000-000000000004', 'super_admin', null, 'Admin'),
  ('eeeeeeee-0000-0000-0000-000000000005', 'garage', 'd0000000-0000-0000-0000-0000000000d1', 'Elias'),
  ('ffffffff-0000-0000-0000-000000000006', 'garage', 'a0000000-0000-0000-0000-0000000000a1', 'Fabien');

-- A et B à jour, C expiré depuis un mois.
insert into subscriptions (garage_id, start_date, end_date) values
  ('a0000000-0000-0000-0000-0000000000a1', current_date - 30, current_date + 30),
  ('b0000000-0000-0000-0000-0000000000b1', current_date - 30, current_date + 30),
  ('c0000000-0000-0000-0000-0000000000c1', current_date - 90, current_date - 30);

insert into clients (id, garage_id, name) values
  ('a1000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a1', 'Client de A'),
  ('b1000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-0000000000b1', 'Client de B');

insert into services (garage_id, label, default_price_ht) values
  ('a0000000-0000-0000-0000-0000000000a1', 'Vidange A', 80),
  ('b0000000-0000-0000-0000-0000000000b1', 'Vidange B', 90);

insert into logos (garage_id, storage_path, label, is_default) values
  ('a0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a1/logo.png', 'Logo A', true),
  ('b0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-0000000000b1/logo.png', 'Logo B', true);

insert into invoices (id, garage_id, client_name, client_address) values
  ('a2000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a1', 'Client de A', '1 rue A'),
  ('b2000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-0000000000b1', 'Client de B', '2 rue B');

-- Fichiers déjà présents dans le bucket privé « logos ».
insert into storage.objects (bucket_id, name) values
  ('logos', 'a0000000-0000-0000-0000-0000000000a1/logo.png'),
  ('logos', 'b0000000-0000-0000-0000-0000000000b1/logo.png');

insert into invoice_lines (invoice_id, description, quantity, unit_price_ht, vat_rate, position) values
  ('a2000000-0000-0000-0000-0000000000a1', 'Vidange',        1, 80.00,  20,  0),
  ('a2000000-0000-0000-0000-0000000000a1', 'Main d''œuvre',  2, 45.00,  20,  1),
  ('a2000000-0000-0000-0000-0000000000a1', 'Pièce détachée', 1, 30.00,  5.5, 2),
  ('b2000000-0000-0000-0000-0000000000b1', 'Révision',       1, 200.00, 20,  0);

-- ===========================================================================
-- 1. GARAGE A — ce qu'il voit
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
begin
  if (select count(*) from invoices) <> 1 then
    raise exception 'FUITE : A voit % factures au lieu de 1.', (select count(*) from invoices);
  end if;

  if (select count(*) from invoices where id = 'b2000000-0000-0000-0000-0000000000b1') <> 0 then
    raise exception 'FUITE : A lit la facture de B.';
  end if;

  -- Table fille : l'isolation doit remonter à invoices.garage_id.
  if (select count(*) from invoice_lines) <> 3 then
    raise exception 'FUITE : A voit % lignes au lieu de 3 (lignes de B exposées).',
      (select count(*) from invoice_lines);
  end if;

  if (select count(*) from clients)  <> 1 then raise exception 'FUITE : clients de B visibles.'; end if;
  if (select count(*) from services) <> 1 then raise exception 'FUITE : services de B visibles.'; end if;
  if (select count(*) from logos)    <> 1 then raise exception 'FUITE : logos de B visibles.'; end if;
  if (select count(*) from garages)  <> 1 then raise exception 'FUITE : garage B visible.'; end if;

  if (select count(*) from subscriptions) <> 1 then
    raise exception 'FUITE : abonnement de B visible.';
  end if;

  if (select count(*) from profiles) <> 1 then
    raise exception 'FUITE : A voit % profils au lieu du sien.', (select count(*) from profiles);
  end if;

  raise notice '1. Lecture cloisonnée .................... OK';
end $$;

-- ===========================================================================
-- 2. GARAGE A — ce qu'il ne peut pas écrire
-- ===========================================================================
select public.expect_blocked(
  $q$ insert into invoices (garage_id, client_name)
      values ('b0000000-0000-0000-0000-0000000000b1', 'Facture pirate') $q$,
  'A a créé une facture pour le garage B');

select public.expect_blocked(
  $q$ update invoices set client_name = 'pirate'
      where id = 'b2000000-0000-0000-0000-0000000000b1' $q$,
  'A a modifié la facture de B');

select public.expect_blocked(
  $q$ delete from invoices where id = 'b2000000-0000-0000-0000-0000000000b1' $q$,
  'A a supprimé la facture de B');

-- Contourner l'isolation en déplaçant sa propre facture chez B.
select public.expect_blocked(
  $q$ update invoices set garage_id = 'b0000000-0000-0000-0000-0000000000b1'
      where id = 'a2000000-0000-0000-0000-0000000000a1' $q$,
  'A a transféré sa facture au garage B');

-- Greffer une ligne sur la facture d'un autre garage.
select public.expect_blocked(
  $q$ insert into invoice_lines (invoice_id, description, quantity, unit_price_ht)
      values ('b2000000-0000-0000-0000-0000000000b1', 'ligne pirate', 1, 1) $q$,
  'A a ajouté une ligne à la facture de B');

select public.expect_blocked(
  $q$ update invoice_lines set unit_price_ht = 1
      where invoice_id = 'b2000000-0000-0000-0000-0000000000b1' $q$,
  'A a modifié une ligne de la facture de B');

select public.expect_blocked(
  $q$ delete from clients where id = 'b1000000-0000-0000-0000-0000000000b1' $q$,
  'A a supprimé un client de B');

-- L'identité légale du vendeur est maintenue par l'administrateur.
select public.expect_blocked(
  $q$ update garages set name = 'Garage A renommé'
      where id = 'a0000000-0000-0000-0000-0000000000a1' $q$,
  'un garage modifie sa propre fiche légale');

select public.expect_blocked(
  $q$ update subscriptions set end_date = current_date + 3650
      where garage_id = 'a0000000-0000-0000-0000-0000000000a1' $q$,
  'un garage prolonge son propre abonnement');

select public.expect_blocked(
  $q$ insert into payments (garage_id, amount, method)
      values ('a0000000-0000-0000-0000-0000000000a1', 0, 'especes') $q$,
  'un garage inscrit son propre paiement');

do $$ begin raise notice '2. Écriture cloisonnée ................... OK'; end $$;

-- ===========================================================================
-- 3. Escalade de privilège
-- ===========================================================================
-- L'attaque réelle : se promouvoir ET se détacher de son garage dans le même
-- UPDATE, ce qui satisfait la contrainte `profiles_role_garage_ck`. La
-- contrainte seule ne protège donc de rien — c'est `profiles_guard_trg` qui
-- ferme la porte. Vérifié par mutation : sans le trigger, cet UPDATE passe.
select public.expect_blocked(
  $q$ update profiles set role = 'super_admin', garage_id = null
      where id = 'aaaaaaaa-0000-0000-0000-000000000001' $q$,
  'un garage s''est promu super_admin en se détachant de son garage');

select public.expect_blocked(
  $q$ update profiles set role = 'super_admin'
      where id = 'aaaaaaaa-0000-0000-0000-000000000001' $q$,
  'un garage s''est promu super_admin');

select public.expect_blocked(
  $q$ update profiles set garage_id = 'b0000000-0000-0000-0000-0000000000b1'
      where id = 'aaaaaaaa-0000-0000-0000-000000000001' $q$,
  'un garage s''est rattaché au garage B');

select public.expect_blocked(
  $q$ insert into profiles (id, role, garage_id)
      values ('bbbbbbbb-0000-0000-0000-000000000002', 'garage',
              'a0000000-0000-0000-0000-0000000000a1') $q$,
  'un garage a créé un profil');

do $$ begin raise notice '3. Escalade de privilège fermée .......... OK'; end $$;

-- ===========================================================================
-- 4. Finalisation : contrôle d'accès, totaux serveur, numérotation
-- ===========================================================================
-- Finaliser la facture d'un autre garage.
select public.expect_blocked(
  $q$ select finalize_invoice('b2000000-0000-0000-0000-0000000000b1', 2) $q$,
  'A a finalisé la facture de B');

do $$
declare v_inv invoices;
begin
  v_inv := finalize_invoice('a2000000-0000-0000-0000-0000000000a1', 2);

  -- 80 + (2 x 45) + 30 = 200,00 HT
  if v_inv.subtotal_ht <> 200.000 then
    raise exception 'Total HT erroné : % (attendu 200,000).', v_inv.subtotal_ht;
  end if;

  -- TVA : 170 x 20 % = 34,00 ; 30 x 5,5 % = 1,65 → 35,65
  if v_inv.vat_total <> 35.650 then
    raise exception 'Total TVA erroné : % (attendu 35,650).', v_inv.vat_total;
  end if;

  if v_inv.stamp_duty <> 0 then
    raise exception 'Timbre fiscal non nul en France : %.', v_inv.stamp_duty;
  end if;

  if v_inv.total_ttc <> 235.650 then
    raise exception 'Total TTC erroné : % (attendu 235,650).', v_inv.total_ttc;
  end if;

  if jsonb_array_length(v_inv.vat_breakdown) <> 2 then
    raise exception 'Ventilation TVA : % taux au lieu de 2.',
      jsonb_array_length(v_inv.vat_breakdown);
  end if;

  if v_inv.number <> extract(year from current_date)::text || '-000001' then
    raise exception 'Numéro erroné : % (attendu AAAA-000001).', v_inv.number;
  end if;

  if v_inv.seller_snapshot->>'siret' <> '11111111111111' then
    raise exception 'Mentions du vendeur non figées à la finalisation.';
  end if;

  if v_inv.due_date is null then
    raise exception 'Date de règlement non calculée (mention obligatoire).';
  end if;

  raise notice '4. Finalisation : totaux et numéro ....... OK';
end $$;

-- ===========================================================================
-- 5. Immuabilité d'une facture émise
-- ===========================================================================
select public.expect_blocked(
  $q$ update invoices set client_name = 'modifié après émission'
      where id = 'a2000000-0000-0000-0000-0000000000a1' $q$,
  'une facture émise a été modifiée');

select public.expect_blocked(
  $q$ update invoices set total_ttc = 1
      where id = 'a2000000-0000-0000-0000-0000000000a1' $q$,
  'le total d''une facture émise a été réécrit');

select public.expect_blocked(
  $q$ update invoices set number = '2026-999999'
      where id = 'a2000000-0000-0000-0000-0000000000a1' $q$,
  'le numéro d''une facture émise a été réécrit');

select public.expect_blocked(
  $q$ delete from invoices where id = 'a2000000-0000-0000-0000-0000000000a1' $q$,
  'une facture émise a été supprimée');

select public.expect_blocked(
  $q$ insert into invoice_lines (invoice_id, description, quantity, unit_price_ht)
      values ('a2000000-0000-0000-0000-0000000000a1', 'ligne après coup', 1, 10) $q$,
  'une ligne a été ajoutée à une facture émise');

select public.expect_blocked(
  $q$ delete from invoice_lines
      where invoice_id = 'a2000000-0000-0000-0000-0000000000a1' $q$,
  'les lignes d''une facture émise ont été supprimées');

select public.expect_blocked(
  $q$ select finalize_invoice('a2000000-0000-0000-0000-0000000000a1', 2) $q$,
  'double finalisation acceptée');

do $$ begin raise notice '5. Immuabilité des factures émises ....... OK'; end $$;

-- ===========================================================================
-- 6. Numérotation : la série s'incrémente sans trou
-- ===========================================================================
do $$
declare
  v_id uuid;
  v_inv invoices;
begin
  insert into invoices (garage_id, client_name)
  values ('a0000000-0000-0000-0000-0000000000a1', 'Deuxième client')
  returning id into v_id;

  insert into invoice_lines (invoice_id, description, quantity, unit_price_ht, vat_rate)
  values (v_id, 'Diagnostic', 1, 50, 20);

  v_inv := finalize_invoice(v_id, 2);

  if v_inv.number <> extract(year from current_date)::text || '-000002' then
    raise exception 'Série interrompue : % (attendu AAAA-000002).', v_inv.number;
  end if;

  raise notice '6. Numérotation séquentielle ............. OK';
end $$;

-- Le compteur n'est pas manipulable depuis un client.
select public.expect_blocked(
  $q$ update invoice_counters set last_number = 0
      where garage_id = 'a0000000-0000-0000-0000-0000000000a1' $q$,
  'le compteur de numérotation a été remis à zéro');

-- ===========================================================================
-- 7. Abonnement expiré = lecture seule (garage C)
-- ===========================================================================
set local request.jwt.claims = '{"sub":"cccccccc-0000-0000-0000-000000000003","role":"authenticated"}';

do $$
begin
  -- La lecture reste ouverte.
  perform count(*) from invoices;
  raise notice '7. Abonnement expiré : lecture ........... OK';
end $$;

select public.expect_blocked(
  $q$ insert into invoices (garage_id, client_name)
      values ('c0000000-0000-0000-0000-0000000000c1', 'Client de C') $q$,
  'un garage sans abonnement a créé une facture');

select public.expect_blocked(
  $q$ insert into clients (garage_id, name)
      values ('c0000000-0000-0000-0000-0000000000c1', 'Nouveau client') $q$,
  'un garage sans abonnement a écrit dans son carnet');

select public.expect_blocked(
  $q$ insert into services (garage_id, label)
      values ('c0000000-0000-0000-0000-0000000000c1', 'Nouvelle prestation') $q$,
  'un garage sans abonnement a écrit dans son catalogue');

do $$ begin raise notice '   Abonnement expiré : écriture bloquée .. OK'; end $$;

-- ===========================================================================
-- 8. Logos : le drapeau premium commande l'écriture
-- ===========================================================================
-- B n'est pas premium.
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

select public.expect_blocked(
  $q$ insert into logos (garage_id, storage_path, label)
      values ('b0000000-0000-0000-0000-0000000000b1',
              'b0000000-0000-0000-0000-0000000000b1/autre.png', 'Logo interdit') $q$,
  'un garage standard gère ses logos');

do $$ begin raise notice '8a. Garage standard sans gestion logo .... OK'; end $$;

-- A est premium : il gère les siens, mais pas ceux de B.
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
begin
  insert into logos (garage_id, storage_path, label)
  values ('a0000000-0000-0000-0000-0000000000a1',
          'a0000000-0000-0000-0000-0000000000a1/second.png', 'Second logo');
end $$;

select public.expect_blocked(
  $q$ insert into logos (garage_id, storage_path, label)
      values ('b0000000-0000-0000-0000-0000000000b1',
              'b0000000-0000-0000-0000-0000000000b1/pirate.png', 'Logo pirate') $q$,
  'un garage premium écrit dans la bibliothèque de B');

do $$ begin raise notice '8b. Garage premium borné à ses logos ..... OK'; end $$;

-- ===========================================================================
-- 9. Super admin : vue globale
-- ===========================================================================
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000004","role":"authenticated"}';

do $$
begin
  if (select count(*) from garages) <> 4 then
    raise exception 'L''admin ne voit que % garages sur 4.', (select count(*) from garages);
  end if;
  if (select count(*) from invoices) <> 3 then
    raise exception 'L''admin ne voit que % factures sur 3.', (select count(*) from invoices);
  end if;
  -- 6 profils : A, B, C, l'admin, E (garage D) et F (e-mail non verifie).
  if (select count(*) from profiles) <> 6 then
    raise exception 'L''admin ne voit que % profils sur 6.', (select count(*) from profiles);
  end if;
  if (select count(*) from subscriptions) <> 3 then
    raise exception 'L''admin ne voit que % abonnements sur 3.',
      (select count(*) from subscriptions);
  end if;

  raise notice '9. Vue globale administrateur ............ OK';
end $$;

-- ===========================================================================
-- 10. Stockage : le premier segment du chemin porte l'isolation
-- ===========================================================================
-- Le bucket « logos » est privé ; l'arborescence est {garage_id}/{fichier}.
-- Ces policies sont la dernière barrière avant que les logos d'un garage ne
-- deviennent lisibles par un autre.
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

do $$
begin
  if (select count(*) from storage.objects where bucket_id = 'logos') <> 1 then
    raise exception 'FUITE : A voit % fichiers de logo au lieu du sien.',
      (select count(*) from storage.objects where bucket_id = 'logos');
  end if;

  -- A est premium : il téléverse dans son propre dossier.
  insert into storage.objects (bucket_id, name)
  values ('logos', 'a0000000-0000-0000-0000-0000000000a1/nouveau.png');

  raise notice '10a. Stockage : A borné à son dossier .... OK';
end $$;

select public.expect_blocked(
  $q$ insert into storage.objects (bucket_id, name)
      values ('logos', 'b0000000-0000-0000-0000-0000000000b1/pirate.png') $q$,
  'A a téléversé dans le dossier de B');

select public.expect_blocked(
  $q$ update storage.objects set name = 'a0000000-0000-0000-0000-0000000000a1/vole.png'
      where name = 'b0000000-0000-0000-0000-0000000000b1/logo.png' $q$,
  'A a déplacé le logo de B dans son dossier');

select public.expect_blocked(
  $q$ delete from storage.objects
      where name = 'b0000000-0000-0000-0000-0000000000b1/logo.png' $q$,
  'A a supprimé le logo de B');

-- B n'est pas premium : il ne téléverse rien, même chez lui.
set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';

select public.expect_blocked(
  $q$ insert into storage.objects (bucket_id, name)
      values ('logos', 'b0000000-0000-0000-0000-0000000000b1/interdit.png') $q$,
  'un garage standard a téléversé un logo');

do $$ begin raise notice '10b. Stockage : premium requis pour écrire OK'; end $$;

reset role;

do $$
declare v_public boolean;
begin
  select public into v_public from storage.buckets where id = 'logos';
  if v_public is distinct from false then
    raise exception 'FUITE : le bucket « logos » n''est pas privé.';
  end if;
  raise notice '10c. Bucket « logos » privé .............. OK';
end $$;

-- ===========================================================================
-- 11. E-mail non vérifié : aucun accès aux données du garage
-- ===========================================================================
-- Le compte F est rattaché au garage A, mais son adresse n'est pas confirmée.
-- La garde vit dans `is_admin()` et `my_garage_id()` : `my_garage_id()`
-- renvoie NULL, et « garage_id = null » ne correspond à aucune ligne. Toutes
-- les policies se referment d'un coup, y compris celles ajoutées plus tard.
--
-- Nuance assumée : F voit toujours SA propre ligne `profiles` (policy
-- `id = auth.uid()`). C'est son propre enregistrement de compte, pas une
-- donnée du garage — et l'application en a besoin pour afficher un message
-- clair. Aucune donnée métier ne passe.
set local role authenticated;
set local request.jwt.claims = '{"sub":"ffffffff-0000-0000-0000-000000000006","role":"authenticated"}';

do $$
begin
  if my_garage_id() is not null then
    raise exception 'FUITE : my_garage_id() répond pour un e-mail non vérifié.';
  end if;

  if (select count(*) from garages)  <> 0 then raise exception 'FUITE : garage visible sans e-mail vérifié.'; end if;
  if (select count(*) from invoices) <> 0 then raise exception 'FUITE : factures visibles sans e-mail vérifié.'; end if;
  if (select count(*) from invoice_lines) <> 0 then raise exception 'FUITE : lignes visibles sans e-mail vérifié.'; end if;
  if (select count(*) from clients)  <> 0 then raise exception 'FUITE : clients visibles sans e-mail vérifié.'; end if;
  if (select count(*) from services) <> 0 then raise exception 'FUITE : services visibles sans e-mail vérifié.'; end if;
  if (select count(*) from logos)    <> 0 then raise exception 'FUITE : logos visibles sans e-mail vérifié.'; end if;
  if (select count(*) from subscriptions) <> 0 then raise exception 'FUITE : abonnement visible sans e-mail vérifié.'; end if;
  if (select count(*) from storage.objects where bucket_id = 'logos') <> 0 then
    raise exception 'FUITE : logos stockés visibles sans e-mail vérifié.';
  end if;

  raise notice '11a. E-mail non vérifié : lecture fermée . OK';
end $$;

select public.expect_blocked(
  $q$ insert into invoices (garage_id, client_name)
      values ('a0000000-0000-0000-0000-0000000000a1', 'Facture sans vérification') $q$,
  'un compte non vérifié a créé une facture');

select public.expect_blocked(
  $q$ insert into clients (garage_id, name)
      values ('a0000000-0000-0000-0000-0000000000a1', 'Client sans vérification') $q$,
  'un compte non vérifié a écrit dans le carnet');

-- Un compte non vérifié ne se provisionne pas non plus un garage d'essai.
select public.expect_blocked(
  $q$ select provision_self_signup() $q$,
  'un compte non vérifié s''est provisionné un garage');

do $$ begin raise notice '11b. E-mail non vérifié : écriture fermée OK'; end $$;

-- ===========================================================================
-- 12. Provisionnement d'une inscription en ligne
-- ===========================================================================
-- G s'est inscrit sur /signup (marqueur signup_source = 'self') et a vérifié
-- son adresse. Il n'a pas encore de profil : la fonction lui crée son garage
-- en essai gratuit. Le rôle, le statut et les compteurs sont posés par le
-- SQL — rien de tout cela ne vient du navigateur.
set local request.jwt.claims = '{"sub":"11111111-0000-0000-0000-000000000007","role":"authenticated"}';

do $$
declare
  v_garage_id uuid;
  v_again     uuid;
  v_garage    garages;
  v_profile   profiles;
begin
  v_garage_id := provision_self_signup();

  select * into v_garage from garages where id = v_garage_id;
  if v_garage.account_status <> 'trial' then
    raise exception 'Inscription en ligne : statut % au lieu de trial.', v_garage.account_status;
  end if;
  if v_garage.origin <> 'self_signup' then
    raise exception 'Inscription en ligne : origine % au lieu de self_signup.', v_garage.origin;
  end if;
  if v_garage.trial_invoices_used <> 0 or v_garage.trial_invoice_limit <> 3 then
    raise exception 'Compteurs d''essai erronés : %/%.',
      v_garage.trial_invoices_used, v_garage.trial_invoice_limit;
  end if;
  if v_garage.name <> 'Garage de Gaëlle' then
    raise exception 'Nom du garage non repris de l''inscription : %.', v_garage.name;
  end if;

  select * into v_profile from profiles where id = '11111111-0000-0000-0000-000000000007';
  if v_profile.role <> 'garage' then
    raise exception 'Inscription en ligne : rôle % au lieu de garage.', v_profile.role;
  end if;
  -- L'utilisateur a choisi son mot de passe lui-même : rien à forcer.
  if v_profile.must_change_password then
    raise exception 'Inscription en ligne : changement de mot de passe forcé à tort.';
  end if;

  -- Idempotence : le rattrapage depuis la page d'accueil ne doit pas créer
  -- un second garage.
  v_again := provision_self_signup();
  if v_again is distinct from v_garage_id then
    raise exception 'provision_self_signup() a créé un second garage (% puis %).',
      v_garage_id, v_again;
  end if;

  raise notice '12a. Inscription en ligne provisionnée ... OK';
end $$;

-- H a un compte Auth vérifié mais aucun marqueur d'inscription en ligne :
-- c'est le cas d'un compte créé par l'admin dont le profil manquerait. Il ne
-- doit surtout PAS se voir attribuer un garage d'essai.
set local request.jwt.claims = '{"sub":"22222222-0000-0000-0000-000000000008","role":"authenticated"}';

select public.expect_blocked(
  $q$ select provision_self_signup() $q$,
  'un compte sans marqueur d''inscription s''est créé un garage');

do $$ begin raise notice '12b. Provisionnement borné au marqueur ... OK'; end $$;

-- ===========================================================================
-- 13. Essai gratuit : 3 factures finalisées, la 4e est refusée
-- ===========================================================================
-- Le plafond porte sur les factures ÉMISES. Les brouillons restent
-- illimités : c'est la finalisation qui produit une facture légale.
set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-000000000005","role":"authenticated"}';

do $$
declare
  v_id  uuid;
  v_inv invoices;
  i     int;
begin
  for i in 1..3 loop
    insert into invoices (garage_id, client_name)
    values ('d0000000-0000-0000-0000-0000000000d1', 'Client essai ' || i)
    returning id into v_id;

    insert into invoice_lines (invoice_id, description, quantity, unit_price_ht, vat_rate)
    values (v_id, 'Prestation ' || i, 1, 100, 20);

    v_inv := finalize_invoice(v_id, 2);

    if v_inv.status <> 'final' then
      raise exception 'Facture d''essai % non finalisée.', i;
    end if;

    if (select trial_invoices_used from garages
        where id = 'd0000000-0000-0000-0000-0000000000d1') <> i then
      raise exception 'Compteur d''essai désynchronisé après la facture % : %.',
        i, (select trial_invoices_used from garages
            where id = 'd0000000-0000-0000-0000-0000000000d1');
    end if;
  end loop;

  raise notice '13a. Essai : 3 factures finalisées ....... OK';
end $$;

-- Le brouillon reste possible : seule l'émission est plafonnée.
do $$
declare v_id uuid;
begin
  insert into invoices (garage_id, client_name)
  values ('d0000000-0000-0000-0000-0000000000d1', 'Quatrième client')
  returning id into v_id;

  insert into invoice_lines (invoice_id, description, quantity, unit_price_ht, vat_rate)
  values (v_id, 'Prestation 4', 1, 100, 20);

  raise notice '13b. Essai épuisé : brouillon autorisé ... OK';
end $$;

-- La 4e finalisation doit être refusée, avec le message annoncé au client.
do $$
declare
  v_id  uuid;
  v_inv invoices;
begin
  select id into v_id from invoices
  where garage_id = 'd0000000-0000-0000-0000-0000000000d1' and status = 'draft'
  limit 1;

  begin
    v_inv := finalize_invoice(v_id, 2);
  exception
    when raise_exception then
      if sqlerrm not like 'Essai terminé (3 factures)%' then
        raise exception 'Message de blocage inattendu : « % ».', sqlerrm
          using errcode = 'F0001';
      end if;
      raise notice '13c. Essai épuisé : 4e émission refusée . OK';
      return;
  end;

  raise exception 'FUITE : la 4e facture d''essai a été finalisée (numéro %).', v_inv.number
    using errcode = 'F0001';
end $$;

-- Le compteur n'est pas manipulable par le garage : `garages` est en
-- écriture administrateur seule.
select public.expect_blocked(
  $q$ update garages set trial_invoices_used = 0, trial_invoice_limit = 999
      where id = 'd0000000-0000-0000-0000-0000000000d1' $q$,
  'un garage a remis son compteur d''essai à zéro');

do $$ begin raise notice '13d. Compteur d''essai hors de portée .... OK'; end $$;

-- ===========================================================================
-- 14. L'abonnement de l'admin lève l'essai
-- ===========================================================================
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000004","role":"authenticated"}';

do $$
begin
  insert into subscriptions (garage_id, start_date, end_date)
  values ('d0000000-0000-0000-0000-0000000000d1', current_date, current_date + 365);

  if (select account_status from garages where id = 'd0000000-0000-0000-0000-0000000000d1')
     <> 'subscribed' then
    raise exception 'L''abonnement n''a pas fait sortir le garage de l''essai.';
  end if;
end $$;

set local request.jwt.claims = '{"sub":"eeeeeeee-0000-0000-0000-000000000005","role":"authenticated"}';

do $$
declare
  v_id  uuid;
  v_inv invoices;
begin
  select id into v_id from invoices
  where garage_id = 'd0000000-0000-0000-0000-0000000000d1' and status = 'draft'
  limit 1;

  v_inv := finalize_invoice(v_id, 2);

  if v_inv.status <> 'final' then
    raise exception 'L''abonnement n''a pas débloqué l''émission.';
  end if;

  raise notice '14. Abonnement : essai levé .............. OK';
end $$;

-- ===========================================================================
-- 15. Changement de mot de passe obligatoire : non contournable
-- ===========================================================================
-- Sans le garde-fou, un compte créé par l'admin lèverait le drapeau d'un
-- simple appel REST sur son propre profil et resterait indéfiniment sur le
-- mot de passe initial connu de l'administrateur.
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select public.expect_blocked(
  $q$ update profiles set must_change_password = false
      where id = 'aaaaaaaa-0000-0000-0000-000000000001' $q$,
  'un garage a levé lui-même le changement de mot de passe obligatoire');

do $$
declare v_before boolean;
begin
  select must_change_password into v_before from profiles
  where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  if not v_before then
    raise exception 'Jeu d''essai incohérent : le drapeau était déjà levé.';
  end if;

  -- Le seul chemin : la fonction appelée après un changement réussi côté
  -- Supabase Auth. Elle notifie l'administrateur au passage.
  perform complete_password_change();

  if (select must_change_password from profiles
      where id = 'aaaaaaaa-0000-0000-0000-000000000001') then
    raise exception 'complete_password_change() n''a pas levé le drapeau.';
  end if;

  raise notice '15. Changement forcé : seul chemin ouvert  OK';
end $$;

-- ===========================================================================
-- 16. Notifications : journal de l'administrateur
-- ===========================================================================
-- Un garage ne doit ni lire le journal, ni y écrire un événement qui n'a pas
-- eu lieu, ni effacer une trace le concernant.
select public.expect_blocked(
  $q$ select id from admin_notifications $q$,
  'un garage a lu le journal de l''administrateur');

select public.expect_blocked(
  $q$ insert into admin_notifications (type, message)
      values ('garage_signup', 'événement forgé') $q$,
  'un garage a forgé une notification');

select public.expect_blocked(
  $q$ delete from admin_notifications $q$,
  'un garage a effacé le journal de l''administrateur');

-- Le message ne doit jamais transporter de secret : on vérifie qu'aucune
-- notification ne ressemble à un mot de passe transmis.
set local request.jwt.claims = '{"sub":"dddddddd-0000-0000-0000-000000000004","role":"authenticated"}';

do $$
declare
  v_changed int;
  v_signup  int;
  v_trial   int;
begin
  select count(*) into v_changed from admin_notifications where type = 'password_changed';
  if v_changed <> 1 then
    raise exception 'Changement de mot de passe non notifié (% notifications).', v_changed;
  end if;

  select count(*) into v_signup from admin_notifications where type = 'garage_signup';
  if v_signup <> 1 then
    raise exception 'Inscription en ligne non notifiée (% notifications).', v_signup;
  end if;

  select count(*) into v_trial from admin_notifications where type = 'trial_exhausted';
  if v_trial <> 1 then
    raise exception 'Épuisement de l''essai non notifié (% notifications).', v_trial;
  end if;

  if exists (
    select 1 from admin_notifications
    where message ~* '(mot de passe|password)\s*(temporaire)?\s*[:=]'
       or metadata::text ~* '"(password|mot_de_passe|temporary_password)"'
  ) then
    raise exception 'FUITE : une notification transporte un mot de passe.'
      using errcode = 'F0001';
  end if;

  raise notice '16a. Journal admin : cloisonné et sans secret OK';
end $$;

-- Même l'admin ne réécrit pas un événement : le journal n'est pas un
-- brouillon. Seul `read_at` bouge.
select public.expect_blocked(
  $q$ update admin_notifications set message = 'réécrit' $q$,
  'l''administrateur a réécrit une notification');

do $$
begin
  update admin_notifications set read_at = now() where read_at is null;
  raise notice '16b. Journal admin : marquage lu autorisé  OK';
end $$;

-- ===========================================================================
-- 17. Limitation de débit : hors de portée des clients
-- ===========================================================================
-- Table et fonctions réservées à la clé service role. Ouvertes à `anon`,
-- elles permettraient de faire bloquer l'adresse e-mail d'un tiers depuis
-- l'API REST publique — un déni de service ciblé.
set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

select public.expect_blocked(
  $q$ select bucket from auth_rate_limits $q$,
  'un client a lu les compteurs de limitation de débit');

select public.expect_blocked(
  $q$ select auth_rate_limit_hit('login:email:victime@test.local', 1, 900, 900) $q$,
  'un client a fait bloquer l''adresse d''un tiers');

select public.expect_blocked(
  $q$ select auth_rate_limit_clear('login:email:attaquant@test.local') $q$,
  'un client a effacé son propre compteur de tentatives');

-- Le compteur n'est pas non plus appelable par la fonction de notification
-- interne : `notify_admin` écrirait n'importe quel message dans le journal.
select public.expect_blocked(
  $q$ select notify_admin('garage_signup', null, null, 'message forgé') $q$,
  'un client a appelé notify_admin() directement');

do $$ begin raise notice '17. Limitation de débit hors de portée ... OK'; end $$;

do $$
begin
  raise notice '';
  raise notice '=== ISOLATION RLS : TOUTES LES VÉRIFICATIONS PASSENT ===';
end $$;

-- Rien n'est conservé : ni jeu d'essai, ni fonction d'assertion.
rollback;
