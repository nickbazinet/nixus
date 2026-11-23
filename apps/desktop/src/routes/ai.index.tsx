import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { Card, CardContent, IconChip } from "@nixus/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { useAgents } from "@/lib/agents";

export const Route = createFileRoute("/ai/")({
  component: AiLandingPage,
});

function AiLandingPage() {
  const { t } = useTranslation();
  const { agents } = useAgents();

  return (
    <div>
      <PageHeader title={t("nav.agents")} subtitle={t("surface.subtitle.agents")} />
      <div className="grid grid-cols-1 gap-grid-gap sm:grid-cols-2 lg:grid-cols-3">
        {agents.map((agent) => (
          // The whole card is one focusable target with one accessible name — never a card with
          // competing inner click targets, so the pill below is a painted affordance, not a button.
          <Card
            key={agent.id}
            interactive
            className="h-full"
            render={
              <Link to="/ai/$agentId" params={{ agentId: agent.id }} aria-label={t(agent.nameKey)} />
            }
          >
            <CardContent className="flex h-full flex-col items-start gap-4">
              <IconChip icon={agent.icon} size="lg" />
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-h1 text-ink">{t(agent.nameKey)}</h2>
                <p className="mt-1.5 text-caption text-ink-dim">
                  {t(agent.descriptionKey)}
                </p>
              </div>
              <span
                aria-hidden="true"
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line-strong bg-card px-3.5 text-label text-ink transition-colors group-hover/card:border-brand/40"
              >
                {t("ai.v2.openAgent")}
                <ArrowRight className="size-3.5" />
              </span>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
