import { Banknote, CalendarClock, History } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SectionHeader } from "@/components/page-header";
import { formatAmount, formatDate, formatDateShort } from "@/lib/format";
import {
  daysUntil,
  paymentMethodLabel,
  subscriptionStatus,
} from "@/lib/admin/payment-schema";
import type { GaragePayment } from "@/lib/admin/queries";
import { PaymentForm } from "./payment-form";

/**
 * Abonnement et encaissements d'un garage.
 *
 * L'état affiché ici est purement descriptif : ce qui ouvre ou ferme
 * réellement l'espace du garage, c'est `has_write_access()` en base, qui
 * compare `end_date` à la date du jour. Cette carte raconte, elle ne décide
 * pas — même règle que le bandeau de l'espace garage.
 */
export function SubscriptionCard({
  garageId,
  accountStatus,
  trialInvoicesUsed,
  trialInvoiceLimit,
  subscriptionEndDate,
  subscriptionStartDate,
  payments,
}: {
  garageId: string;
  accountStatus: "trial" | "subscribed";
  trialInvoicesUsed: number;
  trialInvoiceLimit: number;
  subscriptionEndDate: string | null;
  subscriptionStartDate: string | null;
  payments: GaragePayment[];
}) {
  const status = subscriptionStatus(subscriptionEndDate);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="size-4" aria-hidden />
          Abonnement et paiements
        </CardTitle>
        <CardDescription>
          L&apos;encaissement se fait hors ligne ; vous en consignez ici la trace, et
          l&apos;abonnement est prolongé dans le même mouvement.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-8">
        <SubscriptionStatusLine
          status={status}
          endDate={subscriptionEndDate}
          startDate={subscriptionStartDate}
          accountStatus={accountStatus}
          trialInvoicesUsed={trialInvoicesUsed}
          trialInvoiceLimit={trialInvoiceLimit}
        />

        <Separator />

        <div className="space-y-4">
          <SectionHeader
            title="Enregistrer un paiement"
            description="Le garage retrouve immédiatement l'écriture et l'émission de factures."
          />
          <PaymentForm
            garageId={garageId}
            status={status}
            currentEndDate={subscriptionEndDate}
          />
        </div>

        <div className="space-y-4">
          <SectionHeader
            title="Historique des encaissements"
            description={
              payments.length > 0
                ? `${payments.length} paiement${payments.length > 1 ? "s" : ""} enregistré${payments.length > 1 ? "s" : ""}.`
                : undefined
            }
          />
          <PaymentHistory payments={payments} />
        </div>
      </CardContent>
    </Card>
  );
}

/** Où en est l'abonnement, en une phrase et une pastille. */
function SubscriptionStatusLine({
  status,
  endDate,
  startDate,
  accountStatus,
  trialInvoicesUsed,
  trialInvoiceLimit,
}: {
  status: ReturnType<typeof subscriptionStatus>;
  endDate: string | null;
  startDate: string | null;
  accountStatus: "trial" | "subscribed";
  trialInvoicesUsed: number;
  trialInvoiceLimit: number;
}) {
  // Aucun abonnement : soit l'essai gratuit court encore, soit le compte
  // n'a jamais rien eu. Les deux se disent différemment.
  if (status === "none") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        {accountStatus === "trial" ? (
          <>
            <Badge variant="secondary">
              Essai {trialInvoicesUsed} / {trialInvoiceLimit}
            </Badge>
            <p className="text-sm text-muted-foreground">
              Aucun abonnement enregistré. Le premier paiement met fin à l&apos;essai et
              lève le plafond de {trialInvoiceLimit} factures.
            </p>
          </>
        ) : (
          <>
            <Badge variant="destructive">Sans abonnement</Badge>
            <p className="text-sm text-muted-foreground">
              Ce garage ne peut pas émettre de facture tant qu&apos;aucun paiement
              n&apos;est enregistré.
            </p>
          </>
        )}
      </div>
    );
  }

  const days = endDate ? daysUntil(endDate) : 0;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {status === "expired" ? (
        <Badge variant="destructive">Expiré</Badge>
      ) : status === "expiring" ? (
        <Badge variant="outline" className="border-destructive/40 text-destructive">
          Expire bientôt
        </Badge>
      ) : (
        <Badge variant="outline">Actif</Badge>
      )}

      <p className="text-sm">
        {status === "expired" ? (
          <>
            Expiré depuis {Math.abs(days)} jour{Math.abs(days) > 1 ? "s" : ""} —{" "}
            <span className="text-muted-foreground">
              échéance du {formatDate(endDate!)}
            </span>
          </>
        ) : (
          <>
            Actif jusqu&apos;au {formatDate(endDate!)}{" "}
            <span className="text-muted-foreground">
              ({days === 0 ? "dernier jour" : `${days} jour${days > 1 ? "s" : ""} restants`})
            </span>
          </>
        )}
      </p>

      {startDate ? (
        <p className="w-full text-sm text-muted-foreground">
          Client depuis le {formatDate(startDate)}.
        </p>
      ) : null}
    </div>
  );
}

/** Tableau des encaissements, du plus récent au plus ancien. */
function PaymentHistory({ payments }: { payments: GaragePayment[] }) {
  if (payments.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-6 py-10 text-center">
        <History className="mx-auto size-5 text-muted-foreground" aria-hidden />
        <p className="mt-3 text-sm font-medium">Aucun paiement enregistré</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Les encaissements apparaîtront ici, avec la durée qu&apos;ils ont ajoutée et
          qui les a saisis.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Montant</TableHead>
            <TableHead>Mode</TableHead>
            <TableHead>Prolongation</TableHead>
            <TableHead>Saisi par</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.map((payment) => (
            <TableRow key={payment.id}>
              <TableCell className="whitespace-nowrap font-medium">
                {formatDateShort(payment.paidOn)}
              </TableCell>

              <TableCell className="text-right tabular-nums whitespace-nowrap">
                {payment.amount === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  formatAmount(payment.amount)
                )}
              </TableCell>

              <TableCell className="whitespace-nowrap">
                <span className="inline-flex items-center gap-1.5 text-sm">
                  <Banknote className="size-3.5 text-muted-foreground" aria-hidden />
                  {paymentMethodLabel(payment.method)}
                </span>
              </TableCell>

              <TableCell>
                <span className="text-sm">
                  {payment.monthsAdded
                    ? `+ ${payment.monthsAdded} mois`
                    : "Date personnalisée"}
                </span>
                {payment.periodEnd ? (
                  <p className="text-xs text-muted-foreground">
                    jusqu&apos;au {formatDateShort(payment.periodEnd)}
                  </p>
                ) : null}
                {payment.notes ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">{payment.notes}</p>
                ) : null}
              </TableCell>

              <TableCell className="text-sm text-muted-foreground">
                {payment.recordedBy ?? "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
