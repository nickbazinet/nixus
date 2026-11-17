import { createRouter } from "@tanstack/react-router";

import { routeTree } from "./routeTree.gen";

/**
 * The export MUST be named `getRouter`: `#tanstack-router-entry` resolves to this
 * file and the client build imports that exact symbol. Naming it `createRouter`
 * fails the build with `"getRouter" is not exported by "src/router.tsx"`.
 */
export function getRouter() {
  return createRouter({ routeTree, scrollRestoration: true });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
