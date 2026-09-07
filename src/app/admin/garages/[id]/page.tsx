import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, KeyRound, ShieldAlert, TriangleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  AccessBadge,
  IncompleteBadge,
  InactiveBadge,
  PremiumBadge,
} from "@/components/admin/garage-badges";
import { ResetPasswordDialog } from "@/app/admin/comptes/reset-password-dialog";
import { listLogosForGarage } from "@/lib/logos/queries";
import { getGarageDetail } from "@/lib/admin/queries";
import { formatDate, formatDateTime } from "@/lib/format";
import { DeleteGarageDialog } from "./delete-garage-dialog";
import { SubscriptionCard } from "./subscription-card";
import { GarageForm } from "./garage-form";
import { GarageToggles } from "./garage-toggles";
import { GarageLogo } from "./garage-logo";

export const metadata: Metadata = {
  title: "Fiche garage — Administration",
};

/** Un identifiant malformé est une page inexistante, pas une erreur 500. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function GarageDetailPage(props: PageProps<"/admin/garages/[id]">) {
  const { id } = await props.params;

  if (!UUID.test(id)) notFound();

  const garage = await getGarageDetail(id);
  if (!garage) notFound();

  // `logos_select` autorise `is_admin()` : l'administrateur voit la
  // bibliothèque de n'importe quel garage, ce dont cette fiche a besoin.
  const logos = await listLogosForGarage(id);

  return (
    <div className="space-y-8">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ms-3">
          <Link href="/admin/garages">
            <ArrowLeft aria-hidden />
            Tous les garages
          </Link>
        </Button>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{garage.name}</h1>
          {!garage.isActive ? <InactiveBadge /> : null}
          {garage.logoManagementEnabled ? <PremiumBadge /> : null}
          <IncompleteBadge count={garage.missingFields.length} />
        </div>
        <p className="text-sm text-muted-foreground">
          {garage.origin === "self_signup" ? "Inscrit en ligne" : "Créé par l'administrateur"}{" "}
          le {formatDate(garage.createdAt)} · {garage.invoiceCount} facture
          {garage.invoiceCount > 1 ? "s" : ""} dont {garage.issuedInvoiceCount} émise
          {garage.issuedInvoiceCount > 1 ? "s" : ""}
        </p>
      </div>

      {garage.missingFields.length > 0 ? (
        <Alert>
          <TriangleAlert aria-hidden />
          <AlertTitle>Mentions obligatoires manquantes</AlertTitle>
          <AlertDescription>
            <p>
              Les factures de ce garage ne seront pas conformes tant que ces champs
              ne sont pas renseignés : {garage.missingFields.join(", ")}.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      {/* --- État commercial et droits --- */}
      <Card>
        <CardHeader>
          <CardTitle>Accès et droits</CardTitle>
          <CardDescription>
            L&apos;état commercial est piloté par l&apos;abonnement ; ces
            interrupteurs, eux, prennent effet immédiatement.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <dt className="text-sm text-muted-foreground">État commercial</dt>
              <dd>
                <AccessBadge
                  accountStatus={garage.accountStatus}
                  trialInvoicesUsed={garage.trialInvoicesUsed}
                  trialInvoiceLimit={garage.trialInvoiceLimit}
                  subscriptionEndDate={garage.subscriptionEndDate}
                />
              </dd>
            </div>
            <div className="space-y-1">
              <dt className="text-sm text-muted-foreground">Abonnement</dt>
              <dd className="text-sm">
                {garage.subscriptionEndDate ? (
                  <>Jusqu&apos;au {formatDate(garage.subscriptionEndDate)}</>
                ) : (
                  <span className="text-muted-foreground">
                    Aucun — essai gratuit en cours
                  </span>
                )}
              </dd>
            </div>
          </dl>

          <Separator />

          <GarageToggles
            garageId={garage.id}
            isActive={garage.isActive}
            logoManagementEnabled={garage.logoManagementEnabled}
          />
        </CardContent>
      </Card>

      {/* --- Abonnement et paiements --- */}
      <SubscriptionCard
        garageId={garage.id}
        accountStatus={garage.accountStatus}
        trialInvoicesUsed={garage.trialInvoicesUsed}
        trialInvoiceLimit={garage.trialInvoiceLimit}
        subscriptionEndDate={garage.subscriptionEndDate}
        subscriptionStartDate={garage.subscriptionStartDate}
        payments={garage.payments}
      />

      {/* --- Fiche d'identité --- */}
      <Card>
        <CardHeader>
          <CardTitle>Fiche du garage</CardTitle>
          <CardDescription>
            Maintenue par l&apos;administrateur : le garage lit sa fiche mais ne la
            modifie pas — ce sont ses mentions légales de facturation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GarageForm garage={garage} />
        </CardContent>
      </Card>

      {/* --- Logo --- */}
      <Card>
        <CardHeader>
          <CardTitle>Identité visuelle</CardTitle>
          <CardDescription>
            Le logo imprimé en tête des factures de ce garage. Sans logo, ses
            factures portent sa dénomination en texte — c&apos;est conforme.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GarageLogo
            garageId={garage.id}
            garageName={garage.name}
            logos={logos}
            premium={garage.logoManagementEnabled}
          />
        </CardContent>
      </Card>

      {/* --- Comptes de connexion --- */}
      <Card>
        <CardHeader>
          <CardTitle>Compte de connexion</CardTitle>
          <CardDescription>
            Aucun mot de passe n&apos;est lisible ici, ni nulle part ailleurs :
            Supabase Auth ne conserve qu&apos;une empreinte. Vous pouvez seulement en
            générer un temporaire.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {garage.loginAccounts.length === 0 ? (
            <Alert variant="destructive" className="border-destructive/30">
              <ShieldAlert aria-hidden />
              <AlertTitle>Aucun compte rattaché</AlertTitle>
              <AlertDescription>
                Cette fiche existe sans utilisateur : personne ne peut ouvrir cet
                espace. Créez un compte, ou supprimez la fiche.
              </AlertDescription>
            </Alert>
          ) : (
            garage.loginAccounts.map((account) => (
              <div
                key={account.userId}
                className="flex flex-wrap items-start justify-between gap-4 rounded-lg border px-4 py-3"
              >
                <div className="space-y-1">
                  <p className="font-medium">{account.email ?? "Adresse inconnue"}</p>
                  <p className="text-sm text-muted-foreground">
                    {account.fullName ?? "Contact non renseigné"}
                    {account.lastSignInAt
                      ? ` · dernière connexion le ${formatDateTime(account.lastSignInAt)}`
                      : " · jamais connecté"}
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {account.mustChangePassword ? (
                      <Badge variant="outline">
                        <KeyRound aria-hidden />
                        Changement de mot de passe en attente
                      </Badge>
                    ) : null}
                    {!account.emailConfirmed ? (
                      <Badge variant="destructive">Adresse non vérifiée</Badge>
                    ) : null}
                  </div>
                </div>

                <ResetPasswordDialog userId={account.userId} garageName={garage.name} />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* --- Zone dangereuse --- */}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Zone dangereuse</CardTitle>
          <CardDescription>
            La suppression n&apos;est possible que tant qu&apos;aucune facture
            n&apos;a été émise. C&apos;est la base qui le vérifie, pas cet écran.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteGarageDialog
            garageId={garage.id}
            garageName={garage.name}
            isDeletable={garage.isDeletable}
            issuedInvoiceCount={garage.issuedInvoiceCount}
          />
        </CardContent>
      </Card>
    </div>
  );
}
