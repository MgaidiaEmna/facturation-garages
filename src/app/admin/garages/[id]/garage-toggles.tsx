"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { setGarageActiveAction, setLogoManagementAction } from "@/lib/admin/actions";

/**
 * Interrupteurs d'état du garage.
 *
 * L'affichage est optimiste — l'interrupteur bascule tout de suite — mais il
 * REVIENT en arrière si le serveur refuse. Un interrupteur qui reste dans la
 * position demandée alors que rien n'a changé en base est pire que pas
 * d'interrupteur du tout : l'administrateur croirait avoir coupé un accès
 * toujours ouvert.
 */
function ToggleField({
  id,
  label,
  description,
  checked,
  onToggle,
}: {
  id: string;
  label: string;
  description: React.ReactNode;
  checked: boolean;
  onToggle: (next: boolean) => Promise<{ error?: string }>;
}) {
  const [value, setValue] = useState(checked);
  const [pending, startTransition] = useTransition();

  function handleChange(next: boolean) {
    const previous = value;
    setValue(next);

    startTransition(async () => {
      const result = await onToggle(next);
      if (result?.error) {
        setValue(previous);
        toast.error(result.error);
      }
    });
  }

  return (
    <Field orientation="horizontal">
      <Switch
        id={id}
        checked={value}
        disabled={pending}
        onCheckedChange={handleChange}
        aria-describedby={`${id}-description`}
      />
      <FieldLabel htmlFor={id} className="font-normal">
        {label}
        <FieldDescription id={`${id}-description`}>{description}</FieldDescription>
      </FieldLabel>
    </Field>
  );
}

export function GarageToggles({
  garageId,
  isActive,
  logoManagementEnabled,
}: {
  garageId: string;
  isActive: boolean;
  logoManagementEnabled: boolean;
}) {
  return (
    <div className="space-y-6">
      <ToggleField
        id="is_active"
        label="Compte actif"
        description={
          <>
            Désactivé, le garage se connecte encore mais son espace passe en lecture
            seule : plus aucune saisie, plus aucune facture émise. Ses données et
            ses factures restent intactes.
          </>
        }
        checked={isActive}
        onToggle={(next) => setGarageActiveAction(garageId, next)}
      />

      <ToggleField
        id="logo_management_enabled"
        label="Option premium — gestion des logos"
        description={
          <>
            Débloque la bibliothèque de logos et le choix d&apos;un logo par facture.
            Ce n&apos;est pas un rôle : le reste des droits du garage ne change pas.
          </>
        }
        checked={logoManagementEnabled}
        onToggle={(next) => setLogoManagementAction(garageId, next)}
      />
    </div>
  );
}
