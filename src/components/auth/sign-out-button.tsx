"use client";

import { useFormStatus } from "react-dom";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { signOutAction } from "@/lib/auth/actions";

/**
 * Déconnexion.
 *
 * Un `<form>` et non un lien : effacer une session est une mutation, elle n'a
 * pas à partir sur un GET — que le navigateur ou un antivirus se permettent de
 * précharger.
 *
 * L'action est passée directement au formulaire, sans emballage : la
 * redirection qu'elle déclenche est ainsi gérée par le runtime React, et non
 * avalée par une fonction intermédiaire.
 */
export function SignOutButton({
  variant = "outline",
  label = "Se déconnecter",
}: {
  variant?: React.ComponentProps<typeof Button>["variant"];
  label?: string;
}) {
  return (
    <form action={signOutAction}>
      <SubmitButton variant={variant} label={label} />
    </form>
  );
}

/** `useFormStatus` doit vivre dans un composant enfant du `<form>`. */
function SubmitButton({
  variant,
  label,
}: {
  variant: React.ComponentProps<typeof Button>["variant"];
  label: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant={variant} className="w-full" disabled={pending}>
      <LogOut aria-hidden />
      {pending ? "Déconnexion…" : label}
    </Button>
  );
}
