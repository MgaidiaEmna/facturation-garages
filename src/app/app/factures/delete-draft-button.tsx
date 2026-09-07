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
import { deleteInvoiceDraftAction } from "@/lib/invoice/actions";

/**
 * Suppression d'un brouillon, avec confirmation.
 *
 * Seuls les brouillons se suppriment : une facture émise est immuable, et
 * `invoices_guard_trg` le refuserait de toute façon. La confirmation est ici
 * parce qu'un brouillon représente une saisie qu'on ne veut pas perdre d'un
 * clic distrait — pas parce que la base aurait besoin d'être protégée.
 */
export function DeleteDraftButton({
  invoiceId,
  label,
}: {
  invoiceId: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startDeleting] = useTransition();
  const router = useRouter();

  function remove() {
    startDeleting(async () => {
      const result = await deleteInvoiceDraftAction(invoiceId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Brouillon supprimé.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
          <Trash2 aria-hidden />
          <span className="sr-only">Supprimer le brouillon de {label}</span>
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Supprimer ce brouillon ?</DialogTitle>
          <DialogDescription>
            Le brouillon de « {label} » et ses lignes seront effacés. Aucun numéro
            n&apos;ayant été attribué, la série de factures n&apos;est pas affectée.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Annuler
          </Button>
          <Button type="button" variant="destructive" onClick={remove} disabled={pending}>
            {pending ? "Suppression…" : "Supprimer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
