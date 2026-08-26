import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import type { ActionPayload } from "@/components/chat/ChatMessageBubble";
import { queryKeys } from "@/lib/constants";
import {
  isHostedAiError,
  parseAppError,
  type HostedAiErrorCode,
} from "@/lib/appError";

export interface ChatError {
  message: string;
  type?: string;
  /** Present only when `type` is `hosted_ai`; drives the typed alert copy. */
  code?: HostedAiErrorCode;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  actionHandled?: boolean;
}

interface ChatResponseChunk {
  chunk: string;
  done: boolean;
}

const ACTION_INVALIDATION_MAP: Record<string, string[][]> = {
  create_expense: [["expenses"], ["dashboard"], ["budgets"], ["budget-status"], ["budget-summary"], ["spending-breakdown"]],
  update_balance: [["accounts"], ["dashboard"], ["net-worth-current"]],
  create_account: [["accounts"], ["dashboard"]],
  update_asset_value: [["assets"], ["net-worth-current"]],
};

interface UseChatOptions {
  initialConversationId?: number;
  agentId?: string;
}

export function useChat(options?: UseChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [chatError, setChatError] = useState<ChatError | null>(null);
  const [conversationId, setConversationId] = useState<number | null>(
    options?.initialConversationId ?? null
  );
  const streamBufferRef = useRef("");
  const queryClient = useQueryClient();
  const agentIdRef = useRef(options?.agentId);
  agentIdRef.current = options?.agentId;

  // Load existing messages when resuming a conversation
  useEffect(() => {
    if (!options?.initialConversationId) return;
    let cancelled = false;

    const loadHistory = async () => {
      setLoading(true);
      try {
        const history = await invoke<
          { role: "user" | "assistant"; content: string }[]
        >("get_chat_messages", {
          conversation_id: options.initialConversationId,
        });
        if (!cancelled) {
          setMessages(
            history.map((m) => ({ role: m.role, content: m.content }))
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [options?.initialConversationId]);

  useEffect(() => {
    let cleaned = false;

    const setup = async () => {
      const chunkUn = await listen<ChatResponseChunk>(
        "chat:response-chunk",
        (event) => {
          if (event.payload.done) {
            setStreaming(false);
          } else {
            streamBufferRef.current += event.payload.chunk;
            setMessages((prev) => {
              const updated = [...prev];
              const lastMsg = updated[updated.length - 1];
              if (lastMsg && lastMsg.role === "assistant") {
                updated[updated.length - 1] = {
                  ...lastMsg,
                  content: streamBufferRef.current,
                };
              }
              return updated;
            });
          }
        }
      );

      const toolUn = await listen<string>(
        "chat:tool-executing",
        () => {
          streamBufferRef.current = "";
          setStreaming(true);
          setMessages((prev) => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.role === "assistant") {
              updated[updated.length - 1] = {
                ...lastMsg,
                content: "tool-searching",
              };
            }
            return updated;
          });
        }
      );

      if (cleaned) {
        chunkUn();
        toolUn();
      } else {
        unlistenFns.push(chunkUn, toolUn);
      }
    };

    const unlistenFns: UnlistenFn[] = [];
    setup();
    return () => {
      cleaned = true;
      for (const fn of unlistenFns) fn();
    };
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || streaming) return;

      setMessages((prev) => [...prev, { role: "user", content: text }]);
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
      streamBufferRef.current = "";
      setStreaming(true);

      try {
        const isNewConversation = conversationId === null;
        const currentAgentId = agentIdRef.current;
        const result = await invoke<{ conversation_id: number }>(
          "send_chat_message",
          {
            message: text,
            conversation_id: conversationId,
            agent_id: currentAgentId ?? "budget-helper",
          }
        );
        setConversationId(result.conversation_id);
        if (isNewConversation && currentAgentId) {
          queryClient.invalidateQueries({
            queryKey: queryKeys.chatConversations(currentAgentId),
          });
        }
      } catch (err: unknown) {
        const parsed = parseAppError(err);
        setStreaming(false);

        // Drops the empty assistant placeholder so the error is not rendered as a
        // blank turn from the model.
        const dropEmptyPlaceholder = () =>
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last?.role === "assistant" && last.content === "") {
              updated.pop();
            }
            return updated;
          });

        if (parsed.type === "not_configured") {
          setChatError({
            message: parsed.message ?? "AI not configured",
            type: "not_configured",
          });
          dropEmptyPlaceholder();
          return;
        }

        // A hosted-AI failure is surfaced as a typed, localized alert. Left to the
        // generic branch below it became a hardcoded English retry line, which is
        // wrong for every code the closed table never retries.
        if (isHostedAiError(parsed)) {
          setChatError({
            message: parsed.message,
            type: "hosted_ai",
            code: parsed.code,
          });
          dropEmptyPlaceholder();
          return;
        }

        setMessages((prev) => {
          const updated = [...prev];
          const lastMsg = updated[updated.length - 1];
          if (lastMsg && lastMsg.role === "assistant" && lastMsg.content === "") {
            updated[updated.length - 1] = {
              ...lastMsg,
              content: "Sorry, I couldn't process your request. Please try again.",
            };
          }
          return updated;
        });
      }
    },
    [conversationId, streaming, queryClient]
  );

  const confirmAction = useCallback(
    async (msgIndex: number, payload: ActionPayload) => {
      try {
        const result = await invoke<{ message: string }>(
          "execute_chat_action",
          {
            action_type: payload.action_type,
            params: payload.params,
            conversation_id: conversationId ?? 0,
          }
        );

        setMessages((prev) => {
          const updated = [...prev];
          updated[msgIndex] = { ...updated[msgIndex], actionHandled: true };
          return [...updated, { role: "assistant" as const, content: result.message }];
        });

        const keys = ACTION_INVALIDATION_MAP[payload.action_type] ?? [];
        for (const key of keys) {
          queryClient.invalidateQueries({ queryKey: key });
        }
      } catch (err: unknown) {
        const e = err as { message?: string };
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Error: ${e.message ?? "Action failed"}` },
        ]);
      }
    },
    [conversationId, queryClient]
  );

  const cancelAction = useCallback((msgIndex: number) => {
    setMessages((prev) => {
      const updated = [...prev];
      updated[msgIndex] = { ...updated[msgIndex], actionHandled: true };
      return [...updated, { role: "assistant" as const, content: "Action cancelled." }];
    });
  }, []);

  return { messages, streaming, loading, chatError, setChatError, sendMessage, confirmAction, cancelAction };
}
