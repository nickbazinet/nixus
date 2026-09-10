import { CircleUser } from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserAvatar } from "@/lib/types";

interface AccountAvatarProps {
  /** `null`/`undefined` both mean "no picture", and both render the placeholder. */
  readonly avatar: UserAvatar | null | undefined;
  readonly premium: boolean;
  /** Tailwind size utility for the round frame, e.g. `size-6` or `size-20`. */
  readonly sizeClassName: string;
  /**
   * Accessible name for the picture. Pass `""` wherever the enclosing control already names the
   * account — a repeated name is noise, not information.
   */
  readonly alt: string;
  readonly imageTestId: string;
  readonly placeholderTestId: string;
}

/**
 * The account's face, round, at whatever size the surface needs — and the single place the Premium
 * treatment is derived.
 *
 * Shared rather than inlined twice for the reason `usePremiumEntitlementState` is shared: the
 * account trigger and `/profile` both paint this, and two components each deciding when the gold
 * ring appears is two chances to disagree, with the dangerous direction being an avatar that keeps
 * claiming Premium after the menu has stopped.
 *
 * The ring is a `border`, not a `ring`: `ring-*` compiles to `box-shadow`, so the resolved colour
 * would only be assertable by parsing a shadow string, whereas `borderColor` is directly comparable
 * to the computed `--premium-ink` — the same contract `Badge`'s premium variant already uses.
 *
 * `box-content` is what keeps that border from costing picture: Tailwind's preflight makes every
 * element `border-box`, so a 2px border on a `size-8` image would render 28px of face inside a 32px
 * frame — an entitled account would get a visibly SMALLER picture than an unentitled one. Sizing the
 * content box instead puts the ring outside the declared size, so the face is the same number of
 * pixels either way and only the outer footprint grows by 4px.
 *
 * A missing picture keeps the pre-existing `CircleUser` placeholder and its pre-existing gold
 * ICON treatment: an entitled account with no upload still reads as entitled, and nothing about
 * this feature was allowed to change that.
 */
export function AccountAvatar({
  avatar,
  premium,
  sizeClassName,
  alt,
  imageTestId,
  placeholderTestId,
}: AccountAvatarProps) {
  if (avatar === null || avatar === undefined) {
    return (
      <CircleUser
        aria-hidden="true"
        className={cn(sizeClassName, premium && "text-premium-ink")}
        data-testid={placeholderTestId}
      />
    );
  }

  return (
    <img
      src={`data:${avatar.mime_type};base64,${avatar.image_base64}`}
      alt={alt}
      className={cn(
        sizeClassName,
        "box-content rounded-full object-cover",
        premium && "border-2 border-premium-ink",
      )}
      data-testid={imageTestId}
      data-premium={premium ? "true" : undefined}
    />
  );
}
