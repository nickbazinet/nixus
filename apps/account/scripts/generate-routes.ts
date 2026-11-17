import { Generator, getConfig } from "@tanstack/router-generator";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = getConfig(
  {
    routesDirectory: "./src/routes",
    generatedRouteTree: "./src/routeTree.gen.ts",
    target: "react",
    quoteStyle: "double",
    semicolons: true,
  },
  root,
);

const generator = new Generator({ config, root });
await generator.run();
