import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Lock, Send, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle, Button, Input, Label, Skeleton } from "@nixus/shared";
import { ChatMessageBubble } from "@/components/chat/ChatMessageBubble";
import { HOME_STARTER_KEYS } from "@/components/home/starters";
import { useHomeComposerAccess, type useHomeComposer } from "@/hooks/useHome";
import {
  hostedAiIsRetryable,
  hostedAiMessageKey,
  isHostedAiError,
  type ParsedAppError,
} from "@/lib/appError";
import type { HomeComposerAccess } from "@/lib/types";

export const HOME_COMPOSER_PANEL_ID = "home-composer-panel";


/** FR-11 states: the Composer is locked, with a reason that is not "try again". */
const LOCKED: Partial<Record<HomeComposerAccess, { title: string; body: string }>> = {
  local_profile: { title: "home.locked.localTitle", body: "home.locked.localBody" },
  signed_out: { title: "home.locked.premiumTitle", body: "home.locked.signedOutBody" },
  not_premium: { title: "home.locked.premiumTitle", body: "home.locked.premiumBody" },
  quota_exhausted: { title: "home.locked.quotaTitle", body: "home.locked.quotaBody" },
  reauthentication_required: { title: "home.locked.reauthTitle", body: "home.locked.reauthBody" },
};

function ComposerError({ error, onDismiss }: { error: ParsedAppError; onDismiss: () => void }) {
  const { t } = useTranslation();
  const hosted = isHostedAiError(error);
  const retryable = hosted ? hostedAiIsRetryable(error.code) : true;

  return (
    <Alert variant="caution" data-testid="home-composer-error">
      <AlertTitle>{hosted ? t(hostedAiMessageKey(error.code)) : t("home.composer.error")}</AlertTitle>
      <AlertDescription>
        {retryable ? t("home.composer.errorRetryable") : t("home.composer.errorFinal")}{" "}
        <button type="button" className="underline" onClick={onDismiss}>
          {t("home.composer.dismiss")}
        </button>
      </AlertDescription>
    </Alert>
  );
}

function AccessNotice({ state, onRetry }: { state: HomeComposerAccess; onRetry: () => void }) {
  const { t } = useTranslation();
  const locked = LOCKED[state];
  if (locked) {
    return (
      <Alert
        variant="info"
        icon={<Lock className="size-4" />}
        data-testid="home-composer-locked"
        data-state={state}
      >
        <AlertTitle>{t(locked.title)}</AlertTitle>
        <AlertDescription>{t(locked.body)}</AlertDescription>
      </Alert>
    );
  }

  // FR-7: a premium user hitting a transient hosted problem. The dashboard beside it still renders.
  return (
    <Alert variant="caution" data-testid="home-composer-unavailable">
      <AlertTitle>{t("home.unavailable.title")}</AlertTitle>
      <AlertDescription>
        {t("home.unavailable.body")}{" "}
        <button type="button" className="underline" onClick={onRetry}>
          {t("home.unavailable.retry")}
        </button>
      </AlertDescription>
    </Alert>
  );
}

/**
 * The docked chat half of Home: open is "chat mode", closed is "view mode". Docked rather than a
 * SlideOver on purpose — a confirmed change has to land in the dashboard beside it while the
 * conversation stays readable, so nothing here is modal and nothing is scrimmed.
 */
export function HomeComposerPanel({
  composer,
  onClose,
}: {
  composer: ReturnType<typeof useHomeComposer>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const access = useHomeComposerAccess();
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const state: HomeComposerAccess | undefined = access.isLoading
    ? undefined
    : (access.data ?? "unavailable");
  const canAsk = state === "available";

  useEffect(() => {
    if (canAsk) inputRef.current?.focus();
  }, [canAsk]);

  // Newest turn in view: the reply to what was just asked is the only thing the user is waiting on.
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [composer.messages]);

  const submit = (text: string) => {
    if (text.trim() === "" || composer.busy) return;
    void composer.send(text);
    setDraft("");
  };

  return (
    <aside
      id={HOME_COMPOSER_PANEL_ID}
      aria-labelledby="home-composer-panel-title"
      className="flex w-[380px] shrink-0 flex-col border-l border-line bg-card"
      data-testid="home-composer-panel"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 id="home-composer-panel-title" className="text-h3 text-ink">
            {t("home.panel.title")}
          </h2>
          <p className="mt-0.5 text-caption text-ink-dim">{t("home.panel.description")}</p>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onClose}
          aria-label={t("home.panel.close")}
          data-testid="home-composer-close"
        >
          <X aria-hidden="true" />
        </Button>
      </div>

      {/* role="log" without aria-live: each bubble announces its own sentences. */}
      <div
        ref={logRef}
        role="log"
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4"
        data-testid="home-composer-transcript"
      >
        {state === undefined ? (
          <Skeleton rows={2} data-testid="home-composer-loading" />
        ) : !canAsk ? (
          <AccessNotice state={state} onRetry={() => void access.refetch()} />
        ) : null}

        {canAsk && composer.messages.length === 0 && (
          <div className="flex flex-col gap-2" aria-label={t("home.starter.label")} role="group">
            <p className="text-caption text-ink-dim">{t("home.panel.intro")}</p>
            {HOME_STARTER_KEYS.map((key) => (
              <Button
                key={key}
                size="sm"
                variant="outline"
                className="h-auto justify-start py-2 text-left whitespace-normal"
                onClick={() => submit(t(key))}
              >
                {t(key)}
              </Button>
            ))}
          </div>
        )}

        {composer.messages.map((message, index) => (
          <ChatMessageBubble
            key={index}
            role={message.role}
            content={message.display ?? message.content}
            isStreaming={message.pending}
            actionHandled={message.actionHandled}
            actionOutcome={message.actionOutcome}
            onConfirm={(payload) => void composer.confirm(index, payload)}
            onCancel={(payload) => void composer.cancel(index, payload)}
          />
        ))}
      </div>

      <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
        {composer.error && <ComposerError error={composer.error} onDismiss={composer.clearError} />}
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit(draft);
          }}
        >
          <Label htmlFor="home-composer-input" className="sr-only">
            {t("home.composer.label")}
          </Label>
          <Input
            ref={inputRef}
            id="home-composer-input"
            className="min-w-0 flex-1"
            value={draft}
            maxLength={1000}
            placeholder={t("home.composer.placeholder")}
            onChange={(event) => setDraft(event.target.value)}
            disabled={!canAsk || composer.busy}
            data-testid="home-composer-input"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!canAsk || composer.busy || draft.trim() === ""}
            aria-label={t("home.composer.send")}
            data-testid="home-composer-send"
          >
            <Send aria-hidden="true" />
          </Button>
        </form>
      </div>
    </aside>
  );
}
