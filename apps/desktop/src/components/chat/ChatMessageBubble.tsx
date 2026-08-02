import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Components, Options } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button, Card, CardContent } from "@nixus/shared";
import { cn } from "@/lib/utils";

// remark-gfm defaults singleTilde to true, which renders "~$430" (approximately
// $430) as struck-through — the assistant appears to cross out dollar figures.
const remarkPlugins: Options["remarkPlugins"] = [[remarkGfm, { singleTilde: false }]];

const THINKING_DOT_DELAYS = ["-0.3s", "-0.15s", ""];

export interface ActionPayload {
  action: true;
  action_type: string;
  display: {
    label: string;
    details: { field: string; value: string }[];
  };
  params: Record<string, unknown>;
}

interface ChatMessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  actionHandled?: boolean;
  onConfirm?: (payload: ActionPayload) => void;
  onCancel?: () => void;
}

export function parseActionFromContent(content: string): ActionPayload | null {
  const actionMatch = content.match(/```action\s*\n?([\s\S]*?)```/);
  if (actionMatch) {
    try {
      const parsed = JSON.parse(actionMatch[1].trim());
      if (parsed.action === true && parsed.action_type && parsed.display && parsed.params) {
        return parsed as ActionPayload;
      }
    } catch {
      // Not valid JSON
    }
  }
  return null;
}

/** Index just past the last sentence terminator at or after `from`, or `from` if there is none.
 * A period closes a sentence only when whitespace or the end of the buffer follows it, so the
 * decimal point in `$125.50` is never mistaken for one — money is most of what this app streams. */
function lastSentenceBoundary(text: string, from: number): number {
  for (let i = text.length - 1; i >= from; i--) {
    const char = text[i];
    if (char === "\n") return i + 1;
    if (char !== "." && char !== "!" && char !== "?") continue;
    const next = text[i + 1];
    if (next === undefined || /\s/.test(next)) return i + 1;
  }
  return from;
}

// Streaming is NOT a plain live region. The text renders token-by-token on screen, but assistive
// tech is only given whole sentences — a live region bound to the raw stream announces every DOM
// mutation, so a single reply becomes a firehose of partial words.
function useSentenceAnnouncement(content: string, active: boolean, streaming: boolean) {
  const [announcement, setAnnouncement] = useState("");
  const cursorRef = useRef(0);

  useEffect(() => {
    if (!active) return;
    if (content.length < cursorRef.current) cursorRef.current = 0;

    if (streaming) {
      const boundary = lastSentenceBoundary(content, cursorRef.current);
      if (boundary > cursorRef.current) {
        const next = content.slice(cursorRef.current, boundary).trim();
        cursorRef.current = boundary;
        if (next !== "") setAnnouncement(next);
      }
      return;
    }

    if (cursorRef.current < content.length) {
      const next = content.slice(cursorRef.current).trim();
      cursorRef.current = content.length;
      if (next !== "") setAnnouncement(next);
    }
  }, [content, active, streaming]);

  return announcement;
}

