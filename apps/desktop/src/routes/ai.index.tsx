import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@nixus/shared";
import { AGENTS } from "@/lib/agents";

export const Route = createFileRoute("/ai/")({
  component: AiLandingPage,
});

function AiLandingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div>
      <PageHeader title={t("nav.agents")} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {AGENTS.map((agent) => (
          <Card
            key={agent.id}
            className="cursor-pointer hover:bg-accent/50 transition-colors"
            role="link"
            aria-label={t(agent.nameKey)}
            tabIndex={0}
            onClick={() =>
              navigate({ to: "/ai/$agentId", params: { agentId: agent.id } })
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                navigate({
                  to: "/ai/$agentId",
                  params: { agentId: agent.id },
                });
              }
            }}
          >
            <CardContent className="flex flex-col items-center gap-3 p-6">
              <agent.icon size={32} className="text-primary" />
              <div className="text-center">
                <h2 className="font-semibold">{t(agent.nameKey)}</h2>
                <p className="text-sm text-muted-foreground">
                  {t(agent.descriptionKey)}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
