-- ===========================================================================
-- Phase 5 — Éditeur de facture : enregistrement d'un brouillon
--
-- Aucune policy ajoutée. `invoices_*` et `invoice_lines_*` couvrent déjà tout,
-- y compris le passage en lecture seule : leur `with check` exige
-- `my_write_access()`, donc un abonnement échu ferme l'écriture sans qu'une
-- ligne de code applicatif ait à s'en soucier.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- save_invoice_draft() — l'en-tête et les lignes, ensemble
-- ---------------------------------------------------------------------------
-- POURQUOI `SECURITY INVOKER`, ET NON `DEFINER`
--
-- C'est le contraire du choix fait pour `finalize_invoice()`,
-- `register_payment()` ou `garage_is_deletable()`, et c'est délibéré : cette
-- fonction n'a besoin d'AUCUN privilège supplémentaire. Tout ce qu'elle fait,
-- le garage a le droit de le faire. En `invoker`, le RLS continue de
-- s'appliquer à chacune de ses requêtes : l'isolation entre garages et le
-- passage en lecture seule restent assurés par les policies, pas par du code
-- défensif écrit ici. Une fonction `definer` aurait exigé de réécrire ces
-- contrôles à la main — donc de pouvoir les oublier.
--
-- Ce qu'elle apporte, c'est l'ATOMICITÉ. Enregistrer un brouillon, c'est
-- écrire l'en-tête, effacer les anciennes lignes et insérer les nouvelles.
-- En trois appels PostgREST, un échec après le `delete` laisse un brouillon
-- amputé de ses lignes, sans que personne l'ait demandé.
--
-- Et le `garage_id` vient de `my_garage_id()`, JAMAIS d'un paramètre. Le
-- navigateur ne désigne pas le garage : il ne peut pas se tromper de locataire
-- ni prétendre en être un autre.
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

  if p_invoice_id is null then
    -- Création. Le RLS refuse ici si l'espace est en lecture seule.
    insert into invoices (
      garage_id, client_name, client_address, client_phone, client_vat_number,
      issue_date, service_date, notes, locale, vat_exempt, created_by
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
      vat_exempt        = coalesce(v_exempt, false)
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

comment on function save_invoice_draft(uuid, jsonb, jsonb, int) is
  'Enregistre un brouillon (en-tête + lignes) en une transaction. '
  'SECURITY INVOKER : le RLS s''applique, l''isolation et la lecture seule '
  'restent l''affaire des policies. Le garage vient de my_garage_id(), jamais '
  'd''un paramètre. Les totaux sont recalculés depuis les lignes.';

grant execute on function save_invoice_draft(uuid, jsonb, jsonb, int)
  to authenticated;
