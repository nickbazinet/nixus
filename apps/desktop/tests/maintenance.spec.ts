import { test, expect, type Page, type Locator } from "@playwright/test";

const yearlySummaryMock = {
  year: 2026,
  is_current_year: true,
  total_spent_cents: 0,
  total_income_cents: 0,
  cash_flow_net_cents: 0,
  net_worth_gain_cents: null,
  net_worth_gain_available: false,
  top_categories: [],
  monthly_totals: [],
  all_categories: [],
  available_years: [2026],
};

async function setupMaintenanceTauriMock(
  page: Page,
  options?: {
    seedVehicles?: Array<{
      odometer_km: number;
      make?: string | null;
      model?: string | null;
      year?: number | null;
    }>;
    catalog?: {
      available: boolean;
      stale?: boolean;
    };
  }
) {
  await page.addInitScript(({ seedVehicles, yearlyMock, catalog }) => {
    const catalogAvailable = catalog?.available ?? false;
    const catalogStale = catalog?.stale ?? false;
    const DEFAULT_TASKS = [
      { task_type_key: "engine_oil_filter", interval_km: 8000, interval_months: 6 },
      { task_type_key: "transmission_fluid", interval_km: 60000, interval_months: 48 },
      { task_type_key: "brake_fluid", interval_km: 40000, interval_months: 24 },
      { task_type_key: "coolant", interval_km: 80000, interval_months: 48 },
      { task_type_key: "power_steering_fluid", interval_km: 80000, interval_months: 48 },
      { task_type_key: "brake_pads", interval_km: 50000, interval_months: 36 },
      { task_type_key: "brake_discs", interval_km: 90000, interval_months: 60 },
      { task_type_key: "engine_air_filter", interval_km: 24000, interval_months: 12 },
      { task_type_key: "cabin_air_filter", interval_km: 24000, interval_months: 12 },
      { task_type_key: "spark_plugs", interval_km: 100000, interval_months: 60 },
      { task_type_key: "shock_absorbers", interval_km: 80000, interval_months: 48 },
      { task_type_key: "battery_replacement", interval_km: 0, interval_months: 48 },
    ];

    interface MockMaintenanceTask {
      id: number;
      vehicle_id: number;
      task_type_key: string;
      interval_km: number;
      interval_months: number;
      default_interval_km: number;
      default_interval_months: number;
      custom_task_name?: string | null;
      last_service_date: string | null;
      last_service_odometer_km: number | null;
      created_at: string;
      updated_at: string;
      status: "ok" | "upcoming" | "due" | "overdue";
      km_remaining: number | null;
      days_remaining: number | null;
      next_due_date: string | null;
      next_due_odometer_km: number | null;
    }

    interface MockVehicle {
      id: number;
      nickname: string;
      make: string | null;
      model: string | null;
      year: number | null;
      odometer_km: number;
      created_at: string;
      updated_at: string;
    }

    const statusRank = (status: "ok" | "upcoming" | "due" | "overdue") =>
      ({ ok: 0, upcoming: 1, due: 2, overdue: 3 })[status];

    function evaluateMockTask(
      task: Omit<
        MockMaintenanceTask,
        | "status"
        | "km_remaining"
        | "days_remaining"
        | "next_due_date"
        | "next_due_odometer_km"
      >,
      vehicle: MockVehicle
    ) {
      const alertKm = 500;
      const alertDays = 14;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let kmRemaining: number | null = null;
      let daysRemaining: number | null = null;
      let nextDueOdometer: number | null = null;
      let nextDueDate: string | null = null;

      if (task.interval_km > 0) {
        const anchor =
          task.last_service_odometer_km ?? vehicle.odometer_km;
        nextDueOdometer = anchor + task.interval_km;
        kmRemaining = nextDueOdometer - vehicle.odometer_km;
      }

      if (task.interval_months > 0) {
        const anchor = task.last_service_date
          ? new Date(`${task.last_service_date}T00:00:00`)
          : new Date(vehicle.created_at.slice(0, 10) + "T00:00:00");
        const due = new Date(anchor);
        due.setMonth(due.getMonth() + task.interval_months);
        nextDueDate = due.toISOString().slice(0, 10);
        daysRemaining = Math.round(
          (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        );
      }

      const classify = (remaining: number, threshold: number) => {
        if (remaining < 0) return "overdue";
        if (remaining === 0) return "due";
        if (remaining <= threshold) return "upcoming";
        return "ok";
      };

      const kmStatus =
        kmRemaining !== null ? classify(kmRemaining, alertKm) : null;
      const dayStatus =
        daysRemaining !== null ? classify(daysRemaining, alertDays) : null;

      let status: "ok" | "upcoming" | "due" | "overdue" = "ok";
      if (kmStatus && dayStatus) {
        status = statusRank(kmStatus) >= statusRank(dayStatus) ? kmStatus : dayStatus;
      } else if (kmStatus) {
        status = kmStatus;
      } else if (dayStatus) {
        status = dayStatus;
      }

      return {
        status,
        km_remaining: kmRemaining,
        days_remaining: daysRemaining,
        next_due_date: nextDueDate,
        next_due_odometer_km: nextDueOdometer,
      };
    }

    function isAlertStatus(status: "ok" | "upcoming" | "due" | "overdue") {
      return status === "upcoming" || status === "due" || status === "overdue";
    }

    function buildMostUrgentTask(
      task: Omit<
        MockMaintenanceTask,
        | "status"
        | "km_remaining"
        | "days_remaining"
        | "next_due_date"
        | "next_due_odometer_km"
      >,
      vehicle: MockVehicle
    ) {
      const evaluated = evaluateMockTask(task, vehicle);
      const result: {
        task_type_key: string;
        status: "ok" | "upcoming" | "due" | "overdue";
        days_remaining?: number;
        km_remaining?: number;
      } = {
        task_type_key: task.task_type_key,
        status: evaluated.status,
      };
      if (evaluated.days_remaining !== null) {
        result.days_remaining = evaluated.days_remaining;
      }
      if (evaluated.km_remaining !== null) {
        result.km_remaining = evaluated.km_remaining;
      }
      return result;
    }

    function isMoreUrgent(
      candidate: ReturnType<typeof buildMostUrgentTask>,
      current: ReturnType<typeof buildMostUrgentTask>
    ) {
      const rankDiff = statusRank(candidate.status) - statusRank(current.status);
      if (rankDiff !== 0) return rankDiff > 0;

      const candidateRemaining =
        candidate.km_remaining ?? candidate.days_remaining ?? Number.MAX_SAFE_INTEGER;
      const currentRemaining =
        current.km_remaining ?? current.days_remaining ?? Number.MAX_SAFE_INTEGER;
      return candidateRemaining < currentRemaining;
    }

    function buildMaintenanceAlertSummary() {
      let totalAlerts = 0;
      let worst: "ok" | "upcoming" | "due" | "overdue" = "ok";
      const rows: Array<{
        vehicle_id: number;
        nickname: string;
        alert_count: number;
        most_urgent_task: ReturnType<typeof buildMostUrgentTask>;
      }> = [];

      for (const vehicle of vehicles) {
        const tasks = tasksByVehicle.get(vehicle.id) ?? [];
        let alertCount = 0;
        let mostUrgent: ReturnType<typeof buildMostUrgentTask> | null = null;

        for (const task of tasks) {
          const evaluated = evaluateMockTask(task, vehicle);
          if (isAlertStatus(evaluated.status)) {
            totalAlerts += 1;
            alertCount += 1;
            const candidate = buildMostUrgentTask(task, vehicle);
            if (!mostUrgent || isMoreUrgent(candidate, mostUrgent)) {
              mostUrgent = candidate;
            }
          }
        }

        if (alertCount > 0 && mostUrgent) {
          if (statusRank(mostUrgent.status) > statusRank(worst)) {
            worst = mostUrgent.status;
          }
          rows.push({
            vehicle_id: vehicle.id,
            nickname: vehicle.nickname,
            alert_count: alertCount,
            most_urgent_task: mostUrgent,
          });
        }
      }

      rows.sort((a, b) => {
        const aRank = statusRank(a.most_urgent_task.status);
        const bRank = statusRank(b.most_urgent_task.status);
        if (aRank !== bRank) return bRank - aRank;
        const aRem =
          a.most_urgent_task.km_remaining ??
          a.most_urgent_task.days_remaining ??
          Number.MAX_SAFE_INTEGER;
        const bRem =
          b.most_urgent_task.km_remaining ??
          b.most_urgent_task.days_remaining ??
          Number.MAX_SAFE_INTEGER;
        return aRem - bRem;
      });

      return {
        total_alerts: totalAlerts,
        total_vehicles: vehicles.length,
        vehicles_with_alerts: rows.length,
        worst_status: worst,
        vehicles: rows.slice(0, 2),
      };
    }

    const STORAGE_KEY = "__nixus_maintenance_mock_state__";

    interface PersistedMockState {
      vehicles: MockVehicle[];
      tasksByVehicle: Array<[number, MockMaintenanceTask[]]>;
      serviceLogs: Array<{
        id: number;
        vehicle_id: number;
        task_id: number | null;
        task_type_key?: string | null;
        custom_service_name?: string | null;
        service_date: string;
        odometer_km: number;
        notes: string | null;
        created_at: string;
      }>;
      nextVehicleId: number;
      nextTaskId: number;
      nextLogId: number;
    }

    function saveMockState(
      vehicles: MockVehicle[],
      tasksByVehicle: Map<number, MockMaintenanceTask[]>,
      serviceLogs: PersistedMockState["serviceLogs"],
      ids: { nextVehicleId: number; nextTaskId: number; nextLogId: number }
    ) {
      const payload: PersistedMockState = {
        vehicles,
        tasksByVehicle: Array.from(tasksByVehicle.entries()),
        serviceLogs,
        nextVehicleId: ids.nextVehicleId,
        nextTaskId: ids.nextTaskId,
        nextLogId: ids.nextLogId,
      };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    }

    function loadMockState(): PersistedMockState | null {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as PersistedMockState;
      } catch {
        return null;
      }
    }

    const persisted = loadMockState();
    const vehicles: MockVehicle[] = persisted?.vehicles ?? [];
    const tasksByVehicle = new Map<number, MockMaintenanceTask[]>(
      persisted?.tasksByVehicle ?? []
    );
    const serviceLogs: PersistedMockState["serviceLogs"] =
      persisted?.serviceLogs ?? [];
    let nextVehicleId = persisted?.nextVehicleId ?? 1;
    let nextTaskId = persisted?.nextTaskId ?? 1;
    let nextLogId = persisted?.nextLogId ?? 1;

    function persistMockState() {
      saveMockState(vehicles, tasksByVehicle, serviceLogs, {
        nextVehicleId,
        nextTaskId,
        nextLogId,
      });
    }

    function deriveVehicleNickname(
      make: string | null,
      model: string | null,
      year: number | null
    ): string {
      const parts: string[] = [];
      if (year != null) parts.push(String(year));
      if (make?.trim()) parts.push(make.trim());
      if (model?.trim()) parts.push(model.trim());
      return parts.length > 0 ? parts.join(" ") : "Vehicle";
    }

    function createMockVehicle(
      odometerKm: number,
      make: string | null = null,
      model: string | null = null,
      year: number | null = null,
      customTasks?: Array<{
        task_type_key: string;
        interval_km: number;
        interval_months: number;
      }> | false | null
    ): MockVehicle {
      const now = new Date().toISOString();
      const vehicle: MockVehicle = {
        id: nextVehicleId++,
        nickname: deriveVehicleNickname(make, model, year),
        make,
        model,
        year,
        odometer_km: odometerKm,
        created_at: now,
        updated_at: now,
      };
      vehicles.unshift(vehicle);
      if (customTasks === false) {
        tasksByVehicle.set(vehicle.id, []);
      } else if (customTasks && customTasks.length > 0) {
        seedCustomTasks(vehicle, customTasks);
      } else {
        seedTasks(vehicle);
      }
      persistMockState();
      return vehicle;
    }

    if (!persisted && seedVehicles) {
      for (let i = 0; i < seedVehicles.length; i++) {
        const seed = seedVehicles[i];
        const vehicle = createMockVehicle(
          seed.odometer_km,
          seed.make ?? null,
          seed.model ?? null,
          seed.year ?? null
        );
        if (i === 0) {
          const tasks = tasksByVehicle.get(vehicle.id) ?? [];
          const oil = tasks.find(
            (task) => task.task_type_key === "engine_oil_filter"
          );
          if (oil) {
            oil.last_service_odometer_km = Math.max(seed.odometer_km - 9_000, 0);
            oil.last_service_date = new Date().toISOString().slice(0, 10);
            Object.assign(oil, evaluateMockTask(oil, vehicle));
            persistMockState();
          }
        }
      }
    }

    function seedTasks(vehicle: MockVehicle): MockMaintenanceTask[] {
      const now = new Date().toISOString();
      const tasks = DEFAULT_TASKS.map((baseline) => {
        const base = {
          id: nextTaskId++,
          vehicle_id: vehicle.id,
          task_type_key: baseline.task_type_key,
          interval_km: baseline.interval_km,
          interval_months: baseline.interval_months,
          default_interval_km: baseline.interval_km,
          default_interval_months: baseline.interval_months,
          last_service_date: null,
          last_service_odometer_km: null,
          created_at: now,
          updated_at: now,
        };
        return { ...base, ...evaluateMockTask(base, vehicle) };
      });
      tasksByVehicle.set(vehicle.id, tasks);
      return tasks;
    }

    function seedCustomTasks(
      vehicle: MockVehicle,
      customTasks: Array<{
        task_type_key: string;
        interval_km: number;
        interval_months: number;
      }>
    ): MockMaintenanceTask[] {
      const now = new Date().toISOString();
      const tasks = customTasks.map((task) => {
        const baseline = DEFAULT_TASKS.find(
          (entry) => entry.task_type_key === task.task_type_key
        );
        const defaultKm = baseline?.interval_km ?? task.interval_km;
        const defaultMonths = baseline?.interval_months ?? task.interval_months;
        const base = {
          id: nextTaskId++,
          vehicle_id: vehicle.id,
          task_type_key: task.task_type_key,
          interval_km: task.interval_km,
          interval_months: task.interval_months,
          default_interval_km: defaultKm,
          default_interval_months: defaultMonths,
          last_service_date: null,
          last_service_odometer_km: null,
          created_at: now,
          updated_at: now,
        };
        return { ...base, ...evaluateMockTask(base, vehicle) };
      });
      tasksByVehicle.set(vehicle.id, tasks);
      return tasks;
    }

    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args: Record<string, unknown>) => {
        switch (cmd) {
          case "get_maintenance_task_baselines":
            return Promise.resolve(DEFAULT_TASKS);

          case "get_vehicles":
            return Promise.resolve([...vehicles]);

          case "get_vehicle": {
            const id = args.id as number;
            const vehicle = vehicles.find((v) => v.id === id);
            if (!vehicle) {
              return Promise.reject({
                type: "not_found",
                message: "Vehicle not found",
              });
            }
            const tasks = (tasksByVehicle.get(id) ?? []).map((task) => ({
              ...task,
              ...evaluateMockTask(task, vehicle),
            }));
            return Promise.resolve({ vehicle, tasks });
          }

          case "create_vehicle": {
            const odometerKm = args.odometer_km as number;
            const make = (args.make as string | null) ?? null;
            const model = (args.model as string | null) ?? null;
            const year = (args.year as number | null) ?? null;
            const useDefaultTemplate =
              (args.use_default_template as boolean | undefined) ?? true;
            const customTasks = args.custom_tasks as
              | Array<{
                  task_type_key: string;
                  interval_km: number;
                  interval_months: number;
                }>
              | null
              | undefined;

            if (odometerKm < 0) {
              return Promise.reject({
                type: "validation",
                message: "Odometer must be at least 0",
                field: "odometer_km",
              });
            }

            return Promise.resolve(
              createMockVehicle(
                odometerKm,
                make,
                model,
                year,
                useDefaultTemplate
                  ? null
                  : customTasks && customTasks.length > 0
                    ? customTasks
                    : false
              )
            );
          }

          case "add_maintenance_task": {
            const input = args.input as {
              vehicle_id: number;
              task_type_key?: string | null;
              custom_task_name?: string | null;
              interval_km?: number | null;
              interval_months?: number | null;
            };
            const vehicle = vehicles.find((v) => v.id === input.vehicle_id);
            if (!vehicle) {
              return Promise.reject({
                type: "not_found",
                message: "Vehicle not found",
              });
            }

            const tasks = tasksByVehicle.get(input.vehicle_id) ?? [];
            const customName = input.custom_task_name?.trim();

            if (customName) {
              if (
                tasks.some(
                  (task) =>
                    task.custom_task_name?.trim().toLowerCase() ===
                    customName.toLowerCase()
                )
              ) {
                return Promise.reject({
                  type: "validation",
                  message: "A service with this name is already on the schedule",
                  field: "custom_task_name",
                });
              }

              const intervalKm = input.interval_km ?? 0;
              const intervalMonths = input.interval_months ?? 0;
              if (intervalKm < 0 || intervalMonths < 0) {
                return Promise.reject({
                  type: "validation",
                  message: "Interval must be zero or greater",
                });
              }
              if (intervalKm === 0 && intervalMonths === 0) {
                return Promise.reject({
                  type: "validation",
                  message: "At least one interval must be greater than zero",
                  field: "interval_km",
                });
              }

              const now = new Date().toISOString();
              const taskTypeKey = `custom_${Date.now()}_${nextTaskId}`;
              const base = {
                id: nextTaskId++,
                vehicle_id: input.vehicle_id,
                task_type_key: taskTypeKey,
                interval_km: intervalKm,
                interval_months: intervalMonths,
                default_interval_km: intervalKm,
                default_interval_months: intervalMonths,
                custom_task_name: customName,
                last_service_date: null,
                last_service_odometer_km: null,
                created_at: now,
                updated_at: now,
              };
              const task = { ...base, ...evaluateMockTask(base, vehicle) };
              tasks.push(task);
              tasksByVehicle.set(input.vehicle_id, tasks);
              persistMockState();
              return Promise.resolve(task);
            }

            const taskTypeKey = input.task_type_key?.trim();
            if (!taskTypeKey) {
              return Promise.reject({
                type: "validation",
                message: "Select a service type or enter a custom service name",
                field: "task_type_key",
              });
            }

            const baseline = DEFAULT_TASKS.find(
              (entry) => entry.task_type_key === taskTypeKey
            );
            if (!baseline) {
              return Promise.reject({
                type: "validation",
                message: "Unknown maintenance task type",
                field: "task_type_key",
              });
            }

            if (tasks.some((task) => task.task_type_key === taskTypeKey)) {
              return Promise.reject({
                type: "validation",
                message: "This service is already on the schedule",
                field: "task_type_key",
              });
            }

            const intervalKm = input.interval_km ?? baseline.interval_km;
            const intervalMonths =
              input.interval_months ?? baseline.interval_months;
            const now = new Date().toISOString();
            const base = {
              id: nextTaskId++,
              vehicle_id: input.vehicle_id,
              task_type_key: taskTypeKey,
              interval_km: intervalKm,
              interval_months: intervalMonths,
              default_interval_km: baseline.interval_km,
              default_interval_months: baseline.interval_months,
              custom_task_name: null,
              last_service_date: null,
              last_service_odometer_km: null,
              created_at: now,
              updated_at: now,
            };
            const task = { ...base, ...evaluateMockTask(base, vehicle) };
            tasks.push(task);
            tasksByVehicle.set(input.vehicle_id, tasks);
            persistMockState();
            return Promise.resolve(task);
          }

          case "update_maintenance_task": {
            const taskId = args.task_id as number;
            const intervalKm = args.interval_km as number;
            const intervalMonths = args.interval_months as number;

            if (intervalKm < 0 || intervalMonths < 0) {
              return Promise.reject({
                type: "validation",
                message: "Interval must be zero or greater",
              });
            }

            if (intervalKm === 0 && intervalMonths === 0) {
              return Promise.reject({
                type: "validation",
                message: "At least one interval must be greater than zero",
                field: "interval_km",
              });
            }

            let updatedTask: MockMaintenanceTask | undefined;
            for (const tasks of tasksByVehicle.values()) {
              const task = tasks.find((t) => t.id === taskId);
              if (task) {
                const vehicle = vehicles.find((v) => v.id === task.vehicle_id);
                if (!vehicle) {
                  return Promise.reject({
                    type: "not_found",
                    message: "Vehicle not found",
                  });
                }

                task.interval_km = intervalKm;
                task.interval_months = intervalMonths;
                task.updated_at = new Date().toISOString();
                Object.assign(task, evaluateMockTask(task, vehicle));
                updatedTask = task;
                break;
              }
            }

            if (!updatedTask) {
              return Promise.reject({
                type: "not_found",
                message: "Maintenance task not found",
              });
            }

            persistMockState();
            return Promise.resolve(updatedTask);
          }

          case "update_vehicle_odometer": {
            const vehicleId = args.vehicle_id as number;
            const odometerKm = args.odometer_km as number;

            if (odometerKm < 0) {
              return Promise.reject({
                type: "validation",
                message: "Odometer must be a non-negative integer",
                field: "odometer_km",
              });
            }

            const vehicle = vehicles.find((v) => v.id === vehicleId);
            if (!vehicle) {
              return Promise.reject({
                type: "not_found",
                message: "Vehicle not found",
              });
            }

            vehicle.odometer_km = odometerKm;
            vehicle.updated_at = new Date().toISOString();

            const tasks = tasksByVehicle.get(vehicleId) ?? [];
            for (const task of tasks) {
              Object.assign(task, evaluateMockTask(task, vehicle));
            }

            persistMockState();
            return Promise.resolve({ vehicle, tasks });
          }

          case "log_maintenance_service": {
            const input = args.input as {
              task_id: number;
              service_date: string;
              odometer_km: number;
              notes?: string | null;
            };

            if (!input.service_date?.trim()) {
              return Promise.reject({
                type: "validation",
                message: "Service date is required",
                field: "service_date",
              });
            }

            if (input.odometer_km < 0) {
              return Promise.reject({
                type: "validation",
                message: "Odometer must be zero or greater",
                field: "odometer_km",
              });
            }

            let targetTask: MockMaintenanceTask | undefined;
            for (const tasks of tasksByVehicle.values()) {
              const task = tasks.find((t) => t.id === input.task_id);
              if (task) {
                targetTask = task;
                break;
              }
            }

            if (!targetTask) {
              return Promise.reject({
                type: "not_found",
                message: "Maintenance task not found",
              });
            }

            const vehicle = vehicles.find((v) => v.id === targetTask!.vehicle_id);
            if (!vehicle) {
              return Promise.reject({
                type: "not_found",
                message: "Vehicle not found",
              });
            }

            const previousOdometer = vehicle.odometer_km;
            const odometerUpdated = input.odometer_km > vehicle.odometer_km;

            if (odometerUpdated) {
              vehicle.odometer_km = input.odometer_km;
              vehicle.updated_at = new Date().toISOString();
            }

            targetTask.last_service_date = input.service_date;
            targetTask.last_service_odometer_km = input.odometer_km;
            targetTask.updated_at = new Date().toISOString();

            const vehicleTasks = tasksByVehicle.get(vehicle.id) ?? [];
            for (const task of vehicleTasks) {
              if (task.id === input.task_id) {
                Object.assign(task, evaluateMockTask(targetTask, vehicle));
              } else if (odometerUpdated) {
                Object.assign(task, evaluateMockTask(task, vehicle));
              }
            }

            const now = new Date().toISOString();
            const log = {
              id: nextLogId++,
              vehicle_id: vehicle.id,
              task_id: input.task_id,
              task_type_key: targetTask.task_type_key,
              custom_service_name: null,
              service_date: input.service_date,
              odometer_km: input.odometer_km,
              notes: input.notes ?? null,
              created_at: now,
            };
            serviceLogs.push(log);

            persistMockState();
            return Promise.resolve({
              log: {
                id: log.id,
                vehicle_id: log.vehicle_id,
                task_id: log.task_id,
                custom_service_name: log.custom_service_name,
                service_date: log.service_date,
                odometer_km: log.odometer_km,
                notes: log.notes,
                created_at: log.created_at,
              },
              task: targetTask,
              odometer_updated: odometerUpdated,
              previous_odometer_km: odometerUpdated ? previousOdometer : undefined,
              new_odometer_km: odometerUpdated ? input.odometer_km : undefined,
            });
          }

          case "log_custom_service": {
            const input = args.input as {
              vehicle_id: number;
              custom_service_name: string;
              service_date: string;
              odometer_km: number;
              notes?: string | null;
            };

            const serviceName = input.custom_service_name?.trim();
            if (!serviceName) {
              return Promise.reject({
                type: "validation",
                message: "Service name is required",
                field: "custom_service_name",
              });
            }

            if (input.odometer_km < 0) {
              return Promise.reject({
                type: "validation",
                message: "Odometer must be zero or greater",
                field: "odometer_km",
              });
            }

            const vehicle = vehicles.find((v) => v.id === input.vehicle_id);
            if (!vehicle) {
              return Promise.reject({
                type: "not_found",
                message: "Vehicle not found",
              });
            }

            const previousOdometer = vehicle.odometer_km;
            const odometerUpdated = input.odometer_km > vehicle.odometer_km;

            if (odometerUpdated) {
              vehicle.odometer_km = input.odometer_km;
              vehicle.updated_at = new Date().toISOString();

              const vehicleTasks = tasksByVehicle.get(vehicle.id) ?? [];
              for (const task of vehicleTasks) {
                Object.assign(task, evaluateMockTask(task, vehicle));
              }
            }

            const now = new Date().toISOString();
            const log = {
              id: nextLogId++,
              vehicle_id: vehicle.id,
              task_id: null,
              task_type_key: null,
              custom_service_name: serviceName,
              service_date: input.service_date,
              odometer_km: input.odometer_km,
              notes: input.notes ?? null,
              created_at: now,
            };
            serviceLogs.push(log);

            persistMockState();
            return Promise.resolve({
              log: {
                id: log.id,
                vehicle_id: log.vehicle_id,
                task_id: log.task_id,
                custom_service_name: log.custom_service_name,
                service_date: log.service_date,
                odometer_km: log.odometer_km,
                notes: log.notes,
                created_at: log.created_at,
              },
              odometer_updated: odometerUpdated,
              previous_odometer_km: odometerUpdated ? previousOdometer : undefined,
              new_odometer_km: odometerUpdated ? input.odometer_km : undefined,
            });
          }

          case "get_service_history": {
            const vehicleId = args.vehicle_id as number;
            const vehicle = vehicles.find((v) => v.id === vehicleId);
            if (!vehicle) {
              return Promise.reject({
                type: "not_found",
                message: "Vehicle not found",
              });
            }

            const entries = serviceLogs
              .filter((log) => log.vehicle_id === vehicleId)
              .sort((a, b) => {
                const dateCompare = b.service_date.localeCompare(a.service_date);
                if (dateCompare !== 0) return dateCompare;
                return b.created_at.localeCompare(a.created_at);
              });

            return Promise.resolve(entries);
          }

          case "update_vehicle": {
            const id = args.id as number;
            const vehicle = vehicles.find((v) => v.id === id);

            if (!vehicle) {
              return Promise.reject({
                type: "not_found",
                message: "Vehicle not found",
              });
            }

            vehicle.make = (args.make as string | null) ?? null;
            vehicle.model = (args.model as string | null) ?? null;
            vehicle.year = (args.year as number | null) ?? null;
            vehicle.nickname = deriveVehicleNickname(
              vehicle.make,
              vehicle.model,
              vehicle.year
            );
            vehicle.updated_at = new Date().toISOString();

            persistMockState();
            return Promise.resolve({ ...vehicle });
          }

          case "delete_vehicle": {
            const id = args.id as number;
            const index = vehicles.findIndex((v) => v.id === id);
            if (index === -1) {
              return Promise.reject({
                type: "not_found",
                message: "Vehicle not found",
              });
            }

            vehicles.splice(index, 1);
            tasksByVehicle.delete(id);

            for (let i = serviceLogs.length - 1; i >= 0; i--) {
              if (serviceLogs[i].vehicle_id === id) {
                serviceLogs.splice(i, 1);
              }
            }

            persistMockState();
            return Promise.resolve(undefined);
          }

          case "get_db_status":
            return Promise.resolve({
              db_path: "mock.db",
              wal_mode: true,
              schema_version: 7,
              migrations_applied: 7,
            });

          case "check_onboarding_status":
            return Promise.resolve({ needs_onboarding: false });

          case "get_budget_summary":
            return Promise.resolve({
              total_target_cents: 0,
              total_spent_cents: 0,
              remaining_cents: 0,
              month: "2026-03",
            });

          case "get_top_budget_categories":
            return Promise.resolve([]);

          case "get_current_net_worth":
            return Promise.resolve({
              total_cents: 0,
              cash_cents: 0,
              investments_cents: 0,
              assets_cents: 0,
            });

          case "get_recent_net_worth_snapshots":
            return Promise.resolve([]);

          case "get_spending_breakdown":
            return Promise.resolve([]);

          case "get_yearly_summary":
            return Promise.resolve(yearlyMock);

          case "get_income_total":
            return Promise.resolve({ total_cents: 0 });

          case "get_maintenance_alert_summary":
            return Promise.resolve(buildMaintenanceAlertSummary());

          case "get_vehicle_catalog_status":
            return Promise.resolve({
              available: catalogAvailable,
              cached_at: catalogAvailable ? "2026-01-01T00:00:00Z" : undefined,
              stale: catalogStale,
            });

          case "get_vehicle_makes":
            if (!catalogAvailable) {
              return Promise.resolve([]);
            }
            return Promise.resolve([{ name: "Honda" }, { name: "Toyota" }]);

          case "get_vehicle_models": {
            if (!catalogAvailable) {
              return Promise.resolve([]);
            }
            const make = (args.make as string)?.trim();
            const year = args.year as number;
            if (make === "Honda" && year === 2020) {
              return Promise.resolve([
                { name: "Civic" },
                { name: "Accord" },
              ]);
            }
            if (make === "Toyota" && year === 2020) {
              return Promise.resolve([{ name: "Camry" }]);
            }
            return Promise.resolve([]);
          }

          default:
            return Promise.reject(`Unknown command: ${cmd}`);
        }
      },
      convertFileSrc: (path: string) => path,
    };
  }, {
    seedVehicles: options?.seedVehicles ?? null,
    yearlyMock: yearlySummaryMock,
    catalog: options?.catalog ?? { available: false },
  });
}

