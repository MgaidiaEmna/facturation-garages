-- ===========================================================================
-- Phase 1 — Fonctions métier et garde-fous d'immuabilité
--
-- `is_admin()` et `my_garage_id()` sont la clé de voûte de TOUTES les policies
-- RLS. Elles sont SECURITY DEFINER pour pouvoir lire `profiles` sans être
-- elles-mêmes soumises au RLS de cette table (ce qui provoquerait une
-- récursion infinie policy -> fonction -> policy).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Identité de l'appelant
-- ---------------------------------------------------------------------------
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid() and role = 'super_admin'
  );
$$;

create or replace function my_garage_id() returns uuid
language sql stable security definer set search_path = public as $$
  select garage_id from profiles where id = auth.uid();
$$;

-- Un garage peut-il gérer sa bibliothèque de logos ? (drapeau « premium »)
create or replace function can_manage_logos() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from garages g
    where g.id = my_garage_id() and g.logo_management_enabled
  );
$$;

-- ---------------------------------------------------------------------------
-- Abonnement
-- ---------------------------------------------------------------------------
create or replace function has_active_subscription(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from subscriptions s
    join garages ga on ga.id = s.garage_id
    where s.garage_id = g
      and ga.is_active
      and s.end_date >= current_date
  );
$$;

-- Raccourci pour l'espace garage : mon abonnement est-il actif ?
create or replace function my_subscription_is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or has_active_subscription(my_garage_id());
$$;

