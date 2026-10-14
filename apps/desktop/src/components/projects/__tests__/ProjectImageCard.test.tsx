import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectImageCard } from "@/components/projects/ProjectImageCard";
import { queryKeys } from "@/lib/constants";
import en from "@/locales/en.json";
import type { Project, ProjectImage } from "@/lib/types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

/* The shipped locale behind a `t` that interpolates, so an assertion reads real copy: a hardcoded
 * English sentence in the component would still satisfy a key-only assertion. */
const EN = en as Record<string, string>;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const template = EN[key] ?? key;
      if (vars === undefined) return template;
      return Object.entries(vars).reduce(
        (acc, [name, value]) => acc.split(`{{${name}}}`).join(String(value)),
        template
      );
    },
    i18n: { language: "en" },
  }),
}));

/* Base UI primitives become plain DOM for the same reason `SyncStatusIndicator.test.tsx` does it:
 * what is under test is which state renders which copy and which action, not the shared package's
 * layout. */
vi.mock("@nixus/shared", () => {
  const passthrough =
    (tag: "div" | "p") =>
    ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => {
      const Tag = tag;
      return <Tag {...props}>{children}</Tag>;
    };

  return {
    cn: (...parts: unknown[]) => parts.filter(Boolean).join(" "),
    Alert: passthrough("div"),
    AlertTitle: passthrough("p"),
    AlertDescription: passthrough("div"),
    Card: ({
      children,
      flush: _flush,
      ...props
    }: Record<string, unknown> & { children?: React.ReactNode }) => (
      <div {...props}>{children}</div>
    ),
    CardContent: passthrough("div"),
    Skeleton: passthrough("div"),
    Button: ({
      children,
      variant: _variant,
      size: _size,
      ...props
    }: Record<string, unknown> & { children?: React.ReactNode }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
  };
});

const project: Project = {
  id: 7,
  name: "Kitchen",
  target_cents: 500_000,
  target_date: null,
  priority: 1,
  icon: null,
  color: null,
  archived_at: null,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

function image(overrides: Partial<ProjectImage> = {}): ProjectImage {
  return {
    project_id: project.id,
    mime_type: "image/png",
    original_filename: "cover.png",
    byte_size: 1_500_000,
    uploaded_at: "2026-01-01",
    image_sha256: "a".repeat(64),
    full_image_available: true,
    image_base64: "ZnVsbA==",
    thumbnail_base64: "dGh1bWI=",
    thumbnail_mime: "image/png",
    ...overrides,
  };
}

/** The AD-10 lazy row: metadata and a thumbnail, no payload. */
const lazy = () =>
  image({ full_image_available: false, image_base64: null });

describe("ProjectImageCard", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  const mount = (seeded?: ProjectImage | null) => {
    if (seeded !== undefined) {
      queryClient.setQueryData(queryKeys.projectImage(project.id), seeded);
    }
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ProjectImageCard project={project} />
        </QueryClientProvider>
      );
    });
  };

  const settle = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  const find = (testId: string) =>
    container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
  });

  it("renders nothing for a project without a picture", async () => {
    mount(null);
    await settle();

    expect(container.textContent).toBe("");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("renders the full picture when this computer holds it, and asks for nothing", async () => {
    mount(image());
    await settle();

    const full = find("project-image-full");
    expect(full?.getAttribute("src")).toBe("data:image/png;base64,ZnVsbA==");
    expect(full?.getAttribute("alt")).toBe("Picture for Kitchen");
    expect(find("project-image-placeholder")).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("offers the thumbnail and one download action while the payload is elsewhere", async () => {
    mount(lazy());
    await settle();

    expect(find("project-image-placeholder")).not.toBeNull();
    expect(find("project-image-thumbnail-preview")?.getAttribute("src")).toBe(
      "data:image/png;base64,dGh1bWI="
    );
    expect(find("project-image-full")).toBeNull();
    expect(container.textContent).toContain(EN["projects.image.notOnThisComputer"]);
    expect(find("project-image-fetch-button")?.textContent).toContain(
      EN["projects.image.loadFullAction"]
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("downloads on demand through the sync command and then shows the picture", async () => {
    mount(lazy());
    await settle();

    invokeMock.mockResolvedValue(image());
    act(() => find("project-image-fetch-button")?.click());
    await settle();

    expect(invokeMock).toHaveBeenCalledWith("sync_fetch_project_image", {
      project_id: project.id,
    });
    expect(find("project-image-full")).not.toBeNull();
    expect(find("project-image-placeholder")).toBeNull();
  });

  it("keeps the placeholder and offers a retry when the download is refused", async () => {
    mount(lazy());
    await settle();

    invokeMock.mockRejectedValue({
      type: "sync",
      code: "offline",
      message: "nope",
      recoverable: true,
    });
    act(() => find("project-image-fetch-button")?.click());
    await settle();

    expect(find("project-image-fetch-error")).not.toBeNull();
    expect(container.textContent).toContain(EN["sync.errorOffline"]);
    expect(find("project-image-thumbnail-preview")).not.toBeNull();
    expect(find("project-image-full")).toBeNull();

    invokeMock.mockResolvedValue(image());
    act(() => find("project-image-fetch-retry")?.click());
    await settle();

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(find("project-image-full")).not.toBeNull();
  });

  it("falls back to one generic line when the refusal is not a sync fault", async () => {
    mount(lazy());
    await settle();

    invokeMock.mockRejectedValue("something unexpected");
    act(() => find("project-image-fetch-button")?.click());
    await settle();

    expect(container.textContent).toContain(EN["projects.image.loadFailed"]);
  });

  it("reports the read failure without offering a download it cannot address", async () => {
    invokeMock.mockRejectedValue("unavailable");
    mount();
    await settle();

    expect(find("project-image-read-error")).not.toBeNull();
    expect(container.textContent).toContain(EN["projects.image.unavailable"]);
    expect(find("project-image-fetch-button")).toBeNull();
  });
});
