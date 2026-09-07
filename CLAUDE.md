# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commandes

```bash
npm run dev      # serveur de dev (http://localhost:3000)
npm run build    # build de production
npm run start    # serveur de production
npm run lint     # ESLint
```

```bash
npm run db:seed         # crée le compte super administrateur (idempotent)
npm run verify:auth     # parcours d'authentification de bout en bout
npm run verify:garages  # espace d'administration des garages (phase 3)
npm run verify:factures # éditeur de facture (phase 5)
```

Les scripts `verify:*` pilotent l'application **réellement lancée** en se comportant
comme un navigateur sans JavaScript (les Server Actions de Next sont rendues en amélioration
progressive) ; ils partagent `scripts/lib/navigateur.mjs`. Ils exigent la pile Supabase locale,
`npm run dev` et le seed, et vérifient le **câblage** — actions, proxy, gardes de layout,
redirections ; les preuves de **frontières**, elles, restent en SQL. Un RLS parfait derrière un
formulaire mal branché ne sert à rien, et l'inverse est encore plus vrai.

Angle mort assumé : ce qui n'existe dans le HTML qu'après exécution du JavaScript — contenu
d'une boîte de dialogue Radix, interrupteurs — échappe à ces scripts. On l'éprouve par son
effet en base, avec la session de l'utilisateur (jamais la clé service role, qui contournerait
ce qu'on veut vérifier). Un test navigateur est prévu en phase 10.

Base de données : migrations SQL versionnées à la main dans `supabase/migrations`, appliquées
via la CLI Supabase (`supabase migration new <nom>`, `supabase db push`). **Pas d'ORM**, pas de
migration générée automatiquement.

```bash
npx supabase start   # pile Supabase locale (Docker) — config dans supabase/config.toml
npx supabase stop    # l'arrêter
```

`supabase/config.toml` porte un réglage non négociable : `[auth.email] enable_confirmations = true`.
L'inscription en ligne exige la vérification d'e-mail ; `signUpAction()` refuse d'aboutir si le
projet la désactive, plutôt que de laisser entrer un compte non vérifié.

Deux preuves exécutables, à rejouer après toute modification du schéma :

```bash
psql "$DATABASE_URL" -f supabase/tests/rls_isolation.sql   # frontières (20 sections)
psql "$DATABASE_URL" -f supabase/tests/rate_limit.sql      # le limiteur compte juste
```

`rls_isolation.sql` prouve que les compteurs de débit sont hors de portée ; `rate_limit.sql`
prouve qu'ils bloquent réellement. Un limiteur inaccessible mais qui ne bloque jamais ne protège
de rien. Pour la
rejouer sans projet Supabase, appliquer d'abord `supabase/tests/_local_supabase_stub.sql` sur un
PostgreSQL local (il reconstitue les rôles et les schémas `auth` / `storage`) — voir README.
Sous Windows, exporter `PGCLIENTENCODING=UTF8` avant `psql` : sans cela les accents des messages
sont mal décodés et les assertions sur les libellés échouent à tort.

Aucun framework de test JS n'est installé (prévu Phase 10).

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
navigateur. **La liste des usages de `createAdminClient()` est close** — trois, pas un de plus :

| Usage | Fichier | Pourquoi le RLS ne suffit pas |
|---|---|---|
| Créer / réinitialiser / supprimer le compte Auth d'un garage | `lib/auth/admin-actions.ts` | l'API `auth.admin` exige la clé service role |
| Amorcer le super admin | `scripts/seed-admin.mts` | aucun admin n'existe encore pour s'auto-autoriser |
| Compter les tentatives de connexion | `lib/auth/rate-limit.ts` | l'appelant n'est **pas encore authentifié** |

Les deux premiers sont précédés d'un `requireAdmin()` explicite. Le troisième ne peut pas
l'être — c'est justement son objet : ouvrir `auth_rate_limit_hit()` à `anon` permettrait de
faire bloquer l'adresse e-mail de son choix depuis l'API REST publique. Ajouter un quatrième
usage demande de justifier pourquoi le RLS ne peut pas faire le travail.

`src/proxy.ts` (convention Next.js 16, ex-`middleware.ts`) rafraîchit la session à chaque
requête via `lib/supabase/middleware.ts`.
Toujours `getUser()` et jamais `getSession()` : seul le premier revalide le JWT auprès du
serveur Auth.

### Trois espaces, deux rôles + un drapeau

