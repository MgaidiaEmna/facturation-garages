"use client";

import { useActionState } from "react";
import Link from "next/link";
import { LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AuthFormMessage } from "@/components/auth/auth-form-message";
import { signInAction, type AuthFormState } from "@/lib/auth/actions";

const INITIAL: AuthFormState = {};

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(signInAction, INITIAL);

  return (
    <form action={formAction} className="space-y-6">
      <AuthFormMessage>{state.error}</AuthFormMessage>

      {next ? <input type="hidden" name="next" value={next} /> : null}

      <FieldGroup>
        <Field data-invalid={Boolean(state.fieldErrors?.email)}>
          <FieldLabel htmlFor="email">Adresse e-mail</FieldLabel>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            autoFocus
            required
            aria-invalid={Boolean(state.fieldErrors?.email)}
          />
          <FieldError>{state.fieldErrors?.email?.[0]}</FieldError>
        </Field>

        <Field data-invalid={Boolean(state.fieldErrors?.password)}>
          <FieldLabel htmlFor="password">Mot de passe</FieldLabel>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={Boolean(state.fieldErrors?.password)}
          />
          <FieldError>{state.fieldErrors?.password?.[0]}</FieldError>
        </Field>
      </FieldGroup>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        <LogIn aria-hidden />
        {pending ? "Connexion…" : "Se connecter"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        Pas encore de compte ?{" "}
        <Link href="/signup" className="font-medium text-foreground underline underline-offset-4">
          Essayer gratuitement
        </Link>
      </p>
    </form>
  );
}
