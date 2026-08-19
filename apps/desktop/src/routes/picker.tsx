import { createFileRoute } from "@tanstack/react-router";
import { DatasetPicker } from "@/components/picker/DatasetPicker";

// No beforeLoad of its own: the launch-time gate lives in `__root.tsx`, whose beforeLoad already ran
// before this route's would, so a second check here could only re-ask the same question.
export const Route = createFileRoute("/picker")({
  component: DatasetPicker,
});