async function gotoCarWithFreshMock(
  page: Page,
  options?: Parameters<typeof setupMaintenanceTauriMock>[1]
) {
  await setupMaintenanceTauriMock(page, options);
  await page.goto("/car");
  await page.evaluate(() =>
    sessionStorage.removeItem("__nixus_maintenance_mock_state__")
  );
  await page.reload();
}

const setupTauriMock = setupMaintenanceTauriMock;

async function prepareCarPage(
  page: Page,
  options?: Parameters<typeof setupMaintenanceTauriMock>[1]
) {
  await gotoCarWithFreshMock(page, options);
}

function expectedVehicleLabel(options: {
  make?: string;
  model?: string;
  year?: string;
}): string {
  const parts: string[] = [];
  if (options.year?.trim()) parts.push(options.year.trim());
  if (options.make?.trim()) parts.push(options.make.trim());
  if (options.model?.trim()) parts.push(options.model.trim());
  return parts.length > 0 ? parts.join(" ") : "Vehicle";
}

async function createVehicle(
  page: Page,
  odometerKm: string,
  options: { make?: string; model?: string; year?: string } = {
    make: "Toyota",
    model: "Camry",
    year: "2020",
  }
) {
  const label = expectedVehicleLabel(options);
  await page.getByTestId("add-vehicle-button").click();
  const form = page.getByTestId("add-vehicle-form");
  await expect(form.getByTestId("vehicle-catalog-loading")).toBeHidden({
    timeout: 10000,
  });

  if (options.year) await form.getByLabel("Year").fill(options.year);
  if (options.make) {
    const catalogMake = form.getByTestId("vehicle-catalog-make");
    if (await catalogMake.isVisible()) {
      await catalogMake.click();
      await page.getByRole("button", { name: options.make, exact: true }).click();
    } else {
      await form.getByLabel("Make").fill(options.make);
    }
  }
  if (options.model) {
    const catalogModel = form.getByTestId("vehicle-catalog-model");
    if (await catalogModel.isVisible()) {
      await catalogModel.click();
      await page.getByRole("button", { name: options.model, exact: true }).click();
    } else {
      await form.getByLabel("Model").fill(options.model);
    }
  }
  await form.getByLabel("Odometer (km)").fill(odometerKm);
  await form.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("vehicle-slide-over")).not.toBeVisible();
  await expect(page.getByText("is now tracked").first()).toBeVisible();
  return label;
}

