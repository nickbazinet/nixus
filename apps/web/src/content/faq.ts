/**
 * FAQ structural data for `<FAQ />`. Question/answer copy lives in i18n
 * locale files (apps/web/src/locales/{en,fr}.json) under
 * `faq.<id>.question` and `faq.<id>.answer`. Inline link labels also
 * resolve through i18n via `labelKey`.
 *
 * The id is a stable camelCase slug used by:
 *   - the accordion's `value` (single-open tracking)
 *   - the analytics fire-on-expand path
 *   - the translation key namespace (`faq.<id>.*`)
 */
export type FAQEntryId =
  | "preAlpha"
  | "bankConnection"
  | "installSafety"
  | "isItFree"
  | "dataStorage"
  | "linuxSupport"
  | "mobileSupport"
  | "whoBuilt"
  | "howToUpdate";

export type FAQEntry = {
  id: FAQEntryId;
  /**
   * Optional inline links rendered below the answer. `labelKey` resolves
   * through i18n; `href` is the literal URL.
   */
  links?: ReadonlyArray<{
    labelKey: string;
    href: string;
    external?: boolean;
  }>;
};

export const faqEntries: readonly FAQEntry[] = [
  { id: "preAlpha" },
  { id: "bankConnection" },
  {
    id: "installSafety",
    links: [
      {
        labelKey: "faq.installSafety.linkInspect",
        href: "https://github.com/nickbazinet/nixus",
        external: true,
      },
    ],
  },
  { id: "isItFree" },
  { id: "dataStorage" },
  { id: "linuxSupport" },
  { id: "mobileSupport" },
  {
    id: "whoBuilt",
    links: [
      {
        labelKey: "faq.whoBuilt.linkGithub",
        href: "https://github.com/nickbazinet",
        external: true,
      },
      {
        labelKey: "faq.whoBuilt.linkEmail",
        href: "mailto:support@nixus.nicolasbazinet.net",
      },
    ],
  },
  { id: "howToUpdate" },
] as const;
