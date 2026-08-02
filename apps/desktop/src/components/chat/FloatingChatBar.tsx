import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { format, subMonths } from "date-fns";
import { fr as frLocale } from "date-fns/locale";
import { MessageSquare } from "lucide-react";
import { Button, Card, Input, Label, focusRing } from "@nixus/shared";
import { cn } from "@/lib/utils";
import { ChatMessageBubble } from "./ChatMessageBubble";
import { useChat } from "@/hooks/useChat";
import { getLastUsedAgentId, AGENTS } from "@/lib/agents";

interface FloatingChatBarProps {
  open: boolean;
  onClose: () => void;
}

export function FloatingChatBar({ open, onClose }: FloatingChatBarProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<Element | null>(null);
  const [input, setInput] = useState("");

  // Re-read localStorage each time the bar opens so agent name stays in sync
  const lastUsedAgentId = useMemo(() => getLastUsedAgentId(), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const agentName = useMemo(() => {
    const agent = AGENTS.find((a) => a.id === lastUsedAgentId) ?? AGENTS[0];
    return t(agent.nameKey);
  }, [lastUsedAgentId, t]);

  const dateLocale = i18n.language.startsWith("fr") ? frLocale : undefined;
  const today = useMemo(() => new Date(), []);
  const freshnessDate = format(today, "PPP", { locale: dateLocale });
  const previousMonth = format(subMonths(today, 1), "LLLL", { locale: dateLocale });

  const { messages, streaming, sendMessage, confirmAction, cancelAction } = useChat({
    agentId: lastUsedAgentId,
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

  const handleOpenFullChat = useCallback(() => {
    onClose();
    navigate({ to: "/ai/$agentId", params: { agentId: lastUsedAgentId } });
  }, [onClose, navigate, lastUsedAgentId]);

  if (!open) return null;

  // Show only the latest query/response pair
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const lastAiMsg = [...messages].reverse().find((m) => m.role === "assistant");
  const hasHistory = lastUserMsg !== undefined || lastAiMsg !== undefined;

  const starterPrompts = [
    t("chat.starterTracking"),
    t("chat.starterVsLastMonth", { month: previousMonth }),
    t("chat.starterWhereItGoes"),
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
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
        className="relative z-50 w-full max-w-lg rounded-xl shadow-float"
        data-testid="floating-chat-bar"
      >
        <p
          className="px-card-pad pt-2.5 text-caption text-ink-dim"
          data-testid="agent-label-chip"
        >
          {t("chat.currentAgent", { agentName })}
        </p>

        <div className="mt-2 flex items-center gap-2 border-b border-line px-card-pad pb-3">
          <MessageSquare className="size-4 shrink-0 text-ink-dim" aria-hidden="true" />
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
            className="border-0 bg-transparent px-0 focus-visible:outline-0"
            data-testid="floating-chat-input"
          />
          <kbd
            className="shrink-0 rounded-sm border border-line bg-track px-1.5 py-0.5 text-micro text-ink-dim"
            data-testid="esc-badge"
          >
            {t("chat.escHint")}
          </kbd>
        </div>

        {hasHistory ? (
          <div className="max-h-64 space-y-2 overflow-y-auto px-card-pad py-3">
            {lastUserMsg && <ChatMessageBubble role="user" content={lastUserMsg.content} />}
            {lastAiMsg && (
              <ChatMessageBubble
                role="assistant"
                content={lastAiMsg.content}
                isStreaming={streaming}
                actionHandled={lastAiMsg.actionHandled}
                onConfirm={(payload) => confirmAction(messages.indexOf(lastAiMsg), payload)}
                onCancel={() => cancelAction(messages.indexOf(lastAiMsg))}
              />
            )}
          </div>
        ) : (
          // A blank box right after being told AI is a headline feature makes the user guess.
          <div className="px-card-pad py-3">
            <p className="text-caption text-ink-dim">{t("chat.starterPromptsLabel")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {starterPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => handleSend(prompt)}
                  className={cn(
                    "min-h-target-min rounded-md border border-line-strong px-2.5 py-1 text-caption text-ink transition-colors hover:bg-hover",
                    focusRing
                  )}
                  data-testid="chat-starter-prompt"
                >
                  {prompt}
                </button>
              ))}
            </div>
            <p className="mt-3 text-caption text-ink-faint">{t("chat.dataScope")}</p>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-line px-card-pad py-2">
          <Button
            variant="link"
            size="sm"
            onClick={handleOpenFullChat}
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