async function openVehicleDetail(
  page: Page,
  vehicleId = 1,
  options?: { showAllTasks?: boolean }
) {
  const viewCar = page.getByTestId(`view-car-button-${vehicleId}`);
  if ((await viewCar.count()) > 0 && (await viewCar.first().isVisible())) {
    await viewCar.first().click();
    await expect(page).toHaveURL(new RegExp(`/car/garage.*vehicle=${vehicleId}`));
  } else {
    await page.goto(`/car/garage?vehicle=${vehicleId}`);
  }
  await expect(page.getByTestId("vehicle-detail-panel")).toBeVisible({
    timeout: 10000,
  });
  await expect(
    page.getByTestId(`garage-vehicle-row-${vehicleId}`)
  ).toHaveAttribute("data-selected", "true");
  if (options?.showAllTasks !== false) {
    await showAllMaintenanceTasks(page);
  }
}

function vehicleDetail(page: Page) {
  return page.getByTestId("vehicle-detail-panel");
}

async function showAllMaintenanceTasks(page: Page) {
  const detail = vehicleDetail(page);
  await detail.getByTestId("detail-tab-all-tasks").click();
  await expect(detail.getByTestId("maintenance-task-row").first()).toBeVisible({
    timeout: 10000,
  });
}

async function openLogServiceForm(page: Page) {
  await openVehicleDetail(page, 1);
  const detail = vehicleDetail(page);
  const oilRow = detail
    .getByTestId("maintenance-task-row")
    .filter({ hasText: "Engine oil & filter" })
    .first();
  await oilRow.getByTestId("log-service-button").click();
  const form = detail.getByTestId("log-service-form");
  await expect(form).toBeVisible();
  return form;
}

