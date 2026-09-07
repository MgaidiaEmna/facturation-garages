"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Save, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { InvoicePreview } from "@/components/invoice/invoice-preview";
import { saveInvoiceDraftAction } from "@/lib/invoice/actions";
import { computeTotals, emptyLine, isUsable, type DraftLine } from "@/lib/invoice/compute";
import type { InvoiceDraft, SellerIdentity } from "@/lib/invoice/types";
import { formatAmount } from "@/lib/format";
import { getLocale, type LocaleCode } from "@/lib/locale";
import { cn } from "@/lib/utils";
import type { CatalogClient, CatalogService, EditorCatalog } from "@/lib/catalog/types";
import { FinalizeInvoiceButton } from "./finalize-invoice-button";
import { ClientPicker, ServicePicker } from "./catalog-pickers";
import { SaveClientButton } from "./save-client-button";

/**
 * Clé de la ligne vierge offerte à l'ouverture d'un brouillon neuf.
 *
 * Une constante, et non une valeur tirée au sort : elle sert d'attribut `id`
 * aux champs de la ligne et de `htmlFor` à leurs étiquettes. Le serveur rend
 * ce composant une première fois, le navigateur le rejoue à l'hydratation ;
 * si les deux ne produisent pas le MÊME identifiant, React signale que
 * « some attributes of the server rendered HTML didn't match » et jette le
 * HTML reçu. Les clés ne servent qu'au rendu — aucune ne part en base.
 */
const PREMIERE_LIGNE = "ligne-1";

/**
 * Éditeur de facture : saisie à gauche, aperçu à droite, en temps réel.
 *
 * L'état vit ici, dans le navigateur, le temps de la saisie. Rien de ce qu'il
 * contient n'a d'autorité : à l'enregistrement, seuls le contenu des champs
 * et des lignes partent au serveur — jamais un total. `save_invoice_draft()`
 * les recalcule, et `finalize_invoice()` recommencera à l'émission.
 *
 * Le `garage_id` n'apparaît nulle part : c'est le serveur qui sait à quel
 * garage appartient la personne connectée.
 */
