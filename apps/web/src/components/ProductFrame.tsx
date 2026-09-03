import type { ReactNode } from "react";

/**
 * Warm Editorial product frame.
 *
 * The one place on the marketing site permitted to carry warm elevation. Per
 * DESIGN.md "Marketing — Warm Editorial" exception 3, the recipe is fixed
 * inside this component under the `mkt-product-frame` class and **no call site
 * may override it** — which is why this component deliberately exposes no
 * `className` or style prop. A call site that needs a measure or centering
 * wraps the frame instead of restyling it.
 *
 * Product imagery is never cropped: the image keeps its natural dimensions via
 * `h-auto w-full`, and the frame uses padding as a mat rather than clipping, so
 * no `object-*`, `aspect-*`, or `overflow-*` treatment appears here at all.
 */

/** Natural-aspect product image plus its visible caption. */
type ProductFrameImage = {
  readonly kind: "image";
  readonly src: string;
  readonly alt: string;
  /** Visible caption; also names the figure through `aria-labelledby`. */
  readonly caption: string;
  readonly loading?: "eager" | "lazy";
};

/** Framed live product content (for example the animated AI demo). */
type ProductFrameContent = {
  readonly kind: "content";
  /** Names the figure, since framed content has no caption to name it. */
  readonly label: string;
  readonly children: ReactNode;
};

type ProductFrameProps = {
  readonly id: string;
} & (ProductFrameImage | ProductFrameContent);

/**
 * The warm elevation recipe plus the mat. `p-*` is the mat: it is what lets the
 * frame round its corners without an `overflow` clip that could crop content.
 */
const FRAME_CLASS =
  "mkt-product-frame rounded-xl border border-border bg-card p-2 sm:p-3";

export function ProductFrame(props: ProductFrameProps) {
  switch (props.kind) {
    case "image": {
      const captionId = `${props.id}-caption`;
      return (
        <figure
          id={props.id}
          aria-labelledby={captionId}
          data-testid={props.id}
          className={FRAME_CLASS}
        >
          <img
            src={props.src}
            alt={props.alt}
            loading={props.loading ?? "lazy"}
            className="h-auto w-full rounded-lg"
          />
          <figcaption
            id={captionId}
            className="px-1 pb-1 pt-3 text-sm text-muted-foreground sm:px-2"
          >
            {props.caption}
          </figcaption>
        </figure>
      );
    }
    case "content":
      return (
        <figure
          id={props.id}
          aria-label={props.label}
          data-testid={props.id}
          className={FRAME_CLASS}
        >
          {props.children}
        </figure>
      );
  }
}