async function fillLogServiceOdometer(form: Locator, value: string) {
  const input = form.getByTestId("log-service-odometer");
  await input.click();
  await input.press("ControlOrMeta+a");
  await input.pressSequentially(value);
  await input.blur();
}

async function submitLogServiceForm(form: Locator) {
  await form.getByTestId("log-service-save").click();
}

async function saveEditIntervalDialog(dialog: Locator) {
  await dialog.getByTestId("edit-interval-save").click({ force: true });
}

async function goToGarage(page: Page) {
  await page
    .locator('nav[aria-label="Car navigation"]')
    .getByRole("link", { name: "Garage" })
    .click();
  await expect(page).toHaveURL(/\/car\/garage/);
}

test.describe("Maintenance Page", () => {
  test.beforeEach(async ({ page }) => {
    await prepareCarPage(page);
  });

  test("displays page header with Add Vehicle button", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Dashboard" })
    ).toBeVisible();
    await expect(page.getByTestId("add-vehicle-button")).toBeVisible();
    await expect(page.getByTestId("add-vehicle-button")).toContainText(
      "Add Vehicle"
    );
  });

  test("shows onboarding hero when no vehicles exist", async ({ page }) => {
    const emptyState = page.getByTestId("maintenance-empty-state");
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText("Let's set up your garage");
    await expect(emptyState).toContainText(
      "Track maintenance so you never miss a service again."
    );
  });

  test("empty state button opens add vehicle form", async ({ page }) => {
    const emptyState = page.getByTestId("maintenance-empty-state");
    await emptyState.getByTestId("car-onboarding-hero-cta").click();
    await expect(page.getByTestId("add-vehicle-form")).toBeVisible();
  });

  test("form validates required fields on submit", async ({ page }) => {
    await page.getByTestId("add-vehicle-button").click();
    const form = page.getByTestId("add-vehicle-form");
    await form.getByRole("button", { name: "Save" }).click();
    await expect(form.getByText("Odometer is required")).toBeVisible();
  });

  test("adding a vehicle starts schedules from current odometer and shows success toast", async ({
    page,
  }) => {
    await page.getByTestId("add-vehicle-button").click();
    const form = page.getByTestId("add-vehicle-form");
    await form.getByLabel("Make").fill("Toyota");
    await form.getByLabel("Model").fill("Camry");
    await form.getByLabel("Year").fill("2020");
    await form.getByLabel("Odometer (km)").fill("85000");
    await form.getByRole("button", { name: "Save" }).click();

    await expect(page.getByTestId("vehicle-slide-over")).not.toBeVisible();
    await expect(
      page.getByText("2020 Toyota Camry is now tracked", { exact: false })
    ).toBeVisible();
    await expect(page.getByTestId("car-dashboard-all-clear")).toBeVisible();
    await expect(page.getByText("1 vehicles tracked")).toBeVisible();
  });

  test("add vehicle form shows maintenance template section", async ({ page }) => {
    await page.getByTestId("add-vehicle-button").click();
    const form = page.getByTestId("add-vehicle-form");
    await expect(form.getByTestId("maintenance-template-section")).toBeVisible();
    await expect(form.getByTestId("maintenance-template-mode-default")).toBeVisible();
    await expect(form.getByText("Recommended")).toBeVisible();
    await expect(form.getByText("Build your own")).toBeVisible();
  });

  test("build your own template creates empty schedule", async ({ page }) => {
    await page.getByTestId("add-vehicle-button").click();
    const form = page.getByTestId("add-vehicle-form");
    await form.getByLabel("Make").fill("Toyota");
    await form.getByLabel("Model").fill("Camry");
    await form.getByLabel("Year").fill("2020");
    await form.getByLabel("Odometer (km)").fill("85000");
    await form.getByTestId("maintenance-template-mode-custom").click();
    await form.getByRole("button", { name: "Save" }).click();

    await expect(page.getByTestId("vehicle-slide-over")).not.toBeVisible();
    await goToGarage(page);
    await openVehicleDetail(page, 1, { showAllTasks: false });
    await page.getByTestId("detail-tab-all-tasks").click();

    const detail = vehicleDetail(page);
    await expect(detail.getByTestId("add-schedule-task-button")).toBeVisible();
    await expect(detail.getByText("No scheduled services yet.")).toBeVisible();
    await expect(detail.getByTestId("maintenance-task-row")).toHaveCount(0);
  });

  test("can add ongoing services from schedule tab", async ({ page }) => {
    await page.getByTestId("add-vehicle-button").click();
    const form = page.getByTestId("add-vehicle-form");
    await form.getByLabel("Make").fill("Toyota");
    await form.getByLabel("Model").fill("Camry");
    await form.getByLabel("Year").fill("2020");
    await form.getByLabel("Odometer (km)").fill("85000");
    await form.getByTestId("maintenance-template-mode-custom").click();
    await form.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("vehicle-slide-over")).not.toBeVisible();

    await goToGarage(page);
    await openVehicleDetail(page, 1, { showAllTasks: false });
    await page.getByTestId("detail-tab-all-tasks").click();

    const detail = vehicleDetail(page);
    await detail.getByTestId("add-schedule-task-button").click();
    const dialog = page.getByTestId("add-schedule-task-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("schedule-task-type-select").click();
    await page.getByRole("option", { name: "Engine oil & filter" }).click();
    await dialog.getByTestId("add-schedule-task-save").click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText("Service added to schedule.")).toBeVisible();
    await expect(detail.getByText("Engine oil & filter")).toBeVisible();
    await expect(detail.getByTestId("maintenance-task-row")).toHaveCount(1);

    await detail.getByTestId("add-schedule-task-button").click();
    await expect(page.getByTestId("add-schedule-task-dialog")).toBeVisible();
    await page.getByTestId("schedule-task-type-select").click();
    await page.getByRole("option", { name: "Brake fluid" }).click();
    await page.getByTestId("add-schedule-task-save").click();
    await expect(detail.getByTestId("maintenance-task-row")).toHaveCount(2);
  });

  test("can add custom ongoing service with name and intervals", async ({
    page,
  }) => {
    await page.getByTestId("add-vehicle-button").click();
    const form = page.getByTestId("add-vehicle-form");
    await form.getByLabel("Odometer (km)").fill("85000");
    await form.getByTestId("maintenance-template-mode-custom").click();
    await form.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("vehicle-slide-over")).not.toBeVisible();

    await goToGarage(page);
    await openVehicleDetail(page, 1, { showAllTasks: false });
    await page.getByTestId("detail-tab-all-tasks").click();

    const detail = vehicleDetail(page);
    await detail.getByTestId("add-schedule-task-button").click();
    await page.getByTestId("schedule-task-mode-custom").click();
    await page.getByTestId("schedule-custom-name-input").fill("Timing belt");
    await page.getByTestId("schedule-custom-km-input").fill("120000");
    await page.getByTestId("schedule-custom-months-input").fill("96");
    await page.getByTestId("add-schedule-task-save-custom").click();

    await expect(page.getByText("Service added to schedule.")).toBeVisible();
    await expect(detail.getByText("Timing belt")).toBeVisible();
    await expect(detail.getByTestId("maintenance-task-row")).toHaveCount(1);
  });

  test("multiple vehicles appear in garage list", async ({ page }) => {
    await createVehicle(page, "10000", {
      make: "Toyota",
      model: "One",
      year: "2010",
    });
    await createVehicle(page, "20000", {
      make: "Honda",
      model: "Two",
      year: "2011",
    });

    await goToGarage(page);
    const rows = page.getByTestId(/^garage-vehicle-row-/);
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId("garage-vehicle-row-2")).toContainText("2011 Honda Two");
    await expect(page.getByTestId("garage-vehicle-row-1")).toContainText("2010 Toyota One");
    await expect(page.getByText("2 vehicles tracked")).toBeVisible();
  });

  test("vehicle detail panel shows task rows from inbox View car", async ({
    page,
  }) => {
    await createVehicle(page, "10000");
    await openVehicleDetail(page, 1);
    await showAllMaintenanceTasks(page);

    const detail = vehicleDetail(page);
    const taskRows = detail.getByTestId("maintenance-task-row");
    await expect(taskRows.first()).toBeVisible();
    await expect(taskRows).not.toHaveCount(0);
  });

  test("task rows show status badges and monospace next-due line", async ({
    page,
  }) => {
    await createVehicle(page, "10000");
    await openVehicleDetail(page, 1);
    await showAllMaintenanceTasks(page);

    const detail = vehicleDetail(page);
    const firstRow = detail.getByTestId("maintenance-task-row").first();
    await expect(firstRow).toBeVisible();

    const statusBadges = detail.locator("[data-testid^='maintenance-task-status-']");
    await expect(statusBadges.first()).toBeVisible();
    await expect(
      statusBadges.filter({ hasText: "On track" }).or(
        statusBadges.filter({ hasText: "Upcoming" })
      ).first()
    ).toBeVisible();

    const monoLine = firstRow.locator(".font-mono");
    await expect(monoLine).toBeVisible();
    await expect(monoLine).toContainText(/Not yet serviced|km remaining|Due in/);
  });

  test("task rows do not show raw task type keys", async ({ page }) => {
    await createVehicle(page, "10000");
    await openVehicleDetail(page, 1);
    await showAllMaintenanceTasks(page);

    const detail = vehicleDetail(page);
    await expect(detail.getByText("engine_oil_filter")).toHaveCount(0);
    await expect(detail.getByText("Engine oil & filter")).toBeVisible();
  });

  test("dashboard urgent rows show vehicle, task, and garage link", async ({
    page,
  }) => {
    await prepareCarPage(page, {
      seedVehicles: [
        { make: "Toyota", model: "One", year: 2010, odometer_km: 10000 },
        { make: "Honda", model: "Two", year: 2011, odometer_km: 20000 },
      ],
    });
    await expect(page.getByTestId("car-dashboard-urgent-list")).toBeVisible();
    await expect(page.getByTestId(/^car-dashboard-urgent-row-/)).not.toHaveCount(
      0
    );
    await expect(page.getByTestId("car-dashboard-view-car-1").first()).toBeVisible();
  });
});

