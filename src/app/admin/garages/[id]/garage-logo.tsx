"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, Star, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AuthFormMessage } from "@/components/auth/auth-form-message";
import { SectionHeader } from "@/components/page-header";
import { LogoFileField } from "@/components/logos/logo-file-field";
import {
  deleteLogoForGarageAction,
  setDefaultLogoForGarageAction,
  uploadLogoForGarageAction,
} from "@/lib/logos/actions";
import type { Logo } from "@/lib/logos/types";
import { cn } from "@/lib/utils";

/**
 * Le ou les logos d'un garage, vus depuis sa fiche.
 *
 * C'est le SEUL chemin pour un garage standard : il ne gère pas ses logos
 * lui-même, l'administrateur les lui assigne. Un garage « premium » a en plus
 * sa propre page — cette carte reste alors utile pour dépanner.
 *
 * L'administrateur est autorisé par les policies (`is_admin()` dans le
 * `with check` du bucket) : rien n'est contourné ici, c'est la même barrière
 * qui répond « oui » à quelqu'un d'autre.
 */
export function GarageLogo({
  garageId,
  garageName,
  logos,
  premium,
}: {
  garageId: string;
  garageName: string;
  logos: Logo[];
  premium: boolean;
}) {
  const [pending, startAction] = useTransition();
  const [erreur, setErreur] = useState<string | undefined>(undefined);
  const formulaire = useRef<HTMLFormElement>(null);
  const router = useRouter();

  function televerser(formData: FormData) {
    startAction(async () => {
      const result = await uploadLogoForGarageAction(garageId, formData);
      if (result.error) {
        setErreur(result.error);
        return;
      }
      if (result.fieldErrors) {
        setErreur(Object.values(result.fieldErrors)[0]?.[0] ?? "Fichier refusé.");
        return;
      }
      setErreur(undefined);
      toast.success("Logo enregistré.");
      formulaire.current?.reset();
      router.refresh();
    });
  }

  function definirDefaut(logoId: string) {
    startAction(async () => {
      const result = await setDefaultLogoForGarageAction(garageId, logoId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Logo par défaut mis à jour.");
      router.refresh();
    });
  }

  function supprimer(logoId: string) {
    startAction(async () => {
      const result = await deleteLogoForGarageAction(garageId, logoId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Logo retiré.");
      router.refresh();
    });
  }

  return (
    <section className="space-y-4">
      <SectionHeader
        title="Logo"
        description={
          premium
            ? "Ce garage gère lui-même sa bibliothèque. Vous pouvez tout de même y ajouter ou en retirer un."
            : "Ce garage ne gère pas ses logos : celui que vous posez ici apparaît sur ses factures."
        }
      />

      <AuthFormMessage>{erreur}</AuthFormMessage>

      {logos.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {logos.map((logo) => (
            <div
              key={logo.id}
              className={cn(
                "flex flex-col gap-2 rounded-xl border bg-card p-3",
                logo.isDefault ? "border-primary/40 ring-1 ring-primary/20" : null,
              )}
            >
              <div className="flex h-20 items-center justify-center overflow-hidden rounded bg-white ring-1 ring-zinc-200">
                {logo.signedUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logo.signedUrl}
                    alt={logo.label ?? garageName}
                    className="max-h-16 max-w-full object-contain"
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">Indisponible</span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-xs font-medium">
                  {logo.label ?? "Sans nom"}
                </span>
                {logo.isDefault ? (
                  <Badge variant="secondary" className="text-[10px]">
                    Par défaut
                  </Badge>
                ) : null}
                {logo.deletable ? null : (
                  <Badge variant="outline" className="gap-1 text-[10px]">
                    <Lock className="size-2.5" aria-hidden />
                    Émis
                  </Badge>
                )}
              </div>

              <div className="flex items-center justify-end gap-1">
                {logo.isDefault ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => definirDefaut(logo.id)}
                    disabled={pending}
                    className="font-medium text-primary hover:bg-primary/5 hover:text-primary"
                  >
                    <Star aria-hidden />
                    Par défaut
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => supprimer(logo.id)}
                  disabled={pending || !logo.deletable}
                  title={
                    logo.deletable
                      ? "Retirer ce logo"
                      : "Ce logo figure sur des factures émises : il ne peut plus être retiré."
                  }
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 aria-hidden />
                  <span className="sr-only">Retirer {logo.label ?? "ce logo"}</span>
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Aucun logo. Les factures de ce garage portent sa dénomination en tête —
          ce qui est parfaitement conforme.
        </p>
      )}

      <form ref={formulaire} action={televerser} className="grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <LogoFileField id="logo-file" />
        </div>

        <Field>
          <FieldLabel htmlFor="logo-label">Nom</FieldLabel>
          <Input id="logo-label" name="label" placeholder="Logo principal" />
          <Button type="submit" disabled={pending} className="mt-2">
            <Upload aria-hidden />
            {pending ? "Téléversement…" : "Téléverser"}
          </Button>
        </Field>
      </form>
    </section>
  );
}
