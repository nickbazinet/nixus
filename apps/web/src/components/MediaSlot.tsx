import { ImageIcon, PlayIcon } from "lucide-react";

/**
 * A product-media slot that renders either the real asset or a labelled
 * stand-in, chosen by whether `src` is set.
 *
 * The site ships ahead of its imagery: most showcase sections are written before
 * the screenshot or Canva render exists. Without this, those sections either get
 * commented out (and the layout is never verified at any breakpoint) or get a
 * grey box (which reads as a skeleton that never resolves — the exact failure
 * DESIGN.md's launch-surface note calls out). A stand-in that states its own
 * aspect ratio and intended subject keeps the composition honest and testable,
 * and turns adding the asset into a one-line content edit.
 *
 * `aspect` is required rather than defaulted: the whole point is that the
 * stand-in reserves the same space the real asset will occupy, so a slot without
 * a declared ratio would reflow the page the day the file lands.
 */

export type MediaSlotAspect = "16/10" | "16/9" | "4/3" | "1/1";

const ASPECT_CLASS: Record<MediaSlotAspect, string> = {
  "16/10": "aspect-[16/10]",
  "16/9": "aspect-[16/9]",
  "4/3": "aspect-[4/3]",
  "1/1": "aspect-square",
};

type MediaSlotProps = {
  readonly aspect: MediaSlotAspect;
  /** Absent until the asset exists; presence is what swaps the two renders. */
  readonly src?: string;
  /** Alt text for the real asset, and the stand-in's visible subject line. */
  readonly label: string;
  /** Shown only on the stand-in — what to produce for this slot. */
  readonly hint?: string;
  readonly kind?: "image" | "video";
  readonly loading?: "eager" | "lazy";
};

export function MediaSlot({
  aspect,
  src,
  label,
  hint,
  kind = "image",
  loading = "lazy",
}: MediaSlotProps) {
  if (src !== undefined) {
    if (kind === "video") {
      return (
        <video
          data-testid="media-slot-asset"
          src={src}
          aria-label={label}
          muted
          loop
          playsInline
          autoPlay
          className={`${ASPECT_CLASS[aspect]} h-auto w-full rounded-lg object-cover`}
        />
      );
    }
    return (
      <img
        data-testid="media-slot-asset"
        src={src}
        alt={label}
        loading={loading}
        decoding="async"
        className="h-auto w-full rounded-lg"
      />
    );
  }

  const Icon = kind === "video" ? PlayIcon : ImageIcon;

  return (
    <div
      data-testid="media-slot-placeholder"
      data-aspect={aspect}
      role="img"
      aria-label={label}
      className={`${ASPECT_CLASS[aspect]} flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong bg-track px-4 text-center`}
    >
      <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">{label}</p>
      {hint === undefined ? null : (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
      <p className="text-xs text-muted-foreground">{aspect}</p>
    </div>
  );
}
