"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Lock, Star, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { LogoFileField } from "@/components/logos/logo-file-field";
import { Input } from "@/components/ui/input";
import { AuthFormMessage } from "@/components/auth/auth-form-message";
import {
  deleteLogoAction,
  setDefaultLogoAction,
  uploadLogoAction,
  type LogoFormState,
} from "@/lib/logos/actions";
import type { Logo } from "@/lib/logos/types";
import { cn } from "@/lib/utils";

const INITIAL: LogoFormState = {};

/**
 * Bibliothèque de logos d'un garage « premium ».
 *
 * Le formulaire de téléversement est un vrai `<form action={…}>` : il
 * fonctionne sans JavaScript, comme le reste des chemins d'écriture de cette
 * application. Les actions par logo (défaut, suppression) sont des boutons,
 * donc hors de portée d'un navigateur sans script — c'est assumé, elles ne
 * sont pas indispensables à la facturation.
 */
export function LogoLibrary({
  logos,
  canWrite,
}: {
  logos: Logo[];
  canWrite: boolean;
}) {
  const [state, formAction, pending] = useActionState(uploadLogoAction, INITIAL);
  const router = useRouter();
  const formulaire = useRef<HTMLFormElement>(null);
  const dernier = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!state.savedAt || state.savedAt === dernier.current) return;
    dernier.current = state.savedAt;
    toast.success("Logo ajouté à la bibliothèque.");
    formulaire.current?.reset();
    router.refresh();
  }, [state.savedAt, router]);

  const erreurs = state.fieldErrors ?? {};

  return (
    <div className="space-y-8">
      <Card>
        <CardContent>
          <form ref={formulaire} action={formAction} className="space-y-4">
            <AuthFormMessage>{state.error}</AuthFormMessage>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <LogoFileField disabled={!canWrite} />
                {/* Le serveur peut refuser pour une raison que le navigateur
                    n'a pas vue — un fichier renommé, par exemple. */}
                {erreurs.file?.[0] ? (
                  <p role="alert" className="mt-1 text-sm text-destructive">
                    {erreurs.file[0]}
                  </p>
                ) : null}
              </div>

              <Field data-invalid={Boolean(erreurs.label) || undefined}>
                <FieldLabel htmlFor="label">Nom du logo</FieldLabel>
                <Input
                  id="label"
                  name="label"
                  placeholder="Logo principal"
                  disabled={!canWrite}
                />
                <FieldDescription>
                  Un repère pour vous. Il n&apos;apparaît pas sur la facture.
                </FieldDescription>
                <FieldError>{erreurs.label?.[0]}</FieldError>
              </Field>
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={pending || !canWrite}>
                <Upload aria-hidden />
                {pending ? "Téléversement…" : "Ajouter ce logo"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {logos.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {logos.map((logo) => (
            <LogoCard key={logo.id} logo={logo} canWrite={canWrite} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Une vignette de la bibliothèque, avec ses deux actions. */
function LogoCard({ logo, canWrite }: { logo: Logo; canWrite: boolean }) {
  const [pending, startAction] = useTransition();
  const [supprime, setSupprime] = useState(false);
  const router = useRouter();

  function definirDefaut() {
    startAction(async () => {
      const result = await setDefaultLogoAction(logo.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Logo par défaut mis à jour.");
      router.refresh();
    });
  }

  function supprimer() {
    startAction(async () => {
      const result = await deleteLogoAction(logo.id);
      if (result.error) {
        // Le message vient du trigger quand une facture émise porte ce logo :
        // il explique pourquoi, on ne le reformule pas.
        toast.error(result.error);
        return;
      }
      setSupprime(true);
      toast.success("Logo retiré.");
      router.refresh();
    });
  }

  if (supprime) return null;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm",
        logo.isDefault ? "border-primary/40 ring-1 ring-primary/20" : null,
      )}
    >
      <div className="flex h-28 items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-zinc-200">
        {logo.signedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo.signedUrl}
            alt={logo.label ?? "Logo"}
            className="max-h-24 max-w-full object-contain"
          />
        ) : (
          <span className="text-xs text-muted-foreground">Aperçu indisponible</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate text-sm font-medium">{logo.label ?? "Sans nom"}</span>
        {logo.isDefault ? <Badge variant="secondary">Par défaut</Badge> : null}
        {logo.deletable ? null : (
          <Badge variant="outline" className="gap-1">
            <Lock className="size-3" aria-hidden />
            Sur des factures émises
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1">
        {logo.isDefault ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="size-3.5" aria-hidden />
            Appliqué par défaut
          </span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={definirDefaut}
            disabled={pending || !canWrite}
            className="font-medium text-primary hover:bg-primary/5 hover:text-primary"
          >
            <Star aria-hidden />
            Par défaut
          </Button>
        )}

        {/* Un logo porté par une facture émise ne se supprime pas :
            `logos_guard_trg` le refuserait. Le bouton le dit AVANT le clic
            plutôt que de présenter un refus — la règle vient de
            `logo_is_deletable()`, pas d'un calcul refait ici. */}
        <Button
          variant="ghost"
          size="sm"
          onClick={supprimer}
          disabled={pending || !canWrite || !logo.deletable}
          title={
            logo.deletable
              ? "Retirer ce logo de la bibliothèque"
              : "Ce logo figure sur des factures émises : il ne peut plus être retiré."
          }
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 aria-hidden />
          <span className="sr-only">Retirer {logo.label ?? "ce logo"}</span>
        </Button>
      </div>
    </div>
  );
}
