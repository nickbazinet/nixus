import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import {
  PROJECT_IMAGE_EXTENSIONS,
  useProjectImagePicker,
  type ProjectImagePickerState,
  type ProjectImagePickOutcome,
} from "@/hooks/useProjectImagePicker";
import {
  useProjectImage,
  useRemoveProjectImage,
  useSetProjectImage,
} from "@/hooks/useProjects";
import { projectImageMessageKey } from "@/lib/appError";
import { queryKeys } from "@/lib/constants";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const invokeMock = vi.fn();
const openMock = vi.fn();
const recordedQueryOptions: Record<string, unknown>[] = [];

/* A sentinel value, not the shipped English string: an assertion against "Images" would still
 * pass if the label were hardcoded, which is exactly the regression this pins. */
const LOCALIZED_FILTER_LABEL = "«localized images»";
const TRANSLATIONS: Record<string, string> = {
  "projects.image.filterName": LOCALIZED_FILTER_LABEL,
};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => openMock(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => TRANSLATIONS[key] ?? key }),
}));

/* The real module, with `useQuery` wrapped so the options object the hook builds can be read
 * directly. Spying rather than stubbing keeps the actual client behaviour, which is what lets the
 * retry assertion below be a behavioural test instead of another options check. */
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  const realUseQuery = actual.useQuery as unknown as (
    options: Record<string, unknown>
  ) => unknown;
  return {
    ...actual,
    useQuery: (options: Record<string, unknown>) => {
      recordedQueryOptions.push(options);
      return realUseQuery(options);
    },
  };
});

const EN = en as Record<string, string>;
const FR = fr as Record<string, string>;
const PICKED_PATH = "/Users/tester/Pictures/2026/kitchen.png";
const GENERIC_FAILURE_KEY = "projects.image.saveFailed";

/** Arguments of one command, so an assertion never depends on the order of unrelated IPC. */
function callsOf(command: string): Record<string, unknown>[] {
  return invokeMock.mock.calls
    .filter((call) => call[0] === command)
    .map((call) => (call[1] ?? {}) as Record<string, unknown>);
}

