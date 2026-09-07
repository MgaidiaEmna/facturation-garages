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
npm run verify:emission # numérotation et émission (phase 6)
npm run verify:catalogue # carnet de clients et catalogue (phase 7)
npm run verify:pdf      # export PDF, contenu du document lu (phase 8)
npm run verify:logos    # logos + VRAIS téléversements Storage (phase 9)
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

**Réserve levée en phase 9** : les policies du bucket `logos` n'étaient éprouvées que sur la
table `storage.objects` — donc, hors projet Supabase, sur un stub. `verify:logos` téléverse et
télécharge désormais pour de bon contre le service Storage, avec le jeton de chaque garage.

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

`compute.ts` et `types.ts` sont consommés **tels quels** par l'export PDF, et le seront par
Factur-X : la structuration des données et le calcul ne migrent jamais dans un composant
d'affichage. C'est `document.ts` qui fait le lien — voir « Export PDF » plus bas.
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

### Émission et registre (`/app/factures`, phase 6)

La phase 6 n'a ajouté **aucune migration** : `finalize_invoice()`,
`next_invoice_number()`, `finalize_block_reason()` et `invoices_guard_trg` existaient depuis
la phase 1. Elle branche des écrans dessus. Toute évolution de l'émission se pense donc
d'abord en SQL, pas dans le composant.

| Écran | Route |
|---|---|
| Liste à onglets — brouillons (par défaut), émises, annulées | `/app/factures?statut=…` |
| Éditeur d'un brouillon | `/app/factures/[id]` (statut `draft`) |
| Facture émise, en lecture seule | `/app/factures/[id]` (statut `final` / `cancelled`) |

**Les onglets sont de vrais liens**, pas un composant à onglets : l'état tient dans l'URL, se
partage, se met en favori et fonctionne sans JavaScript. Un composant client aurait rendu la
liste invisible aux scripts `verify:*`.

**L'aiguillage se fait sur le statut lu en base, jamais sur l'URL.** Une facture émise ne
revient pas dans l'éditeur en tapant son identifiant : la page monte `IssuedInvoiceView`.
Et si elle y revenait, deux barrières indépendantes refuseraient l'écriture — le
`where status = 'draft'` de `save_invoice_draft()` puis `invoices_guard_trg`.

**Une facture émise n'est pas un éditeur grisé.** Un formulaire désactivé laisse croire
qu'il existe un moyen de le réactiver. L'écran de relecture affiche le document, dit qu'il
porte un numéro de la série légale, et renvoie vers l'avoir pour corriger.

**Rien n'y est recalculé** : les totaux sont ceux que `finalize_invoice()` a écrits en
`numeric` exact, l'identité du vendeur vient de `seller_snapshot`, le délai et les pénalités
des colonnes gelées de la facture. `InvoicePreview` accepte pour cela `totals`, `number`,
`dueDate` et `status` ; sans eux, il recalcule — c'est le mode brouillon.

`finalizeInvoiceAction()` vérifie `access.finalizeBlockReason` **pour l'ergonomie seulement**
et affiche `finalizeBlockMessage`, la phrase produite par la base. Le refus qui compte est
celui de `finalize_invoice()`, avec la même phrase. Le bouton « Émettre » enregistre le
brouillon **avant** d'émettre : la fonction SQL travaille sur ce qui est en base, pas sur ce
qui est à l'écran.

L'annulation par avoir (`final → cancelled`) n'est **pas** exposée : l'onglet « Annulées »
n'apparaît que s'il contient quelque chose.

### Carnet de clients et catalogue de prestations (phase 7)

Comme la phase 6, **aucune migration** : `clients` et `services` existent depuis la phase 1,
avec leurs triggers `set_updated_at` et leurs policies `*_select` / `*_write` — déjà
basculées sur `my_write_access()`. La phase 7 branche des écrans dessus.

| Écran | Route |
|---|---|
| Carnet — liste et recherche | `/app/clients?q=…` |
| Fiche client — création / modification | `/app/clients/nouveau`, `/app/clients/[id]` |
| Catalogue — liste et recherche | `/app/prestations?q=…` |
| Fiche prestation | `/app/prestations/nouvelle`, `/app/prestations/[id]` |

`src/lib/catalog/` suit le découpage de `src/lib/invoice/` : `schema.ts` (zod, sans dépendance
serveur), `types.ts` (importable depuis un composant client), `queries.ts` (`server-only`),
`actions.ts`.

**Les briques de validation sont dans `src/lib/validation/fields.ts`**, partagées avec la fiche
garage : un SIRET a quatorze chiffres, qu'il soit celui du garage ou celui de son client. Une
seule exception, délibérée — le n° de TVA du **vendeur** est forcément français
(`frenchVatNumberSchema`), celui d'un **client** peut être belge ou allemand
(`euVatNumberSchema`). Refuser « BE0123456789 » interdirait de facturer ce client.

