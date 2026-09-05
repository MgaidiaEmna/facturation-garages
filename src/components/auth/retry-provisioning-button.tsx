"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AuthFormMessage } from "@/components/auth/auth-form-message";
import { retryProvisioningAction, type AuthFormState } from "@/lib/auth/actions";

const INITIAL: AuthFormState = {};

/**
 * Relance le rattachement d'un compte issu de l'inscription en ligne.
 * Sans issue de secours, une personne dont le provisionnement a échoué après
 * la vérification de son e-mail resterait bloquée : le lien de confirmation
 * ne sert qu'une fois.
 */
export function RetryProvisioningButton() {
  const [state, formAction, pending] = useActionState(retryProvisioningAction, INITIAL);

  return (
    <div className="space-y-2">
      <AuthFormMessage>{state.error}</AuthFormMessage>
      <form action={formAction}>
        <Button type="submit" variant="outline" className="w-full" disabled={pending}>
          <RefreshCw aria-hidden />
          {pending ? "Nouvelle tentative…" : "Réessayer d'activer mon compte"}
        </Button>
      </form>
    </div>
  );
}
