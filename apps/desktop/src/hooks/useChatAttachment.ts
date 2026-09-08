import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { chatAttachmentMessageKey } from "@/lib/appError";
import type { ChatAttachment } from "@/hooks/useChat";

/**
 * The extensions offered by the native picker. `ai/attachment.rs` holds the matching list
 * and is the enforcement boundary — this one is UX only, so a path arriving any other way
 * is still refused.
 */
export const CHAT_ATTACHMENT_EXTENSIONS = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "csv",
  "txt",
  "xls",
  "xlsx",
] as const;

interface ChatAttachmentInfo {
  file_name: string;
}

/**
 * What one `pick()` did, so the caller can tell a cancel apart from a real outcome.
 *
 * A re-entrant call reports `cancelled` because it changed nothing — the same contract a
 * dismissed dialog has.
 */
export type ChatPickOutcome = "cancelled" | "selected" | "refused";

export interface ChatAttachmentState {
  readonly attachment: ChatAttachment | null;
  /** i18n key for the current refusal, or `null` when there is nothing to report. */
  readonly errorKey: string | null;
  /** True while a picker is open, so the caller can disable the control that opens it. */
  readonly picking: boolean;
  readonly pick: () => Promise<ChatPickOutcome>;
  readonly remove: () => void;
}

/**
 * Owns the one ephemeral attachment a chat message may carry.
 *
 * The path and basename live in this state and nowhere else: they are never written to
 * the database, a log, or a prompt (AD-11). A successful send calls `remove`, so the next
 * message does not silently re-send the same file.
 */
export function useChatAttachment(): ChatAttachmentState {
  const { t } = useTranslation();
  const [attachment, setAttachment] = useState<ChatAttachment | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // A ref, not the state above: two clicks in one tick both read the pre-update state, so
  // only a synchronous flag can stop a second native dialog from opening.
  const pickingRef = useRef(false);

  const pick = useCallback(async (): Promise<ChatPickOutcome> => {
    if (pickingRef.current) return "cancelled";
    pickingRef.current = true;
    setPicking(true);

    try {
      let selected: unknown;
      try {
        selected = await open({
          multiple: false,
          filters: [
            {
              name: t("chat.attachmentFilterName"),
              extensions: [...CHAT_ATTACHMENT_EXTENSIONS],
            },
          ],
        });
      } catch {
        // The native dialog itself failed to open or was torn down. Reported rather than
        // swallowed, or the attach button looks inert with no explanation.
        setAttachment(null);
        setErrorKey("chat.attachmentUnreadable");
        return "refused";
      }

      // A cancelled picker must leave the draft, the selection, and any standing error alone.
      if (typeof selected !== "string") return "cancelled";

      try {
        const info = await invoke<ChatAttachmentInfo>("validate_chat_attachment", {
          file_path: selected,
        });
        setAttachment({ path: selected, name: info.file_name });
        setErrorKey(null);
        return "selected";
      } catch (err: unknown) {
        setAttachment(null);
        setErrorKey(chatAttachmentMessageKey(err) ?? "chat.attachmentUnreadable");
        return "refused";
      }
    } finally {
      pickingRef.current = false;
      setPicking(false);
    }
  }, [t]);

  const remove = useCallback(() => {
    setAttachment(null);
    setErrorKey(null);
  }, []);

  return { attachment, errorKey, picking, pick, remove };
}
