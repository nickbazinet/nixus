import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { format, subMonths } from "date-fns";
import { fr as frLocale } from "date-fns/locale";
import { ArrowUp, Sparkles } from "lucide-react";
import { Button, Card, Eyebrow, Input, Label, focusRing } from "@nixus/shared";
import { cn } from "@/lib/utils";
import { ChatMessageBubble } from "./ChatMessageBubble";
import { useChat } from "@/hooks/useChat";
import { getLastUsedAgentId, useAgents } from "@/lib/agents";

interface FloatingChatBarProps {
  open: boolean;
  onClose: () => void;
}

export function FloatingChatBar({ open, onClose }: FloatingChatBarProps) {
  const { t, i18n } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<Element | null>(null);
  const [input, setInput] = useState("");

  const { agents } = useAgents();

  // Re-read localStorage each time the bar opens so agent name stays in sync
  const lastUsedAgentId = useMemo(() => getLastUsedAgentId(), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  /* Resolved against the fetched list, and it is the resolved id — not the stored one — that
   * drives the chat: `build_system_prompt` now rejects an unknown agent id, so a stale
   * localStorage value must not reach `send_chat_message`. */
  const agent = agents.find((a) => a.id === lastUsedAgentId) ?? agents[0];
  const agentName = t(agent.nameKey);

  const dateLocale = i18n.language.startsWith("fr") ? frLocale : undefined;
  const today = useMemo(() => new Date(), []);
  const freshnessDate = format(today, "PPP", { locale: dateLocale });
  const previousMonth = format(subMonths(today, 1), "LLLL", { locale: dateLocale });

  /* Mounted app-wide but only live while open: without this it would keep listening to the
   * app-global stream events behind a chat route that owns the turn (R3). */
  const { messages, streaming, sendMessage, confirmAction, cancelAction } = useChat({
    agentId: agent.id,
    enabled: open,
  });

  // Capture previous focus and auto-focus input
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement;
      setTimeout(() => inputRef.current?.focus(), 50);
    } else if (previousFocusRef.current instanceof HTMLElement) {
      previousFocusRef.current.focus();
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const handleSend = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (trimmed !== "" && !streaming) {
        sendMessage(trimmed);
        setInput("");
      }
    },
    [streaming, sendMessage]
  );

  if (!open) return null;

  // Show only the latest query/response pair
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const lastAiMsg = [...messages].reverse().find((m) => m.role === "assistant");
  const hasHistory = lastUserMsg !== undefined || lastAiMsg !== undefined;

  const starterPrompts = agent.starterKeys.map((key) => t(key, { month: previousMonth }));
  const sendDisabled = streaming || input.trim() === "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="floating-chat-overlay"
    >
      <div className="fixed inset-0 bg-scrim" aria-hidden="true" />
      {/* The command bar is a floating layer, which is the one place DESIGN.md permits a shadow —
        * `shadow-float` and the dialog radius are the {components.dialog} recipe, not a card
        * override. */}
      <Card
        flush
        role="dialog"
        aria-modal="true"
        aria-label={t("chat.quickChat")}
        className="relative z-50 w-full max-w-xl rounded-2xl shadow-float"
        data-testid="floating-chat-bar"
      >
        <div className="px-card-pad pt-5">
          <Eyebrow data-testid="agent-label-chip">
            {t("chat.currentAgent", { agentName })}
          </Eyebrow>

          {/* The same pill the full composer uses: gradient spark, borderless field, gradient
            * round send. On the white panel the pill takes the page tone so it still reads as a box. */}
          <div className="mt-4 flex items-center gap-2 rounded-full border border-line bg-page py-2 pr-2 pl-4 focus-within:border-brand/40">
            <Sparkles
              aria-hidden="true"
              className="icon-gradient size-[18px] shrink-0"
              strokeWidth={1.75}
            />
            <Label htmlFor="floating-chat-input" className="sr-only">
              {t("chat.quickPlaceholder")}
            </Label>
            <Input
              id="floating-chat-input"
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend(input);
                }
              }}
              placeholder={t("chat.quickPlaceholder")}
              disabled={streaming}
              aria-disabled={streaming || undefined}
              className="h-8 border-0 bg-transparent px-0 focus-visible:outline-0"
              data-testid="floating-chat-input"
            />
            <kbd
              className="shrink-0 rounded-full border border-line bg-card px-2 py-0.5 text-micro text-ink-dim"
              data-testid="esc-badge"
            >
              {t("chat.escHint")}
            </kbd>
            <Button
              size="icon"
              className="shrink-0"
              onClick={() => handleSend(input)}
              disabled={sendDisabled}
              aria-disabled={sendDisabled || undefined}
              aria-label={t("chat.send")}
              data-testid="floating-chat-send-button"
            >
              <ArrowUp aria-hidden="true" />
            </Button>
          </div>
        </div>

        {hasHistory ? (
          <div className="mt-4 max-h-72 space-y-3 overflow-y-auto border-t border-line px-card-pad py-4">
            {lastUserMsg && <ChatMessageBubble role="user" content={lastUserMsg.content} />}
            {lastAiMsg && (
              <ChatMessageBubble
                role="assistant"
                content={lastAiMsg.content}
                isStreaming={streaming}
                actionHandled={lastAiMsg.actionHandled}
                actionOutcome={lastAiMsg.actionOutcome}
                onConfirm={(payload) => confirmAction(messages.indexOf(lastAiMsg), payload)}
                onCancel={(payload) => cancelAction(messages.indexOf(lastAiMsg), payload)}
              />
            )}
          </div>
        ) : (
          // A blank box right after being told AI is a headline feature makes the user guess.
          <div className="px-card-pad pt-4 pb-1">
            <p className="text-caption text-ink-dim">{t("chat.starterPromptsLabel")}</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {starterPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => handleSend(prompt)}
                  className={cn(
                    "min-h-target-min rounded-full border border-line-strong bg-card px-3.5 py-1.5 text-caption text-ink transition-colors hover:border-brand/40 hover:bg-hover",
                    focusRing
                  )}
                  data-testid="chat-starter-prompt"
                >
                  {prompt}
                </button>
              ))}
            </div>
            <p className="mt-4 text-caption text-ink-faint">{t(agent.scopeKey)}</p>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-line px-card-pad py-2.5">
          {/* Changing the URL is a link, not a button: it has to survive cmd-click and
            * "copy link address", and assistive tech must announce it as navigation. */}
          <Button
            variant="link"
            size="sm"
            role="link"
            render={
              <Link
                to="/ai/$agentId"
                params={{ agentId: lastUsedAgentId }}
                onClick={onClose}
              />
            }
            data-testid="open-full-chat-link"
          >
            {t("chat.openFullChat")}
          </Button>
          <p className="text-caption text-ink-faint" data-testid="chat-freshness">
            {t("chat.freshness", { date: freshnessDate })}
          </p>
        </div>
      </Card>
    </div>
  );
}
