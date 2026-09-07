"use client";

import { useState } from "react";
import { BookUser, ChevronsUpDown, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatAmount, formatVatRate } from "@/lib/format";
import type { CatalogClient, CatalogService } from "@/lib/catalog/types";
import type { LocaleCode } from "@/lib/locale";

/**
 * Sélecteurs du carnet et du catalogue, pour l'éditeur de facture.
 *
 * ---------------------------------------------------------------------------
 * CHOISIR NE FIGE RIEN
 * ---------------------------------------------------------------------------
 * Ces composants ne font qu'une chose : REMPLIR des champs. Ils ne posent
 * aucun lien vers la ligne du carnet ou du catalogue — ni `client_id` sur la
 * facture, ni `service_id` sur la ligne. Ce qui part en base, c'est ce qui est
 * à l'écran après d'éventuelles retouches.
 *
 * C'est un choix, pas un raccourci : une facture est une pièce comptable, elle
 * doit rester telle qu'elle a été émise. Si elle pointait vers la fiche
 * client, corriger une adresse aujourd'hui réécrirait une facture de l'an
 * dernier. Le carnet est une commodité de saisie ; la facture, elle, se
 * suffit à elle-même.
 *
 * Conséquence assumée : rien ne relie une facture à son client autrement que
 * par le nom recopié. Un écran « toutes les factures de ce client » demanderait
 * de poser ce lien — et donc de décider ce qu'il advient quand la fiche change.
 */

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export function ClientPicker({
  clients,
  onSelect,
  disabled,
}: {
  clients: CatalogClient[];
  onSelect: (client: CatalogClient) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (clients.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
        >
          <BookUser aria-hidden />
          Depuis le carnet
          <ChevronsUpDown aria-hidden className="opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-80 p-0" align="end">
        <Command>
          <CommandInput placeholder="Rechercher un client…" />
          <CommandList>
            <CommandEmpty>Aucun client à ce nom.</CommandEmpty>
            <CommandGroup>
              {clients.map((client) => (
                <CommandItem
                  key={client.id}
                  // `value` est ce sur quoi cmdk filtre : sans les
                  // coordonnées, chercher un numéro de téléphone ne
                  // trouverait rien alors qu'il est affiché juste là.
                  value={`${client.name} ${client.phone ?? ""} ${client.vatNumber ?? ""}`}
                  onSelect={() => {
                    onSelect(client);
                    setOpen(false);
                  }}
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{client.name}</span>
                    {client.address || client.phone ? (
                      <span className="text-xs text-muted-foreground">
                        {[client.address?.split("\n")[0], client.phone]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    ) : null}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Prestations
// ---------------------------------------------------------------------------

export function ServicePicker({
  services,
  localeCode,
  onSelect,
  disabled,
}: {
  services: CatalogService[];
  localeCode: LocaleCode;
  onSelect: (service: CatalogService) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (services.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          role="combobox"
          aria-expanded={open}
          aria-label="Choisir une prestation du catalogue"
          disabled={disabled}
          className="text-muted-foreground"
        >
          <Wrench aria-hidden />
          Catalogue
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-80 p-0" align="end">
        <Command>
          <CommandInput placeholder="Rechercher une prestation…" />
          <CommandList>
            <CommandEmpty>Aucune prestation à ce libellé.</CommandEmpty>
            <CommandGroup>
              {services.map((service) => (
                <CommandItem
                  key={service.id}
                  value={service.label}
                  onSelect={() => {
                    onSelect(service);
                    setOpen(false);
                  }}
                >
                  <div className="flex w-full items-baseline justify-between gap-3">
                    <span className="font-medium">{service.label}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatAmount(service.defaultPriceHt, localeCode)} ·{" "}
                      {formatVatRate(service.defaultVatRate, localeCode)}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
