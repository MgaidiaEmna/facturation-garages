"use client";

import { useActionState, useEffect, useRef } from "react";
import { Save } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AuthFormMessage } from "@/components/auth/auth-form-message";
import { updateGarageAction, type GarageFormState } from "@/lib/admin/actions";
import type { GarageRecord } from "@/lib/admin/queries";
import { getLocale } from "@/lib/locale";

const INITIAL: GarageFormState = {};

/**
 * Formulaire de fiche garage.
 *
 * Les champs d'identité du vendeur ne sont pas écrits en dur : ils sont
 * dépliés depuis `LocaleConfig.sellerIdentityFields`. C'est la même liste qui
 * décide de ce qui manque (`missingSellerFields`) et de ce qu'imprimera la
 * facture — un champ ajouté à une locale apparaît ici sans qu'on touche à cet
 * écran.
 *
 * Aucun champ d'identité n'est marqué `required` au sens HTML, sauf la
 * dénomination : une fiche incomplète doit pouvoir être enregistrée. Bloquer
 * la saisie ferait perdre le travail déjà fait à l'administrateur qui attend
 * encore le SIRET de son client.
 */
export function GarageForm({ garage }: { garage: GarageRecord }) {
  const [state, formAction, pending] = useActionState(updateGarageAction, INITIAL);
  const locale = getLocale(garage.locale);
  const lastSaved = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (state.savedAt && state.savedAt !== lastSaved.current) {
      lastSaved.current = state.savedAt;
      toast.success("Fiche enregistrée.");
    }
  }, [state.savedAt]);

  return (
    <form action={formAction} className="space-y-8">
      <input type="hidden" name="garageId" value={garage.id} />

      <AuthFormMessage>{state.error}</AuthFormMessage>

      {/* --- Identité légale du vendeur --- */}
      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Identité du vendeur</h2>
          <p className="text-sm text-muted-foreground">
            Ces mentions figurent sur chaque facture émise par le garage.
            L&apos;astérisque marque celles qu&apos;exige la réglementation{" "}
            {locale.label} — la fiche s&apos;enregistre même incomplète.
          </p>
        </div>

        <FieldGroup>
          {locale.sellerIdentityFields.map((field) => {
            const error = state.fieldErrors?.[field.key]?.[0];
            const value = garage.identity[field.key] ?? "";

            return (
              <Field key={field.key} data-invalid={Boolean(error)}>
                <FieldLabel htmlFor={field.key}>
                  {field.label}
                  {field.required ? (
                    <span aria-hidden className="text-destructive">
                      {" "}
                      *
                    </span>
                  ) : null}
                </FieldLabel>

                {field.key === "address" ? (
                  <Textarea
                    id={field.key}
                    name={field.key}
                    defaultValue={value}
                    rows={3}
                    aria-invalid={Boolean(error)}
                  />
                ) : (
                  <Input
                    id={field.key}
                    name={field.key}
                    defaultValue={value}
                    required={field.key === "name"}
                    aria-invalid={Boolean(error)}
                  />
                )}

                {field.hint ? <FieldDescription>{field.hint}</FieldDescription> : null}
                <FieldError>{error}</FieldError>
              </Field>
            );
          })}
        </FieldGroup>
      </section>

      {/* --- Contact et coordonnées bancaires --- */}
      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Contact et règlement</h2>
          <p className="text-sm text-muted-foreground">
            L&apos;adresse e-mail de contact est reprise sur les factures. Elle est
            indépendante de l&apos;adresse de connexion du compte.
          </p>
        </div>

        <FieldGroup>
          <Field data-invalid={Boolean(state.fieldErrors?.phone)}>
            <FieldLabel htmlFor="phone">Téléphone</FieldLabel>
            <Input id="phone" name="phone" type="tel" defaultValue={garage.phone ?? ""} />
            <FieldError>{state.fieldErrors?.phone?.[0]}</FieldError>
          </Field>

          <Field data-invalid={Boolean(state.fieldErrors?.email)}>
            <FieldLabel htmlFor="email">E-mail de contact</FieldLabel>
            <Input id="email" name="email" type="email" defaultValue={garage.email ?? ""} />
            <FieldError>{state.fieldErrors?.email?.[0]}</FieldError>
          </Field>

          <Field data-invalid={Boolean(state.fieldErrors?.iban)}>
            <FieldLabel htmlFor="iban">IBAN</FieldLabel>
            <Input id="iban" name="iban" defaultValue={garage.iban ?? ""} />
            <FieldDescription>
              Affiché sur la facture pour un règlement par virement.
            </FieldDescription>
            <FieldError>{state.fieldErrors?.iban?.[0]}</FieldError>
          </Field>

          <Field data-invalid={Boolean(state.fieldErrors?.bic)}>
            <FieldLabel htmlFor="bic">BIC</FieldLabel>
            <Input id="bic" name="bic" defaultValue={garage.bic ?? ""} />
            <FieldError>{state.fieldErrors?.bic?.[0]}</FieldError>
          </Field>
        </FieldGroup>
      </section>

      {/* --- Réglages de facturation --- */}
      <section className="space-y-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">Réglages de facturation</h2>
          <p className="text-sm text-muted-foreground">
            Repris par défaut sur chaque nouvelle facture du garage.
          </p>
        </div>

        <FieldGroup>
          <Field orientation="horizontal">
            <Switch id="vat_exempt" name="vat_exempt" defaultChecked={garage.vatExempt} />
            <FieldLabel htmlFor="vat_exempt" className="font-normal">
              Franchise en base de TVA
              <FieldDescription>
                La facture n&apos;affiche alors aucune TVA et porte la mention
                « {locale.legalMentions.vatExemptNotice} ».
              </FieldDescription>
            </FieldLabel>
          </Field>

          <Field data-invalid={Boolean(state.fieldErrors?.payment_term_days)}>
            <FieldLabel htmlFor="payment_term_days">Délai de règlement (jours)</FieldLabel>
            <Input
              id="payment_term_days"
              name="payment_term_days"
              type="number"
              min={0}
              max={365}
              step={1}
              defaultValue={garage.paymentTermDays}
              required
            />
            <FieldError>{state.fieldErrors?.payment_term_days?.[0]}</FieldError>
          </Field>

          <Field data-invalid={Boolean(state.fieldErrors?.late_payment_penalty_rate)}>
            <FieldLabel htmlFor="late_payment_penalty_rate">
              Taux des pénalités de retard (%)
            </FieldLabel>
            <Input
              id="late_payment_penalty_rate"
              name="late_payment_penalty_rate"
              type="number"
              min={0}
              step={0.01}
              defaultValue={garage.latePaymentPenaltyRate}
              required
            />
            <FieldDescription>
              Mention obligatoire : le taux doit figurer sur la facture.
            </FieldDescription>
            <FieldError>{state.fieldErrors?.late_payment_penalty_rate?.[0]}</FieldError>
          </Field>

          <Field data-invalid={Boolean(state.fieldErrors?.recovery_indemnity)}>
            <FieldLabel htmlFor="recovery_indemnity">
              Indemnité forfaitaire de recouvrement
            </FieldLabel>
            <Input
              id="recovery_indemnity"
              name="recovery_indemnity"
              type="number"
              min={0}
              step={0.01}
              defaultValue={garage.recoveryIndemnity}
              required
            />
            <FieldDescription>
              Fixée à 40 € par les articles L441-10 et D441-5 du Code de commerce.
              Ne la modifiez que sur avis de votre conseil.
            </FieldDescription>
            <FieldError>{state.fieldErrors?.recovery_indemnity?.[0]}</FieldError>
          </Field>
        </FieldGroup>
      </section>

      <Button type="submit" disabled={pending}>
        <Save aria-hidden />
        {pending ? "Enregistrement…" : "Enregistrer la fiche"}
      </Button>
    </form>
  );
}
