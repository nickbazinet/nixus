import { useTranslation } from "react-i18next";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@nixus/shared";
import type { Dataset } from "@/hooks/useDatasets";

/**
 * Whether a row may offer deletion, and when it may not, why.
 *
 * Three states rather than a boolean because the two refusals are not interchangeable: `refused-active`
 * never lifts for this row until the user opens a different profile, while `refused-unknown` clears on
 * its own the moment the backend answers which profile is open. Telling the user to act when they only
 * had to wait is the failure a shared "disabled" would produce.
 *
 * `refused-unknown` is also what makes the picker fail *closed*: until the open profile is known, no
 * row can be shown to be safe to delete, so none offers it.
 */
export type DeleteAvailability = "allowed" | "refused-active" | "refused-unknown";

type DeleteRefusal = Exclude<DeleteAvailability, "allowed">;

/**
 * A `Record` over the refusal variants rather than a switch: adding a refusal to the union makes this
 * a compile error, so a new reason can never silently render an empty hint.
 */
const DELETE_REFUSAL_HINT: Record<DeleteRefusal, string> = {
  "refused-active": "datasets.deleteProfileActiveHint",
  "refused-unknown": "datasets.deleteProfileUnknownHint",
};

interface ProfileRowMenuProps {
  entry: Dataset;
  /** Whether this row may be deleted, and otherwise which reason to show. */
  deleteAvailability: DeleteAvailability;
  /** Set while any registry mutation is in flight, or a panel is already open. */
  disabled: boolean;
  onRename: () => void;
  onDelete: () => void;
}

/**
 * The one management affordance a local row carries: rename as an ordinary item, delete demoted
 * below a separator and marked destructive. That grouping is this repo's row convention
 * (AccountRow's and AssetRow's overflow menus) and exists so an irreversible action is never a
 * visual peer of a harmless one.
 *
 * Rendered only for local profiles by its caller, so a cloud-linked row has no menu at all — its
 * label belongs to the account it is linked to and its deletion is out of scope here.
 *
 * Delete is *omitted* for Default rather than disabled: Default's directory is the app data root
 * itself, so its removal is not a restriction the user could ever lift, and an item that can never
 * become available is noise. Every other refusal is a disabled item *with* its reason.
 *
 * Rename is never gated on the active id, because a rename does not depend on which profile is open.
 *
 * None of this is authority: `delete_dataset` re-checks every restriction Rust-side, so a stale
 * render or a direct IPC call is refused all the same.
 */
export function ProfileRowMenu({
  entry,
  deleteAvailability,
  disabled,
  onRename,
  onDelete,
}: ProfileRowMenuProps) {
  const { t } = useTranslation();
  const deletable = !entry.is_default;
  const refusal: DeleteRefusal | null =
    deleteAvailability === "allowed" ? null : deleteAvailability;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-ink-dim hover:text-ink"
            // Both spellings, matching every other control on this screen: the native attribute
            // takes the trigger out of the tab order, `aria-disabled` is what assistive tech
            // reports, so a dim is never the only signal.
            disabled={disabled}
            aria-disabled={disabled || undefined}
            aria-label={t("datasets.profileActions", { name: entry.label })}
            data-testid="picker-profile-menu"
          />
        }
      >
        <MoreHorizontal aria-hidden="true" />
      </DropdownMenuTrigger>
      {/* The floor is load-bearing, the same way ProfileMenu's panel width is: DropdownMenuContent
        * is `w-(--anchor-width) min-w-32`, so anchored to this icon button it collapses to the 128px
        * floor — narrower than either action label once the icon and padding are taken out, which is
        * what breaks them onto two lines. `min-w-48` clears the longest of them in both locales.
        *
        * A minimum and not a fixed width, and set here rather than on the items, so the refusal hint
        * below keeps wrapping inside it: the hint is prose and reads as prose, while an action label
        * is `whitespace-nowrap` because a label broken mid-phrase reads as two actions. */}
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem
          onClick={onRename}
          className="whitespace-nowrap"
          data-testid="picker-rename-button"
        >
          <Pencil aria-hidden="true" />
          {t("datasets.renameProfile")}
        </DropdownMenuItem>
        {deletable ? (
          <>
            <DropdownMenuSeparator />
            {/* Grouped so the hint below is Base UI's `GroupLabel` for this item rather than a loose
              * line of text: that is what associates the reason with the control it explains for a
              * screen reader, and `GroupLabel` throws outside a `Group` besides. */}
            <DropdownMenuGroup>
              <DropdownMenuItem
                variant="destructive"
                disabled={refusal !== null}
                onClick={onDelete}
                className="whitespace-nowrap"
                data-testid="picker-delete-button"
              >
                <Trash2 aria-hidden="true" />
                {t("datasets.deleteProfile")}
              </DropdownMenuItem>
              {/* The reason, not just the dim: a disabled control with nothing explaining it is
                * indistinguishable from a broken one. `data-reason` carries the machine-readable
                * variant so a test pins which refusal fired rather than matching its prose. */}
              {refusal !== null ? (
                <DropdownMenuLabel
                  data-reason={refusal}
                  data-testid="picker-delete-refusal-hint"
                >
                  {t(DELETE_REFUSAL_HINT[refusal])}
                </DropdownMenuLabel>
              ) : null}
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
