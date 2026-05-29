import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("robots.txt", () => {
  const robotsPath = path.resolve(__dirname, "../../public/robots.txt");
  const robots = fs.readFileSync(robotsPath, "utf8");

  it("allows all user agents", () => {
    expect(robots).toMatch(/User-agent:\s*\*/i);
    expect(robots).toMatch(/Allow:\s*\//);
  });

  it("references the sitemap", () => {
    expect(robots).toMatch(/Sitemap:\s*https:\/\/nixus\.app\/sitemap\.xml/i);
  });

  it("does not contain Disallow rules in v1", () => {
    expect(robots).not.toMatch(/Disallow:/i);
  });
});
