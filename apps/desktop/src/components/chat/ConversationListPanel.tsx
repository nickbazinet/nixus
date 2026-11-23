import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { formatDistanceToNow, parseISO } from "date-fns";
import { fr as frLocale } from "date-fns/locale";
import { useTranslation } from "react-i18next";
import { MessageSquarePlus } from "lucide-react";
import { Alert, Button, Eyebrow, Skeleton, focusRing } from "@nixus/shared";
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
      <div className="shrink-0 px-4 pt-5 pb-4">
        <Button variant="outline" className="w-full" onClick={onNewChat}>
          <MessageSquarePlus aria-hidden="true" data-icon="inline-start" />
          {t("chat.newChat")}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {isLoading ? (
          <Skeleton
            rows={PAGE_SIZE}
            aria-label={t("chat.loadingConversations")}
            className="gap-3 p-2"
          />
        ) : isError ? (
          <Alert variant="over" className="m-2">
            {t("toast.genericError")}
          </Alert>
        ) : conversations.length === 0 ? (
          <p className="px-2 text-caption text-ink-dim">{t("chat.noConversations")}</p>
        ) : (
          <>
            <Eyebrow className="mb-2 px-2 whitespace-nowrap">
              {t("chat.conversationHistory")}
            </Eyebrow>
            <ul className="list-none space-y-0.5">
              {displayed.map((conv) => {
                const isActive = conv.id === activeConversationId;
                return (
                  <li key={conv.id}>
                    {/* Active is a soft brand capsule, the same affordance the rail uses for the
                      * module you are in — never a hairline bar a colourblind user has to find. */}
                    <button
                      type="button"
                      onClick={() => onSelectConversation(conv.id)}
                      aria-current={isActive ? "true" : undefined}
                      className={cn(
                        "flex w-full flex-col gap-0.5 rounded-xl px-3 py-2.5 text-left transition-colors",
                        isActive
                          ? "bg-rail-on text-rail-on-ink"
                          : "text-ink hover:bg-hover",
                        focusRing
                      )}
                    >
                      <span
                        className={cn(
                          "truncate text-label",
                          isActive ? "text-rail-on-ink" : "text-ink"
                        )}
                      >
                        {conv.title ?? t("chat.newChat")}
                      </span>
                      <span
                        className={cn(
                          "truncate text-caption",
                          isActive ? "text-rail-on-ink/80" : "text-ink-dim"
                        )}
                      >
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
          </>
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
