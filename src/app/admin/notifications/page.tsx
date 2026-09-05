import type { Metadata } from "next";
import { BellOff, CheckCheck, Gift, KeyRound, ShieldAlert, UserPlus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Journal des événements de compte. Il décrit ce qui s&apos;est passé et
            ne contient aucun mot de passe — ceux que choisissent les garages ne
            sont connus de personne d&apos;autre qu&apos;eux.
          </p>
        </div>

        {unread > 0 ? (
          <form action={markNotificationsReadAction}>
            <Button type="submit" variant="outline">
              <CheckCheck aria-hidden />
              Tout marquer comme lu ({unread})
            </Button>
          </form>
        ) : null}
      </div>

      {notifications.length === 0 ? (
        <div className="rounded-lg border border-dashed px-6 py-16 text-center">
          <BellOff className="mx-auto size-5 text-muted-foreground" aria-hidden />
          <p className="mt-3 text-sm font-medium">Aucun événement pour l&apos;instant</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Les inscriptions, changements de mot de passe et fins d&apos;essai
            apparaîtront ici.
          </p>
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
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
      <span className="mt-0.5 text-muted-foreground">{ICONS[notification.type]}</span>

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
