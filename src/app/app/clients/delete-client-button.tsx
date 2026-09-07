"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { deleteClientAction } from "@/lib/catalog/actions";

/**
 * Retire un client du carnet, avec confirmation.
 *
 * La confirmation est là parce qu'une fiche représente une saisie qu'on ne
 * veut pas perdre d'un clic distrait — pas parce que la comptabilité serait en
 * jeu : les factures ont RECOPIÉ le nom, l'adresse et le n° de TVA du client
 * au moment de leur saisie. Supprimer ici n'efface aucune pièce.
 */
export function DeleteClientButton({
  clientId,
  label,
  redirectTo,
}: {
  clientId: string;
  label: string;
  /** Où aller après la suppression ; sinon on rafraîchit sur place. */
  redirectTo?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startDeleting] = useTransition();
  const router = useRouter();

  function remove() {
    startDeleting(async () => {
      const result = await deleteClientAction(clientId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Client retiré du carnet.");
      setOpen(false);
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 aria-hidden />
          <span className="sr-only">Retirer {label} du carnet</span>
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Retirer « {label} » du carnet ?</DialogTitle>
          <DialogDescription>
            La fiche sera effacée. Vos factures ne changent pas : elles portent leur
            propre copie du nom et des coordonnées, figée au moment de la saisie.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Annuler
          </Button>
          <Button type="button" variant="destructive" onClick={remove} disabled={pending}>
            {pending ? "Suppression…" : "Retirer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
