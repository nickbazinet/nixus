import { I18nextProvider } from "react-i18next";
import { ThemeProvider } from "next-themes";
import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
} from "@tanstack/react-router";
import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import i18n from "./i18n";

type ProvidersProps = { children: ReactNode };

function Providers({ children }: ProvidersProps) {
  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
        {children}
      </ThemeProvider>
    </I18nextProvider>
  );
}

// Render helper for components that use i18n + next-themes but no router.
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) {
  return render(ui, { wrapper: Providers, ...options });
}

// Render helper for components that need TanStack Router context (e.g. for
// `useLocation`). The memory history starts at the given path so location-
// dependent components can be exercised at any URL.
export function renderWithRouter(
  ui: ReactElement,
  initialPath = "/",
): ReturnType<typeof render> {
  const rootRoute = createRootRoute({
    component: () => (
      <Providers>
        <Outlet />
      </Providers>
    ),
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => ui,
  });
  const frRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/fr",
    component: () => ui,
  });
  const frChildRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/fr/",
    component: () => ui,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, frRoute, frChildRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  return render(<RouterProvider router={router} />);
}
