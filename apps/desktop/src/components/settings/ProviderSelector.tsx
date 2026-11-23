import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

type Provider = "bedrock" | "openai";

interface ProviderSelectorProps {
  value: Provider;
  onChange: (v: Provider) => void;
}

const PROVIDERS: { value: Provider; label: string; descriptionKey: string }[] = [
  {
    value: "bedrock",
    label: "Amazon Bedrock",
    descriptionKey: "settings.providerBedrockDescription",
  },
  {
    value: "openai",
    label: "OpenAI",
    descriptionKey: "settings.providerOpenaiDescription",
  },
];

// Native radios, so grouping and arrow-key movement are the platform's. `focusRing` cannot go on a
// visually hidden input, so the ring is drawn on the visible card through `peer-focus-visible` with
// the same width, token, and offset the exported helper uses.
//
// The chosen provider wears the `featured` card treatment — a 2px violet border and the soft violet
// glow — because it is the answer to the question this group asks. The check mark carries it too,
// so the selection survives a user who cannot separate the violet border from the hairline.
export function ProviderSelector({ value, onChange }: ProviderSelectorProps) {
  const { t } = useTranslation();

  return (
    <fieldset className="grid gap-3 sm:grid-cols-2">
      <legend className="sr-only">{t("settings.providerLegend")}</legend>
      {PROVIDERS.map((provider) => {
        const selected = value === provider.value;
        return (
          <label key={provider.value}>
            <input
              type="radio"
              className="peer sr-only"
              name="ai-provider"
              value={provider.value}
              checked={selected}
              onChange={() => onChange(provider.value)}
            />
            <span
              className={cn(
                "flex h-full cursor-pointer flex-col gap-1 rounded-lg border bg-card p-4 transition-colors",
                "peer-focus-visible:outline-2 peer-focus-visible:outline-focus-ring peer-focus-visible:outline-offset-2",
                selected
                  ? "border-2 border-feature shadow-feature"
                  : "border-line hover:border-line-strong hover:bg-hover"
              )}
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "font-display text-h3",
                    selected ? "text-brand-ink" : "text-ink"
                  )}
                >
                  {provider.label}
                </span>
                {selected && (
                  <Check
                    aria-hidden="true"
                    className="size-4 shrink-0 icon-gradient"
                    strokeWidth={2.5}
                  />
                )}
              </span>
              <span className="text-caption text-ink-dim">
                {t(provider.descriptionKey)}
              </span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
