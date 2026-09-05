import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { requireUser } from "@/lib/auth/session";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = {
  title: "Changer de mot de passe — Facturation multi-garages",
};

/**
 * Changement de mot de passe, obligatoire ou volontaire.
 *
 * Obligatoire quand `must_change_password` est posé : compte créé par
 * l'administrateur, ou mot de passe réinitialisé par lui. Dans les deux cas
 * un tiers connaît le mot de passe en cours — il ne doit pas survivre à la
 * première connexion.
 *
 * Le drapeau ne se lève qu'en changeant réellement de mot de passe : un
 * UPDATE direct dessus est refusé par `profiles_guard_trg`, cette page n'est
 * donc pas contournable en modifiant son propre profil.
 */
export default async function ChangePasswordPage() {
  const context = await requireUser();
  const forced = context.access.mustChangePassword;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          {forced ? "Choisissez votre mot de passe" : "Changer de mot de passe"}
        </CardTitle>
        <CardDescription>
          {context.email ? `Compte ${context.email}.` : null}{" "}
          {forced
            ? "Cette étape est obligatoire avant d'accéder à votre espace."
            : "Vous serez averti·e si vous devez vous reconnecter."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {forced ? (
          <Alert>
            <ShieldCheck aria-hidden />
            <AlertTitle>Pourquoi maintenant ?</AlertTitle>
            <AlertDescription>
              Le mot de passe actuel a été fixé par l&apos;administrateur, qui le
              connaît. En choisir un nouveau le rend connu de vous seul·e — nous ne
              le stockons jamais en clair et il n&apos;est jamais transmis à
              l&apos;administrateur.
            </AlertDescription>
          </Alert>
        ) : null}

        <ChangePasswordForm />

        <SignOutButton variant="ghost" />
      </CardContent>
    </Card>
  );
}
