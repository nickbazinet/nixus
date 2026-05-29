import { describe, it, expect, beforeEach, vi } from "vitest";
import { getLastUsedAgentId, setLastUsedAgentId } from "../agents";

// Mock localStorage for tests
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

vi.stubGlobal("localStorage", localStorageMock);

// Reset localStorage state before each test
beforeEach(() => {
  localStorageMock.clear();
});

describe("getLastUsedAgentId", () => {
  it("returns budget-helper when key is absent", () => {
    expect(getLastUsedAgentId()).toBe("budget-helper");
  });

  it("returns stored value when it is a known agent ID", () => {
    localStorage.setItem("nixus:last_used_agent_id", "budget-helper");
    expect(getLastUsedAgentId()).toBe("budget-helper");
  });

  it("returns budget-helper and writes fallback when stored value is unknown", () => {
    localStorage.setItem("nixus:last_used_agent_id", "unknown-agent");
    expect(getLastUsedAgentId()).toBe("budget-helper");
    expect(localStorage.getItem("nixus:last_used_agent_id")).toBe(
      "budget-helper"
    );
  });
});

describe("setLastUsedAgentId", () => {
  it("writes the agent ID to localStorage", () => {
    setLastUsedAgentId("budget-helper");
    expect(localStorage.getItem("nixus:last_used_agent_id")).toBe(
      "budget-helper"
    );
  });
});
