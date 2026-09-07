"use client";

import { useRef, useState } from "react";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { COTE_MAX, redimensionnerLogo } from "@/lib/logos/redimensionner";
import {
  ACCEPT_HTML,
  MESSAGE_TAILLE,
  MESSAGE_TYPE,
  TAILLE_MAX,
  TYPES_ACCEPTES,
} from "@/lib/logos/schema";

/**
 * Champ de fichier d'un logo : il refuse avant d'envoyer, et il allège.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI CE CONTRÔLE EXISTE, ALORS QUE LE SERVEUR VALIDE DÉJÀ
 * ---------------------------------------------------------------------------
 * Il ne double pas la validation par confort : il évite une classe d'erreur
 * que le serveur ne peut pas rattraper proprement. Un corps de requête trop
 * gros est rejeté par Next AVANT que la Server Action ne s'exécute — donc
 * avant qu'aucun `zod` n'ait son mot à dire, et le résultat est une page
 * d'erreur brute. Le seul endroit où l'on peut encore parler à la personne,
 * c'est ici.
 *
 * Le fichier fautif est RETIRÉ du champ, pas seulement signalé : tant qu'il y
 * reste, un clic sur « Envoyer » le pousserait quand même.
 *
 * ---------------------------------------------------------------------------
 * ET IL RÉDUIT L'IMAGE
 * ---------------------------------------------------------------------------
 * Mesuré : un logo de 1200 × 1200 produisait un PDF d'une page de 959 Kio,
 * dont 955 pour l'image — alors qu'elle s'imprime dans 170 × 46 points. La
 * réduction a lieu une fois, ici, plutôt qu'à chaque génération de document.
 *
 * Rien de tout cela n'est une barrière : `logoUploadSchema` valide côté
 * serveur, et le bucket refuse ce qui dépasse `file_size_limit`.
 */
export function LogoFileField({
  id = "file",
  name = "file",
  required = true,
  disabled,
}: {
  id?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const champ = useRef<HTMLInputElement>(null);

  function vider() {
    if (champ.current) champ.current.value = "";
  }

  async function verifier(event: React.ChangeEvent<HTMLInputElement>) {
    const fichier = event.target.files?.[0];
    setNote(null);
    if (!fichier) {
      setErreur(null);
      return;
    }

    // L'ordre compte : un SVG de 4 Ko doit s'entendre dire que c'est le FORMAT
    // qui ne va pas, pas la taille.
    if (!(TYPES_ACCEPTES as readonly string[]).includes(fichier.type)) {
      setErreur(MESSAGE_TYPE);
      vider();
      return;
    }

    setErreur(null);
    setOccupe(true);
    try {
      const reduit = await redimensionnerLogo(fichier);

      // La réduction échoue silencieusement sur un fichier illisible : c'est
      // la taille du fichier RETENU qu'on éprouve, pas celle de l'original.
      if (reduit.size > TAILLE_MAX) {
        setErreur(MESSAGE_TAILLE);
        vider();
        return;
      }

      if (reduit !== fichier && champ.current) {
        // `DataTransfer` est le seul moyen de remplacer le contenu d'un champ
        // de fichier : c'est le fichier RÉDUIT qui doit partir, pas l'original.
        const transfert = new DataTransfer();
        transfert.items.add(reduit);
        champ.current.files = transfert.files;

        const avant = Math.round(fichier.size / 1024);
        const apres = Math.round(reduit.size / 1024);
        setNote(
          `Image allégée pour l'impression : ${avant} Ko → ${apres} Ko ` +
            `(${COTE_MAX} px maximum). La facture n'en sera que plus rapide à produire.`,
        );
      }
    } finally {
      setOccupe(false);
    }
  }

  return (
    <Field data-invalid={Boolean(erreur) || undefined}>
      <FieldLabel htmlFor={id}>Fichier</FieldLabel>
      <Input
        ref={champ}
        id={id}
        name={name}
        type="file"
        accept={ACCEPT_HTML}
        onChange={verifier}
        disabled={disabled || occupe}
        required={required}
        aria-describedby={erreur ? `${id}-erreur` : undefined}
      />
      <FieldDescription>
        PNG ou JPEG, 2 Mo maximum. Les images plus grandes que {COTE_MAX} px sont
        réduites automatiquement. Le SVG n&apos;est pas accepté : il ne
        s&apos;imprimerait pas dans le PDF.
      </FieldDescription>
      {occupe ? (
        <p className="text-sm text-muted-foreground">Préparation de l&apos;image…</p>
      ) : null}
      {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      {/* `role="alert"` : le refus est annoncé aux lecteurs d'écran sans que la
          personne ait à repartir en haut du formulaire. */}
      <FieldError id={`${id}-erreur`} role="alert">
        {erreur}
      </FieldError>
    </Field>
  );
}
