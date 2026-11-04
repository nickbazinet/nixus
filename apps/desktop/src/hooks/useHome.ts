import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { queryKeys } from "@/lib/constants";
import { chatActionInvalidationKeys, type ChatActionOutcome } from "@/lib/chatActions";
import { isHostedAiError, parseAppError, type ParsedAppError } from "@/lib/appError";
import { homeChangeOp, homeChangeTitle } from "@/lib/homeSurface";
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
}

/** The hosted codes after which the Composer is locked rather than merely failing this once. */
const LOCKING_CODES = new Set(["premium_required", "quota_exhausted", "reauthentication_required"]);

export function useHomeComposer() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<HomeComposerMessage[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ParsedAppError | null>(null);

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

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (message === "" || busy) return;

      setBusy(true);
      setError(null);
      setMessages((prev) => [
        ...prev,
        { role: "user", content: message },
        { role: "assistant", content: "", pending: true },
      ]);

      try {
        const reply = await invoke<HomeComposerReply>("send_home_composer_message", {
          message,
          conversation_id: conversationId,
          locale: i18n.language.startsWith("fr") ? "fr" : "en",
        });
        setConversationId(reply.conversation_id);
        setMessages((prev) => [
          ...prev.slice(0, -1),
          { role: "assistant", content: reply.content, display: displayFor(reply) },
        ]);
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
    [busy, conversationId, displayFor, i18n.language, queryClient]
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
          conversation_id: conversationId ?? 0,
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
    [conversationId, queryClient, t]
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
          conversation_id: conversationId ?? 0,
          action_type: payload.action_type,
        });
      } catch (err: unknown) {
        setError(parseAppError(err));
      }
    },
    [conversationId, t]
  );

  return { messages, busy, error, clearError: () => setError(null), send, confirm, cancel };
}