**Le `garage_id` vient de `requireGarage()`**, donc de `profiles`, jamais du formulaire.
`clients.garage_id` étant `not null`, il faut bien l'écrire : c'est l'action qui le fournit, et
`clients_write` vérifie de son côté que la valeur écrite est `my_garage_id()`. Les mises à jour
et les suppressions, elles, ne portent **aucun** filtre d'appartenance — `.eq("id", …)` suffit,
le RLS écarte le reste. Recopier `garage_id = …` donnerait l'illusion que c'est ce filtre qui
protège.

**Choisir ne fige rien.** Le sélecteur de client et celui de prestation ne font que REMPLIR des
champs. Aucun lien n'est posé : ni `client_id` sur la facture, ni `service_id` sur la ligne.
C'est un choix, pas un raccourci — une facture est une pièce comptable et doit rester telle
qu'elle a été émise ; si elle pointait vers la fiche client, corriger une adresse aujourd'hui
réécrirait une facture de l'an dernier. Conséquence assumée : **pas d'écran « toutes les
factures de ce client »** sans poser ce lien au préalable, et donc sans décider ce qu'il advient
quand la fiche change.

Corollaire : supprimer un client ou une prestation ne casse aucune facture, émise ou non.

`getEditorCatalog()` sert les listes COMPLÈTES à l'éditeur, pas une recherche serveur :
l'autocomplétion doit répondre à la frappe. C'est le seul endroit à revoir le jour où un garage
aura des milliers de fiches — les écrans de liste ont déjà leur recherche en base (`ilike`, avec
les métacaractères échappés).

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

### Export PDF (phase 8)

Le PDF est rendu par `@react-pdf/renderer`, **côté serveur**, dans le Route Handler
`/app/factures/[id]/pdf`. Ses primitives n'ont rien de commun avec le HTML : l'aperçu à
l'écran ne peut donc PAS être réutilisé tel quel, et il y a bel et bien **deux moteurs de
rendu**.

| Fichier | Rôle |
|---|---|
| `lib/invoice/document.ts` | modèle sémantique — **pur**, consommé par les DEUX rendus |
| `components/invoice/invoice-preview.tsx` | mise en page HTML |
| `components/invoice/invoice-pdf.tsx` | mise en page PDF (`server-only`) |
| `lib/invoice/pdf-filename.ts` | `Facture_{numéro}_{client}.pdf` et `Content-Disposition` |

**Disposition du document**, décidée une fois dans `document.ts` :

| Zone | Contenu |
|---|---|
| En-tête, à gauche | logo, dénomination, **adresse du siège seulement** (`seller.headerLines`) |
| En-tête, à droite | « FACTURE », numéro, date d'émission, date de prestation |
| Sous l'en-tête, à gauche | bloc client « Facturé à » |
| Corps | tableau des prestations, puis totaux et ventilation de TVA |
| **Pied** | `seller.legalIdentityLines` — forme juridique + capital, SIRET, RCS + greffe, n° de TVA, contact — puis règlement/échéance, pénalités, indemnité 40 €, IBAN/BIC, et l'art. 293 B en franchise |

Les mentions d'identité sont **descendues, jamais retirées** : le Code de
commerce les exige sur la facture, pas en haut de la facture. `verify:pdf`
vérifie leur présence ET leur position — dans le PDF comme à l'écran — parce
que la seule présence laisserait passer un retour silencieux à l'ancien
en-tête.

**`buildInvoiceDocument()` est la parade à la divergence.** Ordre des lignes d'identité du
vendeur, texte des mentions légales, taux de pénalités substitué, calcul de l'échéance : tout
cela est décidé une fois, dans le modèle. Une mention ajoutée au modèle apparaît des deux
côtés ; une mention ajoutée dans un seul composant est un bug. Ce qui reste propre à chaque
rendu, c'est la mise en page — rien d'autre.

Les PHRASES sont pré-résolues dans le modèle ; les NOMBRES restent bruts et chaque rendu appelle
`formatAmount()`. Factur-X aura besoin des valeurs, pas de « 1 234,56 € », et c'est sur
`document.ts` que son générateur XML se branchera — pas sur un composant d'affichage.

**Un Route Handler refait sa propre chaîne de vérification.** Les layouts ne s'y appliquent
pas : sans `requireGarage()` explicite, l'URL du PDF serait une porte de service. Le RLS ne
suffit pas à s'en apercevoir — il bloque l'anonyme, mais `invoices_select` laisse tout lire à
l'administrateur. C'est pourquoi `verify:pdf` vérifie que **l'admin n'obtient pas** le PDF d'un
garage par cette route : c'est la seule assertion qui tombe si la garde disparaît.

