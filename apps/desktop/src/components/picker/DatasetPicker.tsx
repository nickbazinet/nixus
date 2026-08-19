import { useTranslation } from "react-i18next";
import { TriangleAlertIcon } from "lucide-react";
import {
  Alert,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Skeleton,
  focusRing,
} from "@nixus/shared";
import { SURFACE_HEADING_ID } from "@/components/shared/PageHeader";
import { useDatasets } from "@/hooks/useDatasets";
import { cn } from "@/lib/utils";

/**
 * The launch-time screen: which local dataset is about to be opened.
 *
 * Chrome-free by arrangement with `routes/__root.tsx`, which omits the rail, the top bar, the
 * destination nav, the chat bar, the update dialog and the account prompt on this path and hands the
 * surface the full main column. That is also why this component — not the shell's `<main>`, which is
 * `overflow-hidden` here — is the scroll container, and why it centres itself.
 */
export function DatasetPicker() {
  const { t } = useTranslation();
  const datasets = useDatasets();
  const entries = datasets.data ?? [];

  return (
    // `tabIndex={-1}` for the same reason the shell's `<main>` carries it: a keyboard user needs the
    // scroll region itself to be focusable, and on this route this element is that region.
    <div
      tabIndex={-1}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto px-page-x py-page-y"
      data-testid="dataset-picker"
    >
      {/* `m-auto`, not `justify-center`: centring a flex child with justify-content makes the
        * overflowing top unreachable once the list is taller than the window. */}
      <div className="m-auto flex w-full max-w-md flex-col">
        <div className="text-center">
          <span
            aria-hidden="true"
            className="mx-auto mb-5 block size-10 rounded-xl bg-logo-gradient"
          />
          {/* The shell's skip link and its route-change focus move both target this id, and this
            * surface renders no PageHeader, so it owns the heading contract itself. */}
          <h1
            id={SURFACE_HEADING_ID}
            data-surface-heading=""
            tabIndex={-1}
            className={cn("text-h1 text-ink", focusRing)}
          >
            {t("datasets.title")}
          </h1>
          <p className="mt-2 text-body text-ink-dim">{t("datasets.subtitle")}</p>
        </div>

        {datasets.isPending ? (
          <Card className="mt-section-gap" size="sm">
            <CardContent>
              <Skeleton rows={2} />
            </CardContent>
          </Card>
        ) : datasets.isError ? (
          // Stated rather than silent: a failed registry read and a registry with zero entries would
          // otherwise both render as "no rows", and the user could not tell "you have no profiles"
          // from "we could not find out". `Alert variant="over"` rather than `EmptyState` — an empty
          // state is styled never to read as broken, and it also carries `role="alert"`, so the
          // failure is announced. No retry: `bootstrap_registry` guarantees a valid file at startup,
          // so reaching here means the file changed underneath a running app, and a relaunch is the
          // honest remedy rather than a button that re-reads the same broken bytes.
          <Card flush className="mt-section-gap" data-testid="picker-load-error">
            <Alert variant="over" icon={<TriangleAlertIcon />}>
              <AlertTitle>{t("datasets.loadError")}</AlertTitle>
            </Alert>
          </Card>
        ) : entries.length > 0 ? (
          <ul
            className="mt-section-gap flex list-none flex-col gap-grid-gap p-0"
            data-testid="picker-dataset-list"
          >
            {entries.map((entry) => (
              <li key={entry.id}>
                {/* Presentational this story. Story 33.5 gives the rows their handler and button
                  * semantics; anything that looked activatable before then would be a dead control. */}
                <Card size="sm" data-testid="picker-dataset-row">
                  <CardContent>
                    <span className="text-label text-ink">{entry.label}</span>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        ) : null}

        {/* Present but inert until Epic 35 wires it. Both spellings of disabled: the native
          * attribute takes it out of the tab order, `aria-disabled` is what the shared Button's
          * dimmed treatment is keyed to, so a dim is never the only signal. */}
        <Button
          className="mt-section-gap"
          disabled
          aria-disabled="true"
          data-testid="picker-login-cloud-button"
        >
          {t("datasets.loginWithCloud")}
        </Button>
      </div>
    </div>
  );
}
