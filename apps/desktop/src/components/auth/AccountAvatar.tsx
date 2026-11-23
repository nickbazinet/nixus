import { User } from "lucide-react";
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
  /** Name the placeholder's initials are drawn from. Without one it shows a person glyph. */
  readonly name?: string | null;
}

/** "Nick Bazinet" -> "NB"; "nick@x.com" -> "N". At most two letters, always upper-case. */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? "")
    .split("@")[0]
    .split(/[\s._-]+/)
    .filter(Boolean);
  const letters =
    words.length >= 2 ? `${words[0][0]}${words[words.length - 1][0]}` : (words[0]?.[0] ?? "");
  return letters.toLocaleUpperCase();
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
 * A missing picture renders the charte's gradient monogram — the account's initials, or a person
 * glyph when there is no name — and keeps the gold treatment: an entitled account with no upload
 * still reads as entitled. The monogram's `color` is the premium ink (its own letters are painted
 * white), so the entitlement stays assertable on the placeholder exactly as before.
 */
export function AccountAvatar({
  avatar,
  premium,
  sizeClassName,
  alt,
  imageTestId,
  placeholderTestId,
  name,
}: AccountAvatarProps) {
  if (avatar === null || avatar === undefined) {
    const initials = initialsOf(name);
    return (
      <span
        aria-hidden="true"
        className={cn(
          sizeClassName,
          "@container inline-grid shrink-0 place-items-center rounded-full bg-logo-gradient font-display font-bold",
          premium && "box-content border-2 border-premium-ink text-premium-ink",
        )}
        data-testid={placeholderTestId}
      >
        {initials ? (
          <span className="text-[38cqw] leading-none text-white">{initials}</span>
        ) : (
          <User className="size-[55%] text-white" strokeWidth={2} />
        )}
      </span>
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