describe("useProjectImagePicker", () => {
  let state: ProjectImagePickerState;
  let container: HTMLDivElement;
  let root: Root;

  function Harness() {
    state = useProjectImagePicker();
    return null;
  }

  async function pick(): Promise<ProjectImagePickOutcome> {
    let outcome: ProjectImagePickOutcome = "cancelled";
    await act(async () => {
      outcome = await state.pick();
    });
    return outcome;
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
    openMock.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(<Harness />);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("reports a validated pick as selected, carrying the basename the backend returned", async () => {
    // Given the picker returns a nested path and validation accepts it
    openMock.mockResolvedValue(PICKED_PATH);
    invokeMock.mockResolvedValue("kitchen.png");

    // When the user picks that file
    const outcome = await pick();

    // Then the selection is the path plus the bare basename, with nothing to report
    expect(outcome).toBe("selected");
    expect(state.picked).toEqual({ path: PICKED_PATH, name: "kitchen.png" });
    expect(state.errorKey).toBeNull();
    expect(callsOf("validate_project_image")).toEqual([
      { file_path: PICKED_PATH },
    ]);
  });

  it("reports a dismissed dialog as cancelled without validating anything", async () => {
    // Given the user dismisses the native dialog
    openMock.mockResolvedValue(null);

    // When the pick settles
    const outcome = await pick();

    // Then nothing was validated and no state moved
    expect(outcome).toBe("cancelled");
    expect(state.picked).toBeNull();
    expect(state.errorKey).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  /* The dialog plugin rejects when the native window cannot be opened or is torn down. Swallowed,
   * the add button would look inert with nothing explaining why. */
  it("reports a rejected native dialog as a generic refusal, never as a file problem", async () => {
    // Given the native dialog cannot open
    openMock.mockRejectedValue(new Error("dialog unavailable"));

    // When the user tries to pick
    const outcome = await pick();

    // Then the failure is generic: no file was reached, so no file-specific message is honest
    expect(outcome).toBe("refused");
    expect(state.errorKey).toBe(GENERIC_FAILURE_KEY);
    expect(state.errorKey).not.toBe("projects.image.unreadable");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("surfaces a validation refusal under its own localized key before any write", async () => {
    // Given the validator refuses a disguised file
    openMock.mockResolvedValue(PICKED_PATH);
    invokeMock.mockRejectedValue({
      type: "validation",
      message: "refused",
      field: "project_image_content_mismatch",
    });

    // When the user picks it
    const outcome = await pick();

    // Then the refusal is reported and no write command was ever sent
    expect(outcome).toBe("refused");
    expect(state.errorKey).toBe("projects.image.contentMismatch");
    expect(state.picked).toBeNull();
    expect(callsOf("set_project_image")).toEqual([]);
  });

  it("falls back to a generic failure when a rejection carries no field it knows", async () => {
    openMock.mockResolvedValue(PICKED_PATH);
    invokeMock.mockRejectedValue({ type: "database", message: "locked" });

    expect(await pick()).toBe("refused");

    expect(state.errorKey).toBe(GENERIC_FAILURE_KEY);
  });

  /* A cancel must not clear a standing refusal: that message explains a failure the dismissed
   * dialog did nothing about. */
  it("preserves a standing refusal across a cancelled picker", async () => {
    // Given a refusal is on screen
    openMock.mockResolvedValue(PICKED_PATH);
    invokeMock.mockRejectedValue({
      type: "validation",
      message: "refused",
      field: "project_image_too_large",
    });
    await pick();
    expect(state.errorKey).toBe("projects.image.tooLarge");

    // When the user opens the picker again and dismisses it
    openMock.mockResolvedValue(null);
    const outcome = await pick();

    // Then the refusal is still there
    expect(outcome).toBe("cancelled");
    expect(state.errorKey).toBe("projects.image.tooLarge");
  });

  it("clears a standing refusal once a later pick is accepted", async () => {
    // Given a refusal is on screen
    openMock.mockResolvedValue(PICKED_PATH);
    invokeMock.mockRejectedValue({
      type: "validation",
      message: "refused",
      field: "project_image_dimensions",
    });
    await pick();
    expect(state.errorKey).toBe("projects.image.dimensions");

    // When the next pick validates
    invokeMock.mockReset();
    invokeMock.mockResolvedValue("kitchen.png");
    const outcome = await pick();

    // Then the stale refusal is gone
    expect(outcome).toBe("selected");
    expect(state.errorKey).toBeNull();
    expect(state.picked).toEqual({ path: PICKED_PATH, name: "kitchen.png" });
  });

  /* Two clicks land in one tick, so both read the pre-update `picking` state: only the
   * synchronous ref guard stops a second native dialog from opening. */
  it("opens exactly one native dialog when pick is called twice concurrently", async () => {
    let release: (value: string) => void = () => {};
    openMock.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        })
    );
    invokeMock.mockResolvedValue("kitchen.png");

    let first: Promise<ProjectImagePickOutcome> | null = null;
    let second: Promise<ProjectImagePickOutcome> | null = null;
    await act(async () => {
      first = state.pick();
      second = state.pick();
      release(PICKED_PATH);
      await Promise.all([first, second]);
    });

    expect(openMock).toHaveBeenCalledTimes(1);
    expect(callsOf("validate_project_image")).toHaveLength(1);
    if (first === null || second === null) {
      throw new Error("neither pick started");
    }
    expect(await second).toBe("cancelled");
    expect(await first).toBe("selected");
  });

  it("clears picking after a rejected dialog, so one failure does not disable the control", async () => {
    openMock.mockRejectedValue(new Error("dialog unavailable"));

    await pick();

    expect(state.picking).toBe(false);
  });

  it("offers the three accepted extensions under a label resolved through i18n", async () => {
    openMock.mockResolvedValue(null);

    await pick();

    const [options] = openMock.mock.calls[0] as [
      { multiple: boolean; filters: { name: string; extensions: string[] }[] },
    ];
    const [filter] = options.filters;
    expect(options.multiple).toBe(false);
    expect([...filter.extensions].sort()).toEqual(["jpeg", "jpg", "png"]);
    // Translated, so neither a hardcoded English literal nor a raw key passes.
    expect(filter.name).toBe(LOCALIZED_FILTER_LABEL);
    expect(filter.name).not.toBe("projects.image.filterName");
  });

  it("keeps the offered extensions and the exported list in step", () => {
    expect([...PROJECT_IMAGE_EXTENSIONS]).toEqual(["png", "jpg", "jpeg"]);
  });

  it("reset drops both the selection and the refusal", async () => {
    openMock.mockResolvedValue(PICKED_PATH);
    invokeMock.mockResolvedValue("kitchen.png");
    await pick();

    act(() => {
      state.reset();
    });

    expect(state.picked).toBeNull();
    expect(state.errorKey).toBeNull();
  });
});

describe("projectImageMessageKey", () => {
  /* The six literals `projects/image.rs` emits, pinned here so a rename in Rust cannot silently
   * degrade every refusal to the generic message. */
  const VALIDATOR_FIELDS = [
    "project_image_unsupported_type",
    "project_image_empty",
    "project_image_too_large",
    "project_image_unreadable",
    "project_image_content_mismatch",
    "project_image_dimensions",
  ] as const;

  /* The write path's archived/missing-project guard. It describes the PROJECT, not the file. */
  const PROJECT_GUARD_FIELD = "project_id";

  const ALL_FIELDS = [...VALIDATOR_FIELDS, PROJECT_GUARD_FIELD];

  function refusal(field: string) {
    return { type: "validation", message: "refused", field };
  }

  it("gives each of the six validator fields and the project guard its own key", () => {
    const keys = ALL_FIELDS.map((field) => projectImageMessageKey(refusal(field)));

    expect(keys).not.toContain(null);
    expect(new Set(keys).size).toBe(ALL_FIELDS.length);
  });

  it("maps every field to a key that exists in both locales", () => {
    for (const field of ALL_FIELDS) {
      const key = projectImageMessageKey(refusal(field));
      if (key === null) throw new Error(`no key mapped for field "${field}"`);

      expect(EN[key], field).toBeTruthy();
      expect(FR[key], field).toBeTruthy();
    }
  });

  it("distinguishes a corrupt header from an oversized picture", () => {
    expect(projectImageMessageKey(refusal("project_image_content_mismatch"))).toBe(
      "projects.image.contentMismatch"
    );
    expect(projectImageMessageKey(refusal("project_image_dimensions"))).toBe(
      "projects.image.dimensions"
    );
  });

  it("reports the project guard as a project problem, not a file problem", () => {
    expect(projectImageMessageKey(refusal(PROJECT_GUARD_FIELD))).toBe(
      "projects.image.projectUnavailable"
    );
  });

  /* Returning `unreadable` here would tell someone their perfectly good photograph could not be
   * read, sending them to replace a file that was never the problem. */
  it("returns null for anything it does not recognize", () => {
    expect(projectImageMessageKey({ type: "database", message: "locked" })).toBeNull();
    expect(projectImageMessageKey(refusal("amount_cents"))).toBeNull();
    expect(projectImageMessageKey(refusal("constructor"))).toBeNull();
    expect(projectImageMessageKey({ type: "validation", message: "m" })).toBeNull();
    expect(projectImageMessageKey("plain string")).toBeNull();
    expect(projectImageMessageKey(null)).toBeNull();
  });
});

describe("queryKeys.projectImage", () => {
  it("is a per-project key under its own namespace", () => {
    expect(queryKeys.projectImage(7)).toEqual(["project-image", 7]);
  });

  /* A shared root with the projects list would make a list invalidation drag every cached payload
   * back over IPC. */
  it("shares no prefix with the projects list or the contributions key", () => {
    expect(queryKeys.projectImage(7)[0]).not.toBe(queryKeys.projects[0]);
    expect(queryKeys.projectImage(7)[0]).not.toBe(
      queryKeys.projectContributions(7)[0]
    );
  });
});

async function waitUntil(predicate: () => boolean, label: string): Promise<void> {
  // Generous, because the point of the retry assertion is that the hook settles immediately:
  // under a regression react-query's 1s/2s/4s backoff has to be allowed to finish so the failure
  // names the real call count instead of timing out.
  const deadline = Date.now() + 15_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

describe("useProjectImage", () => {
  let query: ReturnType<typeof useProjectImage>;
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  function Harness({ projectId }: { projectId: number }) {
    query = useProjectImage(projectId);
    return null;
  }

  function render(projectId: number) {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Harness projectId={projectId} />
        </QueryClientProvider>
      );
    });
  }

  function imageQueryOptions(): Record<string, unknown> {
    const forImage = recordedQueryOptions.filter((options) => {
      const key = options.queryKey;
      return Array.isArray(key) && key[0] === "project-image";
    });
    const last = forImage[forImage.length - 1];
    if (last === undefined) {
      throw new Error("useQuery was never called for the image");
    }
    return last;
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
    recordedQueryOptions.length = 0;
    // Bare, exactly like `main.tsx:12`. Every other suite in this repo hands its test client
    // `retry: false` defaults; doing that here would mask the hook's own option and leave the
    // single-attempt assertion below unable to fail.
    queryClient = new QueryClient();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
  });

  it("reads one project through the snake_case command", async () => {
    // Given the project has an image
    invokeMock.mockResolvedValue({
      project_id: 7,
      mime_type: "image/png",
      original_filename: "kitchen.png",
      byte_size: 8,
      uploaded_at: "2026-08-01T00:00:00Z",
      image_base64: "iVBORw0KGgo=",
    });

    // When the card mounts
    render(7);
    await waitUntil(() => query.isSuccess, "the image query to resolve");

    // Then the wire contract matches the Rust command signature exactly
    expect(callsOf("get_project_image")).toEqual([{ project_id: 7 }]);
  });

  it("treats a null payload as no picture yet rather than a failure", async () => {
    invokeMock.mockResolvedValue(null);

    render(7);
    await waitUntil(() => !query.isPending, "the image query to settle");

    expect(query.isSuccess).toBe(true);
    expect(query.isError).toBe(false);
    expect(query.data).toBeNull();
  });

  it(
    "attempts the read exactly once when it is refused",
    async () => {
      // Given the backend refuses the read
      invokeMock.mockRejectedValue({ type: "database", message: "locked" });

      // When the card mounts and the query settles
      render(7);
      await waitUntil(() => query.isError, "the image query to settle as an error");

      // Then the refusal was reported once, not retried three more times
      expect(callsOf("get_project_image")).toHaveLength(1);
    },
    25_000
  );

  it("sends the options a bare QueryClient cannot supply on its own", async () => {
    invokeMock.mockResolvedValue(null);

    render(7);
    await waitUntil(() => !query.isPending, "the image query to settle");

    const options = imageQueryOptions();
    expect(options.queryKey).toEqual(queryKeys.projectImage(7));
    expect(options.staleTime).toBe(Infinity);
    expect(options.refetchOnWindowFocus).toBe(false);
    expect(options.gcTime).toBe(60_000);
    expect(options.retry).toBe(false);
    expect(options.enabled).toBe(true);
  });
});