| Espace | Route | Accès |
|---|---|---|
| Super admin | `/admin/*` | `role = 'super_admin'` uniquement |
| Garage | `/app/*` | `role = 'garage'` |
| Connexion | `/login` | public |
| Inscription | `/signup` | public — **avec vérification d'e-mail obligatoire** |

Le « garage premium » n'est **pas un rôle** : c'est le booléen
`garages.logo_management_enabled`. Il débloque la bibliothèque de logos et le sélecteur de logo
par facture. Un garage standard subit le logo assigné par l'admin.

Le super admin est amorcé par le script de seed. Un compte garage naît par **deux chemins**,
qui aboutissent au même modèle de données (`garages.origin` les distingue) :

| | Créé par l'admin (`origin = 'admin'`) | Inscription en ligne (`origin = 'self_signup'`) |
|---|---|---|
| Vérification d'e-mail | **non** — compte pré-confirmé (`email_confirm: true`) | **oui**, obligatoire |
| Accès | immédiat | après ouverture du lien reçu |
| Mot de passe | fixé par l'admin, **changement forcé** à la 1re connexion | choisi par la personne, rien à forcer |
| Facturation | abonnement fixé par l'admin | **essai gratuit : 3 factures finalisées** |

L'admin encaisse hors ligne, puis enregistre un abonnement : le trigger
`subscriptions_end_trial_trg` fait passer le garage de `trial` à `subscribed`, et le contrôle
redevient une affaire de date.

### Chaîne de vérification d'une action garage

Chaque Server Action / Route Handler vérifie, **dans cet ordre et côté serveur** :

1. session authentifiée ;
2. **adresse e-mail vérifiée** ;
3. rôle attendu (chargé depuis `profiles`) ;
4. **droit d'écrire** (`has_write_access()` : abonnement en cours **ou** essai) pour toute
   écriture métier ;
5. validation zod des entrées.

`requireAdmin()` / `requireGarage()` (`lib/auth/session.ts`) enchaînent 1 à 3 et sont appelées
dans les **layouts** `/admin` et `/app`. Le proxy (`src/proxy.ts`) ne tranche que sur la
présence d'une session : il ne lit jamais `profiles`, et un proxy contourné n'ouvre rien.

Le middleware et l'UI ne sont qu'une commodité — ils ne sont jamais la barrière de sécurité.
Abonnement expiré ⇒ `/app` passe en **lecture seule** (bandeau + finalisation bloquée).

**Essai gratuit épuisé ⇒ l'écriture reste ouverte, seule la FINALISATION est bloquée.** Le
garage continue de saisir des brouillons ; c'est l'émission qui produit une facture légale, donc
c'est elle qu'on plafonne. `finalize_block_reason()` donne le code, `finalize_block_message()`
la phrase affichée — **la même** que celle levée par `finalize_invoice()`, pour qu'annonce et
refus ne puissent pas diverger.

### Espace admin (`/admin`)

| Écran | Route |
|---|---|
| Tableau de bord | `/admin` |
| Garages — liste, recherche, filtre actif/inactif | `/admin/garages` |
| Fiche garage | `/admin/garages/[id]` |
| Comptes de connexion | `/admin/comptes`, `/admin/comptes/nouveau` |
| Journal | `/admin/notifications` |

Un garage **lit** sa fiche, il ne l'écrit pas : `garages_admin_write` est la seule voie
d'écriture. Le formulaire d'identité du vendeur se **génère depuis
`LocaleConfig.sellerIdentityFields`** — la même liste sert à l'affichage, au calcul des
mentions manquantes (`missingSellerFields()`) et au futur pied de facture. Ne jamais y
réécrire la liste des champs en dur.

Une fiche **incomplète s'enregistre**. Le format est validé (zod), la présence ne l'est pas.

Deux fonctions SQL portent ce que le RLS seul ne sait pas dire à l'UI :

| Fonction | Rôle | Pourquoi en SQL |
|---|---|---|
| `garage_is_deletable(g)` | aucune facture non-`draft` | `invoices_guard_trg` appliquera la même règle à la cascade ; la recalculer en TypeScript la ferait diverger — même principe que `finalize_block_message()` |
| `garage_accounts(g)` | comptes de connexion + adresse réelle | l'adresse de connexion vit dans `auth.users`, hors PostgREST ; `garages.email` est une adresse de **contact**, modifiable, et les deux divergent dès la première correction |
| `register_payment(...)` | encaissement **et** prolongation | deux écritures dans deux tables : en deux appels PostgREST elles ne partagent aucune transaction, et un échec entre les deux laisse un garage qui a payé mais reste bloqué |
| `save_invoice_draft(...)` | en-tête + lignes d'un brouillon | trois écritures (en-tête, purge des lignes, insertion) : un échec après la purge laisserait un brouillon amputé. **Seule fonction en `security invoker`** — voir ci-dessous |

