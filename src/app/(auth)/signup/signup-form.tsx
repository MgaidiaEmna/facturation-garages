"use client";

import { useActionState } from "react";
import Link from "next/link";
import { UserPlus } from "lucide-react";

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
import { signUpAction, type AuthFormState } from "@/lib/auth/actions";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";

const INITIAL: AuthFormState = {};

export function SignupForm() {
  const [state, formAction, pending] = useActionState(signUpAction, INITIAL);

  return (
    <form action={formAction} className="space-y-6">
      <AuthFormMessage>{state.error}</AuthFormMessage>

      <FieldGroup>
        <Field data-invalid={Boolean(state.fieldErrors?.garageName)}>
          <FieldLabel htmlFor="garageName">Nom du garage</FieldLabel>
          <Input
            id="garageName"
            name="garageName"
            autoComplete="organization"
            autoFocus
            required
            aria-invalid={Boolean(state.fieldErrors?.garageName)}
          />
          <FieldDescription>
            Il apparaîtra sur vos factures. L&apos;identité légale complète (SIRET, RCS,
            capital) sera renseignée ensuite.
          </FieldDescription>
          <FieldError>{state.fieldErrors?.garageName?.[0]}</FieldError>
        </Field>

        <Field data-invalid={Boolean(state.fieldErrors?.fullName)}>
          <FieldLabel htmlFor="fullName">Votre nom (facultatif)</FieldLabel>
          <Input id="fullName" name="fullName" autoComplete="name" />
          <FieldError>{state.fieldErrors?.fullName?.[0]}</FieldError>
        </Field>

        <Field data-invalid={Boolean(state.fieldErrors?.email)}>
          <FieldLabel htmlFor="email">Adresse e-mail</FieldLabel>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            aria-invalid={Boolean(state.fieldErrors?.email)}
          />
          <FieldDescription>
            Un lien de vérification y sera envoyé. Le compte reste inactif tant
            qu&apos;il n&apos;est pas ouvert.
          </FieldDescription>
          <FieldError>{state.fieldErrors?.email?.[0]}</FieldError>
        </Field>

        <Field data-invalid={Boolean(state.fieldErrors?.password)}>
          <FieldLabel htmlFor="password">Mot de passe</FieldLabel>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            required
            aria-invalid={Boolean(state.fieldErrors?.password)}
          />
          <FieldDescription>{PASSWORD_MIN_LENGTH} caractères minimum.</FieldDescription>
          <FieldError>{state.fieldErrors?.password?.[0]}</FieldError>
        </Field>

        <Field data-invalid={Boolean(state.fieldErrors?.passwordConfirm)}>
          <FieldLabel htmlFor="passwordConfirm">Confirmation du mot de passe</FieldLabel>
          <Input
            id="passwordConfirm"
            name="passwordConfirm"
            type="password"
            autoComplete="new-password"
            required
            aria-invalid={Boolean(state.fieldErrors?.passwordConfirm)}
          />
          <FieldError>{state.fieldErrors?.passwordConfirm?.[0]}</FieldError>
        </Field>
      </FieldGroup>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        <UserPlus aria-hidden />
        {pending ? "Création…" : "Créer mon compte"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Déjà inscrit ?{" "}
        <Link href="/login" className="font-medium text-primary underline underline-offset-4 hover:text-brand-dark">
          Se connecter
        </Link>
      </p>
    </form>
  );
}
