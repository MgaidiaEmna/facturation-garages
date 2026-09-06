import { cn } from "@/lib/utils";

/**
 * État vide : ce qu'on voit quand il n'y a rien à voir.
 *
 * Trois obligations, tenues ici une fois pour toutes : dire ce qui est vide,
 * dire pourquoi ça peut l'être légitimement, et proposer la sortie. Un cadre
 * gris avec « Aucune donnée » laisse la personne se demander si elle a mal
 * cherché ou si l'application est cassée.
 *
 * Variante `compact` pour un résultat de recherche vide : la liste existe,
 * c'est le filtre qui ne rend rien — le message n'a pas à occuper l'écran.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  variant = "default",
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  variant?: "default" | "compact";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-dashed bg-card px-6 text-center",
        variant === "compact" ? "py-12" : "py-16",
        className,
      )}
    >
      {icon ? (
        <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-accent text-accent-foreground">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
