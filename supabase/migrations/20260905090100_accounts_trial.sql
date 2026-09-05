-- ===========================================================================
-- Phase 2 — Comptes, vérification d'e-mail et essai gratuit
--
-- Deux chemins de création d'un compte garage, et un seul modèle de données :
--
--   1. CRÉÉ PAR L'ADMIN     origin = 'admin'
--      L'admin fixe l'e-mail et un mot de passe initial, le compte Auth est
--      pré-confirmé (pas de boucle de vérification), l'accès est immédiat.
--      `profiles.must_change_password = true` : le garage DOIT choisir son
--      propre mot de passe à la première connexion.
--
--   2. INSCRIPTION EN LIGNE  origin = 'self_signup'
--      Ouverte à tous sur /signup, AVEC vérification d'e-mail obligatoire.
--      Tant que l'e-mail n'est pas vérifié, le compte n'a accès à AUCUNE
--      donnée (voir « Garde e-mail vérifié » ci-dessous). Une fois vérifié,
--      `provision_self_signup()` crée le garage en ESSAI GRATUIT :
--      3 factures finalisées, brouillons illimités.
--
-- L'essai est levé par l'admin : dès qu'il enregistre un abonnement, le
-- garage bascule en 'subscribed' et repasse sur le contrôle par date.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
-- Comment l'accès est accordé. Volontairement disjoint de `is_active`, qui
-- dit si le compte est utilisable du tout : un garage peut être en essai ET
-- désactivé.
create type garage_account_status as enum ('trial', 'subscribed');

-- D'où vient le compte. Sert de garde-fou au provisionnement automatique.
create type garage_origin as enum ('admin', 'self_signup');

-- ---------------------------------------------------------------------------
-- garages — essai gratuit
-- ---------------------------------------------------------------------------
alter table garages
  -- Défaut 'subscribed' : les garages créés par l'admin passent par un
  -- abonnement. L'inscription en ligne pose explicitement 'trial'.
  add column account_status      garage_account_status not null default 'subscribed',
  add column origin              garage_origin         not null default 'admin',
  -- Compte les factures FINALISÉES, jamais les brouillons.
  add column trial_invoices_used int not null default 0,
  add column trial_invoice_limit int not null default 3;

alter table garages
  add constraint garages_trial_ck check (
    trial_invoices_used >= 0 and trial_invoice_limit >= 0
  );

comment on column garages.trial_invoices_used is
  'Factures FINALISÉES consommées sur l''essai gratuit. Incrémenté par finalize_invoice(), jamais par le client.';

-- ---------------------------------------------------------------------------
-- Garde « e-mail vérifié »
-- ---------------------------------------------------------------------------
-- Un compte dont l'adresse n'est pas confirmée ne doit avoir accès à AUCUNE
-- donnée. Plutôt que d'ajouter la condition à la quarantaine de policies
-- existantes — où un oubli serait invisible — on la pose à la SOURCE : les
-- deux fonctions sur lesquelles reposent TOUTES les policies.
--
--   is_admin()      -> false si l'e-mail n'est pas confirmé
--   my_garage_id()  -> null  si l'e-mail n'est pas confirmé
--
-- `garage_id = null` ne correspond à aucune ligne : l'isolation se referme
-- d'elle-même, partout, y compris sur les tables ajoutées plus tard.
--
-- Supabase refuse déjà la connexion d'un compte non confirmé quand l'option
-- « Confirm email » est active. Cette garde est la seconde barrière : elle
-- tient même si le réglage du projet est modifié.
create or replace function email_is_verified() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid() and u.email_confirmed_at is not null
  );
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from profiles p
    join auth.users u on u.id = p.id
    where p.id = auth.uid()
      and p.role = 'super_admin'
      and u.email_confirmed_at is not null
  );
$$;

create or replace function my_garage_id() returns uuid
language sql stable security definer set search_path = public as $$
  select p.garage_id
  from profiles p
  join auth.users u on u.id = p.id
  where p.id = auth.uid()
    and u.email_confirmed_at is not null;
$$;

