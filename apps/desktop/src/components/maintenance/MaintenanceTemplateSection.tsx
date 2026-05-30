import { useTranslation } from "react-i18next";
import { Label, PillTabs } from "@nixus/shared";
import { useMaintenanceTaskBaselines } from "@/hooks/useMaintenance";

export type MaintenanceTemplateMode = "default" | "custom";

interface MaintenanceTemplateSectionProps {
  mode: MaintenanceTemplateMode;
  onModeChange: (mode: MaintenanceTemplateMode) => void;
}

export function MaintenanceTemplateSection({
  mode,
  onModeChange,
}: MaintenanceTemplateSectionProps) {
  const { t } = useTranslation();
  const { data: baselines } = useMaintenanceTaskBaselines();

  return (
    <div className="space-y-2" data-testid="maintenance-template-section">
      <Label>{t("maintenance.template.label")}</Label>
      <PillTabs
        options={["default", "custom"] as const}
        labels={{
          default: t("maintenance.template.defaultOption"),
          custom: t("maintenance.template.customOption"),
        }}
        value={mode}
        onChange={onModeChange}
        data-testid="maintenance-template-mode"
      />

      <p className="text-xs text-muted-foreground">
        {mode === "default"
          ? t("maintenance.template.defaultDescription", {
              count: baselines?.length ?? 12,
            })
          : t("maintenance.template.customDescription")}
      </p>
    </div>
  );
}
