import { describe, expect, it } from "vitest";
import enLocale from "../en.json";
import frLocale from "../fr.json";
import {
  syncStateDetailKey,
  syncStateLabelKey,
} from "@/lib/syncState";
import { syncMessageKey } from "@/lib/appError";
import type { SyncErrorCode } from "@/lib/appError";
import type { SyncState } from "@/lib/types";

const en = enLocale as Record<string, string>;
const fr = frLocale as Record<string, string>;

const SYNC_PREFIX = "sync.";

const ALL_STATES: readonly SyncState[] = [
  "unlinked",
  "idle",
  "syncing",
  "offline",
  "frozen",
  "update_needed",
  "clock_skew",
  "link_choice_required",
  "remote_changed",
  "error",
];

/* The full `SyncFault::code()` list from the Rust side. Spelled out rather than imported from a
 * value, because `SyncErrorCode` is a type: a code the backend gains and the frontend never maps
 * has to fail here, which only happens if this list is maintained alongside it. */
const ALL_ERROR_CODES: readonly SyncErrorCode[] = [
  "local_only",
  "not_entitled",
  "frozen",
  "account_mismatch",
  "owner_mismatch",
  "owner_malformed",
  "state_unavailable",
  "signed_out",
  "not_configured",
  "offline",
  "identity_rejected",
  "remote_missing",
  "install_collision",
  "forbidden",
  "credentials_expired",
  "remote_changed",
  "transport",
  "snapshot_build",
  "dataset_busy",
  "update_needed",
  "snapshot_invalid",
  "restore_failed",
  "profile_create_failed",
  "not_enabled",
  "no_pending_prompt",
  "actor_unavailable",
  "image_missing",
  "image_corrupt",
  "segment_invalid",
  "apply_failed",
  "clock_skew",
];

const REQUIRED_KEYS = [
  "sync.sectionHeading",
  "sync.whatIsSyncedTitle",
  "sync.whatIsSyncedBody",
  "sync.whatIsNotSyncedBody",
  "sync.whereItLivesBody",
  "sync.accountTitle",
  "sync.accountProfile",
  "sync.signInAction",
  "sync.enableTitle",
  "sync.enableAction",
  "sync.enabling",
  "sync.disableAction",
  "sync.disabling",
  "sync.lastSyncTitle",
  "sync.lastSyncNever",
  "sync.lastSyncAt",
  "sync.unavailableLocalOnlyTitle",
  "sync.unavailableLocalOnlyBody",
  "sync.unavailableSignedOutTitle",
  "sync.unavailableSignedOutBody",
  "sync.diagnosticsAction",
  "sync.diagnosticsSummary",
  "sync.diagnosticsExportTitle",
  "sync.diagnosticsExportBody",
  "sync.diagnosticsExportAction",
  "sync.diagnosticsExporting",
  "sync.diagnosticsExportSaved",
  "sync.retry",
  "sync.decideLater",
  "sync.indicatorLabel",
  "sync.firstSyncTitle",
  "sync.firstSyncPreparing",
  "sync.firstSyncUploading",
  "sync.firstSyncDone",
  "sync.firstSyncFailed",
  "sync.linkChoiceTitle",
  "sync.linkChoiceDescription",
  "sync.linkChoiceKeepSeparateAction",
  "sync.linkChoiceReplaceAction",
  "sync.linkChoiceReplaceBackup",
  "sync.remoteChangedTitle",
  "sync.remoteChangedDescription",
  "sync.remoteChangedLoadAction",
  "sync.remoteChangedKeepAction",
  "sync.separateProfileTitle",
  "sync.separateProfileBody",
  "sync.errorTransport",
  "sync.appliedCue",
  "sync.appliedCueDismiss",
] as const;

function syncKeys(locale: Record<string, string>): string[] {
  return Object.keys(locale).filter((key) => key.startsWith(SYNC_PREFIX));
}

describe("sync i18n", () => {
  it.each(REQUIRED_KEYS)("defines %s in both locales with a value", (key) => {
    expect(en[key], `${key} missing in en.json`).toBeTruthy();
    expect(fr[key], `${key} missing in fr.json`).toBeTruthy();
  });

  it("has no sync key present in one locale but not the other", () => {
    const enKeys = syncKeys(en);
    const frKeys = syncKeys(fr);

    expect(enKeys.filter((k) => !frKeys.includes(k))).toEqual([]);
    expect(frKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
  });

  it.each(ALL_STATES)("has a localized label and detail for state %s", (state) => {
    for (const key of [syncStateLabelKey(state), syncStateDetailKey(state)]) {
      expect(en[key], `${key} missing in en.json`).toBeTruthy();
      expect(fr[key], `${key} missing in fr.json`).toBeTruthy();
    }
  });

  it.each(ALL_ERROR_CODES)("has localized copy for error code %s", (code) => {
    const key = syncMessageKey(code);
    expect(en[key], `${key} missing in en.json`).toBeTruthy();
    expect(fr[key], `${key} missing in fr.json`).toBeTruthy();
  });

  it("keeps every interpolation placeholder in both locales", () => {
    const placeholders: Record<string, readonly string[]> = {
      "sync.indicatorLabel": ["{{status}}"],
      "sync.accountProfile": ["{{label}}"],
      "sync.lastSyncAt": ["{{date}}"],
      "sync.linkChoiceDescription": ["{{rows}}", "{{date}}"],
      "sync.remoteChangedDescription": ["{{date}}"],
      "sync.diagnosticsExportSaved": ["{{path}}"],
      "sync.diagnosticsSummary": [
        "{{state}}",
        "{{uploads}}",
        "{{conflicts}}",
        "{{restores}}",
        "{{failures}}",
        "{{blocked}}",
      ],
    };

    for (const [key, expected] of Object.entries(placeholders)) {
      for (const token of expected) {
        expect(en[key], `${key} en.json`).toContain(token);
        expect(fr[key], `${key} fr.json`).toContain(token);
      }
    }
  });

  /* AD-14: the capability is the backend's decision and the UI must never name a tier, because
   * changing which tiers include `multi_device_sync` must not require a copy change. The pattern is
   * the tier vocabulary only — "plus" and "pro" are ordinary words in both languages ("plus tard")
   * and matching them would make this guard fire on correct copy. */
  it("names no subscription tier in any sync string", () => {
    const forbidden = /\b(premium|tier|forfait|gratuit)\b/i;
    for (const locale of [en, fr]) {
      for (const key of syncKeys(locale)) {
        expect(locale[key], `${key} names a tier`).not.toMatch(forbidden);
      }
    }
  });
});
