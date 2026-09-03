# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commandes

```bash
npm run dev      # serveur de dev (http://localhost:3000)
npm run build    # build de production
npm run start    # serveur de production
npm run lint     # ESLint
```

Base de données : migrations SQL versionnées à la main dans `supabase/migrations`, appliquées
via la CLI Supabase (`supabase migration new <nom>`, `supabase db push`). **Pas d'ORM**, pas de
migration générée automatiquement.

Aucun framework de test n'est encore installé (prévu Phase 10).

## Nature du projet

SaaS de facturation multi-locataires pour garagistes. Construit **par phases numérotées 0 → 11**
(voir « État d'avancement » dans `README.md`). À la fin de chaque phase : récapituler ce qui
marche, lancer l'app pour le vérifier, puis **attendre le feu vert de l'utilisateur** avant
d'enchaîner.

Code et commentaires en **français**, TypeScript strict.

## Architecture

### Multi-tenant : un garage = un tenant

L'isolation repose **entièrement sur le RLS Postgres**, jamais sur des filtres applicatifs.
Deux fonctions SQL `security definer` sont la clé de voûte de toutes les policies :

- `is_admin()` → l'utilisateur courant a `role = 'super_admin'`
- `my_garage_id()` → le `garage_id` de l'utilisateur courant, lu dans `profiles`

Règle absolue : **l'appartenance d'un utilisateur à un garage vient du serveur (`profiles`),
jamais d'une valeur envoyée par le client.** Toute nouvelle table porte un `garage_id` et des
policies déclinées sur ce modèle ; `invoice_lines` remonte au garage via un `exists` sur
`invoices.garage_id`.

### Les trois clients Supabase (`src/lib/supabase/`)

| Fichier | Usage | RLS |
|---|---|---|
| `client.ts` | Composants Client | appliqué |
| `server.ts` | Server Components, Server Actions, Route Handlers — **le défaut côté serveur** | appliqué |
| `admin.ts` | service role, **contourne le RLS** | ignoré |

`admin.ts` et `server.ts` importent `server-only` : impossible de les faire fuir dans un bundle
navigateur. Tout appel à `createAdminClient()` doit être précédé d'une vérification explicite
que l'appelant est `super_admin`. Son seul usage prévu : créer le compte Auth d'un garage, et le
script de seed.

`src/proxy.ts` (convention Next.js 16, ex-`middleware.ts`) rafraîchit la session à chaque
requête via `lib/supabase/middleware.ts`.
Toujours `getUser()` et jamais `getSession()` : seul le premier revalide le JWT auprès du
serveur Auth.

### Trois espaces, deux rôles + un drapeau

| Espace | Route | Accès |
|---|---|---|
| Super admin | `/admin/*` | `role = 'super_admin'` uniquement |
| Garage | `/app/*` | `role = 'garage'` |
| Connexion | `/login` | public — **pas d'inscription publique** |

Le « garage premium » n'est **pas un rôle** : c'est le booléen
`garages.logo_management_enabled`. Il débloque la bibliothèque de logos et le sélecteur de logo
par facture. Un garage standard subit le logo assigné par l'admin.

Les comptes garages sont créés par l'admin. Le super admin est amorcé par le script de seed.

### Chaîne de vérification d'une action garage

Chaque Server Action / Route Handler vérifie, **dans cet ordre et côté serveur** :

1. session authentifiée ;
2. rôle attendu (chargé depuis `profiles`) ;
3. **abonnement actif** (`subscriptions.end_date >= current_date`) pour toute écriture métier ;
4. validation zod des entrées.

Le middleware et l'UI ne sont qu'une commodité — ils ne sont jamais la barrière de sécurité.
Abonnement expiré ⇒ `/app` passe en **lecture seule** (bandeau + finalisation bloquée).

### Moteur de facture

Les totaux affichés dans l'aperçu temps réel sont calculés côté client pour l'UX, mais
**systématiquement recalculés côté serveur à la finalisation**. Ne jamais persister des totaux
envoyés par le navigateur.

```
line_total_ht = quantity * unit_price_ht
subtotal_ht   = Σ line_total_ht
tva par taux  = regrouper les lignes par tva_rate, puis base * taux / 100
total_ttc     = subtotal_ht + tva_total + stamp_duty
```

`stamp_duty` vaut **toujours 0 en France** : la colonne n'existe que pour le multi-locale et
l'UI française ne doit ni l'afficher ni la saisir (piloté par `LocaleConfig.hasStampDuty`).

**Numérotation** : `next_invoice_number(garage_id)` (incrément atomique dans `invoice_counters`,
format `AAAA-000001`) est appelée **au moment de la finalisation, jamais à l'ouverture du
brouillon** — sinon la série légale a des trous. Le numéro est **strictement automatique et non
modifiable**. Cycle de vie : `draft → final → cancelled`. Une facture `final` n'est **pas
supprimable** (annulation par avoir, prévue plus tard).

Isoler la génération PDF de la logique métier : le calcul des totaux et la structuration des
données (parties, lignes, taxes) doivent être réutilisables tels quels par le futur export
Factur-X.

### Socle multi-locale (`src/lib/locale/`)

**Toute règle qui dépend du pays vit dans `LocaleConfig`** — devise, décimales, taux de TVA,
timbre fiscal, champs d'identité du vendeur, mentions légales. Rien de tout cela n'est codé en
dur ailleurs dans l'app. Ajouter un pays = ajouter un fichier de config + élargir le type
`LocaleCode`.

Formatage des montants et des dates : passer par `src/lib/format.ts`, jamais par un `toFixed()`
ou un `Intl` en ligne.

### Storage

Bucket `logos` **privé**, arborescence `logos/{garage_id}/{fichier}`. Policies : un garage
n'accède qu'à son dossier, l'admin partout. Images servies par **URL signée**, jamais publique.

## Conformité France

Locale active : **France / EUR**, 2 décimales, format `1 234,56 €`. TVA 20 / 10 / 5,5 / 2,1 / 0 %.
**Pas de timbre fiscal.**

Mentions à faire figurer sur la facture :

- **Vendeur** : dénomination, adresse, SIREN/SIRET, forme juridique + capital social,
  RCS + ville du greffe, n° de TVA intracommunautaire.
- **Client** : nom, adresse, + n° de TVA intracommunautaire en B2B le cas échéant.
- **Facture** : date d'émission, numéro séquentiel unique, date de prestation, désignation
  précise, quantité, prix unitaire HT, taux de TVA par ligne, total HT par taux, montant de TVA
  par taux, total TTC.
- **Paiement (obligatoire)** : date ou délai de règlement, taux des pénalités de retard,
  **indemnité forfaitaire de recouvrement de 40 €**.
- **Franchise en base de TVA** : réglage par garage. Si activé, afficher automatiquement
  « TVA non applicable, art. 293 B du CGI » et masquer toute la TVA.

Un **disclaimer** doit rester visible dans l'app et le README : le logiciel facilite la
conformité mais ne remplace pas un expert-comptable.

### Roadmap e-facture (phase 2 — ne pas implémenter en v1)

Réception obligatoire au **1er sept. 2026**, émission TPE/PME au **1er sept. 2027**. Formats
**Factur-X / UBL / CII**, transmission via le **PPF** (Portail public de facturation) ou une
**Plateforme Agréée**. Le modèle de données prévoit `facturx_status`, `facturx_xml_path`,
`pa_reference`, `ppf_reference`.

## UI

Design sobre et professionnel, palette neutre, responsive (utilisable sur tablette). shadcn/ui
en base « radix », préréglage Nova ; les composants vivent dans `src/components/ui/`.

Note : cette version de shadcn ne fournit plus `form.tsx` — utiliser `field.tsx` avec
react-hook-form.

Soigner les états vides, les messages d'erreur, les confirmations avant action destructrice.
Toasts via `sonner` (`<Toaster />` est monté dans le layout racine).

## Environnement

`src/lib/env.ts` est volontairement **tolérant** : sans configuration Supabase, l'app démarre et
affiche un écran de configuration au lieu de planter. Les accès réels appellent
`requireSupabaseEnv()`, qui lève une erreur explicite. Les variables `NEXT_PUBLIC_*` doivent être
lues littéralement (`process.env.NEXT_PUBLIC_X`) pour que Next.js puisse les inliner au build.

## Git

Le dépôt est local à `Desktop/Facture`. Attention : le dossier parent `C:/Users/ASUS` est
lui-même un dépôt Git couvrant tout le profil utilisateur — ne jamais y remonter pour commiter.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
