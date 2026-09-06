import Image from "next/image";

import { cn } from "@/lib/utils";

/**
 * Signature visuelle de l'application : l'icône et le nom.
 *
 * Un seul composant pour l'en-tête des deux espaces, les écrans
 * d'authentification et la page d'accueil. Le jour où le logo change, il
 * change à un endroit — c'est tout l'intérêt de ne pas recopier une balise
 * `<Image>` dans chaque gabarit.
 *
 * L'icône est décorative quand elle est accompagnée du nom : elle porte
 * `alt=""` et `aria-hidden`, sinon un lecteur d'écran annoncerait deux fois
 * la même chose (« Facturation, lien Facturation »).
 */
export function BrandMark({
  size = "default",
  tone = "light",
  showName = true,
  className,
}: {
  /** `sm` pour un en-tête dense, `lg` pour une page d'accueil. */
  size?: "sm" | "default" | "lg";
  /** `light` = texte clair sur fond marine ; `dark` = texte foncé sur fond clair. */
  tone?: "light" | "dark";
  showName?: boolean;
  className?: string;
}) {
  const dimension = size === "sm" ? 24 : size === "lg" ? 44 : 30;

  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <Image
        src="/icone.png"
        alt=""
        aria-hidden
        width={dimension}
        height={dimension}
        priority
        className="rounded-[22%] shadow-sm"
        style={{ width: dimension, height: dimension }}
      />
      {showName ? (
        <span
          className={cn(
            "font-semibold tracking-tight",
            size === "lg" ? "text-xl" : "text-base",
            tone === "light" ? "text-white" : "text-foreground",
          )}
        >
          Facturation
        </span>
      ) : null}
    </span>
  );
}
