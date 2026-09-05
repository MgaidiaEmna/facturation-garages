import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * Message d'erreur d'un formulaire d'authentification.
 *
 * `role="alert"` est porté par `<Alert>` : les lecteurs d'écran annoncent
 * l'échec sans que l'utilisateur ait à repartir en haut du formulaire.
 */
export function AuthFormMessage({ children }: { children?: string }) {
  if (!children) return null;

  return (
    <Alert variant="destructive" className="border-destructive/30">
      <AlertTriangle aria-hidden />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
