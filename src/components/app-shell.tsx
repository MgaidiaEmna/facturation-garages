import Link from "next/link";
import { Receipt } from "lucide-react";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { getLocale } from "@/lib/locale";

export interface NavItem {
  href: string;
  label: string;
}

/**
 * Coquille commune aux deux espaces authentifiés.
 *
 * Volontairement minimale en phase 2 : la navigation réelle arrive avec les
 * écrans qu'elle doit desservir (phases 3 et suivantes). Le disclaimer
 * réglementaire, lui, est présent dès maintenant — il doit rester visible
 * partout dans l'application.
 */
export function AppShell({
  spaceLabel,
  accountLabel,
  nav,
  children,
}: {
  spaceLabel: string;
  accountLabel: string;
  nav: NavItem[];
  children: React.ReactNode;
}) {
  const locale = getLocale();

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Receipt className="size-4" aria-hidden />
            {spaceLabel}
          </span>

          <nav aria-label="Navigation principale" className="flex flex-wrap items-center gap-4">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ms-auto flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {accountLabel}
            </span>
            <div className="w-auto [&_button]:w-auto">
              <SignOutButton variant="ghost" />
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">{children}</main>

      <footer className="mx-auto w-full max-w-5xl px-6 pb-10">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {locale.legalMentions.disclaimer}
        </p>
      </footer>
    </div>
  );
}
