import type { Metadata } from "next";
import Link from "next/link";
import { UserPlus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AccessBadge, InactiveBadge } from "@/components/admin/garage-badges";
import { listGarageAccounts } from "@/lib/admin/queries";
import { ResetPasswordDialog } from "./reset-password-dialog";

export const metadata: Metadata = {
  title: "Comptes garages — Administration",
};

export default async function AccountsPage() {
  const accounts = await listGarageAccounts();

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Comptes garages</h1>
          <p className="text-sm text-muted-foreground">
            Comptes créés par vous et inscriptions en ligne vérifiées.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/comptes/nouveau">
            <UserPlus aria-hidden />
            Créer un compte
          </Link>
        </Button>
      </div>

      {accounts.length === 0 ? (
        <div className="rounded-lg border border-dashed px-6 py-16 text-center">
          <p className="text-sm font-medium">Aucun compte garage pour l&apos;instant</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Créez-en un vous-même, ou attendez qu&apos;un garage s&apos;inscrive en
            ligne — il démarrera alors en essai gratuit.
          </p>
          <Button asChild className="mt-6">
            <Link href="/admin/comptes/nouveau">
              <UserPlus aria-hidden />
              Créer un compte
            </Link>
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Garage</TableHead>
                <TableHead>Adresse e-mail</TableHead>
                <TableHead>Accès</TableHead>
                <TableHead>Origine</TableHead>
                <TableHead className="text-right">Mot de passe</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => (
                <TableRow key={account.userId}>
                  <TableCell className="font-medium">
                    {account.garage ? (
                      <Link
                        href={`/admin/garages/${account.garage.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {account.garage.name}
                      </Link>
                    ) : (
                      "—"
                    )}
                    {account.garage && !account.garage.isActive ? (
                      <span className="ms-2 inline-block align-middle">
                        <InactiveBadge />
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {account.garage?.email ?? "—"}
                  </TableCell>
                  <TableCell>
                    {account.garage ? (
                      <AccessBadge
                        accountStatus={account.garage.accountStatus}
                        trialInvoicesUsed={account.garage.trialInvoicesUsed}
                        trialInvoiceLimit={account.garage.trialInvoiceLimit}
                        subscriptionEndDate={account.subscriptionEndDate}
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {account.garage?.origin === "self_signup"
                      ? "Inscription en ligne"
                      : "Créé par l'admin"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-2">
                      {account.mustChangePassword ? (
                        <Badge variant="outline">Changement en attente</Badge>
                      ) : null}
                      <ResetPasswordDialog
                        userId={account.userId}
                        garageName={account.garage?.name ?? "ce compte"}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
