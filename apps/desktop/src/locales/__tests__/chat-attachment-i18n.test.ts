import { describe, expect, it } from "vitest";
import { CHAT_ATTACHMENT_EXTENSIONS } from "@/hooks/useChatAttachment";
import enLocale from "../en.json";
import frLocale from "../fr.json";

const en = enLocale as Record<string, string>;
const fr = frLocale as Record<string, string>;

/**
 * `components/chat/ChatComposer.tsx`, `routes/ai.$agentId.tsx` and `hooks/useChatAttachment.ts`
 * consume these, and `t()` on a missing key renders the raw key string rather than failing — so an
 * en-only addition or a typo ships a literal "chat.attachmentTooLarge" into the UI.
 */
const REQUIRED_KEYS = [
  "chat.attachFile",
  "chat.send",
  "chat.removeAttachment",
  "chat.attachmentFilterName",
  "chat.attachmentUnsupportedType",
  "chat.attachmentEmpty",
  "chat.attachmentTooLarge",
  "chat.attachmentUnreadable",
] as const;

/**
 * The `AppError::Validation` field values `ai/attachment.rs` produces, paired with the key
 * `chatAttachmentMessageKey` maps each to. A refusal reason with no localized copy would
 * surface as the fallback wording for a different problem.
 */
const REJECTION_KEYS = {
  attachment_unsupported_type: "chat.attachmentUnsupportedType",
  attachment_empty: "chat.attachmentEmpty",
  attachment_too_large: "chat.attachmentTooLarge",
  attachment_unreadable: "chat.attachmentUnreadable",
} as const;

describe("chat attachment i18n", () => {
  it("defines every required key in English", () => {
    for (const key of REQUIRED_KEYS) {
      expect(en[key], key).toBeTruthy();
    }
  });

  it("defines every required key in French", () => {
    for (const key of REQUIRED_KEYS) {
      expect(fr[key], key).toBeTruthy();
    }
  });

  it("gives every Rust refusal reason its own localized copy", () => {
    for (const key of Object.values(REJECTION_KEYS)) {
      expect(en[key], key).toBeTruthy();
      expect(fr[key], key).toBeTruthy();
    }
  });

  /* Four distinct problems needing four distinct next actions: shared copy for any two of
   * them tells the user to shrink a file whose type was never supported. */
  it("keeps the four refusal messages distinct within each locale", () => {
    for (const locale of [en, fr]) {
      const messages = Object.values(REJECTION_KEYS).map((key) => locale[key]);
      expect(new Set(messages).size).toBe(messages.length);
    }
  });

  /* The send button used to borrow `chat.placeholder` as its accessible name, announcing "Ask
   * about your finances..." on a control that sends. Copy drifting back to the input's wording
   * restores that ambiguity without touching the component. */
  it("names the send action separately from the input's placeholder", () => {
    for (const locale of [en, fr]) {
      expect(locale["chat.send"]).not.toBe(locale["chat.placeholder"]);
    }
  });

  it("never leaves a French value identical to its English counterpart", () => {
    for (const key of REQUIRED_KEYS) {
      expect(fr[key], key).not.toBe(en[key]);
    }
  });

  /* The picker filter is the user-facing half of the approved format set. Asserted as an exact
   * set, not a superset: an extension offered here but refused by `ai/attachment.rs` shows the
   * user a file they cannot actually attach, and one missing hides an approved format. */
  it("offers exactly the approved eight extensions in the picker", () => {
    expect([...CHAT_ATTACHMENT_EXTENSIONS].sort()).toEqual(
      ["csv", "jpeg", "jpg", "pdf", "png", "txt", "xls", "xlsx"].sort()
    );
  });

  it("offers each extension only once", () => {
    expect(new Set(CHAT_ATTACHMENT_EXTENSIONS).size).toBe(
      CHAT_ATTACHMENT_EXTENSIONS.length
    );
  });

  /* The dialog filter takes bare extensions; a leading dot or an uppercase entry silently
   * matches nothing on some platforms. */
  it("offers every extension as a bare lowercase token", () => {
    for (const extension of CHAT_ATTACHMENT_EXTENSIONS) {
      expect(extension, extension).toBe(extension.toLowerCase());
      expect(extension, extension).not.toContain(".");
    }
  });
});