Les deux sont `security definer` et gardées par `is_admin()` **dans le corps** : un
non-administrateur obtient `false` / zéro ligne, pas une erreur. Aucune n'ouvre un quatrième
usage de la clé service role.

### Abonnements et paiements

Encaissement **hors ligne** ; aucun prestataire de paiement n'est branché. `register_payment()`
consigne le paiement et repousse l'échéance dans **une seule transaction**.

Règle de prolongation, écrite dans la fonction et nulle part ailleurs :
**`greatest(échéance actuelle, aujourd'hui) + N mois`**. Un renouvellement anticipé ajoute au
temps restant ; un abonnement échu repart d'aujourd'hui. Durée **ou** date personnalisée,
jamais les deux — accepter les deux obligerait à choisir laquelle gagne, et ce choix
silencieux surprendrait.

Ne jamais recalculer cette date en TypeScript pour l'afficher : c'est la valeur renvoyée par
la fonction qu'on montre. Deux calculs = deux vérités qui finiront par diverger.

`payments.paid_on` date l'encaissement réel, `created_at` la saisie — un chèque du 3 est
souvent enregistré le 7. `payments.period_end` garde l'échéance obtenue, pour que l'historique
se lise sans recalcul de proche en proche.

Le premier paiement d'un garage en essai le fait passer en `subscribed`
(`subscriptions_end_trial_trg`) et lève le plafond des 3 factures. Le compteur d'essai n'est
pas remis à zéro : il reste la trace de ce qui a été consommé avant de payer.

`src/lib/admin/payment-schema.ts` (sans dépendance serveur) porte les modes de règlement, les
durées rapides et `subscriptionStatus()` — `expiring` n'est pas un état de la base, seulement
`active` dont l'échéance approche. La base ne connaît que la comparaison de dates.

**Suppression d'un garage** : possible uniquement si `garage_is_deletable()` répond vrai. Le
nom doit être retapé, et la comparaison se fait côté serveur **contre le nom lu en base** —
jamais contre un nom transporté par le formulaire, qui viendrait du même navigateur que la
confirmation. Ordre imposé : le garage d'abord (c'est l'opération qui peut échouer), le compte
Auth ensuite. L'inverse laisserait, en cas d'échec, un garage vivant que plus personne ne peut
ouvrir.

### Éditeur de facture (`/app/factures`)

Deux colonnes : saisie à gauche, aperçu temps réel à droite. L'aperçu
(`components/invoice/invoice-preview.tsx`) est sur fond blanc et sans bleu marine : c'est le
document, pas l'écran.

`src/lib/invoice/` :

| Fichier | Rôle |
|---|---|
| `compute.ts` | totaux, arrondis, ligne vide — **pur**, sans React ni serveur |
| `types.ts` | formes de données, importables depuis un composant client |
| `schema.ts` | validation zod du brouillon |
| `actions.ts` | Server Actions de l'espace garage |
| `queries.ts` | lectures (`server-only`) |

`compute.ts` et `types.ts` seront consommés **tels quels** par l'export PDF et Factur-X : la
structuration des données et le calcul ne doivent jamais migrer dans un composant d'affichage.
Les types vivent dans `types.ts` et non dans `queries.ts` parce que ce dernier importe
`server-only` — importer un type depuis un module marqué ainsi revient à parier sur son
effacement par le bundler.

**`save_invoice_draft()` est la seule fonction du projet en `SECURITY INVOKER`.** C'est
délibéré : elle n'a besoin d'aucun privilège — tout ce qu'elle fait, le garage a le droit de
le faire. En `invoker`, le RLS continue de s'appliquer à chacune de ses requêtes, donc
l'isolation et la lecture seule restent l'affaire des policies. Une fonction `definer` aurait
exigé de réécrire ces contrôles à la main, donc de pouvoir les oublier. Ce qu'elle apporte est
l'**atomicité**, rien d'autre.

Le `garage_id` d'un brouillon vient de `my_garage_id()`, **jamais d'un paramètre** — un
`garage_id` transmis dans l'en-tête est ignoré, et la section 20 le prouve.

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

### Garde-fous en base (à ne pas contourner depuis l'application)

