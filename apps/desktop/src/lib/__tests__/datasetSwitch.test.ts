import { describe, it, expect, beforeEach, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { installLocalStorageMock } from "@/test/localStorageMock";
import {
  CAR_ONBOARDING_DISMISSED_KEY,
  FINANCE_ONBOARDING_DISMISSED_KEY,
  IMPORT_DRAFT_STORAGE_KEY,
  PROFILE_SCOPED_STORAGE_KEYS,
  clearProfileScopedState,
} from "../datasetSwitch";

const localStorageMock = installLocalStorageMock();

// Global preferences belong to the person, not the profile.
const GLOBAL_KEYS = [
  "theme",
  "i18nextLng",
  "rail-collapsed",
  "values-hidden",
  "nixus:last_used_agent_id",
];

beforeEach(() => {
  localStorageMock.clear();
});

function seedStorage() {
  for (const key of PROFILE_SCOPED_STORAGE_KEYS) {
    localStorage.setItem(key, "profile-value");
  }
  for (const key of GLOBAL_KEYS) {
    localStorage.setItem(key, "global-value");
  }
}

describe("PROFILE_SCOPED_STORAGE_KEYS", () => {
  it("covers exactly the three per-profile keys", () => {
    expect([...PROFILE_SCOPED_STORAGE_KEYS]).toEqual([
      "nixus:import-draft.v1",
      "finance.onboarding.dismissed",
      "car.onboarding.dismissed",
    ]);
  });
});

describe("clearProfileScopedState", () => {
  it("removes every per-profile key", () => {
    seedStorage();

    clearProfileScopedState(new QueryClient());

    expect(localStorage.getItem(IMPORT_DRAFT_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(FINANCE_ONBOARDING_DISMISSED_KEY)).toBeNull();
    expect(localStorage.getItem(CAR_ONBOARDING_DISMISSED_KEY)).toBeNull();
  });

  it("preserves global preferences", () => {
    seedStorage();

    clearProfileScopedState(new QueryClient());

    for (const key of GLOBAL_KEYS) {
      expect(localStorage.getItem(key)).toBe("global-value");
    }
  });

  it("clears the query cache", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["expenses"], [{ id: 1 }]);
    queryClient.setQueryData(["accounts"], [{ id: 2 }]);

    clearProfileScopedState(queryClient);

    expect(queryClient.getQueryData(["expenses"])).toBeUndefined();
    expect(queryClient.getQueryData(["accounts"])).toBeUndefined();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it("still clears the cache when storage is unavailable", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["expenses"], [{ id: 1 }]);
    const removeItem = vi
      .spyOn(localStorageMock, "removeItem")
      .mockImplementation(() => {
        throw new Error("storage unavailable");
      });

    try {
      expect(() => clearProfileScopedState(queryClient)).not.toThrow();
      // Every key is still attempted: one failure must not stop the sweep.
      expect(removeItem).toHaveBeenCalledTimes(
        PROFILE_SCOPED_STORAGE_KEYS.length
      );
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    } finally {
      removeItem.mockRestore();
    }
  });
});
