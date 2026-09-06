"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { BanknoteArrowUp } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AuthFormMessage } from "@/components/auth/auth-form-message";
import { registerPaymentAction, type PaymentFormState } from "@/lib/admin/actions";
import {
  PAYMENT_METHODS,
  QUICK_DURATIONS,
  type SubscriptionStatus,
} from "@/lib/admin/payment-schema";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const INITIAL: PaymentFormState = {};

/** Aujourd'hui au format `AAAA-MM-JJ`, en heure locale — pas en UTC, sinon la
 *  date proposée saute d'un jour en soirée pour un fuseau à l'est. */
function today(): string {
  const now = new Date();
  const mois = String(now.getMonth() + 1).padStart(2, "0");
  const jour = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mois}-${jour}`;
}

/**
 * Enregistrement d'un encaissement hors ligne.
 *
 * Tout est en éléments natifs — boutons radio, `<select>`, `<input type=date>` —
 * et non en composants Radix : le formulaire reste utilisable si le
 * JavaScript ne charge pas, comme les autres formulaires du projet. Le
 * JavaScript n'ajoute qu'un confort : il désactive la date personnalisée
 * quand une durée est choisie, ce qui évite au serveur d'avoir à refuser
 * « une durée ET une date ».
 *
 * Aucune échéance n'est calculée ici. La nouvelle date affichée après
 * l'enregistrement est celle que `register_payment()` a retenue.
 */
export function PaymentForm({
  garageId,
  status,
  currentEndDate,
}: {
  garageId: string;
  status: SubscriptionStatus;
  currentEndDate: string | null;
}) {
  const [state, formAction, pending] = useActionState(registerPaymentAction, INITIAL);
  const [duration, setDuration] = useState<string>("12");
  const formRef = useRef<HTMLFormElement>(null);
  const lastSaved = useRef<number | undefined>(undefined);

  const custom = duration === "";

  useEffect(() => {
    if (state.savedAt && state.savedAt !== lastSaved.current) {
      lastSaved.current = state.savedAt;
      toast.success(
        state.newEndDate
          ? `Paiement enregistré — abonnement jusqu'au ${formatDate(state.newEndDate)}.`
          : "Paiement enregistré.",
      );
      formRef.current?.reset();
      setDuration("12");
    }
  }, [state.savedAt, state.newEndDate]);

  return (
    <form ref={formRef} action={formAction} className="space-y-6">
      <input type="hidden" name="garageId" value={garageId} />

      <AuthFormMessage>{state.error}</AuthFormMessage>

      {/* --- Durée de prolongation --- */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Prolonger de</legend>
        <p className="text-sm text-muted-foreground">
          {status === "expired" || !currentEndDate
            ? "L'abonnement repart d'aujourd'hui."
            : `Ajouté au temps restant, à partir du ${formatDate(currentEndDate)}.`}
        </p>

        <div className="flex flex-wrap gap-2 pt-1">
          {QUICK_DURATIONS.map((months) => (
            <DurationChoice
              key={months}
              value={String(months)}
              label={`+ ${months} mois`}
              checked={duration === String(months)}
              onSelect={setDuration}
            />
          ))}
          <DurationChoice
            value=""
            label="Date personnalisée"
            checked={custom}
            onSelect={setDuration}
          />
        </div>
        <FieldError>{state.fieldErrors?.months?.[0]}</FieldError>
      </fieldset>

      <FieldGroup>
        <Field data-invalid={Boolean(state.fieldErrors?.endDate)}>
          <FieldLabel htmlFor="endDate">Nouvelle date de fin</FieldLabel>
          <Input
            id="endDate"
            name="endDate"
            type="date"
            min={today()}
            disabled={!custom}
            required={custom}
            className="sm:max-w-xs"
          />
          <FieldDescription>
            Utilisée seulement si « Date personnalisée » est sélectionné.
          </FieldDescription>
          <FieldError>{state.fieldErrors?.endDate?.[0]}</FieldError>
        </Field>
      </FieldGroup>

      {/* --- L'encaissement lui-même --- */}
      <div className="grid gap-4 border-t pt-6 sm:grid-cols-2">
        <Field data-invalid={Boolean(state.fieldErrors?.amount)}>
          <FieldLabel htmlFor="amount">Montant encaissé (€)</FieldLabel>
          <Input
            id="amount"
            name="amount"
            type="number"
            min={0}
            step={0.01}
            inputMode="decimal"
            placeholder="Facultatif"
          />
          <FieldError>{state.fieldErrors?.amount?.[0]}</FieldError>
        </Field>

        <Field data-invalid={Boolean(state.fieldErrors?.method)}>
          <FieldLabel htmlFor="method">Mode de règlement</FieldLabel>
          {/* `<select>` natif : il se soumet sans JavaScript, contrairement au
              composant Select de Radix. */}
          <select
            id="method"
            name="method"
            defaultValue="virement"
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {PAYMENT_METHODS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <FieldError>{state.fieldErrors?.method?.[0]}</FieldError>
        </Field>

        <Field data-invalid={Boolean(state.fieldErrors?.paidOn)}>
          <FieldLabel htmlFor="paidOn">Date du paiement</FieldLabel>
          <Input id="paidOn" name="paidOn" type="date" defaultValue={today()} required />
          <FieldDescription>
            La date réelle de l&apos;encaissement, pas celle de la saisie.
          </FieldDescription>
          <FieldError>{state.fieldErrors?.paidOn?.[0]}</FieldError>
        </Field>

        <Field data-invalid={Boolean(state.fieldErrors?.notes)} className="sm:col-span-2">
          <FieldLabel htmlFor="notes">Note (facultatif)</FieldLabel>
          <Textarea
            id="notes"
            name="notes"
            rows={2}
            placeholder="N° de chèque, référence de virement…"
          />
          <FieldError>{state.fieldErrors?.notes?.[0]}</FieldError>
        </Field>
      </div>

      <Button type="submit" disabled={pending}>
        <BanknoteArrowUp aria-hidden />
        {pending ? "Enregistrement…" : "Enregistrer le paiement"}
      </Button>
    </form>
  );
}

/**
 * Un choix de durée : un vrai bouton radio, masqué, dont le libellé porte
 * l'apparence. Le clavier et les lecteurs d'écran voient un groupe de radios
 * ordinaire ; l'anneau de focus suit l'élément réel grâce à `peer-focus`.
 */
function DurationChoice({
  value,
  label,
  checked,
  onSelect,
}: {
  value: string;
  label: string;
  checked: boolean;
  onSelect: (value: string) => void;
}) {
  return (
    <label
      className={cn(
        "cursor-pointer rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
        "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
        checked
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-card hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <input
        type="radio"
        name="months"
        value={value}
        checked={checked}
        onChange={() => onSelect(value)}
        className="sr-only"
      />
      {label}
    </label>
  );
}
