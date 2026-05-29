import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/chat")({
  validateSearch: (search: Record<string, unknown>): { conversation?: number } => {
    const conv = Number(search.conversation);
    return Number.isInteger(conv) && conv > 0 ? { conversation: conv } : {};
  },
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/ai/$agentId",
      params: { agentId: "budget-helper" },
      search: search.conversation ? { conversation: search.conversation } : {},
      replace: true,
    });
  },
});
