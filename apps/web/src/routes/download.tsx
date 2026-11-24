import { createFileRoute } from "@tanstack/react-router";

import { DownloadPage } from "@/components/pages/DownloadPage";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/download")({
  head: () => buildMeta({ page: "download", locale: "en" }),
  component: () => <DownloadPage locale="en" />,
});
