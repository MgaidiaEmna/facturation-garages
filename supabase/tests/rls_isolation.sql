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
   'admin@test.local', 'x', now(), now(), now());

insert into garages (id, name, siret, address, locale, logo_management_enabled)
values
  ('a0000000-0000-0000-0000-0000000000a1', 'Garage A', '11111111111111', '1 rue A', 'FR', true),
  ('b0000000-0000-0000-0000-0000000000b1', 'Garage B', '22222222222222', '2 rue B', 'FR', false),
  ('c0000000-0000-0000-0000-0000000000c1', 'Garage C', '33333333333333', '3 rue C', 'FR', false);

insert into profiles (id, role, garage_id, full_name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'garage', 'a0000000-0000-0000-0000-0000000000a1', 'Alice'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'garage', 'b0000000-0000-0000-0000-0000000000b1', 'Bruno'),
  ('cccccccc-0000-0000-0000-000000000003', 'garage', 'c0000000-0000-0000-0000-0000000000c1', 'Chloé'),
  ('dddddddd-0000-0000-0000-000000000004', 'super_admin', null, 'Admin');

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
  if (select count(*) from garages) <> 3 then
    raise exception 'L''admin ne voit que % garages sur 3.', (select count(*) from garages);
  end if;
  if (select count(*) from invoices) <> 3 then
    raise exception 'L''admin ne voit que % factures sur 3.', (select count(*) from invoices);
  end if;
  if (select count(*) from profiles) <> 4 then
    raise exception 'L''admin ne voit que % profils sur 4.', (select count(*) from profiles);
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

do $$
begin
  raise notice '';
  raise notice '=== ISOLATION RLS : TOUTES LES VÉRIFICATIONS PASSENT ===';
end $$;

-- Rien n'est conservé : ni jeu d'essai, ni fonction d'assertion.
rollback;
