import { test, expect, type Page } from "@playwright/test";

interface MockSuggestion {
  project_id: number;
  project_name: string;
  suggested_cents: number;
  remaining_cents: number;
  target_cents: number;
  saved_cents: number;
  target_date: string | null;
  months_to_target: number | null;
  priority_rank: number;
  weight: number;
}

const TWO_PROJECT_SUGGESTION: MockSuggestion[] = [
  {
    project_id: 1,
    project_name: "Car down payment",
    suggested_cents: 30_000,
    remaining_cents: 500_000,
    target_cents: 500_000,
    saved_cents: 0,
    target_date: "2027-06-01",
    months_to_target: 12,
    priority_rank: 0,
    weight: 0.6,
  },
  {
    project_id: 2,
    project_name: "Kitchen renovation",
    suggested_cents: 20_000,
    remaining_cents: 120_000,
    target_cents: 120_000,
    saved_cents: 0,
    target_date: null,
    months_to_target: null,
    priority_rank: 1,
    weight: 0.4,
  },
];

/** What `get_cloud_ai_premium` answers, and how long it takes to answer. */
interface MockPremium {
  granted: boolean;
  delayMs?: number;
}

interface MockPace {
  project_id: number;
  required_monthly_cents: number | null;
  actual_monthly_cents: number | null;
  status: "good" | "caution" | "over" | "neutral";
}

interface MockSeedProject {
  id: number;
  name: string;
  target_cents: number;
  target_date: string | null;
}

/** Field-for-field what `get_project_image` returns, so the mock cannot drift from the IPC model. */
interface MockProjectImage {
  project_id: number;
  mime_type: "image/png" | "image/jpeg";
  original_filename: string;
  byte_size: number;
  uploaded_at: string;
  image_base64: string;
}

/**
 * Everything the project-image surface reads or writes, grouped into one trailing knob rather than
 * three more positional parameters on an already ten-argument helper.
 */
interface MockImageState {
  /** Images already stored, keyed one-to-one on `project_id` exactly as `project_images` is. */
  seed: MockProjectImage[];
  /** Project ids whose `get_project_image` rejects — the load-failed state, not "no picture". */
  readRejects: number[];
  /** What the native picker resolves. `null` is a dismissed dialog, which is the default. */
  pickedPath: string | null;
  /**
   * The `field` `validate_project_image` refuses with, or `null` to accept the picked file. Every
   * file-level refusal belongs here rather than on the write: the picker validates before anything
   * is stored, so a refusal on this path can never reach `set_project_image`.
   */
  validateRejectField: string | null;
  /**
   * The `field` `set_project_image` refuses with, or `null` to let the write land. Validation has
   * already passed by the time this fires, which is the only way to reach the
   * archived/missing-project guard (`project_id`) or to fail a replace with an image on screen.
   */
  writeRejectField: string | null;
  /**
   * The `field` `remove_project_image` refuses with, or `null` to let the deletion land. Its own
   * knob rather than a reuse of `writeRejectField`: removal is reached from the row menu while the
   * write is reached from the tile, so a shared switch could not fail one without arming the other.
   */
  removeRejectField: string | null;
}

const NO_IMAGES: MockImageState = {
  seed: [],
  readRejects: [],
  pickedPath: null,
  validateRejectField: null,
  writeRejectField: null,
  removeRejectField: null,
};

/**
 * A real 69-byte 1x1 RGB PNG. Genuinely decodable on purpose: a placeholder payload would make the
 * browser fire `onError` and every populated-state assertion would silently be testing the
 * unavailable fallback instead.
 */
const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mO45ucEAANkAWfD6YMNAAAAAElFTkSuQmCC";
const ONE_PIXEL_PNG_BYTES = 69;

/**
 * What a successful `set_project_image` stores: a real 73-byte 2x2 RGB PNG, deliberately a DIFFERENT
 * payload from the seeded one. Reusing the seeded bytes would make "the original image is still
 * showing byte-for-byte after a failed replace" pass even when the replace had actually landed.
 */
const WRITTEN_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR42mP4z8AARAwQCgAf7gP9Y167WwAAAABJRU5ErkJggg==";
const WRITTEN_PNG_BYTES = 73;

/**
 * What `get_project_thumbnails` returns for every stored image: a real 73-byte 4x3 RGB PNG, and a
 * THIRD payload distinct from both the seeded and the written ones on purpose. If the row tile
 * reused either of those, a regression that fed the row a full-size `get_project_image` payload
 * would render identically and no assertion could see it. Keep it decodable and keep it distinct.
 */
const THUMBNAIL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR42mPgOREFRww4OQAQmg4pdqj/QAAAAABJRU5ErkJggg==";

function seededImage(
  projectId: number,
  filename = "cover.png"
): MockProjectImage {
  return {
    project_id: projectId,
    mime_type: "image/png",
    original_filename: filename,
    byte_size: ONE_PIXEL_PNG_BYTES,
    uploaded_at: "2026-03-04 10:15:00",
    image_base64: ONE_PIXEL_PNG_BASE64,
  };
}

const SURPLUS_CENTS = 50_000;

