import { cn } from "@/lib/utils";

interface ProviderSelectorProps {
  value: "bedrock" | "openai";
  onChange: (v: "bedrock" | "openai") => void;
}

const providers: { value: "bedrock" | "openai"; label: string; description: string }[] = [
  {
    value: "bedrock",
    label: "AWS Bedrock",
    description: "Use Claude via AWS Bedrock with IAM credentials",
  },
  {
    value: "openai",
    label: "OpenAI",
    description: "Use GPT models via OpenAI API key",
  },
];

export function ProviderSelector({ value, onChange }: ProviderSelectorProps) {
  return (
    <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="AI provider">
      {providers.map((provider) => {
        const selected = value === provider.value;
        return (
          <label
            key={provider.value}
            className={cn(
              "flex cursor-pointer flex-col gap-1 rounded-lg border p-4 transition-colors",
              selected
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground/50"
            )}
          >
            <input
              type="radio"
              className="sr-only"
              name="ai-provider"
              value={provider.value}
              checked={selected}
              onChange={() => onChange(provider.value)}
            />
            <span className="text-sm font-medium">{provider.label}</span>
            <span className="text-xs text-muted-foreground">{provider.description}</span>
          </label>
        );
      })}
    </div>
  );
}
