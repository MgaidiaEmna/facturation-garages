-- ============================================================================
-- Purge des données laissées par les scripts `verify:*`
-- ============================================================================
--
-- POURQUOI CE FICHIER EXISTE
-- ----------------------------------------------------------------------------
-- Chaque exécution d'un `verify:*` crée des garages, des comptes Auth, des
-- factures et des notifications. Rejoués quelques dizaines de fois, ils
-- ensevelissent les données réelles : 192 garages de vérification pour 8 vrais,
-- mesurés avant l'écriture de ce fichier.
--
-- POURQUOI ÇA NE PEUT PAS PASSER PAR L'APPLICATION
-- ----------------------------------------------------------------------------
-- `invoices_guard_trg` rend une facture émise INDESTRUCTIBLE, et c'est voulu :
-- conservation légale. Un garage qui a émis ne se supprime donc pas, ni par
-- l'écran d'administration, ni par la clé service role, ni par PostgREST. Or
-- `verify:emission` et `verify:pdf` émettent. La seule voie est de désactiver
-- les gardes le temps d'une transaction — ce qui exige les droits du
-- propriétaire des tables, donc du SQL exécuté dans le conteneur.
--
-- CE FICHIER EST DONC RÉSERVÉ AU LOCAL. Il n'est pas une migration, il n'est
-- jamais appliqué à un projet distant, et il ne doit jamais l'être : sa raison
-- d'être est précisément de contourner une protection légale.
--
-- CE QU'IL NE TOUCHE PAS
-- ----------------------------------------------------------------------------
-- Tout ce qui ne porte pas une adresse en `@verif.test`. Le super admin, les
-- garages réels et leurs factures sont hors de portée du filtre : la sélection
-- part des comptes Auth, jamais d'un « tout supprimer ».
--
-- USAGE
-- ----------------------------------------------------------------------------
--   psql -U supabase_admin … -v motif='%@verif.test'
--   psql -U supabase_admin … -v motif='%-mtrr67lj@verif.test'
--
-- Le rôle `supabase_admin` — le superutilisateur de la pile locale — est
-- exigé : `postgres` n'est PAS propriétaire de `storage.objects` et n'a pas le
-- droit d'endosser celui qui l'est. Une raison de plus pour que ce fichier ne
-- quitte jamais le local.
--
-- Passer par `npm run db:clean`, qui trouve le conteneur et pose le motif.
-- ============================================================================

\set ON_ERROR_STOP on

-- Motif par défaut si l'appelant n'en fournit pas.
\if :{?motif}
\else
  \set motif '%@verif.test'
\endif

-- ----------------------------------------------------------------------------
-- 1. Les dossiers du bucket à vider, relevés AVANT toute suppression.
--
-- Une fois les garages partis, plus rien ne relie un dossier `logos/<uuid>/`
-- à quoi que ce soit : le nom du dossier EST l'identifiant du garage. On le
-- capture donc pendant qu'on peut encore le calculer.
-- ----------------------------------------------------------------------------
select coalesce(
         string_agg(distinct quote_literal(g.id::text), ','),
         'null'
       ) as dossiers
  from garages g
  join profiles p on p.garage_id = g.id
  join auth.users u on u.id = p.id
 where u.email like :'motif'
\gset

-- ----------------------------------------------------------------------------
-- 2. Les tables applicatives, gardes en sourdine le temps d'une transaction.
--
-- `alter table … disable trigger user` ne touche qu'aux triggers applicatifs
-- et serait annulé par un `rollback`. On ne supprime jamais un trigger : on le
-- met en sourdine, puis on le rétablit explicitement.
-- ----------------------------------------------------------------------------
begin;

create temporary table cibles on commit drop as
  select distinct g.id
    from garages g
    join profiles p on p.garage_id = g.id
    join auth.users u on u.id = p.id
   where u.email like :'motif';

-- Les comptes Auth visés, y compris ceux restés sans garage : inscription
-- interrompue, ou compte créé par un scénario qui devait échouer.
create temporary table comptes on commit drop as
  select id from auth.users where email like :'motif';

alter table invoices disable trigger user;
alter table invoice_lines disable trigger user;
alter table logos disable trigger user;
alter table admin_notifications disable trigger user;
alter table profiles disable trigger user;

-- `admin_notifications.garage_id` est en `no action` : il faut les retirer
-- AVANT les garages, sinon la suppression échoue. Le reste part en cascade.
delete from admin_notifications
 where garage_id in (select id from cibles)
    or actor_id in (select id from comptes);

-- Les garages : emportent clients, prestations, logos, factures, lignes,
-- paiements, abonnements, compteurs et profils rattachés.
delete from garages where id in (select id from cibles);

-- Les comptes Auth : emportent les profils restants.
delete from auth.users where id in (select id from comptes);

alter table profiles enable trigger user;
alter table admin_notifications enable trigger user;
alter table logos enable trigger user;
alter table invoice_lines enable trigger user;
alter table invoices enable trigger user;

commit;

-- ----------------------------------------------------------------------------
-- 3. Le bucket, à part — parce qu'il appartient à quelqu'un d'autre.
--
-- `storage.objects` n'appartient pas à `postgres` mais à
-- `supabase_storage_admin`, et porte `protect_objects_delete`, qui interdit
-- la suppression directe d'une ligne pour qu'aucun fichier ne se retrouve
-- orphelin sur le disque. Seul un superutilisateur peut le mettre en
-- sourdine — d'où la connexion en `supabase_admin`.
--
-- Les fichiers restent dans le volume Docker. En local ce sont de faux logos
-- de quelques octets, dans un volume jetable — on assume de les y laisser
-- plutôt que de rebrancher l'API Storage pour du ménage.
--
-- La liste des dossiers est INTERPOLÉE (littéraux échappés par `quote_literal`
-- à l'étape 1) plutôt que jointe : la table temporaire aura disparu au
-- `commit` précédent.
-- ----------------------------------------------------------------------------
begin;

alter table storage.objects disable trigger protect_objects_delete;

delete from storage.objects
 where bucket_id = 'logos'
   and (storage.foldername(name))[1] in (:dossiers);

-- Et les ORPHELINS : un dossier `logos/<uuid>/` dont plus aucun garage ne
-- porte l'identifiant. Ils s'accumulent dès qu'une purge échoue à mi-course,
-- ou qu'un garage est supprimé par l'écran d'administration — la cascade SQL
-- ne descend pas jusqu'au bucket. Cette passe rattrape les deux cas, ce qui
-- rend le nettoyage rejouable sans état d'âme.
delete from storage.objects
 where bucket_id = 'logos'
   and (storage.foldername(name))[1] not in (select id::text from garages);

alter table storage.objects enable trigger protect_objects_delete;
commit;

-- ----------------------------------------------------------------------------
-- 4. Les seaux de débit.
--
-- Ils ne portent que des empreintes HMAC, sans lien avec un compte :
-- impossible de les rattacher au motif. Ils expirent seuls à 24 h ; on se
-- contente de retirer ceux qui sont déjà périmés.
-- ----------------------------------------------------------------------------
delete from auth_rate_limits where window_started_at < now() - interval '24 hours';
