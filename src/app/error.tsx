"use client";

import { ErrorScreen } from "@/components/error-screen";

/**
 * Frontière d'erreur de la racine.
 *
 * Elle rattrape ce qui casse hors des deux espaces — page d'accueil, écrans
 * d'authentification, redirections. Sans elle, Next sert sa page d'erreur
 * générique en anglais, qui n'appartient à personne et laisse le visiteur sans
 * porte de sortie.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorScreen digest={error.digest} reset={reset} />;
}
