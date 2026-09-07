-- ===========================================================================
-- Phase 9 — Logos et bibliothèque premium
--
-- Les policies (table `logos` et bucket `logos`) existent depuis la phase 1 :
-- rien à y ajouter. Cette migration pose ce qui manquait pour que la
-- bibliothèque tienne debout :
--
--   1. le bucket n'accepte plus que PNG et JPEG ;
--   2. un message clair quand on retire un logo porté par une facture émise,
--      et la fonction qui permet à l'UI de le dire AVANT le clic ;
--   3. `set_default_logo()`, pour basculer le défaut en une transaction ;
--   4. `save_invoice_draft()` accepte un logo, validé côté serveur ;
--   5. `finalize_invoice()` GÈLE le chemin du logo dans `seller_snapshot`.
--
-- Ce qui N'EST PAS ajouté, après vérification : l'unicité du logo par défaut.
-- `logos_one_default_per_garage_idx` existe depuis la phase 1
-- (`init_schema.sql`). Un second index aurait fait doublon.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. PNG et JPEG seulement
-- ---------------------------------------------------------------------------
-- `@react-pdf/renderer` ne décode que ces deux formats : son `<Image>` ignore
-- le SVG et le WebP. Les accepter au téléversement produirait un logo visible
-- à l'écran et ABSENT du PDF — c'est-à-dire deux documents différents, ce que
-- tout le modèle `document.ts` existe pour empêcher. Mieux vaut refuser le
-- fichier à l'entrée, avec un message clair, que livrer une facture amputée.
update storage.buckets
set allowed_mime_types = array['image/png', 'image/jpeg']
where id = 'logos';

-- ---------------------------------------------------------------------------
-- 2. Retirer un logo porté par une facture émise : un refus COMPRÉHENSIBLE
-- ---------------------------------------------------------------------------
-- ATTENTION à ne pas se tromper sur ce que ce trigger apporte. La suppression
-- était DÉJÀ refusée avant lui : `invoices.logo_id` est `on delete set null`,
-- donc la cascade déclenche un UPDATE sur une facture émise, et
-- `invoices_guard_trg` le rejette — `logo_id` figure dans sa liste
-- d'immuabilité. Mesuré : en retirant `logos_guard_trg`, la suppression reste
-- refusée.
--
-- Ce que ce trigger ajoute, c'est le MESSAGE. « Facture 2026-000001 : une
-- facture émise est immuable » n'apprend rien à quelqu'un qui vient de cliquer
-- sur la corbeille d'un logo. Et `logo_is_deletable()` permet à l'écran de
-- griser le bouton AVANT le clic, comme `garage_is_deletable()` le fait pour
-- un garage.
--
-- Deux barrières indépendantes, donc, dont une seule parle français.
create or replace function logo_is_deletable(l uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from invoices i
    where i.logo_id = l and i.status <> 'draft'
  );
$$;

grant execute on function logo_is_deletable(uuid) to authenticated, service_role;

-- Verdict pour toute une bibliothèque en un aller-retour : les identifiants
-- des logos VERROUILLÉS. SECURITY INVOKER, donc `logos_select` s'applique — un
-- identifiant emprunté au voisin ne renvoie rien. La règle n'est pas réécrite
-- ici : elle appelle `logo_is_deletable()`, comme le fera le trigger.
create or replace function logos_locked(p_ids uuid[])
returns table (id uuid)
language sql stable security invoker set search_path = public as $$
  select l.id from logos l
  where l.id = any(p_ids) and not logo_is_deletable(l.id);
$$;

grant execute on function logos_locked(uuid[]) to authenticated, service_role;

create or replace function logos_guard() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if exists (
    select 1 from invoices i
    where i.logo_id = old.id and i.status <> 'draft'
  ) then
    raise exception
      'Ce logo figure sur une ou plusieurs factures émises : il ne peut plus '
      'être supprimé. Vous pouvez cesser de l''utiliser en changeant de logo '
      'par défaut.';
  end if;

  return old;
end;
$$;

create trigger logos_guard_trg
  before delete on logos
  for each row execute function logos_guard();

-- ---------------------------------------------------------------------------
-- 4. Le brouillon retient son logo
-- ---------------------------------------------------------------------------
-- Reprise intégrale de la fonction de la phase 5, avec UN ajout : l'en-tête
-- peut porter un `logo_id`. Il est validé contre `logos` — donc sous RLS,
-- puisque la fonction est SECURITY INVOKER — et tout identifiant qui n'est pas
-- un logo du garage courant devient `null`. Le principe est celui du
-- `garage_id` : ce que le navigateur envoie n'est jamais une autorisation.
create or replace function save_invoice_draft(
  p_invoice_id uuid,
  p_header     jsonb,
  p_lines      jsonb,
  p_decimals   int default 2
) returns invoices
language plpgsql security invoker set search_path = public as $$
declare
  v_garage_id uuid := my_garage_id();
  v_exempt    boolean;
  v_locale    text;
  v_invoice   invoices;
  v_subtotal  numeric(14,3);
  v_vat_total numeric(14,3);
  v_breakdown jsonb;
  v_logo_id   uuid;