export function InvoiceEditor({
  seller,
  draft,
  localeCode,
  today,
  catalog,
  canWrite,
  readOnlyReason,
  finalizeBlockMessage,
}: {
  seller: SellerIdentity;
  /** Brouillon repris, ou `null` pour une création. */
  draft: InvoiceDraft | null;
  localeCode: LocaleCode;
  /**
   * Date du jour, calculée par le SERVEUR dans le fuseau de la locale. Elle
   * arrive en propriété plutôt que d'être relue ici : le navigateur qui
   * rejoue le rendu à l'hydratation doit trouver exactement la même valeur
   * que celle déjà écrite dans le HTML.
   */
  today: string;
  /**
   * Carnet de clients et catalogue de prestations du garage, servis avec la
   * page. Ils PRÉ-REMPLISSENT, ils ne contraignent pas : rien de ce qui est
   * choisi ici n'est relié à la facture, tout y reste modifiable.
   */
  catalog: EditorCatalog;
  canWrite: boolean;
  readOnlyReason: string | null;
  /**
   * Pourquoi l'émission est refusée, en une phrase produite par la base
   * (`finalize_block_message()`). `null` quand elle est ouverte. Rien n'est
   * recalculé ici : c'est la MÊME phrase que lèverait `finalize_invoice()`.
   */
  finalizeBlockMessage: string | null;
}) {
  const router = useRouter();
  const locale = getLocale(localeCode);

  const [invoiceId, setInvoiceId] = useState<string | null>(draft?.id ?? null);
  const [clientName, setClientName] = useState(draft?.clientName ?? "");
  const [clientAddress, setClientAddress] = useState(draft?.clientAddress ?? "");
  const [clientPhone, setClientPhone] = useState(draft?.clientPhone ?? "");
  const [clientVatNumber, setClientVatNumber] = useState(draft?.clientVatNumber ?? "");
  const [issueDate, setIssueDate] = useState(draft?.issueDate ?? today);
  const [serviceDate, setServiceDate] = useState(draft?.serviceDate ?? "");
  const [notes, setNotes] = useState(draft?.notes ?? "");
  const [lines, setLines] = useState<DraftLine[]>(
    // `PREMIERE_LIGNE` est une constante, pas un tirage : ce rendu-ci a lieu
    // deux fois — sur le serveur, puis à l'hydratation — et les `id` qui en
    // découlent doivent coïncider au caractère près.
    draft?.lines.length ? draft.lines : [emptyLine(PREMIERE_LIGNE, localeCode)],
  );
  const [saving, startSaving] = useTransition();

  // Les clés suivantes ne naissent que dans un gestionnaire d'événement, donc
  // jamais pendant un rendu serveur : un compteur suffit, et il ne peut pas
  // entrer en collision avec les identifiants de lignes déjà en base.
  const compteurLignes = useRef(0);
  const nouvelleCle = () => `${PREMIERE_LIGNE}-${++compteurLignes.current}`;

  const totals = computeTotals(lines, { localeCode, vatExempt: seller.vatExempt });

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function removeLine(key: string) {
    // La clé est tirée AVANT le `setLines` : la fonction de mise à jour reste
    // pure, donc rejouable sans effet de bord.
    const remplacement = emptyLine(nouvelleCle(), localeCode);
    setLines((current) => {
      const rest = current.filter((line) => line.key !== key);
      // Ne jamais laisser l'éditeur sans aucune ligne : on retomberait sur un
      // écran vide sans savoir par où reprendre.
      return rest.length > 0 ? rest : [remplacement];
    });
  }

  function addLine() {
    const ligne = emptyLine(nouvelleCle(), localeCode);
    setLines((current) => [...current, ligne]);
  }

  /**
   * Reprend les coordonnées d'un client du carnet.
   *
   * On REMPLACE les champs, y compris par du vide : choisir un client sans
   * numéro de TVA après en avoir choisi un qui en avait laisserait sinon
   * l'ancien numéro sur la facture du nouveau. Le pire des mélanges.
   */
  function reprendreClient(client: CatalogClient) {
    setClientName(client.name);
    setClientAddress(client.address ?? "");
    setClientPhone(client.phone ?? "");
    setClientVatNumber(client.vatNumber ?? client.siret ?? "");
  }

  /** Reprend une prestation du catalogue sur une ligne — quantité intacte. */
  function reprendrePrestation(key: string, service: CatalogService) {
    updateLine(key, {
      description: service.label,
      unit: service.defaultUnit,
      unitPriceHt: service.defaultPriceHt,
      vatRate: service.defaultVatRate,
    });
  }

  /**
   * Enregistre le brouillon et renvoie son identifiant, ou `null` si
   * l'enregistrement a échoué — la personne a déjà été prévenue.
   *
   * Extrait de `save()` parce que l'émission a besoin du même travail :
   * `finalize_invoice()` lit la base, pas l'écran, donc ce qui est affiché
   * doit y être avant qu'on émette.
   */
  async function persist(): Promise<string | null> {
    const result = await saveInvoiceDraftAction({
      invoiceId,
      clientName,
      clientAddress,
      clientPhone,
      clientVatNumber,
      issueDate,
      serviceDate,
      notes,
      lines: lines.map((line) => ({
        description: line.description,
        unit: line.unit,
        quantity: line.quantity,
        unitPriceHt: line.unitPriceHt,
        vatRate: line.vatRate,
      })),
    });

    if (result.error) {
      toast.error(result.error);
      return null;
    }
    if (result.fieldErrors) {
      toast.error("Certaines valeurs sont invalides — vérifiez la saisie.");
      return null;
    }

    const id = result.invoiceId ?? invoiceId;
    if (id && id !== invoiceId) setInvoiceId(id);
    return id ?? null;
  }

  function save() {
    const avant = invoiceId;
    startSaving(async () => {
      const id = await persist();
      if (!id) return;

      toast.success("Brouillon enregistré.");

      // Première sauvegarde : on passe sur l'URL du brouillon, pour que les
      // suivantes le mettent à jour au lieu d'en créer un nouveau.
      if (id !== avant) router.replace(`/app/factures/${id}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Button asChild variant="ghost" size="sm" className="-ms-3">
          <Link href="/app/factures">
            <ArrowLeft aria-hidden />
            Mes factures
          </Link>
        </Button>

        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">
            Total TTC{" "}
            <span className="font-semibold text-foreground tabular-nums">
              {formatAmount(totals.totalTtc, localeCode)}
            </span>
          </span>
          <Button variant="outline" onClick={save} disabled={saving || !canWrite}>
            <Save aria-hidden />
            {saving ? "Enregistrement…" : "Enregistrer le brouillon"}
          </Button>

          {canWrite ? (
            <FinalizeInvoiceButton
              invoiceId={invoiceId}
              clientName={clientName}
              totalLabel={formatAmount(totals.totalTtc, localeCode)}
              lineCount={lines.filter(isUsable).length}
              blockMessage={finalizeBlockMessage}
              onBeforeFinalize={persist}
            />
          ) : null}
        </div>
      </div>

      {!canWrite && readOnlyReason ? (
        <Alert variant="destructive" className="border-destructive/30">
          <TriangleAlert aria-hidden />
          <AlertTitle>Espace en lecture seule</AlertTitle>
          <AlertDescription>
            {readOnlyReason} Vous pouvez préparer la facture et la voir se construire,
            mais pas l&apos;enregistrer.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        {/* ================= COLONNE GAUCHE : saisie ================= */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Client</CardTitle>
              <CardDescription>
                Choisissez un client du carnet, ou saisissez un client ponctuel — il
                n&apos;a pas à être enregistré pour être facturé.
              </CardDescription>
              <CardAction>
                <ClientPicker
                  clients={catalog.clients}
                  onSelect={reprendreClient}
                  disabled={!canWrite}
                />
              </CardAction>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="clientName">Nom ou raison sociale</FieldLabel>
                <Input
                  id="clientName"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Dupont SARL"
                  autoComplete="off"
                />
              </Field>

              <Field className="sm:col-span-2">
                <FieldLabel htmlFor="clientAddress">Adresse</FieldLabel>
                <Textarea
                  id="clientAddress"
                  rows={2}
                  value={clientAddress}
                  onChange={(e) => setClientAddress(e.target.value)}
                  placeholder={"12 rue des Lilas\n69003 Lyon"}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="clientPhone">Téléphone</FieldLabel>
                <Input
                  id="clientPhone"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="clientVatNumber">
                  N° TVA / SIRET
                </FieldLabel>
                <Input
                  id="clientVatNumber"
                  value={clientVatNumber}
                  onChange={(e) => setClientVatNumber(e.target.value)}
                />
                <FieldDescription>Obligatoire en B2B intracommunautaire.</FieldDescription>
              </Field>

              {canWrite ? (
                <div className="flex justify-end sm:col-span-2">
                  <SaveClientButton
                    clientName={clientName}
                    clientAddress={clientAddress}
                    clientPhone={clientPhone}
                    clientVatNumber={clientVatNumber}
                  />
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Dates</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="issueDate">Date d&apos;émission</FieldLabel>
                <Input
                  id="issueDate"
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="serviceDate">Date de prestation</FieldLabel>
                <Input
                  id="serviceDate"
                  type="date"
                  value={serviceDate}
                  onChange={(e) => setServiceDate(e.target.value)}
                />
                <FieldDescription>Mention obligatoire sur la facture.</FieldDescription>
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Prestations</CardTitle>
              <CardDescription>
                Une ligne sans désignation n&apos;est pas enregistrée.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {lines.map((line, index) => (
                <LineRow
                  key={line.key}
                  line={line}
                  index={index}
                  vatRates={locale.vatRates}
                  vatExempt={seller.vatExempt}
                  decimals={locale.decimals}
                  localeCode={localeCode}
                  services={catalog.services}
                  canWrite={canWrite}
                  onChange={(patch) => updateLine(line.key, patch)}
                  onPickService={(service) => reprendrePrestation(line.key, service)}
                  onRemove={() => removeLine(line.key)}
                  removable={lines.length > 1}
                />
              ))}

              <Button
                type="button"
                variant="outline"
                onClick={addLine}
              >
                <Plus aria-hidden />
                Ajouter une ligne
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Note</CardTitle>
              <CardDescription>Affichée en bas de la facture.</CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Véhicule immatriculé AB-123-CD, kilométrage 128 400…"
              />
            </CardContent>
          </Card>
        </div>

        {/* ================= COLONNE DROITE : aperçu ================= */}
        <div className="xl:sticky xl:top-6 xl:self-start">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">
              Aperçu — mis à jour à chaque frappe
            </h2>
            <span className="text-xs text-muted-foreground">
              Montants indicatifs, recalculés à l&apos;émission
            </span>
          </div>

          <div className="overflow-x-auto rounded-xl bg-muted/60 p-3">
            <InvoicePreview
              seller={seller}
              client={{
                name: clientName,
                address: clientAddress,
                phone: clientPhone,
                vatNumber: clientVatNumber,
              }}
              lines={lines}
              issueDate={issueDate}
              serviceDate={serviceDate}
              notes={notes}
              localeCode={localeCode}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Une ligne de prestation dans le formulaire. */
function LineRow({
  line,
  index,
  vatRates,
  vatExempt,
  decimals,
  localeCode,
  services,
  canWrite,
  onChange,
  onPickService,
  onRemove,
  removable,
}: {
  line: DraftLine;
  index: number;
  vatRates: { rate: number; label: string }[];
  vatExempt: boolean;
  decimals: number;
  localeCode: LocaleCode;
  services: CatalogService[];
  canWrite: boolean;
  onChange: (patch: Partial<DraftLine>) => void;
  onPickService: (service: CatalogService) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const total = Math.round(line.quantity * line.unitPriceHt * 10 ** decimals) / 10 ** decimals;

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Ligne {index + 1}
        </span>
        <div className="flex items-center gap-1">
        <ServicePicker
          services={services}
          localeCode={localeCode}
          onSelect={onPickService}
          disabled={!canWrite}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          disabled={!removable}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 aria-hidden />
          <span className="sr-only">Supprimer la ligne {index + 1}</span>
        </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-12">
        <Field className="sm:col-span-12">
          <FieldLabel htmlFor={`desc-${line.key}`}>Désignation</FieldLabel>
          <Input
            id={`desc-${line.key}`}
            value={line.description}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="Vidange + filtre à huile"
            autoComplete="off"
          />
        </Field>

        <Field className="sm:col-span-3">
          <FieldLabel htmlFor={`qty-${line.key}`}>Quantité</FieldLabel>
          <Input
            id={`qty-${line.key}`}
            type="number"
            min={0}
            step="0.001"
            inputMode="decimal"
            value={Number.isFinite(line.quantity) ? line.quantity : ""}
            onChange={(e) => onChange({ quantity: toNumber(e.target.value) })}
          />
        </Field>

        <Field className="sm:col-span-2">
          <FieldLabel htmlFor={`unit-${line.key}`}>Unité</FieldLabel>
          <Input
            id={`unit-${line.key}`}
            value={line.unit}
            onChange={(e) => onChange({ unit: e.target.value })}
            placeholder="U"
          />
        </Field>

        <Field className={cn(vatExempt ? "sm:col-span-4" : "sm:col-span-3")}>
          <FieldLabel htmlFor={`pu-${line.key}`}>P.U. HT</FieldLabel>
          <Input
            id={`pu-${line.key}`}
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={Number.isFinite(line.unitPriceHt) ? line.unitPriceHt : ""}
            onChange={(e) => onChange({ unitPriceHt: toNumber(e.target.value) })}
          />
        </Field>

        {vatExempt ? null : (
          <Field className="sm:col-span-4">
            <FieldLabel htmlFor={`tva-${line.key}`}>Taux de TVA</FieldLabel>
            {/* `<select>` natif : les taux viennent de la locale, jamais d'une
                liste écrite en dur ici. */}
            <select
              id={`tva-${line.key}`}
              value={line.vatRate}
              onChange={(e) => onChange({ vatRate: Number(e.target.value) })}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {vatRates.map((rate) => (
                <option key={rate.rate} value={rate.rate}>
                  {rate.label}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      <p className="mt-3 text-right text-sm text-muted-foreground">
        Total ligne{" "}
        <span className="font-medium text-foreground tabular-nums">
          {formatAmount(total, localeCode)}
        </span>
      </p>
    </div>
  );
}

/** Champ numérique vidé : on garde `NaN` plutôt que 0, pour ne pas écraser la
 *  saisie en cours par un zéro que personne n'a tapé. */
function toNumber(value: string): number {
  if (value.trim() === "") return Number.NaN;
  return Number(value.replace(",", "."));
}
