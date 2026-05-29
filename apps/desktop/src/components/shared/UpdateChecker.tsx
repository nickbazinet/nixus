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
} from "@nkbaz/shared";
import { Button } from "@nkbaz/shared";
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
          <DialogDescription>
            {stage === "downloading" ? (
              <span className="block mt-2">
                <span className="block h-2 w-full rounded-full bg-muted overflow-hidden">
                  <span
                    className="block h-full bg-primary rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </span>
                <span className="block text-xs text-muted-foreground mt-1 text-right">
                  {progress}%
                </span>
              </span>
            ) : (
              <span className="block mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs">
                {update.body || t("update.newVersion")}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

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
