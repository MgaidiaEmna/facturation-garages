"use client";

import { ErrorScreen } from "@/components/error-screen";

/**
 * Frontière d'erreur de l'espace garage.
 *
 * Le message insiste sur ce qui inquiète vraiment un garagiste devant un écran
 * cassé : ses factures. Elles sont en base, pas dans la page.
 */
export default function AppError({
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
      description={
        <>
          L&apos;écran n&apos;a pas pu s&apos;afficher. Vos factures et vos
          brouillons sont enregistrés et intacts : cet incident concerne
          l&apos;affichage, pas vos données. Réessayez, puis signalez-le avec la
          référence ci-dessous si cela recommence.
        </>
      }
      retour={{ href: "/app", libelle: "Retour à mes factures" }}
    />
  );
}
