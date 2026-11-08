import { useEffect, type Dispatch, type SetStateAction } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** The `chat:response-chunk` payload. `done: true` is the turn's terminal signal. */
interface ChatResponseChunk {
  chunk: string;
  done: boolean;
}

/** The shape every streamed transcript entry has to satisfy. */
interface StreamableMessage {
  role: "user" | "assistant";
  content: string;
}

interface UseAiStreamOptions<M extends StreamableMessage> {
  /* R3 — `chat:response-chunk` and `chat:tool-executing` are APP-GLOBAL Tauri events, so two
   * mounted listeners would both mutate their own transcript from the same turn. Home and
   * `/ai/$agentId` are different routes, so simultaneous mounting is not expected today — this
   * flag is what keeps that from being load-bearing. Each surface enables the stream only while it
   * owns an in-flight turn. */
  enabled: boolean;
  setMessages: Dispatch<SetStateAction<M[]>>;
  setStreaming: Dispatch<SetStateAction<boolean>>;
  /** The caller's accumulated text. Shared so the owner can reset it when it starts a turn. */
  bufferRef: { current: string };
}

/**
 * Subscribes one surface to a streaming AI turn.
 *
 * Extracted verbatim from `useChat` so the Home panel streams through exactly the same listeners
 * and the same `done: true` terminal semantics, rather than a second implementation that drifts.
 */
export function useAiStream<M extends StreamableMessage>({
  enabled,
  setMessages,
  setStreaming,
  bufferRef,
}: UseAiStreamOptions<M>): void {
  useEffect(() => {
    if (!enabled) return;

    let cleaned = false;
    const unlistenFns: UnlistenFn[] = [];

    const replaceLastAssistant = (content: string) =>
      setMessages((prev) => {
        const updated = [...prev];
        const lastMsg = updated[updated.length - 1];
        if (lastMsg && lastMsg.role === "assistant") {
          updated[updated.length - 1] = { ...lastMsg, content };
        }
        return updated;
      });

    const setup = async () => {
      const chunkUn = await listen<ChatResponseChunk>("chat:response-chunk", (event) => {
        if (event.payload.done) {
          setStreaming(false);
        } else {
          bufferRef.current += event.payload.chunk;
          replaceLastAssistant(bufferRef.current);
        }
      });

      /* Wipes the buffer and swaps in the placeholder the bubble renders as a searching
       * indicator — the behaviour the chat surface already had, reused as-is. */
      const toolUn = await listen<string>("chat:tool-executing", () => {
        bufferRef.current = "";
        setStreaming(true);
        replaceLastAssistant("tool-searching");
      });

      if (cleaned) {
        chunkUn();
        toolUn();
      } else {
        unlistenFns.push(chunkUn, toolUn);
      }
    };

    setup();
    return () => {
      cleaned = true;
      for (const fn of unlistenFns) fn();
    };
  }, [enabled, setMessages, setStreaming, bufferRef]);
}
