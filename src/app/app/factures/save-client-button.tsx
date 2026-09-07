"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookmarkPlus, Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { quickCreateClientAction } from "@/lib/catalog/actions";

/**
 * Enregistre au carnet le client saisi à la volée dans l'éditeur.
 *
 * Facturer quelqu'un une fois n'oblige à rien : le client ponctuel se saisit
 * et s'oublie. C'est en le facturant une DEUXIÈME fois qu'on regrette de ne
 * pas l'avoir gardé — et c'est à ce moment-là qu'on est devant l'éditeur, pas
 * devant le carnet. D'où ce bouton ici.
 *
 * Il passe par `quickCreateClientAction`, qui reconstruit un `FormData` et
 * appelle `saveClientAction` : même validation, même chemin, même RLS que le
 * formulaire du carnet. Une seconde implémentation « allégée » serait une
 * seconde occasion de laisser passer quelque chose.
 */
export function SaveClientButton({
  clientName,
  clientAddress,
  clientPhone,
  clientVatNumber,
  disabled,
}: {
  clientName: string;
  clientAddress: string;
  clientPhone: string;
  clientVatNumber: string;
  disabled?: boolean;
}) {
  const [pending, startSaving] = useTransition();
  const [enregistre, setEnregistre] = useState(false);
  const router = useRouter();

  // Le carnet exige un nom ; inutile de proposer le bouton avant.
  const prêt = clientName.trim().length >= 2;

  function save() {
    startSaving(async () => {
      const result = await quickCreateClientAction({
        name: clientName,
        address: clientAddress,
        phone: clientPhone,
        vatNumber: clientVatNumber,
      });

      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.fieldErrors) {
        const premier = Object.values(result.fieldErrors)[0]?.[0];
        toast.error(premier ?? "Certaines valeurs sont invalides.");
        return;
      }

      setEnregistre(true);
      toast.success(`« ${clientName.trim()} » ajouté au carnet.`);
      router.refresh();
    });
  }

  if (enregistre) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Check aria-hidden className="size-3.5" />
        Ajouté au carnet
      </span>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={save}
      disabled={pending || disabled || !prêt}
      className="text-muted-foreground"
    >
      <BookmarkPlus aria-hidden />
      {pending ? "Enregistrement…" : "Enregistrer ce client"}
    </Button>
  );
}
