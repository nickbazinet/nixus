import { describe, expect, it } from "vitest";
import enLocale from "../en.json";
import frLocale from "../fr.json";

const en = enLocale as Record<string, string>;
const fr = frLocale as Record<string, string>;

const MAINTENANCE_PREFIXES = ["maintenance.", "nav.maintenance"];

const CANONICAL_TASK_KEYS = [
  "engine_oil_filter",
  "transmission_fluid",
  "brake_fluid",
  "coolant",
  "power_steering_fluid",
  "tire_rotation",
  "tire_replacement",
  "brake_pads",
  "brake_discs",
  "engine_air_filter",
  "cabin_air_filter",
  "spark_plugs",
  "shock_absorbers",
  "battery_replacement",
] as const;

function collectMaintenanceKeys(locale: Record<string, string>): string[] {
  return Object.keys(locale).filter((key) =>
    MAINTENANCE_PREFIXES.some(
      (prefix) => key === prefix.replace(/\.$/, "") || key.startsWith(prefix)
    )
  );
}

describe("maintenance i18n parity", () => {
  it("includes all maintenance-related EN keys in FR", () => {
    const enKeys = collectMaintenanceKeys(en);
    const frKeys = new Set(collectMaintenanceKeys(fr));
    const missingInFr = enKeys.filter((key) => !frKeys.has(key));

    expect(missingInFr, `Missing FR keys: ${missingInFr.join(", ")}`).toEqual([]);
  });

  it("includes EN and FR labels for all canonical task keys", () => {
    for (const taskKey of CANONICAL_TASK_KEYS) {
      const key = `maintenance.tasks.${taskKey}`;
      expect(en[key], `Missing EN key ${key}`).toBeTruthy();
      expect(fr[key], `Missing FR key ${key}`).toBeTruthy();
    }
  });
});
