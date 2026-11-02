import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Lock, Send, Sparkles } from "lucide-react";
import { Button, Card, CardContent, Input, Label } from "@nixus/shared";
import { HOME_STARTER_KEYS } from "@/components/home/starters";
import { useTypewriterPlaceholder } from "@/hooks/useTypewriterPlaceholder";
import type { HomeComposerAccess } from "@/lib/types";

/**
 * The AI-first entry point: one prompt, front and centre, that hands its text to the docked
 * composer. Framed in the Nixus logo gradient by explicit product decision — a deliberate
 * exception to DESIGN.md's "never on a surface" rule, scoped to this one AI entry point. The frame
 * is a padded gradient wrapper rather than `border-image`, which cannot follow a rounded corner.
 */
export function AskHero({
  access,
  busy,
  onAsk,
}: {
  access: HomeComposerAccess | undefined;
  busy: boolean;
  onAsk: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const canAsk = access === "available";
  // The example asks write themselves into the empty field, after the generic invitation.
  const phrases = useMemo(
    () => [t("home.hero.placeholder"), ...HOME_STARTER_KEYS.map((key) => t(key))],
    [t]
  );
  const placeholder = useTypewriterPlaceholder(phrases, canAsk && !focused && draft === "");
  const locked = access !== undefined && access !== "available" && access !== "unavailable";

  const submit = (text: string) => {
    if (!canAsk || busy || text.trim() === "") return;
    onAsk(text);
    setDraft("");
  };

  return (
    <div className="mb-4 rounded-lg bg-logo-gradient p-[3px]" data-testid="home-ask-hero">
      <Card className="rounded-[calc(var(--radius-lg)-3px)] border-0">
        <CardContent className="flex flex-col gap-3">
          {/* The icon and the send button sit inside the field, so the prompt reads as one control. */}
          <form
            className="relative flex items-center"
            onSubmit={(event) => {
              event.preventDefault();
              submit(draft);
            }}
          >
            <Sparkles
              aria-hidden="true"
              className="pointer-events-none absolute left-3.5 size-5 text-brand-ink"
            />
            <Label htmlFor="home-ask-input" className="sr-only">
              {t("home.hero.label")}
            </Label>
            <Input
              id="home-ask-input"
              className="h-12 min-w-0 flex-1 pr-14 pl-11 text-body"
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
              className="absolute right-2"
              disabled={!canAsk || busy || draft.trim() === ""}
              aria-label={t("home.composer.send")}
              data-testid="home-ask-send"
            >
              <Send aria-hidden="true" />
            </Button>
          </form>

          {!canAsk && (
            <p
              className="flex items-center gap-2 text-caption text-ink-dim"
              data-testid="home-ask-hint"
            >
              {locked && <Lock className="size-3.5 shrink-0" aria-hidden="true" />}
              {access === undefined
                ? t("common.loading")
                : access === "local_profile"
                  ? t("home.hero.localProfile")
                  : locked
                  ? t("home.hero.locked")
                  : t("home.unavailable.body")}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
