import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { formatDistanceToNow, parseISO } from "date-fns";
import { useTranslation } from "react-i18next";
import { queryKeys } from "@/lib/constants";
import type { ChatConversation } from "@/lib/types";

interface ConversationListPanelProps {
  agentId: string;
  activeConversationId: number | null;
  onSelectConversation: (id: number) => void;
  onNewChat: () => void;
}

function formatRelativeTime(isoString: string): string {
  return formatDistanceToNow(parseISO(isoString), { addSuffix: true });
}

export function ConversationListPanel({
  agentId,
  activeConversationId,
  onSelectConversation,
  onNewChat,
}: ConversationListPanelProps) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);

  const { data: conversations = [], isLoading, isError } = useQuery({
    queryKey: queryKeys.chatConversations(agentId),
    queryFn: () =>
      invoke<ChatConversation[]>("list_conversations", { agent_id: agentId }),
  });

  const displayedConversations = showAll
    ? conversations
    : conversations.slice(0, 20);

  return (
    <div
      className="flex h-full flex-col"
    >
      {/* New Chat button */}
      <div className="p-3 border-b shrink-0">
        <button
          onClick={onNewChat}
          className="w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium border border-primary/40 text-primary hover:bg-primary/10 transition-colors"
        >
          {t("chat.newChat")}
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="p-3 text-center text-xs text-muted-foreground">…</p>
        ) : isError ? (
          <p className="p-3 text-center text-xs text-destructive">
            {t("toast.genericError")}
          </p>
        ) : conversations.length === 0 ? (
          <p className="p-3 text-center text-xs text-muted-foreground">
            {t("chat.noConversations")}
          </p>
        ) : (
          <ul role="list" className="py-1">
            {displayedConversations.map((conv) => {
              const isActive = conv.id === activeConversationId;
              return (
                <li key={conv.id} role="listitem">
                  <button
                    onClick={() => onSelectConversation(conv.id)}
                    aria-current={isActive ? "true" : undefined}
                    className={`w-full text-left py-2 pr-3 flex flex-col gap-0.5 hover:bg-accent/50 transition-colors ${
                      isActive
                        ? "bg-accent border-l-[3px] border-l-primary pl-2"
                        : "border-l-[3px] border-l-transparent pl-2"
                    }`}
                  >
                    <span className="truncate text-sm leading-tight">
                      {conv.title ?? "New conversation"}
                    </span>
                    <span className="text-xs text-muted-foreground truncate">
                      {formatRelativeTime(conv.updated_at)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {!showAll && conversations.length > 20 && (
          <button
            onClick={() => setShowAll(true)}
            className="w-full py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("chat.showMore")}
          </button>
        )}
      </div>

      {/* TODO Story 15.x: implement collapsible panel (collapse to 48px icon strip) */}
    </div>
  );
}
