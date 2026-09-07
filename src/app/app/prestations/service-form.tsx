"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AuthFormMessage } from "@/components/auth/auth-form-message";
import { saveServiceAction, type CatalogFormState } from "@/lib/catalog/actions";
import type { CatalogService } from "@/lib/catalog/types";
import { getLocale, type LocaleCode } from "@/lib/locale";

const INITIAL: CatalogFormState = {};

/**
 * Fiche d'une prestation du catalogue — création et modification.
 *
 * Les taux de TVA proposés viennent de `LocaleConfig.vatRates`, jamais d'une
 * liste écrite ici : ajouter un pays ne demande pas de rouvrir cet écran. Le
 * schéma zod, lui, accepte 0–100 comme la contrainte SQL — un catalogue
 * existant doit rester enregistrable le jour où un taux disparaît d'une
 * locale.
 *
 * Ce qui est saisi ici n'est qu'un POINT DE DÉPART : choisir la prestation
 * dans l'éditeur pré-remplit la ligne, qui reste ensuite modifiable. Le
 * catalogue ne contraint aucune facture.
 */
export function ServiceForm({
  service,
  localeCode,
  canWrite,
}: {
  /** `null` en création. */
  service: CatalogService | null;
  localeCode: LocaleCode;
  canWrite: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveServiceAction, INITIAL);
  const router = useRouter();
  const locale = getLocale(localeCode);
  const dernier = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!state.savedAt || state.savedAt === dernier.current) return;
    dernier.current = state.savedAt;

    toast.success(service ? "Prestation enregistrée." : "Prestation ajoutée au catalogue.");
    if (!service && state.id) router.replace(`/app/prestations/${state.id}`);
    router.refresh();
  }, [state.savedAt, state.id, service, router]);

  const erreurs = state.fieldErrors ?? {};
  const tauxParDefaut = service?.defaultVatRate ?? locale.defaultVatRate;

  return (
    <form action={formAction} className="space-y-6">
      {service ? <input type="hidden" name="serviceId" value={service.id} /> : null}

      <AuthFormMessage>{state.error}</AuthFormMessage>

      <div className="grid gap-4 sm:grid-cols-6">
        <Field className="sm:col-span-6" data-invalid={Boolean(erreurs.label) || undefined}>
          <FieldLabel htmlFor="label">Libellé</FieldLabel>
          <Input
            id="label"
            name="label"
            defaultValue={service?.label ?? ""}
            placeholder="Vidange + filtre à huile"
            autoComplete="off"
            disabled={!canWrite}
            required
          />
          <FieldDescription>
            C&apos;est la désignation qui apparaîtra sur la facture. Elle y restera
            modifiable.
          </FieldDescription>
          <FieldError>{erreurs.label?.[0]}</FieldError>
        </Field>

        <Field
          className="sm:col-span-2"
          data-invalid={Boolean(erreurs.default_unit) || undefined}
        >
          <FieldLabel htmlFor="default_unit">Unité</FieldLabel>
          <Input
            id="default_unit"
            name="default_unit"
            defaultValue={service?.defaultUnit ?? "U"}
            placeholder="U"
            disabled={!canWrite}
            required
          />
          <FieldDescription>U, H, L, kg…</FieldDescription>
          <FieldError>{erreurs.default_unit?.[0]}</FieldError>
        </Field>

        <Field
          className="sm:col-span-2"
          data-invalid={Boolean(erreurs.default_price_ht) || undefined}
        >
          <FieldLabel htmlFor="default_price_ht">Prix unitaire HT</FieldLabel>
          <Input
            id="default_price_ht"
            name="default_price_ht"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            defaultValue={service?.defaultPriceHt ?? 0}
            disabled={!canWrite}
            required
          />
          <FieldError>{erreurs.default_price_ht?.[0]}</FieldError>
        </Field>

        <Field
          className="sm:col-span-2"
          data-invalid={Boolean(erreurs.default_vat_rate) || undefined}
        >
          <FieldLabel htmlFor="default_vat_rate">Taux de TVA</FieldLabel>
          {/* `<select>` natif : les taux viennent de la locale, jamais d'une
              liste écrite en dur ici. */}
          <select
            id="default_vat_rate"
            name="default_vat_rate"
            defaultValue={String(tauxParDefaut)}
            disabled={!canWrite}
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
          >
            {locale.vatRates.map((rate) => (
              <option key={rate.rate} value={rate.rate}>
                {rate.label}
              </option>
            ))}
            {/* Un taux hérité qui ne figure plus dans la locale reste
                sélectionnable : sinon la prestation changerait de taux au
                premier enregistrement, en silence. */}
            {locale.vatRates.some((rate) => rate.rate === tauxParDefaut) ? null : (
              <option value={tauxParDefaut}>{tauxParDefaut} % — taux hérité</option>
            )}
          </select>
          <FieldError>{erreurs.default_vat_rate?.[0]}</FieldError>
        </Field>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !canWrite}>
          <Save aria-hidden />
          {pending ? "Enregistrement…" : service ? "Enregistrer" : "Ajouter au catalogue"}
        </Button>
      </div>
    </form>
  );
}
