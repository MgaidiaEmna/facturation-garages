"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
}

/**
 * Navigation principale, posée sur le bandeau marine.
 *
 * L'onglet courant est déduit du chemin, pas passé en propriété : une page
 * de détail (`/admin/garages/[id]`) doit allumer « Garages » sans avoir à le
 * déclarer. La racine d'un espace (`/admin`, `/app`) est comparée en égalité
 * stricte — sinon elle resterait allumée sur toutes ses sous-pages.
 *
 * `aria-current="page"` double le repère visuel : l'onglet actif ne se
 * signale pas uniquement par une nuance de fond.
 */
export function MainNav({ items, homeHref }: { items: NavItem[]; homeHref: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Navigation principale" className="flex flex-wrap items-center gap-1">
      {items.map((item) => {
        const active =
          item.href === homeHref ? pathname === item.href : pathname.startsWith(item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
              active
                ? "bg-white/15 text-white"
                : "text-white/75 hover:bg-white/10 hover:text-white",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
