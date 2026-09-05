"use client";

import { useActionState, useState } from "react";
import { Copy, KeyRound, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { AuthFormMessage } from "@/components/auth/auth-form-message";
import {
  resetGaragePasswordAction,
  type ResetPasswordState,
} from "@/lib/auth/admin-actions";

const INITIAL: ResetPasswordState = {};

/**
 * Réinitialisation du mot de passe d'un compte garage.
 *
 * Le mot de passe temporaire généré est affiché ICI, et nulle part ailleurs :
 * ni dans les journaux, ni dans la notification envoyée au journal
 * d'administration. Il n'est pas relisible — refermer la boîte de dialogue
 * sans l'avoir transmis oblige à en générer un autre. C'est voulu : un secret
 * qu'on peut retrouver plus tard est un secret qui traîne.
 *
 * À ne pas confondre avec le mot de passe que le garage choisira ensuite,
 * lui totalement inconnu de l'administrateur.
 */
export function ResetPasswordDialog({
  userId,
  garageName,
}: {
  userId: string;
  garageName: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(resetGaragePasswordAction, INITIAL);

  const password = state.temporaryPassword;

  async function copyPassword() {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      toast.success("Mot de passe temporaire copié.");
    } catch {
      toast.error("Copie impossible : sélectionnez le texte à la main.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <KeyRound aria-hidden />
          Réinitialiser
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Réinitialiser le mot de passe</DialogTitle>
          <DialogDescription>
            {password
              ? `Transmettez ce mot de passe à « ${state.targetLabel ?? garageName} ».`
              : `Un mot de passe temporaire sera généré pour « ${garageName} ». Le mot de passe actuel cessera immédiatement de fonctionner.`}
          </DialogDescription>
        </DialogHeader>

        <AuthFormMessage>{state.error}</AuthFormMessage>

        {password ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md border bg-muted/50 px-3 py-2 font-mono text-sm tracking-wide">
                {password}
              </code>
              <Button type="button" variant="outline" size="icon" onClick={copyPassword}>
                <Copy aria-hidden />
                <span className="sr-only">Copier le mot de passe temporaire</span>
              </Button>
            </div>

            <Alert>
              <ShieldAlert aria-hidden />
              <AlertTitle>Affiché une seule fois</AlertTitle>
              <AlertDescription>
                Il n&apos;est stocké nulle part et ne pourra pas être réaffiché. Le
                garage devra le remplacer dès sa prochaine connexion.
              </AlertDescription>
            </Alert>

            <DialogFooter>
              <Button type="button" onClick={() => setOpen(false)}>
                J&apos;ai transmis le mot de passe
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form action={formAction}>
            <input type="hidden" name="userId" value={userId} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Génération…" : "Générer un mot de passe temporaire"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