test.describe("Maintenance Interval Editing", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await prepareCarPage(page);
    await createVehicle(page, "10000");
  });

  async function openOilChangeIntervalDialog(page: Page) {
    await openVehicleDetail(page, 1);
    await showAllMaintenanceTasks(page);
    const detail = vehicleDetail(page);
    const oilRow = detail
      .getByTestId("maintenance-task-row")
      .filter({ hasText: "Engine oil & filter" });
    await oilRow.getByTestId("edit-interval-button").click({ force: true });
    await expect(page.getByTestId("edit-interval-dialog")).toBeVisible();
    return page.getByTestId("edit-interval-dialog");
  }

  test("opens edit interval dialog with baseline hint and current values", async ({
    page,
  }) => {
    const dialog = await openOilChangeIntervalDialog(page);

    await expect(dialog).toContainText("Industry baseline: 8,000 km / 6 mo");
    await expect(dialog.getByLabel("Interval (km)")).toHaveValue("8000");
    await expect(dialog.getByLabel("Interval (months)")).toHaveValue("6");
  });

  test("saving new intervals shows toast and updates task row countdown", async ({
    page,
  }) => {
    const dialog = await openOilChangeIntervalDialog(page);

    await dialog.getByLabel("Interval (km)").fill("100000");
    await dialog.getByLabel("Interval (months)").fill("0");
    await saveEditIntervalDialog(dialog);

    await expect(page.getByTestId("edit-interval-dialog")).not.toBeVisible();
    await expect(
      page.getByText("Maintenance interval updated.")
    ).toBeVisible();

    await showAllMaintenanceTasks(page);
    const detail = vehicleDetail(page);
    const oilRow = detail
      .getByTestId("maintenance-task-row")
      .filter({ hasText: "Engine oil & filter" });
    await expect(oilRow.locator(".font-mono")).toContainText("100000 km remaining");
  });

  test("both-zero intervals show inline error and do not save", async ({
    page,
  }) => {
    const dialog = await openOilChangeIntervalDialog(page);

    await dialog.getByLabel("Interval (km)").fill("0");
    await dialog.getByLabel("Interval (months)").fill("0");
    await saveEditIntervalDialog(dialog);

    await expect(
      dialog.getByText("At least one interval must be greater than zero")
    ).toHaveCount(2);
    await expect(page.getByTestId("edit-interval-dialog")).toBeVisible();
    await expect(
      page.getByText("Maintenance interval updated.")
    ).not.toBeVisible();
  });

  test("customizing task on vehicle A does not change vehicle B same task type", async ({
    page,
  }) => {
    await createVehicle(page, "20000", {
      make: "Honda",
      model: "Civic",
      year: "2018",
    });

    await openVehicleDetail(page, 2);
    await showAllMaintenanceTasks(page);
    const detailB = vehicleDetail(page);
    const oilRowB = detailB
      .getByTestId("maintenance-task-row")
      .filter({ hasText: "Engine oil & filter" });
    const baselineText = await oilRowB.locator(".font-mono").textContent();
    await page.getByTestId("garage-vehicle-row-1").click();

    await showAllMaintenanceTasks(page);
    const detailA = vehicleDetail(page);
    const oilRowA = detailA
      .getByTestId("maintenance-task-row")
      .filter({ hasText: "Engine oil & filter" });
    await oilRowA.getByTestId("edit-interval-button").click({ force: true });

    const dialog = page.getByTestId("edit-interval-dialog");
    await dialog.getByLabel("Interval (km)").fill("120000");
    await dialog.getByLabel("Interval (months)").fill("0");
    await saveEditIntervalDialog(dialog);
    await expect(
      page.getByText("Maintenance interval updated.")
    ).toBeVisible();

    await page.getByTestId("garage-vehicle-row-2").click();
    await showAllMaintenanceTasks(page);
    const detailBAfter = vehicleDetail(page);
    const oilRowBAfter = detailBAfter
      .getByTestId("maintenance-task-row")
      .filter({ hasText: "Engine oil & filter" });
    await expect(oilRowBAfter.locator(".font-mono")).toHaveText(baselineText ?? "");
  });
});