Quatre protections vivent dans Postgres, donc valables quel que soit le chemin d'écriture :

| Objet | Rôle |
|---|---|
| `invoices_guard_trg` | une facture émise est immuable ; seules l'annulation (`final → cancelled`) et les colonnes e-facture peuvent bouger. Une facture non `draft` n'est pas supprimable |
| `invoice_lines_guard_trg` | les lignes d'une facture émise sont figées |
| `profiles_guard_trg` | un non-admin ne peut changer ni son `role`, ni son `garage_id`, ni lever `must_change_password` |
| `admin_notifications_guard_trg` | une notification est un journal : seul `read_at` évolue, même pour l'admin |

`profiles_guard_trg` est **indispensable** : la contrainte `profiles_role_garage_ck` ne suffit
pas. Sans le trigger, un garage se promeut administrateur avec
`update profiles set role='super_admin', garage_id=null` — la contrainte est satisfaite et
l'escalade passe. Vérifié par mutation.

`profiles_guard()` est **SECURITY INVOKER**, contrairement aux autres fonctions de contrôle.
C'est délibéré : elle distingue le client (`current_user = 'authenticated'`) du code de
confiance — une fonction SECURITY DEFINER s'exécute sous le propriétaire des tables. Sans cette
distinction, `complete_password_change()` ne pourrait pas lever `must_change_password` ; et sans
le contrôle, le drapeau serait levable d'un simple `PATCH /profiles`, ce qui contournerait la
page de changement forcé.

Conséquence de l'immuabilité : **un garage ayant émis des factures ne peut pas être supprimé**
(le `on delete cascade` échoue sur le trigger). C'est voulu — conservation légale. Utiliser
`is_active = false`.

`finalize_invoice(p_invoice_id, p_decimals)` est le seul point d'entrée exposé pour émettre :
elle refait ses propres contrôles (elle est `SECURITY DEFINER`, donc hors RLS), recalcule les
totaux depuis `invoice_lines`, attribue le numéro et gèle `seller_snapshot`. `p_decimals` vient
de `LocaleConfig.decimals` — la connaissance des règles pays reste dans le TypeScript.
`next_invoice_number()` n'est appelable que par elle (`revoke` sur les rôles clients).

### Discipline de test des frontières

Le fichier `supabase/tests/rls_isolation.sql` est une preuve exécutable, pas une formalité.
Après toute modification du schéma ou des policies : **injecter les mutations listées dans son
en-tête et vérifier que le test s'interrompt sur chacune.** Un test de sécurité qui ne sait pas
échouer donne une fausse confiance.

Piège rencontré et corrigé : un `begin ... exception when raise_exception then null; end` autour
d'une action interdite avale aussi le `raise exception 'FUITE'` censé signaler que l'action a
réussi — le test annonçait « OK » avec le garde-fou d'immuabilité retiré. D'où le helper
`expect_blocked(sql, label)`, qui lève l'alerte **hors** du bloc protégé avec un SQLSTATE dédié
(`F0001`). Ne pas revenir au motif naïf.

Choisir des mutations qui sont de **vraies** fuites : retirer `clients_select` ne prouve rien,
parce que `clients_write` est `FOR ALL` et couvre déjà le SELECT. Préférer l'ouverture d'une
frontière (`using (true)`).

### Authentification (`src/lib/auth/`)

| Fichier | Rôle |
|---|---|
| `types.ts`, `routes.ts`, `password-policy.ts` | sans dépendance serveur — importables depuis un Composant Client |
| `session.ts` | `getAuthContext()` + les gardes `requireAdmin()` / `requireGarage()` |
| `actions.ts` | connexion, inscription, changement de mot de passe, déconnexion |
| `admin-actions.ts` | création de compte garage, réinitialisation de mot de passe |
| `rate-limit.ts` | plafonds de tentatives, adossés à `auth_rate_limits` |

`getAuthContext()` fait **un seul** aller-retour : `my_access_state()` renvoie en un jsonb le
rôle, le garage, l'essai, l'abonnement et le motif de blocage. Aucune de ces règles n'est
recalculée en TypeScript — les dupliquer, c'est les laisser diverger.

**Où atterrit-on après connexion ?** Toujours sur `/`, qui aiguille : adresse vérifiée → profil
rattaché → mot de passe changé → espace du rôle. Une seule règle, au même endroit. Le paramètre
`next` passe par `safeNextPath()` (refus de `//hôte` et `/\hôte`) puis doit rester dans l'espace
du rôle.

### Mots de passe : ce qui est visible, et par qui

