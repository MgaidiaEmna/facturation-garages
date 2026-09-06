import { cn } from "@/lib/utils";

/**
 * En-tête de page : titre, sous-titre, action principale à droite.
 *
 * Écrit une fois pour que toutes les pages aient la même hauteur de titre,
 * le même interligne et le même comportement quand l'action passe à la ligne
 * sur mobile. Sans ce composant, chaque page redécide de sa typographie et
 * l'application prend l'air d'avoir été assemblée par cinq personnes.
 */
export function PageHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Bouton principal, aligné à droite sur écran large. */
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description ? (
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}

/**
 * Titre d'une section à l'intérieur d'une page (hors carte).
 * Un cran en dessous de `PageHeader`, pour ne pas concurrencer le titre.
 */
export function SectionHeader({
  title,
  description,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {description ? (
        <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
