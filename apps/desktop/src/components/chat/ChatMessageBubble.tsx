import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

const remarkPlugins = [remarkGfm];

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
  const hasToolCall = !isUser && !isToolSearching && /```tool_call[\s\S]*?```/.test(content);
  const actionPayload = useMemo(
    () => (!isUser && !isToolSearching && !hasToolCall ? parseActionFromContent(content) : null),
    [content, isUser, isToolSearching, hasToolCall]
  );

  return (
    <div
      className={cn("flex", isUser ? "justify-end" : "justify-start")}
      data-testid={`chat-message-${role}`}
    >
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "rounded-br-sm bg-primary text-primary-foreground"
            : "rounded-bl-sm bg-muted text-foreground"
        )}
      >
        {isUser ? (
          content
        ) : isToolSearching || hasToolCall ? (
          <div className="flex items-center gap-2" data-testid="tool-searching-indicator">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            <span>{t("chat.searching")}</span>
          </div>
        ) : actionPayload ? (
          <div>
            <div
              className="mt-1 rounded-lg border bg-card p-4"
              data-testid="action-confirmation-card"
            >
              <h4 className="text-sm font-semibold">{actionPayload.display.label}</h4>
              <div className="mt-2 space-y-1">
                {actionPayload.display.details.map((detail, i) => (
                  <div key={i} className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{detail.field}</span>
                    <span className="font-mono">{detail.value}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => onConfirm?.(actionPayload)}
                  disabled={actionHandled}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                  data-testid="action-confirm-button"
                >
                  {t("common.confirm")}
                </button>
                <button
                  onClick={() => onCancel?.()}
                  disabled={actionHandled}
                  className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
                  data-testid="action-cancel-button"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          </div>
        ) : isStreaming ? (
          <div className="whitespace-pre-wrap">{content}</div>
        ) : (
          <ReactMarkdown
            remarkPlugins={remarkPlugins}
            components={markdownComponents}
          >
            {content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}

const markdownComponents: Components = {
  h1: ({ children }) => <h1 className="mb-2 mt-3 text-base font-bold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1.5 mt-2.5 text-sm font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-medium first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-0.5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-0.5 last:mb-0">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  code: ({ children }) => (
    <code className="rounded bg-background/50 px-1 py-0.5 font-mono text-xs">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-md bg-background/50 p-2 text-xs [&>code]:block [&>code]:rounded-none [&>code]:bg-transparent [&>code]:p-0">{children}</pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto" data-testid="chat-table">
      <table className="w-full text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr className="border-b border-border/50">{children}</tr>,
  th: ({ children }) => (
    <th className="px-2 py-1 text-left font-medium text-muted-foreground">{children}</th>
  ),
  td: ({ children }) => <td className="px-2 py-1 font-mono">{children}</td>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-muted-foreground/30 pl-3 italic">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-border/50" />,
  a: ({ href, children }) => (
    <a href={href} className="underline underline-offset-2" target="_blank" rel="noopener noreferrer">{children}</a>
  ),
};
