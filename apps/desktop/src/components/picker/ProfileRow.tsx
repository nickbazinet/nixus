import { useTranslation } from "react-i18next";
import {
  Badge,
  Card,
  CardContent,
} from "@nixus/shared";
import { cn } from "@/lib/utils";
import type { Dataset } from "@/hooks/useDatasets";
import { ProfileRowMenu, type DeleteAvailability } from "./ProfileRowMenu";

interface ProfileRowProps {
  entry: Dataset;
  /**
   * Whether this is the profile the app already has open. Passed in rather than derived here so that
   * "which row is open" has exactly one answer on the screen, shared with the delete refusal below —
   * two independent derivations could disagree about the same row.
   */
  isOpen: boolean;
  deleteAvailability: DeleteAvailability;
  /** Set while any registry mutation is in flight, or a management panel is already open. */
  disabled: boolean;
  onSelect: () => void;
  onRename: () => void;
  onDelete: () => void;
}

/**
 * One registry entry as a selectable row, with a local profile's management menu overlaid on it.
 *
 * Split out of `DatasetPicker` so that surface owns the launch composition and this owns a row.
 */
export function ProfileRow({
  entry,
  isOpen,
  deleteAvailability,
  disabled,
  onSelect,
  onRename,
  onDelete,
}: ProfileRowProps) {
  const { t } = useTranslation();

  return (
    // `relative`, and the menu is a *sibling* of the Card overlaid on it rather than a child: the
    // Card's root element IS the row `<button>`, so a nested control would be a button inside a
    // button. Overlaying rather than laying the two out side by side is what keeps every row the same
    // full width as the buttons around it.
    <li className="relative">
      {/* `interactive` + `render={<button>}` is this repo's clickable-card convention
        * (GarageVehicleRow's shape): the Card's root element itself becomes the button, so the row is
        * one native focusable target. Nesting a button inside CardContent is the anti-pattern
        * card.tsx documents against, and `interactive` — not a hand-rolled className — is what
        * supplies hover and the focus ring. */}
      <Card
        size="sm"
        interactive
        render={
          <button
            type="button"
            // Every row, not only the clicked one, so a second row cannot race the first. Both
            // spellings, matching the Cloud button: the native attribute takes the row out of the tab
            // order, `aria-disabled` is what assistive tech reports, so a dim is never the only
            // signal.
            disabled={disabled}
            aria-disabled={disabled || undefined}
            onClick={onSelect}
          />
        }
        // `interactive` brings `cursor-pointer hover:bg-hover`, and both have to be cancelled while
        // the row is inert — a row that still lights up under the cursor reads as clickable when it
        // is not. `bg-card` is the Card's own base background. `w-full` is load-bearing: the Card's
        // root element IS the `<button>` here, and a form control shrink-to-fits even as a
        // block-level flex box, so without it every row would be exactly as wide as its own label.
        className="w-full disabled:cursor-default disabled:hover:bg-card"
        data-testid="picker-dataset-row"
      >
        <CardContent
          // Reserved for the overlaid management menu, so a long name never runs under it.
          className={cn("text-left", entry.kind === "local" && "pr-10")}
        >
          {/* `flex-wrap`, never `truncate`: the label is the user's own text, up to the 80 characters
            * rename allows, so it keeps wrapping and the mark drops onto its own line instead of
            * squeezing the name or sliding under the menu the `pr-10` above reserves room for. */}
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-label text-ink" data-testid="picker-dataset-label">
              {entry.label}
            </span>
            {/* A word, never a dot or an icon: this is the only thing telling two otherwise identical
              * rows apart, so it has to survive a user who cannot separate the brand tint from the
              * card. Inside the row button on purpose — a Badge is a label, not a control, so it adds
              * no second focus target and the word joins the button's own accessible name. */}
            {isOpen ? (
              <Badge variant="brand" data-testid="picker-active-badge">
                {t("datasets.currentProfileBadge")}
              </Badge>
            ) : null}
          </span>
        </CardContent>
      </Card>
      {/* Local profiles only: a cloud-linked profile's label is its account's and its deletion is out
        * of scope, so the whole menu is absent rather than present-and-refused. */}
      {entry.kind === "local" ? (
        <span className="absolute inset-y-0 right-2 flex items-center">
          <ProfileRowMenu
            entry={entry}
            deleteAvailability={deleteAvailability}
            disabled={disabled}
            onRename={onRename}
            onDelete={onDelete}
          />
        </span>
      ) : null}
    </li>
  );
}