export function ChatMessageBubble({
  role,
  content,
  isStreaming,
  actionHandled,
  onConfirm,
  onCancel,
}: ChatMessageBubbleProps) {
  const { t } = useTranslation();
  const isUser = role === "user";
  const isToolSearching = !isUser && content === "tool-searching";
  const isThinking = !isUser && !isToolSearching && isStreaming && content === "";
  const hasToolCall = !isUser && !isToolSearching && /```tool_call[\s\S]*?```/.test(content);
  const actionPayload = useMemo(
    () => (!isUser && !isToolSearching && !hasToolCall ? parseActionFromContent(content) : null),
    [content, isUser, isToolSearching, hasToolCall]
  );

  const announcement = useSentenceAnnouncement(
    content,
    !isUser && !isToolSearching && !hasToolCall,
    isStreaming === true
  );

  return (
    <div
      className={cn("flex", isUser ? "justify-end" : "justify-start")}
      data-testid={`chat-message-${role}`}
    >
      <div
        className={cn(
          "max-w-[80%] rounded-lg px-3.5 py-2.5 text-body",
          isUser ? "bg-brand text-brand-on" : "bg-chrome text-ink"
        )}
      >
        {!isUser && (
          <p className="sr-only" aria-live="polite" data-testid="chat-live-region">
            {announcement}
          </p>
        )}

        {isUser ? (
          content
        ) : isThinking ? (
          <div
            className="flex items-center gap-1 py-0.5"
            role="status"
            aria-label={t("chat.thinking")}
            data-testid="thinking-indicator"
          >
            {THINKING_DOT_DELAYS.map((delay) => (
              <span
                key={delay}
                aria-hidden="true"
                className="size-1.5 animate-bounce rounded-full bg-ink-dim"
                style={delay ? { animationDelay: delay } : undefined}
              />
            ))}
          </div>
        ) : isToolSearching || hasToolCall ? (
          <div
            className="flex items-center gap-2 text-ink-dim"
            role="status"
            data-testid="tool-searching-indicator"
          >
            <span
              aria-hidden="true"
              className="inline-block size-4 animate-spin rounded-full border-2 border-line-strong border-t-transparent"
            />
            <span>{t("chat.searching")}</span>
          </div>
        ) : actionPayload ? (
          <Card data-testid="action-confirmation-card">
            <CardContent>
              <h4 className="text-h3 text-ink">{actionPayload.display.label}</h4>
              <dl className="mt-2 space-y-1">
                {actionPayload.display.details.map((detail, i) => (
                  <div key={i} className="flex justify-between gap-3 text-caption">
                    <dt className="text-ink-dim">{detail.field}</dt>
                    <dd className="money text-ink">{detail.value}</dd>
                  </div>
                ))}
              </dl>
              {/* The model never writes on its own: it proposes, this card waits, the user
                * approves. The hint says so rather than leaving it to be inferred. */}
              <p className="mt-2 text-caption text-ink-dim">{t("chat.confirmCardHint")}</p>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  onClick={() => onConfirm?.(actionPayload)}
                  disabled={actionHandled}
                  aria-disabled={actionHandled || undefined}
                  data-testid="action-confirm-button"
                >
                  {t("chat.confirmAdd")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onCancel?.()}
                  disabled={actionHandled}
                  aria-disabled={actionHandled || undefined}
                  data-testid="action-cancel-button"
                >
                  {t("common.cancel")}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : isStreaming ? (
          <div className="money whitespace-pre-wrap">{content}</div>
        ) : (
          // Figures in an answer are tabular Inter; `font-mono` stays scoped to real code below.
          <div className="money">
            <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
              {content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}

const markdownComponents: Components = {
  h1: ({ children }) => <h1 className="mt-3 mb-2 text-h2 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-2.5 mb-1.5 text-h3 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-2 mb-1 text-h3 first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="text-label">{children}</strong>,
  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-0.5 last:mb-0">{children}</ul>,
  ol: ({ children }) => (
    <ol className="mb-2 ml-4 list-decimal space-y-0.5 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  // font-mono survives here and in <pre> only: this is genuine code, never a figure.
  code: ({ children }) => (
    <code className="rounded-sm bg-track px-1 py-0.5 font-mono text-caption">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-md bg-track p-2 font-mono text-caption [&>code]:block [&>code]:rounded-none [&>code]:bg-transparent [&>code]:p-0">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto" data-testid="chat-table">
      <table className="w-full border-collapse text-caption">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr className="border-b border-line">{children}</tr>,
  th: ({ children }) => (
    <th scope="col" className="px-2 py-1 text-left text-column-head text-ink-faint">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="money px-2 py-1">{children}</td>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-line-strong pl-3 italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-line" />,
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-brand-ink underline underline-offset-2"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
};
