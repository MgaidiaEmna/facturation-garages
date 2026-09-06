"use client";

import { useActionState, useState } from "react";
import { Trash2 } from "lucide-react";

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
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AuthFormMessage } from "@/components/auth/auth-form-message";
import { deleteGarageAction, type DeleteGarageState } from "@/lib/auth/admin-actions";

const INITIAL: DeleteGarageState = {};

/**
 * Suppression définitive d'un garage.
 *
 * Le nom doit être retapé à l'identique. Ce n'est pas une formalité : c'est
 * la seule chose qui distingue « je veux supprimer CE garage » de « j'ai
 * cliqué sur la mauvaise ligne ». La comparaison qui compte se fait côté
 * serveur, contre le nom lu en base — celle d'ici n'est qu'un confort de
 * saisie.
 *
 * Le bouton n'est ouvert que si la base l'autorise (`garage_is_deletable()`).
 * Dès la première facture émise, la suppression disparaît et il ne reste que
 * la désactivation : c'est la conservation légale qui commande, pas l'UI.
 */
export function DeleteGarageDialog({
  garageId,
  garageName,
  isDeletable,
  issuedInvoiceCount,
}: {
  garageId: string;
  garageName: string;
  isDeletable: boolean;
  issuedInvoiceCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [state, formAction, pending] = useActionState(deleteGarageAction, INITIAL);

  if (!isDeletable) {
    return (
      <div className="space-y-2">
        <Button type="button" variant="outline" disabled>
          <Trash2 aria-hidden />
          Supprimer le garage
        </Button>
        <p className="text-sm text-muted-foreground">
          {issuedInvoiceCount > 0 ? (
            <>
              Impossible : ce garage a émis {issuedInvoiceCount} facture
              {issuedInvoiceCount > 1 ? "s" : ""}. La conservation légale interdit de
              les effacer. Désactivez le compte ci-dessus — son espace passera en
              lecture seule et ses factures resteront consultables.
            </>
          ) : (
            <>Suppression indisponible pour ce garage.</>
          )}
        </p>
      </div>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirm("");
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="destructive">
          <Trash2 aria-hidden />
          Supprimer le garage
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Supprimer « {garageName} » ?</DialogTitle>
          <DialogDescription>
            Le garage, son compte de connexion, ses clients, ses prestations et ses
            brouillons seront effacés définitivement. Cette action est irréversible.
          </DialogDescription>
        </DialogHeader>

        <AuthFormMessage>{state.error}</AuthFormMessage>

        <form action={formAction} className="space-y-6">
          <input type="hidden" name="garageId" value={garageId} />

          <Field data-invalid={Boolean(state.fieldErrors?.confirmName)}>
            <FieldLabel htmlFor="confirmName">
              Saisissez le nom du garage pour confirmer
            </FieldLabel>
            <Input
              id="confirmName"
              name="confirmName"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="off"
              required
            />
            <FieldDescription>
              Attendu : <span className="font-medium">{garageName}</span>
            </FieldDescription>
            <FieldError>{state.fieldErrors?.confirmName?.[0]}</FieldError>
          </Field>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={pending || confirm.trim() !== garageName.trim()}
            >
              {pending ? "Suppression…" : "Supprimer définitivement"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
