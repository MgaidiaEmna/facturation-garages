import type { Metadata } from "next";
import Link from "next/link";
import { Bell, Building2, CalendarClock, CalendarX, Clock, TriangleAlert, UserPlus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { subscriptionStatus } from "@/lib/admin/payment-schema";
import {
  countUnreadNotifications,
  listGarageAccounts,
  listGarages,
} from "@/lib/admin/queries";

export const metadata: Metadata = {
  title: "Administration — Facturation multi-garages",
};

export default async function AdminHomePage() {
  const [accounts, garages, unread] = await Promise.all([
    listGarageAccounts(),
    listGarages(),
    countUnreadNotifications(),
  ]);

  const trials = accounts.filter((a) => a.garage?.accountStatus === "trial");
  const pendingPasswordChange = accounts.filter((a) => a.mustChangePassword);
  // Une fiche incomplète produira des factures non conformes : c'est un
  // chiffre à voir dès l'arrivée, pas au fond d'un écran de détail.
  const incomplete = garages.filter((garage) => garage.missingFields.length > 0);

  // « Expiré » couvre aussi le garage abonné sans aucune ligne d'abonnement :
  // dans les deux cas il est censé payer et ne peut plus rien émettre. Les
  // comptes encore en essai n'y figurent pas — leur limite est d'une autre
  // nature, et c'est le compteur « En essai gratuit » qui les suit.
  const expired = garages.filter(
    (garage) =>
      garage.accountStatus === "subscribed" &&
      subscriptionStatus(garage.subscriptionEndDate) !== "active" &&
      subscriptionStatus(garage.subscriptionEndDate) !== "expiring",
  );
  const expiringSoon = garages.filter(
    (garage) => subscriptionStatus(garage.subscriptionEndDate) === "expiring",
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Tableau de bord"
        description="Vue d'ensemble des comptes garages et des événements à traiter."
        action={
          <Button asChild>
            <Link href="/admin/comptes/nouveau">
              <UserPlus aria-hidden />
              Créer un compte
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          icon={<Building2 className="size-4" aria-hidden />}
          label="Garages"
          value={garages.length}
          href="/admin/garages"
        />
        <StatCard
          icon={<Clock className="size-4" aria-hidden />}
          label="En essai gratuit"
          value={trials.length}
          href="/admin/comptes"
        />
        <StatCard
          icon={<TriangleAlert className="size-4" aria-hidden />}
          label="Fiches incomplètes"
          value={incomplete.length}
          href="/admin/garages"
        />
        <StatCard
          icon={<CalendarX className="size-4" aria-hidden />}
          label="Abonnements expirés"
          value={expired.length}
          href="/admin/garages?statut=expires"
        />
        <StatCard
          icon={<CalendarClock className="size-4" aria-hidden />}
          label="Expirant sous 7 jours"
          value={expiringSoon.length}
          href="/admin/garages?statut=bientot"
        />
        <StatCard
          icon={<Bell className="size-4" aria-hidden />}
          label="Notifications non lues"
          value={unread}
          href="/admin/notifications"
        />
      </div>

      {trials.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Essais en cours</CardTitle>
            <CardDescription>
              L&apos;essai s&apos;arrête à la limite de factures finalisées. Enregistrez
              un abonnement pour la lever.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {trials.map((account) => (
              <div
                key={account.userId}
                className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2 text-sm"
              >
                <span className="font-medium">{account.garage?.name}</span>
                <Badge variant="secondary">
                  {account.garage?.trialInvoicesUsed} / {account.garage?.trialInvoiceLimit} factures
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {pendingPasswordChange.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mot de passe initial non changé</CardTitle>
            <CardDescription>
              Ces comptes utilisent encore un mot de passe que vous connaissez. Ils
              devront en choisir un autre à leur prochaine connexion.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingPasswordChange.map((account) => (
              <div key={account.userId} className="rounded-lg border px-3 py-2 text-sm">
                {account.garage?.name ?? account.fullName ?? account.userId}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl border bg-card p-4 shadow-sm transition-colors hover:border-primary/30 hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span className="flex items-center gap-2 text-sm text-muted-foreground transition-colors group-hover:text-accent-foreground">
        {icon}
        {label}
      </span>
      <span className="mt-2 block text-2xl font-semibold tabular-nums">{value}</span>
    </Link>
  );
}
