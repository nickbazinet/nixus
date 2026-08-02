import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { formatDistanceToNow, parseISO } from "date-fns";
import { fr as frLocale } from "date-fns/locale";
import { useTranslation } from "react-i18next";
import { Alert, Button, Skeleton, focusRing } from "@nixus/shared";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/constants";
import type { ChatConversation } from "@/lib/types";

interface ConversationListPanelProps {
  agentId: string;
  activeConversationId: number | null;
  onSelectConversation: (id: number) => void;
  onNewChat: () => void;
}

const PAGE_SIZE = 20;

export function ConversationListPanel({
  agentId,
  activeConversationId,
  onSelectConversation,
  onNewChat,
}: ConversationListPanelProps) {
  const { t, i18n } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const dateLocale = i18n.language.startsWith("fr") ? frLocale : undefined;

  const {
    data: conversations = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: queryKeys.chatConversations(agentId),
    queryFn: () => invoke<ChatConversation[]>("list_conversations", { agent_id: agentId }),
  });

  const displayed = showAll ? conversations : conversations.slice(0, PAGE_SIZE);

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-line p-3">
        <Button variant="outline" className="w-full" onClick={onNewChat}>
          {t("chat.newChat")}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <Skeleton
            rows={PAGE_SIZE}
            aria-label={t("chat.loadingConversations")}
            className="gap-3 p-3"
          />
        ) : isError ? (
          <Alert variant="over" className="m-2">
            {t("toast.genericError")}
          </Alert>
        ) : conversations.length === 0 ? (
          <p className="p-3 text-caption text-ink-dim">{t("chat.noConversations")}</p>
        ) : (
          <ul className="list-none py-1">
            {displayed.map((conv) => {
              const isActive = conv.id === activeConversationId;
              return (
                <li key={conv.id}>
                  <button
                    type="button"
                    onClick={() => onSelectConversation(conv.id)}
                    aria-current={isActive ? "true" : undefined}
                    className={cn(
                      "flex w-full flex-col gap-0.5 border-l-3 py-2 pr-3 pl-2 text-left transition-colors hover:bg-hover",
                      isActive
                        ? "border-l-brand bg-brand-soft"
                        : "border-l-transparent",
                      focusRing
                    )}
                  >
                    <span className="truncate text-label text-ink">
                      {conv.title ?? t("chat.newChat")}
                    </span>
                    <span className="truncate text-caption text-ink-dim">
                      {formatDistanceToNow(parseISO(conv.updated_at), {
                        addSuffix: true,
                        locale: dateLocale,
                      })}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {!showAll && conversations.length > PAGE_SIZE && (
          <div className="p-2">
            <Button variant="ghost" size="sm" className="w-full" onClick={() => setShowAll(true)}>
              {t("chat.showMore")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
