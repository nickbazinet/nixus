import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Plus, TriangleAlertIcon } from "lucide-react";
import {
  Alert,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  NixusLogo,
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
import { useSignIn } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { DeleteProfilePanel } from "./DeleteProfilePanel";
import { ProfileRowMenu, type DeleteAvailability } from "./ProfileRowMenu";
import { RenameProfilePanel } from "./RenameProfilePanel";

/**
 * The launch-time screen: which local dataset is about to be opened.
 *
 * Chrome-free by arrangement with `routes/__root.tsx`, which omits the rail, the top bar, the
 * destination nav, the chat bar and the update dialog on this path and hands the surface the full
 * main column. That is also why this component — not the shell's `<main>`, which is
 * `overflow-hidden` here — is the scroll container, and why it centres itself.
 */
export function DatasetPicker() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const datasets = useDatasets();
  const activeDatasetId = useActiveDatasetId();
  const selectDataset = useSelectDataset();
  const createDataset = useCreateDataset();
  const signIn = useSignIn();
  const entries = datasets.data ?? [];

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

  // No navigation here: the browser round-trip outlives this click, and the callback's own branch
  // selects the profile it resolved. `CloudSignInNavigator` is what carries the user into it, so
  // this handler's only job is starting the flow and reporting a start that failed.
  const loginWithCloud = async () => {
    try {
      await signIn.mutateAsync({ kind: "Login" });
    } catch {
      toast.error(t("datasets.cloudFailed"));
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
        * overflowing top unreachable once the list is taller than the window. */}
      <div className="m-auto flex w-full max-w-md flex-col">
        <div className="text-center">
          <span data-testid="picker-brand-mark" className="mx-auto mb-5 block size-10">
            <NixusLogo className="size-full" />
          </span>
          {/* The shell's skip link and its route-change focus move both target this id, and this
            * surface renders no PageHeader, so it owns the heading contract itself. */}
          <h1
            id={SURFACE_HEADING_ID}
            data-surface-heading=""
            tabIndex={-1}
            className={cn("text-h1 text-ink", focusRing)}
          >
            {t("datasets.title")}
          </h1>
          <p className="mt-2 text-body text-ink-dim">{t("datasets.subtitle")}</p>
        </div>

        {datasets.isPending ? (
          <Card className="mt-section-gap" size="sm">
            <CardContent>
              <Skeleton rows={2} />
            </CardContent>
          </Card>
        ) : datasets.isError ? (
          // Stated rather than silent: a failed registry read and a registry with zero entries would
          // otherwise both render as "no rows", and the user could not tell "you have no profiles"
          // from "we could not find out". `Alert variant="over"` rather than `EmptyState` — an empty
          // state is styled never to read as broken, and it also carries `role="alert"`, so the
          // failure is announced. No retry: `bootstrap_registry` guarantees a valid file at startup,
          // so reaching here means the file changed underneath a running app, and a relaunch is the
          // honest remedy rather than a button that re-reads the same broken bytes.
          <Card flush className="mt-section-gap" data-testid="picker-load-error">
            <Alert variant="over" icon={<TriangleAlertIcon />}>
              <AlertTitle>{t("datasets.loadError")}</AlertTitle>
            </Alert>
          </Card>
        ) : entries.length > 0 ? (
          <ul
            className="mt-section-gap flex list-none flex-col gap-grid-gap p-0"
            data-testid="picker-dataset-list"
          >
            {entries.map((entry) => (
              // `relative`, and the rename control is a *sibling* of the Card overlaid on it rather
              // than a child: the Card's root element IS the row `<button>`, so a nested control
              // would be a button inside a button. Overlaying rather than laying the two out side by
              // side is what keeps every row the same full width as the buttons below the list.
              <li key={entry.id} className="relative">
                {/* `interactive` + `render={<button>}` is this repo's clickable-card convention
                  * (GarageVehicleRow's shape): the Card's root element itself becomes the button, so
                  * the row is one native focusable target. Nesting a button inside CardContent is
                  * the anti-pattern card.tsx documents against, and `interactive` — not a
                  * hand-rolled className — is what supplies hover and the focus ring. */}
                <Card
                  size="sm"
                  interactive
                  render={
                    <button
                      type="button"
                      // Every row, not only the clicked one, so a second row cannot race the first.
                      // What else takes them out is `backgroundBusy` above. Both spellings, matching
                      // the Cloud button below: the native attribute takes the row out of the tab
                      // order, `aria-disabled` is what assistive tech reports, so a dim is never the
                      // only signal.
                      disabled={backgroundBusy}
                      aria-disabled={backgroundBusy || undefined}
                      onClick={() => void selectEntry(entry.id)}
                    />
                  }
                  // `interactive` brings `cursor-pointer hover:bg-hover`, and both have to be
                  // cancelled while the row is inert — a row that still lights up under the cursor
                  // reads as clickable when it is not. `bg-card` is the Card's own base background.
                  // `w-full` is load-bearing: the Card's root element IS the `<button>` here, and a
                  // form control shrink-to-fits even as a block-level flex box, so without it every
                  // row would be exactly as wide as its own label.
                  className="w-full disabled:cursor-default disabled:hover:bg-card"
                  data-testid="picker-dataset-row"
                >
                  <CardContent
                    // Reserved for the overlaid management menu, so a long name never runs under it.
                    className={cn("text-left", entry.kind === "local" && "pr-10")}
                  >
                    {/* `flex-wrap`, never `truncate`: the label is the user's own text, up to the 80
                      * characters rename allows, so it keeps wrapping exactly as it did before this
                      * mark existed and the mark drops onto its own line instead of squeezing the
                      * name or sliding under the menu the `pr-10` above reserves room for. */}
                    <span className="flex flex-wrap items-center gap-2">
                      <span
                        className="text-label text-ink"
                        data-testid="picker-dataset-label"
                      >
                        {entry.label}
                      </span>
                      {/* A word, never a dot or an icon: this is the only thing telling two
                        * otherwise identical rows apart, so it has to survive a user who cannot
                        * separate the brand tint from the card. Inside the row button on purpose —
                        * a Badge is a label, not a control, so it adds no second focus target and
                        * the word joins the button's own accessible name. */}
                      {isOpenProfile(entry) ? (
                        <Badge variant="brand" data-testid="picker-active-badge">
                          {t("datasets.currentProfileBadge")}
                        </Badge>
                      ) : null}
                    </span>
                  </CardContent>
                </Card>
                {/* Local profiles only: a cloud-linked profile's label is its account's and its
                  * deletion is out of scope, so the whole menu is absent rather than
                  * present-and-refused. */}
                {entry.kind === "local" ? (
                  <span className="absolute inset-y-0 right-2 flex items-center">
                    <ProfileRowMenu
                      entry={entry}
                      deleteAvailability={deleteAvailabilityFor(entry)}
                      disabled={backgroundBusy}
                      onRename={() => setRenaming(entry)}
                      onDelete={() => setDeleting(entry)}
                    />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {/* `variant="outline"` so it carries the same `border-line-strong bg-card` surface the rows
          * do — it belongs to the local-profile group above it, not to the branded Cloud CTA below.
          * Disabled while a selection is in flight for the same reason the rows are disabled while a
          * create is: both mutations rewrite the same registry. Both spellings of disabled, matching
          * the rows and the Cloud button. */}
        <Button
          variant="outline"
          className="mt-section-gap"
          disabled={backgroundBusy}
          aria-disabled={backgroundBusy || undefined}
          onClick={() => void createEntry()}
          data-testid="picker-new-profile-button"
        >
          <Plus aria-hidden="true" />
          {t("datasets.newLocalProfile")}
        </Button>

        {/* The one remote action on this screen. It starts the same unchanged Cognito flow the app
          * has always used, carrying only the plain `Login` intent — the dataset it lands on is
          * resolved Rust-side after the callback, so this click sends nothing about any profile.
          * Disabled while either registry mutation is in flight for the same reason they disable
          * each other: the callback's own branch rewrites the registry too. */}
        <Button
          className="mt-section-gap"
          disabled={signIn.isPending || backgroundBusy}
          aria-disabled={signIn.isPending || backgroundBusy || undefined}
          onClick={() => void loginWithCloud()}
          data-testid="picker-login-cloud-button"
        >
          {t("datasets.loginWithCloud")}
        </Button>
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