grant execute on function email_is_verified() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Droit d'écrire : abonnement OU essai en cours
-- ---------------------------------------------------------------------------
-- `has_active_subscription()` garde son sens littéral (un abonnement payant
-- est en vigueur) ; c'est `has_write_access()` qui décide de l'ouverture de
-- l'espace, essai compris.
--
-- Un essai ÉPUISÉ conserve le droit d'écrire : le garage continue de saisir
-- des brouillons, de tenir son carnet et son catalogue. Seule la
-- FINALISATION est plafonnée — c'est elle qui produit une facture légale.
create or replace function has_write_access(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from garages ga
    where ga.id = g
      and ga.is_active
      and (
        ga.account_status = 'trial'
        or exists (
          select 1 from subscriptions s
          where s.garage_id = ga.id and s.end_date >= current_date
        )
      )
  );
$$;

create or replace function my_write_access() returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or has_write_access(my_garage_id());
$$;

grant execute on function has_write_access(uuid) to authenticated, service_role;
grant execute on function my_write_access() to authenticated, service_role;

-- Bascule des policies sur le nouvel helper. Elles sont recréées à
-- l'identique, `my_subscription_is_active()` -> `my_write_access()`.
drop policy "clients_write"        on clients;
drop policy "services_write"       on services;
drop policy "invoices_insert"      on invoices;
drop policy "invoices_update"      on invoices;
drop policy "invoices_delete"      on invoices;
drop policy "invoice_lines_insert" on invoice_lines;
drop policy "invoice_lines_update" on invoice_lines;
drop policy "invoice_lines_delete" on invoice_lines;

-- Plus aucune policy ne la référence : l'ancien nom disparaît pour qu'il ne
-- puisse pas être réutilisé par erreur avec sa sémantique périmée.
drop function my_subscription_is_active();

create policy "clients_write" on clients
  for all to authenticated
  using (is_admin() or (garage_id = my_garage_id() and my_write_access()))
  with check (is_admin() or (garage_id = my_garage_id() and my_write_access()));

create policy "services_write" on services
  for all to authenticated
  using (is_admin() or (garage_id = my_garage_id() and my_write_access()))
  with check (is_admin() or (garage_id = my_garage_id() and my_write_access()));

create policy "invoices_insert" on invoices
  for insert to authenticated
  with check (is_admin() or (garage_id = my_garage_id() and my_write_access()));

create policy "invoices_update" on invoices
  for update to authenticated
  using (is_admin() or (garage_id = my_garage_id() and my_write_access()))
  with check (is_admin() or (garage_id = my_garage_id() and my_write_access()));

create policy "invoices_delete" on invoices
  for delete to authenticated
  using (is_admin() or (garage_id = my_garage_id() and my_write_access()));

create policy "invoice_lines_insert" on invoice_lines
  for insert to authenticated
  with check (
    exists (
      select 1 from invoices i
      where i.id = invoice_lines.invoice_id
        and (is_admin() or (i.garage_id = my_garage_id() and my_write_access()))
    )
  );

create policy "invoice_lines_update" on invoice_lines
  for update to authenticated
  using (
    exists (
      select 1 from invoices i
      where i.id = invoice_lines.invoice_id
        and (is_admin() or (i.garage_id = my_garage_id() and my_write_access()))
    )
  )
  with check (
    exists (
      select 1 from invoices i
      where i.id = invoice_lines.invoice_id
        and (is_admin() or (i.garage_id = my_garage_id() and my_write_access()))
    )
  );

create policy "invoice_lines_delete" on invoice_lines
  for delete to authenticated
  using (
    exists (
      select 1 from invoices i
      where i.id = invoice_lines.invoice_id
        and (is_admin() or (i.garage_id = my_garage_id() and my_write_access()))
    )
  );