test.describe("Manual Odometer Updates", () => {
  test.beforeEach(async ({ page }) => {
    await prepareCarPage(page);
    await createVehicle(page, "85000");
  });

  test("clicking odometer shows inline input", async ({ page }) => {
    await goToGarage(page);
    const row = page.getByTestId("garage-vehicle-row-1");
    await row.getByTestId("odometer-display-1").click();
    await expect(row.getByTestId("odometer-input-1")).toBeVisible();
  });

  test("entering valid km updates display and shows success toast", async ({
    page,
  }) => {
    await goToGarage(page);
    const row = page.getByTestId("garage-vehicle-row-1");
    await row.getByTestId("odometer-display-1").click();

    const input = row.getByTestId("odometer-input-1");
    await input.clear();
    await input.fill("52300");
    await input.press("Enter");

    await expect(row.getByTestId("odometer-display-1")).toContainText("52,300 km");
    await expect(page.getByText("Odometer updated")).toBeVisible();
    await expect(row.getByTestId("odometer-input-1")).not.toBeVisible();
  });

  test("escape cancels edit without saving", async ({ page }) => {
    await goToGarage(page);
    const row = page.getByTestId("garage-vehicle-row-1");
    await row.getByTestId("odometer-display-1").click();

    const input = row.getByTestId("odometer-input-1");
    await input.fill("99999");
    await input.press("Escape");

    await expect(row.getByTestId("odometer-display-1")).toContainText("85,000 km");
    await expect(page.getByText("Odometer updated")).not.toBeVisible();
  });

  test("negative value shows inline error without toast", async ({ page }) => {
    await goToGarage(page);
    const row = page.getByTestId("garage-vehicle-row-1");
    await row.getByTestId("odometer-display-1").click();

    const input = row.getByTestId("odometer-input-1");
    await input.fill("-100");
    await input.press("Enter");

    await expect(row.getByTestId("odometer-error-1")).toBeVisible();
    await expect(row.getByTestId("odometer-error-1")).toContainText(
      "Enter a whole number of kilometers"
    );
    await expect(page.getByText("Odometer updated")).not.toBeVisible();
    await expect(row.getByTestId("odometer-input-1")).toBeVisible();
  });
});

