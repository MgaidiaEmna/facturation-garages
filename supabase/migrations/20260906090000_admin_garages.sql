-- ===========================================================================
-- Phase 3 — Espace administrateur : fiches garages
--
-- AUCUNE nouvelle policy. `garages_admin_write` est déjà `for all` sur
-- `is_admin()` : l'administrateur peut déjà lire, créer, modifier et
-- supprimer une fiche garage. Ajouter quoi que ce soit ici reviendrait à
-- rouvrir une porte déjà ouverte — ou pire, à en ouvrir une deuxième dont
-- personne ne se souviendrait.
--
-- Deux fonctions seulement, toutes deux `security definer` et gardées par
-- `is_admin()`, pour deux choses que le RLS seul ne sait pas dire à l'UI.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- garage_is_deletable() — la règle de suppression, écrite UNE fois
-- ---------------------------------------------------------------------------
-- Un garage n'est supprimable que s'il n'a JAMAIS émis de facture. Dès la
-- première finalisation, la conservation légale prime : le garage se
-- désactive (`is_active = false`), il ne s'efface plus.
--
-- Pourquoi cette règle vit en SQL et pas dans l'application : c'est déjà la
-- base qui l'applique — `invoices_guard_trg` fait échouer la suppression en
-- cascade sur la première facture non-`draft`. Si l'UI recomptait la règle en
-- TypeScript, l'annonce (« bouton grisé ») et le refus (l'exception du
-- trigger) pourraient diverger : un bouton actif qui produit une erreur
-- illisible, ou un bouton grisé sans raison. Même principe que
-- `finalize_block_message()` / `finalize_invoice()` — une seule source.
--
-- La fonction est `security definer` pour interroger `invoices` sans
-- dépendre du RLS de l'appelant, et refuse tout net à un non-administrateur.
-- Elle répond `false`, jamais une erreur : c'est une question d'affichage,
-- et un garage qui la pose n'apprend rien qu'il ne sache déjà.
create or replace function garage_is_deletable(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin()
     and exists (select 1 from garages where id = g)
     and not exists (
       select 1 from invoices i
       where i.garage_id = g
         and i.status <> 'draft'
     );
$$;

comment on function garage_is_deletable(uuid) is
  'Vrai si l''appelant est administrateur et que le garage n''a émis aucune '
  'facture. Même règle que celle appliquée par invoices_guard_trg à la '
  'suppression en cascade : l''annonce et le refus ne peuvent pas diverger.';

grant execute on function garage_is_deletable(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- garage_accounts() — le compte de connexion, sans clé service role
-- ---------------------------------------------------------------------------
-- L'adresse de CONNEXION vit dans `auth.users`, que PostgREST n'expose pas.
-- `garages.email` est une adresse de CONTACT : elle est reprise sur les
-- factures et l'administrateur peut la modifier depuis la fiche. Les deux
-- coïncident à la création du compte, puis divergent dès la première
-- correction — afficher l'une pour l'autre serait un mensonge d'interface,
-- exactement là où l'administrateur a besoin de certitude (« à quelle
-- adresse ce garage se connecte-t-il ? »).
--
-- Une fonction `security definer` gardée par `is_admin()` répond à la
-- question sans ouvrir un quatrième usage de la clé service role : le droit
-- de lire est déjà celui que le RLS accorde à l'administrateur sur
-- `profiles`, on ne fait que joindre la colonne qui manque.
create or replace function garage_accounts(g uuid)
returns table (
  user_id              uuid,
  email                text,
  full_name            text,
  must_change_password boolean,
  email_confirmed      boolean,
  last_sign_in_at      timestamptz
)
language sql stable security definer set search_path = public as $$
  select p.id,
         u.email::text,
         p.full_name,
         p.must_change_password,
         u.email_confirmed_at is not null,
         u.last_sign_in_at
  from profiles p
  join auth.users u on u.id = p.id
  where is_admin()
    and p.role = 'garage'
    and p.garage_id = g
  order by p.created_at;
$$;

comment on function garage_accounts(uuid) is
  'Comptes de connexion rattachés à un garage. Réservée à l''administrateur '
  '(is_admin() dans le WHERE : un non-admin obtient zéro ligne, pas une '
  'erreur). Ne renvoie aucun secret — Supabase Auth hache les mots de passe.';

grant execute on function garage_accounts(uuid) to authenticated, service_role;
