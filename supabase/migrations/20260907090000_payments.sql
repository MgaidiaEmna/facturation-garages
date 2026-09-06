-- ===========================================================================
-- Phase 4 — Abonnements et paiements
--
-- L'encaissement est HORS LIGNE : l'administrateur reçoit un virement, un
-- chèque ou des espèces, puis en consigne la trace ici. Rien dans ce fichier
-- ne parle à un prestataire de paiement.
--
-- Aucune policy ajoutée : `subscriptions_admin_write` et `payments_admin_write`
-- sont déjà `for all` sur `is_admin()`, et `*_select` laissent le garage lire
-- ce qui le concerne. Le garage consulte, l'administrateur décide.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Deux colonnes qui manquaient à l'historique
-- ---------------------------------------------------------------------------
-- `created_at` date la SAISIE. Un encaissement hors ligne se saisit souvent
-- après coup — le chèque du 3 est enregistré le 7 — et c'est la date du
-- paiement qui compte pour la comptabilité du garage.
alter table payments
  add column paid_on date not null default current_date;

-- Jusqu'où l'abonnement a été porté par CE paiement. Sans cette colonne,
-- l'historique ne saurait pas raconter une prolongation à date personnalisée
-- (`months_added` est alors nul) et il faudrait la recalculer de proche en
-- proche, donc la deviner.
alter table payments
  add column period_end date;

comment on column payments.paid_on is
  'Date de l''encaissement réel, distincte de created_at qui date la saisie.';
comment on column payments.period_end is
  'Fin d''abonnement obtenue par ce paiement. Rend l''historique lisible seul.';

create index payments_garage_id_paid_on_idx on payments (garage_id, paid_on desc);

-- ---------------------------------------------------------------------------
-- register_payment() — l'encaissement et la prolongation, ensemble
-- ---------------------------------------------------------------------------
-- POURQUOI UNE FONCTION, ET PAS DEUX APPELS DEPUIS L'APPLICATION
--
-- Consigner un paiement et prolonger l'abonnement sont deux écritures dans
-- deux tables. Passées en deux requêtes PostgREST, elles ne partagent aucune
-- transaction : un échec entre les deux laisse soit un encaissement sans
-- prolongation (le garage a payé et reste bloqué), soit une prolongation sans
-- trace (l'argent n'existe nulle part). Sur de l'argent, ces deux états ne se
-- rattrapent pas à la main. Ici, tout tient dans une transaction : les deux,
-- ou ni l'une ni l'autre.
--
-- POURQUOI LA RÈGLE DE DATE EST ICI
--
-- Nouvelle échéance = `greatest(échéance actuelle, aujourd'hui) + N mois`.
-- Renouveler un abonnement encore valide AJOUTE au temps restant ; renouveler
-- un abonnement échu repart d'aujourd'hui. Si l'écran recalculait cette règle
-- pour annoncer « prolongé jusqu'au… », les deux finiraient par diverger et
-- l'annonce mentirait. Même principe que `finalize_block_message()`.
--
-- `security definer` parce qu'elle écrit dans deux tables réservées à
-- l'administrateur ; elle refait donc elle-même le contrôle `is_admin()` —
-- une fonction definer s'exécute hors RLS, le garde-fou ne peut pas venir
-- d'ailleurs.
create or replace function register_payment(
  p_garage_id uuid,
  p_amount    numeric        default null,
  p_method    payment_method default 'virement',
  p_paid_on   date           default current_date,
  p_notes     text           default null,
  p_months    int            default null,
  p_end_date  date           default null
) returns subscriptions
language plpgsql security definer set search_path = public as $$
declare
  v_current date;
  v_base    date;
  v_new_end date;
  v_sub     subscriptions;
begin
  if not is_admin() then
    raise exception 'Seul un administrateur peut enregistrer un paiement.'
      using errcode = '42501';
  end if;

  if not exists (select 1 from garages where id = p_garage_id) then
    raise exception 'Garage introuvable.' using errcode = '42501';
  end if;

  -- Une prolongation se dit d'UNE façon : soit une durée, soit une date.
  -- Accepter les deux obligerait à choisir laquelle gagne, et ce choix
  -- silencieux finirait par surprendre.
  if (p_months is null) = (p_end_date is null) then
    raise exception 'Indiquez soit une durée en mois, soit une date de fin — pas les deux.';
  end if;

  if p_months is not null and (p_months < 1 or p_months > 60) then
    raise exception 'La durée doit être comprise entre 1 et 60 mois.';
  end if;

  if p_amount is not null and p_amount < 0 then
    raise exception 'Le montant ne peut pas être négatif.';
  end if;

  -- Une date de fin déjà passée fermerait l'accès au lieu de l'ouvrir : ce
  -- n'est pas ce qu'on attend d'un paiement. Couper un accès est une autre
  -- opération — la désactivation du garage.
  if p_end_date is not null and p_end_date < current_date then
    raise exception 'La date de fin ne peut pas être antérieure à aujourd''hui.';
  end if;

  select end_date into v_current from subscriptions where garage_id = p_garage_id;

  -- Un abonnement échu ne rend pas ses jours perdus : on repart d'aujourd'hui.
  v_base := greatest(coalesce(v_current, current_date), current_date);

  v_new_end := case
    when p_end_date is not null then p_end_date
    else (v_base + make_interval(months => p_months))::date
  end;

  insert into payments (garage_id, amount, method, paid_on, months_added, notes,
                        period_end, created_by)
  values (p_garage_id, p_amount, p_method, p_paid_on, p_months, nullif(btrim(p_notes), ''),
          v_new_end, auth.uid());

  -- Une ligne d'abonnement par garage (`garage_id` est unique) : le premier
  -- paiement la crée, les suivants repoussent l'échéance. `start_date` ne
  -- bouge pas — c'est le début de la relation, et l'historique des périodes
  -- vit dans `payments`.
  insert into subscriptions (garage_id, start_date, end_date, updated_by)
  values (p_garage_id, current_date, v_new_end, auth.uid())
  on conflict (garage_id) do update
    set end_date   = excluded.end_date,
        updated_by = excluded.updated_by,
        updated_at = now()
  returning * into v_sub;

  -- `subscriptions_end_trial_trg` a fait le reste : le garage qui était en
  -- essai passe en `subscribed`, et le plafond des 3 factures tombe.
  return v_sub;
end;
$$;

comment on function register_payment(uuid, numeric, payment_method, date, text, int, date) is
  'Consigne un encaissement hors ligne ET prolonge l''abonnement, dans une '
  'seule transaction. Réservée à l''administrateur (is_admin() vérifié dans '
  'le corps). Nouvelle échéance = greatest(échéance, aujourd''hui) + N mois.';

grant execute on function register_payment(uuid, numeric, payment_method, date, text, int, date)
  to authenticated, service_role;
