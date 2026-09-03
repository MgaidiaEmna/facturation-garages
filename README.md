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
- [ ] **Phase 1** — Migrations SQL, RLS, Storage, seed super admin
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
