import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { format, subMonths } from "date-fns";
import { fr as frLocale } from "date-fns/locale";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  EmptyState,
  focusRing,
} from "@nixus/shared";
import { cn } from "@/lib/utils";
import { SURFACE_HEADING_ID } from "@/components/shared/PageHeader";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatMessageBubble } from "@/components/chat/ChatMessageBubble";
import { ConversationListPanel } from "@/components/chat/ConversationListPanel";
import { useChat } from "@/hooks/useChat";
import { useChatAttachment } from "@/hooks/useChatAttachment";
import { AGENTS, setLastUsedAgentId } from "@/lib/agents";
import { hostedAiMessageKey, hostedAiNeedsSignIn } from "@/lib/appError";

export const Route = createFileRoute("/ai/$agentId")({
  component: AgentChatPage,
  validateSearch: (search: Record<string, unknown>): { conversation?: number } => {
    const conv = Number(search.conversation);
    return Number.isInteger(conv) && conv > 0 ? { conversation: conv } : {};
  },
});

interface ChatPanelProps {
  agentId: string;
  initialConversationId: number | undefined;
  onNewChat: () => void;
}

function ChatPanel({ agentId, initialConversationId, onNewChat }: ChatPanelProps) {
  const { t, i18n } = useTranslation();
  const agent = AGENTS.find((a) => a.id === agentId);
  const {
    messages,
    streaming,
    loading,
    chatError,
    setChatError,
    sendMessage,
    confirmAction,
    cancelAction,
  } = useChat({ initialConversationId, agentId });

  const attachments = useChatAttachment();
  const [sendCount, setSendCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  /* Narrowed to the attachment refusal on purpose: the composer's clear is about the file the user
   * just changed, and must not silently discard a not_configured or hosted_ai alert. */
  const clearSendError = useCallback(() => {
    setChatError((prev) => (prev?.type === "attachment" ? null : prev));
  }, [setChatError]);

  const dateLocale = i18n.language.startsWith("fr") ? frLocale : undefined;
  const today = useMemo(() => new Date(), []);
  const freshnessDate = format(today, "PPP", { locale: dateLocale });
  const previousMonth = format(subMonths(today, 1), "LLLL", { locale: dateLocale });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* The one boundary every send passes through — the composer's submit AND the starter buttons,
   * which call this directly. Clearing here rather than in the composer is what stops a starter
   * send from leaving a previous attachment refusal standing beside its answer. */
  const send = (text: string) => {
    const trimmed = text.trim();
    if (trimmed !== "" && !streaming) {
      clearSendError();
      sendMessage(trimmed, attachments.attachment ?? undefined);
      attachments.remove();
      setSendCount((n) => n + 1);
    }
  };

  /* An attachment refusal is drawn by the composer, not in the message area, and it withdraws both
   * optimistic turns — so it leaves a genuinely empty conversation and the starters have to stay.
   * Every other error DOES occupy the message area, where the starter card would collide with it. */
  const messageAreaError = chatError !== null && chatError.type !== "attachment";
  const showStarters =
    messages.length === 0 && !messageAreaError && initialConversationId === undefined && agent;
  const starterPrompts = [
    t("chat.starterTracking"),
    t("chat.starterVsLastMonth", { month: previousMonth }),
    t("chat.starterWhereItGoes"),
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line bg-page px-page-x py-3">
        {agent && (
          <span
            aria-hidden="true"
            className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-ink"
          >
            <agent.icon size={18} />
          </span>
        )}
        <div className="min-w-0">
          {/* The shell's skip link and its route-change focus move both target this id, so the
            * chat surface needs the same heading contract as PageHeader gives every other route. */}
          <h1
            id={SURFACE_HEADING_ID}
            data-surface-heading=""
            tabIndex={-1}
            className={cn("truncate text-h1 text-ink", focusRing)}
          >
            {agent ? t(agent.nameKey) : agentId}
          </h1>
          {agent && (
            <p className="truncate text-caption text-ink-dim">{t(agent.descriptionKey)}</p>
          )}
        </div>
      </div>

      {/* role="log" without aria-live: streaming announcements are published per sentence by the
        * bubble itself, so a live region here would re-announce every token. */}
      <div
        className="flex-1 space-y-3 overflow-y-auto px-page-x py-4"
        role="log"
        data-testid="chat-message-area"
      >
        {chatError?.type === "not_configured" && (
          <Alert variant="info" className="mx-auto max-w-md">
            <AlertTitle>{t("settings.notConfiguredPrompt")}</AlertTitle>
            <AlertDescription className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" render={<Link to="/settings" />}>
                {t("settings.openSettings")}
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {chatError?.type === "hosted_ai" && chatError.code && (
          <Alert variant="over" className="mx-auto max-w-md">
            <AlertTitle>{t(hostedAiMessageKey(chatError.code))}</AlertTitle>
            {hostedAiNeedsSignIn(chatError.code) && (
              <AlertDescription className="mt-2">
                <Button size="sm" render={<Link to="/settings" />}>
                  {t("settings.openSettings")}
                </Button>
              </AlertDescription>
            )}
          </Alert>
        )}
        {chatError?.type === "validation" && (
          <Alert variant="over" className="mx-auto max-w-md">
            <AlertTitle>{t("chat.conversationNotFound")}</AlertTitle>
            <AlertDescription className="mt-2">
              <Button size="sm" variant="outline" onClick={onNewChat}>
                {t("chat.startNew")}
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {showStarters && agent && (
          <Card>
            <EmptyState
              icon={<agent.icon />}
              title={t("chat.agentReady")}
              description={t("chat.dataScope")}
            >
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {starterPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => send(prompt)}
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
            </EmptyState>
          </Card>
        )}

        {messages.map((msg, i) => (
          <ChatMessageBubble
            key={i}
            role={msg.role}
            content={msg.content}
            isStreaming={streaming && msg.role === "assistant" && i === messages.length - 1}
            actionHandled={msg.actionHandled}
            onConfirm={(payload) => confirmAction(i, payload)}
            onCancel={() => cancelAction(i)}
          />
        ))}
        {messages.length > 0 && !streaming && (
          <p className="text-caption text-ink-faint" data-testid="chat-freshness">
            {t("chat.freshness", { date: freshnessDate })}
          </p>
        )}
        <div ref={messagesEndRef} />
      </div>

      <ChatComposer
        onSend={send}
        busy={streaming || loading}
        attachments={attachments}
        sendErrorKey={
          chatError?.type === "attachment" ? chatError.messageKey ?? null : null
        }
        onClearSendError={clearSendError}
        sendCount={sendCount}
      />
    </div>
  );
}

function AgentChatPage() {
  const { t } = useTranslation();
  const { agentId } = Route.useParams();
  const { conversation } = Route.useSearch();
  const navigate = useNavigate();

  // Update last-used agent so FloatingChatBar stays in sync
  useEffect(() => {
    setLastUsedAgentId(agentId);
  }, [agentId]);

  const agent = AGENTS.find((a) => a.id === agentId);

  const [activeConversationId, setActiveConversationId] = useState<number | null>(
    conversation ?? null
  );
  const [chatKey, setChatKey] = useState(0);

  if (!agent) {
    return (
      <EmptyState
        title={t("chat.agentNotFound")}
        action={
          <Button variant="outline" render={<Link to="/ai" />}>
            {t("chat.backToAgents")}
          </Button>
        }
      />
    );
  }

  const handleSelectConversation = (id: number) => {
    setActiveConversationId(id);
    setChatKey((k) => k + 1);
    navigate({
      to: "/ai/$agentId",
      params: { agentId },
      search: { conversation: id },
      replace: true,
    });
  };

  const handleNewChat = () => {
    setActiveConversationId(null);
    setChatKey((k) => k + 1);
    navigate({
      to: "/ai/$agentId",
      params: { agentId },
      search: {},
      replace: true,
    });
  };

  return (
    <div className="flex h-full overflow-hidden">
      <aside
        className="flex w-56 shrink-0 flex-col border-r border-line bg-chrome"
        aria-label={t("chat.conversationHistory")}
      >
        <ConversationListPanel
          agentId={agentId}
          activeConversationId={activeConversationId}
          onSelectConversation={handleSelectConversation}
          onNewChat={handleNewChat}
        />
      </aside>
      <div className="flex flex-1 flex-col overflow-hidden">
        <ChatPanel
          key={chatKey}
          agentId={agentId}
          initialConversationId={activeConversationId ?? undefined}
          onNewChat={handleNewChat}
        />
      </div>
    </div>
  );
}
