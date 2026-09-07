"use client";

import { ErrorScreen } from "@/components/error-screen";

/**
 * Frontière d'erreur de l'espace administrateur.
 *
 * Elle est distincte de celle de la racine pour une seule raison : le bouton
 * de repli. Renvoyer un administrateur vers « / » l'obligerait à repasser par
 * l'aiguillage ; on le ramène à son tableau de bord.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorScreen
      digest={error.digest}
      reset={reset}
      retour={{ href: "/admin", libelle: "Retour au tableau de bord" }}
    />
  );
}
