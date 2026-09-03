import { FoundingPitch } from "./FoundingPitch";

export function FoundingSection() {
  return (
    <div
      data-testid="founding-section"
      className="mkt-section-y border-y border-border bg-accent/40 dark:bg-background"
    >
      <div className="mkt-page-x mx-auto max-w-[720px]">
        <FoundingPitch />
      </div>
    </div>
  );
}