async function setupTauriMock(
  page: Page,
  suggestion: MockSuggestion[] = [],
  surplusCents: number = SURPLUS_CENTS,
  // Suggested contributions dated today, written straight into the fake ledger. This is how a spec
  // reaches "the month is already confirmed" without driving the panel — the only way to test a
  // confirmed month whose split has since come back empty.
  seedConfirmed: { project_id: number; amount_cents: number }[] = [],
  // A `config` skip marker already on disk, which is what a returning visitor's second page load
  // actually looks like.
  seedSkippedMonth: string | null = null,
  // Projects that already exist on page load, so a spec can start from a shaped goal instead of
  // driving the create form for every row it needs.
  seedProjects: MockSeedProject[] = [],
  // Pace rows exactly as Rust would return them. Supplied rather than recomputed here on purpose:
  // the status and both rates are backend-owned (the Rust unit tests pin the arithmetic), and this
  // spec's job is to prove the row renders whatever the backend decided.
  seedPace: MockPace[] = [],
  // What `get_ai_config` reports. Off by default so every existing spec keeps exercising the surface
  // as it behaves on a machine with no provider credentials.
  aiConfigured: boolean = false,
  // Whether the provider answers or fails, which is the only difference between the advisory
  // success and error branches.
  adviceOutcome: "success" | "error" = "success",
  // A signed-in cloud account Rust confirmed premium. Independent of `aiConfigured`: the two are
  // separate signals everywhere except the availability gate itself. `delayMs` holds the entitlement
  // read unresolved, which is the first-paint window every premium user actually sees.
  premium: MockPremium = { granted: false },
  // The one image knob. Defaults to "nothing stored, picker dismissed", so every pre-existing spec
  // keeps exercising the surface as it behaves for a project that has never had a picture.
  images: MockImageState = NO_IMAGES
) {
  await page.addInitScript(
    ({
      suggestion,
      surplusCents,
      seedConfirmed,
      seedSkippedMonth,
      seedProjects,
      seedPace,
      aiConfigured,
      adviceOutcome,
      premium,
      images,
      writtenImageBase64,
      writtenImageBytes,
      thumbnailImageBase64,
    }) => {
      interface MockProject {
        id: number;
        name: string;
        target_cents: number;
        target_date: string | null;
        priority: number;
        icon: string | null;
        color: string | null;
        archived_at: string | null;
        created_at: string;
        updated_at: string;
      }

      interface MockContribution {
        id: number;
        project_id: number;
        account_id: number;
        amount_cents: number;
        source: string;
        date: string;
        created_at: string;
      }

      const projects: MockProject[] = seedProjects.map((seed, index) => ({
        id: seed.id,
        name: seed.name,
        target_cents: seed.target_cents,
        target_date: seed.target_date,
        priority: index,
        icon: null,
        color: null,
        archived_at: null,
        created_at: "2025-01-01T00:00:00Z",
        updated_at: "2025-01-01T00:00:00Z",
      }));
      let nextProjectId =
        projects.reduce((max, project) => Math.max(max, project.id), 0) + 1;
      const contributions: MockContribution[] = [];
      let nextContributionId = 1;
      // The `config` key-value table, which is the ONLY thing a skip may write. Exposed so a spec
      // can assert the skip landed here and nowhere near `project_contributions`.
      const SKIPPED_MONTH_KEY = "projects_suggestion_skipped_month";
      const config: Record<string, string> = seedSkippedMonth
        ? { projects_suggestion_skipped_month: seedSkippedMonth }
        : {};
      (window as unknown as Record<string, unknown>).__CONFIG__ = config;

      const pad = (value: number) => String(value).padStart(2, "0");
      const currentMonth = () => {
        const now = new Date();
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
      };
      const nextSuggestionDate = () => {
        const now = new Date();
        const rolls = now.getMonth() === 11;
        const year = rolls ? now.getFullYear() + 1 : now.getFullYear();
        const month = rolls ? 1 : now.getMonth() + 2;
        return `${year}-${pad(month)}-01`;
      };
      const todayIso = () => {
        const now = new Date();
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
          now.getDate()
        )}`;
      };

      for (const seed of seedConfirmed) {
        contributions.push({
          id: nextContributionId++,
          project_id: seed.project_id,
          account_id: 1,
          amount_cents: seed.amount_cents,
          source: "suggested",
          date: todayIso(),
          created_at: new Date().toISOString(),
        });
      }
      // Every command name the app sends is recorded here so a spec can prove a surface wrote nothing.
      const invokeLog: string[] = [];
      (window as unknown as Record<string, unknown>).__INVOKE_LOG__ = invokeLog;
      // The confirm payloads and the contribution store are exposed so the skip spec can assert at
      // the "database" level that skipping is indistinguishable from never opening the panel.
      const adviceCalls: Record<string, unknown>[] = [];
      (window as unknown as Record<string, unknown>).__ADVICE_CALLS__ = adviceCalls;
      const confirmCalls: unknown[] = [];
      (window as unknown as Record<string, unknown>).__CONFIRM_CALLS__ =
        confirmCalls;
      (window as unknown as Record<string, unknown>).__CONTRIBUTIONS__ =
        contributions;
      // Frozen on purpose: every contribution assertion in this spec reads this back to prove the
      // balance never moved (PRD SC2).
      const accounts = [
        {
          id: 1,
          name: "Chequing",
          institution: "RBC",
          account_type: "chequing",
          currency: "CAD",
          balance_cents: 872_000,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ];

      (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ =
        { unregisterListener: () => {} };

      // Keyed one-to-one on `project_id`, which is what the PRIMARY KEY on `project_images` means:
      // a write replaces rather than accumulates, so replace can never leave two rows behind.
      const projectImages: MockProjectImage[] = images.seed.map((seed) => ({
        ...seed,
      }));
      const imageReadRejects = new Set(images.readRejects);
      const basename = (path: string) => path.split(/[\\/]/).pop() ?? path;
      // One entry per native picker round trip. The picker is deliberately absent from
      // `__INVOKE_LOG__`, so this is the only anchor a spec has for "the pick has been processed"
      // when the outcome is a dismissal that writes nothing and changes nothing on screen.
      const pickerCalls: (string | null)[] = [];
      (window as unknown as Record<string, unknown>).__PICKER_CALLS__ = pickerCalls;
      const refusal = (field: string) => ({
        type: "validation",
        message: `Refused by ${field}`,
        field,
      });

      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
        transformCallback: (cb: unknown) => {
          const id = Math.floor(Math.random() * 1e9);
          (window as unknown as Record<string, unknown>)[`_${id}`] = cb;
          return id;
        },
        invoke: (cmd: string, args: Record<string, unknown>) => {
          // Must precede the blanket plugin branch, or every image pick resolves null and no file
          // can ever be selected. Not logged, matching how every other plugin call is handled.
          if (cmd === "plugin:dialog|open") {
            pickerCalls.push(images.pickedPath);
            return Promise.resolve(images.pickedPath);
          }
          if (cmd.startsWith("plugin:")) return Promise.resolve(null);
          invokeLog.push(cmd);
          switch (cmd) {
            case "check_picker_gate":
              return Promise.resolve({ needs_picker: false });
            case "get_projects":
              return Promise.resolve(
                projects
                  .filter((p) => p.archived_at === null)
                  .sort((a, b) => a.priority - b.priority || a.id - b.id)
              );

          case "create_project": {
            const name = (args.name as string)?.trim();
            const targetCents = args.target_cents as number;
            if (!name) {
              return Promise.reject({
                type: "validation",
                message: "Project name is required",
                field: "name",
              });
            }
            if (targetCents <= 0) {
              return Promise.reject({
                type: "validation",
                message: "Target amount must be greater than zero",
                field: "target_cents",
              });
            }
            const now = new Date().toISOString();
            const project: MockProject = {
              id: nextProjectId++,
              name,
              target_cents: targetCents,
              target_date: (args.target_date as string | null) ?? null,
              priority: (args.priority as number | null) ?? 0,
              icon: null,
              color: null,
              archived_at: null,
              created_at: now,
              updated_at: now,
            };
            projects.push(project);
            return Promise.resolve({ ...project });
          }

          case "update_project": {
            const project = projects.find((p) => p.id === (args.id as number));
            if (!project)
              return Promise.reject({
                type: "database",
                message: "Project not found",
              });
            project.name = (args.name as string).trim();
            project.target_cents = args.target_cents as number;
            project.target_date = (args.target_date as string | null) ?? null;
            project.priority = (args.priority as number | null) ?? 0;
            project.updated_at = new Date().toISOString();
            return Promise.resolve({ ...project });
          }

          case "archive_project": {
            const project = projects.find((p) => p.id === (args.id as number));
            if (!project || project.archived_at !== null)
              return Promise.reject({
                type: "database",
                message: "Project not found",
              });
            project.archived_at = new Date().toISOString();
            return Promise.resolve({ ...project });
          }

          case "reorder_projects": {
            const submitted = args.project_ids as number[];
            const active = projects.filter((p) => p.archived_at === null);
            const isPermutation =
              submitted.length === active.length &&
              new Set(submitted).size === submitted.length &&
              submitted.every((id) => active.some((p) => p.id === id));
            if (!isPermutation) {
              return Promise.reject({
                type: "validation",
                message:
                  "The submitted order must contain every active project exactly once",
                field: "project_ids",
              });
            }
            submitted.forEach((id, index) => {
              const project = projects.find((p) => p.id === id);
              if (project) {
                project.priority = index;
                project.updated_at = new Date().toISOString();
              }
            });
            return Promise.resolve(
              projects
                .filter((p) => p.archived_at === null)
                .sort((a, b) => a.priority - b.priority || a.id - b.id)
                .map((p) => ({ ...p }))
            );
          }

          case "get_accounts":
            return Promise.resolve(accounts.map((a) => ({ ...a })));

          case "get_project_saved_totals":
            return Promise.resolve(
              projects
                .filter((p) => p.archived_at === null)
                .map((p) => ({
                  project_id: p.id,
                  saved_cents: contributions
                    .filter((c) => c.project_id === p.id)
                    .reduce((sum, c) => sum + c.amount_cents, 0),
                }))
            );

          case "get_project_pace":
            return Promise.resolve(seedPace.map((row) => ({ ...row })));

          // The expanded detail reads this on every open, so it is a load-time invoke on this
          // surface and cannot fall through to the rejecting default branch.
          case "get_ai_config":
            return Promise.resolve({
              provider: aiConfigured ? "bedrock" : null,
              configured: aiConfigured,
              region: "us-east-1",
            });

          // The advice gate now also reads the cloud entitlement, so all three of these are
          // load-time invokes on this surface and cannot fall through to the rejecting default.
          case "get_active_profile":
            return Promise.resolve({
              dataset_id: "d1",
              kind: premium.granted ? "cloud-linked" : "local",
              label: "Personal",
              is_signed_in: premium.granted,
            });

          case "get_auth_session":
            return Promise.resolve(
              premium.granted
                ? { status: "LoggedIn", email: "a@b.c", name: null }
                : { status: "LoggedOut" }
            );

          case "get_cloud_ai_premium":
            return premium.delayMs === undefined
              ? Promise.resolve(premium.granted)
              : new Promise((resolve) => {
                  setTimeout(() => resolve(premium.granted), premium.delayMs);
                });

          // Every argument the frontend sends is recorded so a spec can prove the request carries no
          // category name and no budget amount — the backend reads those itself.
          case "generate_project_advice": {
            adviceCalls.push({ ...args });
            if (adviceOutcome === "error") {
              return Promise.reject({
                type: "ai_service",
                message: "Bedrock API error",
                recoverable: true,
              });
            }
            return Promise.resolve({
              headline: "Redirect $250 a month to stay on schedule.",
              body: "You are contributing about half of what this goal needs. Groceries ran $150 over target this month, which is the closest place to find it.",
              tone: "caution",
              project_name: args.project_name as string,
            });
          }

          case "get_project_contributions":
            return Promise.resolve(
              contributions
                .filter((c) => c.project_id === (args.project_id as number))
                .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
                .map((c) => ({ ...c }))
            );

          case "create_project_contribution": {
            const amountCents = args.amount_cents as number;
            if (amountCents <= 0) {
              return Promise.reject({
                type: "validation",
                message: "Contribution amount must be greater than zero",
                field: "amount_cents",
              });
            }
            const contribution: MockContribution = {
              id: nextContributionId++,
              project_id: args.project_id as number,
              account_id: args.account_id as number,
              amount_cents: amountCents,
              source: "manual",
              date: args.date as string,
              created_at: new Date().toISOString(),
            };
            contributions.push(contribution);
            return Promise.resolve({ ...contribution });
          }

          case "confirm_project_allocations": {
            const allocations = args.allocations as {
              project_id: number;
              account_id: number;
              amount_cents: number;
              date: string;
            }[];
            confirmCalls.push(allocations);
            const total = allocations.reduce(
              (sum, a) => sum + a.amount_cents,
              0
            );
            if (total > surplusCents) {
              return Promise.reject({
                type: "validation",
                message: "The confirmed total exceeds your monthly surplus",
                field: "amount_cents",
              });
            }
            // Zero entries create no row, mirroring the db layer's filter (AC #4).
            const created = allocations
              .filter((a) => a.amount_cents !== 0)
              .map((a) => ({
                id: nextContributionId++,
                project_id: a.project_id,
                account_id: a.account_id,
                amount_cents: a.amount_cents,
                source: "suggested",
                date: a.date,
                created_at: new Date().toISOString(),
              }));
            contributions.push(...created);
            return Promise.resolve(created.map((c) => ({ ...c })));
          }

          case "delete_project_contribution": {
            const index = contributions.findIndex(
              (c) => c.id === (args.id as number)
            );
            if (index === -1)
              return Promise.reject({
                type: "database",
                message: "Contribution not found",
              });
            const [removed] = contributions.splice(index, 1);
            return Promise.resolve({ ...removed });
          }

          case "get_savings_projects_summary": {
            const active = projects.filter((p) => p.archived_at === null);
            return Promise.resolve({
              active_project_count: active.length,
              total_saved_cents: contributions
                .filter((c) =>
                  active.some((p) => p.id === c.project_id)
                )
                .reduce((sum, c) => sum + c.amount_cents, 0),
              total_target_cents: active.reduce(
                (sum, p) => sum + p.target_cents,
                0
              ),
            });
          }
          // Story 32.3 mounts the consuming panel on this surface, which makes both of these
          // load-time invokes; the default branch rejects and an unhandled rejection fails the spec.
          // The settled state is derived here exactly the way Rust derives it — a confirmation is
          // read back off the contribution rows and a skip off the `config` marker — so the specs
          // exercise the real cadence rather than a hard-coded flag.
          case "get_suggested_allocation": {
            const month = currentMonth();
            const confirmedRows = contributions.filter(
              (c) => c.source === "suggested" && c.date.startsWith(month)
            );
            let settlement: Record<string, unknown> | null = null;
            if (confirmedRows.length > 0) {
              settlement = {
                settled_by: "confirm",
                settled_date: confirmedRows
                  .map((c) => c.date)
                  .sort()
                  .at(-1),
                settled_month: month,
                confirmed_total_cents: confirmedRows.reduce(
                  (sum, c) => sum + c.amount_cents,
                  0
                ),
                confirmed_project_count: new Set(
                  confirmedRows.map((c) => c.project_id)
                ).size,
              };
            } else if (config[SKIPPED_MONTH_KEY] === month) {
              settlement = { settled_by: "skip", settled_month: month };
            }
            const confirmedTotal =
              settlement?.settled_by === "confirm"
                ? (settlement.confirmed_total_cents as number)
                : 0;
            return Promise.resolve({
              suggestions: suggestion.map((s) => ({ ...s })),
              available_surplus_cents: surplusCents,
              remaining_surplus_cents: surplusCents - confirmedTotal,
              current_month: month,
              next_suggestion_date: nextSuggestionDate(),
              settlement,
            });
          }

          case "skip_suggested_allocation_for_month": {
            const month = currentMonth();
            config[SKIPPED_MONTH_KEY] = month;
            return Promise.resolve(month);
          }

          case "clear_suggested_allocation_skip":
            config[SKIPPED_MONTH_KEY] = "";
            return Promise.resolve(null);

          case "get_financial_health_summary":
            return Promise.resolve({
              data_sufficient: true,
              emergency_fund: null,
              savings: {
                savings_rate_percent: 20,
                avg_monthly_surplus_cents: surplusCents,
              },
              waterfall: {
                current_step: "fund_savings_projects",
                action_line_key: "fund_savings_projects",
              },
            });

          // The four image commands. Mocked here rather than in the spec that needs them because
          // `ProjectDetail` mounts the image card on every expand: without `get_project_image` the
          // `default:` branch below rejects and every unrelated expand renders the load-failed copy.
          case "get_project_image": {
            const projectId = args.project_id as number;
            if (imageReadRejects.has(projectId))
              return Promise.reject({
                type: "database",
                message: "Could not read the stored image",
              });
            const stored = projectImages.find(
              (image) => image.project_id === projectId
            );
            // `null` is the normal "no picture yet" answer, never a failure.
            return Promise.resolve(stored ? { ...stored } : null);
          }

          // Returns a bare basename, so no directory component can reach the UI.
          case "validate_project_image":
            if (images.validateRejectField !== null)
              return Promise.reject(refusal(images.validateRejectField));
            return Promise.resolve(basename(args.file_path as string));

          case "set_project_image": {
            const projectId = args.project_id as number;
            // Refused after validation already passed, so any image already stored must survive
            // untouched — which is exactly what the replace-failure spec reads back.
            if (images.writeRejectField !== null)
              return Promise.reject(refusal(images.writeRejectField));
            const written: MockProjectImage = {
              project_id: projectId,
              mime_type: "image/png",
              original_filename: basename(args.file_path as string),
              byte_size: writtenImageBytes,
              uploaded_at: "2026-03-04 10:15:00",
              image_base64: writtenImageBase64,
            };
            const index = projectImages.findIndex(
              (image) => image.project_id === projectId
            );
            if (index === -1) projectImages.push(written);
            else projectImages[index] = written;
            // Metadata only on the way back: the payload never rides on a write response.
            return Promise.resolve({
              project_id: written.project_id,
              mime_type: written.mime_type,
              original_filename: written.original_filename,
              byte_size: written.byte_size,
              uploaded_at: written.uploaded_at,
            });
          }

          // Idempotent, exactly like the Rust command: removing nothing is not an error.
          case "remove_project_image": {
            if (images.removeRejectField !== null)
              return Promise.reject(refusal(images.removeRejectField));
            const index = projectImages.findIndex(
              (image) => image.project_id === (args.project_id as number)
            );
            if (index !== -1) projectImages.splice(index, 1);
            return Promise.resolve(null);
          }

          // ONE call for the whole collapsed list, derived from the same store the four commands
          // above write, so an add or a removal moves the row tile without a second knob. The
          // payload is deliberately NOT the stored `image_base64`: Rust ships a downscaled
          // derivative here, and reusing the full-size bytes would make the mock lie about the
          // one guarantee this command exists to provide.
          case "get_project_thumbnails":
            return Promise.resolve(
              projectImages.map((image) => ({
                project_id: image.project_id,
                mime_type: image.mime_type,
                image_base64: thumbnailImageBase64,
              }))
            );

          default:
            return Promise.reject(`Unknown command: ${cmd}`);
          }
        },
        convertFileSrc: (path: string) => path,
      };
    },
    {
      suggestion,
      surplusCents,
      seedConfirmed,
      seedSkippedMonth,
      seedProjects,
      seedPace,
      aiConfigured,
      adviceOutcome,
      premium,
      images,
      writtenImageBase64: WRITTEN_PNG_BASE64,
      writtenImageBytes: WRITTEN_PNG_BYTES,
      thumbnailImageBase64: THUMBNAIL_PNG_BASE64,
    }
  );
}

async function createProject(page: Page, name: string, targetDollars: string) {
  await page.getByTestId("add-project-button").click();
  const form = page.getByTestId("project-form");
  await form.getByLabel("Name").fill(name);
  await form.getByLabel("Target amount").fill(targetDollars);
  await form.getByRole("button", { name: "Save project" }).click();
  await expect(page.getByTestId("project-slide-over")).not.toBeVisible();
}

async function logContribution(page: Page, amountDollars: string) {
  await page.getByTestId("project-expand-toggle").click();
  await page.getByTestId("add-contribution-button").click();

  const form = page.getByTestId("project-contribution-form");
  await expect(form).toBeVisible();
  await form.getByLabel("Money is sitting in").click();
  await page.getByRole("option", { name: "Chequing — RBC" }).click();
  await form.getByLabel("Amount").fill(amountDollars);
  await form.getByRole("button", { name: "Log contribution" }).click();

  await expect(page.getByTestId("contribution-slide-over")).not.toBeVisible();
}

async function accountBalanceCents(page: Page) {
  return page.evaluate(async () => {
    const internals = (window as unknown as Record<string, unknown>)
      .__TAURI_INTERNALS__ as {
      invoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
    };
    const accounts = (await internals.invoke("get_accounts", {})) as {
      balance_cents: number;
    }[];
    return accounts[0].balance_cents;
  });
}

test.describe("Savings projects", () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/wealth/projects");
  });

  test("shows the empty state when no projects exist", async ({ page }) => {
    const emptyState = page.getByTestId("projects-empty-state");
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toContainText("No savings projects yet");
    await expect(page.getByTestId("project-row")).toHaveCount(0);
  });

  test("creating a project shows it in the list with $0 saved of the target", async ({
    page,
  }) => {
    await createProject(page, "Car down payment", "5000.00");

    const row = page.getByTestId("project-row");
    await expect(row).toBeVisible();
    await expect(row).toContainText("Car down payment");
    await expect(page.getByTestId("project-saved-target")).toContainText(
      "$0.00"
    );
    await expect(page.getByTestId("project-saved-target")).toContainText(
      "$5,000.00"
    );
    await expect(page.getByTestId("project-status-badge")).toContainText(
      "$5,000.00 to go"
    );
  });

  test("a blank name is rejected before any command is sent", async ({
    page,
  }) => {
    await page.getByTestId("add-project-button").click();
    await page.getByRole("button", { name: "Save project" }).click();
    await expect(page.getByText("A project name is required")).toBeVisible();
  });

  test("a zero target amount is rejected", async ({ page }) => {
    await page.getByTestId("add-project-button").click();
    const form = page.getByTestId("project-form");
    await form.getByLabel("Name").fill("No target");
    await page.getByRole("button", { name: "Save project" }).click();
    await expect(
      page.getByText("Amount must be greater than $0")
    ).toBeVisible();
  });

  test("editing a project updates the name and target in the list", async ({
    page,
  }) => {
    await createProject(page, "Car down payment", "5000.00");

    await page.getByTestId("project-row-menu").click();
    await page.getByTestId("edit-project-button").click();

    const form = page.getByTestId("project-form");
    await expect(form).toBeVisible();
    await form.getByLabel("Name").fill("Truck down payment");
    // `MoneyInput`'s focus handler rewrites the display value, so a pre-populated money field must
    // be focused in its own step before `fill`, or the old amount wins the same event batch.
    const target = form.getByLabel("Target amount");
    await target.click();
    await target.fill("7500.00");
    await form.getByRole("button", { name: "Save project" }).click();

    await expect(page.getByTestId("edit-project-slide-over")).not.toBeVisible();
    await expect(page.getByTestId("project-row")).toContainText(
      "Truck down payment"
    );
    await expect(page.getByTestId("project-saved-target")).toContainText(
      "$7,500.00"
    );
  });

  test("archiving a project confirms, then removes it from the active list", async ({
    page,
  }) => {
    await createProject(page, "Kitchen renovation", "1200.00");

    await page.getByTestId("project-row-menu").click();
    await page.getByTestId("archive-project-button").click();

    const dialog = page.getByTestId("archive-project-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Archive this project?");

    await page.getByTestId("confirm-archive-project-button").click();

    await expect(page.getByTestId("project-row")).toHaveCount(0);
    await expect(page.getByTestId("projects-empty-state")).toBeVisible();
  });

  test("the surface states that tracking a goal never moves money", async ({
    page,
  }) => {
    await page.getByTestId("add-project-button").click();
    await expect(page.getByTestId("project-no-money-moved")).toContainText(
      "never moves money"
    );
  });

  test("logging a contribution raises the saved total and leaves the account balance alone", async ({
    page,
  }) => {
    await createProject(page, "Car down payment", "5000.00");
    const balanceBefore = await accountBalanceCents(page);

    await logContribution(page, "250.00");

    await expect(page.getByTestId("project-saved-target")).toContainText(
      "$250.00"
    );
    await expect(page.getByTestId("project-status-badge")).toContainText(
      "$4,750.00 to go"
    );
    await expect(page.getByTestId("project-saved-amount")).toContainText(
      "$250.00"
    );
    await expect(page.getByTestId("project-remaining-amount")).toContainText(
      "$4,750.00"
    );
    await expect(page.getByTestId("project-percent")).toContainText("5%");
    await expect(await accountBalanceCents(page)).toBe(balanceBefore);
  });

  test("deleting a contribution lowers the saved total and leaves the account balance alone", async ({
    page,
  }) => {
    await createProject(page, "Kitchen renovation", "1000.00");
    await logContribution(page, "400.00");
    await expect(page.getByTestId("project-saved-target")).toContainText(
      "$400.00"
    );

    await page.getByTestId("delete-contribution-button").click();
    const dialog = page.getByTestId("delete-contribution-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Delete this contribution?");
    await page.getByTestId("confirm-delete-contribution-button").click();

    await expect(page.getByTestId("project-saved-target")).toContainText(
      "$0.00"
    );
    await expect(page.getByTestId("contribution-history-empty")).toBeVisible();
    await expect(await accountBalanceCents(page)).toBe(872_000);
  });

  test("a contribution with no source account is rejected before any command is sent", async ({
    page,
  }) => {
    await createProject(page, "Boat", "3000.00");
    await page.getByTestId("project-expand-toggle").click();
    await page.getByTestId("add-contribution-button").click();

    const form = page.getByTestId("project-contribution-form");
    await form.getByLabel("Amount").fill("100.00");
    await form.getByRole("button", { name: "Log contribution" }).click();

    await expect(
      page.getByText("Choose which account this money is sitting in")
    ).toBeVisible();
    await expect(page.getByTestId("project-saved-target")).toContainText(
      "$0.00"
    );
  });

  test("moving the first project down renders the rows in the new order", async ({
    page,
  }) => {
    await createProject(page, "Car down payment", "5000.00");
    await createProject(page, "Kitchen renovation", "1200.00");
    await createProject(page, "Boat", "3000.00");

    await expect(page.getByTestId("project-name")).toHaveText([
      "Car down payment",
      "Kitchen renovation",
      "Boat",
    ]);

    await page.getByTestId("project-move-down").first().click();

    await expect(page.getByTestId("project-name")).toHaveText([
      "Kitchen renovation",
      "Car down payment",
      "Boat",
    ]);
  });

  test("the move controls are keyboard-operable and bound at the list edges", async ({
    page,
  }) => {
    await createProject(page, "Car down payment", "5000.00");
    await createProject(page, "Kitchen renovation", "1200.00");

    const firstRowMoveUp = page
      .getByLabel("Move Car down payment up in priority")
      .first();
    const firstRowMoveDown = page.getByLabel(
      "Move Car down payment down in priority"
    );

    await expect(firstRowMoveUp).toBeDisabled();

    await firstRowMoveDown.focus();
    await expect(firstRowMoveDown).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("project-name")).toHaveText([
      "Kitchen renovation",
      "Car down payment",
    ]);
    await expect(firstRowMoveDown).toBeDisabled();
    await expect(
      page.getByLabel("Move Car down payment up in priority")
    ).toBeFocused();
  });

  test("a rejected reorder reverts to the previous order and warns the user", async ({
    page,
  }) => {
    await createProject(page, "Car down payment", "5000.00");
    await createProject(page, "Kitchen renovation", "1200.00");

    await page.evaluate(() => {
      const internals = (window as unknown as Record<string, unknown>)
        .__TAURI_INTERNALS__ as {
        invoke: (
          cmd: string,
          args: Record<string, unknown>
        ) => Promise<unknown>;
      };
      const original = internals.invoke;
      internals.invoke = (cmd, args) =>
        cmd === "reorder_projects"
          ? Promise.reject({ type: "database", message: "disk is full" })
          : original(cmd, args);
    });

    await page.getByTestId("project-move-down").first().click();

    await expect(page.getByText("Could not save the new order")).toBeVisible();
    await expect(page.getByTestId("project-name")).toHaveText([
      "Car down payment",
      "Kitchen renovation",
    ]);
  });
});

async function invokedCommands(page: Page) {
  return page.evaluate(
    () => (window as unknown as Record<string, string[]>).__INVOKE_LOG__ ?? []
  );
}

async function setAmount(page: Page, projectName: string, dollars: string) {
  const field = page.getByLabel(`Amount for ${projectName}`);
  await field.click();
  await field.fill(dollars);
  await field.blur();
}

async function confirmCalls(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as Record<string, unknown[]>).__CONFIRM_CALLS__ ?? []
  );
}

async function storedContributions(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as Record<string, unknown[]>).__CONTRIBUTIONS__ ?? []
  );
}

async function pickSuggestionAccount(page: Page) {
  await page.getByLabel("Where is this money sitting?").click();
  await page.getByRole("option", { name: "Chequing — RBC" }).click();
}

// The panel arrives collapsed, so every spec that reads or drives its body has to open it first.
async function expandSuggestionPanel(page: Page) {
  await page.getByTestId("suggested-allocation-toggle").click();
  await expect(page.getByTestId("suggested-allocation-toggle")).toHaveAttribute(
    "aria-expanded",
    "true"
  );
}

function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function currentMonth() {
  return today().slice(0, 7);
}

// Every unconditionally-rendered part of the card's body and footer. Listed by name so a part that
// silently stops rendering — or leaks into the collapsed state — fails a test instead of passing one.
const COLLAPSIBLE_SUGGESTION_PARTS = [
  "suggested-allocation-intro",
  "suggested-allocation-row",
  "suggested-allocation-summary",
  "suggested-allocation-surplus",
  "suggested-allocation-total",
  "suggested-allocation-account",
  "suggested-allocation-skip",
  "suggested-allocation-confirm",
  "suggested-allocation-cadence",
] as const;

// The card is a disclosure, closed on arrival: the recommendation must not push the project list
// down for a user who came to read their goals. Everything below the header is genuinely unmounted
// while it is closed, which is what the `toHaveCount(0)` assertions pin.
test.describe("Disclosing the suggested monthly split", () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page, TWO_PROJECT_SUGGESTION);
    await page.goto("/wealth/projects");
    await expect(page.getByTestId("suggested-allocation-panel")).toBeVisible();
  });

  test("the card arrives collapsed, with only its title and toggle on screen", async ({
    page,
  }) => {
    await expect(page.getByTestId("suggested-allocation-title")).toContainText(
      "Suggested monthly split"
    );
    await expect(
      page.getByTestId("suggested-allocation-toggle")
    ).toHaveAttribute("aria-expanded", "false");

    for (const testId of COLLAPSIBLE_SUGGESTION_PARTS) {
      await expect(page.getByTestId(testId)).toHaveCount(0);
    }
  });

  // `CardHeader` ships a `grid` by default, which stacked the badge above the label. This pins the
  // rendered geometry rather than a class list, because only a real row layout can put the three
  // boxes on a shared centre line in the order the review asked for.
  test("the header keeps the logo, toggle, and title on one row at the minimum window", async ({
    page,
  }) => {
    // The `minWidth`/`minHeight` from `tauri.conf.json`: the narrowest row a user can produce.
    await page.setViewportSize({ width: 1024, height: 680 });

    const header = page
      .getByTestId("suggested-allocation-panel")
      .locator('[data-slot="card-header"]');
    const logo = header.locator('span[aria-hidden="true"]');
    const titleRow = header.locator(
      'div:has(> [data-testid="suggested-allocation-toggle"])'
    );
    await expect(logo).toHaveCount(1);
    await expect(titleRow).toHaveCount(1);

    const boxes = await Promise.all(
      [
        logo,
        titleRow,
        page.getByTestId("suggested-allocation-toggle"),
        page.getByTestId("suggested-allocation-title"),
      ].map(async (locator) => {
        const box = await locator.boundingBox();
        if (box === null) throw new Error("a header part is not rendered");
        return box;
      })
    );
    const [logoBox, rowBox, toggleBox, titleBox] = boxes;
    const centreY = (box: { y: number; height: number }) =>
      box.y + box.height / 2;

    // Two pixels is sub-pixel rounding on the centre line; a stacked header is off by tens.
    for (const box of [rowBox, toggleBox, titleBox]) {
      expect(Math.abs(centreY(box) - centreY(logoBox))).toBeLessThanOrEqual(2);
    }
    // Centres can coincide by accident, so also require the label to overlap the badge's own band
    // of pixels — two stacked rows never do.
    expect(titleBox.y).toBeLessThan(logoBox.y + logoBox.height);
    expect(logoBox.y).toBeLessThan(titleBox.y + titleBox.height);

    expect(logoBox.x + logoBox.width).toBeLessThanOrEqual(toggleBox.x);
    expect(toggleBox.x + toggleBox.width).toBeLessThanOrEqual(titleBox.x);
    // The chevron belongs to the title, not to the far edge: one `gap-1.5` of slack, no more.
    expect(titleBox.x - (toggleBox.x + toggleBox.width)).toBeLessThanOrEqual(12);

    expect(await horizontalOverflowPx(page)).toBeLessThanOrEqual(0);
  });

  test("opening it renders every pre-existing body and footer control", async ({
    page,
  }) => {
    await expandSuggestionPanel(page);

    for (const testId of COLLAPSIBLE_SUGGESTION_PARTS) {
      await expect(page.getByTestId(testId).first()).toBeVisible();
    }
    await expect(page.getByTestId("suggested-allocation-row")).toHaveCount(2);
    await expect(page.getByLabel("Amount for Car down payment")).toHaveValue(
      "300.00"
    );
  });

  test("closing it again hides the body and footer but keeps the title", async ({
    page,
  }) => {
    await expandSuggestionPanel(page);
    await page.getByTestId("suggested-allocation-toggle").click();

    await expect(
      page.getByTestId("suggested-allocation-toggle")
    ).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("suggested-allocation-title")).toBeVisible();
    for (const testId of COLLAPSIBLE_SUGGESTION_PARTS) {
      await expect(page.getByTestId(testId)).toHaveCount(0);
    }
  });

  // Keyboard, not a synthesised click: the toggle has to be a real button, and Enter on a div would
  // do nothing at all.
  test("the toggle opens and closes from the keyboard", async ({ page }) => {
    const toggle = page.getByTestId("suggested-allocation-toggle");

    await toggle.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("suggested-allocation-intro")).toBeVisible();

    await toggle.press(" ");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("suggested-allocation-intro")).toHaveCount(0);
  });

  test("the toggle's accessible name states the action it offers in each state", async ({
    page,
  }) => {
    await expect(
      page.getByRole("button", { name: "Show the suggested monthly split" })
    ).toBeVisible();

    await expandSuggestionPanel(page);

    await expect(
      page.getByRole("button", { name: "Hide the suggested monthly split" })
    ).toBeVisible();
  });

  test("the toggle states its available action in French", async ({ page }) => {
    await page.getByText("Français", { exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(
      page.getByRole("button", {
        name: "Afficher la répartition mensuelle suggérée",
      })
    ).toBeVisible();

    await page.getByTestId("suggested-allocation-toggle").click();

    await expect(
      page.getByRole("button", {
        name: "Masquer la répartition mensuelle suggérée",
      })
    ).toBeVisible();
  });

  test("reopening the card keeps an edited amount rather than resetting it", async ({
    page,
  }) => {
    await expandSuggestionPanel(page);
    await setAmount(page, "Car down payment", "125.00");
    await page.getByTestId("suggested-allocation-toggle").click();
    await expandSuggestionPanel(page);

    await expect(page.getByLabel("Amount for Car down payment")).toHaveValue(
      "125.00"
    );
    await expect(page.getByTestId("suggested-allocation-total")).toContainText(
      "$325.00"
    );
  });
});

test.describe("Suggested allocation review", () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page, TWO_PROJECT_SUGGESTION);
    await page.goto("/wealth/projects");
    await expect(page.getByTestId("suggested-allocation-panel")).toBeVisible();
    await expandSuggestionPanel(page);
  });

  test("lists one pre-filled editable amount per suggested project with the surplus and total", async ({
    page,
  }) => {
    await expect(page.getByTestId("suggested-allocation-row")).toHaveCount(2);
    await expect(page.getByLabel("Amount for Car down payment")).toHaveValue(
      "300.00"
    );
    await expect(page.getByLabel("Amount for Kitchen renovation")).toHaveValue(
      "200.00"
    );
    await expect(page.getByTestId("suggested-allocation-surplus")).toContainText(
      "$500.00"
    );
    await expect(page.getByTestId("suggested-allocation-total")).toContainText(
      "$500.00"
    );
    await expect(page.getByTestId("suggested-allocation-intro")).toContainText(
      "Nothing is saved until you confirm"
    );
  });

  test("a total exactly equal to the surplus leaves confirm enabled", async ({
    page,
  }) => {
    // Story 32.4 gates confirm on a source account too, so the account is chosen first and these
    // assertions keep testing only the FR7 total boundary.
    await pickSuggestionAccount(page);

    await expect(page.getByTestId("suggested-allocation-confirm")).toBeEnabled();
    await expect(page.getByTestId("suggested-allocation-overage")).toHaveCount(0);
    await expect(
      page.getByTestId("suggested-allocation-remainder")
    ).toContainText("$0.00");
  });

  test("exceeding the surplus disables confirm and explains the overage, and reducing it re-enables", async ({
    page,
  }) => {
    await pickSuggestionAccount(page);
    await setAmount(page, "Car down payment", "400.00");

    await expect(page.getByTestId("suggested-allocation-overage")).toContainText(
      "$100.00 over your available surplus"
    );
    await expect(
      page.getByTestId("suggested-allocation-confirm")
    ).toBeDisabled();

    await setAmount(page, "Car down payment", "250.00");

    await expect(page.getByTestId("suggested-allocation-overage")).toHaveCount(0);
    await expect(page.getByTestId("suggested-allocation-confirm")).toBeEnabled();
  });

  test("setting one amount to zero keeps confirm enabled", async ({ page }) => {
    await pickSuggestionAccount(page);
    await setAmount(page, "Kitchen renovation", "");

    await expect(page.getByTestId("suggested-allocation-total")).toContainText(
      "$300.00"
    );
    await expect(page.getByTestId("suggested-allocation-confirm")).toBeEnabled();
  });

  test("editing amounts invokes no write command at all", async ({ page }) => {
    await pickSuggestionAccount(page);
    await setAmount(page, "Car down payment", "450.00");
    await setAmount(page, "Kitchen renovation", "10.00");
    await setAmount(page, "Car down payment", "0");
    await setAmount(page, "Kitchen renovation", "500.00");

    await expect(page.getByTestId("suggested-allocation-confirm")).toBeEnabled();

    const commands = await invokedCommands(page);
    expect(commands).not.toContain("confirm_project_allocations");
    expect(commands).not.toContain("create_project_contribution");
    expect(commands).toContain("get_suggested_allocation");
  });

  test("an empty suggestion renders no panel at all", async ({ page }) => {
    await page.goto("about:blank");
    await setupTauriMock(page, []);
    await page.goto("/wealth/projects");

    await expect(page.getByTestId("projects-empty-state")).toBeVisible();
    await expect(page.getByTestId("suggested-allocation-panel")).toHaveCount(0);
  });
});

test.describe("Confirming or skipping a suggested allocation", () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page, TWO_PROJECT_SUGGESTION);
    await page.goto("/wealth/projects");
    // The suggestion payload is fixed on project ids 1 and 2, which is the order these two are
    // created in, so the confirmed rows land on the projects the list is rendering.
    await createProject(page, "Car down payment", "5000.00");
    await createProject(page, "Kitchen renovation", "1200.00");
    await expect(page.getByTestId("suggested-allocation-panel")).toBeVisible();
    await expandSuggestionPanel(page);
  });

  test("confirm is disabled until a source account is chosen", async ({
    page,
  }) => {
    await expect(
      page.getByTestId("suggested-allocation-confirm")
    ).toBeDisabled();
    await expect(
      page.getByTestId("suggested-allocation-account-hint")
    ).toContainText("Pick the account holding this money");

    await pickSuggestionAccount(page);

    await expect(page.getByTestId("suggested-allocation-confirm")).toBeEnabled();
    await expect(
      page.getByTestId("suggested-allocation-account-hint")
    ).toHaveCount(0);
  });

  test("confirming sends the edited amounts once and raises the saved totals", async ({
    page,
  }) => {
    await setAmount(page, "Car down payment", "250.00");
    await pickSuggestionAccount(page);
    const balanceBefore = await accountBalanceCents(page);

    await page.getByTestId("suggested-allocation-confirm").click();

    await expect(page.getByTestId("suggested-allocation-panel")).toHaveCount(0);
    await expect(page.getByText("Earmarked across 2 goal(s)")).toBeVisible();

    expect(await confirmCalls(page)).toEqual([
      [
        {
          project_id: 1,
          account_id: 1,
          amount_cents: 25_000,
          date: today(),
        },
        {
          project_id: 2,
          account_id: 1,
          amount_cents: 20_000,
          date: today(),
        },
      ],
    ]);

    await expect(page.getByTestId("project-saved-target").first()).toContainText(
      "$250.00"
    );
    await expect(page.getByTestId("project-saved-target").last()).toContainText(
      "$200.00"
    );
    expect(await accountBalanceCents(page)).toBe(balanceBefore);
  });

  test("a zeroed amount creates no row for that project", async ({ page }) => {
    await setAmount(page, "Kitchen renovation", "");
    await pickSuggestionAccount(page);

    await page.getByTestId("suggested-allocation-confirm").click();

    await expect(page.getByTestId("suggested-allocation-panel")).toHaveCount(0);
    const stored = (await storedContributions(page)) as {
      project_id: number;
      source: string;
    }[];
    expect(stored).toHaveLength(1);
    expect(stored[0].project_id).toBe(1);
    expect(stored[0].source).toBe("suggested");
  });

  // AC #2, the important one: skipping must write nothing at all — no confirm command, no manual
  // contribution smuggled in its place, and no row of any kind.
  test("skipping after editing amounts invokes no write command and stores no row", async ({
    page,
  }) => {
    await setAmount(page, "Car down payment", "100.00");
    await setAmount(page, "Kitchen renovation", "50.00");
    await pickSuggestionAccount(page);

    await page.getByTestId("suggested-allocation-skip").click();

    await expect(page.getByTestId("suggested-allocation-panel")).toHaveCount(0);
    await expect(
      page.getByText("Skipped for", { exact: false }).first()
    ).toBeVisible();

    const commands = await invokedCommands(page);
    expect(commands).not.toContain("confirm_project_allocations");
    expect(commands).not.toContain("create_project_contribution");
    expect(commands).toContain("skip_suggested_allocation_for_month");
    expect(await confirmCalls(page)).toEqual([]);
    expect(await storedContributions(page)).toEqual([]);
    await expect(page.getByTestId("project-saved-target").first()).toContainText(
      "$0.00"
    );
  });

  test("a rejected confirmation keeps the drafts on screen and surfaces the message", async ({
    page,
  }) => {
    await page.evaluate(() => {
      const internals = (window as unknown as Record<string, unknown>)
        .__TAURI_INTERNALS__ as {
        invoke: (
          cmd: string,
          args: Record<string, unknown>
        ) => Promise<unknown>;
      };
      const original = internals.invoke;
      internals.invoke = (cmd, args) =>
        cmd === "confirm_project_allocations"
          ? Promise.reject({
              type: "validation",
              message: "Your surplus changed while you were reviewing",
              field: "amount_cents",
            })
          : original(cmd, args);
    });

    await setAmount(page, "Car down payment", "175.00");
    await pickSuggestionAccount(page);
    await page.getByTestId("suggested-allocation-confirm").click();

    await expect(
      page.getByText("Your surplus changed while you were reviewing")
    ).toBeVisible();
    await expect(page.getByTestId("suggested-allocation-panel")).toBeVisible();
    await expect(page.getByLabel("Amount for Car down payment")).toHaveValue(
      "175.00"
    );
    expect(await storedContributions(page)).toEqual([]);
  });
});

async function storedConfig(page: Page) {
  return page.evaluate(
    () =>
      ((window as unknown as Record<string, unknown>).__CONFIG__ ?? {}) as Record<
        string,
        string
      >
  );
}

// The bug this describe block exists to keep fixed: the panel used to re-ask on every page visit
// because visibility had no memory. It now settles once per calendar month, and a confirm and a skip
// each settle it through a different mechanism.
test.describe("Remembering this month's decision", () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page, TWO_PROJECT_SUGGESTION);
    await page.goto("/wealth/projects");
    await createProject(page, "Car down payment", "5000.00");
    await createProject(page, "Kitchen renovation", "1200.00");
    await expect(page.getByTestId("suggested-allocation-panel")).toBeVisible();
    await expandSuggestionPanel(page);
  });

  test("the active panel says when the question comes back", async ({ page }) => {
    await expect(page.getByTestId("suggested-allocation-cadence")).toContainText(
      "you won't be asked again until"
    );
  });

  test("confirming replaces the panel with a receipt", async ({ page }) => {
    await pickSuggestionAccount(page);
    await page.getByTestId("suggested-allocation-confirm").click();

    await expect(page.getByTestId("settled-allocation-card")).toBeVisible();
    await expect(page.getByTestId("settled-allocation-title")).toContainText(
      "This month's split is set"
    );
    await expect(page.getByTestId("settled-allocation-body")).toContainText(
      "$500.00 across 2 goal(s)"
    );
    await expect(page.getByTestId("settled-allocation-reopen")).toContainText(
      "Adjust this month's split"
    );
    await expect(page.getByTestId("suggested-allocation-panel")).toHaveCount(0);
  });

  test("skipping replaces the panel with a skipped card", async ({ page }) => {
    await page.getByTestId("suggested-allocation-skip").click();

    await expect(page.getByTestId("settled-allocation-card")).toBeVisible();
    await expect(page.getByTestId("settled-allocation-title")).toContainText(
      "You skipped this month's split"
    );
    await expect(page.getByTestId("settled-allocation-reopen")).toContainText(
      "Show this month's split"
    );
    await expect(page.getByTestId("suggested-allocation-panel")).toHaveCount(0);
  });


  // The regression test the design demands: a skip is a UI preference, so it may write the `config`
  // marker and absolutely nothing else. A single `project_contributions` row here would be the bug.
  test("skipping writes only the config marker and never a contribution", async ({
    page,
  }) => {
    await page.getByTestId("suggested-allocation-skip").click();
    await expect(page.getByTestId("settled-allocation-card")).toBeVisible();

    expect(await storedConfig(page)).toEqual({
      projects_suggestion_skipped_month: currentMonth(),
    });
    expect(await storedContributions(page)).toEqual([]);
    expect(await confirmCalls(page)).toEqual([]);
    const commands = await invokedCommands(page);
    expect(commands).not.toContain("confirm_project_allocations");
    expect(commands).not.toContain("create_project_contribution");
  });

  test("adjusting a confirmed month reopens the live panel without unwinding the contributions", async ({
    page,
  }) => {
    await pickSuggestionAccount(page);
    await page.getByTestId("suggested-allocation-confirm").click();
    await expect(page.getByTestId("settled-allocation-card")).toBeVisible();
    const storedBefore = await storedContributions(page);

    await page.getByTestId("settled-allocation-reopen").click();

    await expect(page.getByTestId("suggested-allocation-panel")).toBeVisible();
    await expect(
      page.getByTestId("suggested-allocation-toggle")
    ).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("settled-allocation-card")).toHaveCount(0);
    expect(await storedContributions(page)).toEqual(storedBefore);
    const commands = await invokedCommands(page);
    expect(commands).not.toContain("clear_suggested_allocation_skip");
    expect(commands).not.toContain("delete_project_contribution");
  });

  test("showing a skipped month clears the stored marker so the month is open again", async ({
    page,
  }) => {
    await page.getByTestId("suggested-allocation-skip").click();
    await expect(page.getByTestId("settled-allocation-card")).toBeVisible();

    await page.getByTestId("settled-allocation-reopen").click();

    await expect(page.getByTestId("suggested-allocation-panel")).toBeVisible();
    await expect(
      page.getByTestId("suggested-allocation-toggle")
    ).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("settled-allocation-card")).toHaveCount(0);
    expect(await storedConfig(page)).toEqual({
      projects_suggestion_skipped_month: "",
    });

    await expect(page.getByTestId("suggested-allocation-panel")).toBeVisible();
  });
});

// The same cadence, entered from the other direction: the decision is already on disk before
// the page ever mounts. This is the shape a returning visitor actually has, and the shape the
// old React-state dismissal could not represent at all.
test.describe("A month already settled before the page loads", () => {
  // The bug itself, at the only level that can prove it fixed: a fresh page load with the decision
  // already on disk must NOT re-ask. The old implementation held the dismissal in React state, so
  // this exact scenario re-opened the panel every visit.
  test("a fresh visit with a stored skip marker does not re-ask", async ({
    page,
  }) => {
    await setupTauriMock(
      page,
      TWO_PROJECT_SUGGESTION,
      SURPLUS_CENTS,
      [],
      currentMonth()
    );
    await page.goto("/wealth/projects");

    await expect(page.getByTestId("settled-allocation-card")).toBeVisible();
    await expect(page.getByTestId("settled-allocation-title")).toContainText(
      "You skipped this month's split"
    );
    await expect(page.getByTestId("suggested-allocation-panel")).toHaveCount(0);
  });

  // The cadence's other half: last month's skip is stale, so the panel comes back on its own.
  test("a skip marker from a previous month re-opens the panel", async ({
    page,
  }) => {
    await setupTauriMock(
      page,
      TWO_PROJECT_SUGGESTION,
      SURPLUS_CENTS,
      [],
      "2020-01"
    );
    await page.goto("/wealth/projects");

    await expect(page.getByTestId("suggested-allocation-panel")).toBeVisible();
    await expect(page.getByTestId("settled-allocation-card")).toHaveCount(0);
  });

  // The precedence rule that must NOT be gated on `suggestions.length`: a confirmation that fully
  // funds every goal returns an empty split on the next read, and the receipt still has to render.
  test("a confirmed month still shows its receipt when the split comes back empty", async ({
    page,
  }) => {
    await setupTauriMock(page, [], SURPLUS_CENTS, [
      { project_id: 1, amount_cents: 30_000 },
      { project_id: 2, amount_cents: 20_000 },
    ]);
    await page.goto("/wealth/projects");

    await expect(page.getByTestId("settled-allocation-card")).toBeVisible();
    await expect(page.getByTestId("settled-allocation-body")).toContainText(
      "$500.00 across 2 goal(s)"
    );
    await expect(page.getByTestId("suggested-allocation-panel")).toHaveCount(0);
    await expect(
      page.getByTestId("settled-allocation-second-line")
    ).toContainText("covered your whole monthly surplus");
  });
});

// The pace badge and the pace line render backend-computed figures verbatim. The status and both
// rates are seeded rather than derived here on purpose: the Rust unit tests own the arithmetic, and
// duplicating the thresholds in a mock would let the two drift while both suites stayed green.
test.describe("Project pace", () => {
  const DATED_PROJECT: MockSeedProject = {
    id: 1,
    name: "Car down payment",
    target_cents: 600_000,
    target_date: "2027-06-01",
  };

  const UNDATED_PROJECT: MockSeedProject = {
    id: 2,
    name: "Rainy day",
    target_cents: 600_000,
    target_date: null,
  };

  async function openWith(page: Page, projects: MockSeedProject[], pace: MockPace[]) {
    await setupTauriMock(page, [], SURPLUS_CENTS, [], null, projects, pace);
    await page.goto("/wealth/projects");
    await expect(page.getByTestId("project-row")).toHaveCount(projects.length);
  }

  test("a project keeping up with its deadline reads on track with the required rate", async ({
    page,
  }) => {
    await openWith(
      page,
      [DATED_PROJECT],
      [
        {
          project_id: 1,
          required_monthly_cents: 100_000,
          actual_monthly_cents: 100_000,
          status: "good",
        },
      ]
    );

    const badge = page.getByTestId("project-status-badge");
    await expect(badge).toContainText("On track");
    await expect(badge).toContainText("$1,000.00/mo");
    await expect(badge).not.toContainText("to go");
  });

  test("a project at three quarters of its required rate reads behind", async ({
    page,
  }) => {
    await openWith(
      page,
      [DATED_PROJECT],
      [
        {
          project_id: 1,
          required_monthly_cents: 100_000,
          actual_monthly_cents: 80_000,
          status: "caution",
        },
      ]
    );

    const badge = page.getByTestId("project-status-badge");
    await expect(badge).toContainText("Behind");
    await expect(badge).toContainText("$1,000.00/mo");
  });

  test("a project at half its required rate reads off track", async ({ page }) => {
    await openWith(
      page,
      [DATED_PROJECT],
      [
        {
          project_id: 1,
          required_monthly_cents: 100_000,
          actual_monthly_cents: 50_000,
          status: "over",
        },
      ]
    );

    const badge = page.getByTestId("project-status-badge");
    await expect(badge).toContainText("Off track");
    await expect(badge).toContainText("$1,000.00/mo");
  });

  test("a project with no deadline keeps the plain remaining badge and shows no rate", async ({
    page,
  }) => {
    await openWith(
      page,
      [UNDATED_PROJECT],
      [
        {
          project_id: 2,
          required_monthly_cents: null,
          actual_monthly_cents: null,
          status: "neutral",
        },
      ]
    );

    await expect(page.getByTestId("project-status-badge")).toContainText(
      "$6,000.00 to go"
    );
    await expect(page.getByTestId("project-status-badge")).not.toContainText("/mo");

    await page.getByTestId("project-expand-toggle").click();
    await expect(page.getByTestId("project-detail")).toBeVisible();
    await expect(page.getByTestId("project-pace-line")).toHaveCount(0);
  });

  // A dated project the backend refused to judge (too new to average) must fall back to the plain
  // badge rather than showing a rate the backend deliberately withheld.
  test("a dated project the backend reports as neutral keeps the plain remaining badge", async ({
    page,
  }) => {
    await openWith(
      page,
      [DATED_PROJECT],
      [
        {
          project_id: 1,
          required_monthly_cents: null,
          actual_monthly_cents: null,
          status: "neutral",
        },
      ]
    );

    await expect(page.getByTestId("project-status-badge")).toContainText(
      "$6,000.00 to go"
    );
  });

  test("the expanded detail explains the math behind the required rate", async ({
    page,
  }) => {
    await openWith(
      page,
      [DATED_PROJECT],
      [
        {
          project_id: 1,
          required_monthly_cents: 100_000,
          actual_monthly_cents: 100_000,
          status: "good",
        },
      ]
    );

    await page.getByTestId("project-expand-toggle").click();

    const line = page.getByTestId("project-pace-line");
    await expect(line).toContainText("$1,000.00/mo to reach $6,000.00 by Jun 1, 2027");
    await expect(page.getByTestId("project-pace-info")).toBeVisible();
    // Far outside the 8-week window, so the weekly restatement stays hidden.
    await expect(page.getByTestId("project-pace-weekly")).toHaveCount(0);
  });

  test("a deadline inside eight weeks also states the weekly figure", async ({
    page,
  }) => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 30);
    const targetDate = soon.toISOString().slice(0, 10);

    await openWith(
      page,
      [{ ...DATED_PROJECT, target_date: targetDate }],
      [
        {
          project_id: 1,
          required_monthly_cents: 100_000,
          actual_monthly_cents: 100_000,
          status: "good",
        },
      ]
    );

    await page.getByTestId("project-expand-toggle").click();

    await expect(page.getByTestId("project-pace-weekly")).toContainText(
      "That's about $230.77/wk"
    );
  });

  test("multiple projects each read their own pace row", async ({ page }) => {
    await openWith(
      page,
      [DATED_PROJECT, UNDATED_PROJECT],
      [
        {
          project_id: 1,
          required_monthly_cents: 100_000,
          actual_monthly_cents: 50_000,
          status: "over",
        },
        {
          project_id: 2,
          required_monthly_cents: null,
          actual_monthly_cents: null,
          status: "neutral",
        },
      ]
    );

    const badges = page.getByTestId("project-status-badge");
    await expect(badges.nth(0)).toContainText("Off track");
    await expect(badges.nth(1)).toContainText("$6,000.00 to go");
  });
});

test.describe("AI advisory when a project is off track", () => {
  const OFF_TRACK_PROJECT: MockSeedProject = {
    id: 1,
    name: "Car down payment",
    target_cents: 600_000,
    target_date: "2027-06-01",
  };

  const OFF_TRACK_PACE: MockPace = {
    project_id: 1,
    required_monthly_cents: 100_000,
    actual_monthly_cents: 50_000,
    status: "over",
  };

  async function openDetail(
    page: Page,
    pace: MockPace,
    aiConfigured: boolean,
    adviceOutcome: "success" | "error" = "success",
    project: MockSeedProject = OFF_TRACK_PROJECT,
    premium: MockPremium = { granted: false }
  ) {
    await setupTauriMock(
      page,
      [],
      SURPLUS_CENTS,
      [],
      null,
      [project],
      [pace],
      aiConfigured,
      adviceOutcome,
      premium
    );
    await page.goto("/wealth/projects");
    await expect(page.getByTestId("project-row")).toHaveCount(1);
    await page.getByTestId("project-expand-toggle").click();
    await expect(page.getByTestId("project-detail")).toBeVisible();
  }

  test("an off-track project with AI configured renders a headline, body and tone badge on click", async ({
    page,
  }) => {
    await openDetail(page, OFF_TRACK_PACE, true);

    const button = page.getByTestId("project-advice-button");
    await expect(button).toContainText("What would get this back on track?");
    // Nothing is generated until the click: the panel does not exist on expand.
    await expect(page.getByTestId("project-advice-panel")).toHaveCount(0);

    await button.click();

    await expect(page.getByTestId("project-advice-headline")).toContainText(
      "Redirect $250 a month to stay on schedule."
    );
    await expect(page.getByTestId("project-advice-body")).toContainText(
      "Groceries ran $150 over target"
    );
    await expect(page.getByTestId("project-advice-tone")).toContainText(
      "Car down payment"
    );
  });

  test("a project behind but not off track can still ask", async ({ page }) => {
    await openDetail(page, { ...OFF_TRACK_PACE, status: "caution" }, true);

    await expect(page.getByTestId("project-advice-button")).toBeVisible();
  });

  test("an on-track project renders no advisory button at all", async ({ page }) => {
    await openDetail(
      page,
      { ...OFF_TRACK_PACE, actual_monthly_cents: 100_000, status: "good" },
      true
    );

    await expect(page.getByTestId("project-advice-button")).toHaveCount(0);
  });

  test("a project the backend would not judge renders no advisory button", async ({
    page,
  }) => {
    await openDetail(
      page,
      {
        project_id: 1,
        required_monthly_cents: null,
        actual_monthly_cents: null,
        status: "neutral",
      },
      true
    );

    await expect(page.getByTestId("project-advice-button")).toHaveCount(0);
  });

  test("with no AI configured the click explains itself and calls no provider", async ({
    page,
  }) => {
    await openDetail(page, OFF_TRACK_PACE, false);

    await page.getByTestId("project-advice-button").click();

    await expect(
      page.getByTestId("project-advice-not-configured")
    ).toContainText("Set up statement reading");
    await expect(page.getByTestId("project-advice-settings-link")).toBeVisible();
    await expect(page.getByTestId("project-advice-panel")).toHaveCount(0);

    const invoked = await page.evaluate(
      () => (window as unknown as { __INVOKE_LOG__: string[] }).__INVOKE_LOG__
    );
    expect(invoked).not.toContain("generate_project_advice");
  });

  test("a premium account with no BYO key gets advice without being asked for credentials", async ({
    page,
  }) => {
    // Given a signed-in premium cloud account and no provider credentials on this machine
    await openDetail(page, OFF_TRACK_PACE, false, "success", OFF_TRACK_PROJECT, {
      granted: true,
    });

    // When the advisory is asked for
    await page.getByTestId("project-advice-button").click();

    // Then the hosted-first backend answers
    await expect(page.getByTestId("project-advice-headline")).toContainText(
      "Redirect $250 a month to stay on schedule."
    );
    // And the setup prompt for a personal key never appears
    await expect(page.getByTestId("project-advice-not-configured")).toHaveCount(0);

    const invoked = await page.evaluate(
      () => (window as unknown as { __INVOKE_LOG__: string[] }).__INVOKE_LOG__
    );
    expect(invoked).toContain("generate_project_advice");
  });

  // Held unresolved for the whole test rather than released on a timer: a timed release races the
  // page load and the row expansion, so the "during resolution" assertions could run after the
  // answer had already landed and pass for the wrong reason. The resolving -> available transition
  // is covered deterministically by the useAiConfig unit suite, and the resolved behavior by the
  // premium/no-BYO test above.
  test("a click cannot be lost or misexplained while the premium entitlement is still resolving", async ({
    page,
  }) => {
    // Given a premium account with no BYO key whose entitlement read has not answered
    await openDetail(page, OFF_TRACK_PACE, false, "success", OFF_TRACK_PROJECT, {
      granted: true,
      delayMs: 30_000,
    });

    // When the user reaches the action before that answer arrives
    const button = page.getByTestId("project-advice-button");

    // Then it refuses the click outright rather than accepting one it would discard, and it does not
    // pre-emptively explain the refusal with a personal-key card this account has no use for
    await expect(button).toBeDisabled();
    await expect(page.getByTestId("project-advice-not-configured")).toHaveCount(0);
    await expect(page.getByTestId("project-advice-panel")).toHaveCount(0);
    expect(await adviceCallCount(page)).toBe(0);

    // And the deterministic pace UI beside it is untouched by the pending AI read
    await expect(page.getByTestId("project-pace-line")).toBeVisible();
  });

  test("a provider failure offers a retry and leaves the deterministic pace UI intact", async ({
    page,
  }) => {
    await openDetail(page, OFF_TRACK_PACE, true, "error");

    await page.getByTestId("project-advice-button").click();

    await expect(page.getByTestId("project-advice-error")).toContainText(
      "The suggestion couldn't be generated"
    );
    await expect(page.getByTestId("project-advice-retry")).toBeVisible();

    await expect(page.getByTestId("project-status-badge")).toContainText(
      "Off track · $1,000.00/mo"
    );
    await expect(page.getByTestId("project-pace-line")).toContainText(
      "$1,000.00/mo to reach $6,000.00 by Jun 1, 2027"
    );
  });

  // AC #4: the request may contain nothing the backend did not itself read. Any budget-shaped
  // argument here would mean the frontend had a say in which category gets named.
  test("the request carries only pace figures, never budget data", async ({
    page,
  }) => {
    await openDetail(page, OFF_TRACK_PACE, true);

    await page.getByTestId("project-advice-button").click();
    await expect(page.getByTestId("project-advice-panel")).toBeVisible();

    const calls = await page.evaluate(
      () =>
        (window as unknown as { __ADVICE_CALLS__: Record<string, unknown>[] })
          .__ADVICE_CALLS__
    );

    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0]).sort()).toEqual([
      "actual_monthly_cents",
      "locale",
      "months_to_target",
      "project_name",
      "remaining_cents",
      "required_monthly_cents",
    ]);
    expect(calls[0].remaining_cents).toBe(600_000);
    expect(calls[0].required_monthly_cents).toBe(100_000);
    expect(calls[0].actual_monthly_cents).toBe(50_000);
  });

  test("re-clicking after a failure is the retry path", async ({ page }) => {
    await openDetail(page, OFF_TRACK_PACE, true, "error");

    await page.getByTestId("project-advice-button").click();
    await expect(page.getByTestId("project-advice-error")).toBeVisible();

    await page.getByTestId("project-advice-retry").click();

    const calls = await page.evaluate(
      () =>
        (window as unknown as { __ADVICE_CALLS__: Record<string, unknown>[] })
          .__ADVICE_CALLS__
    );
    expect(calls).toHaveLength(2);
  });

  async function adviceCallCount(page: Page) {
    return page.evaluate(
      () =>
        (window as unknown as { __ADVICE_CALLS__: Record<string, unknown>[] })
          .__ADVICE_CALLS__.length
    );
  }

  const HEADLINE = "Redirect $250 a month to stay on schedule.";

  test("collapsing and re-expanding replays the cached answer with no second provider call", async ({
    page,
  }) => {
    await openDetail(page, OFF_TRACK_PACE, true);

    await page.getByTestId("project-advice-button").click();
    await expect(page.getByTestId("project-advice-headline")).toContainText(
      HEADLINE
    );
    expect(await adviceCallCount(page)).toBe(1);

    await page.getByTestId("project-expand-toggle").click();
    await expect(page.getByTestId("project-detail")).toHaveCount(0);

    await page.getByTestId("project-expand-toggle").click();

    // Straight from the cache on a fresh mount: no click, and the panel is already there.
    await expect(page.getByTestId("project-advice-panel")).toBeVisible();
    await expect(page.getByTestId("project-advice-headline")).toContainText(
      HEADLINE
    );
    await expect(page.getByTestId("project-advice-body")).toContainText(
      "Groceries ran $150 over target"
    );
    expect(await adviceCallCount(page)).toBe(1);
  });

  test("logging a contribution evicts the cached advice so the next click regenerates", async ({
    page,
  }) => {
    await openDetail(page, OFF_TRACK_PACE, true);

    await page.getByTestId("project-advice-button").click();
    await expect(page.getByTestId("project-advice-panel")).toBeVisible();
    expect(await adviceCallCount(page)).toBe(1);

    await page.getByTestId("add-contribution-button").click();
    const form = page.getByTestId("project-contribution-form");
    await expect(form).toBeVisible();
    await form.getByLabel("Money is sitting in").click();
    await page.getByRole("option", { name: "Chequing — RBC" }).click();
    await form.getByLabel("Amount").fill("500.00");
    await form.getByRole("button", { name: "Log contribution" }).click();
    await expect(page.getByTestId("contribution-slide-over")).not.toBeVisible();
    await expect(page.getByTestId("contribution-history")).toBeVisible();

    // Invalidation must never spend a provider call by itself — asking stays a user action.
    expect(await adviceCallCount(page)).toBe(1);

    await page.getByTestId("project-advice-button").click();
    await expect(page.getByTestId("project-advice-panel")).toBeVisible();
    expect(await adviceCallCount(page)).toBe(2);
  });

  test("re-clicking with an answer already showing regenerates it", async ({
    page,
  }) => {
    await openDetail(page, OFF_TRACK_PACE, true);

    await page.getByTestId("project-advice-button").click();
    await expect(page.getByTestId("project-advice-panel")).toBeVisible();
    expect(await adviceCallCount(page)).toBe(1);

    await page.getByTestId("project-advice-button").click();
    await expect(page.getByTestId("project-advice-panel")).toBeVisible();
    expect(await adviceCallCount(page)).toBe(2);
  });
});

/** One entry per native picker round trip, which is the only trace a dismissal leaves. */
async function pickerCalls(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as Record<string, (string | null)[]>)
        .__PICKER_CALLS__ ?? []
  );
}

/** How far the document can scroll sideways. Anything above zero is a layout escape. */
async function horizontalOverflowPx(page: Page) {
  return page.evaluate(() => {
    const root = document.scrollingElement;
    if (root === null) throw new Error("the document has no scrolling element");
    return root.scrollWidth - root.clientWidth;
  });
}

test.describe("Project image editing from the row thumbnail", () => {
  const IMAGE_PROJECT: MockSeedProject = {
    id: 1,
    name: "Car down payment",
    target_cents: 600_000,
    target_date: null,
  };

  /** A path with a directory component, so a leaked one would be visible in the UI. */
  const PICKED_PATH = "/Users/someone/Pictures/beach-house.png";

  const ADD_NAME = `Add an image for ${IMAGE_PROJECT.name}`;
  const REPLACE_NAME = `Replace the image for ${IMAGE_PROJECT.name}`;

  async function gotoProjects(
    page: Page,
    images: MockImageState,
    seed: MockSeedProject[] = [IMAGE_PROJECT]
  ) {
    await setupTauriMock(
      page,
      [],
      SURPLUS_CENTS,
      [],
      null,
      seed,
      [],
      false,
      "success",
      { granted: false },
      images
    );
    await page.goto("/wealth/projects");
    await expect(page.getByTestId("project-row")).toHaveCount(seed.length);
  }

  /** The one control the whole feature hangs off: the row tile, as a real button. */
  function tileButton(page: Page) {
    return page.getByTestId("project-thumbnail-button");
  }

  // The acceptance criterion the relocation exists for: expansion is financial detail only, and the
  // ~4 MiB payload command is never sent at all — read at the invoke layer, not inferred from the DOM.
  test("an expanded row shows no image panel and reads no full-size payload", async ({
    page,
  }) => {
    await gotoProjects(page, {
      ...NO_IMAGES,
      seed: [seededImage(IMAGE_PROJECT.id, "downpayment.png")],
    });

    await page.getByTestId("project-expand-toggle").click();
    await expect(page.getByTestId("project-detail")).toBeVisible();
    // Anchored on a figure the detail always renders, so the absences below are read after the
    // expansion settled rather than before it started asking for anything.
    await expect(page.getByTestId("project-saved-amount")).toBeVisible();

    await expect(page.getByTestId("project-image-card")).toHaveCount(0);
    await expect(page.getByTestId("project-image")).toHaveCount(0);
    await expect(page.getByTestId("project-image-meta")).toHaveCount(0);
    await expect(page.getByTestId("project-image-add-button")).toHaveCount(0);
    await expect(page.getByTestId("project-image-replace-button")).toHaveCount(0);
    expect(await invokedCommands(page)).not.toContain("get_project_image");

    // The row tile survives the collapse it never depended on.
    await page.getByTestId("project-expand-toggle").click();
    await expect(page.getByTestId("project-detail")).toHaveCount(0);
    await expect(tileButton(page)).toBeVisible();
  });

  test("an empty tile is a real button whose name offers to add an image", async ({
    page,
  }) => {
    await gotoProjects(page, NO_IMAGES);

    const button = tileButton(page);
    await expect(button).toBeVisible();
    // A native <button>, not a div wearing a click handler — which is what makes Enter and Space
    // work without this spec having to re-implement them.
    expect(await button.evaluate((node) => node.tagName)).toBe("BUTTON");
    await expect(page.getByRole("button", { name: ADD_NAME })).toBeVisible();
    await expect(page.getByRole("button", { name: REPLACE_NAME })).toHaveCount(0);

    // The placeholder tile is INSIDE the control now, not a sibling of it.
    await expect(button.getByTestId("project-thumbnail-empty")).toBeVisible();
    await expect(page.getByTestId("project-thumbnail")).toHaveCount(0);
    await expect(page.getByTestId("project-name")).toBeVisible();
  });

  test("a populated tile is a button whose name offers to replace, showing the derivative", async ({
    page,
  }) => {
    await gotoProjects(page, {
      ...NO_IMAGES,
      seed: [seededImage(IMAGE_PROJECT.id, "downpayment.png")],
    });

    await expect(page.getByRole("button", { name: REPLACE_NAME })).toBeVisible();
    await expect(page.getByRole("button", { name: ADD_NAME })).toHaveCount(0);

    const tile = tileButton(page).getByTestId("project-thumbnail");
    // The DERIVATIVE, not the stored picture: this is the assertion a regression that fed the row a
    // full-size payload would fail, which is why the mock keeps three distinct fixtures.
    expect(await tile.getAttribute("src")).toBe(
      `data:image/png;base64,${THUMBNAIL_PNG_BASE64}`
    );
    expect(THUMBNAIL_PNG_BASE64).not.toBe(ONE_PIXEL_PNG_BASE64);
    // Decodable, so this is not silently asserting a broken image.
    await expect
      .poll(async () => await tile.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    // Decorative inside a named control: the button's own name carries the meaning, so an alt would
    // only make a screen reader say the same thing twice.
    expect(await tile.getAttribute("alt")).toBe("");
    await expect(page.getByTestId("project-thumbnail-empty")).toHaveCount(0);

    // Every control the row shipped before the tile became interactive is still there.
    for (const testId of [
      "project-expand-toggle",
      "project-name",
      "project-status-badge",
      "project-row-menu",
      "project-progress-bar",
    ]) {
      await expect(page.getByTestId(testId)).toBeVisible();
    }
  });

  test("the tile carries no shadow, because elevation is for floating layers only", async ({
    page,
  }) => {
    await gotoProjects(page, {
      ...NO_IMAGES,
      seed: [seededImage(IMAGE_PROJECT.id)],
    });

    const shadowed = await tileButton(page).evaluate((root) =>
      [root, ...Array.from(root.querySelectorAll("*"))]
        .map((el) => el.getAttribute("class") ?? "")
        .filter((cls) => /(^|\s)shadow-/.test(cls))
    );
    expect(shadowed).toEqual([]);
  });

  test("clicking an empty tile stores the picked file and the tile becomes the thumbnail", async ({
    page,
  }) => {
    await gotoProjects(page, { ...NO_IMAGES, pickedPath: PICKED_PATH });
    await expect(page.getByTestId("project-thumbnail-empty")).toBeVisible();

    await tileButton(page).click();

    const tile = page.getByTestId("project-thumbnail");
    await expect(tile).toBeVisible();
    expect(await tile.getAttribute("src")).toBe(
      `data:image/png;base64,${THUMBNAIL_PNG_BASE64}`
    );
    // Non-zero only once the browser really decoded those bytes.
    await expect
      .poll(async () =>
        tile.evaluate(
          (node) => node instanceof HTMLImageElement && node.naturalWidth > 0
        )
      )
      .toBe(true);
    expect(await invokedCommands(page)).toContain("set_project_image");
    // The name flips with the state, so the control now offers the other action.
    await expect(page.getByRole("button", { name: REPLACE_NAME })).toBeVisible();
    await expect(page.getByTestId("project-thumbnail-empty")).toHaveCount(0);
    await expect(page.getByTestId("project-image-error")).toHaveCount(0);
    // No directory the file came from may reach the row.
    await expect(page.getByTestId("project-row")).not.toContainText("Pictures");
  });

  test("the tile is operable by keyboard and replaces the stored image", async ({
    page,
  }) => {
    await gotoProjects(page, {
      ...NO_IMAGES,
      seed: [seededImage(IMAGE_PROJECT.id, "original.png")],
      pickedPath: PICKED_PATH,
    });

    // `press` focuses the element and dispatches a real key: a div with an onClick handler would
    // not open the picker here, which is the whole point of the control being a button.
    await tileButton(page).press("Enter");

    await expect.poll(async () => await pickerCalls(page)).toEqual([PICKED_PATH]);
    await expect
      .poll(async () => await invokedCommands(page))
      .toContain("set_project_image");
    await expect(tileButton(page).getByTestId("project-thumbnail")).toBeVisible();
    await expect(page.getByTestId("project-image-error")).toHaveCount(0);
  });

  test("a dismissed picker writes nothing and leaves the tile unchanged", async ({
    page,
  }) => {
    await gotoProjects(page, {
      ...NO_IMAGES,
      seed: [seededImage(IMAGE_PROJECT.id)],
    });
    const tile = page.getByTestId("project-thumbnail");
    const srcBefore = await tile.getAttribute("src");

    await tileButton(page).click();

    // A dismissal changes nothing on screen, so the picker round trip is the only observable end of
    // the attempt — polling it is what makes the absence below a settled reading, not a race.
    await expect.poll(async () => (await pickerCalls(page)).length).toBe(1);
    expect(await invokedCommands(page)).not.toContain("set_project_image");
    expect(await tile.getAttribute("src")).toBe(srcBefore);
    await expect(page.getByTestId("project-image-error")).toHaveCount(0);
    await expect(tileButton(page)).toBeEnabled();
  });

  /* Six file-level refusals, six distinct sentences. A shared message would send the user to shrink
   * a file whose type was never supported, or to re-export a photograph that was only too large. */
  const VALIDATOR_REFUSALS = [
    {
      field: "project_image_unsupported_type",
      copy: "That file type can't be used as a project image. Use a PNG or JPEG.",
    },
    { field: "project_image_empty", copy: "That file is empty. Pick another one." },
    {
      field: "project_image_too_large",
      copy: "That image is larger than 4 MB. Pick a smaller one.",
    },
    {
      field: "project_image_unreadable",
      copy: "That file could not be read. Pick another one.",
    },
    {
      field: "project_image_content_mismatch",
      copy: "That file's contents are not a usable PNG or JPEG image.",
    },
    {
      field: "project_image_dimensions",
      copy: "That image is larger than 12 megapixels. Pick a smaller one.",
    },
  ] as const;

  for (const { field, copy } of VALIDATOR_REFUSALS) {
    test(`a ${field} refusal shows its own sentence in the row and never reaches the write`, async ({
      page,
    }) => {
      await gotoProjects(page, {
        ...NO_IMAGES,
        pickedPath: PICKED_PATH,
        validateRejectField: field,
      });

      await tileButton(page).click();

      await expect(page.getByTestId("project-image-error")).toHaveText(copy);
      // Validation runs before any write, so a refused file costs nothing and stores nothing.
      expect(await invokedCommands(page)).not.toContain("set_project_image");
      await expect(page.getByTestId("project-thumbnail-empty")).toBeVisible();
      await expect(page.getByTestId("project-thumbnail")).toHaveCount(0);
    });
  }

  // The seventh refusal, and the only one that is about the project rather than the file — so it is
  // unreachable from the validator and can only be observed on the write.
  test("a write the archived-project guard refuses says the project is unavailable", async ({
    page,
  }) => {
    await gotoProjects(page, {
      ...NO_IMAGES,
      pickedPath: PICKED_PATH,
      writeRejectField: "project_id",
    });

    await tileButton(page).click();

    await expect(page.getByTestId("project-image-error")).toHaveText(
      "This project is no longer available."
    );
    // The file passed validation, so unlike the six above this refusal did reach the write.
    await expect
      .poll(async () => await invokedCommands(page))
      .toContain("set_project_image");
    await expect(page.getByTestId("project-thumbnail-empty")).toBeVisible();
    await expect(page.getByTestId("project-thumbnail")).toHaveCount(0);
  });

  test("a failed replace leaves the original thumbnail byte-for-byte on screen", async ({
    page,
  }) => {
    await gotoProjects(page, {
      ...NO_IMAGES,
      seed: [seededImage(IMAGE_PROJECT.id, "original.png")],
      pickedPath: PICKED_PATH,
      writeRejectField: "project_id",
    });

    const tile = page.getByTestId("project-thumbnail");
    await expect(tile).toBeVisible();
    const srcBefore = await tile.getAttribute("src");
    expect(srcBefore).toBe(`data:image/png;base64,${THUMBNAIL_PNG_BASE64}`);

    await tileButton(page).click();

    await expect(page.getByTestId("project-image-error")).toBeVisible();
    await expect
      .poll(async () => await invokedCommands(page))
      .toContain("set_project_image");
    expect(await tile.getAttribute("src")).toBe(srcBefore);
    await expect(page.getByRole("button", { name: REPLACE_NAME })).toBeVisible();
    await expect(page.getByTestId("project-thumbnail-empty")).toHaveCount(0);
  });

  test("Remove image lives only in the row menu, never beside the tile", async ({
    page,
  }) => {
    await gotoProjects(page, {
      ...NO_IMAGES,
      seed: [seededImage(IMAGE_PROJECT.id)],
    });

    // Nothing destructive is a peer of the tile: the row's own controls are the tile, the expand
    // toggle, the two move buttons and the actions trigger — no Remove among them.
    await expect(page.getByRole("button", { name: /Remove/i })).toHaveCount(0);
    await expect(
      page.getByRole("menuitem", { name: "Remove image" })
    ).toHaveCount(0);

    await page.getByTestId("project-row-menu").click();

    const remove = page.getByRole("menuitem", { name: "Remove image" });
    await expect(remove).toBeVisible();
    // Demoted BELOW the two pre-existing items rather than promoted above them.
    const menuOrder = await page
      .getByRole("menu")
      .evaluate((menu) =>
        Array.from(menu.querySelectorAll("[data-testid]")).map((node) =>
          node.getAttribute("data-testid")
        )
      );
    expect(menuOrder).toEqual([
      "edit-project-button",
      "remove-project-image-button",
      "archive-project-button",
    ]);
    // Portaled out of the row, which is what "not a sibling of the tile" means structurally.
    await expect(
      page.getByTestId("project-row").getByTestId("remove-project-image-button")
    ).toHaveCount(0);
  });

  test("a project with no image offers no removal at all", async ({ page }) => {
    await gotoProjects(page, NO_IMAGES);

    await page.getByTestId("project-row-menu").click();

    await expect(page.getByTestId("edit-project-button")).toBeVisible();
    await expect(page.getByTestId("archive-project-button")).toBeVisible();
    await expect(page.getByTestId("remove-project-image-button")).toHaveCount(0);
    await expect(
      page.getByRole("menuitem", { name: "Remove image" })
    ).toHaveCount(0);
  });

  test("removing an image takes a confirmation, then the empty tile comes back", async ({
    page,
  }) => {
    await gotoProjects(page, {
      ...NO_IMAGES,
      seed: [seededImage(IMAGE_PROJECT.id)],
      pickedPath: PICKED_PATH,
      validateRejectField: "project_image_too_large",
    });
    await expect(page.getByTestId("project-thumbnail")).toBeVisible();

    // Raise a real refusal first, so the "no error remains" assertion at the end cannot pass
    // vacuously on a fixture that never displayed one.
    await tileButton(page).click();
    await expect(page.getByTestId("project-image-error")).toHaveText(
      "That image is larger than 4 MB. Pick a smaller one."
    );

    await page.getByTestId("project-row-menu").click();
    await page.getByRole("menuitem", { name: "Remove image" }).click();

    const dialog = page.getByTestId("remove-project-image-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Remove this image?");
    // Opening the confirmation deletes nothing: the destructive call may only follow the second act.
    expect(await invokedCommands(page)).not.toContain("remove_project_image");
    await expect(page.getByTestId("project-thumbnail")).toBeVisible();

    await page.getByTestId("confirm-remove-project-image-button").click();

    await expect(dialog).not.toBeVisible();
    await expect(page.getByTestId("project-thumbnail-empty")).toBeVisible();
    await expect(page.getByTestId("project-thumbnail")).toHaveCount(0);
    await expect(page.getByRole("button", { name: ADD_NAME })).toBeVisible();
    await expect(page.getByTestId("project-image-error")).toHaveCount(0);
    expect(await invokedCommands(page)).toContain("remove_project_image");
  });

  test("dismissing the confirmation deletes nothing", async ({ page }) => {
    await gotoProjects(page, {
      ...NO_IMAGES,
      seed: [seededImage(IMAGE_PROJECT.id)],
    });

    await page.getByTestId("project-row-menu").click();
    await page.getByRole("menuitem", { name: "Remove image" }).click();
    await expect(page.getByTestId("remove-project-image-dialog")).toBeVisible();

    await page
      .getByTestId("remove-project-image-dialog")
      .getByRole("button", { name: "Cancel" })
      .click();

    await expect(
      page.getByTestId("remove-project-image-dialog")
    ).not.toBeVisible();
    expect(await invokedCommands(page)).not.toContain("remove_project_image");
    await expect(page.getByTestId("project-thumbnail")).toBeVisible();
  });

  test("a refused removal keeps the thumbnail and surfaces the existing copy", async ({
    page,
  }) => {
    await gotoProjects(page, {
      ...NO_IMAGES,
      seed: [seededImage(IMAGE_PROJECT.id)],
      removeRejectField: "project_id",
    });
    const tile = page.getByTestId("project-thumbnail");
    const srcBefore = await tile.getAttribute("src");

    await page.getByTestId("project-row-menu").click();
    await page.getByRole("menuitem", { name: "Remove image" }).click();
    await page.getByTestId("confirm-remove-project-image-button").click();

    await expect(page.getByTestId("project-image-error")).toHaveText(
      "This project is no longer available."
    );
    await expect(
      page.getByTestId("remove-project-image-dialog")
    ).not.toBeVisible();
    expect(await tile.getAttribute("src")).toBe(srcBefore);
    await expect(page.getByTestId("project-thumbnail-empty")).toHaveCount(0);
  });

  test("every control the row exposes has its own non-empty accessible name", async ({
    page,
  }) => {
    await gotoProjects(page, {
      ...NO_IMAGES,
      seed: [seededImage(IMAGE_PROJECT.id)],
    });

    // `ariaSnapshot` renders Playwright's own computed accessible name, so an unnamed control shows
    // up as a bare `- button` with no quoted string — which is exactly what this rejects.
    const namesInside = async (region: ReturnType<Page["getByTestId"]>) => {
      const lines = (await region.ariaSnapshot()).split("\n");
      return lines
        .map((line) => /^\s*-\s+(button|link|menuitem|checkbox|textbox)\b(.*)$/.exec(line))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => ({ role: match[1], rest: match[2].trim() }));
    };

    const rowControls = await namesInside(page.getByTestId("project-row"));
    expect(rowControls.length).toBeGreaterThan(1);
    for (const control of rowControls) {
      expect(control.rest, `${control.role} in the row has no accessible name`).toMatch(
        /^"[^"]+"/
      );
    }

    // Non-empty is not enough: the tile now sits beside the expand toggle, the move controls and the
    // actions trigger, and two controls announcing the identical name leaves a screen-reader user
    // unable to tell them apart. Only the quoted name is compared — ARIA state suffixes like
    // `[expanded]` would otherwise make two identically-named triggers look distinct.
    const rowNames = rowControls
      .map((control) => /^"([^"]+)"/.exec(control.rest)?.[1])
      .filter((name): name is string => name !== undefined);
    expect(
      new Set(rowNames).size,
      `duplicate accessible names in the row: ${rowNames.join(" | ")}`
    ).toBe(rowNames.length);
    expect(rowNames).toContain(REPLACE_NAME);

    await page.getByTestId("project-row-menu").click();
    const menuControls = await namesInside(
      page.getByTestId("remove-project-image-button")
    );
    expect(menuControls.length).toBeGreaterThan(0);
    for (const control of menuControls) {
      expect(control.rest, `${control.role} in the menu has no accessible name`).toMatch(
        /^"[^"]+"/
      );
    }
  });

  test("the collapsed list reads thumbnails once for every row and no full-size payload", async ({
    page,
  }) => {
    const rows: MockSeedProject[] = [1, 2, 3].map((id) => ({
      id,
      name: `Goal ${id}`,
      target_cents: 400_000,
      target_date: null,
    }));
    await gotoProjects(
      page,
      { ...NO_IMAGES, seed: rows.map((row) => seededImage(row.id)) },
      rows
    );

    await expect(page.getByTestId("project-thumbnail")).toHaveCount(rows.length);
    const commands = await invokedCommands(page);
    // ONE batch read regardless of row count — three rows, one call. A per-row read would be 3, and
    // so would a tile that reached for the full-size command to decide what to draw.
    expect(
      commands.filter((command) => command === "get_project_thumbnails")
    ).toHaveLength(1);
    expect(commands).not.toContain("get_project_image");
  });

  /* Ten rows expanded at once, which is the shape a real list takes because each row owns its own
   * `expanded` flag and nothing collapses its neighbours. */
  test("ten expanded rows keep their tiles, read no payload, and leave the page interactive", async ({
    page,
  }) => {
    const seeded = Array.from({ length: 10 }, (_, index) => ({
      id: index + 1,
      name: `Goal ${index + 1}`,
      target_cents: 100_000 * (index + 1),
      target_date: null,
    }));
    await gotoProjects(
      page,
      {
        ...NO_IMAGES,
        seed: seeded.map((project) =>
          seededImage(project.id, `goal-${project.id}.png`)
        ),
      },
      seeded
    );

    const toggles = page.getByTestId("project-expand-toggle");
    for (let index = 0; index < seeded.length; index += 1) {
      await toggles.nth(index).click();
    }
    await expect(page.getByTestId("project-detail")).toHaveCount(seeded.length);

    const tiles = page.getByTestId("project-thumbnail");
    await expect(tiles).toHaveCount(seeded.length);
    // `naturalWidth` rather than mere presence: it is only non-zero once the browser really decoded
    // that row's own data URL.
    await expect
      .poll(async () =>
        tiles.evaluateAll((nodes) =>
          nodes.map(
            (node) =>
              node instanceof HTMLImageElement &&
              node.naturalWidth > 0 &&
              (node.getAttribute("src") ?? "").startsWith(
                "data:image/png;base64,"
              )
          )
        )
      )
      .toEqual(seeded.map(() => true));
    // Ten expanded rows, and not one of them asked for a full-size payload.
    expect(await invokedCommands(page)).not.toContain("get_project_image");
    // Ten distinct accessible names, so no two tiles are addressing one shared project.
    const tileNames = await tileButton(page).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-label"))
    );
    expect(new Set(tileNames).size).toBe(seeded.length);

    expect(await horizontalOverflowPx(page)).toBeLessThanOrEqual(0);

    await page.getByTestId("add-project-button").click();
    await expect(page.getByTestId("project-form")).toBeVisible();
  });

  test("at the minimum window the row holds its shape with no sideways scroll", async ({
    page,
  }) => {
    // The `minWidth`/`minHeight` the app ships in `tauri.conf.json`, so this is the narrowest window
    // a user can actually produce.
    await page.setViewportSize({ width: 1024, height: 680 });
    await gotoProjects(page, {
      ...NO_IMAGES,
      seed: [seededImage(IMAGE_PROJECT.id)],
      pickedPath: PICKED_PATH,
      validateRejectField: "project_image_too_large",
    });
    await expect(page.getByTestId("project-thumbnail")).toBeVisible();

    await page.getByTestId("project-expand-toggle").click();
    await expect(page.getByTestId("project-detail")).toBeVisible();
    expect(await horizontalOverflowPx(page)).toBeLessThanOrEqual(0);

    // The tile keeps the geometry the list gives it, at the size the row shipped with.
    const box = await tileButton(page).boundingBox();
    expect(box?.width).toBe(56);
    expect(box?.height).toBe(56);

    // A refusal is a full-width block below the meter, so it cannot squeeze the header either.
    await tileButton(page).click();
    await expect(page.getByTestId("project-image-error")).toBeVisible();
    expect(await horizontalOverflowPx(page)).toBeLessThanOrEqual(0);
  });

  // Committed rather than run as a throwaway probe, because visual evidence nobody can regenerate is
  // not evidence. Every artifact below is reproducible with:
  //   pnpm --filter @nixus/desktop exec playwright test tests/projects.spec.ts -g "visual evidence"
  test("visual evidence: the row tile settles correctly in both themes", async ({
    page,
  }) => {
    const EVIDENCE = "../../.omo/evidence";
    await page.setViewportSize({ width: 1024, height: 680 });

    await gotoProjects(
      page,
      { ...NO_IMAGES, seed: [seededImage(1, "downpayment.png")] },
      [
        { id: 1, name: "BC Trip", target_cents: 500_000, target_date: "2027-06-01" },
        { id: 2, name: "New Summer Car", target_cents: 4_000_000, target_date: null },
      ]
    );

    // A real tile on the project that has a picture, a placeholder on the one that does not, both
    // interactive, and NO full-size read for either.
    await expect(page.getByTestId("project-thumbnail")).toHaveCount(1);
    await expect(page.getByTestId("project-thumbnail-empty")).toHaveCount(1);
    await expect(tileButton(page)).toHaveCount(2);
    expect(await invokedCommands(page)).not.toContain("get_project_image");

    const tile = tileButton(page).first();
    const styles = () =>
      tile.evaluate((node) => {
        const computed = getComputedStyle(node);
        return {
          background: computed.backgroundColor,
          outlineStyle: computed.outlineStyle,
          outlineWidth: computed.outlineWidth,
          focusVisible: node.matches(":focus-visible"),
        };
      });

    const lightBackground = (await styles()).background;
    await page.screenshot({
      path: `${EVIDENCE}/visual-row-thumbnails-light.png`,
      animations: "disabled",
    });

    await page.evaluate(() => document.documentElement.classList.add("dark"));
    // `transition-colors` means a screenshot taken now catches a frame partway through the fade,
    // which is how an earlier capture ended up showing a light tile on a dark row. Waiting for the
    // settled token is what makes the artifact deterministic rather than timing-dependent.
    await expect.poll(async () => (await styles()).background).not.toBe(lightBackground);
    await page.screenshot({
      path: `${EVIDENCE}/visual-row-thumbnails-dark.png`,
      animations: "disabled",
    });

    // Keyboard, never `.focus()`: programmatic focus does not satisfy `:focus-visible`, so a ring
    // captured that way is absent and the artifact would assert something untrue.
    // Forward-only: Shift+Tab then Tab is net-zero movement, so it parks on whatever already had
    // focus instead of walking the tab order until the tile is reached.
    for (let attempt = 0; attempt < 60 && !(await styles()).focusVisible; attempt += 1) {
      await page.keyboard.press("Tab");
    }
    const focused = await styles();
    expect(focused.focusVisible, "keyboard focus must reach the tile").toBe(true);
    // Presence and geometry only. The ring's COLOUR resolves from a pre-existing app-wide token bug
    // in packages/shared, outside this feature, so asserting it here would pin someone else's defect.
    expect(focused.outlineStyle).toBe("solid");
    expect(focused.outlineWidth).toBe("2px");
    await page.screenshot({
      path: `${EVIDENCE}/visual-row-thumbnail-dark-focus-ring.png`,
      animations: "disabled",
    });

    expect(await horizontalOverflowPx(page)).toBeLessThanOrEqual(0);
  });
});
