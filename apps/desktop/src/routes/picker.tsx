import { createFileRoute } from "@tanstack/react-router";
import { DatasetPicker } from "@/components/picker/DatasetPicker";

/**
 * How the picker was reached. `switch` means the user came from "Switch profile" and is here to
 * change profiles, so the local list is open on arrival; an ordinary gated launch carries nothing and
 * keeps it collapsed.
 *
 * Declared on this route rather than on the root, which owns only `period`: this context has meaning
 * on exactly one surface, and a root-level param would ride along on every navigation in the app.
 */
type PickerSearch = {
  from?: "switch";
};

// No beforeLoad of its own: the launch-time gate lives in `__root.tsx`, whose beforeLoad already ran
// before this route's would, so a second check here could only re-ask the same question.
export const Route = createFileRoute("/picker")({
  // Anything other than the one known value is dropped rather than surfaced as an error: a hand-typed
  // or stale URL must still land on a usable launch screen, and the fallback is the launch default.
  validateSearch: (search: Record<string, unknown>): PickerSearch =>
    search.from === "switch" ? { from: "switch" } : {},
  component: PickerRoute,
});

// The route owns the arrival-context branch, so `DatasetPicker` stays search-agnostic — and reading
// the param here rather than inside the component avoids importing this route back into it.
function PickerRoute() {
  const { from } = Route.useSearch();

  return <DatasetPicker defaultLocalOpen={from === "switch"} />;
}
