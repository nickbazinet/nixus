import { useCallback, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { queryKeys } from "@/lib/constants";
import { chatActionInvalidationKeys, type ChatActionOutcome } from "@/lib/chatActions";
import { isHostedAiError, parseAppError, type ParsedAppError } from "@/lib/appError";
import { homeChangeOp, homeChangeTitle } from "@/lib/homeSurface";
import {
  HOME_COMPOSER_AGENT_ID,
  isSurfaceAgent,
  parseAgentMention,
} from "@/lib/homeRouting";
import { useAiStream } from "@/hooks/useAiStream";
import type { ActionPayload } from "@/components/chat/ChatMessageBubble";
import type { HomeComposerAccess, HomeComposerReply, HomeWidget } from "@/lib/types";

/** Every widget, resolved against live data on each read (FR-8). No AI call is involved. */
export function useHomeSurface() {
  return useQuery({
    queryKey: queryKeys.homeSurface,
    queryFn: () => invoke<HomeWidget[]>("get_home_surface"),
  });
}

/** Which Composer to draw. Kept short-lived so regaining premium or a quota reset unlocks it. */
export function useHomeComposerAccess() {
  return useQuery({
    queryKey: queryKeys.homeComposerAccess,
    queryFn: () => invoke<HomeComposerAccess>("get_home_composer_access"),
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * The manual customization writes. They sit beside the AI Composer, not inside it: no model
 * call, no proposal, no confirm card — the user's own edit lands immediately.
 *
 * Each returns `void` rather than the new surface, because resolving a widget re-queries every
 * data source it binds. Invalidating `homeSurface` is therefore the only way the result is seen.
 */
export function useReorderHomeWidgets() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { widget_ids: string[] }) =>
      invoke<void>("reorder_home_widgets", { widget_ids: input.widget_ids }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.homeSurface });
    },
  });
}

/** The backend's own ceiling. Bounded here too so the input cannot compose a doomed request. */
export const HOME_WIDGET_TITLE_MAX_LENGTH = 80;

export function useRenameHomeWidget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { widget_id: string; title: string | null }) =>
      invoke<void>("rename_home_widget", {
        widget_id: input.widget_id,
        title: input.title,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.homeSurface });
    },
  });
}

export function useSetHomeWidgetSpan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { widget_id: string; span: number }) =>
      invoke<void>("set_home_widget_span", {
        widget_id: input.widget_id,
        span: input.span,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.homeSurface });
    },
  });
}

export function useSetHomeWidgetAccent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { widget_id: string; accent: number | null }) =>
      invoke<void>("set_home_widget_accent", {
        widget_id: input.widget_id,
        accent: input.accent,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.homeSurface });
    },
  });
}

export function useDeleteHomeWidget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { widget_id: string }) =>
      invoke<void>("delete_home_widget", { widget_id: input.widget_id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.homeSurface });
    },
  });
}

export interface HomeComposerMessage {
  role: "user" | "assistant";
  /** The turn as persisted; for a proposal this is the ```action``` fence the bubble parses. */
  content: string;
  /** Localized text shown instead of `content` for the turns the app itself writes. */
  display?: string;
  pending?: boolean;
  actionHandled?: boolean;
  actionOutcome?: ChatActionOutcome;
  /**
   * The chat agent that answered, which is what the "continue in" link needs. Absent on composer
   * turns, which are the panel's own voice, and on the app's own written turns.
   */
  answeredBy?: string;
}

interface HomeRouteDecision {
  agent_id: string;
  kind: string;
}

/** The hosted codes after which the Composer is locked rather than merely failing this once. */
const LOCKING_CODES = new Set(["premium_required", "quota_exhausted", "reauthentication_required"]);

