import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Plus, TriangleAlertIcon } from "lucide-react";
import {
  Alert,
  AlertTitle,
  Button,
  Card,
  CardContent,
  NixusLogo,
  Separator,
  Skeleton,
  focusRing,
} from "@nixus/shared";
import { SURFACE_HEADING_ID } from "@/components/shared/PageHeader";
import {
  useActiveDatasetId,
  useCreateDataset,
  useDatasets,
  useSelectDataset,
  type Dataset,
} from "@/hooks/useDatasets";
import { cn } from "@/lib/utils";
import { DeleteProfilePanel } from "./DeleteProfilePanel";
import { PickerBrandVisual } from "./PickerBrandVisual";
import { PickerCloudEntry } from "./PickerCloudEntry";
import { ProfileRow } from "./ProfileRow";
import { type DeleteAvailability } from "./ProfileRowMenu";
import { RenameProfilePanel } from "./RenameProfilePanel";

// The disclosure's two halves reference each other by id — trigger → panel via `aria-controls`,
// panel → trigger via `aria-labelledby` — so both ids are declared once here rather than inline,
// where a typo would silently break the pairing without breaking the render.
const LOCAL_TRIGGER_ID = "picker-local-trigger";
const LOCAL_PANEL_ID = "picker-local-panel";

// A `Record` over react-query's own status union rather than a ternary chain: adding a status makes
// this a compile error instead of silently reporting `ready` for a state nobody mapped. The values
// are the registry's vocabulary, not the query library's — `error` reads as `failed` on screen.
const REGISTRY_STATE = {
  pending: "pending",
  error: "failed",
  success: "ready",
} as const satisfies Record<"pending" | "error" | "success", string>;

interface DatasetPickerProps {
  /**
   * Whether the "Working locally" disclosure starts open. Resolved by the route, not derived here:
   * `routes/picker.tsx` owns the arrival-context contract.
   *
   * Only "Switch profile" sets it. A user who deliberately came to change profiles is already past
   * the question the collapsed screen asks, so the list is there when they arrive; an ordinary gated
   * launch still leads with Nixus Cloud and keeps the list collapsed.
   */
  defaultLocalOpen: boolean;
}

/**
 * The launch-time landing screen: a Nixus Cloud entry point, with local profiles behind a
 * disclosure.
 *
 * Chrome-free by arrangement with `routes/__root.tsx`, which omits the rail, the top bar, the
 * destination nav, the chat bar and the update dialog on this path and hands the surface the full
 * main column. That is also why this component — not the shell's `<main>`, which is
 * `overflow-hidden` here — is the scroll container, and why it centres itself.
 */
