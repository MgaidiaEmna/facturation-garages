"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
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
import { finalizeInvoiceAction } from "@/lib/invoice/actions";

/**
 * Émettre la facture, avec confirmation.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI ON ENREGISTRE AVANT D'ÉMETTRE
 * ---------------------------------------------------------------------------
 * `finalize_invoice()` travaille sur ce qui est EN BASE, pas sur ce qui est à
 * l'écran. Émettre sans enregistrer d'abord produirait une facture conforme
 * au dernier enregistrement et non à ce que la personne vient de relire —
 * l'écart passerait inaperçu jusqu'à ce que le client le signale. Le bouton
 * enchaîne donc les deux, dans cet ordre.
 *
 * Les deux appels ne partagent pas de transaction : ce sont deux opérations
 * distinctes de la base. Si l'émission échoue après un enregistrement réussi,
 * il reste un brouillon à jour — la saisie n'est jamais perdue, et rien
 * d'irréversible n'a eu lieu.
 *
 * ---------------------------------------------------------------------------
 * CE BOUTON N'EST PAS UNE BARRIÈRE
 * ---------------------------------------------------------------------------
 * `blockMessage` grise le bouton et explique pourquoi. Ce qui refuse
 * réellement, c'est `finalize_invoice()` en base, avec la MÊME phrase
 * (`finalize_block_message()`). L'UI n'est qu'une politesse.
 */
export function FinalizeInvoiceButton({
  invoiceId,
  clientName,
  totalLabel,
  lineCount,
  blockMessage,
  onBeforeFinalize,
}: {
  /** `null` tant que le brouillon n'a jamais été enregistré. */
  invoiceId: string | null;
  clientName: string;
  totalLabel: string;
  lineCount: number;
  /** Motif de blocage commercial, produit par la base. `null` si l'émission est ouverte. */
  blockMessage: string | null;
  /**
   * Enregistre le brouillon et renvoie son identifiant, ou `null` si
   * l'enregistrement a échoué (l'appelant a déjà prévenu la personne).
   */
  onBeforeFinalize: () => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startFinalizing] = useTransition();
  const router = useRouter();

  // Une facture sans client ni ligne sera refusée par la base ; autant le
  // dire avant le clic. Ces deux règles sont écrites dans
  // `finalize_invoice()` — celles-ci ne font que les annoncer.
  const manquant =
    clientName.trim() === ""
      ? "Renseignez le nom du client avant d'émettre."
      : lineCount === 0
        ? "Ajoutez au moins une ligne de prestation avant d'émettre."
        : null;

  const empechement = blockMessage ?? manquant;

  function finalize() {
    startFinalizing(async () => {
      const savedId = await onBeforeFinalize();
      if (!savedId) return;

      const result = await finalizeInvoiceAction(savedId);
      if (result.error) {
        toast.error(result.error);
        return;
      }

      setOpen(false);
      toast.success(`Facture ${result.number} émise.`);
      // La facture n'est plus modifiable : la page de reprise bascule
      // d'elle-même sur la vue figée.
      router.replace(`/app/factures/${savedId}`);
      router.refresh();
    });
  }

  const bouton = (
    <Button disabled={Boolean(empechement)}>
      <Send aria-hidden />
      Émettre la facture
    </Button>
  );

  if (empechement) {
    return (
      <div className="flex flex-col items-end gap-1">
        {bouton}
        <span className="max-w-xs text-right text-xs text-muted-foreground">
          {empechement}
        </span>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{bouton}</DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Émettre cette facture ?</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">
              <p>
                La facture de « {clientName.trim()} », {totalLabel} TTC, recevra son
                numéro définitif et ne sera plus modifiable.
              </p>
              <p>
                Le numéro est attribué par la série du garage, sans trou et sans
                retour en arrière : une facture émise ne se supprime pas. Une
                erreur se corrige par un avoir.
              </p>
              {invoiceId ? null : (
                <p>Le brouillon sera enregistré avant l&apos;émission.</p>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Annuler
          </Button>
          <Button type="button" onClick={finalize} disabled={pending}>
            {pending ? "Émission…" : "Émettre"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
