import { useState, useRef, useEffect } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Send } from "lucide-react";
import { ChatMessageBubble } from "@/components/chat/ChatMessageBubble";
import { ConversationListPanel } from "@/components/chat/ConversationListPanel";
import { useChat } from "@/hooks/useChat";
import { AGENTS, setLastUsedAgentId } from "@/lib/agents";

export const Route = createFileRoute("/ai/$agentId")({
  component: AgentChatPage,
  validateSearch: (
    search: Record<string, unknown>
  ): { conversation?: number } => {
    const conv = Number(search.conversation);
    return Number.isInteger(conv) && conv > 0 ? { conversation: conv } : {};
  },
});

interface ChatPanelProps {
  agentId: string;
  initialConversationId: number | undefined;
  onNewChat: () => void;
}

function ChatPanel({
  agentId,
  initialConversationId,
  onNewChat,
}: ChatPanelProps) {
  const { t } = useTranslation();
  const agent = AGENTS.find((a) => a.id === agentId);
  const {
    messages,
    streaming,
    loading,
    chatError,
    sendMessage,
    confirmAction,
    cancelAction,
  } = useChat({ initialConversationId, agentId });

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (input.trim() && !streaming) {
      sendMessage(input.trim());
      setInput("");
    }
  };

  return (
    <div className="flex h-full flex-col" role="main">
      <div className="flex items-center gap-3 border-b border-border px-6 py-4 bg-background">
        {agent && (
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <agent.icon size={18} className="text-primary" />
          </div>
        )}
        <div>
          <h1 className="text-lg font-semibold leading-tight bg-gradient-to-r from-[#A78BFA] to-[#F472B6] bg-clip-text text-transparent">
            {agent ? t(agent.nameKey) : agentId}
          </h1>
          {agent && (
            <p className="text-xs text-muted-foreground">{t(agent.descriptionKey)}</p>
          )}
        </div>
      </div>
      <div
        className="flex-1 overflow-y-auto px-4 py-4"
        role="log"
        aria-live="polite"
        data-testid="chat-message-area"
      >
        {chatError?.type === "not_configured" && (
          <div className="mx-auto max-w-md rounded-lg border border-border bg-card p-4 text-sm">
            {t("settings.notConfiguredPrompt", "AI not configured")}
            {" — "}
            <Link to="/settings" className="text-primary underline">
              {t("settings.openSettings", "Open Settings")}
            </Link>
          </div>
        )}
        {chatError?.type === "validation" && (
          <div className="mx-auto max-w-md rounded-lg border border-destructive bg-destructive/10 p-4 text-sm">
            {t("chat.conversationNotFound")}
            {" — "}
            <button
              onClick={onNewChat}
              className="text-primary underline"
            >
              {t("chat.startNew")}
            </button>
          </div>
        )}
        {messages.length === 0 &&
          !chatError &&
          !initialConversationId &&
          agent && (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <agent.icon className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                <p className="text-muted-foreground">
                  {t("chat.agentReady", { agentName: t(agent.nameKey) })}
                </p>
              </div>
            </div>
          )}
        <div className="space-y-3">
          {messages.map((msg, i) => (
            <ChatMessageBubble
              key={i}
              role={msg.role}
              content={msg.content}
              isStreaming={
                streaming &&
                msg.role === "assistant" &&
                i === messages.length - 1
              }
              actionHandled={msg.actionHandled}
              onConfirm={(payload) => confirmAction(i, payload)}
              onCancel={() => cancelAction(i)}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>
      <div className="border-t p-4" data-testid="chat-input-area">
        <div className="mx-auto flex max-w-2xl gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={t("chat.placeholder")}
            disabled={streaming || loading}
            className="flex-1 rounded-lg border bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground disabled:opacity-50"
            data-testid="chat-input"
            autoFocus
          />
          <button
            onClick={handleSend}
            disabled={streaming || loading || !input.trim()}
            className="rounded-lg bg-primary px-3 py-2.5 text-primary-foreground disabled:opacity-50"
            data-testid="chat-send-button"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
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

  const [activeConversationId, setActiveConversationId] = useState<
    number | null
  >(conversation ?? null);
  const [chatKey, setChatKey] = useState(0);

  if (!agent) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Agent not found.</p>
      </div>
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
        className="w-[220px] shrink-0 border-r flex flex-col bg-muted rounded-tl-lg"
        aria-label={t("chat.conversationHistory")}
      >
        <ConversationListPanel
          agentId={agentId}
          activeConversationId={activeConversationId}
          onSelectConversation={handleSelectConversation}
          onNewChat={handleNewChat}
        />
      </aside>
      <div className="flex-1 flex flex-col overflow-hidden">
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