export function useHomeComposer() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<HomeComposerMessage[]>([]);
  const [surfaceConversationId, setSurfaceConversationId] = useState<number | null>(null);
  const [chatConversationId, setChatConversationId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [chatStreaming, setChatStreaming] = useState(false);
  const [error, setError] = useState<ParsedAppError | null>(null);
  const streamBufferRef = useRef("");

  /* Enabled for as long as the panel is mounted rather than only mid-turn: `listen()` is async, so
   * subscribing at send time would drop the opening chunks of the very turn it was meant to catch.
   * R3 is still satisfied — `/` and `/ai/$agentId` are different routes, and `FloatingChatBar`,
   * the one app-wide consumer, now only listens while it is open. */
  useAiStream({
    enabled: true,
    setMessages,
    setStreaming: setChatStreaming,
    bufferRef: streamBufferRef,
  });

  const displayFor = useCallback(
    (reply: HomeComposerReply): string | undefined => {
      const titles = reply.candidates.join(", ");
      switch (reply.outcome) {
        case "failed":
          return t("home.composer.failed");
        case "ambiguous":
          return t("home.composer.ambiguous", { titles });
        case "no_match":
          return reply.candidates.length > 0
            ? t("home.composer.noMatch", { titles })
            : t("home.composer.noWidgets");
        default:
          return undefined;
      }
    },
    [t]
  );

  /* Two conversation ids in one panel, deliberately. `confirm_change` calls
   * `require_home_conversation`, and the threat model is exactly "a general agent mints a card
   * that confirms as a surface change" — keeping the ids apart is the honest price of leaving that
   * invariant literally untouched. The transcript stays one visual thread. */
  const sendToSurface = useCallback(
    async (message: string) => {
      const reply = await invoke<HomeComposerReply>("send_home_composer_message", {
        message,
        conversation_id: surfaceConversationId,
        locale: i18n.language.startsWith("fr") ? "fr" : "en",
      });
      setSurfaceConversationId(reply.conversation_id);
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", content: reply.content, display: displayFor(reply) },
      ]);
    },
    [displayFor, i18n.language, surfaceConversationId]
  );

  const sendToChat = useCallback(
    async (message: string, agentId: string) => {
      streamBufferRef.current = "";
      // The placeholder loses `pending` and gains the attribution: the stream fills its `content`
      // in place, and a spinner that never clears is worse than a bubble that fills in.
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", content: "", answeredBy: agentId },
      ]);
      setChatStreaming(true);
      try {
        const result = await invoke<{ conversation_id: number }>("send_chat_message", {
          message,
          conversation_id: chatConversationId,
          agent_id: agentId,
          attachment_path: null,
        });
        setChatConversationId(result.conversation_id);
      } catch (error) {
        setChatStreaming(false);
        throw error;
      }
    },
    [chatConversationId]
  );

  /**
   * One ask, routed. `forcedAgentId` is Tier 0 (the picker or a `@mention`) and bypasses the
   * detector; otherwise `route_home_message` decides — **no LLM call, no quota consumed**.
   */
  const send = useCallback(
    async (text: string, forcedAgentId?: string) => {
      const mention = forcedAgentId === undefined ? parseAgentMention(text) : null;
      const message = (mention?.message ?? text).trim();
      const forced = forcedAgentId ?? mention?.agentId;
      if (message === "" || busy || chatStreaming) return;

      setBusy(true);
      setError(null);
      setMessages((prev) => [
        ...prev,
        { role: "user", content: message },
        { role: "assistant", content: "", pending: true },
      ]);

      try {
        let agentId = forced;
        if (agentId === undefined) {
          const decision = await invoke<HomeRouteDecision | null>("route_home_message", {
            message,
          });
          /* An unusable decision falls back to the composer, which is exactly today's behaviour
           * and the documented rollback state: if routing is broken the user still gets the
           * dashboard builder rather than a send against an undefined agent. */
          agentId =
            typeof decision?.agent_id === "string" ? decision.agent_id : HOME_COMPOSER_AGENT_ID;
        }

        if (isSurfaceAgent(agentId)) {
          await sendToSurface(message);
        } else {
          await sendToChat(message, agentId);
        }
      } catch (err: unknown) {
        const parsed = parseAppError(err);
        setMessages((prev) => prev.filter((entry) => !entry.pending));
        setError(parsed);
        if (isHostedAiError(parsed) && LOCKING_CODES.has(parsed.code)) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.homeComposerAccess });
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, chatStreaming, queryClient, sendToChat, sendToSurface]
  );

  const markHandled = (index: number, actionOutcome: ChatActionOutcome) =>
    setMessages((prev) =>
      prev.map((entry, i) =>
        i === index ? { ...entry, actionHandled: true, actionOutcome } : entry
      )
    );

  const confirm = useCallback(
    async (index: number, payload: ActionPayload) => {
      const op = homeChangeOp(payload.params);
      const title = homeChangeTitle(payload.params);
      try {
        const result = await invoke<{ message: string }>("execute_chat_action", {
          action_type: payload.action_type,
          params: payload.params,
          conversation_id: surfaceConversationId ?? 0,
        });
        markHandled(index, "confirmed");
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: result.message,
            display: op ? t(`home.change.done.${op}`, { title }) : undefined,
          },
        ]);
        for (const key of chatActionInvalidationKeys(payload.action_type)) {
          void queryClient.invalidateQueries({ queryKey: key });
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "", display: t("home.change.failed") },
        ]);
      }
    },
    [surfaceConversationId, queryClient, t]
  );

  /* Marked handled before the await, as chat does, so the user's decision holds even if recording
   * it fails. The recorded note is server-owned text the model reads next turn. */
  const cancel = useCallback(
    async (index: number, payload: ActionPayload) => {
      markHandled(index, "cancelled");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "", display: t("home.change.cancelled") },
      ]);
      try {
        await invoke("record_chat_action_cancelled", {
          conversation_id: surfaceConversationId ?? 0,
          action_type: payload.action_type,
        });
      } catch (err: unknown) {
        setError(parseAppError(err));
      }
    },
    [surfaceConversationId, t]
  );

  return {
    messages,
    busy: busy || chatStreaming,
    error,
    clearError: () => setError(null),
    send,
    confirm,
    cancel,
    chatConversationId,
  };
}