Règle qui prime sur toute considération d'ergonomie : **aucun mot de passe n'est stocké, ni
journalisé, ni transmis à l'administrateur.** Supabase Auth le hache, l'application ne fait que
le convoyer.

- Mot de passe **choisi par un garage** : inconnu de tous, admin compris. Le changement produit
  une **notification** décrivant l'événement (`notify_password_changed()`), jamais la valeur.
- Mot de passe **temporaire** généré par l'admin (`resetGaragePasswordAction`) : affiché **une
  fois** dans la boîte de dialogue, parce qu'il faut bien le transmettre. Ni en base, ni dans les
  journaux, ni dans la notification. Le garage doit le remplacer à la connexion suivante.
- `must_change_password` ne se lève qu'en changeant réellement de mot de passe, via
  `complete_password_change()`. Un `UPDATE` direct dessus est refusé par `profiles_guard_trg`.

Le test `rls_isolation.sql` (section 16) vérifie qu'aucune notification ne ressemble à un mot de
passe transmis.

### Limitation de débit (`auth_rate_limits`)

Compteurs en base, pas en mémoire : sur Vercel les instances ne partagent rien, un compteur local
ne protège de rien. Deux dimensions par formulaire — l'adresse visée et l'IP d'origine — le plus
strict l'emporte. Les identifiants sont stockés **hachés** (HMAC-SHA256), les seaux purgés à 24 h.

Table et fonctions fermées à `anon` et `authenticated` : ouvertes, elles permettraient de faire
bloquer l'adresse e-mail de son choix depuis l'API REST publique. Seule la clé service role y
accède. Un compteur injoignable **laisse passer** plutôt que de fermer la connexion à tout le
monde : un limiteur en panne ne doit pas devenir une panne d'authentification.

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

Design sobre et professionnel, responsive (utilisable sur tablette). shadcn/ui en base
« radix », préréglage Nova ; les composants vivent dans `src/components/ui/`.

### Identité visuelle : bleu marine + gris zinc

La couleur de marque a **une seule source**, dans `src/app/globals.css` :

| Jeton | Valeur | Rôle |
|---|---|---|
| `--brand` | `#1f3a5c` — `oklch(0.345 0.069 255.1)` | accent principal, reprend la facture d'origine |
| `--brand-dark` | `#142943` — `oklch(0.278 0.056 254.8)` | survols et texte accentué |
| `--primary` | `var(--brand)` | tout ce que shadcn en dérive suit |

**Ne jamais écrire une couleur en dur dans une page.** `--primary` référence `--brand`, et
boutons, badges, anneaux de focus, interrupteurs et liens en découlent : repeindre
l'application, c'est changer ces deux lignes. Les neutres sont des gris **zinc** (froids),
assortis au marine. Les utilitaires `bg-brand` / `text-brand-dark` existent pour le bandeau
d'en-tête, qui n'est pas une surface shadcn.

Contrastes vérifiés : blanc sur `#1f3a5c` = 11,6:1, blanc sur `#142943` = 14,7:1,
`#1f3a5c` sur blanc = 11,6:1 — AAA dans les trois cas. Les libellés atténués du bandeau sont
à `text-white/75` (≈ 7:1), au-dessus du seuil AA.

### Composants transverses

| Composant | Rôle |
|---|---|
| `components/brand.tsx` | icône + nom « Facturation ». Le logo ne se recopie pas ailleurs |
| `components/app-shell.tsx` | bandeau marine, navigation, pied de page réglementaire |
| `components/main-nav.tsx` | onglets ; l'onglet actif est déduit du chemin (`usePathname`) |
| `components/page-header.tsx` | `PageHeader` (titre + action) et `SectionHeader` |
| `components/empty-state.tsx` | états vides — dire ce qui manque, pourquoi, et la sortie |
| `components/admin/garage-badges.tsx` | pastilles d'état d'un garage |

Une page ne redéfinit ni sa typographie de titre, ni son état vide : elle emploie ces
composants. C'est ce qui évite qu'un écran ait l'air d'avoir été fait par quelqu'un d'autre.

L'icône de l'application est `public/icone.png` ; `src/app/icon.png` en est la copie servie
comme favicon (convention de fichier Next).

Soigner les états vides, les messages d'erreur, les confirmations avant action destructrice.
Toasts via `sonner` (`<Toaster />` est monté dans le layout racine).

Note : cette version de shadcn ne fournit plus `form.tsx` — utiliser `field.tsx` avec
react-hook-form.

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