describe("the project image mutations", () => {
  let setImage: ReturnType<typeof useSetProjectImage>;
  let removeImage: ReturnType<typeof useRemoveProjectImage>;
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let invalidateSpy: MockInstance<QueryClient["invalidateQueries"]>;

  function Harness() {
    setImage = useSetProjectImage();
    removeImage = useRemoveProjectImage();
    return null;
  }

  function invalidatedKeys(): unknown[] {
    return invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
    invalidateSpy.mockRestore();
  });

  /* The payload lives in no list response, no saved total, no earmark and no pace figure, so a
   * second invalidation here would assert a data dependency that does not exist. */
  it("sends only a project id and a path, and invalidates only this project's image", async () => {
    // Given the backend stores the file and returns its metadata
    invokeMock.mockResolvedValue({
      project_id: 7,
      mime_type: "image/png",
      original_filename: "kitchen.png",
      byte_size: 8,
      uploaded_at: "2026-08-01T00:00:00Z",
    });

    // When the user saves a picked file
    await act(async () => {
      await setImage.mutateAsync({ project_id: 7, file_path: PICKED_PATH });
    });

    // Then no payload crossed IPC and exactly one key went stale
    expect(callsOf("set_project_image")).toEqual([
      { project_id: 7, file_path: PICKED_PATH },
    ]);
    expect(invalidatedKeys()).toEqual([queryKeys.projectImage(7)]);
  });

  it("removes by project id alone and invalidates only this project's image", async () => {
    invokeMock.mockResolvedValue(null);

    await act(async () => {
      await removeImage.mutateAsync(7);
    });

    expect(callsOf("remove_project_image")).toEqual([{ project_id: 7 }]);
    expect(invalidatedKeys()).toEqual([queryKeys.projectImage(7)]);
  });

  it("invalidates nothing when the write is refused", async () => {
    invokeMock.mockRejectedValue({
      type: "validation",
      message: "refused",
      field: "project_id",
    });

    await act(async () => {
      await expect(
        setImage.mutateAsync({ project_id: 7, file_path: PICKED_PATH })
      ).rejects.toBeTruthy();
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
