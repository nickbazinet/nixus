import { Play } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

type TourPlayerProps = {
  readonly src: string;
  readonly poster?: string;
};

/**
 * The tour film with a play affordance of its own.
 *
 * Native controls alone are not enough here. Before it starts, the poster is a
 * screenshot of the app, and the page has already shown four of those; with only
 * a small control bar along the bottom edge it reads as a fifth and nobody
 * presses it. The overlay says "this moves" and makes the whole poster a target.
 *
 * `playing` is driven by the video's own events rather than by the click, so
 * starting from the native controls hides the overlay too, and finishing brings
 * it back. Native controls stay on throughout: seeking, pausing and fullscreen
 * are the browser's, which is also what keyboard and screen-reader users already
 * know how to operate.
 */
export function TourPlayer({ src, poster }: TourPlayerProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  const start = () => {
    const video = videoRef.current;
    if (video === null) return;
    // The overlay is about to unmount; hand focus to the video so keyboard users
    // land on the controls instead of the top of the document.
    video.focus();
    // A refused play() leaves the native controls visible, which is the retry.
    void video.play().catch(() => undefined);
  };

  return (
    <>
      <video
        ref={videoRef}
        data-testid="product-tour-video"
        src={src}
        poster={poster}
        controls
        playsInline
        preload="none"
        onPlay={() => setPlaying(true)}
        onEnded={() => setPlaying(false)}
        className="block size-full object-contain"
      >
        {t("tour.unsupported")}
      </video>
      {playing ? null : (
        <button
          type="button"
          data-testid="product-tour-play"
          aria-label={t("tour.play")}
          onClick={start}
          className="group absolute inset-0 flex items-center justify-center outline-none focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:ring-inset"
        >
          <span className="inline-flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-white/80 motion-safe:transition-transform motion-safe:duration-200 group-hover:motion-safe:scale-105 sm:size-20">
            <Play aria-hidden="true" className="ml-1 size-6 fill-current sm:size-7" />
          </span>
        </button>
      )}
    </>
  );
}
