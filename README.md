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

### Avec une pile Supabase locale (Docker)

```bash
npx supabase start          # Postgres + Auth + Storage + Mailpit
npx supabase db reset       # applique supabase/migrations dans l'ordre
```

La commande affiche l'URL de l'API, la clé anonyme et la clé service role : recopiez-les dans
`.env.local`. Les e-mails de vérification n'arrivent nulle part — ils s'ouvrent dans **Mailpit**,
dont l'URL est affichée au démarrage (« Inbucket / Mailbox »).

`supabase/config.toml` est versionné et porte un réglage qui n'est pas négociable :

```toml
[auth.email]
enable_confirmations = true
```

L'inscription en ligne EXIGE la vérification d'e-mail. Si le projet la désactive, `/signup`
refuse d'aboutir et affiche pourquoi, plutôt que de laisser entrer un compte non vérifié.
Sur un projet hébergé, le réglage équivalent est *Authentication → Providers → Email → Confirm
email*.

## Scripts

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run build` | Build de production |
| `npm run start` | Serveur de production |
| `npm run lint` | ESLint |
| `npm run db:seed` | Crée le compte super administrateur |
| `npm run verify:auth` | Rejoue le parcours d'authentification de bout en bout |
| `npm run verify:garages` | Rejoue l'espace d'administration des garages (phase 3) |
| `npm run verify:factures` | Rejoue l'éditeur de facture (phase 5) |
| `npm run verify:emission` | Rejoue la numérotation et l'émission (phase 6) |
| `npm run verify:catalogue` | Rejoue le carnet de clients et le catalogue (phase 7) |
| `npx supabase start` / `stop` | Pile Supabase locale (Docker) |

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

Le super admin **ne peut pas s'auto-inscrire**. L'inscription publique (`/signup`) ne
fabrique que des comptes `role = 'garage'` : le rôle est posé en SQL par
`provision_self_signup()`, jamais d'après une valeur venue du navigateur. Et la policy RLS sur
`profiles` réserve l'insertion aux administrateurs — donc à personne tant qu'il n'en existe
aucun. Le script d'amorçage casse ce cercle en passant par la clé service role, qui contourne le
RLS.

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

> **Base vierge exigée.** Le test compte les lignes en valeur absolue (« l'admin voit
> exactement 4 garages »). Lancé sur une base déjà seedée ou peuplée par les scripts
> `verify:*`, il s'arrête sur un décompte faux — ce n'est pas une régression, c'est son
> jeu d'essai qui n'est plus seul. Le rejouer sur un cluster jetable (section suivante),
> ou juste après `npx supabase db reset` **avant** `npm run db:seed`.

> **Windows.** Exportez `PGCLIENTENCODING=UTF8` avant d'appeler `psql`. Sans cela, les accents
> des messages sont mal décodés et des assertions portant sur des libellés échouent à tort — un
> faux négatif qui fait perdre du temps sur une vraie régression.

Il couvre, en 20 sections : cloisonnement en lecture et en écriture entre garages (tables
filles comprises), escalade de privilège, immuabilité des factures émises, numérotation
séquentielle, passage en lecture seule sur abonnement expiré, drapeau premium sur les logos,
isolation du bucket de stockage — et, depuis la phase 2 : compte à l'e-mail non vérifié privé de
toute donnée, provisionnement d'une inscription en ligne, plafond de l'essai gratuit (3 factures
finalisées, la 4e refusée), impossibilité de contourner le changement de mot de passe
obligatoire, cloisonnement du journal d'administration, et fermeture des compteurs de limitation
de débit. La phase 3 ajoute la **section 18** : un garage ne réécrit ni ses mentions
légales, ni sa franchise de TVA, ne s'octroie pas l'option premium et ne se réactive pas
lui-même ; `garage_is_deletable()` et `garage_accounts()` ne répondent qu'à
l'administrateur ; et ce que la règle de suppression annonce, la base le fait — un garage
sans facture émise s'efface, un garage qui en a émis est refusé. La phase 4 ajoute la
**section 19** : un garage ne crée, ne modifie ni ne supprime sa ligne d'abonnement, et
`register_payment()` lui est fermée ; côté administrateur, un renouvellement anticipé
**ajoute** au temps restant, un abonnement échu repart d'aujourd'hui, et le premier paiement
d'un garage en essai lève le plafond des 3 factures. La phase 5 ajoute la **section 20** :
un brouillon est rattaché au garage de la session et **jamais à un `garage_id` transmis par
le navigateur**, le brouillon d'un autre garage est inaccessible, un espace en lecture seule
n'enregistre rien, et les totaux stockés sont ceux des lignes — TVA ventilée par taux.

**Un test de sécurité qui ne sait pas échouer ne prouve rien.** L'en-tête du fichier liste
des mutations à injecter (retirer une policy, un trigger) : après toute modification du
schéma, vérifier que le test s'interrompt bien sur chacune.

### Vérifier le parcours d'authentification

Les preuves SQL — isolation RLS ci-dessus, limiteur de débit ci-dessous — portent sur les
**frontières**. `npm run verify:auth` vérifie le **câblage** : que les Server Actions, le proxy,
les gardes de layout et les redirections s'enchaînent comme prévu.

```bash
npx supabase start && npx supabase db reset   # pile locale + migrations
npm run db:seed                               # super administrateur
npm run dev                                   # dans un autre terminal
npm run verify:auth
```

Il rejoue, contre l'application réellement lancée : la création d'un compte par
l'administrateur, le changement de mot de passe imposé à la première connexion, l'inscription en
ligne avec ouverture du lien reçu dans **Mailpit**, l'essai gratuit jusqu'à son plafond, la
limitation de débit et la réinitialisation par l'administrateur — en contrôlant à chaque étape
qu'aucun mot de passe ne se retrouve dans une notification.

Le script se comporte comme un **navigateur sans JavaScript** : il soumet les formulaires en
POST multipart, ce que Next.js sait recevoir puisqu'il rend ses Server Actions en amélioration
progressive. Effet de bord utile : cela vérifie au passage que l'application reste utilisable
sans JavaScript.

Chaque exécution crée des comptes horodatés, elle est donc rejouable telle quelle. Pour repartir
de zéro : `npx supabase db reset && npm run db:seed`.

### Vérifier l'espace d'administration des garages

`npm run verify:garages` pilote l'application lancée comme un navigateur sans JavaScript et
vérifie le **câblage** de la phase 3 : liste, recherche, filtres, formulaire de fiche
(SIRET normalisé, TVA refusée si elle n'est pas française, franchise enregistrée), affichage
de l'adresse de connexion réelle, gardes de rôle, et bascule de la règle de suppression dès
la première facture émise.

```bash
npm run dev            # dans un autre terminal
npm run verify:garages
```

> **Ce qu'il ne peut pas atteindre.** Le contenu d'une boîte de dialogue Radix (suppression,
> réinitialisation de mot de passe) et les interrupteurs (activation, option premium)
> n'existent dans le HTML qu'une fois le JavaScript exécuté. Le script les éprouve donc par
> leur **effet**, en interrogeant la base avec la session de l'administrateur — jamais avec la
> clé service role, qui contournerait précisément ce qu'on veut vérifier. Le chemin complet
> de `deleteGarageAction` (confirmation par le nom, puis suppression du compte Auth) reste
> à couvrir par un test navigateur, prévu en phase 10.

### Vérifier l'éditeur de facture

`npm run verify:factures` pilote l'application lancée et vérifie le **câblage** de la
phase 5 : écrans, aperçu rendu côté serveur, enregistrement d'un brouillon, totaux calculés
en base, ligne sans désignation écartée, et les frontières — `garage_id` du navigateur
ignoré, brouillon d'autrui refusé.

```bash
npm run dev            # dans un autre terminal
npm run verify:factures
```

> **Ce qu'il ne peut pas atteindre.** La saisie elle-même : l'éditeur est un composant
> client, sa Server Action est appelée en JavaScript et non par un `<form>` classique. Le
> script emprunte donc le même chemin de données — `save_invoice_draft()` avec le **jeton de
> session du garage**, donc sous RLS — et constate l'effet en base. Jamais avec la clé
> service role, qui contournerait ce qu'on veut éprouver.

### Vérifier l'émission

`npm run verify:emission` pilote l'application lancée et vérifie le **câblage** de la
phase 6 : numérotation séquentielle `AAAA-000001`, série sans trou même après un brouillon
abandonné, refus de tout retour en arrière une fois la facture émise, onglets de la liste,
écran de relecture figé, et le gel des mentions du vendeur quand la fiche du garage change
ensuite.

```bash
npm run dev            # dans un autre terminal
npm run verify:emission
```

> **Ce qu'il ne peut pas atteindre.** Le clic sur « Émettre la facture » : la confirmation
> est une boîte de dialogue Radix, montée par le JavaScript. Le script emprunte le même
> chemin de données — `finalize_invoice()` avec le **jeton de session du garage** — et
> constate l'effet en base et à l'écran. La clé service role ne sert qu'à **observer**.

### Vérifier le carnet et le catalogue

`npm run verify:catalogue` pilote l'application lancée et vérifie le **câblage** de la
phase 7 : CRUD des clients et des prestations par les vrais écrans, normalisation du SIRET et
du n° de TVA, recherche, prix saisi avec une virgule, données servies à l'éditeur, isolation
vue de l'application (le carnet du voisin est invisible, un `clientId` forgé est refusé, un
`garage_id` glissé dans le formulaire est ignoré) et comportement en lecture seule.

```bash
npm run dev            # dans un autre terminal
npm run verify:catalogue
```

> **Ce qu'il ne peut pas atteindre.** Le sélecteur d'autocomplétion : c'est un Popover monté
> par le JavaScript, absent du HTML servi. Le script éprouve ce dont il dépend — les données
> que la page lui remet et l'action derrière chaque choix. Le clic attend le test navigateur
> de la phase 10.

### Vérifier le limiteur de débit

`supabase/tests/rate_limit.sql` est la seconde preuve exécutable : `rls_isolation.sql` montre que
les compteurs sont **hors de portée** des clients, celui-ci montre qu'ils **comptent juste**.

```bash
psql "$DATABASE_URL" -f supabase/tests/rate_limit.sql
```

Il vérifie le plafond, la stabilité du blocage, la remise à zéro après une connexion réussie, la
fenêtre glissante, l'expiration du blocage, le cloisonnement des seaux et la purge.

> Piège consigné dans l'en-tête du fichier : `now()` est **figé** pour toute la durée d'une
> transaction. Une assertion comparant deux échéances calculées dans le test est toujours vraie —
> elle ne sait pas échouer. On vieillit donc les lignes par `UPDATE`, ou on observe le compteur.

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

## Espace garage

| Écran | Route | Ce qu'on y fait |
|---|---|---|
| Tableau de bord | `/app` | état commercial, accès rapide à une nouvelle facture |
| Mes factures | `/app/factures` | brouillons en cours |
| Éditeur | `/app/factures/nouveau`, `/app/factures/[id]` | saisie + aperçu temps réel |

### L'éditeur de facture

Deux colonnes : la saisie à gauche (client, dates, lignes de prestations), l'aperçu à droite,
mis à jour **à chaque frappe**. L'aperçu est volontairement à contre-courant du reste de
l'application — fond blanc, filets fins : ce n'est pas un écran, c'est le document que le
client recevra.

**Les montants affichés sont indicatifs.** Ils viennent de `computeTotals()`, en JavaScript,
pour suivre la frappe. Ceux qui comptent sont recalculés en `numeric` exact par
`save_invoice_draft()` à l'enregistrement, puis par `finalize_invoice()` à l'émission.
L'algorithme est identique des deux côtés — lignes arrondies, groupées par taux, TVA calculée
sur la base agrégée — mais **aucun total venant du navigateur n'est jamais enregistré**.

Un brouillon ne consomme **ni numéro ni facture d'essai** : la série légale n'a de trou que
si on lui en fait, et le numéro n'est attribué qu'à l'émission (phase 6).

Un garage en lecture seule (abonnement expiré, compte désactivé) **ouvre l'éditeur et voit
l'aperçu se construire**, mais l'enregistrement est refusé — par le RLS, pas par l'écran.
Nuance conservée : un essai gratuit épuisé laisse au contraire les brouillons enregistrables ;
c'est l'émission qui est plafonnée.

## Espace d'administration

| Écran | Route | Ce qu'on y fait |
|---|---|---|
| Tableau de bord | `/admin` | garages, essais, **fiches incomplètes**, **abonnements expirés / expirant sous 7 j**, notifications |
| Garages | `/admin/garages` | liste, recherche (nom, e-mail, SIRET), filtre actif / désactivé |
| Fiche garage | `/admin/garages/[id]` | identité légale, abonnement, paiements, droits, compte, suppression |
| Comptes | `/admin/comptes` | comptes de connexion, réinitialisation de mot de passe |
| Créer un compte | `/admin/comptes/nouveau` | garage + compte Auth pré-confirmé + abonnement |
| Notifications | `/admin/notifications` | journal des événements |

### La fiche garage

Un garage **lit** sa fiche — elle alimente ses factures — mais ne l'écrit pas : SIRET, RCS,
capital et forme juridique conditionnent la conformité, et leur maintien appartient à
l'administrateur. La policy `garages_admin_write` est la seule voie d'écriture.

Le formulaire d'identité du vendeur est **généré depuis `LocaleConfig.sellerIdentityFields`**,
pas écrit en dur : la même liste décide de ce qui s'affiche, de ce qui manque et de ce
qu'imprimera la facture. Ajouter un pays n'oblige pas à rouvrir l'écran.

Une fiche incomplète **s'enregistre quand même**. Le format est vérifié (14 chiffres pour un
SIRET, `FR` + 11 pour la TVA), la présence ne l'est pas : un garage peut être créé avant que
toutes ses pièces soient réunies. Un bandeau, une pastille dans la liste et un compteur sur le
tableau de bord signalent ce qui manque — la facture, elle, l'exigera.

### Abonnement et paiements

L'encaissement est **hors ligne** : l'administrateur reçoit un virement, un chèque ou des
espèces, puis en consigne la trace depuis la fiche du garage. Aucun prestataire de paiement
n'est branché.

Un enregistrement fait **deux choses en une transaction** — une ligne dans `payments` et
l'échéance de `subscriptions` repoussée — parce que `register_payment()` les tient ensemble.
En deux appels séparés, un échec entre les deux laisserait soit un encaissement sans
prolongation (le garage a payé et reste bloqué), soit l'inverse.

La règle de date vit dans la fonction : **nouvelle échéance = `greatest(échéance,
aujourd'hui) + N mois`**. Renouveler un abonnement encore valide ajoute au temps restant ;
renouveler un abonnement échu repart d'aujourd'hui. Une date de fin personnalisée reste
possible — mais jamais en même temps qu'une durée.

L'historique affiche date d'encaissement (distincte de la saisie), montant, mode, durée
ajoutée, échéance obtenue et qui l'a saisi.

À l'échéance, l'espace du garage passe en **lecture seule** : `has_write_access()` devient
faux, l'écriture métier est refusée par le RLS et `finalize_invoice()` refuse d'émettre. Le
bandeau annonce « Abonnement expiré — contactez l'administrateur ». Sept jours avant, il
prévient. **Le premier paiement d'un garage en essai met fin à l'essai** (trigger
`subscriptions_end_trial_trg`) et lève le plafond des 3 factures ; le compteur d'essai est
conservé tel quel, comme trace de ce qui a été consommé avant de payer.

### Activation, option premium, suppression

- **Activation** — `is_active = false` n'est pas cosmétique : `has_write_access()` s'appuie
  dessus, l'espace du garage passe en lecture seule et l'émission est refusée. Ses données
  restent intactes.
- **Option premium** — le booléen `logo_management_enabled`, jamais un rôle. Il commande
  l'écriture des logos par la policy, et se referme à la requête suivante.
- **Suppression** — possible **uniquement tant qu'aucune facture n'a été émise**, ce que
  tranche `garage_is_deletable()`. La même règle est appliquée de toute façon par
  `invoices_guard_trg` lors de la suppression en cascade : l'écran interroge la base au lieu
  de recalculer la règle, pour que l'annonce et le refus ne divergent jamais. Le nom du garage
  doit être retapé à l'identique, et la comparaison se fait **côté serveur, contre le nom lu en
  base**. Le compte Auth part avec le garage : laissé orphelin, il retiendrait l'adresse
  e-mail en otage.

Dès la première facture émise, il ne reste que la désactivation — conservation légale.

## Authentification et comptes

### Deux chemins vers un compte garage

| | Créé par l'administrateur | Inscription en ligne (`/signup`) |
|---|---|---|
| Vérification d'e-mail | **non** — compte pré-confirmé | **oui**, obligatoire |
| Accès | immédiat | après ouverture du lien reçu |
| Mot de passe | fixé par l'admin, **changement forcé** à la 1re connexion | choisi par la personne |
| Facturation | abonnement fixé par l'admin | **essai gratuit : 3 factures finalisées** |

Les deux aboutissent au même modèle de données ; `garages.origin` garde la trace de la
provenance.

### Essai gratuit

Un compte inscrit en ligne démarre en `account_status = 'trial'`, avec
`trial_invoices_used = 0` et `trial_invoice_limit = 3`.

**Le plafond porte sur les factures FINALISÉES, pas sur les brouillons.** Un essai épuisé
conserve son espace en écriture : le garage continue de saisir, de tenir son carnet de clients et
son catalogue. Seule l'émission — celle qui produit une facture légale et consomme un numéro —
est refusée, avec le message :

> Essai terminé (3 factures) — contactez l'administrateur pour activer votre abonnement

Ce refus vit dans `finalize_invoice()`, en base : il tient quel que soit le chemin d'écriture.
Le bandeau affiché dans `/app` reprend **exactement** la phrase produite par
`finalize_block_message()`, pour qu'annonce et refus ne divergent jamais.

Quand l'administrateur enregistre un abonnement (encaissement hors ligne), le trigger
`subscriptions_end_trial_trg` fait passer le garage en `subscribed` : le contrôle redevient une
affaire de date d'échéance. Le compteur d'essai est conservé — il documente ce qui a été consommé
avant de payer.

### Mots de passe

**Aucun mot de passe n'est stocké en clair, nulle part.** Supabase Auth les hache ;
l'application ne fait que les convoyer.

- Un mot de passe **choisi par un garage** est inconnu de tout le monde, administrateur compris.
  Le changement produit une **notification** décrivant l'événement — « le garage X a modifié son
  mot de passe » — et jamais la valeur.
- L'action admin **« Réinitialiser le mot de passe »** génère un mot de passe temporaire, affiché
  **une seule fois** pour qu'il puisse être transmis. Il n'est ni journalisé, ni stocké, ni écrit
  dans la notification. Le garage doit le remplacer à sa connexion suivante.
- `must_change_password` ne se lève **qu'en changeant réellement de mot de passe**. Un `UPDATE`
  direct sur le drapeau est refusé par `profiles_guard_trg` : la page de changement forcé n'est
  pas contournable.

### Limitation de débit

Les compteurs vivent dans Postgres (`auth_rate_limits`), pas en mémoire : sur Vercel, les
instances ne partagent rien. Deux dimensions par formulaire — l'adresse visée et l'IP d'origine —
le plus strict l'emporte.

| Point d'entrée | Par adresse | Par IP |
|---|---|---|
| Connexion | 5 échecs / 15 min | 20 / 15 min |
| Inscription | 3 / heure | 5 / heure |
| Changement de mot de passe | 10 / 15 min (par compte) | — |

Les identifiants sont stockés **hachés** (HMAC-SHA256) et les seaux purgés au bout de 24 h : la
table n'est pas un fichier d'adresses. Elle n'est accessible qu'à la clé service role — ouverte à
`anon`, elle permettrait de faire bloquer l'adresse e-mail de son choix depuis l'API REST
publique.

### Gabarit d'e-mail recommandé

Par défaut, le lien de confirmation Supabase transporte un `code` PKCE, qui n'aboutit que dans le
navigateur ayant lancé l'inscription. Beaucoup de gens relèvent leur messagerie ailleurs. Pour
que le lien fonctionne depuis n'importe où, remplacez le gabarit *Confirm signup* par :

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">
  Confirmer mon adresse
</a>
```

`/auth/confirm` accepte **les deux formes** : rien ne casse si le gabarit reste par défaut.

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
  proxy.ts             rafraîchit la session, redirige selon sa présence
  app/
    page.tsx           accueil publique + AIGUILLAGE après connexion
    (auth)/            login, signup, vérification, changement de mot de passe
    auth/confirm/      retour du lien de vérification d'e-mail
    auth/error/        impasses d'authentification, avec issue de secours
    admin/             espace super admin — garages, comptes, notifications
    app/               espace garage
  components/
    ui/                composants shadcn/ui
    auth/              déconnexion, message d'erreur, rattrapage
    admin/             pastilles d'état d'un garage, partagées par les écrans
    app-shell.tsx      coquille commune aux deux espaces
    access-banner.tsx  état commercial d'un garage (essai, abonnement)
  lib/
    env.ts             validation zod des variables d'environnement
    format.ts          formatage montants / dates selon la locale
    locale/            configuration par pays (règles fiscales, mentions)
    supabase/          clients navigateur / serveur / admin + middleware
    auth/              session, gardes, actions, politique de mot de passe,
                       limitation de débit
    admin/             lectures, actions et validation zod de l'espace admin
supabase/
  config.toml          configuration de la pile locale (vérification e-mail)
  migrations/          schéma SQL versionné (phases 1 à 3)
  tests/               preuve d'isolation RLS + stub PostgreSQL local
scripts/
  lib/navigateur.mjs   navigateur sans JavaScript, partagé par les vérifications
```

## État d'avancement

- [x] **Phase 0** — Bootstrap : Next.js, Tailwind, shadcn/ui, clients Supabase, socle multi-locale, Git
- [x] **Phase 1** — Migrations SQL, RLS, Storage, seed super admin, preuve d'isolation
- [x] **Phase 2** — Authentification, rôles, protection des routes, inscription en ligne
      avec vérification d'e-mail, essai gratuit, limitation de débit
- [x] **Phase 3** — Espace admin : fiches garages (identité légale, règlement, franchise
      de TVA), recherche et filtres, drapeau premium, activation, suppression conditionnelle
- [x] **Phase 4** — Abonnements et paiements : encaissement hors ligne, prolongation,
      historique, blocage en lecture seule à l'échéance
- [x] **Phase 5** — Éditeur de facture : saisie à gauche, aperçu temps réel à droite,
      brouillons enregistrables sans consommer de numéro
- [x] **Phase 6** — Numérotation séquentielle, émission (facture figée, mentions du
      vendeur gelées), liste à onglets brouillons / émises / annulées
- [x] **Phase 7** — Carnet de clients et catalogue de prestations, avec pré-remplissage
      de l'éditeur (le catalogue est un point de départ, il ne fige rien)
- [ ] **Phase 8** — Export PDF conforme
- [ ] **Phase 9** — Logos et bibliothèque premium
- [ ] **Phase 10** — Finitions, tests d'isolation RLS, accessibilité
- [ ] **Phase 11** — Déploiement GitHub + Vercel
