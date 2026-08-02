import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nixus/shared";
import { Button, Meter } from "@nixus/shared";
import { toast } from "sonner";

type Stage = "idle" | "available" | "downloading" | "ready";

export function UpdateChecker() {
  const { t } = useTranslation();
  const [stage, setStage] = useState<Stage>("idle");
  const [update, setUpdate] = useState<Update | null>(null);
  const [progress, setProgress] = useState(0);

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

  return (
    <Dialog open onOpenChange={() => stage === "available" && setStage("idle")}>
      <DialogContent showCloseButton={stage === "available"}>
        <DialogHeader>
          <DialogTitle>
            {stage === "ready"
              ? t("update.restarting")
              : stage === "downloading"
                ? t("update.downloading")
                : `${t("update.available")} — v${update.version}`}
          </DialogTitle>
          <DialogDescription className="max-h-40 overflow-y-auto whitespace-pre-wrap">
            {update.body || t("update.newVersion")}
          </DialogDescription>
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
            <Button variant="outline" onClick={() => setStage("idle")}>
              {t("update.notNow")}
            </Button>
            <Button onClick={handleUpdate}>{t("update.updateRestart")}</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
