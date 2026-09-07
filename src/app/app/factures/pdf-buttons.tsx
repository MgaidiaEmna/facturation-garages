"use client";

import { useState } from "react";
import { Download, FileText, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

/**
 * Les commandes PDF : télécharger, imprimer, prévisualiser.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CE N'EST PLUS UN SIMPLE LIEN
 * ---------------------------------------------------------------------------
 * Un `<a href>` vers la route PDF laisse la personne devant un bouton qui ne
 * réagit pas : la génération prend quelques centaines de millisecondes en
 * temps normal, mais plusieurs secondes au premier appel — le temps que le
 * module de rendu se charge côté serveur. Rien ne l'indiquait, et quand la
 * requête échouait, la console affichait « Failed to fetch » pendant que
 * l'écran, lui, ne disait rien du tout.
 *
 * On récupère donc le document en JavaScript pour pouvoir montrer que ça
 * travaille, et pour transformer un échec en phrase.
 *
 * ---------------------------------------------------------------------------
 * LE LIEN RESTE UN LIEN
 * ---------------------------------------------------------------------------
 * L'élément rendu est toujours un `<a href>` : sans JavaScript, le clic suit
 * le lien et le navigateur télécharge comme avant. L'amélioration est
 * progressive, elle ne remplace rien.
 */

/** Ce que le serveur a répondu, quand ce n'est pas un PDF. */
async function messageDErreur(response: Response): Promise<string> {
  if (response.status === 404) {
    return "Cette facture n'existe plus, ou elle ne vous appartient pas.";
  }
  if (response.status === 401 || response.status === 403 || response.redirected) {
    return "Votre session a expiré. Reconnectez-vous, puis réessayez.";
  }
  return (
    "La génération du PDF a échoué. Réessayez dans un instant ; " +
    "si cela persiste, prévenez l'administrateur."
  );
}

function useTelechargement(href: string, nomParDefaut: string) {
  const [enCours, setEnCours] = useState(false);

  async function recuperer(
    event: React.MouseEvent<HTMLAnchorElement>,
    apres: (url: string, nom: string) => void,
  ) {
    // Laisser passer les clics qui ouvrent un onglet : c'est le comportement
    // que la personne a demandé, pas le nôtre.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;

    event.preventDefault();
    if (enCours) return;
    setEnCours(true);

    try {
      const response = await fetch(href, { headers: { accept: "application/pdf" } });

      if (!response.ok || !response.headers.get("content-type")?.includes("pdf")) {
        toast.error(await messageDErreur(response));
        return;
      }

      // Le nom voulu est dans l'en-tête : on le reprend plutôt que d'en
      // inventer un second, qui divergerait du téléchargement direct.
      const disposition = response.headers.get("content-disposition") ?? "";
      const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      const ascii = disposition.match(/filename="([^"]+)"/i);
      const nom = utf8
        ? decodeURIComponent(utf8[1])
        : (ascii?.[1] ?? nomParDefaut);

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      try {
        apres(url, nom);
      } finally {
        // Laisser au navigateur le temps d'ouvrir l'onglet ou d'enregistrer.
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch {
      // C'est ici qu'atterrissait le « Failed to fetch » de la console.
      toast.error(
        "Impossible de joindre le serveur. Vérifiez votre connexion, puis réessayez.",
      );
    } finally {
      setEnCours(false);
    }
  }

  return { enCours, recuperer };
}

/** Télécharge la facture émise. */
export function DownloadPdfButton({
  href,
  nomParDefaut,
}: {
  href: string;
  nomParDefaut: string;
}) {
  const { enCours, recuperer } = useTelechargement(href, nomParDefaut);

  return (
    <Button asChild disabled={enCours}>
      <a
        href={href}
        aria-busy={enCours}
        onClick={(event) =>
          recuperer(event, (url, nom) => {
            const lien = document.createElement("a");
            lien.href = url;
            lien.download = nom;
            lien.click();
          })
        }
      >
        {enCours ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
        {enCours ? "Génération…" : "Télécharger le PDF"}
      </a>
    </Button>
  );
}

/** Ouvre la facture dans le lecteur du navigateur, prête à imprimer. */
export function PrintPdfButton({
  href,
  nomParDefaut,
}: {
  href: string;
  nomParDefaut: string;
}) {
  const { enCours, recuperer } = useTelechargement(href, nomParDefaut);

  return (
    <Button asChild variant="outline" disabled={enCours}>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-busy={enCours}
        title="Ouvre la facture dans un nouvel onglet, prête à imprimer."
        onClick={(event) =>
          recuperer(event, (url) => {
            const onglet = window.open(url, "_blank", "noreferrer");
            if (!onglet) {
              toast.error(
                "Le navigateur a bloqué l'ouverture de l'onglet. Autorisez les fenêtres " +
                  "surgissantes pour ce site, ou utilisez « Télécharger le PDF ».",
              );
            }
          })
        }
      >
        {enCours ? <Loader2 className="animate-spin" aria-hidden /> : <Printer aria-hidden />}
        {enCours ? "Génération…" : "Imprimer"}
      </a>
    </Button>
  );
}

/** Aperçu PDF d'un brouillon, depuis l'éditeur. */
export function PreviewPdfButton({
  invoiceId,
  disabled,
}: {
  /** `null` tant que le brouillon n'a jamais été enregistré. */
  invoiceId: string | null;
  disabled?: boolean;
}) {
  const href = invoiceId ? `/app/factures/${invoiceId}/pdf` : "#";
  const { enCours, recuperer } = useTelechargement(href, "Brouillon.pdf");

  // Le PDF est produit par le serveur, à partir de ce qui est EN BASE : il n'y
  // a rien à prévisualiser tant que rien n'est enregistré. Le bouton le dit au
  // lieu de disparaître.
  if (!invoiceId) {
    return (
      <Button
        variant="ghost"
        disabled
        title="Enregistrez le brouillon pour en voir l'aperçu PDF."
      >
        <FileText aria-hidden />
        Aperçu PDF
      </Button>
    );
  }

  return (
    <Button asChild variant="ghost" disabled={enCours || disabled}>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-busy={enCours}
        title="Ouvre le brouillon en PDF dans un nouvel onglet, prêt à imprimer."
        onClick={(event) =>
          recuperer(event, (url) => {
            const onglet = window.open(url, "_blank", "noreferrer");
            if (!onglet) {
              toast.error(
                "Le navigateur a bloqué l'ouverture de l'onglet. Autorisez les fenêtres " +
                  "surgissantes pour ce site.",
              );
            }
          })
        }
      >
        {enCours ? <Loader2 className="animate-spin" aria-hidden /> : <FileText aria-hidden />}
        {enCours ? "Génération…" : "Aperçu PDF"}
      </a>
    </Button>
  );
}
