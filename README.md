# Facturation — SaaS multi-garages

Logiciel de facturation en ligne pour garagistes, en mode **SaaS multi-locataires**.
Chaque garage dispose de son compte, de ses factures, de son logo et de son abonnement ;
un compte administrateur central pilote l'ensemble.

Objectif produit : créer une facture **conforme en deux minutes** — saisie du client,
des prestations, calcul HT / TVA / TTC en temps réel, export PDF.

> ⚠️ **Avertissement.** Ce logiciel facilite la conformité mais ne s'y substitue pas.
> La conformité fiscale et comptable de vos factures doit être validée par un
> expert-comptable.

---

## Stack

| Domaine | Choix |
|---|---|
| Framework | Next.js (App Router) + TypeScript strict |
| UI | Tailwind CSS v4, shadcn/ui, lucide-react |
| Données / Auth / Stockage | Supabase (PostgreSQL, Auth, Storage, **RLS partout**) |
| Validation / formulaires | zod, react-hook-form |
| PDF | @react-pdf/renderer |
| Dates | date-fns, Intl |
| Hébergement | Vercel |

Pas d'ORM : accès via `@supabase/supabase-js` + `@supabase/ssr`, schéma écrit en SQL
dans `supabase/migrations`.

## Démarrage

```bash
npm install
cp .env.example .env.local   # puis renseigner les valeurs
npm run dev                  # http://localhost:3000
```

Sans configuration Supabase, l'application démarre quand même et affiche un écran
listant ce qui reste à brancher.

## Scripts

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run build` | Build de production |
| `npm run start` | Serveur de production |
| `npm run lint` | ESLint |
| `npm run db:seed` | Crée le compte super administrateur |

## Base de données

Le schéma est écrit à la main en SQL dans `supabase/migrations`, appliqué dans l'ordre
des noms de fichiers.

### Appliquer les migrations

Au choix, sur un projet Supabase :

```bash
# Option 1 — CLI (recommandé : garde une trace des migrations appliquées)
npx supabase link --project-ref <ref-du-projet>
npx supabase db push

