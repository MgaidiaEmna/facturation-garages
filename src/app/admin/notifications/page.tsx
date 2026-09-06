import type { Metadata } from "next";
import { BellOff, CheckCheck, Gift, KeyRound, ShieldAlert, UserPlus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { formatDateTime } from "@/lib/format";
import { markNotificationsReadAction } from "@/lib/admin/actions";
import {
  listAdminNotifications,
  type AdminNotification,
  type AdminNotificationType,
} from "@/lib/admin/queries";

export const metadata: Metadata = {
  title: "Notifications — Administration",
};

const ICONS: Record<AdminNotificationType, React.ReactNode> = {
  garage_signup: <UserPlus className="size-4" aria-hidden />,
  password_changed: <KeyRound className="size-4" aria-hidden />,
  password_reset_by_admin: <ShieldAlert className="size-4" aria-hidden />,
  trial_exhausted: <Gift className="size-4" aria-hidden />,
};

export default async function NotificationsPage() {
  const notifications = await listAdminNotifications();
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Notifications"
        description="Journal des événements de compte. Il décrit ce qui s'est passé et ne contient aucun mot de passe — ceux que choisissent les garages ne sont connus de personne d'autre qu'eux."
        action={
          unread > 0 ? (
            <form action={markNotificationsReadAction}>
              <Button type="submit" variant="outline">
                <CheckCheck aria-hidden />
                Tout marquer comme lu ({unread})
              </Button>
            </form>
          ) : null
        }
      />

      {notifications.length === 0 ? (
        <EmptyState
          icon={<BellOff className="size-5" aria-hidden />}
          title="Aucun événement pour l'instant"
          description="Les inscriptions, changements de mot de passe et fins d'essai apparaîtront ici."
        />
      ) : (
        <ul className="divide-y rounded-xl border bg-card shadow-sm">
          {notifications.map((notification) => (
            <NotificationRow key={notification.id} notification={notification} />
          ))}
        </ul>
      )}
    </div>
  );
}

function NotificationRow({ notification }: { notification: AdminNotification }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        {ICONS[notification.type]}
      </span>

      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm">{notification.message}</p>
        <p className="text-xs text-muted-foreground">
          <time dateTime={notification.createdAt}>
            {formatDateTime(notification.createdAt)}
          </time>
          {notification.garageName ? ` · ${notification.garageName}` : null}
        </p>
      </div>

      {notification.readAt ? null : (
        <Badge variant="secondary" className="shrink-0">
          Nouveau
        </Badge>
      )}
    </li>
  );
}