-- ---------------------------------------------------------------------------
-- Motif de blocage de la finalisation
-- ---------------------------------------------------------------------------
-- Renvoie null quand l'émission est permise, sinon un code stable :
--   'unknown'              garage introuvable
--   'inactive'             compte désactivé par l'admin
--   'trial_exhausted'      essai gratuit consommé
--   'subscription_expired' abonnement échu
--
-- Le même code sert à l'UI (bandeau, bouton grisé) et au garde-fou SQL de
-- `finalize_invoice()`. L'UI est une commodité, le SQL est la barrière.
create or replace function finalize_block_reason(g uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_garage garages;
begin
  -- SECURITY DEFINER : le RLS ne filtre pas ici. Sans ce contrôle, n'importe
  -- quel garage pourrait sonder le statut commercial d'un autre.
  if not is_admin() and g is distinct from my_garage_id() then
    raise exception 'Accès refusé à ce garage.' using errcode = '42501';
  end if;

  select * into v_garage from garages where id = g;
  if not found then
    return 'unknown';
  end if;

  if not v_garage.is_active then
    return 'inactive';
  end if;

  if v_garage.account_status = 'trial' then
    if v_garage.trial_invoices_used >= v_garage.trial_invoice_limit then
      return 'trial_exhausted';
    end if;
    return null;
  end if;

  if not has_active_subscription(g) then
    return 'subscription_expired';
  end if;

  return null;
end;
$$;

-- Phrase affichable correspondant au motif, plafond d'essai inclus.
create or replace function finalize_block_message(g uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_reason text := finalize_block_reason(g);
  v_limit  int;
begin
  if v_reason is null then
    return null;
  end if;

  select trial_invoice_limit into v_limit from garages where id = g;

  return case v_reason
    when 'trial_exhausted' then
      format('Essai terminé (%s factures) — contactez l''administrateur pour '
             'activer votre abonnement', coalesce(v_limit, 3))
    when 'subscription_expired' then
      'Abonnement expiré : impossible de finaliser une facture.'
    when 'inactive' then
      'Ce garage est désactivé : émission impossible.'
    else
      'Émission impossible pour ce garage.'
  end;
end;
$$;

grant execute on function finalize_block_reason(uuid) to authenticated, service_role;
grant execute on function finalize_block_message(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- L'abonnement défini par l'admin remplace l'essai
-- ---------------------------------------------------------------------------
-- Dès qu'une ligne d'abonnement existe, le garage quitte l'essai et repasse
-- sur le contrôle par date. Le compteur d'essai est laissé tel quel : il
-- reste la trace de ce qui a été consommé avant de payer.
create or replace function subscriptions_end_trial() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update garages
  set account_status = 'subscribed'
  where id = new.garage_id and account_status <> 'subscribed';
  return new;
end;
$$;

create trigger subscriptions_end_trial_trg
  after insert or update of garage_id, end_date on subscriptions
  for each row execute function subscriptions_end_trial();

-- ---------------------------------------------------------------------------
-- Provisionnement d'une inscription en ligne
-- ---------------------------------------------------------------------------
-- Appelée par l'utilisateur lui-même, une fois son e-mail vérifié. Crée son
-- garage en essai et son profil `role = 'garage'`.
--
-- Pourquoi une fonction SQL et pas la clé service role : le rôle, le statut
-- et les compteurs sont posés ICI, hors de portée du navigateur. Le seul
-- élément fourni par l'utilisateur est le NOM de son garage — une étiquette,
-- relue depuis `raw_user_meta_data` côté serveur, jamais un droit.
--
-- Idempotente : rappelée, elle renvoie simplement le garage existant. C'est
-- ce qui permet à la page d'accueil de rattraper une confirmation dont le
-- provisionnement aurait échoué.
create or replace function provision_self_signup() returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user     auth.users;
  v_profile  profiles;
  v_name     text;
  v_full     text;
  v_garage_id uuid;
begin
  select * into v_user from auth.users where id = auth.uid();
  if not found then
    raise exception 'Aucune session.' using errcode = '42501';
  end if;

  if v_user.email_confirmed_at is null then
    raise exception 'Adresse e-mail non vérifiée.' using errcode = '42501';
  end if;

  -- Déjà provisionné (ou compte créé par l'admin) : on ne touche à rien.
  select * into v_profile from profiles where id = v_user.id;
  if found then
    return v_profile.garage_id;
  end if;

  -- Marqueur posé par /signup. Un compte créé par l'admin ne l'a pas : il ne
  -- doit surtout pas se voir attribuer un garage d'essai au premier passage.
  if coalesce(v_user.raw_user_meta_data->>'signup_source', '') <> 'self' then
    raise exception 'Ce compte n''a pas de garage rattaché. Contactez l''administrateur.'
      using errcode = '42501';
  end if;

  v_name := nullif(btrim(coalesce(v_user.raw_user_meta_data->>'garage_name', '')), '');
  v_full := nullif(btrim(coalesce(v_user.raw_user_meta_data->>'full_name', '')), '');

  -- Repli sur la partie locale de l'adresse : le nom reste modifiable par
  -- l'admin, il ne conditionne rien.
  if v_name is null then
    v_name := split_part(coalesce(v_user.email, 'Nouveau garage'), '@', 1);
  end if;
  v_name := left(v_name, 120);

  insert into garages (name, email, locale, account_status, origin)
  values (v_name, v_user.email, 'FR', 'trial', 'self_signup')
  returning id into v_garage_id;

  -- L'utilisateur a choisi son mot de passe lui-même : rien à forcer.
  insert into profiles (id, role, garage_id, full_name, must_change_password)
  values (v_user.id, 'garage', v_garage_id, left(coalesce(v_full, v_name), 120), false);

  perform notify_admin(
    'garage_signup',
    v_garage_id,
    v_user.id,
    format('Inscription en ligne vérifiée : « %s ». Essai gratuit de %s factures.',
           v_name,
           (select trial_invoice_limit from garages where id = v_garage_id)),
    jsonb_build_object('email', v_user.email)
  );

  return v_garage_id;
end;
$$;

grant execute on function provision_self_signup() to authenticated;

-- ---------------------------------------------------------------------------
-- Fin du changement de mot de passe obligatoire
-- ---------------------------------------------------------------------------
-- Lève `must_change_password` et notifie l'administrateur. Le mot de passe
-- lui-même est modifié par Supabase Auth avant l'appel : cette fonction ne
-- le voit jamais et n'en garde aucune trace.
create or replace function complete_password_change() returns void
language plpgsql security definer set search_path = public as $$
begin
  update profiles set must_change_password = false where id = auth.uid();
  if not found then
    raise exception 'Aucun profil pour la session courante.' using errcode = '42501';
  end if;

  perform notify_password_changed();
end;
$$;

grant execute on function complete_password_change() to authenticated;

-- Le drapeau ne doit pas pouvoir être levé par un simple UPDATE sur son
-- propre profil : sinon la page de changement forcé se contourne d'un appel
-- REST. Seules `complete_password_change()` et l'admin y touchent.
-- SECURITY INVOKER (contrairement à la version de la phase 1) : le garde-fou
-- doit voir QUI écrit. Sous SECURITY DEFINER, `current_user` vaudrait
-- toujours le propriétaire des tables et la distinction client / code de
-- confiance ci-dessous serait aveugle. La fonction n'a besoin d'aucun droit
-- particulier : elle ne lit que NEW/OLD et appelle `is_admin()`, elle-même
-- SECURITY DEFINER.
create or replace function profiles_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  -- Ce garde-fou protège des écritures venues du NAVIGATEUR. PostgREST
  -- exécute chaque requête sous le rôle du JWT : `authenticated` ou `anon`.
  -- Tout autre rôle est du code de confiance — le propriétaire des tables
  -- (une fonction SECURITY DEFINER de l'application) ou la clé service role,
  -- qui contourne déjà le RLS. Les soumettre au garde-fou n'ajouterait aucune
  -- sécurité et empêcherait `complete_password_change()` et le script de seed
  -- de faire leur travail.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

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

  -- `complete_password_change()` est donc le seul chemin qui lève le drapeau :
  -- elle est SECURITY DEFINER, elle passe par l'exemption ci-dessus. Un UPDATE
  -- direct sur son propre profil, lui, est refusé.
  if new.must_change_password is distinct from old.must_change_password then
    raise exception 'Le changement de mot de passe obligatoire se lève en changeant '
                    'le mot de passe, pas en modifiant le drapeau.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- finalize_invoice — plafond de l'essai gratuit
-- ---------------------------------------------------------------------------
-- Reprise intégrale de la fonction de la phase 1, avec deux ajouts :
--   · le contrôle d'abonnement devient `finalize_block_reason()`, qui couvre
--     aussi l'essai épuisé ;
--   · une finalisation réussie consomme une unité d'essai.
--
-- Le verrou `for update` sur la ligne du garage sérialise les finalisations
-- concurrentes du même garage : impossible de passer à 4 factures d'essai en
-- lançant deux finalisations en parallèle.
create or replace function finalize_invoice(p_invoice_id uuid, p_decimals int default 2)
returns invoices
language plpgsql security definer set search_path = public as $$
declare
  v_invoice   invoices;
  v_garage    garages;
  v_subtotal  numeric(14,3);
  v_vat_total numeric(14,3);
  v_breakdown jsonb;
  v_lines     int;
  v_number    text;
  v_block     text;
  v_trial_used int;
begin
  if p_decimals is null or p_decimals not between 0 and 3 then
    raise exception 'Nombre de décimales invalide : %.', p_decimals;
  end if;

  -- Verrou : deux finalisations concurrentes de la même facture se
  -- sérialisent, la seconde constatera que le statut n'est plus « draft ».
  select * into v_invoice from invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Facture introuvable.' using errcode = 'P0002';
  end if;

  -- SECURITY DEFINER = le RLS ne s'applique pas ici. On refait donc le
  -- contrôle d'appartenance explicitement.
  if not is_admin() and v_invoice.garage_id is distinct from my_garage_id() then
    raise exception 'Accès refusé à cette facture.' using errcode = '42501';
  end if;

  if v_invoice.status <> 'draft' then
    raise exception 'Seul un brouillon peut être finalisé (statut actuel : %).',
      v_invoice.status;
  end if;

  -- Verrou sur le garage : il protège le compteur d'essai.
  select * into v_garage from garages where id = v_invoice.garage_id for update;

  -- Abonnement échu, essai épuisé ou compte désactivé : émission refusée.
  -- L'admin n'est pas soumis au plafond commercial, mais reste soumis à la
  -- désactivation du garage.
  v_block := finalize_block_reason(v_invoice.garage_id);
  if v_block is not null and (not is_admin() or v_block in ('inactive', 'unknown')) then
    raise exception '%', finalize_block_message(v_invoice.garage_id);
  end if;

  -- Mentions obligatoires minimales.
  if coalesce(trim(v_invoice.client_name), '') = '' then
    raise exception 'Le nom ou la dénomination du client est obligatoire.';
  end if;

  select count(*) into v_lines from invoice_lines where invoice_id = p_invoice_id;
  if v_lines = 0 then
    raise exception 'Une facture doit comporter au moins une ligne de prestation.';
  end if;

  -- Totaux : chaque ligne est arrondie, puis les bases sont regroupées par
  -- taux et la TVA est calculée sur la base agrégée de chaque taux.
  with bases as (
    select
      l.vat_rate as rate,
      round(sum(round(l.quantity * l.unit_price_ht, p_decimals)), p_decimals) as base_ht
    from invoice_lines l
    where l.invoice_id = p_invoice_id
    group by l.vat_rate
  )
  select
    coalesce(sum(base_ht), 0),
    coalesce(sum(round(base_ht * rate / 100, p_decimals)), 0),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'rate', rate,
          'base_ht', base_ht,
          'vat_amount', round(base_ht * rate / 100, p_decimals)
        )
        order by rate desc
      ),
      '[]'::jsonb
    )
  into v_subtotal, v_vat_total, v_breakdown
  from bases;

  -- Franchise en base (art. 293 B du CGI) : aucune TVA sur la facture.
  if v_garage.vat_exempt then
    v_vat_total := 0;
    v_breakdown := '[]'::jsonb;
  end if;

  v_number := next_invoice_number(v_invoice.garage_id);

  update invoices set
    number        = v_number,
    status        = 'final',
    finalized_at  = now(),

    subtotal_ht   = v_subtotal,
    vat_total     = v_vat_total,
    total_ttc     = round(v_subtotal + v_vat_total + coalesce(stamp_duty, 0), p_decimals),
    vat_breakdown = v_breakdown,

    -- Gel des règles applicables au jour de l'émission.
    locale        = v_garage.locale,
    vat_exempt    = v_garage.vat_exempt,
    payment_term_days         = coalesce(payment_term_days, v_garage.payment_term_days),
    late_payment_penalty_rate = coalesce(late_payment_penalty_rate,
                                         v_garage.late_payment_penalty_rate),
    recovery_indemnity        = coalesce(recovery_indemnity, v_garage.recovery_indemnity),
    due_date      = coalesce(
                      due_date,
                      issue_date + coalesce(payment_term_days, v_garage.payment_term_days)
                    ),

    -- Mentions du vendeur figées : une facture émise ne doit plus bouger si
    -- le garage change d'adresse ou de forme juridique.
    seller_snapshot = jsonb_build_object(
      'name',       v_garage.name,
      'legal_form', v_garage.legal_form,
      'siret',      v_garage.siret,
      'vat_number', v_garage.vat_number,
      'rcs_city',   v_garage.rcs_city,
      'capital',    v_garage.capital,
      'address',    v_garage.address,
      'phone',      v_garage.phone,
      'email',      v_garage.email,
      'iban',       v_garage.iban,
      'bic',        v_garage.bic
    )
  where id = p_invoice_id
  returning * into v_invoice;

  -- L'essai se décompte en factures ÉMISES. L'incrément appartient à la même
  -- transaction que l'émission : si celle-ci échoue, rien n'est consommé.
  if v_garage.account_status = 'trial' then
    update garages
    set trial_invoices_used = trial_invoices_used + 1
    where id = v_garage.id
    returning trial_invoices_used into v_trial_used;

    -- Dernière facture de l'essai : on prévient l'admin, qui doit encaisser
    -- hors ligne puis enregistrer un abonnement. Notifié une seule fois, et
    -- sur une finalisation RÉUSSIE — une tentative bloquée serait annulée
    -- avec le reste de la transaction.
    if v_trial_used >= v_garage.trial_invoice_limit then
      perform notify_admin(
        'trial_exhausted',
        v_garage.id,
        v_invoice.created_by,
        format('Essai gratuit épuisé pour « %s » (%s/%s factures). '
               'Enregistrez un abonnement pour lever la limite.',
               v_garage.name, v_trial_used, v_garage.trial_invoice_limit),
        jsonb_build_object('used', v_trial_used, 'limit', v_garage.trial_invoice_limit)
      );
    end if;
  end if;

  return v_invoice;
end;
$$;

grant execute on function finalize_invoice(uuid, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- État de session, en un seul aller-retour
-- ---------------------------------------------------------------------------
-- Rôle, garage, essai, abonnement et motif de blocage sont lus ensemble par
-- `getAuthContext()` (src/lib/auth/session.ts). Un appel plutôt que cinq, et
-- surtout : AUCUNE de ces règles n'est recalculée en TypeScript. Le serveur
-- reste la seule source de vérité sur ce qu'un compte a le droit de faire.
create or replace function my_access_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_profile  profiles;
  v_garage   garages;
  v_end_date date;
  v_verified boolean := email_is_verified();
begin
  select * into v_profile from profiles where id = auth.uid();

  if not found then
    return jsonb_build_object('has_profile', false, 'email_verified', v_verified);
  end if;

  -- Adresse non confirmée : le compte existe, mais rien de son garage ne
  -- doit transparaître. Même réponse que la garde posée dans my_garage_id().
  if not v_verified then
    return jsonb_build_object(
      'has_profile', true,
      'email_verified', false,
      'role', v_profile.role,
      'must_change_password', v_profile.must_change_password,
      'full_name', v_profile.full_name
    );
  end if;

  if v_profile.role = 'super_admin' then
    return jsonb_build_object(
      'has_profile', true,
      'email_verified', true,
      'role', v_profile.role,
      'must_change_password', v_profile.must_change_password,
      'full_name', v_profile.full_name
    );
  end if;

  select * into v_garage from garages where id = v_profile.garage_id;
  select max(end_date) into v_end_date from subscriptions where garage_id = v_garage.id;

  return jsonb_build_object(
    'has_profile', true,
    'email_verified', true,
    'role', v_profile.role,
    'must_change_password', v_profile.must_change_password,
    'full_name', v_profile.full_name,
    'garage', jsonb_build_object(
      'id',                      v_garage.id,
      'name',                    v_garage.name,
      'locale',                  v_garage.locale,
      'is_active',               v_garage.is_active,
      'account_status',          v_garage.account_status,
      'origin',                  v_garage.origin,
      'vat_exempt',              v_garage.vat_exempt,
      'logo_management_enabled', v_garage.logo_management_enabled,
      'trial_invoices_used',     v_garage.trial_invoices_used,
      'trial_invoice_limit',     v_garage.trial_invoice_limit
    ),
    'subscription_end_date',  v_end_date,
    'can_write',              has_write_access(v_garage.id),
    'finalize_block_reason',  finalize_block_reason(v_garage.id),
    'finalize_block_message', finalize_block_message(v_garage.id)
  );
end;
$$;

grant execute on function my_access_state() to authenticated;
