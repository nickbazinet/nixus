import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { projectImageMessageKey } from "@/lib/appError";

/**
 * The extensions offered by the native picker. `projects/image.rs` parses the header and is the
 * enforcement boundary — this list is UX only, so a `.txt` renamed to `.png` and chosen here is
 * still refused by `validate_project_image` before anything is written.
 */
export const PROJECT_IMAGE_EXTENSIONS = ["png", "jpg", "jpeg"] as const;

/**
 * Shown when a rejection carries no field this build recognizes. Deliberately generic and never
 * one of the seven mapped refusals: naming a cause the backend did not report — "that file could
 * not be read" about a file that read fine — sends the user to fix the wrong thing.
 */
export const GENERIC_FAILURE_KEY = "projects.image.saveFailed";

export interface PickedProjectImage {
  /** Absolute path, held in state only and never persisted, logged, or sent anywhere else. */
  readonly path: string;
  /** Basename as the backend reported it, so no directory component can reach the UI. */
  readonly name: string;
}

/**
 * What one `pick()` did, so the caller can tell a dismissed dialog apart from a real outcome.
 *
 * A re-entrant call reports `cancelled` because it changed nothing — the same contract a
 * dismissed dialog has.
 */
export type ProjectImagePickOutcome = "cancelled" | "selected" | "refused";

/**
 * The copy and error-mapping a surface brings to the shared picker.
 *
 * Overrides rather than a second hook: the file access, the re-entrancy guard and the
 * validate-before-write ordering are the parts that must not be duplicated, while "project image"
 * is the wrong noun on the profile page and the refusal fields map to different keys there. Every
 * field defaults to the project-image contract, so the original call site passes nothing.
 */
export interface ProjectImagePickerOptions {
  /** i18n key for the native dialog's filter name. */
  readonly filterNameKey?: string;
  /** Maps a Tauri rejection to an i18n key, or `null` when this build cannot name the cause. */
  readonly messageKey?: (error: unknown) => string | null;
  /** Shown when `messageKey` returns `null`. */
  readonly genericFailureKey?: string;
}

export interface ProjectImagePickerState {
  readonly picked: PickedProjectImage | null;
  /** i18n key for the current refusal, or `null` when there is nothing to report. */
  readonly errorKey: string | null;
  /** True while a picker is open, so the caller can disable the control that opens it. */
  readonly picking: boolean;
  readonly pick: () => Promise<ProjectImagePickOutcome>;
  readonly reset: () => void;
}

/**
 * Owns the one file an image upload is about to send.
 *
 * The path never leaves this state: the write command receives it, reads the bytes in Rust, and
 * keeps no source — so the frontend needs no filesystem access of its own. Validation runs here,
 * before any write, so a refusal costs nothing and cannot destroy an existing image.
 */
export function useProjectImagePicker(
  options: ProjectImagePickerOptions = {},
): ProjectImagePickerState {
  const {
    filterNameKey = "projects.image.filterName",
    messageKey = projectImageMessageKey,
    genericFailureKey = GENERIC_FAILURE_KEY,
  } = options;
  const { t } = useTranslation();
  const [picked, setPicked] = useState<PickedProjectImage | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // A ref, not the state above: two clicks in one tick both read the pre-update state, so only a
  // synchronous flag can stop a second native dialog from opening.
  const pickingRef = useRef(false);

  const pick = useCallback(async (): Promise<ProjectImagePickOutcome> => {
    if (pickingRef.current) return "cancelled";
    pickingRef.current = true;
    setPicking(true);

    try {
      let selected: unknown;
      try {
        selected = await open({
          multiple: false,
          filters: [
            {
              name: t(filterNameKey),
              extensions: [...PROJECT_IMAGE_EXTENSIONS],
            },
          ],
        });
      } catch {
        // The native dialog itself failed to open or was torn down. Reported rather than
        // swallowed, or the add button looks inert with no explanation. Generic, because no file
        // was ever reached and every specific refusal would be a guess.
        setPicked(null);
        setErrorKey(genericFailureKey);
        return "refused";
      }

      // A cancelled picker must leave the selection and any standing error alone.
      if (typeof selected !== "string") return "cancelled";

      try {
        const name = await invoke<string>("validate_project_image", {
          file_path: selected,
        });
        setPicked({ path: selected, name });
        setErrorKey(null);
        return "selected";
      } catch (err: unknown) {
        setPicked(null);
        setErrorKey(messageKey(err) ?? genericFailureKey);
        return "refused";
      }
    } finally {
      pickingRef.current = false;
      setPicking(false);
    }
  }, [t, filterNameKey, messageKey, genericFailureKey]);

  const reset = useCallback(() => {
    setPicked(null);
    setErrorKey(null);
  }, []);

  return { picked, errorKey, picking, pick, reset };
}
