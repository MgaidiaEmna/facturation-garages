"use client";

import { useActionState } from "react";
import { KeyRound } from "lucide-react";

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
import { changePasswordAction, type AuthFormState } from "@/lib/auth/actions";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";

const INITIAL: AuthFormState = {};

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePasswordAction, INITIAL);

  return (
    <form action={formAction} className="space-y-6">
      <AuthFormMessage>{state.error}</AuthFormMessage>

      <FieldGroup>
        <Field data-invalid={Boolean(state.fieldErrors?.password)}>
          <FieldLabel htmlFor="password">Nouveau mot de passe</FieldLabel>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            autoFocus
            required
            aria-invalid={Boolean(state.fieldErrors?.password)}
          />
          <FieldDescription>{PASSWORD_MIN_LENGTH} caractères minimum.</FieldDescription>
          <FieldError>{state.fieldErrors?.password?.[0]}</FieldError>
        </Field>

        <Field data-invalid={Boolean(state.fieldErrors?.passwordConfirm)}>
          <FieldLabel htmlFor="passwordConfirm">Confirmation</FieldLabel>
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
        <KeyRound aria-hidden />
        {pending ? "Enregistrement…" : "Enregistrer le nouveau mot de passe"}
      </Button>
    </form>
  );
}