begin
  if v_garage_id is null then
    raise exception 'Seul un garage peut enregistrer une facture.'
      using errcode = '42501';
  end if;

  if p_decimals is null or p_decimals not between 0 and 3 then
    raise exception 'Nombre de décimales invalide : %.', p_decimals;
  end if;

  select vat_exempt, locale into v_exempt, v_locale
  from garages where id = v_garage_id;

  -- Le logo demandé n'est retenu que s'il appartient au garage courant. Un
  -- identifiant volé chez le voisin ne lève aucune erreur : il est ignoré,
  -- exactement comme un `garage_id` glissé dans l'en-tête.
  select id into v_logo_id
  from logos
  where id = nullif(p_header->>'logo_id', '')::uuid
    and garage_id = v_garage_id;

  if p_invoice_id is null then
    -- Création. Le RLS refuse ici si l'espace est en lecture seule.
    insert into invoices (
      garage_id, client_name, client_address, client_phone, client_vat_number,
      issue_date, service_date, notes, locale, vat_exempt, logo_id, created_by
    ) values (
      v_garage_id,
      nullif(btrim(p_header->>'client_name'), ''),
      nullif(btrim(p_header->>'client_address'), ''),
      nullif(btrim(p_header->>'client_phone'), ''),
      nullif(btrim(p_header->>'client_vat_number'), ''),
      coalesce(nullif(p_header->>'issue_date', '')::date, current_date),
      nullif(p_header->>'service_date', '')::date,
      nullif(btrim(p_header->>'notes'), ''),
      coalesce(v_locale, 'FR'),
      coalesce(v_exempt, false),
      v_logo_id,
      auth.uid()
    )
    returning * into v_invoice;
  else
    -- Modification. Le `where status = 'draft'` interdit de rouvrir une
    -- facture émise par ce chemin ; `invoices_guard_trg` le refuserait de
    -- toute façon, mais autant rendre le message clair.
    update invoices set
      client_name       = nullif(btrim(p_header->>'client_name'), ''),
      client_address    = nullif(btrim(p_header->>'client_address'), ''),
      client_phone      = nullif(btrim(p_header->>'client_phone'), ''),
      client_vat_number = nullif(btrim(p_header->>'client_vat_number'), ''),
      issue_date        = coalesce(nullif(p_header->>'issue_date', '')::date, issue_date),
      service_date      = nullif(p_header->>'service_date', '')::date,
      notes             = nullif(btrim(p_header->>'notes'), ''),
      vat_exempt        = coalesce(v_exempt, false),
      logo_id           = v_logo_id
    where id = p_invoice_id
      and status = 'draft'
    returning * into v_invoice;

    if not found then
      -- Soit la facture n'existe pas, soit le RLS l'a filtrée (elle est à un
      -- autre garage), soit elle n'est plus un brouillon. On ne dit pas
      -- laquelle : ce serait renseigner sur l'existence des factures d'autrui.
      raise exception 'Brouillon introuvable ou non modifiable.'
        using errcode = 'P0002';
    end if;
  end if;

  -- Les lignes sont remplacées en bloc : c'est ce qui rend la réorganisation
  -- et la suppression triviales, et l'atomicité de la transaction rend
  -- l'opération sûre.
  delete from invoice_lines where invoice_id = v_invoice.id;

  insert into invoice_lines (invoice_id, description, unit, quantity,
                             unit_price_ht, vat_rate, position)
  select
    v_invoice.id,
    btrim(ligne->>'description'),
    coalesce(nullif(btrim(ligne->>'unit'), ''), 'U'),
    coalesce((ligne->>'quantity')::numeric, 0),
    coalesce((ligne->>'unit_price_ht')::numeric, 0),
    coalesce((ligne->>'vat_rate')::numeric, 20),
    (ordinalite - 1)::int
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
       with ordinality as t(ligne, ordinalite)
  -- Une ligne sans désignation n'est pas une prestation : elle n'est pas
  -- persistée. Même règle que dans l'aperçu, appliquée ici pour qu'elle
  -- tienne quel que soit le chemin d'écriture.
  where btrim(coalesce(ligne->>'description', '')) <> '';

  -- ---------------------------------------------------------------------
  -- Totaux : recalculés ICI, depuis les lignes qui viennent d'être écrites.
  -- Aucun total transmis par le navigateur n'est accepté — l'aperçu temps
  -- réel est un confort d'affichage, pas une source. Même algorithme que
  -- `finalize_invoice()` : lignes arrondies, regroupées par taux, TVA
  -- calculée sur la base agrégée.
  -- ---------------------------------------------------------------------
  with bases as (
    select
      l.vat_rate as rate,
      round(sum(round(l.quantity * l.unit_price_ht, p_decimals)), p_decimals) as base_ht
    from invoice_lines l
    where l.invoice_id = v_invoice.id
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
  if coalesce(v_exempt, false) then
    v_vat_total := 0;
    v_breakdown := '[]'::jsonb;
  end if;

  update invoices set
    subtotal_ht   = v_subtotal,
    vat_total     = v_vat_total,
    total_ttc     = round(v_subtotal + v_vat_total + coalesce(stamp_duty, 0), p_decimals),
    vat_breakdown = v_breakdown
  where id = v_invoice.id
  returning * into v_invoice;

  return v_invoice;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. La facture émise gèle le CHEMIN de son logo
-- ---------------------------------------------------------------------------
-- Reprise de la fonction de la phase 2, avec un seul ajout : `logo_path` dans
-- `seller_snapshot`. Le document émis se relit alors sans jamais consulter
-- `logos` — c'est ce qui rend le gel réel, et pas seulement protégé. Le
-- trigger de la section 3 empêche par ailleurs le fichier de disparaître.
--
-- Le logo pris est celui de la facture si elle en porte un, sinon le logo par
-- défaut du garage : un garage standard n'en choisit aucun, et doit pourtant
-- voir le sien.
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
  v_logo_path text;
begin
  if p_decimals is null or p_decimals not between 0 and 3 then
    raise exception 'Nombre de décimales invalide : %.', p_decimals;
  end if;

  select * into v_invoice from invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Facture introuvable.' using errcode = 'P0002';
  end if;

  if not is_admin() and v_invoice.garage_id is distinct from my_garage_id() then
    raise exception 'Accès refusé à cette facture.' using errcode = '42501';
  end if;

  if v_invoice.status <> 'draft' then
    raise exception 'Seul un brouillon peut être finalisé (statut actuel : %).',
      v_invoice.status;
  end if;

  select * into v_garage from garages where id = v_invoice.garage_id for update;

  v_block := finalize_block_reason(v_invoice.garage_id);
  if v_block is not null and (not is_admin() or v_block in ('inactive', 'unknown')) then
    raise exception '%', finalize_block_message(v_invoice.garage_id);
  end if;

  if coalesce(trim(v_invoice.client_name), '') = '' then
    raise exception 'Le nom ou la dénomination du client est obligatoire.';
  end if;

  select count(*) into v_lines from invoice_lines where invoice_id = p_invoice_id;
  if v_lines = 0 then
    raise exception 'Une facture doit comporter au moins une ligne de prestation.';
  end if;

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

  if v_garage.vat_exempt then
    v_vat_total := 0;
    v_breakdown := '[]'::jsonb;
  end if;

  -- Le logo de la facture, ou à défaut celui du garage.
  select storage_path into v_logo_path
  from logos
  where id = v_invoice.logo_id;

  if v_logo_path is null then
    select storage_path into v_logo_path
    from logos
    where garage_id = v_invoice.garage_id and is_default
    limit 1;
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
      'bic',        v_garage.bic,
      -- Gelé comme le reste : la facture d'hier garde le logo d'hier.
      'logo_path',  v_logo_path
    )
  where id = p_invoice_id
  returning * into v_invoice;

  if v_garage.account_status = 'trial' then
    update garages
    set trial_invoices_used = trial_invoices_used + 1
    where id = v_garage.id
    returning trial_invoices_used into v_trial_used;

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
-- Un seul logo par défaut : le poser en retire le drapeau aux autres
-- ---------------------------------------------------------------------------
-- L'index de la section 2 REFUSE deux défauts ; encore faut-il pouvoir en
-- changer sans se heurter à lui. Cette fonction fait les deux écritures dans
-- une seule transaction — en deux appels PostgREST, un échec entre les deux
-- laisserait le garage sans aucun logo par défaut.
create or replace function set_default_logo(p_logo_id uuid) returns logos
language plpgsql security invoker set search_path = public as $$
declare
  v_logo logos;
begin
  -- SECURITY INVOKER : `logos_write` s'applique, donc l'appartenance et le
  -- drapeau premium sont vérifiés par le RLS, pas réécrits ici.
  update logos set is_default = false
  where garage_id = (select garage_id from logos where id = p_logo_id)
    and is_default;

  update logos set is_default = true
  where id = p_logo_id
  returning * into v_logo;

  if not found then
    raise exception 'Logo introuvable ou non modifiable.' using errcode = 'P0002';
  end if;

  return v_logo;
end;
$$;

grant execute on function set_default_logo(uuid) to authenticated, service_role;