-- ---------------------------------------------------------------------------
-- Numérotation séquentielle
-- ---------------------------------------------------------------------------
-- Série ininterrompue par garage et par année, au format « AAAA-000001 ».
--
-- ATOMICITÉ : `insert ... on conflict do update ... returning` pose un verrou
-- de ligne sur le compteur. Deux finalisations simultanées se sérialisent :
-- la seconde attend la validation de la première et obtient donc le numéro
-- suivant. Aucun doublon possible.
--
-- ABSENCE DE TROU : l'incrément appartient à la transaction appelante. Si la
-- finalisation échoue après l'attribution, le compteur est ramené en arrière
-- avec le reste. C'est précisément pour cela que la fonction n'est appelée
-- qu'au moment de la finalisation, jamais à la création d'un brouillon.
--
-- La fonction n'est PAS exposée aux clients (voir les GRANT en fin de
-- fichier) : l'appeler seule consommerait un numéro sans émettre de facture.
create or replace function next_invoice_number(g uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  y int := extract(year from current_date)::int;
  n int;
begin
  insert into invoice_counters (garage_id, year, last_number)
  values (g, y, 1)
  on conflict (garage_id, year)
  do update set last_number = invoice_counters.last_number + 1
  returning last_number into n;

  return y::text || '-' || lpad(n::text, 6, '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- Finalisation d'une facture
-- ---------------------------------------------------------------------------
-- Tout se joue dans UNE transaction : contrôle d'accès, contrôle
-- d'abonnement, recalcul des totaux à partir des lignes, attribution du
-- numéro, gel des mentions du vendeur. Les totaux envoyés par le navigateur
-- ne sont jamais utilisés.
--
-- `p_decimals` vient de `LocaleConfig.decimals` (2 en France, 3 en TND) : la
-- connaissance des règles pays reste dans le TypeScript, la base ne fait
-- qu'appliquer l'arrondi demandé.
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

  select * into v_garage from garages where id = v_invoice.garage_id;

  if not v_garage.is_active then
    raise exception 'Ce garage est désactivé : émission impossible.';
  end if;

  -- Abonnement expiré = espace en lecture seule. L'admin n'est pas soumis.
  if not is_admin() and not has_active_subscription(v_invoice.garage_id) then
    raise exception 'Abonnement expiré : impossible de finaliser une facture.';
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

  return v_invoice;
end;
$$;

-- ---------------------------------------------------------------------------
-- Immuabilité des factures émises
-- ---------------------------------------------------------------------------
-- Une facture finalisée n'est ni supprimable ni modifiable : seules son
-- annulation et son suivi e-facture peuvent encore évoluer. Ce garde-fou est
-- au niveau de la base, donc valable quel que soit le chemin d'écriture
-- (application, SQL editor, script).
create or replace function invoices_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception
        'Une facture émise ne peut pas être supprimée (conservation légale). '
        'Annulez-la par un avoir.';
    end if;
    return old;
  end if;

  -- Un brouillon se modifie librement.
  if old.status = 'draft' then
    return new;
  end if;

  -- Seule transition autorisée après émission : final -> cancelled.
  if new.status is distinct from old.status
     and not (old.status = 'final' and new.status = 'cancelled') then
    raise exception 'Transition de statut interdite : % -> %.', old.status, new.status;
  end if;

  if new.garage_id        is distinct from old.garage_id
     or new.number        is distinct from old.number
     or new.series        is distinct from old.series
     or new.issue_date    is distinct from old.issue_date
     or new.service_date  is distinct from old.service_date
     or new.due_date      is distinct from old.due_date
     or new.client_name   is distinct from old.client_name
     or new.client_address is distinct from old.client_address
     or new.client_phone  is distinct from old.client_phone
     or new.client_vat_number is distinct from old.client_vat_number
     or new.seller_snapshot is distinct from old.seller_snapshot
     or new.logo_id       is distinct from old.logo_id
     or new.locale        is distinct from old.locale
     or new.currency      is distinct from old.currency
     or new.vat_exempt    is distinct from old.vat_exempt
     or new.subtotal_ht   is distinct from old.subtotal_ht
     or new.vat_total     is distinct from old.vat_total
     or new.stamp_duty    is distinct from old.stamp_duty
     or new.total_ttc     is distinct from old.total_ttc
     or new.vat_breakdown is distinct from old.vat_breakdown
     or new.payment_term_days is distinct from old.payment_term_days
     or new.late_payment_penalty_rate is distinct from old.late_payment_penalty_rate
     or new.recovery_indemnity is distinct from old.recovery_indemnity
     or new.finalized_at  is distinct from old.finalized_at
  then
    raise exception
      'Facture % : une facture émise est immuable. Seuls son annulation et '
      'son suivi e-facture peuvent évoluer.', old.number;
  end if;

  return new;
end;
$$;

create trigger invoices_guard_trg
  before update or delete on invoices
  for each row execute function invoices_guard();

-- Les lignes suivent le sort de leur facture.
create or replace function invoice_lines_guard() returns trigger
language plpgsql as $$
declare
  v_status invoice_status;
  v_invoice_id uuid := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
begin
  select status into v_status from invoices where id = v_invoice_id;

  -- v_status NULL = la facture parente est en cours de suppression en
  -- cascade ; la garde sur `invoices` a déjà tranché.
  if v_status is not null and v_status <> 'draft' then
    raise exception 'Les lignes d''une facture émise ne peuvent plus être modifiées.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger invoice_lines_guard_trg
  before insert or update or delete on invoice_lines
  for each row execute function invoice_lines_guard();

-- ---------------------------------------------------------------------------
-- Droits d'exécution
-- ---------------------------------------------------------------------------
-- Les helpers doivent être exécutables par les rôles qui évaluent les
-- policies RLS.
grant execute on function is_admin() to anon, authenticated, service_role;
grant execute on function my_garage_id() to anon, authenticated, service_role;
grant execute on function can_manage_logos() to anon, authenticated, service_role;
grant execute on function has_active_subscription(uuid) to authenticated, service_role;
grant execute on function my_subscription_is_active() to authenticated, service_role;

-- La finalisation est le seul point d'entrée exposé : elle fait ses propres
-- contrôles d'accès et d'abonnement.
grant execute on function finalize_invoice(uuid, int) to authenticated, service_role;

-- Le compteur n'est jamais appelable directement : cela brûlerait un numéro
-- sans émettre de facture. Seule `finalize_invoice` (SECURITY DEFINER) y
-- accède, en s'exécutant avec les droits du propriétaire.
revoke all on function next_invoice_number(uuid) from public, anon, authenticated;
