"use client";

import { useRef, useState } from "react";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  ACCEPT_HTML,
  MESSAGE_TAILLE,
  MESSAGE_TYPE,
  TAILLE_MAX,
  TYPES_ACCEPTES,
} from "@/lib/logos/schema";

/**
 * Champ de fichier d'un logo, qui refuse AVANT d'envoyer.
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
 * Ce contrôle n'est pas la barrière — `logoUploadSchema` valide côté serveur,
 * et le bucket refuse de son côté ce qui dépasse `file_size_limit`. Il est là
 * pour que le refus soit une phrase et non un écran cassé.
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
  const champ = useRef<HTMLInputElement>(null);

  function verifier(event: React.ChangeEvent<HTMLInputElement>) {
    const fichier = event.target.files?.[0];
    if (!fichier) {
      setErreur(null);
      return;
    }

    // L'ordre compte : un SVG de 4 Ko doit s'entendre dire que c'est le FORMAT
    // qui ne va pas, pas la taille.
    if (!(TYPES_ACCEPTES as readonly string[]).includes(fichier.type)) {
      setErreur(MESSAGE_TYPE);
      if (champ.current) champ.current.value = "";
      return;
    }

    if (fichier.size > TAILLE_MAX) {
      setErreur(MESSAGE_TAILLE);
      if (champ.current) champ.current.value = "";
      return;
    }

    setErreur(null);
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
        disabled={disabled}
        required={required}
        aria-describedby={erreur ? `${id}-erreur` : undefined}
      />
      <FieldDescription>
        PNG ou JPEG, 2 Mo maximum. Le SVG n&apos;est pas accepté : il ne
        s&apos;imprimerait pas dans le PDF.
      </FieldDescription>
      {/* `role="alert"` : le refus est annoncé aux lecteurs d'écran sans que la
          personne ait à repartir en haut du formulaire. */}
      <FieldError id={`${id}-erreur`} role="alert">
        {erreur}
      </FieldError>
    </Field>
  );
}
