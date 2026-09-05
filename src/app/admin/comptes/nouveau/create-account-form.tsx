"use client";

import { useActionState } from "react";
import Link from "next/link";
import { CheckCircle2, UserPlus } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AuthFormMessage } from "@/components/auth/auth-form-message";
import {
  createGarageAccountAction,
  type CreateGarageAccountState,
} from "@/lib/auth/admin-actions";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";

const INITIAL: CreateGarageAccountState = {};

export function CreateAccountForm({ defaultEndDate }: { defaultEndDate: string }) {
  const [state, formAction, pending] = useActionState(createGarageAccountAction, INITIAL);

  if (state.createdGarageName && !state.error) {
    return (
      <Alert>
        <CheckCircle2 aria-hidden />
        <AlertTitle>Compte créé — « {state.createdGarageName} »</AlertTitle>
        <AlertDescription className="space-y-4">
          <p>
            Le garage peut se connecter immédiatement avec l&apos;adresse et le mot
            de passe que vous venez de fixer. Il devra en choisir un autre dès sa
            première connexion : vous n&apos;aurez alors plus connaissance du sien.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href="/admin/comptes">Voir les comptes</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/admin/comptes/nouveau">Créer un autre compte</Link>
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form action={formAction} className="space-y-6">
      <AuthFormMessage>{state.error}</AuthFormMessage>

      <FieldGroup>
        <Field data-invalid={Boolean(state.fieldErrors?.garageName)}>
          <FieldLabel htmlFor="garageName">Nom du garage</FieldLabel>
          <Input id="garageName" name="garageName" autoFocus required />
          <FieldError>{state.fieldErrors?.garageName?.[0]}</FieldError>
        </Field>

        <Field data-invalid={Boolean(state.fieldErrors?.fullName)}>
          <FieldLabel htmlFor="fullName">Contact (facultatif)</FieldLabel>
          <Input id="fullName" name="fullName" />
          <FieldError>{state.fieldErrors?.fullName?.[0]}</FieldError>
        </Field>

        <Field data-invalid={Boolean(state.fieldErrors?.email)}>
          <FieldLabel htmlFor="email">Adresse e-mail de connexion</FieldLabel>
          <Input id="email" name="email" type="email" required />
          <FieldDescription>
            Le compte est créé pré-confirmé : aucun e-mail de vérification n&apos;est
            envoyé, l&apos;accès est immédiat.
          </FieldDescription>
          <FieldError>{state.fieldErrors?.email?.[0]}</FieldError>
        </Field>

        <Field data-invalid={Boolean(state.fieldErrors?.password)}>
          <FieldLabel htmlFor="password">Mot de passe initial</FieldLabel>
          <Input
            id="password"
            name="password"
            type="text"
            autoComplete="off"
            minLength={PASSWORD_MIN_LENGTH}
            required
          />
          <FieldDescription>
            {PASSWORD_MIN_LENGTH} caractères minimum. Transmettez-le au garage : il
            devra le remplacer à sa première connexion, et vous n&apos;aurez plus
            accès au sien.
          </FieldDescription>
          <FieldError>{state.fieldErrors?.password?.[0]}</FieldError>
        </Field>

        <Field data-invalid={Boolean(state.fieldErrors?.subscriptionEndDate)}>
          <FieldLabel htmlFor="subscriptionEndDate">Abonnement jusqu&apos;au</FieldLabel>
          <Input
            id="subscriptionEndDate"
            name="subscriptionEndDate"
            type="date"
            defaultValue={defaultEndDate}
            required
          />
          <FieldDescription>
            L&apos;encaissement se fait hors ligne. Passée cette date, l&apos;espace
            du garage repasse en lecture seule.
          </FieldDescription>
          <FieldError>{state.fieldErrors?.subscriptionEndDate?.[0]}</FieldError>
        </Field>
      </FieldGroup>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          <UserPlus aria-hidden />
          {pending ? "Création…" : "Créer le compte"}
        </Button>
        <Button asChild type="button" variant="ghost">
          <Link href="/admin/comptes">Annuler</Link>
        </Button>
      </div>
    </form>
  );
}