# Option 2 — SQL Editor du dashboard
# Coller le contenu de chaque fichier de supabase/migrations/ dans l'ordre.
```

### Amorcer le super administrateur

Le super admin **ne peut pas s'auto-inscrire** : il n'y a pas de page d'inscription
publique, et la policy RLS sur `profiles` réserve l'insertion aux administrateurs — donc à
personne tant qu'il n'en existe aucun. Le script d'amorçage casse ce cercle en passant par
la clé service role, qui contourne le RLS.

```bash
# 1. Renseigner dans .env.local :
#      NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
#      SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD  (12 caractères minimum)
# 2. Lancer :
npm run db:seed
```

Le script crée le compte dans Supabase Auth (e-mail pré-confirmé), puis insère sa ligne
`profiles` avec `role = 'super_admin'` et `garage_id = null`. Il est **idempotent** :
relancé, il se contente de remettre le profil existant au bon rôle.

Pour le faire à la main depuis le dashboard : créer l'utilisateur dans *Authentication →
Users*, copier son UUID, puis exécuter dans le SQL Editor :

```sql
insert into profiles (id, role, garage_id, full_name, must_change_password)
values ('<uuid-du-compte>', 'super_admin', null, 'Super administrateur', false)
on conflict (id) do update set role = 'super_admin', garage_id = null;
```

### Vérifier l'isolation RLS

`supabase/tests/rls_isolation.sql` est une **preuve exécutable** : trois garages, un
administrateur, et une série d'assertions qui échouent bruyamment si une frontière cède.
Le script se termine par un `ROLLBACK` et ne laisse aucune trace.

```bash
psql "$DATABASE_URL" -f supabase/tests/rls_isolation.sql
# ou : coller dans le SQL Editor du dashboard
```

Il couvre : cloisonnement en lecture et en écriture entre garages (tables filles
comprises), escalade de privilège, immuabilité des factures émises, numérotation
séquentielle, passage en lecture seule sur abonnement expiré, drapeau premium sur les
logos, et isolation du bucket de stockage.

**Un test de sécurité qui ne sait pas échouer ne prouve rien.** L'en-tête du fichier liste
des mutations à injecter (retirer une policy, un trigger) : après toute modification du
schéma, vérifier que le test s'interrompt bien sur chacune.

### Tester hors ligne, sans projet Supabase

`supabase/tests/_local_supabase_stub.sql` reconstitue le strict minimum de l'environnement
Supabase (rôles `anon` / `authenticated` / `service_role`, schéma `auth` avec `auth.uid()`,
schéma `storage`). Il permet de rejouer migrations et test d'isolation sur un PostgreSQL
local :

```bash
createdb facture_test
psql -d facture_test -f supabase/tests/_local_supabase_stub.sql
for f in supabase/migrations/*.sql; do psql -d facture_test -v ON_ERROR_STOP=1 -f "$f"; done
psql -d facture_test -v ON_ERROR_STOP=1 -f supabase/tests/rls_isolation.sql
```

Ce fichier est un **outil de vérification**, il ne fait pas partie du schéma applicatif et
ne doit jamais être appliqué à un projet Supabase.

### Points de conception à connaître

- **Le numéro de facture est attribué à la finalisation**, jamais à la création du
  brouillon : c'est ce qui garantit une série sans trou. Un brouillon a `number = null`.
- **`finalize_invoice()` fait tout en une transaction** : contrôle d'accès, contrôle
  d'abonnement, recalcul des totaux depuis les lignes, attribution du numéro, gel des
  mentions du vendeur. Les totaux envoyés par le navigateur ne sont jamais utilisés.
- **Une facture émise est immuable** — garanti par trigger, donc quel que soit le chemin
  d'écriture. Conséquence : **un garage ayant émis des factures ne peut pas être supprimé**
  (conservation légale). Le désactiver (`is_active = false`) est la bonne opération.
- **L'identité légale du garage est maintenue par l'administrateur**, pas par le garage :
  SIRET, RCS, capital et forme juridique conditionnent la conformité des factures.

## Variables d'environnement

Voir `.env.example`. La clé `SUPABASE_SERVICE_ROLE_KEY` **contourne le RLS** : elle est
strictement serveur, jamais préfixée `NEXT_PUBLIC_`, et n'est utilisée que pour créer les
comptes Auth des garages depuis l'espace admin et pour le seed.

## Locale de facturation

Le produit est **multi-locale par conception** (`src/lib/locale/`). La locale active est
la **France** :

- devise **EUR**, 2 décimales, format `1 234,56 €` ;
- taux de TVA **20 / 10 / 5,5 / 2,1 / 0 %** ;
- **pas de timbre fiscal** (la colonne `stamp_duty` existe en base, vaut 0 et reste
  masquée dans l'UI française) ;
- mentions vendeur : dénomination, adresse, SIREN/SIRET, forme juridique, capital social,
  RCS + ville du greffe, n° de TVA intracommunautaire ;
- mentions de paiement obligatoires : délai de règlement, taux des pénalités de retard,
  indemnité forfaitaire de recouvrement de **40 €** ;
- garage en **franchise en base de TVA** : mention automatique
  « TVA non applicable, art. 293 B du CGI » et TVA masquée.

Ajouter un pays consiste à déposer un fichier de configuration dans `src/lib/locale/` :
aucune règle pays n'est codée en dur ailleurs.

## Roadmap conformité — facturation électronique (France)

La v1 produit un **PDF conforme sur le contenu**. La transmission électronique
obligatoire arrive ensuite :

| Échéance | Obligation |
|---|---|
| 1er septembre 2026 | **Réception** des factures électroniques, pour toutes les entreprises |
| 1er septembre 2027 | **Émission** pour les TPE / PME |

La phase 2 ajoutera la génération **Factur-X** (PDF/A-3 + XML CII embarqué), les formats
**UBL / CII**, et la transmission via le **PPF** (Portail public de facturation) ou une
**Plateforme Agréée (PA)**.

L'architecture est déjà prête : les données restent structurées (parties, lignes, taxes,
totaux), la génération PDF est isolée de la logique métier, et le modèle de données
prévoit les colonnes `facturx_status`, `facturx_xml_path`, `pa_reference` et
`ppf_reference`.

## Structure

```
src/
  app/                 routes App Router (/admin, /app, /login à venir)
  components/ui/       composants shadcn/ui
  lib/
    env.ts             validation zod des variables d'environnement
    format.ts          formatage montants / dates selon la locale
    locale/            configuration par pays (règles fiscales, mentions)
    supabase/          clients navigateur / serveur / admin + middleware
supabase/
  migrations/          schéma SQL versionné (phase 1)
```

## État d'avancement

- [x] **Phase 0** — Bootstrap : Next.js, Tailwind, shadcn/ui, clients Supabase, socle multi-locale, Git
- [x] **Phase 1** — Migrations SQL, RLS, Storage, seed super admin, preuve d'isolation
- [ ] **Phase 2** — Authentification, rôles, protection des routes
- [ ] **Phase 3** — Espace admin : CRUD garages, comptes de connexion, drapeau premium
- [ ] **Phase 4** — Abonnements, paiements, blocage en lecture seule
- [ ] **Phase 5** — Éditeur de facture avec aperçu temps réel
- [ ] **Phase 6** — Numérotation, finalisation, liste des factures
- [ ] **Phase 7** — Catalogue de prestations, carnet de clients
- [ ] **Phase 8** — Export PDF conforme
- [ ] **Phase 9** — Logos et bibliothèque premium
- [ ] **Phase 10** — Finitions, tests d'isolation RLS, accessibilité
- [ ] **Phase 11** — Déploiement GitHub + Vercel