export function DatasetPicker({ defaultLocalOpen }: DatasetPickerProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const datasets = useDatasets();
  const activeDatasetId = useActiveDatasetId();
  const selectDataset = useSelectDataset();
  const createDataset = useCreateDataset();
  const entries = datasets.data ?? [];

  // Whether the local-profile disclosure is open. Plain component state seeded once on purpose: the
  // arrival context is the only thing that opens it, so nothing is remembered between runs and the
  // first screen of a launch never differs run to run for a reason the user did not choose.
  const [localOpen, setLocalOpen] = useState(defaultLocalOpen);

  // The profile whose name is being edited, or none. The whole entry rather than an id, so the panel
  // seeds its field from the row the user picked without re-searching the list.
  const [renaming, setRenaming] = useState<Dataset | null>(null);

  // The profile awaiting a typed deletion confirmation, or none. Same reasoning as `renaming`: the
  // dialog names the profile, so it needs the entry rather than an id.
  const [deleting, setDeleting] = useState<Dataset | null>(null);

  // Every control behind either panel is inert while a registry rewrite is in flight — select,
  // create, rename and delete all read-modify-write the same file — and for as long as a panel is
  // open, because both are modal: a click that reached a row through the backdrop would open the very
  // profile being renamed or deleted, and one that reached the create control would rewrite the
  // registry underneath it.
  const backgroundBusy =
    selectDataset.isPending ||
    createDataset.isPending ||
    renaming !== null ||
    deleting !== null;

  // The one answer to "is this the row the user is already in", read by both the row's own mark and
  // the delete refusal below, so the two can never disagree about which row that is.
  //
  // `isSuccess` — never `data === entry.id` alone — is what gates it on the backend having actually
  // answered: while the query is pending or has errored `data` is `undefined`, this is false for
  // every row, and nothing claims to be open on a guess.
  const isOpenProfile = (entry: Dataset) =>
    activeDatasetId.isSuccess && activeDatasetId.data === entry.id;

  // Fail closed, on the same gate and for a sharper reason: while the query is unresolved a bare
  // comparison would quietly offer deletion on *every* row including the open one. The refusal that
  // lifts by itself is the honest state to show until the answer arrives. Rust refuses the open
  // profile regardless; this only keeps the UI from inviting an action it cannot yet know is safe.
  const deleteAvailabilityFor = (entry: Dataset): DeleteAvailability => {
    if (!activeDatasetId.isSuccess) return "refused-unknown";
    return isOpenProfile(entry) ? "refused-active" : "allowed";
  };

  // Navigating to `/` rather than reloading is what makes the picker's own gate the thing that
  // decides: the root's beforeLoad re-asks `check_picker_gate` (now latched) and `/`'s asks
  // `check_onboarding_status` against the dataset just opened, so the dashboard-vs-wizard choice
  // stays where it already lives.
  const selectEntry = async (datasetId: string) => {
    try {
      await selectDataset.mutateAsync(datasetId);
      // Awaited inside the try as well: `navigate` returns a promise that rejects if the target
      // route's own loaders fail, and outside it that becomes an unhandled rejection with the row
      // still spinning. The user is left on the picker either way, so one toast covers both.
      await navigate({ to: "/" });
    } catch {
      // Mandatory: select_dataset can fail on an unknown id or a failed open/migrate. Without this
      // the rejection is an unhandled promise and the row just looks dead. The user stays here.
      toast.error(t("datasets.selectFailed"));
    }
  };

  // No navigation and no auto-select on purpose: creating and opening are separate user actions,
  // so the new row simply appears — `useCreateDataset` invalidates the list — and the user stays
  // here to choose it (or not).
  const createEntry = async () => {
    try {
      await createDataset.mutateAsync();
    } catch {
      toast.error(t("datasets.createFailed"));
    }
  };

  return (
    // `tabIndex={-1}` for the same reason the shell's `<main>` carries it: a keyboard user needs the
    // scroll region itself to be focusable, and on this route this element is that region.
    <div
      tabIndex={-1}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto px-page-x py-page-y"
      data-testid="dataset-picker"
    >
      {/* `m-auto`, not `justify-center`: centring a flex child with justify-content makes the
        * overflowing top unreachable once the content is taller than the window.
        *
        * Two columns only while the effective width sustains them. At the 1024 × 680 minimum it
        * does; under OS text scaling — which shrinks the CSS viewport rather than the type — it does
        * not, and the composition stacks with the visual last instead of clipping.
        *
        * Stretch, not `items-center`: the decorative column matches the action column's height, so an
        * expanded profile list never leaves a short panel stranded beside it. The action column
        * centres its own content within the cell for the collapsed case, where it is the shorter of
        * the two. */}
      <div className="m-auto grid w-full max-w-4xl grid-cols-1 items-stretch gap-section-gap lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] lg:gap-10">
        <div
          className="mx-auto flex w-full max-w-md flex-col justify-center lg:mx-0 lg:max-w-none"
          data-testid="picker-action-column"
        >
          {/* The shell's skip link and its route-change focus move both target this id, and this
            * surface renders no PageHeader, so it owns the heading contract itself.
            *
            * `text-display` carries a statement rather than a figure here. Everywhere else display
            * is the one number that answers the surface's question; this surface has no figure at
            * all, so the sentence is what the role carries, and the one-per-surface ceiling holds.
            *
            * `aria-label` carries the whole greeting and the lockup below is `aria-hidden`: the mark
            * is an `<svg>` and the text beside it is three letters, so an unlabelled heading would
            * announce "Welcome to ixus" — and the shell's focus-move-on-route-change reads exactly
            * this name. */}
          <h1
            id={SURFACE_HEADING_ID}
            data-surface-heading=""
            tabIndex={-1}
            aria-label={t("datasets.title")}
            className={cn(
              "flex flex-wrap items-end gap-x-2 text-display text-ink",
              focusRing
            )}
          >
            <span aria-hidden="true">{t("datasets.titleLead")}</span>
            {/* The brand as the app draws it everywhere else — the mark followed by "ixus", the same
              * lockup, kerning and gradient clip the rail wordmark uses — so the first screen of a
              * launch shows the identity instead of spelling it out. This is the one surface heading
              * permitted to carry the logo gradient, recorded as such in DESIGN.md.
              *
              * The mark's artboard leaves ~3px of empty box under its glyph, so `items-end` alone
              * drops the "N" below the greeting's baseline. `mb-0.5` lifts it by that slack minus the
              * font's descender space, which is what seats the glyph on the same baseline as
              * "Welcome to" and "ixus" — half the lift this started with, which rode too high. */}
            <span aria-hidden="true" className="flex items-end">
              <span data-testid="picker-brand-mark" className="mb-0.5 block size-8">
                <NixusLogo className="size-full" />
              </span>
              <span className="-ml-0.5 bg-logo-gradient bg-clip-text leading-none text-transparent">
                ixus
              </span>
            </span>
          </h1>
          <p
            className="mt-3 text-body text-ink-dim"
            data-testid="picker-value-statement"
          >
            {t("datasets.subtitle")}
          </p>

          <PickerCloudEntry disabled={backgroundBusy} />

          {datasets.isError ? (
            // Stated rather than silent, and stated *outside* the disclosure: a failed registry read
            // and a registry with zero entries would otherwise both render as "no rows", and a user
            // who never opens the disclosure would see a screen that looks perfectly healthy.
            // `Alert variant="over"` rather than `EmptyState` — an empty state is styled never to
            // read as broken, and it also carries `role="alert"`, so the failure is announced. No
            // retry: `bootstrap_registry` guarantees a valid file at startup, so reaching here means
            // the file changed underneath a running app, and a relaunch is the honest remedy rather
            // than a button that re-reads the same broken bytes.
            <Card flush className="mt-section-gap" data-testid="picker-load-error">
              <Alert variant="over" icon={<TriangleAlertIcon />}>
                <AlertTitle>{t("datasets.loadError")}</AlertTitle>
              </Alert>
            </Card>
          ) : null}

          {/* The hairline that separates the cloud entry point from its low-emphasis alternative.
            * `line-strong` rather than `line`: this rule sits on the page rather than inside a card,
            * where `line` measures 1.13:1 and effectively disappears. Both are existing tokens — the
            * global hairline value is deliberately left alone, per its own note in DESIGN.md. */}
          <Separator
            className="mt-section-gap bg-line-strong"
            data-testid="picker-local-divider"
          />

          {/* `variant="ghost"`: the alternative must not read as a peer of the primary above it.
            * `aria-controls` is set only while the panel exists, so the trigger never points at an
            * id that is not in the document.
            *
            * Disabled while `backgroundBusy`, in both spellings, and this one is load-bearing rather
            * than cosmetic: collapsing the panel unmounts the rows, and a row is the focus-return
            * target a rename or delete panel restores focus to on close. Toggling mid-mutation would
            * destroy that target and drop focus to `<body>`.
            *
            * `data-registry-state` carries the registry's health — named for the registry rather than
            * a generic `data-state`, which Base UI also uses for its own component state. The glyph
            * beside the label is *reinforcement only*: the announced `role="alert"` above carries the
            * words, so nothing here is colour-only and no copy or action is added. */}
          <Button
            variant="ghost"
            id={LOCAL_TRIGGER_ID}
            className="mt-2 w-full justify-between px-2"
            aria-expanded={localOpen}
            aria-controls={localOpen ? LOCAL_PANEL_ID : undefined}
            data-registry-state={REGISTRY_STATE[datasets.status]}
            disabled={backgroundBusy}
            aria-disabled={backgroundBusy || undefined}
            onClick={() => setLocalOpen((open) => !open)}
            data-testid="picker-local-disclosure"
          >
            <span className="flex items-center gap-2">
              {t("datasets.workingLocally")}
              {datasets.isError ? (
                <TriangleAlertIcon aria-hidden="true" className="text-over" />
              ) : null}
            </span>
            {localOpen ? (
              <ChevronUp aria-hidden="true" />
            ) : (
              <ChevronDown aria-hidden="true" />
            )}
          </Button>

          {/* Unmounted when closed, never hidden: a `display:none` panel would leave every row and
            * its management menu in the document as an unreachable tab stop. Toggling state is also
            * all this does, which is what leaves focus on the trigger — the user asked to see the
            * list, not to be moved into it. */}
          {localOpen ? (
            <div
              id={LOCAL_PANEL_ID}
              role="group"
              aria-labelledby={LOCAL_TRIGGER_ID}
              className="flex flex-col"
              data-testid="picker-local-panel"
            >
              {/* On a failed read this must NOT say "choose a profile to open": there is no list to
                * choose from and the instruction would be a lie the user acts on. It restates the
                * failure instead — the same sentence the alert above carries, because the panel has
                * to explain its own emptiness to a user who opened it after reading nothing. */}
              <p
                className="mt-2 text-caption text-ink-dim"
                data-testid="picker-local-panel-note"
              >
                {datasets.isError
                  ? t("datasets.loadError")
                  : t("datasets.workingLocallyDescription")}
              </p>

              {datasets.isPending ? (
                <Card className="mt-grid-gap" size="sm">
                  <CardContent>
                    <Skeleton rows={2} />
                  </CardContent>
                </Card>
              ) : entries.length > 0 ? (
                <ul
                  className="mt-grid-gap flex list-none flex-col gap-grid-gap p-0"
                  data-testid="picker-dataset-list"
                >
                  {entries.map((entry) => (
                    <ProfileRow
                      key={entry.id}
                      entry={entry}
                      isOpen={isOpenProfile(entry)}
                      deleteAvailability={deleteAvailabilityFor(entry)}
                      disabled={backgroundBusy}
                      onSelect={() => void selectEntry(entry.id)}
                      onRename={() => setRenaming(entry)}
                      onDelete={() => setDeleting(entry)}
                    />
                  ))}
                </ul>
              ) : null}

              {/* `variant="outline"` so it shares the rows' `bg-card` surface and belongs to the
                * local-profile group rather than to the branded Cloud CTA above. Its border is the
                * firmer `line-strong` the outline variant supplies, not the rows' `line` hairline —
                * correct for a control, where the rows are containers. Disabled while a selection is
                * in flight for the same reason the rows are disabled while a create is: both
                * mutations rewrite the same registry.
                *
                * Also disabled on a failed read, and that is a correctness guard rather than a
                * courtesy: the generated label is one past the high-water mark of a registry this
                * process could not read, so creating here would either collide with an existing
                * profile's name or write into a file whose state is unknown. */}
              <Button
                variant="outline"
                className="mt-grid-gap"
                disabled={backgroundBusy || datasets.isError}
                aria-disabled={backgroundBusy || datasets.isError || undefined}
                onClick={() => void createEntry()}
                data-testid="picker-new-profile-button"
              >
                <Plus aria-hidden="true" />
                {t("datasets.newLocalProfile")}
              </Button>
            </div>
          ) : null}
        </div>

        {/* The decorative column. Everything it owns — including why it stretches — lives with it. */}
        <PickerBrandVisual />
      </div>

      {/* Mounted only while a rename is open, and keyed by the profile: that is what reseeds the
        * field from the row the user actually picked instead of the first one they ever opened. */}
      {renaming ? (
        <RenameProfilePanel
          key={renaming.id}
          entry={renaming}
          onClose={() => setRenaming(null)}
        />
      ) : null}

      {/* Same mount-and-key discipline as the rename panel, and for a sharper reason: the typed
        * confirmation and the named profile must both be re-derived from the row that was picked, so
        * a word typed against one profile can never carry over to another. Only one of the two panels
        * can be open at a time, because opening either sets `backgroundBusy` and takes every menu
        * trigger behind it out of reach. */}
      {deleting ? (
        <DeleteProfilePanel
          key={deleting.id}
          entry={deleting}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </div>
  );
}
