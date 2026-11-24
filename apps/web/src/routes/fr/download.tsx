import { createFileRoute } from "@tanstack/react-router";

import { DownloadPage } from "@/components/pages/DownloadPage";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/fr/download")({
  head: () => buildMeta({ page: "download", locale: "fr" }),
  component: () => <DownloadPage locale="fr" />,
});
