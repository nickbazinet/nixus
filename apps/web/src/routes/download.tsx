import { createFileRoute } from "@tanstack/react-router";

import { DownloadPage } from "@/components/pages/DownloadPage";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/download")({
  head: () =>
    buildMeta({
      path: "/download",
      title: "Download Nixus for macOS and Windows",
      description: "Download Nixus for macOS or Windows. Free on your computer, no account needed.",
    }),
  component: DownloadPage,
});