test.describe("Service Logging", () => {
  test.beforeEach(async ({ page }) => {
    await prepareCarPage(page);
    await createVehicle(page, "10000");
  });

  test("clicking Log service expands inline form with defaults", async ({ page }) => {
    const form = await openLogServiceForm(page);

    const todayLabel = new Date().toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    await expect(form.getByTestId("log-service-date")).toContainText(todayLabel);
    await expect(form.getByTestId("log-service-odometer")).toHaveValue("10000");
  });

  test("saving valid service shows success toast and collapses form", async ({
    page,
  }) => {
    const form = await openLogServiceForm(page);
    await submitLogServiceForm(form);

    await expect(page.getByText("Service logged")).toBeVisible();
    await expect(form).not.toBeVisible();
  });

  test("logging service with higher odometer shows info toast and updates display", async ({
    page,
  }) => {
    await goToGarage(page);
    const row = page.getByTestId("garage-vehicle-row-1");
    const form = await openLogServiceForm(page);

    await fillLogServiceOdometer(form, "15000");
    await submitLogServiceForm(form);

    await expect(page.getByText("Service logged")).toBeVisible();
    await expect(
      page.getByText("Odometer updated to 15,000 km based on service log")
    ).toBeVisible();
    await expect(row.getByTestId("odometer-display-1")).toContainText("15,000 km");
  });

  test("cancel collapses form without toast", async ({ page }) => {
    const form = await openLogServiceForm(page);
    await form.getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByTestId("log-service-form")).not.toBeVisible();
    await expect(page.getByText("Service logged", { exact: true })).not.toBeVisible();
  });

  test("escape collapses form without toast", async ({ page }) => {
    await openLogServiceForm(page);
    await page.keyboard.press("Escape");

    await expect(page.getByTestId("log-service-form")).not.toBeVisible();
    await expect(page.getByText("Service logged", { exact: true })).not.toBeVisible();
  });

  test("invalid odometer shows inline error on submit", async ({ page }) => {
    const form = await openLogServiceForm(page);
    await fillLogServiceOdometer(form, "12.5");
    await submitLogServiceForm(form);

    await expect(
      form.getByText("Enter a valid odometer reading (0 or greater)")
    ).toBeVisible();
    await expect(page.getByText("Service logged", { exact: true })).not.toBeVisible();
  });
});

test.describe("Service History", () => {
  test.beforeEach(async ({ page }) => {
    await prepareCarPage(page);
    await createVehicle(page, "10000");
  });

  test("vehicle with no logs shows empty history message", async ({ page }) => {
    await openVehicleDetail(page, 1);
    const detail = vehicleDetail(page);
    await detail.getByTestId("detail-tab-history").click();
    await expect(detail.getByTestId("service-history-table")).toContainText(
      "No service logged yet."
    );
  });

  test("logged service appears in history with date, task, and odometer", async ({
    page,
  }) => {
    const form = await openLogServiceForm(page);
    await fillLogServiceOdometer(form, "16000");
    await submitLogServiceForm(form);
    await expect(page.getByText("Service logged")).toBeVisible();

    const detail = vehicleDetail(page);
    await detail.getByTestId("detail-tab-history").click();
    const historyTable = detail.getByTestId("service-history-table");
    await expect(historyTable).toBeVisible();
    await expect(historyTable).not.toContainText("No service logged yet.");

    const historyRow = detail.locator("[data-testid^='service-history-row-']").first();
    await expect(historyRow).toBeVisible();
    await expect(historyRow).toContainText("Engine oil & filter");
    await expect(historyRow).toContainText("16,000 km");
    await expect(historyRow.locator("td").first()).toHaveText(/\w{3} \d{1,2}/);
  });

  test("custom service log appears in history without updating managed tasks", async ({
    page,
  }) => {
    await openVehicleDetail(page, 1);
    const detail = vehicleDetail(page);

    await detail.getByTestId("log-custom-service-button").click();
    const form = page.getByTestId("log-custom-service-form");
    await expect(form).toBeVisible();

    await form.getByTestId("custom-service-name").fill("AC recharge");
    await form.getByTestId("custom-service-odometer").fill("86000");
    await form.getByTestId("custom-service-save").click();

    await expect(page.getByText("Service logged.")).toBeVisible();
    await expect(form).not.toBeVisible();

    await detail.getByTestId("detail-tab-history").click();
    const historyRow = detail.locator("[data-testid^='service-history-row-']").first();
    await expect(historyRow).toContainText("AC recharge");
    await expect(historyRow).toContainText("86,000 km");

    await detail.getByTestId("detail-tab-all-tasks").click();
    await showAllMaintenanceTasks(page);
    const oilRow = detail
      .getByTestId("maintenance-task-row")
      .filter({ hasText: "Engine oil & filter" });
    await expect(
      oilRow.locator("[data-testid='maintenance-task-status-ok']")
    ).toBeVisible();
    await expect(oilRow.locator(".font-mono")).toContainText("Not yet serviced");
  });
});

