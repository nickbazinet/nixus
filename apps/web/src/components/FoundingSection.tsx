import { FoundingPitch } from "./FoundingPitch";

export function FoundingSection() {
  return (
    <div
      data-testid="founding-section"
      className="mkt-band-paper mkt-section-y"
    >
      <div className="mkt-page-x mx-auto max-w-[720px]">
        <FoundingPitch />
      </div>
    </div>
  );
}
