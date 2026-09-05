import type { Metadata } from "next";
import Link from "next/link";
import { Bell, Building2, Clock, UserPlus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { countUnreadNotifications, listGarageAccounts } from "@/lib/admin/queries";

export const metadata: Metadata = {
  title: "Administration — Facturation multi-garages",
};

export default async function AdminHomePage() {
  const [accounts, unread] = await Promise.all([
    listGarageAccounts(),
    countUnreadNotifications(),
  ]);

  const trials = accounts.filter((a) => a.garage?.accountStatus === "trial");
  const pendingPasswordChange = accounts.filter((a) => a.mustChangePassword);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Tableau de bord</h1>
          <p className="text-sm text-muted-foreground">
            Vue d&apos;ensemble des comptes garages et des événements à traiter.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/comptes/nouveau">
            <UserPlus aria-hidden />
            Créer un compte
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={<Building2 className="size-4" aria-hidden />}
          label="Comptes garages"
          value={accounts.length}
          href="/admin/comptes"
        />
        <StatCard
          icon={<Clock className="size-4" aria-hidden />}
          label="En essai gratuit"
          value={trials.length}
          href="/admin/comptes"
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
                className="flex items-center justify-between gap-4 rounded-md border px-3 py-2 text-sm"
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
              <div key={account.userId} className="rounded-md border px-3 py-2 text-sm">
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
      className="rounded-lg border p-4 transition-colors hover:bg-muted/50"
    >
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="mt-2 block text-2xl font-semibold tabular-nums">{value}</span>
    </Link>
  );
}