test.describe("Vehicle Edit and Delete", () => {
  test.beforeEach(async ({ page }) => {
    await prepareCarPage(page);
    await createVehicle(page, "10000");
  });

  test("delete vehicle shows confirmation dialog and removes vehicle", async ({
    page,
  }) => {
    await openVehicleDetail(page, 1);
    const detail = vehicleDetail(page);
    await detail.getByTestId("delete-vehicle-button").click();

    const dialog = page.getByTestId("delete-vehicle-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Delete 2020 Toyota Camry");

    await page.getByTestId("confirm-delete-vehicle-button").click();

    await expect(page.getByText("Vehicle deleted.")).toBeVisible();
    await expect(page.getByTestId("vehicle-detail-panel")).not.toBeVisible();
    await expect(page.getByTestId("maintenance-empty-state")).toBeVisible();
  });

  test("edit vehicle opens form and updates display label", async ({ page }) => {
    await goToGarage(page);
    await expect(page.getByTestId("vehicle-detail-panel")).toBeVisible();
    const detail = vehicleDetail(page);
    await detail.getByTestId("edit-vehicle-button").click();

    const form = page.getByTestId("edit-vehicle-form");
    await expect(form).toBeVisible();
    await expect(form.getByTestId("vehicle-catalog-loading")).toBeHidden({
      timeout: 10000,
    });
    if (await form.getByTestId("vehicle-catalog-mode-catalog").isVisible()) {
      await form.getByTestId("vehicle-catalog-manual-toggle").click();
    }
    await form.locator("#edit-vehicle-make").fill("Honda");
    await form.locator("#edit-vehicle-model").fill("Accord");
    await form.locator("#edit-vehicle-year").fill("2014");
    await form.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Vehicle updated.")).toBeVisible();
    await expect(page.getByTestId("edit-vehicle-slide-over")).not.toBeVisible();
    await expect(page.getByTestId("vehicle-detail-panel")).toBeVisible();
    await expect(page.getByTestId("garage-vehicle-row-1")).toContainText("2014 Honda Accord");
  });
});

test.describe("Car Module Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
  });

  test("Car module appears in sidebar between Finance and AI", async ({
    page,
  }) => {
    await page.goto("/");

    const nav = page.locator('nav[aria-label="Module navigation"]');
    const labels = await nav.locator("a").allTextContents();

    const financeIndex = labels.findIndex((l) => l.includes("Finance"));
    const carIndex = labels.findIndex((l) => l.includes("Car"));
    const aiIndex = labels.findIndex((l) => l.includes("AI"));

    expect(financeIndex).toBeGreaterThan(-1);
    expect(carIndex).toBeGreaterThan(financeIndex);
    expect(aiIndex).toBeGreaterThan(carIndex);
  });

  test("clicking Car in sidebar navigates to maintenance page", async ({
    page,
  }) => {
    await page.goto("/");

    const nav = page.locator('nav[aria-label="Module navigation"]');
    await nav.getByRole("link", { name: "Car" }).click();

    await expect(page).toHaveURL("/car");
    await expect(page.locator("h1")).toHaveText("Maintenance");
  });

  test("InnerTabNav shows Car tabs on /car routes", async ({ page }) => {
    await page.goto("/car");

    const nav = page.locator('nav[aria-label="Car navigation"]');
    await expect(nav.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Garage" })).toBeVisible();
  });

  test("Garage tab navigates to garage page", async ({ page }) => {
    await page.goto("/car");
    await goToGarage(page);
    await expect(page.getByTestId("garage-vehicle-list").or(page.locator("h1"))).toBeVisible();
  });

  test("InnerTabNav shows Finance tabs on Finance routes", async ({
    page,
  }) => {
    await page.goto("/");

    const nav = page.locator('nav[aria-label="Finance navigation"]');
    await expect(nav.getByText("Dashboard")).toBeVisible();
    await expect(nav.getByText("Maintenance")).not.toBeVisible();
  });
});

test.describe("Maintenance End-to-End Flow", () => {
  test("registers vehicle, shows car inbox alerts, and clears alert after service log", async ({
    page,
  }) => {
    await setupMaintenanceTauriMock(page);
    await page.goto("/car");
    await page.evaluate(() =>
      sessionStorage.removeItem("__nixus_maintenance_mock_state__")
    );
    await page.reload();

    await expect(page.getByTestId("maintenance-empty-state")).toBeVisible();
    await createVehicle(page, "10000");

    const form = await openLogServiceForm(page);
    await submitLogServiceForm(form);
    await expect(page.getByText("Service logged")).toBeVisible();

    await goToGarage(page);
    const row = page.getByTestId("garage-vehicle-row-1");
    await row.getByTestId("odometer-display-1").click();
    const odometerInput = row.getByTestId("odometer-input-1");
    await odometerInput.clear();
    await odometerInput.fill("17600");
    await odometerInput.press("Enter");
    await expect(page.getByText("Odometer updated")).toBeVisible();

    await page
      .locator('nav[aria-label="Module navigation"]')
      .getByRole("link", { name: "Car" })
      .click();
    await expect(page.getByTestId("car-dashboard-urgent-list")).toBeVisible();

    const oilDashboardRow = page
      .getByTestId(/^car-dashboard-urgent-row-/)
      .filter({ hasText: "Engine oil & filter" });
    await expect(
      oilDashboardRow.locator("[data-testid^='maintenance-task-status-']").filter({
        hasText: /Upcoming|Due|Overdue/,
      })
    ).toBeVisible();

    await goToGarage(page);
    await openVehicleDetail(page, 1);
    const detail = vehicleDetail(page);
    const oilRow = detail
      .getByTestId("maintenance-task-row")
      .filter({ hasText: "Engine oil & filter" })
      .first();
    await oilRow.getByTestId("log-service-button").click();
    const logForm = detail.getByTestId("log-service-form");
    await expect(logForm).toBeVisible();
    await logForm.getByTestId("log-service-save").click();
    await expect(page.getByText("Service logged").last()).toBeVisible();

    await page
      .locator('nav[aria-label="Car navigation"]')
      .getByRole("link", { name: "Dashboard" })
      .click();
    await expect(oilDashboardRow).not.toBeVisible();

    await page.reload();
    await expect(
      page
        .getByTestId("car-dashboard-urgent-list")
        .or(page.getByTestId("car-dashboard-all-clear"))
    ).toBeVisible();
    await expect(page.getByTestId("car-dashboard-all-clear")).toBeVisible();
  });
});

test.describe("Vehicle catalog", () => {
  test("saves vehicle from catalog combobox selection", async ({ page }) => {
    await gotoCarWithFreshMock(page, {
      catalog: { available: true, stale: false },
    });

    await page.getByTestId("add-vehicle-button").click();
    const form = page.getByTestId("add-vehicle-form");
    await expect(form.getByTestId("vehicle-catalog-mode-catalog")).toBeVisible({
      timeout: 10000,
    });

    await form.getByLabel("Year").fill("2020");
    await form.getByTestId("vehicle-catalog-make").click();
    await page.getByRole("button", { name: "Honda", exact: true }).click();
    await form.getByTestId("vehicle-catalog-model").click();
    await page.getByRole("button", { name: "Civic", exact: true }).click();
    await form.getByLabel("Odometer (km)").fill("45000");
    await form.getByRole("button", { name: "Save" }).click();

    await expect(page.getByTestId("vehicle-slide-over")).not.toBeVisible();
    await goToGarage(page);
    await expect(page.getByTestId("garage-vehicle-row-1")).toContainText(
      "2020 Honda Civic"
    );
  });

  test("uses free-text fields when catalog is unavailable", async ({ page }) => {
    await gotoCarWithFreshMock(page, { catalog: { available: false } });

    await page.getByTestId("add-vehicle-button").click();
    const form = page.getByTestId("add-vehicle-form");
    await expect(form.getByTestId("vehicle-catalog-mode-manual")).toBeVisible();

    await form.getByLabel("Make").fill("Subaru");
    await form.getByLabel("Model").fill("Outback");
    await form.getByLabel("Year").fill("2019");
    await form.getByLabel("Odometer (km)").fill("52000");
    await form.getByRole("button", { name: "Save" }).click();

    await goToGarage(page);
    await expect(page.getByTestId("garage-vehicle-row-1")).toContainText(
      "2019 Subaru Outback"
    );
  });

  test("manual toggle preserves custom make and model on save", async ({
    page,
  }) => {
    await gotoCarWithFreshMock(page, {
      catalog: { available: true, stale: false },
    });

    await page.getByTestId("add-vehicle-button").click();
    const form = page.getByTestId("add-vehicle-form");
    await form.getByLabel("Year").fill("2020");
    await form.getByTestId("vehicle-catalog-manual-toggle").click();
    await expect(form.getByTestId("vehicle-catalog-mode-manual")).toBeVisible();

    await form.getByLabel("Make").fill("CustomMake");
    await form.getByLabel("Model").fill("CustomModel");
    await form.getByLabel("Odometer (km)").fill("12000");
    await form.getByRole("button", { name: "Save" }).click();

    await goToGarage(page);
    await expect(page.getByTestId("garage-vehicle-row-1")).toContainText(
      "2020 CustomMake CustomModel"
    );
  });
});
