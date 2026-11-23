import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button, Card, Eyebrow, Input, Label } from "@nixus/shared";
import { HOME_STARTER_KEYS } from "@/components/home/starters";
import { HomeAccessNotice } from "@/components/home/HomeAccessNotice";
import { useTypewriterPlaceholder } from "@/hooks/useTypewriterPlaceholder";
import type { HomeComposerAccess } from "@/lib/types";

/**
 * The AI-first entry point: one prompt, front and centre on the glass panel, that hands its text
 * to the docked composer. The field itself is a white pill raised off the glass — the brand
 * gradient is carried by the sparkle and the Ask button, which is where the action is, rather than
 * by a frame around a surface.
 *
 * `children` is the row of starting points under the field: the real upkeep links, kept beside the
 * prompt so the panel offers something to do whether or not the user wants to type.
 */
export function AskHero({
  access,
  busy,
  onAsk,
  onRetry,
  children,
}: {
  access: HomeComposerAccess | undefined;
  busy: boolean;
  onAsk: (text: string) => void;
  onRetry: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const canAsk = access === "available" || access === "available_byo";
  // The example asks write themselves into the empty field, after the generic invitation.
  const phrases = useMemo(
    () => [t("home.hero.placeholder"), ...HOME_STARTER_KEYS.map((key) => t(key))],
    [t]
  );
  const placeholder = useTypewriterPlaceholder(phrases, canAsk && !focused && draft === "");

  /* No agent picker, by design: one prompt, and the backend works out which agent the ask
   * belongs to. The user should never have to know the roster exists. */
  const submit = (text: string) => {
    if (!canAsk || busy || text.trim() === "") return;
    onAsk(text);
    setDraft("");
  };

  return (
    <Card
      tone="glass"
      className="mb-section-gap gap-0 px-card-pad"
      data-testid="home-ask-hero"
    >
      <Eyebrow>{t("home.panel.title")}</Eyebrow>

      {/* The sparkle and the Ask button sit inside the pill, so the prompt reads as one control. */}
      <form
        className="mt-4 flex items-center gap-2 rounded-full border border-transparent bg-card py-1.5 pr-1.5 pl-4 transition-colors focus-within:border-brand/50"
        onSubmit={(event) => {
          event.preventDefault();
          submit(draft);
        }}
      >
        <Sparkles aria-hidden="true" className="icon-gradient size-5 shrink-0" strokeWidth={1.75} />
        <Label htmlFor="home-ask-input" className="sr-only">
          {t("home.hero.label")}
        </Label>
        <Input
          id="home-ask-input"
          className="h-9 min-w-0 flex-1 border-0 bg-transparent px-0 text-body shadow-none focus-visible:outline-none"
          value={draft}
          maxLength={1000}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          disabled={!canAsk || busy}
          data-testid="home-ask-input"
        />
        <Button
          type="submit"
          disabled={!canAsk || busy || draft.trim() === ""}
          aria-label={t("home.composer.send")}
          data-testid="home-ask-send"
        >
          {t("home.v2.ask")}
          <ArrowRight data-icon="inline-end" aria-hidden="true" />
        </Button>
      </form>

      {children && <div className="mt-4">{children}</div>}

      {access === undefined ? (
        <p className="mt-3 text-caption text-ink-dim" data-testid="home-ask-hint">
          {t("common.loading")}
        </p>
      ) : (
        !canAsk && (
          <HomeAccessNotice
            state={access}
            onRetry={onRetry}
            className="mt-3"
            data-testid="home-ask-hint"
          />
        )
      )}
    </Card>
  );
}
