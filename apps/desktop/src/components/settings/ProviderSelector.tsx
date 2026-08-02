import { useTranslation } from "react-i18next";
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
export function ProviderSelector({ value, onChange }: ProviderSelectorProps) {
  const { t } = useTranslation();

  return (
    <fieldset className="grid grid-cols-2 gap-3">
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
                "flex h-full cursor-pointer flex-col gap-1 rounded-lg border p-3 transition-colors",
                "peer-focus-visible:outline-2 peer-focus-visible:outline-focus-ring peer-focus-visible:outline-offset-2",
                selected
                  ? "border-brand bg-brand-soft"
                  : "border-line bg-card hover:bg-hover"
              )}
            >
              <span className={cn("text-label", selected ? "text-brand-ink" : "text-ink")}>
                {provider.label}
              </span>
              <span className="text-caption text-ink-dim">{t(provider.descriptionKey)}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