**Une facture émise n'est jamais recalculée** : totaux de la base, identité du vendeur lue dans
`seller_snapshot`, échéance gelée. Un brouillon, lui, porte un filigrane « BROUILLON », n'a pas
de numéro, et s'ouvre `inline` là où la facture émise se télécharge (`attachment`).

**Piège à connaître : les espaces fines insécables.** `Intl.NumberFormat('fr-FR')` sépare les
milliers par U+202F, absent de l'encodage WinAnsi des polices standard du PDF — le montant
sortirait troué. `invoice-pdf.tsx` les normalise à l'impression (`pdfSafe`) plutôt que
d'embarquer une police pour deux caractères. `verify:pdf` vérifie qu'aucune n'a survécu.

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
timbre fiscal, fuseau horaire, champs d'identité du vendeur, mentions légales. Rien de tout cela
n'est codé en dur ailleurs dans l'app. Ajouter un pays = ajouter un fichier de config + élargir le
type `LocaleCode`.

Formatage des montants et des dates : passer par `src/lib/format.ts`, jamais par un `toFixed()`
ou un `Intl` en ligne.

### Rien de ce qui est rendu ne dépend de la machine

Les mêmes données rendues sur le serveur puis rejouées à l'hydratation doivent produire le **même
HTML**, sinon React jette le rendu reçu — et, sur une facture, la date affichée serait fausse pour
une partie des lecteurs. Trois règles en découlent :

- une date civile (`AAAA-MM-JJ`) s'affiche **épinglée sur UTC** : `new Date("2026-09-07")` vaut
  minuit UTC, et le fuseau de la machine la reculerait d'un jour à l'ouest de Greenwich.
  `formatDate()` / `formatDateShort()` s'en chargent ; ne pas rappeler `Intl` à côté ;
- « quel jour sommes-nous ? » se demande **côté serveur**, avec `todayInLocale()` (fuseau
  `LocaleConfig.timeZone`), et la réponse descend en propriété jusqu'au composant client ;
- une clé de ligne de facture est une **constante** ou vient de la base, jamais d'un
  `Math.random()` : elle sert de `id` / `htmlFor` aux champs, et deux tirages successifs suffisent
  à casser l'hydratation. `emptyLine()` reçoit donc sa clé en paramètre et reste pure ; les clés
  créées après coup viennent d'un compteur, dans un gestionnaire d'événement.

### Logos et bibliothèque premium (phase 9)

| Qui | Où | Quoi |
|---|---|---|
| Garage **standard** | ne gère rien | l'admin lui assigne un logo depuis `/admin/garages/[id]` |
| Garage **premium** | `/app/logos` | bibliothèque : téléverse, nomme, choisit son défaut, supprime |
| Garage **premium** | éditeur de facture | sélecteur de logo **par facture** |

Le « premium » reste le booléen `garages.logo_management_enabled`, jamais un rôle.
`/app/logos` répond **404** sans le drapeau : l'onglet caché est une commodité, pas la
barrière — `logos_write` et les policies du bucket exigent `can_manage_logos()`.

**PNG et JPEG seulement.** `@react-pdf/renderer` ne décode que ces deux formats : accepter un
SVG donnerait un logo visible à l'écran et ABSENT du PDF, c'est-à-dire deux documents pour une
même facture. Le refus est posé à trois endroits qui doivent rester d'accord — `TYPES_ACCEPTES`
(zod), `allowed_mime_types` du bucket, et l'`accept` du champ de fichier.

**Le logo passe par `document.ts`**, comme tout le reste : un seul champ `seller.logoUrl`,
chaque rendu recevant la forme qu'il consomme — URL signée à l'écran, `data:` URI dans le PDF
(les octets sont téléchargés par le serveur). Deux champs auraient rouvert la porte à deux
logos différents sur le même document.

**Le téléversement passe par la SESSION**, jamais par la clé service role : les policies du
bucket sont alors la barrière, et non le fait que le code calcule le bon chemin. Le chemin est
`{garage_id}/{uuid}.{png|jpg}` — garage lu dans `profiles`, nom tiré au sort, extension déduite
du type MIME **validé** et jamais du nom de fichier reçu.

**Le logo d'une facture émise est gelé** : `finalize_invoice()` écrit `logo_path` dans
`seller_snapshot`, et la relecture ne consulte plus `logos`. Retirer un logo de la bibliothèque
est refusé **par deux barrières indépendantes** : `invoices_guard_trg` via la cascade
`on delete set null` (depuis la phase 1), et `logos_guard_trg` (phase 9) qui, lui, prononce un
message compréhensible. `logo_is_deletable()` permet à l'écran de griser le bouton avant le
clic. Ne pas confondre les deux : le trigger de la phase 9 apporte le MESSAGE, pas la
protection — la section 23c vérifie donc le refus **et sa provenance**.

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
