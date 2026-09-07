"use client";

import { AlertTriangle } from "lucide-react";

/**
 * Le dernier filet : une erreur survenue dans le layout RACINE lui-même.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CE FICHIER NE RESSEMBLE À AUCUN AUTRE
 * ---------------------------------------------------------------------------
 * `global-error.tsx` REMPLACE le layout racine, `<html>` et `<body>` compris.
 * Il doit donc les fournir lui-même — c'est la seule page de l'application qui
 * le fasse. Et comme la feuille de styles est chargée par ce layout défaillant,
 * on ne peut pas compter dessus : les couleurs sont posées en ligne, sans
 * Tailwind ni jeton de thème. Un écran de secours qui dépend de ce qui vient
 * de casser n'est pas un écran de secours.
 *
 * C'est aussi pourquoi il n'y a pas de bouton « Réessayer » vers `reset()`
 * mais un rechargement complet : si le layout racine a échoué, refaire le
 * rendu du même arbre a peu de chances de mieux se passer.
 *
 * En pratique on ne devrait jamais le voir. C'est précisément la raison pour
 * laquelle il doit être écrit simplement et ne rien importer de fragile.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#fafafa",
          color: "#18181b",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <main style={{ maxWidth: 480, padding: "48px 24px", textAlign: "center" }}>
          <div
            aria-hidden
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 48,
              height: 48,
              borderRadius: 999,
              backgroundColor: "#e7eaf0",
              color: "#1f3a5c",
              marginBottom: 20,
            }}
          >
            <AlertTriangle />
          </div>

          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
            L&apos;application n&apos;a pas pu démarrer
          </h1>

          <p style={{ marginTop: 10, fontSize: 14, lineHeight: 1.6, color: "#52525b" }}>
            Une erreur est survenue avant même l&apos;affichage de la page. Vos
            données ne sont pas concernées : rien n&apos;a été écrit. Rechargez la
            page, puis signalez l&apos;incident avec la référence ci-dessous s&apos;il
            se reproduit.
          </p>

          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 28,
              padding: "10px 18px",
              fontSize: 14,
              fontWeight: 500,
              color: "#ffffff",
              backgroundColor: "#1f3a5c",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            Recharger la page
          </button>

          {error.digest ? (
            <p style={{ marginTop: 32, fontSize: 12, color: "#71717a" }}>
              Référence de l&apos;incident :{" "}
              <code style={{ fontFamily: "ui-monospace, monospace" }}>{error.digest}</code>
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
