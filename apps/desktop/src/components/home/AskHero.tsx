import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Send, Sparkles } from "lucide-react";
import { Button, Card, CardContent, Input, Label } from "@nixus/shared";
import { HOME_STARTER_KEYS } from "@/components/home/starters";
import { HomeAccessNotice } from "@/components/home/HomeAccessNotice";
import { useTypewriterPlaceholder } from "@/hooks/useTypewriterPlaceholder";
import type { HomeComposerAccess } from "@/lib/types";

/**
 * The AI-first entry point: one prompt, front and centre, that hands its text to the docked
 * composer. The input field is framed in the Nixus logo gradient by explicit product decision — a deliberate
 * exception to DESIGN.md's "never on a surface" rule, scoped to this one AI entry point. The frame
 * is a padded gradient wrapper around the field (not the card) rather than `border-image`, which cannot follow a rounded corner.
 */
export function AskHero({
  access,
  busy,
  onAsk,
  onRetry,
}: {
  access: HomeComposerAccess | undefined;
  busy: boolean;
  onAsk: (text: string) => void;
  onRetry: () => void;
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
    <div className="mb-4" data-testid="home-ask-hero">
      <Card>
        <CardContent className="flex flex-col gap-3">
          {/* The icon and the send button sit inside the field, so the prompt reads as one control. */}
          <form
            className="relative flex items-center rounded-lg bg-logo-gradient p-[3px] focus-within:bg-none"
            onSubmit={(event) => {
              event.preventDefault();
              submit(draft);
            }}
          >
            <Sparkles
              aria-hidden="true"
              className="pointer-events-none absolute left-[18px] z-10 size-5 text-brand-ink"
            />
            <Label htmlFor="home-ask-input" className="sr-only">
              {t("home.hero.label")}
            </Label>
            <Input
              id="home-ask-input"
              className="h-12 min-w-0 flex-1 rounded-[calc(var(--radius-lg)-3px)] border-0 pr-14 pl-11 text-body"
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
              size="icon"
              className="absolute right-3 z-10"
              disabled={!canAsk || busy || draft.trim() === ""}
              aria-label={t("home.composer.send")}
              data-testid="home-ask-send"
            >
              <Send aria-hidden="true" />
            </Button>
          </form>

          {access === undefined ? (
            <p className="text-caption text-ink-dim" data-testid="home-ask-hint">
              {t("common.loading")}
            </p>
          ) : (
            !canAsk && (
              <HomeAccessNotice
                state={access}
                onRetry={onRetry}
                data-testid="home-ask-hint"
              />
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}
