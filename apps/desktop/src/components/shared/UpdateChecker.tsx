import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { Components, Options } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nixus/shared";
import { Button, Meter, focusRing } from "@nixus/shared";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// GitHub release bodies are GFM (see scripts/generate-release-notes.mjs). singleTilde stays off for
// the same reason it is off in chat: a lone `~` means "approximately" or a home-directory path far
// more often than it opens a strikethrough.
const remarkPlugins: Options["remarkPlugins"] = [[remarkGfm, { singleTilde: false }]];

// Keep the scrollbar thin and token-driven in engines that paint it; overlay-scrollbar engines may
// hide the thumb at rest, so the responsive height cap below also keeps typical releases visible.
const notesScrollbar =
  "[scrollbar-width:thin] [scrollbar-color:var(--line-strong)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-line-strong";

type Stage = "idle" | "available" | "downloading" | "ready";

export function UpdateChecker() {
  const { t } = useTranslation();
  const [stage, setStage] = useState<Stage>("idle");
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState(0);
  const dismissRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;

    check()
      .then((u) => {
        if (!cancelled && u) {
          setUpdate(u);
          setStage("available");
        }
      })
      .catch((err) => {
        console.warn("Update check failed:", err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleUpdate() {
    if (!update || stage !== "available") return;
    setStage("downloading");
    setProgress(0);

    try {
      let downloaded = 0;
      let contentLength = 0;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            setProgress(0);
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              setProgress(
                Math.round((downloaded / contentLength) * 100)
              );
            }
            break;
          case "Finished":
            setProgress(100);
            break;
        }
      });

      setStage("ready");
      await relaunch();
    } catch (err) {
      setStage("idle");
      toast.error(t("update.failed"));
      console.error("Update download failed:", err);
    }
  }

  if (stage === "idle" || !update) return null;

  // A release with no notes sends the field absent, but a hand-edited GitHub body can also arrive as
  // whitespace, which Markdown would render as an empty region rather than falling back.
  const releaseNotes = update.body?.trim();

  return (
    <Dialog open onOpenChange={() => stage === "available" && setStage("idle")}>
      {/* Base UI focuses the first tabbable descendant, which a release body containing a link makes
        * the link — and the browser then scrolls the notes past their own first heading. Naming the
        * dismiss button keeps the changelog at its top and the opening focus off the destructive
        * path, whatever the body happens to contain. */}
      <DialogContent showCloseButton={stage === "available"} initialFocus={dismissRef}>
        <DialogHeader>
          <DialogTitle>
            {stage === "ready"
              ? t("update.restarting")
              : stage === "downloading"
                ? t("update.downloading")
                : `${t("update.available")} — v${update.version}`}
          </DialogTitle>
          {/* Two elements, not one. The scroll box owns the keyboard affordance and needs a name, but
            * an aria-label on the aria-describedby target REPLACES the description — the dialog would
            * announce "Update available" instead of the changelog (measured). So the labelled region
            * scrolls, and DialogDescription sits inside it holding the text. `render` swaps its <p>
            * for a <div> because headings and lists cannot legally nest in a paragraph. */}
          <div
            role="region"
            tabIndex={0}
            aria-label={t("update.available")}
            className={cn(
              "max-h-[min(50vh,24rem)] overflow-y-auto wrap-anywhere pr-1",
              notesScrollbar,
              focusRing
            )}
            data-testid="update-release-notes"
          >
            <DialogDescription render={<div />}>
              {releaseNotes ? (
                <ReactMarkdown remarkPlugins={remarkPlugins} components={releaseNoteComponents}>
                  {releaseNotes}
                </ReactMarkdown>
              ) : (
                t("update.newVersion")
              )}
            </DialogDescription>
          </div>
        </DialogHeader>

        {stage === "downloading" && (
          <div className="flex flex-col gap-1">
            {/* The meter is never the only indicator: the percentage below it is the paired figure. */}
            <Meter
              value={progress}
              label={t("update.downloading")}
              valueText={`${progress}%`}
            />
            <span className="text-right text-caption text-ink-dim">{progress}%</span>
          </div>
        )}

        {stage === "available" && (
          <DialogFooter>
            <Button variant="outline" ref={dismissRef} onClick={() => setStage("idle")}>
              {t("update.notNow")}
            </Button>
            <Button onClick={handleUpdate}>{t("update.updateRestart")}</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

// DialogTitle is the h2, so every release-note heading renders one level under it whatever `#` depth
// the body happens to use — a changelog has no meaningful sub-hierarchy to lose.
function ReleaseNoteHeading({ children }: { children?: ReactNode }) {
  return <h3 className="mt-3 mb-1 text-h3 text-ink first:mt-0">{children}</h3>;
}

const releaseNoteComponents: Components = {
  h1: ReleaseNoteHeading,
  h2: ReleaseNoteHeading,
  h3: ReleaseNoteHeading,
  h4: ReleaseNoteHeading,
  h5: ReleaseNoteHeading,
  h6: ReleaseNoteHeading,
  // pre-wrap is what keeps a plain-text release body readable: Markdown folds a single newline into
  // a space, so without it every hand-written line runs into the next.
  p: ({ children }) => <p className="mb-2 whitespace-pre-wrap last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="text-label text-ink">{children}</strong>,
  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-0.5 last:mb-0">{children}</ul>,
  ol: ({ children }) => (
    <ol className="mb-2 ml-4 list-decimal space-y-0.5 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="whitespace-pre-wrap">{children}</li>,
  code: ({ children }) => (
    <code className="rounded-sm bg-track px-1 py-0.5 font-mono text-caption">{children}</code>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-brand-ink underline underline-offset-2"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
};
