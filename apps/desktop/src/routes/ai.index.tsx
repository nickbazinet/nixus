import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@nixus/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { AGENTS } from "@/lib/agents";

export const Route = createFileRoute("/ai/")({
  component: AiLandingPage,
});

function AiLandingPage() {
  const { t } = useTranslation();

  return (
    <div>
      <PageHeader title={t("nav.agents")} />
      <div className="grid grid-cols-1 gap-grid-gap sm:grid-cols-2 lg:grid-cols-3">
        {AGENTS.map((agent) => (
          // The whole card is one focusable target with one accessible name — never a card with
          // competing inner click targets.
          <Card
            key={agent.id}
            interactive
            render={
              <Link to="/ai/$agentId" params={{ agentId: agent.id }} aria-label={t(agent.nameKey)} />
            }
          >
            <CardContent className="flex flex-col items-center gap-2 text-center">
              <agent.icon size={28} className="text-brand" aria-hidden="true" />
              <h2 className="text-h3 text-ink">{t(agent.nameKey)}</h2>
              <p className="text-caption text-ink-dim">{t(agent.descriptionKey)}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
