"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AuthFormMessage } from "@/components/auth/auth-form-message";
import { saveClientAction, type CatalogFormState } from "@/lib/catalog/actions";
import type { CatalogClient } from "@/lib/catalog/types";

const INITIAL: CatalogFormState = {};

/**
 * Fiche d'un client du carnet — création et modification.
 *
 * Un seul formulaire pour les deux : `clientId` en champ caché décide. Deux
 * gabarits jumeaux finiraient par diverger sur un champ, et c'est toujours
 * celui qu'on avait oublié de recopier qui manque au moment de facturer.
 *
 * Seul le nom est exigé. Le reste se complète au fil des factures : imposer
 * l'adresse dès la création pousse à taper « à renseigner », ce qui finit
 * imprimé sur une facture.
 */
export function ClientForm({
  client,
  canWrite,
}: {
  /** `null` en création. */
  client: CatalogClient | null;
  canWrite: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveClientAction, INITIAL);
  const router = useRouter();
  const dernier = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!state.savedAt || state.savedAt === dernier.current) return;
    dernier.current = state.savedAt;

    toast.success(client ? "Client enregistré." : "Client ajouté au carnet.");
    // Après une création, on bascule sur la fiche : l'écran suivant doit être
    // celui de ce qu'on vient d'écrire, pas un formulaire vide qui laisse
    // douter que l'enregistrement a eu lieu.
    if (!client && state.id) router.replace(`/app/clients/${state.id}`);
    router.refresh();
  }, [state.savedAt, state.id, client, router]);

  const erreurs = state.fieldErrors ?? {};

  return (
    <form action={formAction} className="space-y-6">
      {client ? <input type="hidden" name="clientId" value={client.id} /> : null}

      <AuthFormMessage>{state.error}</AuthFormMessage>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field className="sm:col-span-2" data-invalid={Boolean(erreurs.name) || undefined}>
          <FieldLabel htmlFor="name">Nom ou raison sociale</FieldLabel>
          <Input
            id="name"
            name="name"
            defaultValue={client?.name ?? ""}
            placeholder="Dupont SARL"
            autoComplete="off"
            disabled={!canWrite}
            required
          />
          <FieldError>{erreurs.name?.[0]}</FieldError>
        </Field>

        <Field className="sm:col-span-2" data-invalid={Boolean(erreurs.address) || undefined}>
          <FieldLabel htmlFor="address">Adresse</FieldLabel>
          <Textarea
            id="address"
            name="address"
            rows={3}
            defaultValue={client?.address ?? ""}
            placeholder={"12 rue des Lilas\n69003 Lyon"}
            disabled={!canWrite}
          />
          <FieldError>{erreurs.address?.[0]}</FieldError>
        </Field>

        <Field data-invalid={Boolean(erreurs.phone) || undefined}>
          <FieldLabel htmlFor="phone">Téléphone</FieldLabel>
          <Input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={client?.phone ?? ""}
            disabled={!canWrite}
          />
          <FieldError>{erreurs.phone?.[0]}</FieldError>
        </Field>

        <Field data-invalid={Boolean(erreurs.email) || undefined}>
          <FieldLabel htmlFor="email">Adresse e-mail</FieldLabel>
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={client?.email ?? ""}
            disabled={!canWrite}
          />
          <FieldError>{erreurs.email?.[0]}</FieldError>
        </Field>

        <Field data-invalid={Boolean(erreurs.vat_number) || undefined}>
          <FieldLabel htmlFor="vat_number">N° de TVA intracommunautaire</FieldLabel>
          <Input
            id="vat_number"
            name="vat_number"
            defaultValue={client?.vatNumber ?? ""}
            placeholder="FR12345678901"
            disabled={!canWrite}
          />
          <FieldDescription>
            Obligatoire sur la facture en B2B intracommunautaire. Un client étranger
            porte le préfixe de son pays.
          </FieldDescription>
          <FieldError>{erreurs.vat_number?.[0]}</FieldError>
        </Field>

        <Field data-invalid={Boolean(erreurs.siret) || undefined}>
          <FieldLabel htmlFor="siret">SIRET</FieldLabel>
          <Input
            id="siret"
            name="siret"
            defaultValue={client?.siret ?? ""}
            placeholder="812 345 678 00012"
            disabled={!canWrite}
          />
          <FieldDescription>14 chiffres, pour un client français.</FieldDescription>
          <FieldError>{erreurs.siret?.[0]}</FieldError>
        </Field>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !canWrite}>
          <Save aria-hidden />
          {pending ? "Enregistrement…" : client ? "Enregistrer" : "Ajouter au carnet"}
        </Button>
      </div>
    </form>
  );
}
