import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Paperclip, Send, X } from "lucide-react";
import { Alert, Button, Input, Label } from "@nixus/shared";
import type { ChatAttachmentState } from "@/hooks/useChatAttachment";

interface ChatComposerProps {
  onSend: (text: string) => void;
  busy: boolean;
  attachments: ChatAttachmentState;
  /** Refusal raised by `send_chat_message` itself, shown in the same slot as a pick-time one. */
  sendErrorKey: string | null;
  /** Drops `sendErrorKey`, so a refusal never outlives the send attempt it describes. */
  onClearSendError: () => void;
  /**
   * Increments on every send the route accepts, including a starter-prompt click that never
   * touches this component. Watching it is what restores the pre-refactor behavior where any
   * successful send emptied the typed draft; without it a starter click answers one question
   * while the user's half-typed other question stays in the box.
   */
  sendCount: number;
}

/**
 * Splits a basename into the part that may be truncated and the extension that may not: the
 * extension is what tells the user which of several same-named exports they attached, so it has
 * to survive truncation. A leading dot is not a separator — `.env` is all stem.
 */
function splitBasename(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { stem: name, extension: "" };
  return { stem: name.slice(0, dot), extension: name.slice(dot) };
}

export function ChatComposer({
  onSend,
  busy,
  attachments,
  sendErrorKey,
  onClearSendError,
  sendCount,
}: ChatComposerProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [seenSendCount, setSeenSendCount] = useState(sendCount);
  const errorKey = attachments.errorKey ?? sendErrorKey;
  const { stem, extension } = splitBasename(attachments.attachment?.name ?? "");

  /* React's documented "adjust state when a prop changes" pattern rather than an effect: it
   * resets during this render, so the emptied box paints in the same commit as the sent turn
   * instead of one frame later. */
  if (sendCount !== seenSendCount) {
    setSeenSendCount(sendCount);
    setDraft("");
  }

  /* Submitting does NOT clear the send-time refusal here — `onSend` is the boundary that
   * clears for its own path, so the starter buttons calling it directly are covered too. */
  const submit = () => {
    if (draft.trim() === "" || busy) return;
    onSend(draft);
    setDraft("");
  };

  /* Changing what is attached drops a previous send-time refusal: left standing it either
   * contradicts a newly valid chip beside it, or re-surfaces when a pick-time refusal above it
   * is cleared. Gated on the outcome, because a user who opened the picker and dismissed it
   * changed nothing and must keep the refusal that explains why their last send failed. */
  const openPicker = async () => {
    if (await attachments.pick() !== "cancelled") onClearSendError();
  };

  const removeAttachment = () => {
    onClearSendError();
    attachments.remove();
  };

  const attachDisabled = busy || attachments.picking;

  return (
    <div className="border-t border-line px-page-x py-3" data-testid="chat-input-area">
      <div className="mx-auto max-w-2xl">
        {(attachments.attachment || errorKey) && (
          <div className="mb-2 flex flex-col gap-2">
            {attachments.attachment && (
              /* `max-w-full` bounds the chip by the composer column, and the `min-w-0` pair is
                 what lets the truncating name shrink below its own nowrap width. The 1.5 padding
                 is the remove button's focus ring clearance: it draws 2px at a 2px offset, which
                 at `pr-1` lands exactly on the chip border. */
              <div
                className="flex max-w-full min-w-0 items-center gap-2 self-start rounded-md border border-line-strong bg-card py-1.5 pr-1.5 pl-2"
                data-testid="chat-attachment-chip"
              >
                <Paperclip aria-hidden="true" className="size-3.5 shrink-0 text-ink-dim" />
                {/* Truncation hides characters, and a pointer user has only the tooltip to read
                    the whole basename by. The two spans concatenate to that same basename, so the
                    accessible name is the full one either way. `shrink-0` states the guarantee the
                    extension needs; an unbreakable `.csv` also gets it from `min-width: auto`, but
                    that protection disappears the moment anyone adds `min-w-0` here. */}
                <span
                  className="flex min-w-0 text-caption text-ink"
                  title={attachments.attachment.name}
                  data-testid="chat-attachment-name"
                >
                  <span className="min-w-0 truncate" data-testid="chat-attachment-stem">
                    {stem}
                  </span>
                  <span className="shrink-0" data-testid="chat-attachment-extension">
                    {extension}
                  </span>
                </span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={removeAttachment}
                  aria-label={t("chat.removeAttachment")}
                  data-testid="chat-attachment-remove"
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            )}
            {errorKey && (
              <Alert variant="over" data-testid="chat-attachment-error">
                {t(errorKey)}
              </Alert>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Label htmlFor="agent-chat-input" className="sr-only">
            {t("chat.placeholder")}
          </Label>
          <Button
            size="icon"
            variant="outline"
            onClick={() => void openPicker()}
            disabled={attachDisabled}
            aria-disabled={attachDisabled || undefined}
            aria-label={t("chat.attachFile")}
            data-testid="chat-attach-button"
          >
            <Paperclip aria-hidden="true" />
          </Button>
          <Input
            id="agent-chat-input"
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={t("chat.placeholder")}
            disabled={busy}
            aria-disabled={busy || undefined}
            data-testid="chat-input"
            autoFocus
          />
          <Button
            size="icon"
            onClick={submit}
            disabled={busy || draft.trim() === ""}
            aria-disabled={busy || draft.trim() === "" || undefined}
            aria-label={t("chat.send")}
            data-testid="chat-send-button"
          >
            <Send aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
