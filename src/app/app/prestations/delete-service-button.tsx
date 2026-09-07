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
import { deleteServiceAction } from "@/lib/catalog/actions";

/**
 * Retire une prestation du catalogue, avec confirmation.
 *
 * Les lignes de facture ne pointent pas vers le catalogue : elles ont recopié
 * désignation, unité, prix et taux au moment de la saisie. Retirer une
 * prestation ne modifie donc aucune facture, émise ou non.
 */
export function DeleteServiceButton({
  serviceId,
  label,
  redirectTo,
}: {
  serviceId: string;
  label: string;
  redirectTo?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startDeleting] = useTransition();
  const router = useRouter();

  function remove() {
    startDeleting(async () => {
      const result = await deleteServiceAction(serviceId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Prestation retirée du catalogue.");
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
          <span className="sr-only">Retirer {label} du catalogue</span>
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Retirer « {label} » du catalogue ?</DialogTitle>
          <DialogDescription>
            Vos factures ne changent pas : leurs lignes portent leur propre copie de
            la désignation, du prix et du taux, figée au moment de la saisie.
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
