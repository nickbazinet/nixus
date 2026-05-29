import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { MessageSquare } from "lucide-react";
import { ChatMessageBubble } from "./ChatMessageBubble";
import { useChat } from "@/hooks/useChat";
import { getLastUsedAgentId, AGENTS } from "@/lib/agents";

interface FloatingChatBarProps {
  open: boolean;
  onClose: () => void;
}

export function FloatingChatBar({ open, onClose }: FloatingChatBarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<Element | null>(null);
  const [input, setInput] = useState("");

  // Re-read localStorage each time the bar opens so agent name stays in sync
  const lastUsedAgentId = useMemo(() => getLastUsedAgentId(), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const agentName = useMemo(
    () => {
      const agent = AGENTS.find((a) => a.id === lastUsedAgentId) ?? AGENTS[0];
      return t(agent.nameKey);
    },
    [lastUsedAgentId, t]
  );

  const { messages, streaming, sendMessage, confirmAction, cancelAction } =
    useChat({ agentId: lastUsedAgentId });

  // Capture previous focus and auto-focus input
  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement;
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      // Restore focus
      if (previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus();
      }
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

  const handleSend = useCallback(() => {
    if (input.trim() && !streaming) {
      sendMessage(input.trim());
      setInput("");
    }
  }, [input, streaming, sendMessage]);

  const handleOpenFullChat = useCallback(() => {
    onClose();
    navigate({ to: "/ai/$agentId", params: { agentId: lastUsedAgentId } });
  }, [onClose, navigate, lastUsedAgentId]);

  if (!open) return null;

  // Show only the latest query/response pair
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const lastAiMsg = [...messages].reverse().find((m) => m.role === "assistant");

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="floating-chat-overlay"
    >
      <div className="fixed inset-0 bg-background/80 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-label={t("chat.quickChat")}
        className="relative z-50 w-full max-w-lg rounded-xl border bg-card shadow-lg"
        data-testid="floating-chat-bar"
      >
        <div className="px-4 pt-2 pb-0">
          <p
            aria-live="polite"
            className="text-xs text-muted-foreground"
            data-testid="agent-label-chip"
          >
            {t("chat.currentAgent", { agentName })}
          </p>
        </div>

        <div className="flex items-center gap-3 border-b px-4 py-3">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={t("chat.quickPlaceholder")}
            disabled={streaming}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
            data-testid="floating-chat-input"
          />
          <kbd
            className="rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
            data-testid="esc-badge"
          >
            ESC
          </kbd>
        </div>

        {(lastUserMsg || lastAiMsg) && (
          <div className="max-h-64 overflow-y-auto p-4 space-y-2">
            {lastUserMsg && (
              <ChatMessageBubble role="user" content={lastUserMsg.content} />
            )}
            {lastAiMsg && (
              <ChatMessageBubble
                role="assistant"
                content={lastAiMsg.content}
                isStreaming={streaming}
                actionHandled={lastAiMsg.actionHandled}
                onConfirm={(payload) => {
                  const idx = messages.indexOf(lastAiMsg);
                  confirmAction(idx, payload);
                }}
                onCancel={() => {
                  const idx = messages.indexOf(lastAiMsg);
                  cancelAction(idx);
                }}
              />
            )}
          </div>
        )}

        <div className="border-t px-4 py-2">
          <button
            onClick={handleOpenFullChat}
            className="text-xs text-primary hover:underline"
            data-testid="open-full-chat-link"
          >
            {t("chat.openFullChat")}
          </button>
        </div>
      </div>
    </div>
  );
}
